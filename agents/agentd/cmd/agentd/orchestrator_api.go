package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/agent-command/agentd/internal/orchestrator"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
	"github.com/google/uuid"
)

const parentSessionOption = "@ac_parent_session_id"

type TmuxRunner interface {
	HasSession(name string) bool
	NewSession(name string) error
	CreateWindow(session, name, cwd string) (tmux.CreatedPane, error)
	SplitPane(target, name, cwd string) (tmux.CreatedPane, error)
	SetPaneOption(paneID, option, value string) error
	SendInput(paneID, input string, enter bool) error
	KillPane(paneID string) error
}

type agentOrchestratorBackend struct {
	agent *Agent
}

func (b *agentOrchestratorBackend) HasSession(sessionID string) bool {
	b.agent.sessionsMu.RLock()
	defer b.agent.sessionsMu.RUnlock()
	session, ok := b.agent.sessions[sessionID]
	return ok && session.Status != "DONE" && session.PaneID != ""
}

func (b *agentOrchestratorBackend) Spawn(_ context.Context, callerSessionID string, request orchestrator.SpawnRequest) (orchestrator.SpawnResponse, error) {
	if !b.agent.cfg.Security.AllowSpawn {
		return orchestrator.SpawnResponse{}, orchestrator.Forbidden("spawn not allowed by policy")
	}
	request.Provider = normalizeProviderOverride(request.Provider)
	if request.Provider == "" || request.Provider == "unknown" {
		return orchestrator.SpawnResponse{}, orchestrator.BadRequest("provider is not supported")
	}
	if request.Placement != "window" && request.Placement != "split" {
		return orchestrator.SpawnResponse{}, orchestrator.BadRequest("placement must be window or split")
	}
	info, err := os.Stat(request.CWD)
	if err != nil || !info.IsDir() {
		return orchestrator.SpawnResponse{}, orchestrator.BadRequest("cwd must be an existing directory")
	}

	b.agent.sessionsMu.RLock()
	parent, ok := b.agent.sessions[callerSessionID]
	if !ok {
		b.agent.sessionsMu.RUnlock()
		return orchestrator.SpawnResponse{}, orchestrator.NotFound("caller session not found")
	}
	parentSnapshot := *parent
	b.agent.sessionsMu.RUnlock()

	name := strings.TrimSpace(request.Name)
	if name == "" {
		name = request.Provider + "-worker"
	}
	runner := b.agent.localTmuxRunner()
	sessionID := uuid.New().String()
	launchCommand, err := b.agent.interactiveLaunchCommand(request.Provider, request.Flags, request.Env, sessionID)
	if err != nil {
		return orchestrator.SpawnResponse{}, orchestrator.BadRequest(err.Error())
	}
	b.agent.topologyMu.Lock()
	defer b.agent.topologyMu.Unlock()
	if !b.HasSession(callerSessionID) {
		return orchestrator.SpawnResponse{}, orchestrator.NotFound("caller session is no longer active")
	}
	if limit := b.agent.cfg.Spawn.MaxChildrenPerParent; limit > 0 {
		b.agent.sessionsMu.RLock()
		activeChildren := 0
		for _, session := range b.agent.sessions {
			if session.ParentSessionID == callerSessionID && session.Status != "DONE" && session.PaneID != "" {
				activeChildren++
			}
		}
		b.agent.sessionsMu.RUnlock()
		if activeChildren >= limit {
			return orchestrator.SpawnResponse{}, orchestrator.TooManyRequests("child session limit reached")
		}
	}
	var created tmux.CreatedPane
	if request.Placement == "window" {
		tmuxSession := tmuxSessionFromTarget(parentSnapshot.TmuxTarget)
		if tmuxSession == "" {
			tmuxSession = b.agent.cfg.Spawn.TmuxSessionName
		}
		if !runner.HasSession(tmuxSession) {
			if err := runner.NewSession(tmuxSession); err != nil {
				return orchestrator.SpawnResponse{}, fmt.Errorf("create tmux session: %w", err)
			}
		}
		created, err = runner.CreateWindow(tmuxSession, name, request.CWD)
	} else {
		target, targetErr := b.resolveSplitTarget(callerSessionID, request.SplitTarget)
		if targetErr != nil {
			return orchestrator.SpawnResponse{}, targetErr
		}
		created, err = runner.SplitPane(target, name, request.CWD)
	}
	if err != nil {
		return orchestrator.SpawnResponse{}, fmt.Errorf("create agent pane: %w", err)
	}
	committed := false
	registered := false
	defer func() {
		if committed {
			return
		}
		if registered {
			b.agent.sessionsMu.Lock()
			delete(b.agent.sessions, sessionID)
			b.agent.refreshHierarchyMetadataLocked()
			b.agent.sessionsMu.Unlock()
		}
		if err := runner.KillPane(created.PaneID); err != nil {
			log.Printf("Failed to clean up incomplete child pane %s: %v", created.PaneID, err)
		}
	}()

	optionSessionID := b.agent.cfg.Tmux.OptionSessionID
	if optionSessionID == "" {
		optionSessionID = "@ac_session_id"
	}
	for _, stamp := range [][2]string{
		{optionSessionID, sessionID},
		{parentSessionOption, callerSessionID},
		{"@ac_provider", request.Provider},
	} {
		if err := runner.SetPaneOption(created.PaneID, stamp[0], stamp[1]); err != nil {
			return orchestrator.SpawnResponse{}, fmt.Errorf("stamp child pane %s: %w", stamp[0], err)
		}
	}

	status := "STARTING"
	if request.Provider == "shell" {
		status = "IDLE"
	}
	now := time.Now().UTC()
	child := &SessionState{
		ID:              sessionID,
		PaneID:          created.PaneID,
		Kind:            "tmux_pane",
		Provider:        request.Provider,
		Status:          status,
		Title:           name,
		CWD:             request.CWD,
		TmuxTarget:      created.TmuxTarget,
		ParentSessionID: callerSessionID,
		Ready:           request.Provider == "shell",
		Metadata:        map[string]any{"parent_session_id": callerSessionID},
		LastActivity:    now,
		LastOutput:      now,
	}
	b.agent.sessionsMu.Lock()
	b.agent.sessions[sessionID] = child
	registered = true
	b.agent.refreshHierarchyMetadataLocked()
	updates := []protocol.SessionUpsert{sessionUpsert(child)}
	if parent := b.agent.sessions[callerSessionID]; parent != nil {
		updates = append(updates, sessionUpsert(parent))
	}
	b.agent.sessionsMu.Unlock()

	if launchCommand != "" {
		if err := runner.SendInput(created.PaneID, launchCommand, true); err != nil {
			return orchestrator.SpawnResponse{}, fmt.Errorf("launch child provider: %w", err)
		}
	}
	if request.Prompt != "" && status == "IDLE" {
		if err := runner.SendInput(created.PaneID, request.Prompt, true); err != nil {
			return orchestrator.SpawnResponse{}, fmt.Errorf("send child prompt: %w", err)
		}
	}
	committed = true
	b.agent.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updates})
	if request.Prompt != "" && status != "IDLE" {
		go b.agent.sendPromptAfterReady(sessionID, created.PaneID, request.Prompt, runner)
	}

	return orchestrator.SpawnResponse{SessionID: sessionID, TmuxTarget: created.TmuxTarget, PaneID: created.PaneID}, nil
}

func (b *agentOrchestratorBackend) ListSessions(_ context.Context, _ string) ([]orchestrator.Session, error) {
	b.agent.sessionsMu.RLock()
	defer b.agent.sessionsMu.RUnlock()
	children := make(map[string][]string)
	for _, session := range b.agent.sessions {
		if session.ParentSessionID != "" {
			children[session.ParentSessionID] = append(children[session.ParentSessionID], session.ID)
		}
	}
	result := make([]orchestrator.Session, 0, len(b.agent.sessions))
	for _, session := range b.agent.sessions {
		childIDs := append([]string(nil), children[session.ID]...)
		sort.Strings(childIDs)
		result = append(result, orchestrator.Session{
			SessionID:       session.ID,
			PaneID:          session.PaneID,
			TmuxTarget:      session.TmuxTarget,
			Provider:        session.Provider,
			Status:          session.Status,
			Title:           session.Title,
			CWD:             session.CWD,
			ParentSessionID: session.ParentSessionID,
			ChildSessionIDs: childIDs,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].SessionID < result[j].SessionID })
	return result, nil
}

func (b *agentOrchestratorBackend) Send(_ context.Context, _ string, request orchestrator.SendRequest) error {
	if !b.agent.cfg.Security.AllowSendInput {
		return orchestrator.Forbidden("send not allowed by policy")
	}
	if strings.TrimSpace(request.SessionID) == "" {
		return orchestrator.BadRequest("session_id is required")
	}
	b.agent.sessionsMu.RLock()
	session, ok := b.agent.sessions[request.SessionID]
	if !ok || session.PaneID == "" || session.Status == "DONE" {
		b.agent.sessionsMu.RUnlock()
		return orchestrator.NotFound("active session not found")
	}
	paneID := session.PaneID
	b.agent.sessionsMu.RUnlock()
	if err := b.agent.localTmuxRunner().SendInput(paneID, request.Input, request.ShouldEnter()); err != nil {
		return fmt.Errorf("send input: %w", err)
	}
	return nil
}

func (b *agentOrchestratorBackend) Kill(_ context.Context, _ string, request orchestrator.KillRequest) (orchestrator.KillResponse, error) {
	if !b.agent.cfg.Security.AllowKill {
		return orchestrator.KillResponse{}, orchestrator.Forbidden("kill not allowed by policy")
	}
	if strings.TrimSpace(request.SessionID) == "" {
		return orchestrator.KillResponse{}, orchestrator.BadRequest("session_id is required")
	}

	b.agent.topologyMu.Lock()
	defer b.agent.topologyMu.Unlock()
	b.agent.sessionsMu.RLock()
	if _, ok := b.agent.sessions[request.SessionID]; !ok {
		b.agent.sessionsMu.RUnlock()
		return orchestrator.KillResponse{}, orchestrator.NotFound("session not found")
	}
	ordered := b.killOrderLocked(request.SessionID, request.Tree)
	targets := make(map[string]string, len(ordered))
	for _, sessionID := range ordered {
		targets[sessionID] = b.agent.sessions[sessionID].PaneID
	}
	b.agent.sessionsMu.RUnlock()

	succeeded := make([]string, 0, len(ordered))
	failed := make([]string, 0)
	for _, sessionID := range ordered {
		paneID := targets[sessionID]
		if paneID == "" {
			succeeded = append(succeeded, sessionID)
			continue
		}
		if err := b.agent.localTmuxRunner().KillPane(paneID); err != nil {
			failed = append(failed, fmt.Sprintf("%s: %v", sessionID, err))
			continue
		}
		succeeded = append(succeeded, sessionID)
	}

	now := time.Now().UTC()
	updates := make([]protocol.SessionUpsert, 0, len(succeeded))
	b.agent.sessionsMu.Lock()
	for _, sessionID := range succeeded {
		session := b.agent.sessions[sessionID]
		if session == nil {
			continue
		}
		session.Status = "DONE"
		session.PaneID = ""
		session.TmuxTarget = ""
		session.LastActivity = now
	}
	b.agent.refreshHierarchyMetadataLocked()
	updatedIDs := make(map[string]bool, len(succeeded))
	for _, sessionID := range succeeded {
		if b.agent.sessions[sessionID] == nil {
			continue
		}
		updatedIDs[sessionID] = true
		update := sessionUpsert(b.agent.sessions[sessionID])
		update.ArchivedAt = protocol.String(now.Format(time.RFC3339))
		updates = append(updates, update)
	}
	for _, sessionID := range succeeded {
		if b.agent.sessions[sessionID] == nil {
			continue
		}
		parentID := b.agent.sessions[sessionID].ParentSessionID
		if parentID != "" && !updatedIDs[parentID] {
			if parent := b.agent.sessions[parentID]; parent != nil {
				updates = append(updates, sessionUpsert(parent))
				updatedIDs[parentID] = true
			}
		}
	}
	b.agent.sessionsMu.Unlock()
	if len(updates) > 0 {
		b.agent.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updates})
	}
	response := orchestrator.KillResponse{KilledSessionIDs: succeeded}
	if len(failed) > 0 {
		return response, orchestrator.InternalError(fmt.Sprintf("partial kill: killed=%v; failed=%s", succeeded, strings.Join(failed, "; ")))
	}
	return response, nil
}

func (b *agentOrchestratorBackend) killOrderLocked(rootSessionID string, tree bool) []string {
	if !tree {
		return []string{rootSessionID}
	}
	children := make(map[string][]string)
	for _, session := range b.agent.sessions {
		if session.ParentSessionID != "" {
			children[session.ParentSessionID] = append(children[session.ParentSessionID], session.ID)
		}
	}
	for parentID := range children {
		sort.Strings(children[parentID])
	}
	ordered := make([]string, 0)
	visited := make(map[string]bool)
	var visit func(string)
	visit = func(sessionID string) {
		if visited[sessionID] {
			return
		}
		visited[sessionID] = true
		for _, childID := range children[sessionID] {
			visit(childID)
		}
		ordered = append(ordered, sessionID)
	}
	visit(rootSessionID)
	return ordered
}

func (b *agentOrchestratorBackend) Wait(ctx context.Context, _ string, request orchestrator.WaitRequest) (orchestrator.WaitResponse, error) {
	if strings.TrimSpace(request.SessionID) == "" {
		return orchestrator.WaitResponse{}, orchestrator.BadRequest("session_id is required")
	}
	switch request.Until {
	case "done", "waiting", "any-change":
	default:
		return orchestrator.WaitResponse{}, orchestrator.BadRequest("until must be done, waiting, or any-change")
	}
	timeout, err := orchestrator.ValidateTimeout(request.TimeoutMS)
	if err != nil {
		return orchestrator.WaitResponse{}, err
	}
	initial, ok := b.sessionView(request.SessionID)
	if !ok {
		return orchestrator.WaitResponse{}, orchestrator.NotFound("session not found")
	}
	if request.Until != "any-change" && waitConditionMet(request.Until, initial.Status, initial.Status) {
		return orchestrator.WaitResponse{Session: initial}, nil
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return orchestrator.WaitResponse{}, ctx.Err()
		case <-timer.C:
			return orchestrator.WaitResponse{}, orchestrator.Timeout("wait timed out")
		case <-ticker.C:
			current, exists := b.sessionView(request.SessionID)
			if !exists {
				return orchestrator.WaitResponse{}, orchestrator.NotFound("session not found")
			}
			if waitConditionMet(request.Until, initial.Status, current.Status) {
				return orchestrator.WaitResponse{Session: current}, nil
			}
		}
	}
}

func waitConditionMet(until, initialStatus, currentStatus string) bool {
	switch until {
	case "done":
		return currentStatus == "DONE" || currentStatus == "ERROR"
	case "waiting":
		return currentStatus == "WAITING_FOR_INPUT" || currentStatus == "WAITING_FOR_APPROVAL" || currentStatus == "IDLE"
	case "any-change":
		return currentStatus != initialStatus
	default:
		return false
	}
}

func (b *agentOrchestratorBackend) sessionView(sessionID string) (orchestrator.Session, bool) {
	b.agent.sessionsMu.RLock()
	defer b.agent.sessionsMu.RUnlock()
	session, ok := b.agent.sessions[sessionID]
	if !ok {
		return orchestrator.Session{}, false
	}
	childIDs := make([]string, 0)
	for _, candidate := range b.agent.sessions {
		if candidate.ParentSessionID == sessionID {
			childIDs = append(childIDs, candidate.ID)
		}
	}
	sort.Strings(childIDs)
	return orchestrator.Session{
		SessionID:       session.ID,
		PaneID:          session.PaneID,
		TmuxTarget:      session.TmuxTarget,
		Provider:        session.Provider,
		Status:          session.Status,
		Title:           session.Title,
		CWD:             session.CWD,
		ParentSessionID: session.ParentSessionID,
		ChildSessionIDs: childIDs,
	}, true
}

func (a *Agent) sendPromptAfterReady(sessionID, paneID, prompt string, runner TmuxRunner) {
	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-timer.C:
			log.Printf("Timed out waiting for child session %s readiness", sessionID)
			return
		case <-ticker.C:
			a.topologyMu.Lock()
			a.sessionsMu.RLock()
			session, ok := a.sessions[sessionID]
			terminal := ok && (session.Status == "DONE" || session.Status == "ERROR")
			matchesPane := ok && session.PaneID == paneID
			ready := matchesPane && session.Ready && !terminal
			a.sessionsMu.RUnlock()
			if !ok || !matchesPane || terminal {
				a.topologyMu.Unlock()
				return
			}
			if !ready {
				a.topologyMu.Unlock()
				continue
			}
			if err := runner.SendInput(paneID, prompt, true); err != nil {
				log.Printf("Failed to send prompt to ready child session %s: %v", sessionID, err)
			}
			a.topologyMu.Unlock()
			return
		}
	}
}

func (b *agentOrchestratorBackend) Report(_ context.Context, callerSessionID string, request orchestrator.ReportRequest) error {
	switch request.Outcome {
	case "succeeded", "failed", "blocked":
	default:
		return orchestrator.BadRequest("outcome must be succeeded, failed, or blocked")
	}
	request.Summary = strings.TrimSpace(request.Summary)
	if request.Summary == "" {
		return orchestrator.BadRequest("summary is required")
	}
	payload := map[string]any{
		"outcome":     request.Outcome,
		"summary":     request.Summary,
		"reported_at": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if detail := strings.TrimSpace(request.Detail); detail != "" {
		payload["detail"] = detail
	}
	if err := b.agent.send(protocol.TypeEventsAppend, protocol.EventsAppendPayload{
		SessionID: callerSessionID,
		EventType: "orchestrator.report",
		Payload:   payload,
	}); err != nil {
		return fmt.Errorf("emit orchestrator report: %w", err)
	}
	return nil
}

func (a *Agent) localTmuxRunner() TmuxRunner {
	if a.orchestratorTmux != nil {
		return a.orchestratorTmux
	}
	return a.tmuxClient
}

func (b *agentOrchestratorBackend) resolveSplitTarget(callerSessionID, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	b.agent.sessionsMu.RLock()
	defer b.agent.sessionsMu.RUnlock()
	if requested == "" || requested == "self" {
		return b.agent.sessions[callerSessionID].PaneID, nil
	}
	for _, session := range b.agent.sessions {
		if session.PaneID == requested {
			return requested, nil
		}
	}
	return "", orchestrator.BadRequest("split_target must be self or a tracked pane id")
}

func tmuxSessionFromTarget(target string) string {
	target = strings.TrimSpace(target)
	if colon := strings.IndexByte(target, ':'); colon > 0 {
		return target[:colon]
	}
	return ""
}

func sessionUpsert(session *SessionState) protocol.SessionUpsert {
	update := protocol.SessionUpsert{
		ID:         session.ID,
		Kind:       session.Kind,
		Provider:   session.Provider,
		Status:     session.Status,
		Title:      protocol.String(session.Title),
		CWD:        protocol.String(session.CWD),
		TmuxPaneID: protocol.String(session.PaneID),
		TmuxTarget: protocol.String(session.TmuxTarget),
		Metadata:   protocol.NewSessionMetadata(cloneJSONMap(session.Metadata)),
	}
	if !session.LastActivity.IsZero() {
		update.LastActivityAt = session.LastActivity.UTC().Format(time.RFC3339)
	}
	if session.RepoRoot != "" {
		update.RepoRoot = protocol.String(session.RepoRoot)
	}
	if session.GitBranch != "" {
		update.GitBranch = protocol.String(session.GitBranch)
	}
	if session.GitRemote != "" {
		update.GitRemote = protocol.String(session.GitRemote)
	}
	if session.GroupID != "" {
		update.GroupID = protocol.String(session.GroupID)
	}
	if session.ForkedFrom != "" {
		update.ForkedFrom = protocol.String(session.ForkedFrom)
		update.ForkDepth = session.ForkDepth
	}
	return update
}

func (a *Agent) refreshHierarchyMetadataLocked() {
	rollups := make(map[string]map[string]int)
	for _, session := range a.sessions {
		if session.Metadata == nil {
			session.Metadata = map[string]any{}
		}
		if session.ParentSessionID == "" {
			delete(session.Metadata, "parent_session_id")
			continue
		}
		session.Metadata["parent_session_id"] = session.ParentSessionID
		if _, ok := a.sessions[session.ParentSessionID]; !ok {
			continue
		}
		rollup := rollups[session.ParentSessionID]
		if rollup == nil {
			rollup = make(map[string]int)
			rollups[session.ParentSessionID] = rollup
		}
		rollup[session.Status]++
	}
	for _, session := range a.sessions {
		if rollup := rollups[session.ID]; rollup != nil {
			session.Metadata["child_status_rollup"] = rollup
		} else {
			delete(session.Metadata, "child_status_rollup")
		}
	}
}
