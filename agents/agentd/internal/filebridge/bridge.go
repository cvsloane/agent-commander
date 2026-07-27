// Package filebridge exposes a pair of Nextcloud-synced folders to agent
// sessions: one inbound (files you drop from a phone or Windows machine) and one
// outbound (files an agent produces for you).
//
// Nextcloud already moves the bytes between devices, so nothing here transfers
// anything over the network. This is only the last hop -- copying a synced file
// into the session's working directory, and copying a result back out -- with
// the path handling that hop requires.
package filebridge

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// DefaultMaxFileBytes caps a single attach. Nextcloud will happily sync a 4GB
// video; copying one into a git worktree is never what the operator meant.
const DefaultMaxFileBytes int64 = 64 << 20 // 64 MiB

var (
	ErrDisabled     = errors.New("file bridge is not enabled on this host")
	ErrUnsafeName   = errors.New("file name must be a plain name inside the drop folder")
	ErrNotRegular   = errors.New("only regular files can be attached")
	ErrTooLarge     = errors.New("file exceeds the configured size limit")
	ErrOutsideRoot  = errors.New("resolved path escapes the configured folder")
	ErrNoOutboundDir = errors.New("no outbound folder is configured on this host")
)

type Config struct {
	Enabled      bool
	DropDir      string
	OutDir       string
	MaxFileBytes int64
}

// File is an entry in the drop folder.
type File struct {
	Name       string `json:"name"`
	SizeBytes  int64  `json:"size_bytes"`
	ModifiedAt string `json:"modified_at"`
}

type Bridge struct {
	dropDir      string
	outDir       string
	maxFileBytes int64
}

// expandHome resolves a leading ~ so config can be written the way operators
// think about these folders.
func expandHome(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", nil
	}
	if !strings.HasPrefix(trimmed, "~") {
		return filepath.Clean(trimmed), nil
	}
	suffix := strings.TrimPrefix(trimmed, "~")
	if suffix != "" && !strings.HasPrefix(suffix, "/") {
		return "", fmt.Errorf("unsupported path: %s", path)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve home directory: %w", err)
	}
	return filepath.Clean(filepath.Join(home, suffix)), nil
}

func New(cfg Config) (*Bridge, error) {
	if !cfg.Enabled {
		return nil, nil
	}
	dropDir, err := expandHome(cfg.DropDir)
	if err != nil {
		return nil, err
	}
	if dropDir == "" {
		return nil, fmt.Errorf("file bridge is enabled but no drop_dir is configured")
	}
	outDir, err := expandHome(cfg.OutDir)
	if err != nil {
		return nil, err
	}

	maxBytes := cfg.MaxFileBytes
	if maxBytes <= 0 {
		maxBytes = DefaultMaxFileBytes
	}

	// Create the folders so a fresh host works without manual setup; Nextcloud
	// picks them up on its next sync pass.
	if err := os.MkdirAll(dropDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create drop folder %s: %w", dropDir, err)
	}
	if outDir != "" {
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			return nil, fmt.Errorf("failed to create outbound folder %s: %w", outDir, err)
		}
	}

	return &Bridge{dropDir: dropDir, outDir: outDir, maxFileBytes: maxBytes}, nil
}

func (b *Bridge) DropDir() string { return b.dropDir }
func (b *Bridge) OutDir() string  { return b.outDir }
func (b *Bridge) MaxFileBytes() int64 { return b.maxFileBytes }

// safeChild resolves name within root, rejecting anything that is not a plain
// file name and anything that resolves outside root after symlink evaluation.
func safeChild(root, name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == ".." {
		return "", ErrUnsafeName
	}
	if strings.ContainsAny(trimmed, `/\`) || strings.Contains(trimmed, "\x00") {
		return "", ErrUnsafeName
	}
	// filepath.Base is a belt-and-braces guard: after the checks above it should
	// be a no-op, but it guarantees we never join a traversal component.
	if filepath.Base(trimmed) != trimmed {
		return "", ErrUnsafeName
	}

	candidate := filepath.Join(root, trimmed)

	// A symlink inside the drop folder could still point outside it. Compare
	// fully-resolved paths, tolerating a root that is itself a symlink.
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		if os.IsNotExist(err) {
			return "", err
		}
		return "", err
	}
	rel, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", ErrOutsideRoot
	}
	return resolved, nil
}

// ListDrop returns the regular files waiting in the drop folder, newest first.
func (b *Bridge) ListDrop() ([]File, error) {
	if b == nil {
		return nil, ErrDisabled
	}
	entries, err := os.ReadDir(b.dropDir)
	if err != nil {
		return nil, err
	}

	files := make([]File, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		// Nextcloud writes partial downloads as *.~<n> / *.part; showing them
		// invites attaching a half-synced file.
		if strings.HasSuffix(entry.Name(), ".part") || strings.Contains(entry.Name(), ".~") {
			continue
		}
		files = append(files, File{
			Name:       entry.Name(),
			SizeBytes:  info.Size(),
			ModifiedAt: info.ModTime().UTC().Format(time.RFC3339),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].ModifiedAt != files[j].ModifiedAt {
			return files[i].ModifiedAt > files[j].ModifiedAt
		}
		return files[i].Name < files[j].Name
	})
	return files, nil
}

// nonCollidingPath never overwrites an existing file. The destination is a live
// working directory, frequently a git worktree; silently clobbering a tracked
// file would be the worst possible behaviour here.
func nonCollidingPath(dir, name string) string {
	candidate := filepath.Join(dir, name)
	if _, err := os.Lstat(candidate); os.IsNotExist(err) {
		return candidate
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i < 1000; i++ {
		candidate = filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, i, ext))
		if _, err := os.Lstat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, time.Now().UTC().UnixNano(), ext))
}

func copyFile(src, dst string, limit int64) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return 0, err
	}

	written, err := io.Copy(out, io.LimitReader(in, limit))
	closeErr := out.Close()
	if err != nil {
		os.Remove(dst)
		return 0, err
	}
	if closeErr != nil {
		os.Remove(dst)
		return 0, closeErr
	}
	return written, nil
}

// Attach copies a dropped file into destDir and returns the path written.
func (b *Bridge) Attach(name, destDir string) (string, int64, error) {
	if b == nil {
		return "", 0, ErrDisabled
	}
	if strings.TrimSpace(destDir) == "" {
		return "", 0, fmt.Errorf("destination directory is required")
	}

	src, err := safeChild(b.dropDir, name)
	if err != nil {
		return "", 0, err
	}

	info, err := os.Stat(src)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() {
		return "", 0, ErrNotRegular
	}
	if info.Size() > b.maxFileBytes {
		return "", 0, fmt.Errorf("%w (%d bytes > %d)", ErrTooLarge, info.Size(), b.maxFileBytes)
	}

	dst := nonCollidingPath(destDir, filepath.Base(src))
	written, err := copyFile(src, dst, b.maxFileBytes)
	if err != nil {
		return "", 0, err
	}
	return dst, written, nil
}

// Publish copies a file produced in a session into the outbound folder, where
// Nextcloud syncs it to the operator's other devices.
func (b *Bridge) Publish(srcPath string) (string, int64, error) {
	if b == nil {
		return "", 0, ErrDisabled
	}
	if b.outDir == "" {
		return "", 0, ErrNoOutboundDir
	}

	cleaned := filepath.Clean(strings.TrimSpace(srcPath))
	if !filepath.IsAbs(cleaned) {
		return "", 0, fmt.Errorf("source path must be absolute")
	}
	info, err := os.Stat(cleaned)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() {
		return "", 0, ErrNotRegular
	}
	if info.Size() > b.maxFileBytes {
		return "", 0, fmt.Errorf("%w (%d bytes > %d)", ErrTooLarge, info.Size(), b.maxFileBytes)
	}

	dst := nonCollidingPath(b.outDir, filepath.Base(cleaned))
	written, err := copyFile(cleaned, dst, b.maxFileBytes)
	if err != nil {
		return "", 0, err
	}
	return dst, written, nil
}
