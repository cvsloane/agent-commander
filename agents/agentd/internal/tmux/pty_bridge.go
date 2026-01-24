package tmux

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"github.com/creack/pty"
)

// ptyBridge provides terminal access via a PTY-attached tmux session.
// This approach gives proper terminal semantics: input echo, cursor handling,
// line editing, and signal propagation (Ctrl+C, etc.).
type ptyBridge struct {
	sessionName string
	paneID      string
	ptmx        *os.File
	cmd         *exec.Cmd
	channels    map[string]*ptyChannel
	channelsMu  sync.RWMutex
	closeOnce   sync.Once
	closed      chan struct{}
	onOutput    func(channelID string, data []byte)
	onStatus    func(channelID string, status string, message string)
}

// ptyChannel represents a single viewer attached to a PTY bridge.
type ptyChannel struct {
	id       string
	readonly bool
}

// newPtyBridge creates a new PTY-based terminal bridge for a tmux pane.
// It attaches to the tmux session containing the pane via a real PTY,
// providing full terminal semantics.
func newPtyBridge(client *Client, paneID string, readonly bool) (*ptyBridge, error) {
	// Get the session name from the pane ID
	sessionName, err := client.GetSessionName(paneID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session name for pane %s: %w", paneID, err)
	}

	// Build tmux attach command with pane selection
	// Attach and select the pane in the same client context to avoid stealing focus
	var args []string
	if client.cfg.Socket != "" {
		args = append(args, "-S", client.cfg.Socket)
	}

	if readonly {
		args = append(args, "attach-session", "-r", "-t", sessionName)
	} else {
		args = append(args, "attach-session", "-t", sessionName)
	}
	args = append(args, ";", "select-pane", "-t", paneID)

	cmd := exec.Command(client.cfg.Bin, args...)
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"LANG=en_US.UTF-8",
		"LC_CTYPE=en_US.UTF-8",
	)

	// Start tmux attach with PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to start tmux attach with PTY: %w", err)
	}

	// Set initial terminal size
	_ = pty.Setsize(ptmx, &pty.Winsize{Rows: 24, Cols: 80})

	bridge := &ptyBridge{
		sessionName: sessionName,
		paneID:      paneID,
		ptmx:        ptmx,
		cmd:         cmd,
		channels:    make(map[string]*ptyChannel),
		closed:      make(chan struct{}),
	}

	// Start read loop
	go bridge.readLoop()

	// Monitor for process exit
	go bridge.waitForExit()

	return bridge, nil
}

// SetOutputHandler sets the callback for terminal output
func (b *ptyBridge) SetOutputHandler(handler func(channelID string, data []byte)) {
	b.onOutput = handler
}

// SetStatusHandler sets the callback for status changes
func (b *ptyBridge) SetStatusHandler(handler func(channelID, status, message string)) {
	b.onStatus = handler
}

// AttachChannel adds a viewer channel to this bridge
func (b *ptyBridge) AttachChannel(channelID string, readonly bool) error {
	b.channelsMu.Lock()
	defer b.channelsMu.Unlock()

	if _, exists := b.channels[channelID]; exists {
		return fmt.Errorf("channel %s already attached", channelID)
	}

	b.channels[channelID] = &ptyChannel{
		id:       channelID,
		readonly: readonly,
	}

	return nil
}

// DetachChannel removes a viewer channel from this bridge
// Returns true if this was the last channel (bridge should be closed)
func (b *ptyBridge) DetachChannel(channelID string) bool {
	b.channelsMu.Lock()
	defer b.channelsMu.Unlock()

	delete(b.channels, channelID)
	return len(b.channels) == 0
}

// HasChannels returns whether any channels are attached
func (b *ptyBridge) HasChannels() bool {
	b.channelsMu.RLock()
	defer b.channelsMu.RUnlock()
	return len(b.channels) > 0
}

// ChannelCount returns the number of attached channels
func (b *ptyBridge) ChannelCount() int {
	b.channelsMu.RLock()
	defer b.channelsMu.RUnlock()
	return len(b.channels)
}

// listChannels returns a snapshot of attached channel IDs.
func (b *ptyBridge) listChannels() []string {
	b.channelsMu.RLock()
	defer b.channelsMu.RUnlock()

	channels := make([]string, 0, len(b.channels))
	for id := range b.channels {
		channels = append(channels, id)
	}
	return channels
}

// Write sends input to the PTY (and thus to tmux/the shell)
func (b *ptyBridge) Write(data []byte) error {
	select {
	case <-b.closed:
		return fmt.Errorf("bridge is closed")
	default:
	}

	_, err := b.ptmx.Write(data)
	return err
}

// Resize changes the PTY window size
func (b *ptyBridge) Resize(rows, cols uint16) error {
	select {
	case <-b.closed:
		return fmt.Errorf("bridge is closed")
	default:
	}

	return pty.Setsize(b.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

// Close shuts down the PTY bridge
func (b *ptyBridge) Close() {
	b.closeOnce.Do(func() {
		close(b.closed)

		// Close PTY (this will cause tmux to detach)
		if b.ptmx != nil {
			_ = b.ptmx.Close()
		}

		// Kill the process if still running
		if b.cmd != nil && b.cmd.Process != nil {
			_ = b.cmd.Process.Kill()
		}

		// Notify all channels
		b.channelsMu.RLock()
		channels := make([]string, 0, len(b.channels))
		for id := range b.channels {
			channels = append(channels, id)
		}
		b.channelsMu.RUnlock()

		for _, ch := range channels {
			if b.onStatus != nil {
				b.onStatus(ch, "detached", "PTY bridge closed")
			}
		}
	})
}

// IsClosed returns whether the bridge is closed
func (b *ptyBridge) IsClosed() bool {
	select {
	case <-b.closed:
		return true
	default:
		return false
	}
}

// readLoop continuously reads from the PTY and broadcasts to all channels
func (b *ptyBridge) readLoop() {
	buf := make([]byte, 4096)

	for {
		select {
		case <-b.closed:
			return
		default:
		}

		n, err := b.ptmx.Read(buf)
		if err != nil {
			if err != io.EOF {
				select {
				case <-b.closed:
					// Expected during shutdown
				default:
					log.Printf("PTY read error for pane %s: %v", b.paneID, err)
				}
			}
			b.Close()
			return
		}

		if n > 0 {
			b.broadcast(buf[:n])
		}
	}
}

// broadcast sends data to all attached channels
func (b *ptyBridge) broadcast(data []byte) {
	if b.onOutput == nil {
		return
	}

	// Make a copy of channel IDs to avoid holding the lock during callbacks
	b.channelsMu.RLock()
	channels := make([]string, 0, len(b.channels))
	for id := range b.channels {
		channels = append(channels, id)
	}
	b.channelsMu.RUnlock()

	// Make a copy of the data for each channel
	for _, ch := range channels {
		dataCopy := make([]byte, len(data))
		copy(dataCopy, data)
		b.onOutput(ch, dataCopy)
	}
}

// waitForExit monitors the tmux attach process and cleans up when it exits
func (b *ptyBridge) waitForExit() {
	if b.cmd == nil {
		return
	}

	err := b.cmd.Wait()
	select {
	case <-b.closed:
		// Already closing, ignore
	default:
		if err != nil {
			log.Printf("tmux attach process exited with error for pane %s: %v", b.paneID, err)
		} else {
			log.Printf("tmux attach process exited normally for pane %s", b.paneID)
		}
		b.Close()
	}
}

// GetSessionName extracts the tmux session name from a pane ID
func (c *Client) GetSessionName(paneID string) (string, error) {
	args := []string{"display-message", "-p", "-t", paneID, "#{session_name}"}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	cmd := exec.Command(c.cfg.Bin, args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get session name: %w", err)
	}

	sessionName := string(output)
	// Trim trailing newline
	if len(sessionName) > 0 && sessionName[len(sessionName)-1] == '\n' {
		sessionName = sessionName[:len(sessionName)-1]
	}

	if sessionName == "" {
		return "", fmt.Errorf("empty session name for pane %s", paneID)
	}

	return sessionName, nil
}
