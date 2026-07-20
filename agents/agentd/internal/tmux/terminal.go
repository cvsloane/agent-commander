package tmux

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
)

// TerminalHandler processes base64-encoded terminal output.
// Output is broadcast to every attached channel for a pane.
type TerminalHandler func(channelID string, encodedData string)

// paneBridge provides terminal output for a tmux pane via FIFO (legacy mode).
// and multiplexes output to attached channels.
//
// One bridge exists per pane ID.
type paneBridge struct {
	paneID   string
	fifoPath string
	pipe     *os.File
	channels map[string]*terminalOutputChannel
	done     chan struct{}
	mu       sync.RWMutex
	closed   bool
}

// TerminalManager manages multiple terminal bridges
// (one bridge per pane, multiple channels per bridge).
// Supports both PTY mode (preferred) and FIFO mode (fallback).
type TerminalManager struct {
	client           *Client
	runner           TmuxRunner
	bridges          map[string]*paneBridge // paneID -> FIFO bridge (legacy)
	ptyBridges       map[string]*ptyBridge  // paneID -> shared PTY bridge (legacy)
	viewerByChannel  map[string]*terminalViewer
	viewerByToken    map[string]*terminalViewer
	channelToPane    map[string]string // channelID -> paneID
	channelSession   map[string]string
	channelToPTY     map[string]bool // channelID -> true if using PTY mode
	channelPerViewer map[string]bool
	channelReadOnly  map[string]bool   // channelID -> read-only mode
	paneController   map[string]string // paneID -> channelID with control
	mu               sync.RWMutex
	baseDir          string
	usePTYMode       bool // Default to PTY mode
	perViewerPTY     bool
	viewerTTL        time.Duration
	sweepInterval    time.Duration
	sweepStop        chan struct{}
	startOnce        sync.Once
	lifecycleClose   sync.Once
	onOutput         TerminalHandler
	onStatus         func(channelID string, status string, message string)
	onAudit          func(TerminalAuditEvent)
}

// TerminalAuditEvent is emitted for security-relevant viewer lifecycle changes.
type TerminalAuditEvent struct {
	Action                      string
	ChannelID                   string
	SessionID                   string
	PaneID                      string
	PreviousControllerChannelID string
}

type terminalViewer struct {
	channelID   string
	paneID      string
	sessionID   string
	resumeToken string
	readOnly    bool
	letterbox   bool
	bridge      *viewerPTYBridge
	detachedAt  time.Time
	stale       bool
	staleAt     time.Time
}

// AttachOptions contains additive terminal.attach fields.
type AttachOptions struct {
	SessionID   string
	Cols        int
	Rows        int
	ResumeToken string
	Letterbox   bool
}

// AttachResult describes the selected terminal transport and viewer role.
type AttachResult struct {
	FIFOPath    string
	First       bool
	PTY         bool
	ReadOnly    bool
	ResumeToken string
	Resumed     bool
}

// NewTerminalManager creates a new terminal manager
func NewTerminalManager(client *Client, baseDir string) *TerminalManager {
	return newTerminalManagerWithRunner(client, newExecTmuxRunner(client), baseDir)
}

func newTerminalManagerWithRunner(client *Client, runner TmuxRunner, baseDir string) *TerminalManager {
	dir := filepath.Join(baseDir, "terminals")
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("Failed to create terminal dir: %v", err)
	}

	return &TerminalManager{
		client:           client,
		runner:           runner,
		bridges:          make(map[string]*paneBridge),
		ptyBridges:       make(map[string]*ptyBridge),
		viewerByChannel:  make(map[string]*terminalViewer),
		viewerByToken:    make(map[string]*terminalViewer),
		channelToPane:    make(map[string]string),
		channelSession:   make(map[string]string),
		channelToPTY:     make(map[string]bool),
		channelPerViewer: make(map[string]bool),
		channelReadOnly:  make(map[string]bool),
		paneController:   make(map[string]string),
		baseDir:          dir,
		usePTYMode:       true, // Default to PTY mode
		perViewerPTY:     true,
		viewerTTL:        30 * time.Second,
		sweepInterval:    15 * time.Second,
		sweepStop:        make(chan struct{}),
	}
}

// SetPTYMode enables or disables PTY mode (PTY is preferred by default)
func (m *TerminalManager) SetPTYMode(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usePTYMode = enabled
}

// SetPerViewerPTY selects isolated grouped-session PTYs instead of the legacy
// shared PTY bridge.
func (m *TerminalManager) SetPerViewerPTY(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.perViewerPTY = enabled
}

// Start performs crash cleanup and starts the terminal lifecycle sweeper.
func (m *TerminalManager) Start() {
	m.startOnce.Do(func() {
		m.Sweep(time.Now())
		go func() {
			ticker := time.NewTicker(m.sweepInterval)
			defer ticker.Stop()
			for {
				select {
				case now := <-ticker.C:
					m.Sweep(now)
				case <-m.sweepStop:
					return
				}
			}
		}()
	})
}

// Sweep removes orphan grouped sessions and expires detached or stale viewer bridges.
func (m *TerminalManager) Sweep(now time.Time) {
	var expiredBridges []*viewerPTYBridge
	m.mu.Lock()
	for token, viewer := range m.viewerByToken {
		detachedExpired := viewer.channelID == "" && !viewer.detachedAt.IsZero() && now.Sub(viewer.detachedAt) >= m.viewerTTL
		staleExpired := viewer.stale && !viewer.staleAt.IsZero() && now.Sub(viewer.staleAt) >= m.viewerTTL
		if !detachedExpired && !staleExpired {
			continue
		}

		delete(m.viewerByToken, token)
		if viewer.channelID != "" {
			channelID := viewer.channelID
			delete(m.viewerByChannel, channelID)
			delete(m.channelToPane, channelID)
			delete(m.channelSession, channelID)
			delete(m.channelToPTY, channelID)
			delete(m.channelPerViewer, channelID)
			delete(m.channelReadOnly, channelID)
			if m.paneController[viewer.paneID] == channelID {
				delete(m.paneController, viewer.paneID)
			}
		}
		if viewer.bridge != nil {
			expiredBridges = append(expiredBridges, viewer.bridge)
			viewer.bridge = nil
		}
		viewer.channelID = ""
		viewer.detachedAt = time.Time{}
		viewer.stale = false
		viewer.staleAt = time.Time{}
	}
	m.mu.Unlock()

	for _, bridge := range expiredBridges {
		bridge.close(true)
	}
	m.sweepOrphanViewerSessions()
}

func (m *TerminalManager) sweepOrphanViewerSessions() {
	output, err := m.runner.Output("list-sessions", "-F", "#{session_name}")
	if err != nil {
		return
	}
	for _, name := range strings.Fields(string(output)) {
		if !strings.HasPrefix(name, viewerSessionPrefix) {
			continue
		}
		m.mu.RLock()
		owned := false
		for _, viewer := range m.viewerByToken {
			if viewer.bridge != nil && viewer.bridge.viewSession == name {
				owned = true
				break
			}
		}
		m.mu.RUnlock()
		if owned {
			continue
		}
		if err := m.runner.Run("kill-session", "-t", name); err != nil {
			log.Printf("Failed to reap orphan terminal viewer session %s: %v", name, err)
		}
	}
}

// SetOutputHandler sets the handler for terminal output
func (m *TerminalManager) SetOutputHandler(handler TerminalHandler) {
	m.onOutput = handler
}

// SetStatusHandler sets the handler for terminal status changes
func (m *TerminalManager) SetStatusHandler(handler func(channelID, status, message string)) {
	m.onStatus = handler
}

// SetAuditHandler sets the handler for terminal attach, detach, and control events.
func (m *TerminalManager) SetAuditHandler(handler func(TerminalAuditEvent)) {
	m.onAudit = handler
}

// MarkChannelsStale records that the control-plane connection owning the
// current channel IDs is gone. A valid resume attach may then supersede its
// prior channel without allowing an active connection to steal the token.
func (m *TerminalManager) MarkChannelsStale() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for _, viewer := range m.viewerByChannel {
		if viewer.stale {
			continue
		}
		viewer.stale = true
		viewer.staleAt = now
	}
}

// Attach creates or reuses a bridge for a pane and attaches a channel.
// In PTY mode, returns empty string for fifoPath (PTY doesn't need pipe-pane).
// Returns the fifo path (empty for PTY), a boolean indicating whether this is the first
// attachment for the pane (new bridge created), and whether PTY mode is being used.
func (m *TerminalManager) Attach(channelID, paneID, _sessionID string) (string, bool, error) {
	result, err := m.AttachWithOptions(channelID, paneID, AttachOptions{SessionID: _sessionID})
	return result.FIFOPath, result.First, err
}

// AttachWithOptions creates a terminal viewer with its requested initial size.
func (m *TerminalManager) AttachWithOptions(channelID, paneID string, opts AttachOptions) (AttachResult, error) {
	if opts.Cols < 0 || opts.Cols > 65535 || opts.Rows < 0 || opts.Rows > 65535 {
		return AttachResult{}, fmt.Errorf("terminal size is out of range: cols=%d rows=%d", opts.Cols, opts.Rows)
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	// Channel already attached
	if _, exists := m.channelToPane[channelID]; exists {
		return AttachResult{}, fmt.Errorf("channel %s already attached", channelID)
	}

	if m.usePTYMode && m.perViewerPTY {
		return m.attachViewerPTY(channelID, paneID, opts)
	}

	// If a bridge already exists for this pane, reuse its mode
	if _, ok := m.ptyBridges[paneID]; ok {
		fifoPath, first, err := m.attachPTY(channelID, paneID)
		if err == nil {
			m.channelSession[channelID] = opts.SessionID
			m.emitAudit(TerminalAuditEvent{Action: "attach", ChannelID: channelID, SessionID: opts.SessionID, PaneID: paneID})
		}
		return AttachResult{FIFOPath: fifoPath, First: first, PTY: true, ReadOnly: m.channelReadOnly[channelID]}, err
	}
	if _, ok := m.bridges[paneID]; ok {
		fifoPath, first, err := m.attachFIFO(channelID, paneID)
		if err == nil {
			m.channelSession[channelID] = opts.SessionID
			m.emitAudit(TerminalAuditEvent{Action: "attach", ChannelID: channelID, SessionID: opts.SessionID, PaneID: paneID})
		}
		return AttachResult{FIFOPath: fifoPath, First: first, PTY: false, ReadOnly: m.channelReadOnly[channelID]}, err
	}

	// Try PTY mode first if enabled
	if m.usePTYMode {
		fifoPath, first, err := m.attachPTY(channelID, paneID)
		if err == nil {
			m.channelSession[channelID] = opts.SessionID
			m.emitAudit(TerminalAuditEvent{Action: "attach", ChannelID: channelID, SessionID: opts.SessionID, PaneID: paneID})
			return AttachResult{FIFOPath: fifoPath, First: first, PTY: true, ReadOnly: m.channelReadOnly[channelID]}, nil
		}
		log.Printf("PTY attach failed for pane %s, falling back to FIFO: %v", paneID, err)
		// Fall through to FIFO mode
	}

	fifoPath, first, err := m.attachFIFO(channelID, paneID)
	if err == nil {
		m.channelSession[channelID] = opts.SessionID
		m.emitAudit(TerminalAuditEvent{Action: "attach", ChannelID: channelID, SessionID: opts.SessionID, PaneID: paneID})
	}
	return AttachResult{FIFOPath: fifoPath, First: first, PTY: false, ReadOnly: m.channelReadOnly[channelID]}, err
}

func (m *TerminalManager) attachViewerPTY(channelID, paneID string, opts AttachOptions) (AttachResult, error) {
	resumed := opts.ResumeToken != ""
	var previous *terminalViewer
	if resumed {
		previous = m.viewerByToken[opts.ResumeToken]
		if previous != nil {
			if previous.paneID != paneID || (previous.sessionID != "" && opts.SessionID != "" && previous.sessionID != opts.SessionID) {
				return AttachResult{}, fmt.Errorf("resume token does not match terminal target")
			}
			if previous.channelID != "" && !previous.stale {
				return AttachResult{}, fmt.Errorf("resume token is already attached")
			}
		} else {
			stored, err := m.runner.Output("show-options", "-p", "-v", "-t", paneID, resumeOptionName(opts.ResumeToken))
			if err != nil || strings.TrimSpace(string(stored)) != opts.ResumeToken {
				return AttachResult{}, fmt.Errorf("invalid terminal resume token")
			}
		}
	}
	var initialOutput []byte
	if resumed {
		capture, err := m.runner.Output("capture-pane", "-p", "-e", "-t", paneID)
		if err != nil {
			return AttachResult{}, fmt.Errorf("capture pane for terminal resume: %w", err)
		}
		initialOutput = capture
	}
	if previous != nil && previous.channelID != "" {
		m.supersedeStaleViewerLocked(previous)
	}
	if controllerID := m.paneController[paneID]; controllerID != "" {
		if controller := m.viewerByChannel[controllerID]; controller != nil && controller.stale {
			delete(m.paneController, paneID)
		}
	}

	readonly := m.paneController[paneID] != ""
	if !readonly {
		m.paneController[paneID] = channelID
	}
	resumeToken := opts.ResumeToken
	if resumeToken == "" {
		resumeToken = uuid.NewString()
	}
	if previous != nil && previous.bridge != nil && previous.bridge.viewSession == viewerSessionName(channelID) {
		previous.bridge.close(false)
		previous.bridge = nil
	}
	bridge, err := newViewerPTYBridge(m.runner, viewerPTYOptions{
		ChannelID:     channelID,
		PaneID:        paneID,
		ReadOnly:      readonly,
		Cols:          uint16(opts.Cols),
		Rows:          uint16(opts.Rows),
		Letterbox:     opts.Letterbox,
		ResumeToken:   resumeToken,
		InitialOutput: initialOutput,
		OnOutput:      m.onOutput,
		OnStatus:      m.onStatus,
	})
	if err != nil {
		if m.paneController[paneID] == channelID {
			delete(m.paneController, paneID)
		}
		return AttachResult{}, err
	}
	viewer := previous
	if viewer == nil {
		viewer = &terminalViewer{}
	} else if viewer.bridge != nil {
		viewer.bridge.close(false)
	}
	viewer.channelID = channelID
	viewer.paneID = paneID
	viewer.sessionID = opts.SessionID
	viewer.resumeToken = resumeToken
	viewer.readOnly = readonly
	viewer.letterbox = opts.Letterbox
	viewer.bridge = bridge
	viewer.detachedAt = time.Time{}
	viewer.stale = false
	viewer.staleAt = time.Time{}
	m.viewerByChannel[channelID] = viewer
	m.viewerByToken[resumeToken] = viewer
	m.channelToPane[channelID] = paneID
	m.channelSession[channelID] = opts.SessionID
	m.channelToPTY[channelID] = true
	m.channelPerViewer[channelID] = true
	m.channelReadOnly[channelID] = readonly

	m.emitAudit(TerminalAuditEvent{Action: "attach", ChannelID: channelID, SessionID: opts.SessionID, PaneID: paneID})

	return AttachResult{First: true, PTY: true, ReadOnly: readonly, ResumeToken: resumeToken, Resumed: resumed}, nil
}

func (m *TerminalManager) supersedeStaleViewerLocked(viewer *terminalViewer) {
	channelID := viewer.channelID
	sessionID := viewer.sessionID
	paneID := viewer.paneID
	delete(m.viewerByChannel, channelID)
	delete(m.channelToPane, channelID)
	delete(m.channelSession, channelID)
	delete(m.channelToPTY, channelID)
	delete(m.channelPerViewer, channelID)
	delete(m.channelReadOnly, channelID)
	if m.paneController[viewer.paneID] == channelID {
		delete(m.paneController, viewer.paneID)
	}
	if viewer.bridge != nil {
		viewer.bridge.close(false)
		viewer.bridge = nil
	}
	viewer.channelID = ""
	viewer.detachedAt = time.Now()
	viewer.stale = false
	viewer.staleAt = time.Time{}
	m.emitAudit(TerminalAuditEvent{Action: "detach", ChannelID: channelID, SessionID: sessionID, PaneID: paneID})
}

func (m *TerminalManager) emitAudit(event TerminalAuditEvent) {
	if m.onAudit != nil {
		m.onAudit(event)
	}
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
			channels: make(map[string]*terminalOutputChannel),
			done:     make(chan struct{}),
		}
		m.bridges[paneID] = bridge

		// Start reader goroutine
		go m.readLoop(bridge)
	}

	bridge.mu.Lock()
	bridge.channels[channelID] = newTerminalOutputChannel(channelID, defaultTerminalBufferChunks, m.onOutput, func(channelID string, dropped int) {
		if m.onStatus != nil {
			m.onStatus(channelID, "lag", fmt.Sprintf("Dropped %d terminal output chunks", dropped))
		}
	})
	bridge.mu.Unlock()
	m.channelToPane[channelID] = paneID
	m.channelToPTY[channelID] = false
	m.channelReadOnly[channelID] = readonly

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
	sessionID := m.channelSession[channelID]
	delete(m.channelSession, channelID)

	isPTY := m.channelToPTY[channelID]
	delete(m.channelToPTY, channelID)
	delete(m.channelReadOnly, channelID)

	wasController := m.paneController[paneID] == channelID
	if wasController {
		delete(m.paneController, paneID)
	}

	if m.channelPerViewer[channelID] {
		viewer := m.viewerByChannel[channelID]
		delete(m.viewerByChannel, channelID)
		delete(m.channelPerViewer, channelID)
		viewer.channelID = ""
		viewer.detachedAt = time.Now()
		viewer.stale = false
		viewer.staleAt = time.Time{}
		bridge := viewer.bridge
		if viewer.letterbox {
			viewer.bridge = nil
		}
		m.mu.Unlock()

		bridge.DetachChannel(channelID)
		if viewer.letterbox {
			bridge.close(false)
		}
		if m.onStatus != nil {
			m.onStatus(channelID, "detached", "")
		}
		if wasController {
			m.assignNextViewerController(paneID)
		}
		m.emitAudit(TerminalAuditEvent{Action: "detach", ChannelID: channelID, SessionID: sessionID, PaneID: paneID})
		return paneID, true
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
		m.emitAudit(TerminalAuditEvent{Action: "detach", ChannelID: channelID, SessionID: sessionID, PaneID: paneID})
		return paneID, last
	}

	// Handle FIFO mode
	bridge, ok := m.bridges[paneID]
	if !ok {
		m.mu.Unlock()
		return paneID, false
	}

	bridge.mu.Lock()
	output := bridge.channels[channelID]
	delete(bridge.channels, channelID)
	last := len(bridge.channels) == 0
	bridge.mu.Unlock()
	if output != nil {
		output.Close()
	}
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
	m.emitAudit(TerminalAuditEvent{Action: "detach", ChannelID: channelID, SessionID: sessionID, PaneID: paneID})
	return paneID, last
}

// SendInput sends input to a terminal channel.
func (m *TerminalManager) SendInput(channelID string, data string) error {
	m.mu.RLock()
	paneID, exists := m.channelToPane[channelID]
	isPTY := m.channelToPTY[channelID]
	readOnly := m.channelReadOnly[channelID]
	viewer := m.viewerByChannel[channelID]
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
	if viewer != nil {
		return viewer.bridge.Write([]byte(data))
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
	sessionID := m.channelSession[channelID]
	if current == channelID {
		m.mu.Unlock()
		return nil
	}

	if target := m.viewerByChannel[channelID]; target != nil {
		currentViewer := m.viewerByChannel[current]
		if currentViewer != nil {
			if err := m.replaceViewerBridge(currentViewer, true); err != nil {
				delete(m.paneController, paneID)
				m.channelReadOnly[current] = true
				m.mu.Unlock()
				return fmt.Errorf("make previous controller read-only: %w", err)
			}
		}
		if err := m.replaceViewerBridge(target, false); err != nil {
			if currentViewer != nil {
				if restoreErr := m.replaceViewerBridge(currentViewer, false); restoreErr != nil {
					delete(m.paneController, paneID)
					m.channelReadOnly[current] = true
					m.mu.Unlock()
					return fmt.Errorf("make viewer controller: %v; restore previous controller: %w", err, restoreErr)
				}
			}
			m.mu.Unlock()
			return fmt.Errorf("make viewer controller: %w", err)
		}
		m.paneController[paneID] = channelID
		for id, viewer := range m.viewerByChannel {
			if viewer.paneID != paneID {
				continue
			}
			viewer.readOnly = id != channelID
			m.channelReadOnly[id] = viewer.readOnly
		}
		m.mu.Unlock()

		if m.onStatus != nil {
			m.onStatus(channelID, "control", "Control granted")
			if current != "" {
				m.onStatus(current, "readonly", "Read-only: another viewer has control")
			}
		}
		m.emitAudit(TerminalAuditEvent{
			Action:                      "control_transfer",
			ChannelID:                   channelID,
			SessionID:                   sessionID,
			PaneID:                      paneID,
			PreviousControllerChannelID: current,
		})
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
	m.emitAudit(TerminalAuditEvent{
		Action:                      "control_transfer",
		ChannelID:                   channelID,
		SessionID:                   sessionID,
		PaneID:                      paneID,
		PreviousControllerChannelID: current,
	})

	return nil
}

// ErrReadOnly indicates the channel is read-only and cannot send input.
var ErrReadOnly = errors.New("terminal is read-only")

// Resize sends resize signal to terminal
func (m *TerminalManager) Resize(channelID string, cols, rows int) error {
	m.mu.RLock()
	paneID, exists := m.channelToPane[channelID]
	isPTY := m.channelToPTY[channelID]
	viewer := m.viewerByChannel[channelID]
	var ptyBridge *ptyBridge
	if isPTY {
		ptyBridge = m.ptyBridges[paneID]
	}
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("channel %s not found", channelID)
	}
	if viewer != nil {
		return viewer.bridge.Resize(uint16(rows), uint16(cols))
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
	m.lifecycleClose.Do(func() { close(m.sweepStop) })
	m.mu.Lock()
	viewerBridges := make([]*viewerPTYBridge, 0, len(m.viewerByToken))
	seenViewerBridges := make(map[*viewerPTYBridge]struct{})
	for _, viewer := range m.viewerByToken {
		if viewer.bridge != nil {
			if _, seen := seenViewerBridges[viewer.bridge]; !seen {
				viewerBridges = append(viewerBridges, viewer.bridge)
				seenViewerBridges[viewer.bridge] = struct{}{}
			}
		}
		if viewer.channelID != "" {
			if m.paneController[viewer.paneID] == viewer.channelID {
				delete(m.paneController, viewer.paneID)
			}
			delete(m.channelToPane, viewer.channelID)
			delete(m.channelSession, viewer.channelID)
			delete(m.channelToPTY, viewer.channelID)
			delete(m.channelPerViewer, viewer.channelID)
			delete(m.channelReadOnly, viewer.channelID)
		}
	}
	m.viewerByChannel = make(map[string]*terminalViewer)
	m.viewerByToken = make(map[string]*terminalViewer)
	m.mu.Unlock()
	for _, bridge := range viewerBridges {
		bridge.close(false)
	}

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

func (m *TerminalManager) replaceViewerBridge(viewer *terminalViewer, readonly bool) error {
	size := TerminalSize{Cols: 80, Rows: 24}
	if viewer.bridge != nil {
		size = viewer.bridge.Size()
		viewer.bridge.close(false)
	}
	bridge, err := newViewerPTYBridge(m.runner, viewerPTYOptions{
		ChannelID:   viewer.channelID,
		PaneID:      viewer.paneID,
		ReadOnly:    readonly,
		Cols:        size.Cols,
		Rows:        size.Rows,
		Letterbox:   viewer.letterbox,
		ResumeToken: viewer.resumeToken,
		OnOutput:    m.onOutput,
		OnStatus:    m.onStatus,
	})
	if err != nil {
		viewer.bridge = nil
		return err
	}
	viewer.bridge = bridge
	viewer.readOnly = readonly
	return nil
}

func (m *TerminalManager) assignNextViewerController(paneID string) {
	m.mu.Lock()
	var next *terminalViewer
	for _, viewer := range m.viewerByChannel {
		if viewer.paneID == paneID {
			next = viewer
			break
		}
	}
	if next == nil {
		m.mu.Unlock()
		return
	}
	if err := m.replaceViewerBridge(next, false); err != nil {
		m.mu.Unlock()
		log.Printf("Failed to promote terminal viewer %s: %v", next.channelID, err)
		return
	}
	m.paneController[paneID] = next.channelID
	next.readOnly = false
	m.channelReadOnly[next.channelID] = false
	m.mu.Unlock()

	if m.onStatus != nil {
		m.onStatus(next.channelID, "control", "Control granted")
	}
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
				encoded := base64.StdEncoding.EncodeToString(data)

				channels := m.snapshotOutputChannels(bridge)
				for _, channel := range channels {
					channel.Enqueue(encoded)
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

func (m *TerminalManager) snapshotOutputChannels(bridge *paneBridge) []*terminalOutputChannel {
	bridge.mu.RLock()
	defer bridge.mu.RUnlock()

	channels := make([]*terminalOutputChannel, 0, len(bridge.channels))
	for _, channel := range bridge.channels {
		channels = append(channels, channel)
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
	for _, channel := range b.channels {
		channel.Close()
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
	if cols <= 0 && rows <= 0 {
		return fmt.Errorf("at least one pane dimension must be positive")
	}
	for _, dimension := range []struct {
		flag  string
		value int
	}{{flag: "-x", value: cols}, {flag: "-y", value: rows}} {
		if dimension.value <= 0 {
			continue
		}
		args := []string{"resize-pane", "-t", paneID, dimension.flag, fmt.Sprintf("%d", dimension.value)}
		if c.cfg.Socket != "" {
			args = append([]string{"-S", c.cfg.Socket}, args...)
		}
		output, err := exec.Command(c.cfg.Bin, args...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to resize pane: %w", commandError(err, output))
		}
	}
	return nil
}

func runTmuxCommand(bin string, args []string) error {
	cmd := exec.Command(bin, args...)
	return cmd.Run()
}
