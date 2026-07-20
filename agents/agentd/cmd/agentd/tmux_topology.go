package main

import (
	"encoding/json"
	"log"
	"sort"
	"time"

	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
)

const tmuxTopologyDebounce = 500 * time.Millisecond

func buildTmuxTopology(reason string, panes []tmux.Pane) protocol.TmuxTopologyPayload {
	type windowKey struct {
		sessionName string
		windowIndex int
	}

	sessionsByName := make(map[string]*protocol.TmuxTopologySession)
	windowsByKey := make(map[windowKey]int)
	for _, pane := range panes {
		session := sessionsByName[pane.SessionName]
		if session == nil {
			session = &protocol.TmuxTopologySession{
				SessionName: pane.SessionName,
				Windows:     []protocol.TmuxTopologyWindow{},
			}
			sessionsByName[pane.SessionName] = session
		}
		session.Attached = session.Attached || pane.SessionAttached

		key := windowKey{sessionName: pane.SessionName, windowIndex: pane.WindowIndex}
		windowIndex, exists := windowsByKey[key]
		if !exists {
			session.Windows = append(session.Windows, protocol.TmuxTopologyWindow{
				WindowIndex: pane.WindowIndex,
				WindowName:  pane.WindowName,
				Active:      pane.WindowActive,
				Zoomed:      pane.WindowZoomed,
				Layout:      pane.WindowLayout,
				Bell:        pane.WindowBell,
				Activity:    pane.WindowActivity,
				Panes:       []protocol.TmuxTopologyPane{},
			})
			windowIndex = len(session.Windows) - 1
			windowsByKey[key] = windowIndex
		}
		window := &session.Windows[windowIndex]
		window.Panes = append(window.Panes, protocol.TmuxTopologyPane{
			PaneID:         pane.PaneID,
			PaneIndex:      pane.PaneIndex,
			Active:         pane.PaneActive,
			Width:          pane.PaneWidth,
			Height:         pane.PaneHeight,
			Title:          pane.PaneTitle,
			CurrentCommand: pane.CurrentCommand,
			CurrentPath:    pane.CurrentPath,
		})
	}

	sessions := make([]protocol.TmuxTopologySession, 0, len(sessionsByName))
	for _, session := range sessionsByName {
		sort.Slice(session.Windows, func(i, j int) bool {
			return session.Windows[i].WindowIndex < session.Windows[j].WindowIndex
		})
		for index := range session.Windows {
			sort.Slice(session.Windows[index].Panes, func(i, j int) bool {
				return session.Windows[index].Panes[i].PaneIndex < session.Windows[index].Panes[j].PaneIndex
			})
		}
		sessions = append(sessions, *session)
	}
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].SessionName < sessions[j].SessionName
	})

	return protocol.TmuxTopologyPayload{Reason: reason, TmuxSessions: sessions}
}

func tmuxTopologyHash(payload protocol.TmuxTopologyPayload) string {
	data, err := json.Marshal(payload.TmuxSessions)
	if err != nil {
		return ""
	}
	return hashString(string(data))
}

func (a *Agent) queueTmuxTopology(reason string, panes []tmux.Pane) {
	if a.cfg == nil || !a.cfg.Tmux.TopologyEvents {
		return
	}

	payload := buildTmuxTopology(reason, panes)
	hash := tmuxTopologyHash(payload)

	a.tmuxTopologyMu.Lock()
	defer a.tmuxTopologyMu.Unlock()
	if a.tmuxTopologyStopped {
		return
	}
	if reason == "poll" && (hash == a.lastTmuxTopologyHash || hash == a.pendingTmuxTopologyHash) {
		return
	}

	a.pendingTmuxTopology = &payload
	a.pendingTmuxTopologyHash = hash
	a.tmuxTopologyGeneration++
	generation := a.tmuxTopologyGeneration
	if a.tmuxTopologyTimer != nil {
		a.tmuxTopologyTimer.Stop()
	}
	a.tmuxTopologyTimer = time.AfterFunc(tmuxTopologyDebounce, func() {
		a.emitPendingTmuxTopology(generation)
	})
}

func (a *Agent) emitPendingTmuxTopology(generation uint64) {
	a.tmuxTopologyMu.Lock()
	if a.tmuxTopologyStopped || generation != a.tmuxTopologyGeneration || a.pendingTmuxTopology == nil {
		a.tmuxTopologyMu.Unlock()
		return
	}
	payload := *a.pendingTmuxTopology
	hash := a.pendingTmuxTopologyHash
	a.pendingTmuxTopology = nil
	a.pendingTmuxTopologyHash = ""
	a.tmuxTopologyTimer = nil
	a.tmuxTopologyMu.Unlock()

	if err := a.send(protocol.TypeTmuxTopology, payload); err != nil {
		log.Printf("Failed to emit tmux topology (%s): %v", payload.Reason, err)
		return
	}
	a.tmuxTopologyMu.Lock()
	a.lastTmuxTopologyHash = hash
	a.tmuxTopologyMu.Unlock()
}

func (a *Agent) stopTmuxTopology() {
	a.tmuxTopologyMu.Lock()
	defer a.tmuxTopologyMu.Unlock()
	a.tmuxTopologyStopped = true
	a.tmuxTopologyGeneration++
	if a.tmuxTopologyTimer != nil {
		a.tmuxTopologyTimer.Stop()
		a.tmuxTopologyTimer = nil
	}
	a.pendingTmuxTopology = nil
	a.pendingTmuxTopologyHash = ""
}
