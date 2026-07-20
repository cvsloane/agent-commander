package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/providers"
	"github.com/agent-command/agentd/internal/queue"
	"github.com/agent-command/agentd/internal/ws"
)

func TestBufferedHookRetriesAfterPaneDiscovery(t *testing.T) {
	dir := t.TempDir()
	outbound, err := queue.NewQueue(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer outbound.Close()

	client := ws.NewClient("ws://127.0.0.1:1", "token", "host", []int{1})
	client.SetQueue(outbound, dir)
	client.SetLastAckedSeq(0)
	defer client.Close()

	agent := &Agent{
		cfg:               &config.Config{Tmux: config.TmuxConfig{PollIntervalMs: 1000}},
		wsClient:          client,
		sessions:          make(map[string]*SessionState),
		pendingToolEvents: make(map[string][]toolEventPending),
		recentDecisions:   make(map[string]time.Time),
	}
	payload := providers.ClaudeHookPayload{Hook: json.RawMessage(`{"hook_name":"Stop"}`)}
	payload.Meta.TmuxPane = "%9"
	agent.bufferHook("claude_code", payload)

	agent.retryBufferedHooks()
	if len(agent.bufferedHooks) != 1 {
		t.Fatalf("hook was not retained for a poll cycle: %+v", agent.bufferedHooks)
	}

	agent.sessions["session-9"] = &SessionState{
		ID:       "session-9",
		PaneID:   "%9",
		Kind:     "tmux_pane",
		Provider: "claude_code",
		Status:   "RUNNING",
	}
	agent.retryBufferedHooks()
	if len(agent.bufferedHooks) != 0 {
		t.Fatalf("matched hook remained buffered: %+v", agent.bufferedHooks)
	}
	if outbound.Len() == 0 {
		t.Fatal("retried hook did not emit durable messages")
	}
}

func TestBufferedHookExpiresAfterAtLeastOnePollCycle(t *testing.T) {
	agent := &Agent{
		cfg:      &config.Config{Tmux: config.TmuxConfig{PollIntervalMs: 7000}},
		sessions: make(map[string]*SessionState),
	}
	payload := providers.ClaudeHookPayload{}
	payload.Meta.TmuxPane = "%10"
	agent.bufferHook("codex", payload)
	if agent.hookBufferTTL() < 7*time.Second {
		t.Fatalf("buffer TTL %s is shorter than poll cycle", agent.hookBufferTTL())
	}

	agent.bufferedHooks[0].BufferedAt = time.Now().Add(-agent.hookBufferTTL() - time.Millisecond)
	agent.retryBufferedHooks()
	if len(agent.bufferedHooks) != 0 {
		t.Fatalf("expired hook was retained: %+v", agent.bufferedHooks)
	}
}
