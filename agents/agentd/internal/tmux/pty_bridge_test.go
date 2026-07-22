package tmux

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPtyBridgeCreatesGroupedReadOnlyViewerAtRequestedSize(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")

	bridge, err := newViewerPTYBridge(runner, viewerPTYOptions{
		ChannelID:   "channel-1",
		PaneID:      "%7",
		ReadOnly:    true,
		Cols:        132,
		Rows:        43,
		ResumeToken: "resume-1",
	})
	if err != nil {
		t.Fatalf("newViewerPTYBridge: %v", err)
	}
	defer bridge.close(false)

	wantRuns := [][]string{
		{"new-session", "-d", "-t", "agents", "-s", "ac-view-channel-1"},
		{"select-window", "-t", "ac-view-channel-1:2"},
		{"select-pane", "-t", "ac-view-channel-1:2.1"},
		{"set-option", "-p", "-t", "%7", resumeOptionName("resume-1"), "resume-1"},
	}
	if !reflect.DeepEqual(runner.runs, wantRuns) {
		t.Fatalf("tmux lifecycle commands:\n got: %#v\nwant: %#v", runner.runs, wantRuns)
	}
	if got, want := runner.startArgs, []string{"attach-session", "-r", "-t", "ac-view-channel-1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("attach args=%v, want=%v", got, want)
	}
	if got, want := runner.startSize, (TerminalSize{Cols: 132, Rows: 43}); got != want {
		t.Fatalf("initial size=%+v, want=%+v", got, want)
	}
}

func TestViewerPTYBridgePinsAndReleasesLetterboxedWindow(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")

	bridge, err := newViewerPTYBridge(runner, viewerPTYOptions{
		ChannelID:   "channel-1",
		PaneID:      "%7",
		Cols:        160,
		Rows:        50,
		Letterbox:   true,
		ResumeToken: "resume-1",
	})
	if err != nil {
		t.Fatalf("newViewerPTYBridge: %v", err)
	}
	if !runner.hasRun([]string{"set-option", "-w", "-t", "ac-view-channel-1:2", "window-size", "manual"}) {
		t.Fatal("letterboxed window was not pinned to manual sizing")
	}
	if !runner.hasRun([]string{"resize-window", "-t", "ac-view-channel-1:2", "-x", "160", "-y", "50"}) {
		t.Fatal("letterboxed window was not resized to the requested grid")
	}

	bridge.close(false)
	if !runner.hasRun([]string{"set-option", "-w", "-t", "ac-view-channel-1:2", "window-size", "latest"}) {
		t.Fatal("letterboxed window did not release latest sizing on close")
	}
}

func TestViewerPTYBridgeMovesLetterboxPinWhenSelectingWindow(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	bridge, err := newViewerPTYBridge(runner, viewerPTYOptions{
		ChannelID:   "channel-1",
		PaneID:      "%7",
		Cols:        160,
		Rows:        50,
		Letterbox:   true,
		ResumeToken: "resume-1",
	})
	if err != nil {
		t.Fatalf("newViewerPTYBridge: %v", err)
	}
	defer bridge.close(false)

	if err := bridge.SelectWindow(3); err != nil {
		t.Fatalf("select letterboxed viewer window: %v", err)
	}
	for _, want := range [][]string{
		{"set-option", "-w", "-t", "ac-view-channel-1:2", "window-size", "latest"},
		{"select-window", "-t", "ac-view-channel-1:3"},
		{"set-option", "-w", "-t", "ac-view-channel-1:3", "window-size", "manual"},
		{"resize-window", "-t", "ac-view-channel-1:3", "-x", "160", "-y", "50"},
	} {
		if !runner.hasRun(want) {
			t.Fatalf("missing letterbox navigation command %v; runs=%v", want, runner.runs)
		}
	}
}

func TestViewerPTYBridgeLetterboxUsesPrivateTmuxSocket(t *testing.T) {
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatalf("list private panes: %v", err)
	}
	if len(panes) != 1 {
		t.Fatalf("private pane count=%d, want 1", len(panes))
	}
	runner := newExecTmuxRunner(client)
	bridge, err := newViewerPTYBridge(runner, viewerPTYOptions{
		ChannelID:   "letterbox-integration",
		PaneID:      panes[0].PaneID,
		Cols:        120,
		Rows:        40,
		Letterbox:   true,
		ResumeToken: "resume-integration",
	})
	if err != nil {
		t.Fatalf("newViewerPTYBridge on private socket: %v", err)
	}

	if output, err := runner.Output("show-options", "-w", "-v", "-t", "hook-test:0", "window-size"); err != nil {
		t.Fatalf("show pinned window-size: %v", err)
	} else if got := strings.TrimSpace(string(output)); got != "manual" {
		t.Fatalf("pinned window-size=%q, want manual", got)
	}
	if output, err := runner.Output("display-message", "-p", "-t", "hook-test:0", "#{window_width}x#{window_height}"); err != nil {
		t.Fatalf("show pinned dimensions: %v", err)
	} else if got := strings.TrimSpace(string(output)); got != "120x40" {
		t.Fatalf("pinned dimensions=%q, want 120x40", got)
	}

	bridge.close(false)
	if output, err := runner.Output("show-options", "-w", "-v", "-t", "hook-test:0", "window-size"); err != nil {
		t.Fatalf("show released window-size: %v", err)
	} else if got := strings.TrimSpace(string(output)); got != "latest" {
		t.Fatalf("released window-size=%q, want latest", got)
	}
}

func TestTerminalNavigateSelectWindowUsesViewerSessionOnPrivateTmuxSocket(t *testing.T) {
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	if _, err := client.NewWindow("hook-test", "second", ""); err != nil {
		t.Fatalf("create second private window: %v", err)
	}
	if err := client.SelectWindow("hook-test:0"); err != nil {
		t.Fatalf("restore origin window: %v", err)
	}

	runner := newExecTmuxRunner(client)
	manager := newTerminalManagerWithRunner(client, runner, t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("navigate-integration", panes[0].PaneID, AttachOptions{
		SessionID: "session-1",
		Cols:      120,
		Rows:      40,
	}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}

	if err := manager.Navigate("navigate-integration", TerminalNavigation{Op: NavigateSelectWindow, WindowIndex: 1}); err != nil {
		t.Fatalf("navigate viewer window: %v", err)
	}

	if output, err := runner.Output("display-message", "-p", "-t", "hook-test", "#{window_index}"); err != nil {
		t.Fatalf("read origin current window: %v", err)
	} else if got := strings.TrimSpace(string(output)); got != "0" {
		t.Fatalf("origin current window=%q, want 0", got)
	}
	if output, err := runner.Output("display-message", "-p", "-t", viewerSessionName("navigate-integration"), "#{window_index}"); err != nil {
		t.Fatalf("read viewer current window: %v", err)
	} else if got := strings.TrimSpace(string(output)); got != "1" {
		t.Fatalf("viewer current window=%q, want 1", got)
	}
}

func TestTerminalNavigateSelectPaneUsesViewerSessionOnPrivateTmuxSocket(t *testing.T) {
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	originPaneID := panes[0].PaneID
	target, err := client.SplitPaneWithOptions(originPaneID, "horizontal", nil, "")
	if err != nil {
		t.Fatalf("split private pane: %v", err)
	}
	if err := client.SelectPane(originPaneID); err != nil {
		t.Fatalf("restore origin pane: %v", err)
	}

	runner := newExecTmuxRunner(client)
	manager := newTerminalManagerWithRunner(client, runner, t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("pane-navigation", originPaneID, AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if err := manager.Navigate("pane-navigation", TerminalNavigation{Op: NavigateSelectPane, PaneID: target.PaneID}); err != nil {
		t.Fatalf("navigate viewer pane: %v", err)
	}

	if output, err := runner.Output("display-message", "-p", "-t", "hook-test", "#{window_index}"); err != nil {
		t.Fatalf("read origin current window: %v", err)
	} else if got := strings.TrimSpace(string(output)); got != "0" {
		t.Fatalf("origin current window=%q, want 0", got)
	}
	if output, err := runner.Output("display-message", "-p", "-t", viewerSessionName("pane-navigation"), "#{pane_id}"); err != nil {
		t.Fatalf("read viewer current pane: %v", err)
	} else if got := strings.TrimSpace(string(output)); got != target.PaneID {
		t.Fatalf("viewer current pane=%q, want %q", got, target.PaneID)
	}
}

func TestTerminalFocusPaneSelectsAndZoomsVerifiedTargetOnPrivateTmuxSocket(t *testing.T) {
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	target, err := client.SplitPaneWithOptions(panes[0].PaneID, "horizontal", nil, "")
	if err != nil {
		t.Fatalf("split private pane: %v", err)
	}

	manager := newTerminalManagerWithRunner(client, newExecTmuxRunner(client), t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("focus-pane", panes[0].PaneID, AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}

	state, err := manager.FocusPane("focus-pane", target.PaneID, true)
	if err != nil {
		t.Fatalf("focus viewer pane: %v", err)
	}
	if state.PaneID != target.PaneID || state.WindowIndex != 0 || !state.Zoomed {
		t.Fatalf("verified viewer state=%+v, want pane=%s window=0 zoomed", state, target.PaneID)
	}
}

type failFirstZoomRunner struct {
	TmuxRunner
	failed bool
}

func (r *failFirstZoomRunner) Run(args ...string) error {
	if !r.failed && len(args) >= 2 && args[0] == "resize-pane" && args[1] == "-Z" {
		r.failed = true
		return errors.New("injected zoom failure")
	}
	return r.TmuxRunner.Run(args...)
}

func TestTerminalFocusPaneRollsBackWhenZoomFails(t *testing.T) {
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	originPaneID := panes[0].PaneID
	target, err := client.SplitPaneWithOptions(originPaneID, "horizontal", nil, "")
	if err != nil {
		t.Fatalf("split private pane: %v", err)
	}

	runner := &failFirstZoomRunner{TmuxRunner: newExecTmuxRunner(client)}
	manager := newTerminalManagerWithRunner(client, runner, t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("focus-rollback", originPaneID, AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}

	if _, err := manager.FocusPane("focus-rollback", target.PaneID, true); err == nil {
		t.Fatal("focus unexpectedly succeeded")
	}
	state, err := manager.viewerByChannel["focus-rollback"].bridge.State()
	if err != nil {
		t.Fatalf("read rolled-back viewer state: %v", err)
	}
	if state.PaneID != originPaneID || state.Zoomed {
		t.Fatalf("viewer state after failed focus=%+v, want pane=%s unzoomed", state, originPaneID)
	}
}

func TestTerminalNavigateZoomSetsRequestedStateOnPrivateTmuxSocket(t *testing.T) {
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	if _, err := client.SplitPaneWithOptions(panes[0].PaneID, "horizontal", nil, ""); err != nil {
		t.Fatalf("split private pane: %v", err)
	}

	manager := newTerminalManagerWithRunner(client, newExecTmuxRunner(client), t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("zoom-navigation", panes[0].PaneID, AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if err := manager.Navigate("zoom-navigation", TerminalNavigation{Op: NavigateZoom, On: true}); err != nil {
		t.Fatalf("enable viewer zoom: %v", err)
	}
	assertWindowZoomed(t, client, true)

	// The operation is a state setter, not resize-pane's raw toggle.
	if err := manager.Navigate("zoom-navigation", TerminalNavigation{Op: NavigateZoom, On: true}); err != nil {
		t.Fatalf("keep viewer zoom enabled: %v", err)
	}
	assertWindowZoomed(t, client, true)

	if err := manager.Navigate("zoom-navigation", TerminalNavigation{Op: NavigateZoom, On: false}); err != nil {
		t.Fatalf("disable viewer zoom: %v", err)
	}
	assertWindowZoomed(t, client, false)
}

func TestTerminalNavigateScrollsExistingCopyModeOnPrivateTmuxSocket(t *testing.T) {
	manager, runner, paneID := newScrollablePrivateViewer(t, "copy-scroll")
	if err := runner.Run("copy-mode", "-e", "-t", paneID); err != nil {
		t.Fatalf("enter copy mode: %v", err)
	}
	before := privatePaneScrollPosition(t, runner, paneID)
	if err := manager.Navigate("copy-scroll", TerminalNavigation{Op: NavigateScroll, Lines: -7}); err != nil {
		t.Fatalf("scroll existing copy mode: %v", err)
	}
	after := privatePaneScrollPosition(t, runner, paneID)
	if after-before != 7 {
		t.Fatalf("copy-mode scroll position changed by %d, want 7 (before=%d after=%d)", after-before, before, after)
	}
}

func TestTerminalNavigateScrollEntersAndAutoExitsCopyModeOnPrivateTmuxSocket(t *testing.T) {
	manager, runner, paneID := newScrollablePrivateViewer(t, "live-scroll")
	if err := manager.Navigate("live-scroll", TerminalNavigation{Op: NavigateScroll, Lines: 12}); err != nil {
		t.Fatalf("scroll down at live view: %v", err)
	}
	if got := privatePaneFormat(t, runner, paneID, "#{pane_in_mode}"); got != "0" {
		t.Fatalf("live scroll-down entered copy mode: pane_in_mode=%q", got)
	}

	if err := manager.Navigate("live-scroll", TerminalNavigation{Op: NavigateScroll, Lines: -5}); err != nil {
		t.Fatalf("scroll live view into history: %v", err)
	}
	if got := privatePaneFormat(t, runner, paneID, "#{pane_in_mode}"); got != "1" {
		t.Fatalf("scroll-up did not enter copy mode: pane_in_mode=%q", got)
	}
	if got := privatePaneScrollPosition(t, runner, paneID); got != 5 {
		t.Fatalf("entered copy mode at scroll position %d, want 5", got)
	}

	if err := manager.Navigate("live-scroll", TerminalNavigation{Op: NavigateScroll, Lines: 120}); err != nil {
		t.Fatalf("scroll copy mode back to live: %v", err)
	}
	if got := privatePaneFormat(t, runner, paneID, "#{pane_in_mode}"); got != "0" {
		t.Fatalf("copy-mode -e did not auto-exit at live view: pane_in_mode=%q", got)
	}
}

func TestTerminalNavigateScrollPassesWheelReportsToMouseAppOnPrivateTmuxSocket(t *testing.T) {
	manager, runner, paneID, capturePath := newAlternateCaptureViewer(t, "mouse-scroll", true)
	state := strings.Split(privatePaneFormat(
		t, runner, paneID, "#{alternate_on}\t#{mouse_any_flag}\t#{pane_width}\t#{pane_height}",
	), "\t")
	if len(state) != 4 || state[0] != "1" || state[1] != "1" {
		t.Fatalf("mouse app state=%q, want alternate+mouse", strings.Join(state, "\t"))
	}
	width, widthErr := strconv.Atoi(state[2])
	height, heightErr := strconv.Atoi(state[3])
	if widthErr != nil || heightErr != nil {
		t.Fatalf("parse mouse app dimensions %q: width=%v height=%v", state, widthErr, heightErr)
	}
	report := fmt.Sprintf("\x1b[<64;%d;%dM", (width+1)/2, (height+1)/2)
	want := report + report

	if err := manager.Navigate("mouse-scroll", TerminalNavigation{Op: NavigateScroll, Lines: -7}); err != nil {
		t.Fatalf("scroll mouse app: %v", err)
	}
	if got := waitForCapturedInput(t, capturePath, len(want)); got != want {
		t.Fatalf("mouse app input=%q, want %q", got, want)
	}
}

func TestTerminalNavigateScrollSendsArrowsToAlternateAppOnPrivateTmuxSocket(t *testing.T) {
	manager, runner, paneID, capturePath := newAlternateCaptureViewer(t, "alternate-scroll", false)
	if got := privatePaneFormat(t, runner, paneID, "#{alternate_on}\t#{mouse_any_flag}"); got != "1\t0" {
		t.Fatalf("alternate app state=%q, want alternate without mouse", got)
	}
	want := strings.Repeat("\x1b[A", 4)

	if err := manager.Navigate("alternate-scroll", TerminalNavigation{Op: NavigateScroll, Lines: -4}); err != nil {
		t.Fatalf("scroll alternate app: %v", err)
	}
	if got := waitForCapturedInput(t, capturePath, len(want)); got != want {
		t.Fatalf("alternate app input=%q, want %q", got, want)
	}
}

func TestTerminalDetachUnzoomsChannelAppliedFocusOnPrivateTmuxSocket(t *testing.T) {
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	if _, err := client.SplitPaneWithOptions(panes[0].PaneID, "horizontal", nil, ""); err != nil {
		t.Fatalf("split private pane: %v", err)
	}

	manager := newTerminalManagerWithRunner(client, newExecTmuxRunner(client), t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("detach-zoom", panes[0].PaneID, AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if err := manager.Navigate("detach-zoom", TerminalNavigation{Op: NavigateZoom, On: true}); err != nil {
		t.Fatalf("enable viewer zoom: %v", err)
	}
	assertWindowZoomed(t, client, true)

	manager.Detach("detach-zoom")
	assertWindowZoomed(t, client, false)
}

func TestTerminalNavigationUnzoomsAppliedFocusBeforeSwitchingWindows(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("switch-focused", "%7", AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if err := manager.Navigate("switch-focused", TerminalNavigation{Op: NavigateZoom, On: true}); err != nil {
		t.Fatalf("enable viewer zoom: %v", err)
	}
	if err := manager.Navigate("switch-focused", TerminalNavigation{Op: NavigateSelectWindow, WindowIndex: 3}); err != nil {
		t.Fatalf("switch focused viewer window: %v", err)
	}

	if got := runner.lastRunIndex([]string{"resize-pane", "-Z", "-t", "ac-view-switch-focused:"}); got < 0 {
		t.Fatal("focused viewer was never unzoomed")
	} else if selected := runner.runIndex([]string{"select-window", "-t", "ac-view-switch-focused:3"}); selected < 0 || got > selected {
		t.Fatalf("unzoom index=%d select index=%d; runs=%v", got, selected, runner.runs)
	}
	manager.mu.RLock()
	zoomApplied := manager.viewerByChannel["switch-focused"].zoomApplied
	manager.mu.RUnlock()
	if zoomApplied {
		t.Fatal("viewer still records applied zoom after switching away")
	}
}

func TestTerminalNavigateScrollClampsAndRejectsReadOnlyViewers(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	stateFormat := "#{pane_id}\t#{pane_in_mode}\t#{alternate_on}\t#{mouse_any_flag}\t#{pane_width}\t#{pane_height}"
	runner.outputs["display-message -p -t ac-view-controller "+stateFormat] = []byte("%7\t1\t0\t0\t80\t24\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("controller", "%7", AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach controller: %v", err)
	}
	if _, err := manager.AttachWithOptions("readonly", "%7", AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach read-only viewer: %v", err)
	}

	if err := manager.Navigate("controller", TerminalNavigation{Op: NavigateScroll, Lines: -999}); err != nil {
		t.Fatalf("scroll controller: %v", err)
	}
	if !runner.hasRun([]string{"send-keys", "-X", "-t", "%7", "-N", "120", "scroll-up"}) {
		t.Fatalf("scroll was not clamped to 120 lines; runs=%v", runner.runs)
	}
	if err := manager.Navigate("readonly", TerminalNavigation{Op: NavigateScroll, Lines: -3}); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("read-only scroll error=%v, want ErrReadOnly", err)
	}
}

func TestTerminalDroppedAndSweptViewerUnzoomsAppliedFocus(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()
	attached, err := manager.AttachWithOptions("stale-focused", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if err := manager.Navigate("stale-focused", TerminalNavigation{Op: NavigateZoom, On: true}); err != nil {
		t.Fatalf("enable viewer zoom: %v", err)
	}

	manager.MarkChannelsStale()
	if runner.zoomState() {
		t.Fatal("dropped channel left its applied zoom active")
	}

	manager.mu.Lock()
	viewer := manager.viewerByToken[attached.ResumeToken]
	viewer.zoomApplied = true
	runner.setZoomState(true)
	viewer.staleAt = time.Now().Add(-manager.viewerTTL - time.Second)
	manager.mu.Unlock()
	manager.Sweep(time.Now())
	if runner.zoomState() {
		t.Fatal("swept channel left its applied zoom active")
	}
}

func TestTerminalSupersededViewerUnzoomsAppliedFocus(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()
	attached, err := manager.AttachWithOptions("superseded-focused", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if err := manager.Navigate("superseded-focused", TerminalNavigation{Op: NavigateZoom, On: true}); err != nil {
		t.Fatalf("enable viewer zoom: %v", err)
	}
	manager.mu.Lock()
	manager.viewerByChannel["superseded-focused"].stale = true
	manager.mu.Unlock()

	if _, err := manager.AttachWithOptions("replacement", "%7", AttachOptions{
		SessionID:   "session-1",
		ResumeToken: attached.ResumeToken,
	}); err != nil {
		t.Fatalf("resume stale viewer: %v", err)
	}
	if runner.zoomState() {
		t.Fatal("superseded channel left its applied zoom active")
	}
}

func TestTerminalOwnsSuccessfulZoomRequestWhenWindowWasAlreadyZoomed(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()
	if _, err := manager.AttachWithOptions("already-focused", "%7", AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	runner.setZoomState(true)
	if err := manager.Navigate("already-focused", TerminalNavigation{Op: NavigateZoom, On: true}); err != nil {
		t.Fatalf("adopt existing zoom: %v", err)
	}

	manager.Detach("already-focused")
	if runner.zoomState() {
		t.Fatal("successful zoom request was not owned and cleared on detach")
	}
}

func assertWindowZoomed(t *testing.T, client *Client, want bool) {
	t.Helper()
	panes, err := client.ListPanes()
	if err != nil {
		t.Fatalf("list panes for zoom state: %v", err)
	}
	for _, pane := range panes {
		if pane.WindowZoomed != want {
			t.Fatalf("pane %s zoomed=%v, want %v", pane.PaneID, pane.WindowZoomed, want)
		}
	}
}

func newScrollablePrivateViewer(t *testing.T, channelID string) (*TerminalManager, TmuxRunner, string) {
	t.Helper()
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	paneID := panes[0].PaneID
	runner := newExecTmuxRunner(client)
	command := "i=0; while [ $i -lt 200 ]; do printf 'SCROLL-%03d\\n' \"$i\"; i=$((i + 1)); done; exec sleep 30"
	if err := runner.Run("respawn-pane", "-k", "-t", paneID, command); err != nil {
		t.Fatalf("seed scrollable pane: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for privatePaneScrollHistory(t, runner, paneID) < 100 {
		if time.Now().After(deadline) {
			t.Fatalf("pane history did not become scrollable")
		}
		time.Sleep(10 * time.Millisecond)
	}

	manager := newTerminalManagerWithRunner(client, runner, t.TempDir())
	t.Cleanup(manager.Close)
	if _, err := manager.AttachWithOptions(channelID, paneID, AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach scroll viewer: %v", err)
	}
	return manager, runner, paneID
}

func newAlternateCaptureViewer(t *testing.T, channelID string, mouse bool) (*TerminalManager, TmuxRunner, string, string) {
	t.Helper()
	client, _ := newPrivateTmuxClient(t)
	panes, err := client.ListPanes()
	if err != nil || len(panes) != 1 {
		t.Fatalf("initial private panes=%+v err=%v", panes, err)
	}
	paneID := panes[0].PaneID
	runner := newExecTmuxRunner(client)
	tempDir := t.TempDir()
	capturePath := filepath.Join(tempDir, "input.bin")
	scriptPath := filepath.Join(tempDir, "capture-input.sh")
	modes := "\\033[?1049h"
	if mouse {
		modes += "\\033[?1003h"
	}
	script := fmt.Sprintf("#!/bin/sh\nstty raw -echo\nprintf '%s'\nexec cat > \"$1\"\n", modes)
	if err := os.WriteFile(scriptPath, []byte(script), 0700); err != nil {
		t.Fatalf("write capture app: %v", err)
	}
	if err := runner.Run("respawn-pane", "-k", "-t", paneID, fmt.Sprintf("%q %q", scriptPath, capturePath)); err != nil {
		t.Fatalf("start capture app: %v", err)
	}
	wantState := "1\t0"
	if mouse {
		wantState = "1\t1"
	}
	deadline := time.Now().Add(3 * time.Second)
	for privatePaneFormat(t, runner, paneID, "#{alternate_on}\t#{mouse_any_flag}") != wantState {
		if time.Now().After(deadline) {
			t.Fatalf("capture app did not reach state %q", wantState)
		}
		time.Sleep(10 * time.Millisecond)
	}

	manager := newTerminalManagerWithRunner(client, runner, t.TempDir())
	t.Cleanup(manager.Close)
	if _, err := manager.AttachWithOptions(channelID, paneID, AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach alternate viewer: %v", err)
	}
	return manager, runner, paneID, capturePath
}

func privatePaneFormat(t *testing.T, runner TmuxRunner, paneID, format string) string {
	t.Helper()
	output, err := runner.Output("display-message", "-p", "-t", paneID, format)
	if err != nil {
		t.Fatalf("read private pane format %q: %v", format, err)
	}
	return strings.TrimSpace(string(output))
}

func privatePaneScrollHistory(t *testing.T, runner TmuxRunner, paneID string) int {
	t.Helper()
	value, err := strconv.Atoi(privatePaneFormat(t, runner, paneID, "#{history_size}"))
	if err != nil {
		t.Fatalf("parse private pane history: %v", err)
	}
	return value
}

func privatePaneScrollPosition(t *testing.T, runner TmuxRunner, paneID string) int {
	t.Helper()
	value, err := strconv.Atoi(privatePaneFormat(t, runner, paneID, "#{scroll_position}"))
	if err != nil {
		t.Fatalf("parse private pane scroll position: %v", err)
	}
	return value
}

func waitForCapturedInput(t *testing.T, capturePath string, length int) string {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		data, err := os.ReadFile(capturePath)
		if err == nil && len(data) >= length {
			return string(data)
		}
		if err != nil && !os.IsNotExist(err) {
			t.Fatalf("read captured input: %v", err)
		}
		if time.Now().After(deadline) {
			t.Fatalf("captured input did not reach %d bytes", length)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestViewerSessionNameAvoidsSanitizationCollisions(t *testing.T) {
	first := viewerSessionName("channel/one")
	second := viewerSessionName("channel:one")
	if first == second {
		t.Fatalf("sanitized viewer session names collided: %q", first)
	}
	if got := viewerSessionName("channel-1"); got != "ac-view-channel-1" {
		t.Fatalf("safe viewer session name=%q", got)
	}
}

func TestTerminalManagerEnforcesReadOnlyAtPTYAndReattachesOnControlTransfer(t *testing.T) {
	runner := newFakeTmuxRunner()
	targetKey := "display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"
	runner.outputs[targetKey] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	manager.SetPerViewerPTY(true)
	defer manager.Close()

	first, err := manager.AttachWithOptions("channel-1", "%7", AttachOptions{SessionID: "session-1", Cols: 120, Rows: 40})
	if err != nil {
		t.Fatalf("attach controller: %v", err)
	}
	second, err := manager.AttachWithOptions("channel-2", "%7", AttachOptions{SessionID: "session-1", Cols: 90, Rows: 30})
	if err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if first.ReadOnly || !second.ReadOnly {
		t.Fatalf("roles: first readonly=%v second readonly=%v", first.ReadOnly, second.ReadOnly)
	}
	if got := runner.starts[1].args; !reflect.DeepEqual(got, []string{"attach-session", "-r", "-t", "ac-view-channel-2"}) {
		t.Fatalf("second attach args=%v", got)
	}
	if err := manager.SendInput("channel-2", "blocked"); err != ErrReadOnly {
		t.Fatalf("read-only input error=%v, want ErrReadOnly", err)
	}

	if err := manager.TakeControl("channel-2"); err != nil {
		t.Fatalf("TakeControl: %v", err)
	}
	if got := runner.starts[2].args; !reflect.DeepEqual(got, []string{"attach-session", "-r", "-t", "ac-view-channel-1"}) {
		t.Fatalf("former controller reattach args=%v", got)
	}
	if got := runner.starts[3].args; !reflect.DeepEqual(got, []string{"attach-session", "-t", "ac-view-channel-2"}) {
		t.Fatalf("new controller reattach args=%v", got)
	}
	if err := manager.SendInput("channel-1", "blocked"); err != ErrReadOnly {
		t.Fatalf("former controller input error=%v, want ErrReadOnly", err)
	}
	if err := manager.SendInput("channel-2", "allowed"); err != nil {
		t.Fatalf("controller input: %v", err)
	}
	if got := string(runner.processes[3].writes); got != "allowed" {
		t.Fatalf("controller PTY writes=%q", got)
	}
}

func TestViewerPTYBridgeCoalescesReadsBeforeFanout(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	outputs := make(chan string, 2)
	bridge, err := newViewerPTYBridge(runner, viewerPTYOptions{
		ChannelID:     "channel-1",
		PaneID:        "%7",
		Cols:          80,
		Rows:          24,
		ResumeToken:   "resume-1",
		CoalesceDelay: 10 * time.Millisecond,
		OnOutput: func(_ string, encoded string) {
			outputs <- encoded
		},
	})
	if err != nil {
		t.Fatalf("newViewerPTYBridge: %v", err)
	}
	defer bridge.close(false)

	runner.processes[0].Feed([]byte("hello "))
	runner.processes[0].Feed([]byte("world"))

	select {
	case encoded := <-outputs:
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatalf("decode output: %v", err)
		}
		if got := string(decoded); got != "hello world" {
			t.Fatalf("coalesced output=%q", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for coalesced output")
	}

	select {
	case extra := <-outputs:
		t.Fatalf("unexpected extra output chunk %q", extra)
	case <-time.After(30 * time.Millisecond):
	}
}

func TestTerminalResumeTokenSurvivesManagerRestartAndSeedsCapture(t *testing.T) {
	runner := newFakeTmuxRunner()
	targetKey := "display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"
	runner.outputs[targetKey] = []byte("agents\t2\t1\n")
	runner.outputs["capture-pane -p -e -t %7"] = []byte("restored screen")

	firstManager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	attached, err := firstManager.AttachWithOptions("channel-1", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("initial attach: %v", err)
	}
	firstManager.Close()

	output := make(chan string, 1)
	secondManager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	secondManager.SetOutputHandler(func(channelID, encoded string) {
		if channelID == "channel-2" {
			output <- encoded
		}
	})
	defer secondManager.Close()
	resumed, err := secondManager.AttachWithOptions("channel-2", "%7", AttachOptions{
		SessionID:   "session-1",
		ResumeToken: attached.ResumeToken,
	})
	if err != nil {
		t.Fatalf("resume attach: %v", err)
	}
	if !resumed.Resumed || resumed.ResumeToken != attached.ResumeToken {
		t.Fatalf("resume result=%+v", resumed)
	}

	select {
	case encoded := <-output:
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatalf("decode seeded output: %v", err)
		}
		if got := string(decoded); got != "restored screen" {
			t.Fatalf("seeded output=%q", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for resumed capture")
	}
}

func TestTerminalResumeTokenReattachesAfterWebSocketDetach(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	runner.outputs["capture-pane -p -e -t %7"] = []byte("current screen")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()

	attached, err := manager.AttachWithOptions("channel-1", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("initial attach: %v", err)
	}
	manager.Detach("channel-1")

	resumed, err := manager.AttachWithOptions("channel-2", "%7", AttachOptions{
		SessionID:   "session-1",
		ResumeToken: attached.ResumeToken,
	})
	if err != nil {
		t.Fatalf("resume after detach: %v", err)
	}
	if !resumed.Resumed || resumed.ResumeToken != attached.ResumeToken {
		t.Fatalf("resume result=%+v", resumed)
	}
}

func TestTerminalResumeSupersedesStaleAttachedChannel(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	runner.outputs["capture-pane -p -e -t %7"] = []byte("current screen")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()

	attached, err := manager.AttachWithOptions("channel-old", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("initial attach: %v", err)
	}
	manager.MarkChannelsStale()

	resumed, err := manager.AttachWithOptions("channel-new", "%7", AttachOptions{
		SessionID:   "session-1",
		ResumeToken: attached.ResumeToken,
	})
	if err != nil {
		t.Fatalf("resume stale channel: %v", err)
	}
	if !resumed.Resumed || resumed.ResumeToken != attached.ResumeToken || resumed.ReadOnly {
		t.Fatalf("resume result=%+v", resumed)
	}
	if _, exists := manager.channelToPane["channel-old"]; exists {
		t.Fatal("stale channel remains attached")
	}
	if viewer := manager.viewerByChannel["channel-new"]; viewer == nil || viewer.channelID != "channel-new" {
		t.Fatalf("new channel viewer=%+v", viewer)
	}
}

func TestTerminalResumeDoesNotSupersedeActiveChannel(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()

	attached, err := manager.AttachWithOptions("channel-active", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("initial attach: %v", err)
	}
	if _, err := manager.AttachWithOptions("channel-new", "%7", AttachOptions{
		SessionID:   "session-1",
		ResumeToken: attached.ResumeToken,
	}); err == nil || err.Error() != "resume token is already attached" {
		t.Fatalf("active resume error=%v", err)
	}
}

func TestTerminalSweeperReapsDetachedViewerAndOrphanGroup(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()

	attached, err := manager.AttachWithOptions("channel-1", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	manager.Detach("channel-1")
	now := time.Now()
	manager.mu.Lock()
	manager.viewerByToken[attached.ResumeToken].detachedAt = now.Add(-manager.viewerTTL - time.Second)
	manager.mu.Unlock()
	runner.outputs["list-sessions -F #{session_name}"] = []byte("agents\nac-view-channel-1\nac-view-orphan\n")

	manager.Sweep(now)

	manager.mu.RLock()
	_, tokenStillTracked := manager.viewerByToken[attached.ResumeToken]
	manager.mu.RUnlock()
	if tokenStillTracked {
		t.Fatal("expired detached viewer was not reaped")
	}
	if _, exists := runner.options["%7 "+resumeOptionName(attached.ResumeToken)]; exists {
		t.Fatal("expired resume token pane option was not removed")
	}
	if !runner.hasRun([]string{"kill-session", "-t", "ac-view-orphan"}) {
		t.Fatal("orphan grouped viewer session was not killed")
	}
}

func TestTerminalSweeperReapsStaleViewerAndChannelState(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()

	attached, err := manager.AttachWithOptions("channel-stale", "%7", AttachOptions{SessionID: "session-1"})
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	manager.MarkChannelsStale()
	now := time.Now()
	manager.mu.Lock()
	viewer := manager.viewerByToken[attached.ResumeToken]
	if viewer.staleAt.IsZero() {
		manager.mu.Unlock()
		t.Fatal("stale viewer timestamp was not recorded")
	}
	viewer.staleAt = now.Add(-manager.viewerTTL - time.Second)
	manager.mu.Unlock()

	manager.Sweep(now)

	manager.mu.RLock()
	_, tokenStillTracked := manager.viewerByToken[attached.ResumeToken]
	_, channelStillTracked := manager.viewerByChannel["channel-stale"]
	_, paneStillTracked := manager.channelToPane["channel-stale"]
	_, sessionStillTracked := manager.channelSession["channel-stale"]
	_, ptyStillTracked := manager.channelToPTY["channel-stale"]
	_, perViewerStillTracked := manager.channelPerViewer["channel-stale"]
	_, readOnlyStillTracked := manager.channelReadOnly["channel-stale"]
	_, controllerStillTracked := manager.paneController["%7"]
	manager.mu.RUnlock()
	if tokenStillTracked || channelStillTracked || paneStillTracked || sessionStillTracked || ptyStillTracked ||
		perViewerStillTracked || readOnlyStillTracked || controllerStillTracked {
		t.Fatalf("stale viewer maps remain: token=%v viewer=%v pane=%v session=%v pty=%v perViewer=%v readonly=%v controller=%v",
			tokenStillTracked, channelStillTracked, paneStillTracked, sessionStillTracked, ptyStillTracked,
			perViewerStillTracked, readOnlyStillTracked, controllerStillTracked)
	}
	if _, exists := runner.options["%7 "+resumeOptionName(attached.ResumeToken)]; exists {
		t.Fatal("stale viewer resume token pane option was not removed")
	}
	if !runner.hasRun([]string{"kill-session", "-t", viewerSessionName("channel-stale")}) {
		t.Fatal("stale grouped viewer session was not killed")
	}
	select {
	case <-runner.processes[0].closed:
	default:
		t.Fatal("stale viewer PTY process was not closed")
	}
}

func TestTerminalManagerEmitsAttachDetachAndControlAuditEvents(t *testing.T) {
	runner := newFakeTmuxRunner()
	runner.outputs["display-message -p -t %7 #{session_name}\t#{window_index}\t#{pane_index}"] = []byte("agents\t2\t1\n")
	manager := newTerminalManagerWithRunner(nil, runner, t.TempDir())
	defer manager.Close()
	var events []TerminalAuditEvent
	manager.SetAuditHandler(func(event TerminalAuditEvent) {
		events = append(events, event)
	})

	if _, err := manager.AttachWithOptions("channel-1", "%7", AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach controller: %v", err)
	}
	if _, err := manager.AttachWithOptions("channel-2", "%7", AttachOptions{SessionID: "session-1"}); err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if err := manager.TakeControl("channel-2"); err != nil {
		t.Fatalf("take control: %v", err)
	}
	manager.Detach("channel-2")

	want := []TerminalAuditEvent{
		{Action: "attach", ChannelID: "channel-1", SessionID: "session-1", PaneID: "%7"},
		{Action: "attach", ChannelID: "channel-2", SessionID: "session-1", PaneID: "%7"},
		{Action: "control_transfer", ChannelID: "channel-2", SessionID: "session-1", PaneID: "%7", PreviousControllerChannelID: "channel-1"},
		{Action: "detach", ChannelID: "channel-2", SessionID: "session-1", PaneID: "%7"},
	}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("audit events:\n got: %+v\nwant: %+v", events, want)
	}
}

type fakeTmuxRunner struct {
	mu        sync.Mutex
	outputs   map[string][]byte
	runs      [][]string
	startArgs []string
	startSize TerminalSize
	starts    []fakePTYStart
	processes []*fakePTYProcess
	options   map[string]string
	zoomed    bool
}

type fakePTYStart struct {
	args []string
	size TerminalSize
}

func newFakeTmuxRunner() *fakeTmuxRunner {
	return &fakeTmuxRunner{
		outputs: make(map[string][]byte),
		options: make(map[string]string),
	}
}

func (r *fakeTmuxRunner) Output(args ...string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(args) == 5 && args[0] == "display-message" && args[4] == "#{window_zoomed_flag}" {
		if r.zoomed {
			return []byte("1\n"), nil
		}
		return []byte("0\n"), nil
	}
	if len(args) == 6 && args[0] == "show-options" && args[1] == "-p" && args[2] == "-v" && args[3] == "-t" {
		return []byte(r.options[args[4]+" "+args[5]]), nil
	}
	return append([]byte(nil), r.outputs[joinArgs(args)]...), nil
}

func (r *fakeTmuxRunner) Run(args ...string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs = append(r.runs, append([]string(nil), args...))
	if len(args) == 4 && args[0] == "resize-pane" && args[1] == "-Z" {
		r.zoomed = !r.zoomed
	}
	if len(args) == 6 && args[0] == "set-option" && args[1] == "-p" && args[2] == "-t" {
		r.options[args[3]+" "+args[4]] = args[5]
	}
	if len(args) == 5 && args[0] == "set-option" && args[1] == "-pu" && args[2] == "-t" {
		delete(r.options, args[3]+" "+args[4])
	}
	return nil
}

func (r *fakeTmuxRunner) runIndex(want []string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	for index, args := range r.runs {
		if reflect.DeepEqual(args, want) {
			return index
		}
	}
	return -1
}

func (r *fakeTmuxRunner) lastRunIndex(want []string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	for index := len(r.runs) - 1; index >= 0; index-- {
		if reflect.DeepEqual(r.runs[index], want) {
			return index
		}
	}
	return -1
}

func (r *fakeTmuxRunner) zoomState() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.zoomed
}

func (r *fakeTmuxRunner) setZoomState(zoomed bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.zoomed = zoomed
}

func (r *fakeTmuxRunner) StartPTY(args []string, env []string, size TerminalSize) (PTYProcess, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.startArgs = append([]string(nil), args...)
	r.startSize = size
	r.starts = append(r.starts, fakePTYStart{args: append([]string(nil), args...), size: size})
	process := newFakePTYProcess()
	r.processes = append(r.processes, process)
	return process, nil
}

func (r *fakeTmuxRunner) hasRun(want []string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, args := range r.runs {
		if reflect.DeepEqual(args, want) {
			return true
		}
	}
	return false
}

func joinArgs(args []string) string {
	result := ""
	for i, arg := range args {
		if i > 0 {
			result += " "
		}
		result += arg
	}
	return result
}

type fakePTYProcess struct {
	closed chan struct{}
	once   sync.Once
	size   TerminalSize
	writes []byte
	mu     sync.Mutex
	reads  chan []byte
}

func newFakePTYProcess() *fakePTYProcess {
	return &fakePTYProcess{closed: make(chan struct{}), reads: make(chan []byte, 16)}
}

func (p *fakePTYProcess) Read(dst []byte) (int, error) {
	select {
	case <-p.closed:
		return 0, io.EOF
	case data := <-p.reads:
		return copy(dst, data), nil
	}
}

func (p *fakePTYProcess) Write(data []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.writes = append(p.writes, data...)
	return len(data), nil
}

func (p *fakePTYProcess) Close() error {
	p.once.Do(func() { close(p.closed) })
	return nil
}

func (p *fakePTYProcess) Resize(size TerminalSize) error {
	p.size = size
	return nil
}

func (p *fakePTYProcess) Wait() error {
	<-p.closed
	return nil
}

func (p *fakePTYProcess) Kill() error { return p.Close() }

func (p *fakePTYProcess) Feed(data []byte) {
	p.reads <- append([]byte(nil), data...)
}
