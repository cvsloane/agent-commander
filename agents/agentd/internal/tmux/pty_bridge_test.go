package tmux

import (
	"encoding/base64"
	"io"
	"reflect"
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
	if len(args) == 6 && args[0] == "show-options" && args[1] == "-p" && args[2] == "-v" && args[3] == "-t" {
		return []byte(r.options[args[4]+" "+args[5]]), nil
	}
	return append([]byte(nil), r.outputs[joinArgs(args)]...), nil
}

func (r *fakeTmuxRunner) Run(args ...string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs = append(r.runs, append([]string(nil), args...))
	if len(args) == 6 && args[0] == "set-option" && args[1] == "-p" && args[2] == "-t" {
		r.options[args[3]+" "+args[4]] = args[5]
	}
	if len(args) == 5 && args[0] == "set-option" && args[1] == "-pu" && args[2] == "-t" {
		delete(r.options, args[3]+" "+args[4])
	}
	return nil
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
