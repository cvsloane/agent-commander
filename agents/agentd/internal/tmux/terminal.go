package tmux

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// TerminalHandler processes terminal output
// Output is broadcast to every attached channel for a pane.
type TerminalHandler func(channelID string, data []byte)

// paneBridge provides terminal output for a tmux pane via FIFO (legacy mode).
// and multiplexes output to attached channels.
//
// One bridge exists per pane ID.
type paneBridge struct {
	paneID   string
	fifoPath string
	pipe     *os.File
	channels map[string]struct{}
	done     chan struct{}
	mu       sync.RWMutex
	closed   bool
}

// TerminalManager manages multiple terminal bridges
// (one bridge per pane, multiple channels per bridge).
// Supports both PTY mode (preferred) and FIFO mode (fallback).
type TerminalManager struct {
	client        *Client
	bridges       map[string]*paneBridge  // paneID -> FIFO bridge (legacy)
	ptyBridges    map[string]*ptyBridge   // paneID -> PTY bridge (preferred)
	channelToPane map[string]string       // channelID -> paneID
	channelToPTY  map[string]bool         // channelID -> true if using PTY mode
	channelReadOnly map[string]bool       // channelID -> read-only mode
	paneController  map[string]string     // paneID -> channelID with control
	mu            sync.RWMutex
	baseDir       string
	usePTYMode    bool // Default to PTY mode
	onOutput      TerminalHandler
	onStatus      func(channelID string, status string, message string)
}

// NewTerminalManager creates a new terminal manager
func NewTerminalManager(client *Client, baseDir string) *TerminalManager {
	dir := filepath.Join(baseDir, "terminals")
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("Failed to create terminal dir: %v", err)
	}

	return &TerminalManager{
		client:        client,
		bridges:       make(map[string]*paneBridge),
		ptyBridges:    make(map[string]*ptyBridge),
		channelToPane: make(map[string]string),
		channelToPTY:  make(map[string]bool),
		channelReadOnly: make(map[string]bool),
		paneController:  make(map[string]string),
		baseDir:       dir,
		usePTYMode:    true, // Default to PTY mode
	}
}

// SetPTYMode enables or disables PTY mode (PTY is preferred by default)
func (m *TerminalManager) SetPTYMode(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usePTYMode = enabled
}

// SetOutputHandler sets the handler for terminal output
func (m *TerminalManager) SetOutputHandler(handler TerminalHandler) {
	m.onOutput = handler
}

// SetStatusHandler sets the handler for terminal status changes
func (m *TerminalManager) SetStatusHandler(handler func(channelID, status, message string)) {
	m.onStatus = handler
}

// Attach creates or reuses a bridge for a pane and attaches a channel.
// In PTY mode, returns empty string for fifoPath (PTY doesn't need pipe-pane).
// Returns the fifo path (empty for PTY), a boolean indicating whether this is the first
// attachment for the pane (new bridge created), and whether PTY mode is being used.
func (m *TerminalManager) Attach(channelID, paneID, _sessionID string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Channel already attached
	if _, exists := m.channelToPane[channelID]; exists {
		return "", false, fmt.Errorf("channel %s already attached", channelID)
	}

	// If a bridge already exists for this pane, reuse its mode
	if _, ok := m.ptyBridges[paneID]; ok {
		return m.attachPTY(channelID, paneID)
	}
	if _, ok := m.bridges[paneID]; ok {
		return m.attachFIFO(channelID, paneID)
	}

	// Try PTY mode first if enabled
	if m.usePTYMode {
		fifoPath, first, err := m.attachPTY(channelID, paneID)
		if err == nil {
			return fifoPath, first, nil
		}
		log.Printf("PTY attach failed for pane %s, falling back to FIFO: %v", paneID, err)
		// Fall through to FIFO mode
	}

	return m.attachFIFO(channelID, paneID)
}

// attachPTY attaches a channel using PTY mode (preferred)
func (m *TerminalManager) attachPTY(channelID, paneID string) (string, bool, error) {
	bridge, exists := m.ptyBridges[paneID]
	first := false
	readonly := false
	controllerAssigned := false

	if controller, hasController := m.paneController[paneID]; hasController && controller != "" {
		readonly = true
	} else {
		m.paneController[paneID] = channelID
		controllerAssigned = true
	}

	if !exists {
		first = true
		var err error
		bridge, err = newPtyBridge(m.client, paneID, false)
		if err != nil {
			if controllerAssigned {
				delete(m.paneController, paneID)
			}
			return "", false, fmt.Errorf("failed to create PTY bridge: %w", err)
		}

		// Set up output and status handlers
		bridge.SetOutputHandler(m.onOutput)
		bridge.SetStatusHandler(m.onStatus)

		m.ptyBridges[paneID] = bridge
	}

	if err := bridge.AttachChannel(channelID, readonly); err != nil {
		if first {
			bridge.Close()
			delete(m.ptyBridges, paneID)
		}
		if m.paneController[paneID] == channelID {
			delete(m.paneController, paneID)
		}
		return "", false, fmt.Errorf("failed to attach channel to PTY bridge: %w", err)
	}

	m.channelToPane[channelID] = paneID
	m.channelToPTY[channelID] = true
	m.channelReadOnly[channelID] = readonly

	if m.onStatus != nil {
		m.onStatus(channelID, "attached", "")
		if readonly {
			m.onStatus(channelID, "readonly", "Read-only: another viewer has control")
		} else {
			m.onStatus(channelID, "control", "Control granted")
		}
	}

	log.Printf("Terminal attached (PTY mode): channel=%s pane=%s", channelID, paneID)
	return "", first, nil // Empty fifoPath for PTY mode
}

// attachFIFO attaches a channel using FIFO mode (legacy fallback)
func (m *TerminalManager) attachFIFO(channelID, paneID string) (string, bool, error) {
	bridge, exists := m.bridges[paneID]
	first := false
	readonly := false
	controllerAssigned := false

	if controller, hasController := m.paneController[paneID]; hasController && controller != "" {
		readonly = true
	} else {
		m.paneController[paneID] = channelID
		controllerAssigned = true
	}
	if !exists {
		first = true
		fifoPath := m.fifoPathForPane(paneID)

		// Remove any existing pipe
		_ = os.Remove(fifoPath)

		// Create FIFO
		if err := syscall.Mkfifo(fifoPath, 0600); err != nil {
			if controllerAssigned {
				delete(m.paneController, paneID)
			}
			return "", false, fmt.Errorf("failed to create pipe: %w", err)
		}

		bridge = &paneBridge{
			paneID:   paneID,
			fifoPath: fifoPath,
			channels: make(map[string]struct{}),
			done:     make(chan struct{}),
		}
		m.bridges[paneID] = bridge

		// Start reader goroutine
		go m.readLoop(bridge)
	}

	bridge.mu.Lock()
	bridge.channels[channelID] = struct{}{}
	bridge.mu.Unlock()
	m.channelToPane[channelID] = paneID
	m.channelToPTY[channelID] = false
	m.channelReadOnly[channelID] = readonly

	if m.onStatus != nil {
		m.onStatus(channelID, "attached", "")
		if readonly {
			m.onStatus(channelID, "readonly", "Read-only: another viewer has control")
		} else {
			m.onStatus(channelID, "control", "Control granted")
		}
	}

	log.Printf("Terminal attached (FIFO mode): channel=%s pane=%s", channelID, paneID)
	return bridge.fifoPath, first, nil
}

// Detach removes a channel. Returns paneID and whether it was the last channel.
func (m *TerminalManager) Detach(channelID string) (string, bool) {
	m.mu.Lock()
	paneID, exists := m.channelToPane[channelID]
	if !exists {
		m.mu.Unlock()
		return "", false
	}
	delete(m.channelToPane, channelID)

	isPTY := m.channelToPTY[channelID]
	delete(m.channelToPTY, channelID)
	delete(m.channelReadOnly, channelID)

	wasController := m.paneController[paneID] == channelID
	if wasController {
		delete(m.paneController, paneID)
	}

	// Handle PTY mode
	if isPTY {
		ptyBridge, ok := m.ptyBridges[paneID]
		if !ok {
			m.mu.Unlock()
			return paneID, false
		}

		last := ptyBridge.DetachChannel(channelID)
		if last {
			delete(m.ptyBridges, paneID)
		}
		m.mu.Unlock()

		if m.onStatus != nil {
			m.onStatus(channelID, "detached", "")
		}

		if last {
			ptyBridge.Close()
		}

		log.Printf("Terminal detached (PTY mode): channel=%s", channelID)
		if wasController {
			m.assignNextController(paneID, true)
		}
		return paneID, last
	}

	// Handle FIFO mode
	bridge, ok := m.bridges[paneID]
	if !ok {
		m.mu.Unlock()
		return paneID, false
	}

	bridge.mu.Lock()
	delete(bridge.channels, channelID)
	last := len(bridge.channels) == 0
	bridge.mu.Unlock()
	if last {
		delete(m.bridges, paneID)
	}
	m.mu.Unlock()

	if m.onStatus != nil {
		m.onStatus(channelID, "detached", "")
	}

	if last {
		bridge.Close()
		_ = os.Remove(bridge.fifoPath)
	}

	log.Printf("Terminal detached (FIFO mode): channel=%s", channelID)
	if wasController {
		m.assignNextController(paneID, false)
	}
	return paneID, last
}

// SendInput sends input to a terminal channel.
func (m *TerminalManager) SendInput(channelID string, data string) error {
	m.mu.RLock()
	paneID, exists := m.channelToPane[channelID]
	isPTY := m.channelToPTY[channelID]
	readOnly := m.channelReadOnly[channelID]
	var ptyBridge *ptyBridge
	if isPTY {
		ptyBridge = m.ptyBridges[paneID]
	}
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("channel %s not found", channelID)
	}
	if readOnly {
		return ErrReadOnly
	}

	// In PTY mode, write directly to the PTY
	if isPTY && ptyBridge != nil {
		return ptyBridge.Write([]byte(data))
	}

	// In FIFO mode, use send-keys (legacy behavior)
	return m.client.SendKeysRaw(paneID, data)
}

// TakeControl promotes the given channel to controller for its pane.
func (m *TerminalManager) TakeControl(channelID string) error {
	m.mu.Lock()
	paneID, exists := m.channelToPane[channelID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("channel %s not found", channelID)
	}

	current := m.paneController[paneID]
	if current == channelID {
		m.mu.Unlock()
		return nil
	}

	m.paneController[paneID] = channelID
	m.channelReadOnly[channelID] = false

	// Update other channels to read-only
	otherChannels := m.listPaneChannelsLocked(paneID, m.channelToPTY[channelID])
	for _, ch := range otherChannels {
		if ch == channelID {
			continue
		}
		m.channelReadOnly[ch] = true
	}
	m.mu.Unlock()

	if m.onStatus != nil {
		m.onStatus(channelID, "control", "Control granted")
		for _, ch := range otherChannels {
			if ch == channelID {
				continue
			}
			m.onStatus(ch, "readonly", "Read-only: another viewer has control")
		}
	}

	return nil
}

// ErrReadOnly indicates the channel is read-only and cannot send input.
var ErrReadOnly = errors.New("terminal is read-only")

// Resize sends resize signal to terminal
func (m *TerminalManager) Resize(channelID string, cols, rows int) error {
	m.mu.RLock()
	paneID, exists := m.channelToPane[channelID]
	isPTY := m.channelToPTY[channelID]
	var ptyBridge *ptyBridge
	if isPTY {
		ptyBridge = m.ptyBridges[paneID]
	}
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("channel %s not found", channelID)
	}

	// In PTY mode, resize the PTY (which propagates to tmux client)
	if isPTY && ptyBridge != nil {
		return ptyBridge.Resize(uint16(rows), uint16(cols))
	}

	// In FIFO mode, resize the pane directly (legacy behavior)
	return m.client.ResizePane(paneID, cols, rows)
}

// Close closes all bridges
func (m *TerminalManager) Close() {
	m.mu.RLock()
	channels := make([]string, 0, len(m.channelToPane))
	for ch := range m.channelToPane {
		channels = append(channels, ch)
	}
	m.mu.RUnlock()

	for _, ch := range channels {
		m.Detach(ch)
	}

	// Close any remaining PTY bridges
	m.mu.Lock()
	for paneID, bridge := range m.ptyBridges {
		bridge.Close()
		delete(m.ptyBridges, paneID)
	}
	m.mu.Unlock()
}

// IsPTYMode returns whether a channel is using PTY mode
func (m *TerminalManager) IsPTYMode(channelID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.channelToPTY[channelID]
}

func (m *TerminalManager) fifoPathForPane(paneID string) string {
	return filepath.Join(m.baseDir, "pane_"+paneID+".pipe")
}

func (m *TerminalManager) readLoop(bridge *paneBridge) {
	buf := make([]byte, 4096)

	for {
		if bridge.isClosed() {
			return
		}

		// Open FIFO for read/write so it doesn't block if writer isn't attached yet.
		// This avoids timing races between attach and pipe-pane setup.
		pipe, err := os.OpenFile(bridge.fifoPath, os.O_RDWR, 0)
		if err != nil {
			log.Printf("Failed to open pipe for pane %s: %v", bridge.paneID, err)
			m.broadcastStatus(bridge, "error", "Failed to open output pipe")
			return
		}

		bridge.mu.Lock()
		bridge.pipe = pipe
		bridge.mu.Unlock()

		reader := bufio.NewReader(pipe)

		for {
			if bridge.isClosed() {
				_ = pipe.Close()
				return
			}

			// Set read deadline to allow checking done channel.
			_ = pipe.SetReadDeadline(time.Now().Add(100 * time.Millisecond))

			n, err := reader.Read(buf)
			if err != nil {
				if os.IsTimeout(err) {
					continue
				}
				if err == io.EOF {
					// Writer closed; reopen to resume when writer reconnects.
					_ = pipe.Close()
					time.Sleep(100 * time.Millisecond)
					break
				}
				if errors.Is(err, os.ErrClosed) {
					// Pipe closed; reopen unless bridge is shutting down.
					time.Sleep(50 * time.Millisecond)
					break
				}
				log.Printf("Terminal read error: %v", err)
				_ = pipe.Close()
				break
			}

			if n > 0 && m.onOutput != nil {
				data := make([]byte, n)
				copy(data, buf[:n])

				channels := m.snapshotChannels(bridge)
				for _, ch := range channels {
					m.onOutput(ch, data)
				}
			}
		}
	}
}

func (m *TerminalManager) snapshotChannels(bridge *paneBridge) []string {
	bridge.mu.RLock()
	defer bridge.mu.RUnlock()

	channels := make([]string, 0, len(bridge.channels))
	for ch := range bridge.channels {
		channels = append(channels, ch)
	}
	return channels
}

func (m *TerminalManager) listPaneChannelsLocked(paneID string, isPTY bool) []string {
	if isPTY {
		if bridge, ok := m.ptyBridges[paneID]; ok {
			return bridge.listChannels()
		}
		return nil
	}

	if bridge, ok := m.bridges[paneID]; ok {
		return m.snapshotChannels(bridge)
	}
	return nil
}

func (m *TerminalManager) broadcastStatus(bridge *paneBridge, status, message string) {
	if m.onStatus == nil {
		return
	}
	for _, ch := range m.snapshotChannels(bridge) {
		m.onStatus(ch, status, message)
	}
}

func (m *TerminalManager) assignNextController(paneID string, isPTY bool) {
	m.mu.Lock()
	channels := m.listPaneChannelsLocked(paneID, isPTY)
	if len(channels) == 0 {
		m.mu.Unlock()
		return
	}
	newController := channels[0]
	m.paneController[paneID] = newController
	for _, ch := range channels {
		m.channelReadOnly[ch] = ch != newController
	}
	m.mu.Unlock()

	if m.onStatus != nil {
		m.onStatus(newController, "control", "Control granted")
		for _, ch := range channels {
			if ch == newController {
				continue
			}
			m.onStatus(ch, "readonly", "Read-only: another viewer has control")
		}
	}
}

// Close closes the terminal bridge
func (b *paneBridge) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.closed {
		return
	}
	b.closed = true

	close(b.done)

	if b.pipe != nil {
		_ = b.pipe.Close()
	}
}

func (b *paneBridge) isClosed() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.closed
}

// StartPipePaneCmd starts pipe-pane with a custom command
func (c *Client) StartPipePaneCmd(paneID, cmd string) error {
	args := []string{"pipe-pane", "-o", "-t", paneID, cmd}
	if c.cfg.Socket != "" {
		args = append([]string{"-S", c.cfg.Socket}, args...)
	}

	return runTmuxCommand(c.cfg.Bin, args)
}

// ResizePane resizes a tmux pane
func (c *Client) ResizePane(paneID string, cols, rows int) error {
	// First set the width
	argsX := []string{"resize-pane", "-t", paneID, "-x", fmt.Sprintf("%d", cols)}
	if c.cfg.Socket != "" {
		argsX = append([]string{"-S", c.cfg.Socket}, argsX...)
	}
	if err := runTmuxCommand(c.cfg.Bin, argsX); err != nil {
		return err
	}

	// Then set the height
	argsY := []string{"resize-pane", "-t", paneID, "-y", fmt.Sprintf("%d", rows)}
	if c.cfg.Socket != "" {
		argsY = append([]string{"-S", c.cfg.Socket}, argsY...)
	}
	return runTmuxCommand(c.cfg.Bin, argsY)
}

func runTmuxCommand(bin string, args []string) error {
	cmd := exec.Command(bin, args...)
	return cmd.Run()
}
