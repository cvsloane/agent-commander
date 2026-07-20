package tmux

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/config"
)

func TestParsePaneLineIncludesSessionID(t *testing.T) {
	pane, ok := parsePaneLine("%7\t1234\tagents\tworker\t2\t1\t/tmp/repo\tcodex\tAgent\tcodex\tsession-123\tparent-456")
	if !ok {
		t.Fatal("pane line was not parsed")
	}
	if pane.PaneID != "%7" || pane.PanePID != 1234 || pane.SessionID != "session-123" {
		t.Fatalf("unexpected pane: %+v", pane)
	}
	if pane.ProviderOverride != "codex" || pane.GetTmuxTarget() != "agents:2.1" {
		t.Fatalf("unexpected pane metadata: %+v", pane)
	}
	if pane.ParentSessionID != "parent-456" {
		t.Fatalf("parent session id=%q", pane.ParentSessionID)
	}
}

func TestTmuxVersionSupportsHooks(t *testing.T) {
	tests := []struct {
		version string
		want    bool
	}{
		{version: "tmux 2.3", want: false},
		{version: "tmux 2.4", want: true},
		{version: "tmux 3.4", want: true},
		{version: "tmux next-3.5", want: true},
		{version: "not tmux", want: false},
	}
	for _, test := range tests {
		t.Run(test.version, func(t *testing.T) {
			if got := tmuxVersionSupportsHooks(test.version); got != test.want {
				t.Fatalf("tmuxVersionSupportsHooks(%q)=%v, want %v", test.version, got, test.want)
			}
		})
	}
}

func TestTopologyHooksAppendSignalAndRestoreExistingHooks(t *testing.T) {
	client, tmuxCommand := newPrivateTmuxClient(t)
	if output, err := exec.Command(tmuxCommand, "set-hook", "-g", "after-new-window", "display-message preserved-hook").CombinedOutput(); err != nil {
		t.Fatalf("set existing hook: %v: %s", err, output)
	}
	before, err := client.hookCommands("after-new-window")
	if err != nil {
		t.Fatal(err)
	}

	triggered := make(chan string, 1)
	manager, err := client.StartTopologyHooks(func(hookName string) {
		select {
		case triggered <- hookName:
		default:
		}
	})
	if err != nil {
		t.Fatalf("start topology hooks: %v", err)
	}
	closed := false
	defer func() {
		if !closed {
			manager.Close()
		}
	}()

	registered, err := client.hookCommands("after-new-window")
	if err != nil {
		t.Fatal(err)
	}
	if len(registered) != 2 || registered[0] != "display-message preserved-hook" || !strings.HasPrefix(registered[1], "wait-for -S ac-agentd-") {
		t.Fatalf("registered hooks=%q", registered)
	}
	if output, err := exec.Command(tmuxCommand, "new-window", "-d", "-t", "hook-test", "-n", "triggered", "sleep 30").CombinedOutput(); err != nil {
		t.Fatalf("trigger hook: %v: %s", err, output)
	}
	select {
	case hookName := <-triggered:
		if hookName != "after-new-window" {
			t.Fatalf("triggered hook=%q", hookName)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for topology hook")
	}

	manager.Close()
	closed = true
	after, err := client.hookCommands("after-new-window")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("restored hooks=%q, want %q", after, before)
	}
}

func newPrivateTmuxClient(t *testing.T) (*Client, string) {
	t.Helper()
	tmuxBin, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux is not installed")
	}
	label := fmt.Sprintf("ac-test-%d", time.Now().UnixNano())
	if output, err := exec.Command(tmuxBin, "-L", label, "new-session", "-d", "-s", "hook-test", "sleep 30").CombinedOutput(); err != nil {
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
	return NewClient(&config.TmuxConfig{Bin: wrapper}), wrapper
}

func TestParsePaneLineIncludesTopologyFields(t *testing.T) {
	pane, ok := parsePaneLine("%7\t1234\tagents\tworker\t2\t1\t/tmp/repo\tcodex\tAgent\tcodex\tsession-123\tparent-456\t1\t0\t1\ttiled\t190\t45\t1\t0\t2")
	if !ok {
		t.Fatal("pane line was not parsed")
	}
	if !pane.PaneActive || pane.WindowActive || !pane.WindowZoomed {
		t.Fatalf("unexpected active/zoomed flags: %+v", pane)
	}
	if pane.WindowLayout != "tiled" || pane.PaneWidth != 190 || pane.PaneHeight != 45 {
		t.Fatalf("unexpected layout/size fields: %+v", pane)
	}
	if !pane.WindowBell || pane.WindowActivity {
		t.Fatalf("unexpected window flags: %+v", pane)
	}
	if !pane.SessionAttached {
		t.Fatalf("session attached=%v, want true", pane.SessionAttached)
	}
}
