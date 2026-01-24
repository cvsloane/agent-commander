package tmux

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/agent-command/agentd/internal/config"
)

type Pane struct {
	PaneID           string
	PanePID          int
	SessionName      string
	WindowName       string
	WindowIndex      int
	PaneIndex        int
	CurrentPath      string
	CurrentCommand   string
	PaneTitle        string
	ProviderOverride string
}

type Client struct {
	cfg *config.TmuxConfig
}

func NewClient(cfg *config.TmuxConfig) *Client {
	return &Client{cfg: cfg}
}

// ListPanes returns all panes across all tmux sessions
func (c *Client) ListPanes() ([]Pane, error) {
	format := "#{pane_id}\t#{pane_pid}\t#{session_name}\t#{window_name}\t#{window_index}\t#{pane_index}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_title}\t#{@ac_provider}"

	args := []string{"list-panes", "-a", "-F", format}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		outputStr := strings.TrimSpace(string(output))
		// No tmux server running is not an error
		if strings.Contains(strings.ToLower(outputStr), "no server running") {
			return nil, nil
		}
		if outputStr != "" {
			return nil, fmt.Errorf("failed to list panes: %w: %s", err, outputStr)
		}
		return nil, fmt.Errorf("failed to list panes: %w", err)
	}

	var panes []Pane
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		fields := strings.Split(line, "\t")
		if len(fields) < 8 {
			continue
		}

		var pane Pane
		pane.PaneID = fields[0]
		fmt.Sscanf(fields[1], "%d", &pane.PanePID)
		pane.SessionName = fields[2]
		pane.WindowName = fields[3]
		fmt.Sscanf(fields[4], "%d", &pane.WindowIndex)
		fmt.Sscanf(fields[5], "%d", &pane.PaneIndex)
		pane.CurrentPath = fields[6]
		pane.CurrentCommand = fields[7]
		if len(fields) > 8 {
			pane.PaneTitle = fields[8]
		}
		if len(fields) > 9 {
			pane.ProviderOverride = fields[9]
		}

		panes = append(panes, pane)
	}

	return panes, scanner.Err()
}

// GetPaneOption retrieves a pane option value
func (c *Client) GetPaneOption(paneID, option string) (string, error) {
	args := []string{"display-message", "-p", "-t", paneID, fmt.Sprintf("#{%s}", option)}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get pane option: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

// SetPaneOption sets a pane option value
func (c *Client) SetPaneOption(paneID, option, value string) error {
	args := []string{"set-option", "-p", "-t", paneID, option, value}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

// CapturePane captures the content of a pane
func (c *Client) CapturePane(paneID string, lines int) (string, string, error) {
	startLine := fmt.Sprintf("-%d", lines)
	args := []string{"capture-pane", "-p", "-e", "-t", paneID, "-S", startLine}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	output, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("failed to capture pane: %w", err)
	}

	text := string(output)
	// Truncate if too large
	if len(text) > c.cfg.SnapshotMaxBytes {
		text = text[len(text)-c.cfg.SnapshotMaxBytes:]
	}

	// Calculate hash
	hash := sha256.Sum256([]byte(text))
	hashStr := "sha256:" + hex.EncodeToString(hash[:])

	return text, hashStr, nil
}

// CapturePaneMode represents the capture mode for CapturePaneRange
type CapturePaneMode string

const (
	CaptureModeVisible CapturePaneMode = "visible"
	CaptureModeLastN   CapturePaneMode = "last_n"
	CaptureModeRange   CapturePaneMode = "range"
	CaptureModeFull    CapturePaneMode = "full"
)

// CapturePaneOptions configures the pane capture behavior
type CapturePaneOptions struct {
	Mode       CapturePaneMode
	LineStart  int
	LineEnd    int
	LastNLines int
	StripANSI  bool
}

// CapturePaneRange captures pane content with configurable line selection
func (c *Client) CapturePaneRange(paneID string, opts CapturePaneOptions) (string, error) {
	var args []string

	switch opts.Mode {
	case CaptureModeVisible:
		// Capture just the visible portion (default tmux behavior)
		args = []string{"capture-pane", "-t", paneID, "-p"}
	case CaptureModeFull:
		// Capture entire scrollback history
		args = []string{"capture-pane", "-t", paneID, "-p", "-S", "-"}
	case CaptureModeLastN:
		// Capture last N lines
		startLine := fmt.Sprintf("-%d", opts.LastNLines)
		args = []string{"capture-pane", "-t", paneID, "-p", "-S", startLine}
	case CaptureModeRange:
		// Capture specific line range
		args = []string{
			"capture-pane", "-t", paneID, "-p",
			"-S", fmt.Sprintf("%d", opts.LineStart),
			"-E", fmt.Sprintf("%d", opts.LineEnd),
		}
	default:
		args = []string{"capture-pane", "-t", paneID, "-p"}
	}

	// Include ANSI escape sequences unless strip_ansi is requested
	if !opts.StripANSI {
		args = append(args, "-e")
	}

	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to capture pane: %w", err)
	}

	result := string(output)
	if opts.Mode == CaptureModeLastN && opts.LastNLines > 0 {
		result = trimToLastNLines(result, opts.LastNLines)
	}

	return result, nil
}

func trimToLastNLines(text string, n int) string {
	if n <= 0 || text == "" {
		return text
	}

	trimmed := strings.TrimRight(text, "\n")
	lines := strings.Split(trimmed, "\n")
	if len(lines) <= n {
		return trimmed
	}
	return strings.Join(lines[len(lines)-n:], "\n")
}

// SendInput sends text to a pane using load-buffer and paste-buffer.
// Uses a unique buffer name to avoid collisions with concurrent sends.
func (c *Client) SendInput(paneID, text string, enter bool) error {
	bufferName := fmt.Sprintf("acbuf_%d", time.Now().UnixNano())
	return c.sendInputWithBuffer(paneID, text, enter, bufferName)
}

// SendInputChunked sends input in chunks with a short delay between chunks.
// This is safer for interactive TUIs that misbehave on large pastes.
func (c *Client) SendInputChunked(paneID, text string, enter bool, chunkSize int, delay time.Duration) error {
	if chunkSize <= 0 {
		return fmt.Errorf("chunkSize must be > 0")
	}

	chunks := splitIntoChunks(text, chunkSize)
	for i, chunk := range chunks {
		isLast := i == len(chunks)-1
		bufferName := fmt.Sprintf("acbuf_%d_%d", time.Now().UnixNano(), i)
		if err := c.sendInputWithBuffer(paneID, chunk, enter && isLast, bufferName); err != nil {
			return err
		}
		if !isLast && delay > 0 {
			time.Sleep(delay)
		}
	}
	return nil
}

func (c *Client) sendInputWithBuffer(paneID, text string, enter bool, bufferName string) error {
	// Load text into buffer
	loadArgs := []string{"load-buffer", "-b", bufferName, "-"}
	if c.cfg.Socket != "" {
		loadArgs = append([]string{"-S", c.cfg.Socket}, loadArgs...)
	}

	loadCmd := exec.Command(c.cfg.Bin, loadArgs...)
	loadCmd.Stdin = strings.NewReader(text)
	if err := loadCmd.Run(); err != nil {
		return fmt.Errorf("failed to load buffer: %w", err)
	}

	// Paste buffer to pane
	pasteArgs := []string{"paste-buffer", "-t", paneID, "-b", bufferName}
	if c.cfg.Socket != "" {
		pasteArgs = append([]string{"-S", c.cfg.Socket}, pasteArgs...)
	}

	pasteCmd := exec.Command(c.cfg.Bin, pasteArgs...)
	if err := pasteCmd.Run(); err != nil {
		_ = c.deleteBuffer(bufferName)
		return fmt.Errorf("failed to paste buffer: %w", err)
	}

	_ = c.deleteBuffer(bufferName)

	// Send Enter if requested
	if enter {
		return c.SendKeys(paneID, []string{"Enter"})
	}

	return nil
}

func (c *Client) deleteBuffer(bufferName string) error {
	args := []string{"delete-buffer", "-b", bufferName}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}
	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

func splitIntoChunks(text string, chunkSize int) []string {
	if text == "" {
		return []string{""}
	}

	runes := []rune(text)
	if len(runes) <= chunkSize {
		return []string{text}
	}

	chunks := make([]string, 0, (len(runes)/chunkSize)+1)
	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[i:end]))
	}
	return chunks
}

// SendKeysRaw sends literal bytes to a pane using tmux send-keys -l.
// This preserves escape sequences and behaves like real keystrokes.
func (c *Client) SendKeysRaw(paneID, data string) error {
	args := []string{"send-keys", "-t", paneID, "-l", "--", data}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

// SendKeys sends keys to a pane
func (c *Client) SendKeys(paneID string, keys []string) error {
	args := []string{"send-keys", "-t", paneID}
	args = append(args, keys...)
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

// SendInterrupt sends Ctrl-C to a pane
func (c *Client) SendInterrupt(paneID string) error {
	return c.SendKeys(paneID, []string{"C-c"})
}

// KillPane kills a pane
func (c *Client) KillPane(paneID string) error {
	args := []string{"kill-pane", "-t", paneID}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

// HasSession checks if a tmux session exists
func (c *Client) HasSession(name string) bool {
	args := []string{"has-session", "-t", name}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run() == nil
}

// NewSession creates a new tmux session
func (c *Client) NewSession(name string) error {
	args := []string{"new-session", "-d", "-s", name}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

// NewWindow creates a new window in a session
func (c *Client) NewWindow(session, windowName, startDir string) (string, error) {
	args := []string{"new-window", "-t", session, "-n", windowName, "-c", startDir, "-P", "-F", "#{pane_id}"}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to create window: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

// StartPipePane starts pipe-pane output to a file
func (c *Client) StartPipePane(paneID, logPath string) error {
	pipeCmd := fmt.Sprintf("cat >> %s", logPath)
	args := []string{"pipe-pane", "-o", "-t", paneID, pipeCmd}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

// SetPipePaneCmd replaces the pipe-pane command for a pane.
func (c *Client) SetPipePaneCmd(paneID, cmd string) error {
	args := []string{"pipe-pane", "-t", paneID, cmd}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	command := exec.Command(c.cfg.Bin, args...)
	return command.Run()
}

// StopPipePane stops pipe-pane output
func (c *Client) StopPipePane(paneID string) error {
	args := []string{"pipe-pane", "-t", paneID}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	return cmd.Run()
}

// GetTmuxTarget builds the tmux target string (session:window.pane)
func (p *Pane) GetTmuxTarget() string {
	return fmt.Sprintf("%s:%d.%d", p.SessionName, p.WindowIndex, p.PaneIndex)
}
