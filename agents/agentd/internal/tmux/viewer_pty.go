package tmux

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
)

const viewerSessionPrefix = "ac-view-"

const (
	defaultTerminalBufferChunks = 64
	defaultPTYCoalesceDelay     = 16 * time.Millisecond
)

// TerminalSize is the PTY size requested by a terminal viewer.
type TerminalSize struct {
	Cols uint16
	Rows uint16
}

// PTYProcess is the tmux client process attached through a PTY.
type PTYProcess interface {
	io.ReadWriteCloser
	Resize(TerminalSize) error
	Wait() error
	Kill() error
}

// TmuxRunner isolates tmux process execution so viewer lifecycle can be tested
// without changing or attaching to real tmux sessions.
type TmuxRunner interface {
	Output(args ...string) ([]byte, error)
	Run(args ...string) error
	StartPTY(args []string, env []string, size TerminalSize) (PTYProcess, error)
}

type execTmuxRunner struct {
	client *Client
}

func newExecTmuxRunner(client *Client) TmuxRunner {
	return &execTmuxRunner{client: client}
}

func (r *execTmuxRunner) Output(args ...string) ([]byte, error) {
	cmd := exec.Command(r.client.cfg.Bin, r.withSocket(args)...)
	return cmd.Output()
}

func (r *execTmuxRunner) Run(args ...string) error {
	return exec.Command(r.client.cfg.Bin, r.withSocket(args)...).Run()
}

func (r *execTmuxRunner) StartPTY(args []string, env []string, size TerminalSize) (PTYProcess, error) {
	cmd := exec.Command(r.client.cfg.Bin, r.withSocket(args)...)
	cmd.Env = env
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: size.Cols, Rows: size.Rows})
	if err != nil {
		return nil, err
	}
	return &execPTYProcess{file: ptmx, cmd: cmd}, nil
}

func (r *execTmuxRunner) withSocket(args []string) []string {
	result := append([]string(nil), args...)
	if r.client.cfg.Socket != "" {
		result = append([]string{"-S", r.client.cfg.Socket}, result...)
	}
	return result
}

type execPTYProcess struct {
	file *os.File
	cmd  *exec.Cmd
}

func (p *execPTYProcess) Read(data []byte) (int, error)  { return p.file.Read(data) }
func (p *execPTYProcess) Write(data []byte) (int, error) { return p.file.Write(data) }
func (p *execPTYProcess) Close() error                   { return p.file.Close() }
func (p *execPTYProcess) Wait() error                    { return p.cmd.Wait() }
func (p *execPTYProcess) Kill() error {
	if p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Kill()
}
func (p *execPTYProcess) Resize(size TerminalSize) error {
	return pty.Setsize(p.file, &pty.Winsize{Cols: size.Cols, Rows: size.Rows})
}

type viewerPTYOptions struct {
	ChannelID     string
	PaneID        string
	ReadOnly      bool
	Cols          uint16
	Rows          uint16
	Letterbox     bool
	ResumeToken   string
	InitialOutput []byte
	BufferChunks  int
	CoalesceDelay time.Duration
	OnOutput      func(channelID, encoded string)
	OnStatus      func(channelID, status, message string)
}

type viewerPTYBridge struct {
	runner       TmuxRunner
	channelID    string
	paneID       string
	sessionName  string
	viewSession  string
	windowTarget string
	resumeToken  string
	resumeOption string
	readonly     bool
	letterbox    bool
	// Signed lines not yet converted into app wheel events (alt+mouse panes
	// scroll ~3 lines per event; discarding the sub-event residue makes slow
	// drags inert). Mutated only on Navigate paths, under the manager lock.
	wheelResidue int
	size         TerminalSize
	process      PTYProcess
	fanout       *terminalFanout
	closed       chan struct{}
	mu           sync.RWMutex
	closeOnce    sync.Once
	removeOnce   sync.Once
}

func newViewerPTYBridge(runner TmuxRunner, opts viewerPTYOptions) (*viewerPTYBridge, error) {
	if opts.Cols == 0 {
		opts.Cols = 80
	}
	if opts.Rows == 0 {
		opts.Rows = 24
	}
	if opts.BufferChunks == 0 {
		opts.BufferChunks = defaultTerminalBufferChunks
	}
	if opts.CoalesceDelay == 0 {
		opts.CoalesceDelay = defaultPTYCoalesceDelay
	}

	target, err := runner.Output("display-message", "-p", "-t", opts.PaneID, "#{session_name}\t#{window_index}\t#{pane_index}")
	if err != nil {
		return nil, fmt.Errorf("describe pane %s: %w", opts.PaneID, err)
	}
	parts := strings.Split(strings.TrimSpace(string(target)), "\t")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil, fmt.Errorf("unexpected tmux pane target %q for %s", strings.TrimSpace(string(target)), opts.PaneID)
	}

	viewSession := viewerSessionName(opts.ChannelID)
	if err := runner.Run("new-session", "-d", "-t", parts[0], "-s", viewSession); err != nil {
		return nil, fmt.Errorf("create grouped viewer session %s: %w", viewSession, err)
	}
	cleanupGroup := true
	defer func() {
		if cleanupGroup {
			_ = runner.Run("kill-session", "-t", viewSession)
		}
	}()

	if err := runner.Run("select-window", "-t", viewSession+":"+parts[1]); err != nil {
		return nil, fmt.Errorf("select viewer window: %w", err)
	}
	if err := runner.Run("select-pane", "-t", viewSession+":"+parts[1]+"."+parts[2]); err != nil {
		return nil, fmt.Errorf("select viewer pane: %w", err)
	}
	windowTarget := viewSession + ":" + parts[1]
	letterboxPinned := false
	if opts.Letterbox {
		if err := runner.Run("set-option", "-w", "-t", windowTarget, "window-size", "manual"); err != nil {
			return nil, fmt.Errorf("pin viewer window sizing: %w", err)
		}
		letterboxPinned = true
		if err := runner.Run(
			"resize-window",
			"-t", windowTarget,
			"-x", fmt.Sprintf("%d", opts.Cols),
			"-y", fmt.Sprintf("%d", opts.Rows),
		); err != nil {
			return nil, fmt.Errorf("size letterboxed viewer window: %w", err)
		}
	}
	defer func() {
		if cleanupGroup && letterboxPinned {
			_ = runner.Run("set-option", "-w", "-t", windowTarget, "window-size", "latest")
		}
	}()

	resumeOption := resumeOptionName(opts.ResumeToken)
	if err := runner.Run("set-option", "-p", "-t", opts.PaneID, resumeOption, opts.ResumeToken); err != nil {
		return nil, fmt.Errorf("persist terminal resume token: %w", err)
	}

	attachArgs := []string{"attach-session"}
	if opts.ReadOnly {
		attachArgs = append(attachArgs, "-r")
	}
	attachArgs = append(attachArgs, "-t", viewSession)
	size := TerminalSize{Cols: opts.Cols, Rows: opts.Rows}
	process, err := runner.StartPTY(attachArgs, terminalEnvironment(), size)
	if err != nil {
		return nil, fmt.Errorf("attach grouped viewer session: %w", err)
	}

	fanout := newTerminalFanout(
		opts.BufferChunks,
		base64.StdEncoding.EncodeToString,
		opts.OnOutput,
		func(channelID string, dropped int) {
			if opts.OnStatus != nil {
				opts.OnStatus(channelID, "lag", fmt.Sprintf("Dropped %d terminal output chunks", dropped))
			}
		},
	)
	fanout.Attach(opts.ChannelID)
	if len(opts.InitialOutput) > 0 {
		fanout.Broadcast(opts.InitialOutput)
	}
	bridge := &viewerPTYBridge{
		runner:       runner,
		channelID:    opts.ChannelID,
		paneID:       opts.PaneID,
		sessionName:  parts[0],
		viewSession:  viewSession,
		windowTarget: windowTarget,
		resumeToken:  opts.ResumeToken,
		resumeOption: resumeOption,
		readonly:     opts.ReadOnly,
		letterbox:    opts.Letterbox,
		size:         size,
		process:      process,
		fanout:       fanout,
		closed:       make(chan struct{}),
	}
	cleanupGroup = false
	go bridge.readLoop(opts.CoalesceDelay)
	go bridge.waitForExit()
	return bridge, nil
}

func (b *viewerPTYBridge) Write(data []byte) error {
	b.mu.RLock()
	defer b.mu.RUnlock()
	select {
	case <-b.closed:
		return fmt.Errorf("viewer PTY is closed")
	default:
	}
	_, err := b.process.Write(data)
	return err
}

func (b *viewerPTYBridge) Resize(rows, cols uint16) error {
	if rows == 0 || cols == 0 {
		return fmt.Errorf("terminal size must be positive")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	select {
	case <-b.closed:
		return fmt.Errorf("viewer PTY is closed")
	default:
	}
	b.size = TerminalSize{Cols: cols, Rows: rows}
	return b.process.Resize(b.size)
}

func (b *viewerPTYBridge) Size() TerminalSize {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.size
}

func (b *viewerPTYBridge) setPaneID(paneID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.paneID = paneID
}

func (b *viewerPTYBridge) SelectWindow(windowIndex int) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	select {
	case <-b.closed:
		return fmt.Errorf("viewer PTY is closed")
	default:
	}

	target := b.viewSession + ":" + strconv.Itoa(windowIndex)
	if err := b.selectWindowLocked(target); err != nil {
		return err
	}
	b.wheelResidue = 0
	return nil
}

func (b *viewerPTYBridge) SelectPane(paneID string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	select {
	case <-b.closed:
		return fmt.Errorf("viewer PTY is closed")
	default:
	}

	described, err := b.runner.Output("display-message", "-p", "-t", paneID, "#{window_index}\t#{pane_index}")
	if err != nil {
		return fmt.Errorf("describe viewer pane %s: %w", paneID, err)
	}
	parts := strings.Split(strings.TrimSpace(string(described)), "\t")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return fmt.Errorf("unexpected tmux pane target %q for %s", strings.TrimSpace(string(described)), paneID)
	}

	windowTarget := b.viewSession + ":" + parts[0]
	paneTarget := windowTarget + "." + parts[1]
	resolved, err := b.runner.Output("display-message", "-p", "-t", paneTarget, "#{pane_id}")
	if err != nil || strings.TrimSpace(string(resolved)) != paneID {
		return fmt.Errorf("pane %s is not in grouped viewer session", paneID)
	}
	if err := b.selectWindowLocked(windowTarget); err != nil {
		return fmt.Errorf("select viewer pane window: %w", err)
	}
	if err := b.runner.Run("select-pane", "-t", paneTarget); err != nil {
		return fmt.Errorf("select viewer pane: %w", err)
	}
	b.wheelResidue = 0
	return nil
}

func (b *viewerPTYBridge) selectWindowLocked(target string) error {
	previous := b.windowTarget
	if b.letterbox && previous != target {
		if err := b.runner.Run("set-option", "-w", "-t", previous, "window-size", "latest"); err != nil {
			return fmt.Errorf("release previous viewer window sizing: %w", err)
		}
	}
	if err := b.runner.Run("select-window", "-t", target); err != nil {
		return fmt.Errorf("select viewer window: %w", err)
	}
	if b.letterbox && previous != target {
		if err := b.runner.Run("set-option", "-w", "-t", target, "window-size", "manual"); err != nil {
			_ = b.runner.Run("set-option", "-w", "-t", target, "window-size", "latest")
			return fmt.Errorf("pin selected viewer window sizing: %w", err)
		}
		if err := b.runner.Run(
			"resize-window",
			"-t", target,
			"-x", fmt.Sprintf("%d", b.size.Cols),
			"-y", fmt.Sprintf("%d", b.size.Rows),
		); err != nil {
			_ = b.runner.Run("set-option", "-w", "-t", target, "window-size", "latest")
			return fmt.Errorf("size selected viewer window: %w", err)
		}
	}
	b.windowTarget = target
	return nil
}

func (b *viewerPTYBridge) SetZoom(on bool) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	select {
	case <-b.closed:
		return fmt.Errorf("viewer PTY is closed")
	default:
	}

	zoomed, err := b.runner.Output("display-message", "-p", "-t", b.viewSession, "#{window_zoomed_flag}")
	if err != nil {
		return fmt.Errorf("read viewer zoom state: %w", err)
	}
	isZoomed := strings.TrimSpace(string(zoomed)) == "1"
	if isZoomed == on {
		return nil
	}
	// Zoom is a window-shared tmux property even though navigation targets the
	// grouped viewer. Callers must surface that shared effect predictably.
	if err := b.runner.Run("resize-pane", "-Z", "-t", b.viewSession+":"); err != nil {
		return fmt.Errorf("set viewer zoom state: %w", err)
	}
	return nil
}

func (b *viewerPTYBridge) State() (TerminalViewerState, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	select {
	case <-b.closed:
		return TerminalViewerState{}, fmt.Errorf("viewer PTY is closed")
	default:
	}

	output, err := b.runner.Output(
		"display-message",
		"-p",
		"-t",
		b.viewSession,
		"#{pane_id}\t#{window_index}\t#{window_zoomed_flag}",
	)
	if err != nil {
		return TerminalViewerState{}, fmt.Errorf("read viewer state: %w", err)
	}
	parts := strings.Split(strings.TrimSpace(string(output)), "\t")
	if len(parts) != 3 || parts[0] == "" {
		return TerminalViewerState{}, fmt.Errorf("unexpected viewer state %q", strings.TrimSpace(string(output)))
	}
	windowIndex, err := strconv.Atoi(parts[1])
	if err != nil || windowIndex < 0 {
		return TerminalViewerState{}, fmt.Errorf("unexpected viewer window index %q", parts[1])
	}
	return TerminalViewerState{
		PaneID:      parts[0],
		WindowIndex: windowIndex,
		Zoomed:      parts[2] == "1",
	}, nil
}

func (b *viewerPTYBridge) DetachChannel(channelID string) {
	if b.fanout != nil {
		b.fanout.Detach(channelID)
	}
}

func (b *viewerPTYBridge) close(removeResumeToken bool) {
	b.closeOnce.Do(func() {
		b.mu.Lock()
		close(b.closed)
		if b.process != nil {
			_ = b.process.Close()
			_ = b.process.Kill()
		}
		b.mu.Unlock()
		if b.letterbox {
			_ = b.runner.Run("set-option", "-w", "-t", b.windowTarget, "window-size", "latest")
		}
		_ = b.runner.Run("kill-session", "-t", b.viewSession)
		if b.fanout != nil {
			b.fanout.Close()
		}
	})
	if removeResumeToken {
		b.removeOnce.Do(func() {
			_ = b.runner.Run("set-option", "-pu", "-t", b.paneID, b.resumeOption)
		})
	}
}

func (b *viewerPTYBridge) readLoop(delay time.Duration) {
	reads := make(chan []byte)
	go func() {
		defer close(reads)
		buffer := make([]byte, 4096)
		for {
			n, err := b.process.Read(buffer)
			if n > 0 {
				chunk := append([]byte(nil), buffer[:n]...)
				select {
				case reads <- chunk:
				case <-b.closed:
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	var pending []byte
	var timer *time.Timer
	var timerC <-chan time.Time
	flush := func() {
		if len(pending) == 0 {
			return
		}
		b.fanout.Broadcast(pending)
		pending = pending[:0]
	}
	for {
		select {
		case <-b.closed:
			if timer != nil {
				timer.Stop()
			}
			return
		case chunk, ok := <-reads:
			if !ok {
				if timer != nil {
					timer.Stop()
				}
				flush()
				b.close(false)
				return
			}
			pending = append(pending, chunk...)
			if timer == nil {
				timer = time.NewTimer(delay)
				timerC = timer.C
			}
		case <-timerC:
			flush()
			timer = nil
			timerC = nil
		}
	}
}

func (b *viewerPTYBridge) waitForExit() {
	if b.process == nil {
		return
	}
	_ = b.process.Wait()
	b.close(false)
}

func terminalEnvironment() []string {
	return append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"LANG=en_US.UTF-8",
		"LC_CTYPE=en_US.UTF-8",
	)
}

func viewerSessionName(channelID string) string {
	var builder strings.Builder
	changed := false
	for i := 0; i < len(channelID); i++ {
		char := channelID[i]
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			builder.WriteByte(char)
			continue
		}
		builder.WriteByte('-')
		changed = true
	}
	safe := builder.String()
	trimmed := strings.Trim(safe, "-_")
	if trimmed != safe {
		changed = true
	}
	safe = trimmed
	if safe == "" {
		safe = "viewer"
		changed = true
	}
	if len(safe) > 70 {
		safe = safe[:70]
		changed = true
	}
	if changed {
		sum := sha256.Sum256([]byte(channelID))
		safe += fmt.Sprintf("-%x", sum[:4])
	}
	return viewerSessionPrefix + safe
}

func resumeOptionName(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("@ac_terminal_resume_%x", sum[:8])
}
