package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
	"github.com/agent-command/agentd/internal/ws"
	"github.com/gorilla/websocket"
)

func TestTerminalOutputHandlerDoesNotReencodeFanoutChunk(t *testing.T) {
	var gotType string
	var gotPayload any
	agent := &Agent{sendMessage: func(msgType string, payload any) error {
		gotType = msgType
		gotPayload = payload
		return nil
	}}

	agent.handleTerminalOutput("channel-1", "YWxyZWFkeS1lbmNvZGVk")

	want := protocol.TerminalOutputPayload{
		ChannelID: "channel-1",
		Encoding:  "base64",
		Data:      "YWxyZWFkeS1lbmNvZGVk",
	}
	if gotType != "terminal.output" || !reflect.DeepEqual(gotPayload, want) {
		t.Fatalf("message=(%q, %#v), want=(terminal.output, %#v)", gotType, gotPayload, want)
	}
}

func TestTerminalAuditHandlerEmitsAdditiveAuditEvent(t *testing.T) {
	var gotType string
	var gotPayload any
	agent := &Agent{sendMessage: func(msgType string, payload any) error {
		gotType = msgType
		gotPayload = payload
		return nil
	}}

	agent.handleTerminalAudit(tmux.TerminalAuditEvent{
		Action:                      "control_transfer",
		ChannelID:                   "channel-2",
		SessionID:                   "session-1",
		PaneID:                      "%7",
		PreviousControllerChannelID: "channel-1",
	})

	want := protocol.TerminalAuditPayload{
		EventType:                   "terminal.audit",
		Action:                      "control_transfer",
		ChannelID:                   "channel-2",
		SessionID:                   "session-1",
		PaneID:                      "%7",
		PreviousControllerChannelID: "channel-1",
	}
	if gotType != "terminal.audit" || !reflect.DeepEqual(gotPayload, want) {
		t.Fatalf("message=(%q, %#v), want=(terminal.audit, %#v)", gotType, gotPayload, want)
	}
}

func TestHandleTerminalNavigateRoutesToGroupedViewerOnPrivateSocket(t *testing.T) {
	tmuxClient := newPrivateCommandTmux(t)
	panes, err := tmuxClient.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial panes=%+v err=%v", panes, err)
	}
	if _, err := tmuxClient.NewWindow("command-test", "second", ""); err != nil {
		t.Fatalf("create second window: %v", err)
	}
	if err := tmuxClient.SelectWindow("command-test:0"); err != nil {
		t.Fatalf("restore origin window: %v", err)
	}

	manager := tmux.NewTerminalManager(tmuxClient, t.TempDir())
	manager.SetPerViewerPTY(true)
	defer manager.Close()
	if _, err := manager.AttachWithOptions("navigate-channel", panes[0].PaneID, tmux.AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	agent := &Agent{terminalManager: manager}
	windowIndex := 1
	payload, err := json.Marshal(protocol.TerminalNavigatePayload{
		ChannelID:   "navigate-channel",
		Op:          "select_window",
		WindowIndex: &windowIndex,
	})
	if err != nil {
		t.Fatal(err)
	}
	agent.handleMessage(protocol.TypeTerminalNavigate, payload)
	scrollLines := 1
	payload, err = json.Marshal(protocol.TerminalNavigatePayload{
		ChannelID: "navigate-channel",
		Op:        "scroll",
		Lines:     &scrollLines,
	})
	if err != nil {
		t.Fatal(err)
	}
	agent.handleMessage(protocol.TypeTerminalNavigate, payload)

	panes, err = tmuxClient.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.SessionName == "command-test" && pane.WindowIndex == 0 && !pane.WindowActive {
			t.Fatal("terminal.navigate changed the origin session's current window")
		}
	}
}

func TestHandleTerminalFocusPaneReportsVerifiedViewerState(t *testing.T) {
	tmuxClient := newPrivateCommandTmux(t)
	panes, err := tmuxClient.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial panes=%+v err=%v", panes, err)
	}
	target, err := tmuxClient.SplitPaneWithOptions(panes[0].PaneID, "horizontal", nil, "")
	if err != nil {
		t.Fatalf("split pane: %v", err)
	}

	manager := tmux.NewTerminalManager(tmuxClient, t.TempDir())
	manager.SetPerViewerPTY(true)
	defer manager.Close()
	if _, err := manager.AttachWithOptions("focus-channel", panes[0].PaneID, tmux.AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}

	var gotType string
	var gotPayload any
	agent := &Agent{
		terminalManager: manager,
		sendMessage: func(msgType string, payload any) error {
			gotType = msgType
			gotPayload = payload
			return nil
		},
	}
	payload, err := json.Marshal(protocol.TerminalNavigatePayload{
		ChannelID: "focus-channel",
		Op:        "focus_pane",
		RequestID: "44444444-4444-4444-8444-444444444444",
		PaneID:    target.PaneID,
		Zoom:      boolPointer(true),
	})
	if err != nil {
		t.Fatal(err)
	}
	agent.handleMessage(protocol.TypeTerminalNavigate, payload)

	result, ok := gotPayload.(protocol.TerminalNavigationResultPayload)
	if gotType != protocol.TypeTerminalNavigationResult || !ok {
		t.Fatalf("message=(%q, %#v), want terminal navigation result", gotType, gotPayload)
	}
	if !result.OK || result.PaneID != target.PaneID || result.WindowIndex != 0 || !result.Zoomed {
		t.Fatalf("navigation result=%+v", result)
	}
}

func TestHandleTerminalViewerStateReportsCurrentViewerState(t *testing.T) {
	tmuxClient := newPrivateCommandTmux(t)
	panes, err := tmuxClient.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial panes=%+v err=%v", panes, err)
	}

	manager := tmux.NewTerminalManager(tmuxClient, t.TempDir())
	manager.SetPerViewerPTY(true)
	defer manager.Close()
	if _, err := manager.AttachWithOptions("state-channel", panes[0].PaneID, tmux.AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}

	var gotType string
	var gotPayload any
	agent := &Agent{
		terminalManager: manager,
		sendMessage: func(msgType string, payload any) error {
			gotType = msgType
			gotPayload = payload
			return nil
		},
	}
	payload, err := json.Marshal(protocol.TerminalNavigatePayload{
		ChannelID: "state-channel",
		Op:        "viewer_state",
		RequestID: "66666666-6666-4666-8666-666666666666",
	})
	if err != nil {
		t.Fatal(err)
	}
	agent.handleMessage(protocol.TypeTerminalNavigate, payload)

	result, ok := gotPayload.(protocol.TerminalNavigationResultPayload)
	if gotType != protocol.TypeTerminalNavigationResult || !ok {
		t.Fatalf("message=(%q, %#v), want terminal navigation result", gotType, gotPayload)
	}
	if !result.OK || result.PaneID != panes[0].PaneID || result.WindowIndex != 0 || result.Zoomed {
		t.Fatalf("viewer state result=%+v", result)
	}
}

func TestHandleTerminalStatusIncludesAuthorizedPane(t *testing.T) {
	tmuxClient := newPrivateCommandTmux(t)
	panes, err := tmuxClient.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial panes=%+v err=%v", panes, err)
	}

	manager := tmux.NewTerminalManager(tmuxClient, t.TempDir())
	manager.SetPerViewerPTY(true)
	defer manager.Close()
	if _, err := manager.AttachWithOptions("status-channel", panes[0].PaneID, tmux.AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}

	var gotType string
	var gotPayload any
	agent := &Agent{
		terminalManager: manager,
		sendMessage: func(msgType string, payload any) error {
			gotType = msgType
			gotPayload = payload
			return nil
		},
	}
	agent.handleTerminalStatus("status-channel", "control", "Control granted")

	status, ok := gotPayload.(protocol.TerminalStatusPayload)
	if gotType != protocol.TypeTerminalControl || !ok {
		t.Fatalf("message=(%q, %#v), want terminal control status", gotType, gotPayload)
	}
	if status.PaneID != panes[0].PaneID {
		t.Fatalf("terminal status pane=%q, want %q", status.PaneID, panes[0].PaneID)
	}
}

func boolPointer(value bool) *bool {
	return &value
}

func TestTerminalAttachSupersedesStaleChannelAfterControlPlaneReconnect(t *testing.T) {
	tmuxClient := newPrivateCommandTmux(t)
	panes, err := tmuxClient.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial panes=%+v err=%v", panes, err)
	}
	paneID := panes[0].PaneID

	var connectionMu sync.Mutex
	connectionCount := 0
	firstAttached := make(chan struct{})
	secondAttached := make(chan protocol.TerminalStatusPayload, 1)
	serverDone := make(chan struct{})
	var resumeToken string
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		connectionMu.Lock()
		connectionCount++
		current := connectionCount
		connectionMu.Unlock()
		if current > 2 {
			return
		}

		var hello protocol.AgentEnvelope
		if err := conn.ReadJSON(&hello); err != nil || hello.Type != protocol.TypeAgentHello {
			return
		}
		attach := protocol.TerminalAttachPayload{
			ChannelID: "channel-old",
			PaneID:    paneID,
			SessionID: "session-1",
			Cols:      120,
			Rows:      40,
		}
		if current == 2 {
			<-firstAttached
			attach.ChannelID = "channel-new"
			attach.ResumeToken = resumeToken
		}
		if err := conn.WriteJSON(protocol.ServerMessage[protocol.TerminalAttachPayload]{
			V: protocol.Version, Type: protocol.TypeTerminalAttach,
			TS: time.Now().UTC().Format(time.RFC3339Nano), Payload: attach,
		}); err != nil {
			return
		}

		for {
			var raw map[string]json.RawMessage
			if err := conn.ReadJSON(&raw); err != nil {
				return
			}
			var envelope protocol.AgentEnvelope
			encoded, err := json.Marshal(raw)
			if err != nil || json.Unmarshal(encoded, &envelope) != nil {
				return
			}
			if envelope.Type != protocol.TypeTerminalAttached {
				continue
			}
			if _, exists := raw["seq"]; exists {
				t.Errorf("terminal.attached contains durable sequence: %s", raw["seq"])
				return
			}
			var status protocol.TerminalStatusPayload
			if err := json.Unmarshal(envelope.Payload, &status); err != nil || status.ChannelID != attach.ChannelID {
				continue
			}
			if current == 1 {
				resumeToken = status.ResumeToken
				close(firstAttached)
				return
			}
			secondAttached <- status
			<-serverDone
			return
		}
	}))
	defer server.Close()
	defer close(serverDone)

	agent := &Agent{tmuxClient: tmuxClient}
	manager := tmux.NewTerminalManager(tmuxClient, t.TempDir())
	manager.SetPerViewerPTY(true)
	agent.terminalManager = manager
	defer manager.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	wsClient := ws.NewClient(wsURL, "token", "host", []int{10})
	agent.wsClient = wsClient
	wsClient.SetMessageHandler(agent.handleMessage)
	wsClient.SetOnDisconnect(manager.MarkChannelsStale)
	wsClient.SetOnConnect(func() {
		if err := wsClient.ResendQueued(); err != nil {
			return
		}
		_ = wsClient.SendHello(protocol.AgentHelloPayload{})
	})
	manager.SetOutputHandler(agent.handleTerminalOutput)
	manager.SetStatusHandler(agent.handleTerminalStatus)
	manager.SetAuditHandler(agent.handleTerminalAudit)
	if err := wsClient.Connect(); err != nil {
		t.Fatal(err)
	}
	defer wsClient.Close()

	select {
	case status := <-secondAttached:
		if status.Resumed == nil || !*status.Resumed || status.ResumeToken != resumeToken {
			t.Fatalf("resumed terminal status=%+v token=%q", status, resumeToken)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for resumed terminal.attach after reconnect")
	}
	if err := manager.SendInput("channel-old", "stale"); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("old channel cleanup error=%v", err)
	}
	if !manager.IsPTYMode("channel-new") {
		t.Fatal("new channel is not attached in PTY mode")
	}
}
