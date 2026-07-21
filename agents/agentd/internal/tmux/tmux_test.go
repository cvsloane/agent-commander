package tmux

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
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

	registered, err := client.rawHookCommands("after-new-window")
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

func TestHookCommandsFiltersAgentdSignalsFromSnapshot(t *testing.T) {
	client, tmuxCommand := newPrivateTmuxClient(t)
	for index, command := range []string{
		"display-message preserved-hook",
		"wait-for -S ac-agentd-123-stale-after-new-window",
	} {
		flag := "-g"
		if index > 0 {
			flag = "-ag"
		}
		if output, err := exec.Command(tmuxCommand, "set-hook", flag, "after-new-window", command).CombinedOutput(); err != nil {
			t.Fatalf("set hook %q: %v: %s", command, err, output)
		}
	}

	commands, err := client.hookCommands("after-new-window")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(commands, []string{"display-message preserved-hook"}) {
		t.Fatalf("filtered hook snapshot=%q", commands)
	}
}

func TestTopologyHooksRemoveStaleAgentdSignalsOnStartup(t *testing.T) {
	client, tmuxCommand := newPrivateTmuxClient(t)
	for index, command := range []string{
		"display-message preserved-hook",
		"wait-for -S ac-agentd-123-stale-after-new-window",
		"wait-for -S ac-agentd-456-stale-after-new-window",
	} {
		flag := "-g"
		if index > 0 {
			flag = "-ag"
		}
		if output, err := exec.Command(tmuxCommand, "set-hook", flag, "after-new-window", command).CombinedOutput(); err != nil {
			t.Fatalf("set hook %q: %v: %s", command, err, output)
		}
	}

	manager, err := client.StartTopologyHooks(nil)
	if err != nil {
		t.Fatalf("start topology hooks: %v", err)
	}
	closed := false
	defer func() {
		if !closed {
			manager.Close()
		}
	}()

	registered, err := client.rawHookCommands("after-new-window")
	if err != nil {
		t.Fatal(err)
	}
	if len(registered) != 2 || registered[0] != "display-message preserved-hook" ||
		!strings.HasPrefix(registered[1], "wait-for -S ac-agentd-") || strings.Contains(registered[1], "stale") {
		t.Fatalf("startup-cleaned hooks=%q", registered)
	}

	manager.Close()
	closed = true
	restored, err := client.rawHookCommands("after-new-window")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, []string{"display-message preserved-hook"}) {
		t.Fatalf("restored hooks=%q", restored)
	}
}

func TestCapturePaneRangePagesStableContiguousHistory(t *testing.T) {
	client, tmuxCommand := newPrivateTmuxClient(t)
	paneID, err := client.NewWindow("hook-test", "capture-range", "")
	if err != nil {
		t.Fatal(err)
	}
	signal := fmt.Sprintf("ac-capture-%d", time.Now().UnixNano())
	command := fmt.Sprintf("for i in $(seq 1 200); do printf 'PAGE-%%03d\\n' \"$i\"; done; tmux wait-for -S %s", signal)
	if err := client.SendInput(paneID, command, true); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(tmuxCommand, "wait-for", signal).CombinedOutput(); err != nil {
		t.Fatalf("wait for pane history: %v: %s", err, output)
	}

	options := func(start, end int) CapturePaneOptions {
		return CapturePaneOptions{Mode: CaptureModeRange, LineStart: start, LineEnd: end, StripANSI: true}
	}
	older, err := client.CapturePaneRange(paneID, options(-100, -81))
	if err != nil {
		t.Fatal(err)
	}
	newer, err := client.CapturePaneRange(paneID, options(-80, -61))
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := client.CapturePaneRange(paneID, options(-100, -81))
	if err != nil {
		t.Fatal(err)
	}
	if repeated != older {
		t.Fatalf("repeated history page changed:\nfirst: %q\nagain: %q", older, repeated)
	}

	olderNumbers := numberedPageLines(t, older)
	newerNumbers := numberedPageLines(t, newer)
	if len(olderNumbers) != 20 || len(newerNumbers) != 20 {
		t.Fatalf("page lengths older=%d newer=%d\nolder=%q\nnewer=%q", len(olderNumbers), len(newerNumbers), older, newer)
	}
	if olderNumbers[len(olderNumbers)-1]+1 != newerNumbers[0] {
		t.Fatalf("pages are not contiguous: older=%v newer=%v", olderNumbers, newerNumbers)
	}
	seen := make(map[int]bool, len(olderNumbers))
	for _, number := range olderNumbers {
		seen[number] = true
	}
	for _, number := range newerNumbers {
		if seen[number] {
			t.Fatalf("history pages overlap at PAGE-%03d", number)
		}
	}
}

func numberedPageLines(t *testing.T, capture string) []int {
	t.Helper()
	var numbers []int
	scanner := bufio.NewScanner(strings.NewReader(capture))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "PAGE-") {
			t.Fatalf("unexpected history line %q in %q", line, capture)
		}
		number, err := strconv.Atoi(strings.TrimPrefix(line, "PAGE-"))
		if err != nil {
			t.Fatalf("parse history line %q: %v", line, err)
		}
		numbers = append(numbers, number)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return numbers
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
	if pane.SessionAttachedClients != 2 {
		t.Fatalf("session attached clients=%d, want 2", pane.SessionAttachedClients)
	}
}
