package tmux

import "testing"

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

func TestParsePaneLineIncludesTopologyFields(t *testing.T) {
	pane, ok := parsePaneLine("%7\t1234\tagents\tworker\t2\t1\t/tmp/repo\tcodex\tAgent\tcodex\tsession-123\tparent-456\t1\t0\t1\ttiled\t190\t45\t1\t0")
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
}
