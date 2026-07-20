package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/orchestrator"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
)

type fakeTmuxRunner struct {
	mu          sync.Mutex
	operations  []string
	window      tmux.CreatedPane
	split       tmux.CreatedPane
	windowArgs  []string
	splitArgs   []string
	optionCalls [][3]string
	inputs      [][3]any
	killed      []string
	optionError string
	killErrors  map[string]error
	killStarted chan struct{}
	releaseKill chan struct{}
}

func (f *fakeTmuxRunner) HasSession(string) bool { return true }
func (f *fakeTmuxRunner) NewSession(name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "new-session:"+name)
	return nil
}
func (f *fakeTmuxRunner) CreateWindow(session, name, cwd string) (tmux.CreatedPane, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "create-window")
	f.windowArgs = []string{session, name, cwd}
	return f.window, nil
}
func (f *fakeTmuxRunner) SplitPane(target, name, cwd string) (tmux.CreatedPane, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "split-pane")
	f.splitArgs = []string{target, name, cwd}
	return f.split, nil
}
func (f *fakeTmuxRunner) SetPaneOption(paneID, option, value string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "set-option:"+option)
	f.optionCalls = append(f.optionCalls, [3]string{paneID, option, value})
	if option == f.optionError {
		return errors.New("stamp failed")
	}
	return nil
}
func (f *fakeTmuxRunner) SendInput(paneID, input string, enter bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "send-input")
	f.inputs = append(f.inputs, [3]any{paneID, input, enter})
	return nil
}
func (f *fakeTmuxRunner) KillPane(paneID string) error {
	f.mu.Lock()
	f.operations = append(f.operations, "kill-pane:"+paneID)
	f.killed = append(f.killed, paneID)
	err := f.killErrors[paneID]
	started := f.killStarted
	release := f.releaseKill
	f.mu.Unlock()
	if started != nil {
		close(started)
	}
	if release != nil {
		<-release
	}
	return err
}

func (f *fakeTmuxRunner) inputSnapshot() [][3]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][3]any(nil), f.inputs...)
}

func (f *fakeTmuxRunner) operationSnapshot() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.operations...)
}

func TestOrchestratorSpawnCreatesWindowOrSplitAndRegistersChild(t *testing.T) {
	tests := []struct {
		name          string
		body          map[string]any
		window        tmux.CreatedPane
		split         tmux.CreatedPane
		wantOperation string
		wantTargetArg string
		wantTarget    string
	}{
		{
			name:          "window",
			body:          map[string]any{"provider": "shell", "cwd": t.TempDir(), "placement": "window", "name": "worker"},
			window:        tmux.CreatedPane{PaneID: "%2", TmuxTarget: "agents:2.0"},
			wantOperation: "create-window",
			wantTargetArg: "agents",
			wantTarget:    "agents:2.0",
		},
		{
			name:          "split self",
			body:          map[string]any{"provider": "shell", "cwd": t.TempDir(), "placement": "split", "split_target": "self", "name": "worker"},
			split:         tmux.CreatedPane{PaneID: "%3", TmuxTarget: "agents:1.1"},
			wantOperation: "split-pane",
			wantTargetArg: "%1",
			wantTarget:    "agents:1.1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runner := &fakeTmuxRunner{window: tt.window, split: tt.split}
			agent := &Agent{
				cfg: &config.Config{
					Tmux:     config.TmuxConfig{OptionSessionID: "@ac_session_id"},
					Spawn:    config.SpawnConfig{TmuxSessionName: "fallback"},
					Security: config.SecurityConfig{AllowSpawn: true},
				},
				sessions:         map[string]*SessionState{"parent": {ID: "parent", PaneID: "%1", TmuxTarget: "agents:1.0", Status: "RUNNING"}},
				orchestratorTmux: runner,
				sendMessage:      func(string, any) error { return nil },
			}
			handler := orchestrator.NewHandler(&agentOrchestratorBackend{agent: agent})
			body, err := json.Marshal(tt.body)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/agent/spawn", bytes.NewReader(body))
			req.RemoteAddr = "127.0.0.1:4000"
			req.Header.Set(orchestrator.SessionHeader, "parent")
			res := httptest.NewRecorder()

			handler.ServeHTTP(res, req)

			if res.Code != http.StatusCreated {
				t.Fatalf("status=%d, want=%d; body=%s", res.Code, http.StatusCreated, res.Body.String())
			}
			var response orchestrator.SpawnResponse
			if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.PaneID == "" || response.SessionID == "" || response.TmuxTarget != tt.wantTarget {
				t.Fatalf("unexpected response: %+v", response)
			}
			if len(runner.operations) < 3 || runner.operations[0] != tt.wantOperation {
				t.Fatalf("operations=%v, want creation before stamps", runner.operations)
			}
			if tt.wantOperation == "create-window" && runner.windowArgs[0] != tt.wantTargetArg {
				t.Fatalf("window session=%q, want=%q", runner.windowArgs[0], tt.wantTargetArg)
			}
			if tt.wantOperation == "split-pane" && runner.splitArgs[0] != tt.wantTargetArg {
				t.Fatalf("split target=%q, want=%q", runner.splitArgs[0], tt.wantTargetArg)
			}
			if len(runner.optionCalls) < 2 || runner.optionCalls[0][1] != "@ac_session_id" || runner.optionCalls[1] != [3]string{response.PaneID, "@ac_parent_session_id", "parent"} {
				t.Fatalf("option stamps=%v", runner.optionCalls)
			}

			agent.sessionsMu.RLock()
			child := agent.sessions[response.SessionID]
			agent.sessionsMu.RUnlock()
			if child == nil || child.ParentSessionID != "parent" || child.PaneID != response.PaneID {
				t.Fatalf("child was not synchronously registered: %+v", child)
			}
		})
	}
}

func TestOrchestratorKillTreeKillsDescendantsBeforeParent(t *testing.T) {
	runner := &fakeTmuxRunner{}
	agent := &Agent{
		cfg:              &config.Config{Security: config.SecurityConfig{AllowKill: true}},
		orchestratorTmux: runner,
		sendMessage:      func(string, any) error { return nil },
		sessions: map[string]*SessionState{
			"root":       {ID: "root", PaneID: "%1", Status: "RUNNING"},
			"child-a":    {ID: "child-a", PaneID: "%2", Status: "RUNNING", ParentSessionID: "root"},
			"child-b":    {ID: "child-b", PaneID: "%3", Status: "WAITING_FOR_INPUT", ParentSessionID: "root"},
			"grandchild": {ID: "grandchild", PaneID: "%4", Status: "RUNNING", ParentSessionID: "child-a"},
			"unrelated":  {ID: "unrelated", PaneID: "%5", Status: "RUNNING"},
		},
	}
	handler := orchestrator.NewHandler(&agentOrchestratorBackend{agent: agent})
	req := httptest.NewRequest(http.MethodPost, "/v1/agent/kill", bytes.NewBufferString(`{"session_id":"root","tree":true}`))
	req.RemoteAddr = "127.0.0.1:4000"
	req.Header.Set(orchestrator.SessionHeader, "root")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, body=%s", res.Code, res.Body.String())
	}
	want := []string{"%4", "%2", "%3", "%1"}
	if len(runner.killed) != len(want) {
		t.Fatalf("killed=%v, want=%v", runner.killed, want)
	}
	for i := range want {
		if runner.killed[i] != want[i] {
			t.Fatalf("killed=%v, want=%v", runner.killed, want)
		}
	}
}

func TestOrchestratorReportEmitsCallerTaggedDurableEvent(t *testing.T) {
	var gotType string
	var gotPayload protocol.EventsAppendPayload
	agent := &Agent{
		cfg:      &config.Config{},
		sessions: map[string]*SessionState{"caller": {ID: "caller", PaneID: "%1", Status: "RUNNING"}},
		sendMessage: func(messageType string, payload any) error {
			gotType = messageType
			gotPayload = payload.(protocol.EventsAppendPayload)
			return nil
		},
	}
	handler := orchestrator.NewHandler(&agentOrchestratorBackend{agent: agent})
	req := httptest.NewRequest(http.MethodPost, "/v1/agent/report", bytes.NewBufferString(`{"outcome":"succeeded","summary":"finished","detail":"all green"}`))
	req.RemoteAddr = "127.0.0.1:4000"
	req.Header.Set(orchestrator.SessionHeader, "caller")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status=%d, body=%s", res.Code, res.Body.String())
	}
	if gotType != "events.append" || gotPayload.SessionID != "caller" || gotPayload.EventType != "orchestrator.report" {
		t.Fatalf("message type=%q payload=%v", gotType, gotPayload)
	}
	event := gotPayload.Payload
	if event["outcome"] != "succeeded" || event["summary"] != "finished" || event["detail"] != "all green" || event["reported_at"] == "" {
		t.Fatalf("event payload=%v", event)
	}
}

func TestOrchestratorSendDefaultsToEnterAndWaitObservesStatusChange(t *testing.T) {
	runner := &fakeTmuxRunner{}
	agent := &Agent{
		cfg:              &config.Config{Security: config.SecurityConfig{AllowSendInput: true}},
		orchestratorTmux: runner,
		sessions: map[string]*SessionState{
			"caller": {ID: "caller", PaneID: "%1", Status: "RUNNING"},
			"child":  {ID: "child", PaneID: "%2", Status: "RUNNING", ParentSessionID: "caller"},
		},
	}
	handler := orchestrator.NewHandler(&agentOrchestratorBackend{agent: agent})

	sendReq := httptest.NewRequest(http.MethodPost, "/v1/agent/send", bytes.NewBufferString(`{"session_id":"child","input":"keep going"}`))
	sendReq.RemoteAddr = "127.0.0.1:4000"
	sendReq.Header.Set(orchestrator.SessionHeader, "caller")
	sendRes := httptest.NewRecorder()
	handler.ServeHTTP(sendRes, sendReq)
	if sendRes.Code != http.StatusOK || len(runner.inputs) != 1 || runner.inputs[0] != [3]any{"%2", "keep going", true} {
		t.Fatalf("send status=%d inputs=%v body=%s", sendRes.Code, runner.inputs, sendRes.Body.String())
	}

	go func() {
		time.Sleep(20 * time.Millisecond)
		agent.sessionsMu.Lock()
		agent.sessions["child"].Status = "WAITING_FOR_INPUT"
		agent.sessions["child"].LastActivity = time.Now().UTC()
		agent.sessionsMu.Unlock()
	}()
	waitReq := httptest.NewRequest(http.MethodPost, "/v1/agent/wait", bytes.NewBufferString(`{"session_id":"child","until":"any-change","timeout_ms":500}`))
	waitReq.RemoteAddr = "127.0.0.1:4000"
	waitReq.Header.Set(orchestrator.SessionHeader, "caller")
	waitRes := httptest.NewRecorder()
	handler.ServeHTTP(waitRes, waitReq)
	if waitRes.Code != http.StatusOK {
		t.Fatalf("wait status=%d body=%s", waitRes.Code, waitRes.Body.String())
	}
	var response orchestrator.WaitResponse
	if err := json.Unmarshal(waitRes.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Session.Status != "WAITING_FOR_INPUT" || response.Session.ParentSessionID != "caller" {
		t.Fatalf("wait response=%+v", response)
	}
}

func TestHierarchyMetadataIncludesParentAndChildStatusRollup(t *testing.T) {
	agent := &Agent{sessions: map[string]*SessionState{
		"parent": {ID: "parent", Status: "RUNNING"},
		"one":    {ID: "one", Status: "RUNNING", ParentSessionID: "parent"},
		"two":    {ID: "two", Status: "WAITING_FOR_INPUT", ParentSessionID: "parent"},
	}}
	agent.sessionsMu.Lock()
	agent.refreshHierarchyMetadataLocked()
	agent.sessionsMu.Unlock()

	if agent.sessions["one"].Metadata["parent_session_id"] != "parent" {
		t.Fatalf("child metadata=%v", agent.sessions["one"].Metadata)
	}
	rollup, ok := agent.sessions["parent"].Metadata["child_status_rollup"].(map[string]int)
	if !ok || rollup["RUNNING"] != 1 || rollup["WAITING_FOR_INPUT"] != 1 {
		t.Fatalf("parent rollup=%v", agent.sessions["parent"].Metadata["child_status_rollup"])
	}
}

func TestSubagentHooksPreserveToolUseDescriptionAndTimestamps(t *testing.T) {
	var events []protocol.EventsAppendPayload
	agent := &Agent{sendMessage: func(messageType string, payload any) error {
		if messageType == "events.append" {
			events = append(events, payload.(protocol.EventsAppendPayload))
		}
		return nil
	}}
	agent.handleWorkshopHookEvent("parent", "claude_code", "PreToolUse", map[string]any{
		"tool_name":   "Task",
		"tool_use_id": "tool-123",
		"tool_input":  map[string]any{"description": "inspect the API"},
	}, "/tmp")
	agent.handleWorkshopHookEvent("parent", "claude_code", "SubagentStop", map[string]any{
		"agent_id":   "agent-456",
		"agent_type": "Explore",
	}, "/tmp")
	if len(events) != 3 || events[0].EventType != "workshop.subagent_start" || events[1].EventType != "workshop.pre_tool_use" || events[2].EventType != "workshop.subagent_stop" {
		t.Fatalf("events=%v", events)
	}
	start := events[0].Payload
	if start["tool_use_id"] != "tool-123" || start["description"] != "inspect the API" || start["started_at"] == "" {
		t.Fatalf("subagent start payload=%v", start)
	}
	stop := events[2].Payload
	if stop["agent_id"] != "agent-456" || stop["subagent_id"] != "agent-456" || stop["agent_type"] != "Explore" || stop["description"] != "Explore" || stop["stopped_at"] == "" || stop["timestamp"] == nil || stop["occurred_at"] == "" {
		t.Fatalf("subagent stop payload=%v", stop)
	}
}

func TestLegacyTaskHooksEmitCorrelatedSyntheticStartAndStop(t *testing.T) {
	var events []protocol.EventsAppendPayload
	agent := &Agent{sendMessage: func(messageType string, payload any) error {
		if messageType == "events.append" {
			events = append(events, payload.(protocol.EventsAppendPayload))
		}
		return nil
	}}
	hookData := map[string]any{
		"tool_name":   "Task",
		"tool_use_id": "tool-legacy",
		"tool_input":  map[string]any{"description": "inspect legacy flow"},
	}
	agent.handleWorkshopHookEvent("parent", "claude_code", "PreToolUse", hookData, "/tmp")
	postData := cloneJSONMap(hookData)
	postData["tool_response"] = map[string]any{"ok": true}
	agent.handleWorkshopHookEvent("parent", "claude_code", "PostToolUse", postData, "/tmp")

	wantTypes := []string{"workshop.subagent_start", "workshop.pre_tool_use", "workshop.subagent_stop", "workshop.post_tool_use"}
	if len(events) != len(wantTypes) {
		t.Fatalf("events=%v", events)
	}
	for i, want := range wantTypes {
		if events[i].EventType != want {
			t.Fatalf("event types=%v", events)
		}
	}
	start := events[0].Payload
	stop := events[2].Payload
	if start["tool_use_id"] != "tool-legacy" || stop["tool_use_id"] != "tool-legacy" || start["description"] != "inspect legacy flow" || stop["description"] != "inspect legacy flow" {
		t.Fatalf("start=%v stop=%v", start, stop)
	}
	if start["started_at"] == "" || stop["stopped_at"] == "" || stop["success"] != true {
		t.Fatalf("start=%v stop=%v", start, stop)
	}
}

func TestModernAgentToolDoesNotDuplicateNativeSubagentStart(t *testing.T) {
	var events []protocol.EventsAppendPayload
	agent := &Agent{sendMessage: func(messageType string, payload any) error {
		if messageType == "events.append" {
			events = append(events, payload.(protocol.EventsAppendPayload))
		}
		return nil
	}}
	agent.handleWorkshopHookEvent("parent", "claude_code", "PreToolUse", map[string]any{
		"tool_name":   "Agent",
		"tool_use_id": "tool-modern",
	}, "/tmp")
	if len(events) != 1 || events[0].EventType != "workshop.pre_tool_use" {
		t.Fatalf("events=%v", events)
	}
}

func TestPromptWaitsForVerifiedProviderReadiness(t *testing.T) {
	runner := &fakeTmuxRunner{}
	agent := &Agent{sessions: map[string]*SessionState{
		"child": {ID: "child", PaneID: "%2", Provider: "codex", Status: "RUNNING"},
	}}
	done := make(chan struct{})
	go func() {
		agent.sendPromptAfterReady("child", "%2", "do work", runner)
		close(done)
	}()
	time.Sleep(40 * time.Millisecond)
	if inputs := runner.inputSnapshot(); len(inputs) != 0 {
		t.Fatalf("prompt sent before provider readiness: %v", inputs)
	}
	agent.sessionsMu.Lock()
	agent.sessions["child"].Ready = true
	agent.sessionsMu.Unlock()
	select {
	case <-done:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("prompt was not sent after provider readiness")
	}
	if inputs := runner.inputSnapshot(); len(inputs) != 1 || inputs[0] != [3]any{"%2", "do work", true} {
		t.Fatalf("prompt inputs=%v", inputs)
	}
}

func TestPromptDeliveryDoesNotRaceSessionKill(t *testing.T) {
	runner := &fakeTmuxRunner{killStarted: make(chan struct{}), releaseKill: make(chan struct{})}
	agent := &Agent{
		cfg:              &config.Config{Security: config.SecurityConfig{AllowKill: true}},
		orchestratorTmux: runner,
		sendMessage:      func(string, any) error { return nil },
		sessions: map[string]*SessionState{
			"caller": {ID: "caller", PaneID: "%1", Status: "RUNNING"},
			"child":  {ID: "child", PaneID: "%2", Provider: "codex", Status: "RUNNING", Ready: true, ParentSessionID: "caller"},
		},
	}
	backend := &agentOrchestratorBackend{agent: agent}
	killDone := make(chan struct{})
	go func() {
		_, _ = backend.Kill(context.Background(), "caller", orchestrator.KillRequest{SessionID: "child"})
		close(killDone)
	}()
	<-runner.killStarted
	promptDone := make(chan struct{})
	go func() {
		agent.sendPromptAfterReady("child", "%2", "do not send", runner)
		close(promptDone)
	}()
	time.Sleep(40 * time.Millisecond)
	if inputs := runner.inputSnapshot(); len(inputs) != 0 {
		t.Fatalf("prompt raced kill: %v", inputs)
	}
	close(runner.releaseKill)
	<-killDone
	select {
	case <-promptDone:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("prompt waiter did not stop after kill")
	}
	if inputs := runner.inputSnapshot(); len(inputs) != 0 {
		t.Fatalf("prompt sent after kill: %v", inputs)
	}
}

func TestFailedLegacyAdoptionDoesNotRegisterPane(t *testing.T) {
	runner := &fakeTmuxRunner{optionError: "@ac_session_id"}
	agent := &Agent{
		cfg:              &config.Config{Security: config.SecurityConfig{AllowSpawn: true}, Tmux: config.TmuxConfig{OptionSessionID: "@ac_session_id"}},
		orchestratorTmux: runner,
		sessions:         map[string]*SessionState{},
	}
	err := agent.executeAdoptPane(json.RawMessage(`{"tmux_pane_id":"%9","title":"adopted"}`))
	if err == nil {
		t.Fatal("expected adoption stamp failure")
	}
	if len(agent.sessions) != 0 {
		t.Fatalf("failed adoption registered session: %v", agent.sessions)
	}
}

func TestLegacyKillSynchronouslyMarksSessionDone(t *testing.T) {
	runner := &fakeTmuxRunner{}
	agent := &Agent{
		cfg:              &config.Config{Security: config.SecurityConfig{AllowKill: true}},
		orchestratorTmux: runner,
		sendMessage:      func(string, any) error { return nil },
		sessions:         map[string]*SessionState{"child": {ID: "child", PaneID: "%2", Status: "RUNNING"}},
	}
	if err := agent.executeKillSession(agent.sessions["child"]); err != nil {
		t.Fatal(err)
	}
	if got := agent.sessions["child"]; got.Status != "DONE" || got.PaneID != "" || got.TmuxTarget != "" {
		t.Fatalf("killed session state=%+v", got)
	}
}

func TestFailedSpawnStampCleansUpCreatedPane(t *testing.T) {
	runner := &fakeTmuxRunner{
		window:      tmux.CreatedPane{PaneID: "%2", TmuxTarget: "agents:2.0"},
		optionError: parentSessionOption,
	}
	agent := &Agent{
		cfg:              &config.Config{Security: config.SecurityConfig{AllowSpawn: true}},
		orchestratorTmux: runner,
		sessions:         map[string]*SessionState{"parent": {ID: "parent", PaneID: "%1", TmuxTarget: "agents:1.0", Status: "RUNNING"}},
	}
	handler := orchestrator.NewHandler(&agentOrchestratorBackend{agent: agent})
	body, _ := json.Marshal(map[string]any{"provider": "shell", "cwd": t.TempDir(), "placement": "window"})
	req := httptest.NewRequest(http.MethodPost, "/v1/agent/spawn", bytes.NewReader(body))
	req.RemoteAddr = "127.0.0.1:4000"
	req.Header.Set(orchestrator.SessionHeader, "parent")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if len(runner.killed) != 1 || runner.killed[0] != "%2" {
		t.Fatalf("created pane was not cleaned up: killed=%v", runner.killed)
	}
}

func TestKillTreeAttemptsRemainingTargetsAfterPartialFailure(t *testing.T) {
	runner := &fakeTmuxRunner{killErrors: map[string]error{"%2": errors.New("already gone")}}
	agent := &Agent{
		cfg:              &config.Config{Security: config.SecurityConfig{AllowKill: true}},
		orchestratorTmux: runner,
		sendMessage:      func(string, any) error { return nil },
		sessions: map[string]*SessionState{
			"root":    {ID: "root", PaneID: "%1", Status: "RUNNING"},
			"child-a": {ID: "child-a", PaneID: "%2", Status: "RUNNING", ParentSessionID: "root"},
			"child-b": {ID: "child-b", PaneID: "%3", Status: "RUNNING", ParentSessionID: "root"},
		},
	}
	handler := orchestrator.NewHandler(&agentOrchestratorBackend{agent: agent})
	req := httptest.NewRequest(http.MethodPost, "/v1/agent/kill", bytes.NewBufferString(`{"session_id":"root","tree":true}`))
	req.RemoteAddr = "127.0.0.1:4000"
	req.Header.Set(orchestrator.SessionHeader, "root")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	wantAttempts := []string{"%2", "%3", "%1"}
	if len(runner.killed) != len(wantAttempts) {
		t.Fatalf("kill attempts=%v", runner.killed)
	}
	for i := range wantAttempts {
		if runner.killed[i] != wantAttempts[i] {
			t.Fatalf("kill attempts=%v", runner.killed)
		}
	}
	if agent.sessions["child-a"].Status != "RUNNING" || agent.sessions["child-b"].Status != "DONE" || agent.sessions["root"].Status != "DONE" {
		t.Fatalf("partial kill state: child-a=%s child-b=%s root=%s", agent.sessions["child-a"].Status, agent.sessions["child-b"].Status, agent.sessions["root"].Status)
	}
}

func TestConcurrentSpawnsRespectPerParentChildLimit(t *testing.T) {
	runner := &fakeTmuxRunner{window: tmux.CreatedPane{PaneID: "%2", TmuxTarget: "agents:2.0"}}
	agent := &Agent{
		cfg: &config.Config{
			Spawn:    config.SpawnConfig{MaxChildrenPerParent: 1},
			Security: config.SecurityConfig{AllowSpawn: true},
		},
		orchestratorTmux: runner,
		sendMessage:      func(string, any) error { return nil },
		sessions:         map[string]*SessionState{"parent": {ID: "parent", PaneID: "%1", TmuxTarget: "agents:1.0", Status: "RUNNING"}},
	}
	handler := orchestrator.NewHandler(&agentOrchestratorBackend{agent: agent})
	cwd := t.TempDir()
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{"provider": "shell", "cwd": cwd, "placement": "window"})
			req := httptest.NewRequest(http.MethodPost, "/v1/agent/spawn", bytes.NewReader(body))
			req.RemoteAddr = "127.0.0.1:4000"
			req.Header.Set(orchestrator.SessionHeader, "parent")
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			codes <- res.Code
		}()
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[http.StatusCreated] != 1 || counts[http.StatusTooManyRequests] != 1 {
		t.Fatalf("status counts=%v", counts)
	}
}

var _ TmuxRunner = (*fakeTmuxRunner)(nil)
