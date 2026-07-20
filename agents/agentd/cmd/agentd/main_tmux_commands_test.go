package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/commands"
	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
)

func TestExecuteNewWindowAgainstPrivateTmux(t *testing.T) {
	agent, client, _ := newPrivateCommandAgent(t)

	result, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command: protocol.Command{
			Type:    "new_window",
			Payload: []byte(fmt.Sprintf(`{"window_name":"scratch","cwd":%q}`, t.TempDir())),
		},
	})
	if err != nil {
		t.Fatalf("execute new_window: %v", err)
	}
	if result["pane_id"] == "" {
		t.Fatalf("new_window result=%+v", result)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	if len(panes) != 2 || panes[1].WindowName != "scratch" {
		t.Fatalf("panes after new_window=%+v", panes)
	}
}

func TestExecuteRenameWindowAgainstPrivateTmux(t *testing.T) {
	agent, client, _ := newPrivateCommandAgent(t)
	if _, err := client.NewWindow("command-test", "scratch", ""); err != nil {
		t.Fatal(err)
	}
	windowIndex := 1
	payload, err := json.Marshal(protocol.RenameWindowPayload{WindowIndex: &windowIndex, Name: "builds"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "rename_window", Payload: payload},
	}); err != nil {
		t.Fatalf("execute rename_window: %v", err)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.WindowIndex == 1 && pane.WindowName == "builds" {
			return
		}
	}
	t.Fatalf("renamed window not found: %+v", panes)
}

func TestExecuteKillWindowAgainstPrivateTmux(t *testing.T) {
	agent, client, _ := newPrivateCommandAgent(t)
	if _, err := client.NewWindow("command-test", "disposable", ""); err != nil {
		t.Fatal(err)
	}
	windowIndex := 1
	payload, err := json.Marshal(protocol.KillWindowPayload{WindowIndex: &windowIndex})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "kill_window", Payload: payload},
	}); err != nil {
		t.Fatalf("execute kill_window: %v", err)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.WindowIndex == 1 {
			t.Fatalf("killed window still present: %+v", panes)
		}
	}
}

func TestExecuteSelectWindowAgainstPrivateTmux(t *testing.T) {
	agent, client, _ := newPrivateCommandAgent(t)
	if _, err := client.NewWindow("command-test", "select-me", ""); err != nil {
		t.Fatal(err)
	}
	windowIndex := 0
	payload, err := json.Marshal(protocol.SelectWindowPayload{WindowIndex: &windowIndex})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "select_window", Payload: payload},
	}); err != nil {
		t.Fatalf("execute select_window: %v", err)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.WindowIndex == 0 && pane.WindowActive {
			return
		}
	}
	t.Fatalf("selected window is not active: %+v", panes)
}

func TestExecuteSplitPaneAgainstPrivateTmux(t *testing.T) {
	agent, client, original := newPrivateCommandAgent(t)
	percent := 40
	cwd := t.TempDir()
	payload, err := json.Marshal(protocol.SplitPanePayload{
		Direction: "horizontal",
		Percent:   &percent,
		CWD:       cwd,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "split_pane", Payload: payload},
	})
	if err != nil {
		t.Fatalf("execute split_pane: %v", err)
	}
	createdPaneID, _ := result["pane_id"].(string)
	if createdPaneID == "" {
		t.Fatalf("split_pane result=%+v", result)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.PaneID == createdPaneID {
			if pane.WindowIndex != original.WindowIndex || pane.CurrentPath != cwd || pane.PaneWidth >= original.PaneWidth {
				t.Fatalf("created split=%+v original=%+v", pane, original)
			}
			return
		}
	}
	t.Fatalf("created pane %s not found: %+v", createdPaneID, panes)
}

func TestExecuteSelectPaneAgainstPrivateTmux(t *testing.T) {
	agent, client, original := newPrivateCommandAgent(t)
	if _, err := client.SplitPaneWithOptions(original.PaneID, "horizontal", nil, ""); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(protocol.SelectPanePayload{PaneID: original.PaneID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "select_pane", Payload: payload},
	}); err != nil {
		t.Fatalf("execute select_pane: %v", err)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.PaneID == original.PaneID && pane.PaneActive {
			return
		}
	}
	t.Fatalf("selected pane is not active: %+v", panes)
}

func TestExecuteResizePaneAgainstPrivateTmux(t *testing.T) {
	agent, client, original := newPrivateCommandAgent(t)
	created, err := client.SplitPaneWithOptions(original.PaneID, "horizontal", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	width := 50
	payload, err := json.Marshal(protocol.ResizePanePayload{PaneID: created.PaneID, Width: &width})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "resize_pane", Payload: payload},
	}); err != nil {
		t.Fatalf("execute resize_pane: %v", err)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.PaneID == created.PaneID {
			if pane.PaneWidth != width {
				t.Fatalf("resized pane width=%d, want %d", pane.PaneWidth, width)
			}
			return
		}
	}
	t.Fatalf("resized pane %s not found: %+v", created.PaneID, panes)
}

func TestExecuteZoomPaneAgainstPrivateTmux(t *testing.T) {
	agent, client, original := newPrivateCommandAgent(t)
	created, err := client.SplitPaneWithOptions(original.PaneID, "horizontal", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(protocol.ZoomPanePayload{PaneID: created.PaneID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.executeCommand(commands.Dispatch{
		SessionID: "session-1",
		Command:   protocol.Command{Type: "zoom_pane", Payload: payload},
	}); err != nil {
		t.Fatalf("execute zoom_pane: %v", err)
	}
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatal(err)
	}
	for _, pane := range panes {
		if pane.PaneID == created.PaneID && pane.WindowZoomed {
			return
		}
	}
	t.Fatalf("pane window is not zoomed: %+v", panes)
}

func newPrivateCommandAgent(t *testing.T) (*Agent, *tmux.Client, tmux.Pane) {
	t.Helper()
	client := newPrivateCommandTmux(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial panes=%+v err=%v", panes, err)
	}
	agent := &Agent{
		cfg: &config.Config{Security: config.SecurityConfig{
			AllowSpawn:     true,
			AllowKill:      true,
			AllowSendInput: true,
		}},
		tmuxClient: client,
		sessions: map[string]*SessionState{
			"session-1": {ID: "session-1", PaneID: panes[0].PaneID, TmuxTarget: panes[0].GetTmuxTarget()},
		},
	}
	return agent, client, panes[0]
}

func newPrivateCommandTmux(t *testing.T) *tmux.Client {
	t.Helper()
	tmuxBin, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux is not installed")
	}
	label := fmt.Sprintf("ac-test-%d", time.Now().UnixNano())
	if output, err := exec.Command(tmuxBin, "-L", label, "new-session", "-d", "-x", "160", "-y", "50", "-s", "command-test", "sleep 30").CombinedOutput(); err != nil {
		t.Fatalf("start private tmux: %v: %s", err, output)
	}
	t.Cleanup(func() {
		_ = exec.Command(tmuxBin, "-L", label, "kill-server").Run()
	})

	wrapper := filepath.Join(t.TempDir(), "tmux-private")
	script := fmt.Sprintf("#!/bin/sh\nexec %q -L %q \"$@\"\n", tmuxBin, label)
	if err := os.WriteFile(wrapper, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	return tmux.NewClient(&config.TmuxConfig{Bin: wrapper})
}
