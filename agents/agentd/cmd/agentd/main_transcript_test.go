package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/commands"
	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/providers"
	"github.com/agent-command/agentd/internal/usage"
)

func TestClaudeHookRetainsLatestTranscriptPathUntilSessionCleanup(t *testing.T) {
	agent := &Agent{
		cfg:               &config.Config{},
		sessions:          map[string]*SessionState{"session-1": {ID: "session-1", Kind: "tmux_pane", PaneID: "%1"}},
		transcriptPaths:   make(map[string]string),
		snapshotHash:      make(map[string]string),
		providerUsageHash: make(map[string]string),
		usageTracker:      usage.NewUsageTracker(),
		lastPruneAt:       time.Now(),
		sendMessage:       func(string, any) error { return nil },
	}
	hook := providers.ClaudeHookPayload{Hook: json.RawMessage(`{
		"hook_event_name":"Custom",
		"transcript_path":"/safe/first.jsonl"
	}`)}
	hook.Meta.ACSessionID = "session-1"
	if _, err := agent.handleClaudeHook(hook); err != nil {
		t.Fatal(err)
	}
	hook.Hook = json.RawMessage(`{
		"hook_event_name":"Custom",
		"transcript_path":"/safe/latest.jsonl"
	}`)
	if _, err := agent.handleClaudeHook(hook); err != nil {
		t.Fatal(err)
	}

	if got := agent.transcriptPathForSession("session-1"); got != "/safe/latest.jsonl" {
		t.Fatalf("retained transcript path=%q", got)
	}

	agent.syncPanes(nil, nil)
	if got := agent.transcriptPathForSession("session-1"); got != "" {
		t.Fatalf("transcript path survived session cleanup: %q", got)
	}
}

func TestCaptureTranscriptDerivesNewestClaudeProjectFile(t *testing.T) {
	projectsRoot := t.TempDir()
	projectDir := filepath.Join(projectsRoot, "-home-dev-Chat--FW6-")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(projectDir, "old.jsonl")
	newPath := filepath.Join(projectDir, "new.jsonl")
	if err := os.WriteFile(oldPath, []byte(`{"type":"user","message":{"content":"old"}}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newPath, []byte(`{"type":"user","message":{"content":"new"}}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := os.Chtimes(oldPath, now.Add(-time.Minute), now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newPath, now, now); err != nil {
		t.Fatal(err)
	}

	agent := &Agent{
		sessions:           map[string]*SessionState{"session-1": {ID: "session-1", CWD: "/home/dev/Chat (FW6)"}},
		transcriptPaths:    make(map[string]string),
		claudeProjectsRoot: projectsRoot,
	}
	payload, err := json.Marshal(protocol.CaptureTranscriptPayload{PageSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	result, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command: protocol.Command{
			Type:    "capture_transcript",
			Payload: payload,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["source"] != "derived" || result["first_entry"] != 0 || result["total_entries"] != 1 {
		t.Fatalf("derived transcript metadata=%+v", result)
	}
	entries, ok := result["entries"].([]map[string]any)
	if !ok || len(entries) != 1 {
		t.Fatalf("derived transcript entries=%T %+v", result["entries"], result["entries"])
	}
	message, _ := entries[0]["message"].(map[string]any)
	if message["content"] != "new" {
		t.Fatalf("derived newest entry=%+v", entries[0])
	}
}

func TestCaptureTranscriptPagesBackwardByEntryIndex(t *testing.T) {
	projectsRoot := t.TempDir()
	projectDir := filepath.Join(projectsRoot, "-repo")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	transcriptPath := filepath.Join(projectDir, "session.jsonl")
	file, err := os.Create(transcriptPath)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 7; index++ {
		if _, err := file.WriteString(`{"index":` + string(rune('0'+index)) + `}` + "\n"); err != nil {
			t.Fatal(err)
		}
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	agent := &Agent{
		sessions:           map[string]*SessionState{"session-1": {ID: "session-1", CWD: "/repo"}},
		transcriptPaths:    map[string]string{"session-1": transcriptPath},
		claudeProjectsRoot: projectsRoot,
	}

	assertPage := func(before *int, wantFirst int, wantIndexes []float64) {
		t.Helper()
		payload, err := json.Marshal(protocol.CaptureTranscriptPayload{PageSize: 3, BeforeEntry: before})
		if err != nil {
			t.Fatal(err)
		}
		result, err := agent.executeCommand(commands.Dispatch{
			SessionID: "session-1",
			Command:   protocol.Command{Type: "capture_transcript", Payload: payload},
		})
		if err != nil {
			t.Fatal(err)
		}
		if result["source"] != "hook" || result["first_entry"] != wantFirst || result["total_entries"] != 7 {
			t.Fatalf("page metadata=%+v", result)
		}
		entries := result["entries"].([]map[string]any)
		gotIndexes := make([]float64, 0, len(entries))
		for _, entry := range entries {
			gotIndexes = append(gotIndexes, entry["index"].(float64))
		}
		if len(gotIndexes) != len(wantIndexes) {
			t.Fatalf("page indexes=%v want=%v", gotIndexes, wantIndexes)
		}
		for index := range gotIndexes {
			if gotIndexes[index] != wantIndexes[index] {
				t.Fatalf("page indexes=%v want=%v", gotIndexes, wantIndexes)
			}
		}
	}

	assertPage(nil, 4, []float64{4, 5, 6})
	before := 4
	assertPage(&before, 1, []float64{1, 2, 3})
	before = 1
	assertPage(&before, 0, []float64{0})
}

func TestCaptureTranscriptRejectsHookPathsOutsideClaudeProjects(t *testing.T) {
	projectsRoot := t.TempDir()
	outsideRoot := t.TempDir()
	outsidePath := filepath.Join(outsideRoot, "secret.jsonl")
	if err := os.WriteFile(outsidePath, []byte(`{"secret":true}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	projectDir := filepath.Join(projectsRoot, "-repo")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "safe.jsonl"), []byte(`{"safe":true}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	agent := &Agent{
		sessions:           map[string]*SessionState{"session-1": {ID: "session-1", CWD: "/repo"}},
		transcriptPaths:    map[string]string{"session-1": outsidePath},
		claudeProjectsRoot: projectsRoot,
	}
	payload, _ := json.Marshal(protocol.CaptureTranscriptPayload{PageSize: 1})
	result, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "capture_transcript", Payload: payload},
	})
	if err != nil {
		t.Fatal(err)
	}
	entries := result["entries"].([]map[string]any)
	if result["source"] != "derived" || len(entries) != 1 || entries[0]["safe"] != true {
		t.Fatalf("outside hook path was not rejected: %+v", result)
	}
}

func TestCaptureTranscriptCapsContentAndDropsBase64Blobs(t *testing.T) {
	projectsRoot := t.TempDir()
	projectDir := filepath.Join(projectsRoot, "-repo")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	entry := map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"content": []any{
				map[string]any{"type": "text", "text": strings.Repeat("é", 9_000)},
				map[string]any{
					"type": "image",
					"source": map[string]any{
						"type":       "base64",
						"media_type": "image/png",
						"data":       strings.Repeat("A", 256),
					},
				},
			},
		},
	}
	rawEntry, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	transcriptPath := filepath.Join(projectDir, "session.jsonl")
	if err := os.WriteFile(transcriptPath, append(rawEntry, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	agent := &Agent{
		sessions:           map[string]*SessionState{"session-1": {ID: "session-1", CWD: "/repo"}},
		transcriptPaths:    map[string]string{"session-1": transcriptPath},
		claudeProjectsRoot: projectsRoot,
	}
	payload, _ := json.Marshal(protocol.CaptureTranscriptPayload{PageSize: 1})
	result, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "capture_transcript", Payload: payload},
	})
	if err != nil {
		t.Fatal(err)
	}
	entries := result["entries"].([]map[string]any)
	message := entries[0]["message"].(map[string]any)
	content := message["content"].([]any)
	textBlock := content[0].(map[string]any)
	text := textBlock["text"].(string)
	if len([]byte(text)) > 16*1024 || !strings.HasPrefix(strings.Repeat("é", 9_000), text) {
		t.Fatalf("capped text has %d bytes and valid-prefix=%v", len([]byte(text)), strings.HasPrefix(strings.Repeat("é", 9_000), text))
	}
	imageBlock := content[1].(map[string]any)
	source := imageBlock["source"].(map[string]any)
	if _, exists := source["data"]; exists {
		t.Fatalf("base64 data survived sanitization: %+v", source)
	}
}

func TestCaptureTranscriptRejectsOutOfBoundsRequests(t *testing.T) {
	projectsRoot := t.TempDir()
	projectDir := filepath.Join(projectsRoot, "-repo")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	transcriptPath := filepath.Join(projectDir, "session.jsonl")
	if err := os.WriteFile(transcriptPath, []byte(`{"entry":0}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	agent := &Agent{
		sessions:           map[string]*SessionState{"session-1": {ID: "session-1", CWD: "/repo"}},
		transcriptPaths:    map[string]string{"session-1": transcriptPath},
		claudeProjectsRoot: projectsRoot,
	}
	negative := -1
	beyondEnd := 2
	for _, request := range []protocol.CaptureTranscriptPayload{
		{PageSize: 501},
		{PageSize: 1, BeforeEntry: &negative},
		{PageSize: 1, BeforeEntry: &beyondEnd},
	} {
		payload, _ := json.Marshal(request)
		if _, err := agent.executeCommand(commands.Dispatch{
			SessionID: "session-1",
			Command:   protocol.Command{Type: "capture_transcript", Payload: payload},
		}); err == nil {
			t.Fatalf("out-of-bounds request succeeded: %+v", request)
		}
	}
}

func TestCaptureTranscriptReturnsNoTranscriptErrorCode(t *testing.T) {
	agent := &Agent{
		sessions:           map[string]*SessionState{"session-1": {ID: "session-1", CWD: "/missing"}},
		transcriptPaths:    make(map[string]string),
		claudeProjectsRoot: t.TempDir(),
	}
	results := make(chan commands.Result, 1)
	executor := commands.NewExecutor(1, agent.executeCommand, func(result commands.Result) {
		results <- result
	})
	defer executor.Close()
	payload, _ := json.Marshal(protocol.CaptureTranscriptPayload{PageSize: 1})
	if err := executor.Submit(commands.Dispatch{
		CmdID:     "capture-1",
		SessionID: "session-1",
		Command:   protocol.Command{Type: "capture_transcript", Payload: payload},
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-results:
		if result.OK || result.Error == nil || result.Error.Code != "no_transcript" {
			t.Fatalf("missing transcript result=%+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for transcript result")
	}
}
