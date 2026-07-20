package main

import (
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
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
