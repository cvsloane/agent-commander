package tmux

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var tmuxVersionPattern = regexp.MustCompile(`(?:^|[^0-9])(\d+)\.(\d+)`)

var ErrTmuxHooksUnsupported = errors.New("tmux hooks are unsupported")

var topologyHookNames = []string{
	"after-new-window",
	"after-kill-pane",
	"after-split-window",
	"window-renamed",
	"session-renamed",
	"session-created",
	"session-closed",
	"after-resize-pane",
}

type savedHook struct {
	name     string
	commands []string
}

type HookManager struct {
	client  *Client
	cancel  context.CancelFunc
	onHook  func(string)
	saved   []savedHook
	wg      sync.WaitGroup
	mu      sync.Mutex
	stopped bool
}

func tmuxVersionSupportsHooks(version string) bool {
	match := tmuxVersionPattern.FindStringSubmatch(version)
	if len(match) != 3 {
		return false
	}
	major, majorErr := strconv.Atoi(match[1])
	minor, minorErr := strconv.Atoi(match[2])
	if majorErr != nil || minorErr != nil {
		return false
	}
	return major > 2 || (major == 2 && minor >= 4)
}

func (c *Client) StartTopologyHooks(onHook func(string)) (*HookManager, error) {
	version, err := c.tmuxVersion()
	if err != nil {
		return nil, fmt.Errorf("detect tmux hook support: %w", err)
	}
	if !tmuxVersionSupportsHooks(version) {
		return nil, fmt.Errorf("%w: %s", ErrTmuxHooksUnsupported, version)
	}

	ctx, cancel := context.WithCancel(context.Background())
	manager := &HookManager{client: c, cancel: cancel, onHook: onHook}
	for index, hookName := range topologyHookNames {
		rawCommands, err := c.rawHookCommands(hookName)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "invalid option") {
				log.Printf("tmux hook %s is unsupported; skipping", hookName)
				continue
			}
			manager.Close()
			return nil, fmt.Errorf("inspect tmux hook %s: %w", hookName, err)
		}
		commands := filterAgentdHookCommands(rawCommands)
		if len(commands) != len(rawCommands) {
			if err := c.restoreHook(savedHook{name: hookName, commands: commands}); err != nil {
				manager.Close()
				return nil, fmt.Errorf("remove stale agentd tmux hook %s: %w", hookName, err)
			}
		}

		signal := fmt.Sprintf("ac-agentd-%d-%d-%d-%s", os.Getpid(), time.Now().UnixNano(), index, hookName)
		if err := c.setHook(hookName, "wait-for -S "+signal, true); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "invalid option") {
				log.Printf("tmux hook %s is unsupported; skipping", hookName)
				continue
			}
			manager.Close()
			return nil, fmt.Errorf("register tmux hook %s: %w", hookName, err)
		}
		manager.saved = append(manager.saved, savedHook{name: hookName, commands: commands})
		manager.wg.Add(1)
		go manager.watch(ctx, hookName, signal)
	}
	if len(manager.saved) == 0 {
		manager.Close()
		return nil, fmt.Errorf("%w: no supported topology hooks", ErrTmuxHooksUnsupported)
	}
	return manager, nil
}

func (m *HookManager) watch(ctx context.Context, hookName, signal string) {
	defer m.wg.Done()
	for {
		if err := m.client.waitFor(ctx, signal); err != nil {
			if ctx.Err() == nil {
				log.Printf("tmux hook watcher stopped (%s): %v", hookName, err)
			}
			return
		}

		m.mu.Lock()
		stopped := m.stopped
		onHook := m.onHook
		m.mu.Unlock()
		if stopped {
			return
		}
		if onHook != nil {
			onHook(hookName)
		}
	}
}

func (m *HookManager) Close() {
	if m == nil {
		return
	}
	m.mu.Lock()
	if m.stopped {
		m.mu.Unlock()
		return
	}
	m.stopped = true
	m.mu.Unlock()

	for _, hook := range m.saved {
		if err := m.client.restoreHook(hook); err != nil {
			log.Printf("failed to restore tmux hook %s: %v", hook.name, err)
		}
	}
	m.cancel()
	m.wg.Wait()
}

func (c *Client) tmuxVersion() (string, error) {
	output, err := exec.Command(c.cfg.Bin, "-V").CombinedOutput()
	if err != nil {
		return "", commandError(err, output)
	}
	return strings.TrimSpace(string(output)), nil
}

func (c *Client) hookCommands(hookName string) ([]string, error) {
	commands, err := c.rawHookCommands(hookName)
	if err != nil {
		return nil, err
	}
	return filterAgentdHookCommands(commands), nil
}

func (c *Client) rawHookCommands(hookName string) ([]string, error) {
	output, err := c.hookOutput(context.Background(), "show-hooks", "-g", hookName)
	if err != nil {
		return nil, err
	}
	prefix := hookName + "["
	var commands []string
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == hookName {
			continue
		}
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		separator := strings.IndexByte(line, ' ')
		if separator >= 0 && separator+1 < len(line) {
			commands = append(commands, line[separator+1:])
		}
	}
	return commands, nil
}

func filterAgentdHookCommands(commands []string) []string {
	filtered := make([]string, 0, len(commands))
	for _, command := range commands {
		fields := strings.Fields(command)
		if len(fields) == 3 && fields[0] == "wait-for" && fields[1] == "-S" &&
			strings.HasPrefix(fields[2], "ac-agentd-") && len(fields[2]) > len("ac-agentd-") {
			continue
		}
		filtered = append(filtered, command)
	}
	return filtered
}

func (c *Client) setHook(hookName, command string, appendCommand bool) error {
	flag := "-g"
	if appendCommand {
		flag = "-ag"
	}
	_, err := c.hookOutput(context.Background(), "set-hook", flag, hookName, command)
	return err
}

func (c *Client) restoreHook(hook savedHook) error {
	if _, err := c.hookOutput(context.Background(), "set-hook", "-gu", hook.name); err != nil {
		return err
	}
	for index, command := range hook.commands {
		if err := c.setHook(hook.name, command, index > 0); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) waitFor(ctx context.Context, signal string) error {
	_, err := c.hookOutput(ctx, "wait-for", signal)
	return err
}

func (c *Client) hookOutput(ctx context.Context, args ...string) ([]byte, error) {
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}
	output, err := exec.CommandContext(ctx, c.cfg.Bin, args...).CombinedOutput()
	if err != nil {
		return nil, commandError(err, output)
	}
	return output, nil
}

func commandError(err error, output []byte) error {
	message := strings.TrimSpace(string(output))
	if message == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, message)
}
