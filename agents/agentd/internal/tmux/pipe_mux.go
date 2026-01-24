package tmux

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type PipeMux struct {
	mu     sync.Mutex
	client *Client
	logDir string
	panes  map[string]*pipeState
}

type pipeState struct {
	paneID   string
	logPath  string
	fifoPath string
	wantLog  bool
	wantFIFO bool
	lastCmd  string
}

func NewPipeMux(client *Client, logDir string) *PipeMux {
	_ = os.MkdirAll(logDir, 0755)
	return &PipeMux{
		client: client,
		logDir: logDir,
		panes:  make(map[string]*pipeState),
	}
}

func (m *PipeMux) SetConsole(paneID string, enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state := m.getState(paneID)
	state.wantLog = enabled
	if enabled && state.logPath == "" {
		state.logPath = filepath.Join(m.logDir, paneID+".log")
	}

	return m.applyLocked(state)
}

func (m *PipeMux) SetTerminal(paneID, fifoPath string, enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	state := m.getState(paneID)
	state.wantFIFO = enabled
	if enabled {
		if fifoPath == "" {
			return fmt.Errorf("fifo path is required for terminal output")
		}
		state.fifoPath = fifoPath
	}

	return m.applyLocked(state)
}

func (m *PipeMux) getState(paneID string) *pipeState {
	state, ok := m.panes[paneID]
	if !ok {
		state = &pipeState{paneID: paneID}
		m.panes[paneID] = state
	}
	return state
}

func (m *PipeMux) applyLocked(state *pipeState) error {
	cmd := buildPipeCmd(state)
	if cmd == "" {
		_ = m.client.StopPipePane(state.paneID)
		delete(m.panes, state.paneID)
		return nil
	}

	if cmd == state.lastCmd {
		return nil
	}

	if err := m.client.SetPipePaneCmd(state.paneID, cmd); err != nil {
		return err
	}

	state.lastCmd = cmd
	return nil
}

func buildPipeCmd(state *pipeState) string {
	switch {
	case state.wantLog && state.wantFIFO:
		logPath := shellEscape(state.logPath)
		fifoPath := shellEscape(state.fifoPath)
		return fmt.Sprintf("command -v stdbuf >/dev/null 2>&1 && stdbuf -o0 tee -a %s %s >/dev/null || tee -a %s %s >/dev/null", logPath, fifoPath, logPath, fifoPath)
	case state.wantLog:
		logPath := shellEscape(state.logPath)
		return fmt.Sprintf("command -v stdbuf >/dev/null 2>&1 && stdbuf -o0 cat >> %s || cat >> %s", logPath, logPath)
	case state.wantFIFO:
		fifoPath := shellEscape(state.fifoPath)
		return fmt.Sprintf("command -v stdbuf >/dev/null 2>&1 && stdbuf -o0 cat >> %s || cat >> %s", fifoPath, fifoPath)
	default:
		return ""
	}
}

func shellEscape(value string) string {
	if value == "" {
		return "''"
	}
	replaced := strings.ReplaceAll(value, "'", "'\"'\"'")
	return "'" + replaced + "'"
}
