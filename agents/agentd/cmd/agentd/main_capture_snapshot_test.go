package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/commands"
	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
)

func TestCapturePaneFullCreatesNewestSnapshotPageFromOneTmuxCapture(t *testing.T) {
	agent, outputPath, callsPath := newSnapshotCommandAgent(t, []string{
		"line-0",
		"line-1",
		"line-2",
		"line-3",
		"line-4",
		"line-5",
	})

	result, err := executeSnapshotCapture(t, agent, map[string]any{
		"mode":       "full",
		"page_size":  2,
		"strip_ansi": true,
	})
	if err != nil {
		t.Fatalf("create snapshot: %v", err)
	}
	if result["capture_mode"] != "snapshot" ||
		result["content"] != "line-4\nline-5" ||
		result["line_count"] != 2 ||
		result["range_start"] != 4 ||
		result["range_end"] != 6 ||
		result["total_lines"] != 6 ||
		result["source_total_lines"] != 6 ||
		result["snapshot_truncated"] != false ||
		result["has_older"] != true ||
		result["next_before"] != 4 {
		t.Fatalf("snapshot result=%+v", result)
	}
	if snapshotID, _ := result["snapshot_id"].(string); snapshotID == "" {
		t.Fatalf("snapshot id=%q", snapshotID)
	}
	if calls := readSnapshotCalls(t, callsPath); len(calls) != 1 ||
		!strings.Contains(calls[0], "capture-pane") ||
		!strings.Contains(calls[0], "-S -") ||
		strings.Contains(calls[0], " -e") {
		t.Fatalf("tmux capture calls=%q", calls)
	}
	if _, err := os.Stat(outputPath); err != nil {
		t.Fatalf("snapshot fixture output: %v", err)
	}
}

func TestCapturePaneSnapshotContinuationIgnoresNewLiveOutput(t *testing.T) {
	agent, outputPath, callsPath := newSnapshotCommandAgent(t, []string{
		"line-0",
		"line-1",
		"line-2",
		"line-3",
		"line-4",
		"line-5",
	})
	created, err := executeSnapshotCapture(t, agent, map[string]any{
		"mode":       "full",
		"page_size":  2,
		"strip_ansi": true,
	})
	if err != nil {
		t.Fatalf("create snapshot: %v", err)
	}
	snapshotID := created["snapshot_id"].(string)
	beforeLine := created["next_before"].(int)

	writeSnapshotOutput(t, outputPath, []string{"live-0", "live-1", "live-2"})
	continued, err := executeSnapshotCapture(t, agent, map[string]any{
		"mode":        "full",
		"page_size":   2,
		"strip_ansi":  true,
		"snapshot_id": snapshotID,
		"before_line": beforeLine,
	})
	if err != nil {
		t.Fatalf("continue snapshot: %v", err)
	}
	if continued["snapshot_id"] != snapshotID ||
		continued["content"] != "line-2\nline-3" ||
		continued["range_start"] != 2 ||
		continued["range_end"] != 4 ||
		continued["total_lines"] != 6 ||
		continued["source_total_lines"] != 6 ||
		continued["has_older"] != true ||
		continued["next_before"] != 2 {
		t.Fatalf("continuation result=%+v", continued)
	}
	finalRequest := map[string]any{
		"mode":        "full",
		"page_size":   2,
		"strip_ansi":  true,
		"snapshot_id": snapshotID,
		"before_line": continued["next_before"],
	}
	finalPage, err := executeSnapshotCapture(t, agent, finalRequest)
	if err != nil {
		t.Fatalf("finish snapshot: %v", err)
	}
	if finalPage["content"] != "line-0\nline-1" ||
		finalPage["range_start"] != 0 ||
		finalPage["range_end"] != 2 ||
		finalPage["has_older"] != false {
		t.Fatalf("final page=%+v", finalPage)
	}
	if _, exists := finalPage["next_before"]; exists {
		t.Fatalf("final page exposes next_before: %+v", finalPage)
	}
	if calls := readSnapshotCalls(t, callsPath); len(calls) != 1 {
		t.Fatalf("continuation re-read tmux: calls=%q", calls)
	}
}

func TestCapturePaneSnapshotExpiresAfterSixtyMinutesIdle(t *testing.T) {
	agent, _, callsPath := newSnapshotCommandAgent(t, []string{"line-0", "line-1", "line-2"})
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	agent.capturePaneSnapshots.now = func() time.Time { return now }
	created, err := executeSnapshotCapture(t, agent, map[string]any{
		"mode":       "full",
		"page_size":  1,
		"strip_ansi": true,
	})
	if err != nil {
		t.Fatalf("create snapshot: %v", err)
	}
	request := map[string]any{
		"mode":        "full",
		"page_size":   1,
		"strip_ansi":  true,
		"snapshot_id": created["snapshot_id"],
		"before_line": created["next_before"],
	}

	now = now.Add(59 * time.Minute)
	if _, err := executeSnapshotCapture(t, agent, request); err != nil {
		t.Fatalf("continue before idle expiry: %v", err)
	}
	now = now.Add(59 * time.Minute)
	if _, err := executeSnapshotCapture(t, agent, request); err != nil {
		t.Fatalf("continue after refreshed idle window: %v", err)
	}
	now = now.Add(60 * time.Minute)
	if _, err := executeSnapshotCapture(t, agent, request); commandResultCode(err) != "SNAPSHOT_EXPIRED" {
		t.Fatalf("expired continuation error=%v code=%q", err, commandResultCode(err))
	}
	if calls := readSnapshotCalls(t, callsPath); len(calls) != 1 {
		t.Fatalf("expired continuation re-read tmux: calls=%q", calls)
	}
}

func TestCapturePaneSnapshotCacheEvictsOldestAfterTwoSnapshots(t *testing.T) {
	agent, _, callsPath := newSnapshotCommandAgent(t, []string{"line-0", "line-1"})
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	agent.capturePaneSnapshots.now = func() time.Time { return now }
	var first map[string]any
	for index := 0; index < 3; index++ {
		created, err := executeSnapshotCapture(t, agent, map[string]any{
			"mode":       "full",
			"page_size":  1,
			"strip_ansi": true,
		})
		if err != nil {
			t.Fatalf("create snapshot %d: %v", index, err)
		}
		if index == 0 {
			first = created
		}
		now = now.Add(time.Minute)
	}

	_, err := executeSnapshotCapture(t, agent, map[string]any{
		"mode":        "full",
		"page_size":   1,
		"strip_ansi":  true,
		"snapshot_id": first["snapshot_id"],
		"before_line": first["next_before"],
	})
	if commandResultCode(err) != "SNAPSHOT_EXPIRED" {
		t.Fatalf("evicted continuation error=%v code=%q", err, commandResultCode(err))
	}
	if calls := readSnapshotCalls(t, callsPath); len(calls) != 3 {
		t.Fatalf("evicted continuation re-read tmux: calls=%q", calls)
	}
}

func TestCapturePaneSnapshotContinuationRejectsRestartAndBindingMismatch(t *testing.T) {
	agent, _, callsPath := newSnapshotCommandAgent(t, []string{"line-0", "line-1"})
	created, err := executeSnapshotCapture(t, agent, map[string]any{
		"mode":       "full",
		"page_size":  1,
		"strip_ansi": true,
	})
	if err != nil {
		t.Fatalf("create snapshot: %v", err)
	}
	request := map[string]any{
		"mode":        "full",
		"page_size":   1,
		"strip_ansi":  true,
		"snapshot_id": created["snapshot_id"],
		"before_line": created["next_before"],
	}

	mismatchedStrip := maps.Clone(request)
	mismatchedStrip["strip_ansi"] = false
	if _, err := executeSnapshotCapture(t, agent, mismatchedStrip); commandResultCode(err) != "SNAPSHOT_EXPIRED" {
		t.Fatalf("strip binding error=%v code=%q", err, commandResultCode(err))
	}

	agent.sessions["session-2"] = &SessionState{ID: "session-2", PaneID: "%7"}
	if _, err := executeSnapshotCaptureForSession(t, agent, "session-2", request); commandResultCode(err) != "SNAPSHOT_EXPIRED" {
		t.Fatalf("session binding error=%v code=%q", err, commandResultCode(err))
	}

	agent.sessions["session-1"].PaneID = "%8"
	if _, err := executeSnapshotCapture(t, agent, request); commandResultCode(err) != "SNAPSHOT_EXPIRED" {
		t.Fatalf("pane binding error=%v code=%q", err, commandResultCode(err))
	}
	agent.sessions["session-1"].PaneID = "%7"

	restarted := &Agent{
		tmuxClient: agent.tmuxClient,
		sessions: map[string]*SessionState{
			"session-1": {ID: "session-1", PaneID: "%7"},
		},
	}
	if _, err := executeSnapshotCapture(t, restarted, request); commandResultCode(err) != "SNAPSHOT_EXPIRED" {
		t.Fatalf("restart error=%v code=%q", err, commandResultCode(err))
	}
	if calls := readSnapshotCalls(t, callsPath); len(calls) != 1 {
		t.Fatalf("rejected continuation re-read tmux: calls=%q", calls)
	}
}

func TestCapturePaneSnapshotRetainsNewestHundredThousandRows(t *testing.T) {
	lines := make([]string, 100_005)
	for index := range lines {
		lines[index] = fmt.Sprintf("line-%06d", index)
	}
	var cache capturePaneSnapshotCache
	page, err := cache.create(
		"session-1",
		"%7",
		true,
		strings.Join(lines, "\n")+"\n",
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if page.snapshot.sourceTotalLines != 100_005 ||
		len(page.snapshot.lines) != 100_000 ||
		page.snapshot.lines[0] != "line-000005" ||
		page.snapshot.lines[len(page.snapshot.lines)-1] != "line-100004" ||
		!page.snapshot.truncated {
		t.Fatalf(
			"retained snapshot: source=%d retained=%d first=%q last=%q truncated=%t",
			page.snapshot.sourceTotalLines,
			len(page.snapshot.lines),
			page.snapshot.lines[0],
			page.snapshot.lines[len(page.snapshot.lines)-1],
			page.snapshot.truncated,
		)
	}
}

func TestCapturePaneSnapshotRetainsNewestContentWithinByteLimit(t *testing.T) {
	if maxCaptureSnapshotBytes != 32*1024*1024 {
		t.Fatalf("snapshot byte limit=%d", maxCaptureSnapshotBytes)
	}
	retained, sourceTotal, truncated := retainCaptureSnapshotLinesWithin(
		"oldest\nmiddle\nnewest\n",
		3,
		len("middle\nnewest"),
	)
	if !slices.Equal(retained, []string{"middle", "newest"}) ||
		sourceTotal != 3 ||
		!truncated {
		t.Fatalf(
			"byte-bounded retention: rows=%q source=%d truncated=%t",
			retained,
			sourceTotal,
			truncated,
		)
	}
}

func TestCapturePaneSnapshotPageFitsJSONContentLimit(t *testing.T) {
	lines := make([]string, maxCaptureSnapshotPageSize)
	for index := range lines {
		lines[index] = fmt.Sprintf("%04d:%s", index, strings.Repeat(`"\\`, 100))
	}
	var cache capturePaneSnapshotCache
	page, err := cache.create(
		"session-1",
		"%7",
		true,
		strings.Join(lines, "\n")+"\n",
		maxCaptureSnapshotPageSize,
	)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(page.content)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > maxCaptureSnapshotPageContentBytes {
		t.Fatalf("JSON-encoded page bytes=%d, limit=%d", len(encoded), maxCaptureSnapshotPageContentBytes)
	}
	if page.end-page.start > maxCaptureSnapshotPageSize || !page.hasOlder || page.start == 0 {
		t.Fatalf("bounded page start=%d end=%d has_older=%t", page.start, page.end, page.hasOlder)
	}
	resultJSON, err := json.Marshal(page.result())
	if err != nil {
		t.Fatal(err)
	}
	if len(resultJSON) >= 1024*1024 {
		t.Fatalf("snapshot result bytes=%d, must fit existing 1 MiB frame gate", len(resultJSON))
	}
}

func TestCapturePaneSnapshotRejectsPagesOverFiveThousandRows(t *testing.T) {
	agent, _, _ := newSnapshotCommandAgent(t, []string{"line-0"})
	if _, err := executeSnapshotCapture(t, agent, map[string]any{
		"mode":       "full",
		"page_size":  maxCaptureSnapshotPageSize + 1,
		"strip_ansi": true,
	}); err == nil || !strings.Contains(err.Error(), "page_size must be between 1 and 5000") {
		t.Fatalf("oversized page error=%v", err)
	}
}

func commandResultCode(err error) string {
	var coded interface{ CommandResultCode() string }
	if !errors.As(err, &coded) {
		return ""
	}
	return coded.CommandResultCode()
}

func newSnapshotCommandAgent(t *testing.T, lines []string) (*Agent, string, string) {
	t.Helper()
	tempDir := t.TempDir()
	outputPath := filepath.Join(tempDir, "capture.txt")
	callsPath := filepath.Join(tempDir, "calls.txt")
	writeSnapshotOutput(t, outputPath, lines)
	tmuxBin := filepath.Join(tempDir, "tmux-fixture")
	script := fmt.Sprintf(
		"#!/bin/sh\nprintf '%%s\\n' \"$*\" >> %q\ncat %q\n",
		callsPath,
		outputPath,
	)
	if err := os.WriteFile(tmuxBin, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	client := tmux.NewClient(&config.TmuxConfig{Bin: tmuxBin})
	return &Agent{
		tmuxClient: client,
		sessions: map[string]*SessionState{
			"session-1": {ID: "session-1", PaneID: "%7"},
		},
	}, outputPath, callsPath
}

func executeSnapshotCapture(t *testing.T, agent *Agent, request map[string]any) (map[string]any, error) {
	t.Helper()
	return executeSnapshotCaptureForSession(t, agent, "session-1", request)
}

func executeSnapshotCaptureForSession(
	t *testing.T,
	agent *Agent,
	sessionID string,
	request map[string]any,
) (map[string]any, error) {
	t.Helper()
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	return agent.executeCommand(commands.Dispatch{
		SessionID: sessionID,
		Command: protocol.Command{
			Type:    "capture_pane",
			Payload: payload,
		},
	})
}

func writeSnapshotOutput(t *testing.T, path string, lines []string) {
	t.Helper()
	content := ""
	if len(lines) > 0 {
		content = strings.Join(lines, "\n") + "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readSnapshotCalls(t *testing.T, path string) []string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(content)), "\n")
}
