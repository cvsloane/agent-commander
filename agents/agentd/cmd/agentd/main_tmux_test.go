package main

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
	"github.com/agent-command/agentd/internal/ws"
	"github.com/gorilla/websocket"
)

func TestSyncPanesIncludesExtendedTmuxMetadata(t *testing.T) {
	var sent protocol.SessionsUpsertPayload
	agent := &Agent{
		cfg:               &config.Config{Tmux: config.TmuxConfig{OptionSessionID: "@ac_session_id"}},
		sessions:          make(map[string]*SessionState),
		snapshotHash:      make(map[string]string),
		providerUsageHash: make(map[string]string),
		lastPruneAt:       time.Now(),
		sendMessage: func(messageType string, payload any) error {
			if messageType == protocol.TypeSessionsUpsert {
				sent = payload.(protocol.SessionsUpsertPayload)
			}
			return nil
		},
	}

	agent.syncPanes([]tmux.Pane{{
		PaneID:         "%7",
		PanePID:        1234,
		SessionID:      "session-123",
		SessionName:    "agents",
		WindowName:     "worker",
		WindowIndex:    2,
		PaneIndex:      1,
		CurrentCommand: "bash",
		PaneActive:     true,
		WindowActive:   false,
		WindowZoomed:   true,
		WindowLayout:   "tiled",
		PaneWidth:      190,
		PaneHeight:     45,
		WindowBell:     true,
		WindowActivity: false,
	}}, nil)

	if len(sent.Sessions) != 1 {
		t.Fatalf("sessions.upsert count=%d, want 1", len(sent.Sessions))
	}
	tmuxMetadata := sent.Sessions[0].Metadata.Tmux
	if tmuxMetadata == nil {
		t.Fatal("tmux metadata is nil")
	}
	if !tmuxMetadata.PaneActive || tmuxMetadata.WindowActive || !tmuxMetadata.WindowZoomedFlag ||
		tmuxMetadata.WindowLayout != "tiled" || tmuxMetadata.PaneWidth != 190 || tmuxMetadata.PaneHeight != 45 ||
		!tmuxMetadata.WindowBellFlag || tmuxMetadata.WindowActivityFlag {
		t.Fatalf("extended tmux metadata=%+v", tmuxMetadata)
	}
}

func TestBuildTmuxTopologySortsSessionsWindowsAndPanes(t *testing.T) {
	panes := []tmux.Pane{
		{SessionName: "zeta", SessionAttached: true, SessionAttachedClients: 2, WindowIndex: 2, WindowName: "later", PaneID: "%9", PaneIndex: 1},
		{SessionName: "alpha", WindowIndex: 1, WindowName: "main", WindowActive: true, WindowZoomed: true, WindowLayout: "tiled", WindowBell: true, PaneID: "%2", PaneIndex: 1, PaneWidth: 90, PaneHeight: 30, PaneTitle: "second", CurrentCommand: "bash", CurrentPath: "/tmp/two"},
		{SessionName: "alpha", WindowIndex: 1, WindowName: "main", WindowActive: true, WindowZoomed: true, WindowLayout: "tiled", WindowBell: true, PaneID: "%1", PaneIndex: 0, PaneActive: true, PaneWidth: 100, PaneHeight: 30, PaneTitle: "first", CurrentCommand: "codex", CurrentPath: "/tmp/one"},
		{SessionName: "alpha", WindowIndex: 0, WindowName: "early", PaneID: "%0", PaneIndex: 0},
	}

	got := buildTmuxTopology("hook:window-renamed", panes)
	if got.Reason != "hook:window-renamed" || len(got.TmuxSessions) != 2 {
		t.Fatalf("topology header/sessions=%+v", got)
	}
	if names := []string{got.TmuxSessions[0].SessionName, got.TmuxSessions[1].SessionName}; !reflect.DeepEqual(names, []string{"alpha", "zeta"}) {
		t.Fatalf("session order=%v", names)
	}
	alpha := got.TmuxSessions[0]
	if alpha.Attached || len(alpha.Windows) != 2 || alpha.Windows[0].WindowIndex != 0 || alpha.Windows[1].WindowIndex != 1 {
		t.Fatalf("alpha topology=%+v", alpha)
	}
	mainWindow := alpha.Windows[1]
	if !mainWindow.Active || !mainWindow.Zoomed || mainWindow.Layout != "tiled" || !mainWindow.Bell || mainWindow.Activity {
		t.Fatalf("window topology=%+v", mainWindow)
	}
	if paneIDs := []string{mainWindow.Panes[0].PaneID, mainWindow.Panes[1].PaneID}; !reflect.DeepEqual(paneIDs, []string{"%1", "%2"}) {
		t.Fatalf("pane order=%v", paneIDs)
	}
	if !mainWindow.Panes[0].Active || mainWindow.Panes[0].Width != 100 || mainWindow.Panes[0].CurrentCommand != "codex" {
		t.Fatalf("pane topology=%+v", mainWindow.Panes[0])
	}
	if got.TmuxSessions[1].AttachedClients != 2 {
		t.Fatalf("zeta attached clients=%d, want 2", got.TmuxSessions[1].AttachedClients)
	}
}

func TestQueueTmuxTopologyDebouncesHooksAndPollsOnlyOnDrift(t *testing.T) {
	messages := make(chan protocol.TmuxTopologyPayload, 3)
	agent := &Agent{cfg: &config.Config{Tmux: config.TmuxConfig{TopologyEvents: true}}, sendMessage: func(messageType string, payload any) error {
		if messageType == protocol.TypeTmuxTopology {
			messages <- payload.(protocol.TmuxTopologyPayload)
		}
		return nil
	}}
	defer agent.stopTmuxTopology()

	panes := []tmux.Pane{{SessionName: "agents", WindowIndex: 0, PaneID: "%1", PaneWidth: 80}}
	agent.queueTmuxTopology("hook:after-split-window", panes)
	time.Sleep(100 * time.Millisecond)
	agent.queueTmuxTopology("hook:window-renamed", panes)

	select {
	case message := <-messages:
		t.Fatalf("topology emitted before 500ms debounce: %+v", message)
	case <-time.After(450 * time.Millisecond):
	}

	var first protocol.TmuxTopologyPayload
	select {
	case first = <-messages:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("timed out waiting for debounced topology")
	}
	if first.Reason != "hook:window-renamed" {
		t.Fatalf("coalesced reason=%q", first.Reason)
	}

	agent.queueTmuxTopology("poll", panes)
	select {
	case message := <-messages:
		t.Fatalf("unchanged poll emitted topology: %+v", message)
	case <-time.After(550 * time.Millisecond):
	}

	panes[0].PaneWidth = 120
	agent.queueTmuxTopology("poll", panes)
	select {
	case message := <-messages:
		if message.Reason != "poll" || message.TmuxSessions[0].Windows[0].Panes[0].Width != 120 {
			t.Fatalf("drift topology=%+v", message)
		}
	case <-time.After(750 * time.Millisecond):
		t.Fatal("timed out waiting for poll drift topology")
	}
}

func TestQueueTmuxTopologyDefaultOffWritesNoWebSocketFrame(t *testing.T) {
	messages := make(chan string, 1)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			var message struct {
				Type string `json:"type"`
			}
			if err := conn.ReadJSON(&message); err != nil {
				return
			}
			messages <- message.Type
		}
	}))
	defer server.Close()

	wsClient := ws.NewClient("ws"+strings.TrimPrefix(server.URL, "http"), "token", "host", []int{1})
	if err := wsClient.Connect(); err != nil {
		t.Fatal(err)
	}
	defer wsClient.Close()
	if err := wsClient.ResendQueued(); err != nil {
		t.Fatal(err)
	}

	agent := &Agent{cfg: &config.Config{}, wsClient: wsClient}
	defer agent.stopTmuxTopology()
	agent.queueTmuxTopology("startup", []tmux.Pane{{SessionName: "agents", WindowIndex: 0, PaneID: "%1"}})

	select {
	case messageType := <-messages:
		t.Fatalf("default-off topology wrote websocket frame %q", messageType)
	case <-time.After(tmuxTopologyDebounce + 150*time.Millisecond):
	}
}
