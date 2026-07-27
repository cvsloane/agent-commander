package filebridge

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestBridge(t *testing.T) (*Bridge, string, string) {
	t.Helper()
	root := t.TempDir()
	drop := filepath.Join(root, "AgentDrop")
	out := filepath.Join(root, "AgentOut")

	b, err := New(Config{Enabled: true, DropDir: drop, OutDir: out, MaxFileBytes: 1024})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if b == nil {
		t.Fatal("expected a bridge when enabled")
	}
	return b, drop, out
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestDisabledBridgeIsNil(t *testing.T) {
	b, err := New(Config{Enabled: false})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if b != nil {
		t.Fatal("expected nil bridge when disabled")
	}
	// Methods on the nil bridge must report cleanly rather than panic.
	if _, err := b.ListDrop(); !errors.Is(err, ErrDisabled) {
		t.Errorf("ListDrop on disabled bridge = %v, want ErrDisabled", err)
	}
	if _, _, err := b.Attach("x.txt", t.TempDir()); !errors.Is(err, ErrDisabled) {
		t.Errorf("Attach on disabled bridge = %v, want ErrDisabled", err)
	}
}

func TestNewCreatesFolders(t *testing.T) {
	_, drop, out := newTestBridge(t)
	for _, dir := range []string{drop, out} {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() {
			t.Errorf("expected %s to be created as a directory (err=%v)", dir, err)
		}
	}
}

func TestListDropSkipsNoiseAndSortsNewestFirst(t *testing.T) {
	b, drop, _ := newTestBridge(t)

	write(t, filepath.Join(drop, "older.png"), "a")
	write(t, filepath.Join(drop, "newer.log"), "b")
	write(t, filepath.Join(drop, ".hidden"), "c")
	write(t, filepath.Join(drop, "half.part"), "d")
	write(t, filepath.Join(drop, "sync.~12345"), "e")
	if err := os.Mkdir(filepath.Join(drop, "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Make ordering deterministic regardless of filesystem timestamp resolution.
	old := filepath.Join(drop, "older.png")
	if err := os.Chtimes(old, mustTime(t, "2026-01-01T00:00:00Z"), mustTime(t, "2026-01-01T00:00:00Z")); err != nil {
		t.Fatal(err)
	}

	files, err := b.ListDrop()
	if err != nil {
		t.Fatalf("ListDrop: %v", err)
	}

	var names []string
	for _, f := range files {
		names = append(names, f.Name)
	}
	if len(names) != 2 {
		t.Fatalf("expected 2 files (hidden, .part, .~ and dirs excluded), got %v", names)
	}
	if names[0] != "newer.log" || names[1] != "older.png" {
		t.Errorf("expected newest first, got %v", names)
	}
	if files[1].SizeBytes != 1 {
		t.Errorf("size = %d, want 1", files[1].SizeBytes)
	}
}

func TestAttachCopiesIntoDestination(t *testing.T) {
	b, drop, _ := newTestBridge(t)
	write(t, filepath.Join(drop, "mockup.png"), "image-bytes")
	dest := t.TempDir()

	path, n, err := b.Attach("mockup.png", dest)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	if filepath.Dir(path) != dest {
		t.Errorf("attached to %s, expected inside %s", path, dest)
	}
	if n != int64(len("image-bytes")) {
		t.Errorf("wrote %d bytes, want %d", n, len("image-bytes"))
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "image-bytes" {
		t.Errorf("content = %q (err=%v)", got, err)
	}

	// The original must remain for other sessions / devices.
	if _, err := os.Stat(filepath.Join(drop, "mockup.png")); err != nil {
		t.Errorf("source file was removed: %v", err)
	}
}

// The destination is a live working directory, often a git worktree. Attaching
// must never overwrite a tracked file.
func TestAttachNeverOverwrites(t *testing.T) {
	b, drop, _ := newTestBridge(t)
	write(t, filepath.Join(drop, "notes.md"), "from-phone")
	dest := t.TempDir()
	existing := filepath.Join(dest, "notes.md")
	write(t, existing, "IMPORTANT LOCAL WORK")

	path, _, err := b.Attach("notes.md", dest)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	if path == existing {
		t.Fatal("attach overwrote the existing file")
	}
	if got, _ := os.ReadFile(existing); string(got) != "IMPORTANT LOCAL WORK" {
		t.Errorf("existing file was modified: %q", got)
	}
	if filepath.Base(path) != "notes-1.md" {
		t.Errorf("expected suffixed name notes-1.md, got %s", filepath.Base(path))
	}
}

func TestAttachRejectsUnsafeNames(t *testing.T) {
	b, _, _ := newTestBridge(t)
	dest := t.TempDir()

	for _, name := range []string{
		"../../../etc/passwd",
		"sub/dir.txt",
		`..\windows`,
		"..",
		".",
		"",
		"   ",
	} {
		if _, _, err := b.Attach(name, dest); err == nil {
			t.Errorf("Attach(%q) succeeded; expected rejection", name)
		}
	}
}

// A symlink placed in the drop folder must not become a read primitive for
// arbitrary files on the host.
func TestAttachRejectsSymlinkEscape(t *testing.T) {
	b, drop, _ := newTestBridge(t)
	secretDir := t.TempDir()
	secret := filepath.Join(secretDir, "id_rsa")
	write(t, secret, "PRIVATE KEY")

	if err := os.Symlink(secret, filepath.Join(drop, "innocent.txt")); err != nil {
		t.Skipf("symlinks unsupported here: %v", err)
	}

	_, _, err := b.Attach("innocent.txt", t.TempDir())
	if !errors.Is(err, ErrOutsideRoot) {
		t.Errorf("Attach via escaping symlink = %v, want ErrOutsideRoot", err)
	}
}

func TestAttachRejectsOversizeFile(t *testing.T) {
	b, drop, _ := newTestBridge(t) // limit is 1024 bytes
	write(t, filepath.Join(drop, "big.bin"), strings.Repeat("x", 2048))

	_, _, err := b.Attach("big.bin", t.TempDir())
	if !errors.Is(err, ErrTooLarge) {
		t.Errorf("Attach oversize = %v, want ErrTooLarge", err)
	}
}

func TestAttachRejectsDirectory(t *testing.T) {
	b, drop, _ := newTestBridge(t)
	if err := os.Mkdir(filepath.Join(drop, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, _, err := b.Attach("folder", t.TempDir()); err == nil {
		t.Error("expected attaching a directory to fail")
	}
}

func TestPublishCopiesToOutbound(t *testing.T) {
	b, _, out := newTestBridge(t)
	src := filepath.Join(t.TempDir(), "report.md")
	write(t, src, "# results")

	path, n, err := b.Publish(src)
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if filepath.Dir(path) != out {
		t.Errorf("published to %s, want inside %s", path, out)
	}
	if n != int64(len("# results")) {
		t.Errorf("wrote %d bytes", n)
	}
}

func TestPublishRequiresAbsolutePath(t *testing.T) {
	b, _, _ := newTestBridge(t)
	if _, _, err := b.Publish("relative/path.txt"); err == nil {
		t.Error("expected relative source path to be rejected")
	}
}

func TestPublishWithoutOutboundDirIsReported(t *testing.T) {
	root := t.TempDir()
	b, err := New(Config{Enabled: true, DropDir: filepath.Join(root, "drop")})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	src := filepath.Join(root, "f.txt")
	write(t, src, "x")

	if _, _, err := b.Publish(src); !errors.Is(err, ErrNoOutboundDir) {
		t.Errorf("Publish without out dir = %v, want ErrNoOutboundDir", err)
	}
}

func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("parse time %q: %v", value, err)
	}
	return parsed
}
