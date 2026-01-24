package tmux

import (
	"bytes"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

type GitInfo struct {
	RepoRoot  string
	Branch    string
	Remote    string
	UpdatedAt time.Time
}

// GitStatus contains efficient git status information parsed from porcelain v2
type GitStatus struct {
	Branch    string // Current branch name
	Upstream  string // Upstream branch (e.g., "origin/main")
	Ahead     int    // Commits ahead of upstream
	Behind    int    // Commits behind upstream
	Staged    int    // Count of staged changes
	Unstaged  int    // Count of unstaged changes
	Untracked int    // Count of untracked files
	Unmerged  int    // Count of unmerged (conflict) files
	UpdatedAt time.Time
}

type GitCache struct {
	cache map[string]*GitInfo
	mu    sync.RWMutex
	ttl   time.Duration
}

func NewGitCache(ttl time.Duration) *GitCache {
	return &GitCache{
		cache: make(map[string]*GitInfo),
		ttl:   ttl,
	}
}

// GitStatusCache caches git status information with TTL
type GitStatusCache struct {
	cache map[string]*GitStatus
	mu    sync.RWMutex
	ttl   time.Duration
}

func NewGitStatusCache(ttl time.Duration) *GitStatusCache {
	return &GitStatusCache{
		cache: make(map[string]*GitStatus),
		ttl:   ttl,
	}
}

func (c *GitStatusCache) Get(cwd string) (*GitStatus, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	status, ok := c.cache[cwd]
	if !ok {
		return nil, false
	}

	if time.Since(status.UpdatedAt) > c.ttl {
		return nil, false
	}

	return status, true
}

func (c *GitStatusCache) Set(cwd string, status *GitStatus) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache[cwd] = status
}

func (c *GitStatusCache) Delete(cwd string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.cache, cwd)
}

func (c *GitCache) Get(cwd string) (*GitInfo, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, ok := c.cache[cwd]
	if !ok {
		return nil, false
	}

	// Check if expired
	if time.Since(info.UpdatedAt) > c.ttl {
		return nil, false
	}

	return info, true
}

func (c *GitCache) Set(cwd string, info *GitInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache[cwd] = info
}

func (c *GitCache) Delete(cwd string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.cache, cwd)
}

// ResolveGitInfo gets git metadata for a directory
func ResolveGitInfo(cwd string) *GitInfo {
	info := &GitInfo{
		UpdatedAt: time.Now(),
	}

	// Get repo root
	cmd := exec.Command("git", "-C", cwd, "rev-parse", "--show-toplevel")
	output, err := cmd.Output()
	if err != nil {
		return nil // Not a git repo
	}
	info.RepoRoot = strings.TrimSpace(string(output))

	// Get branch
	cmd = exec.Command("git", "-C", info.RepoRoot, "rev-parse", "--abbrev-ref", "HEAD")
	output, err = cmd.Output()
	if err == nil {
		info.Branch = strings.TrimSpace(string(output))
	}

	// Get remote URL
	cmd = exec.Command("git", "-C", info.RepoRoot, "remote", "get-url", "origin")
	output, err = cmd.Output()
	if err == nil {
		info.Remote = strings.TrimSpace(string(output))
	}

	return info
}

// RunGitCommand executes a git command in a repo root.
func RunGitCommand(repoRoot string, args ...string) error {
	cmd := exec.Command("git", append([]string{"-C", repoRoot}, args...)...)
	return cmd.Run()
}

// ResolveGitStatus gets efficient git status using porcelain v2 format.
// Uses `git status --porcelain=v2 -b -z` which is fast even on large repos.
func ResolveGitStatus(cwd string) *GitStatus {
	cmd := exec.Command("git", "-C", cwd, "status", "--porcelain=v2", "-b", "-z")
	output, err := cmd.Output()
	if err != nil {
		return nil // Not a git repo or error
	}

	status := &GitStatus{
		UpdatedAt: time.Now(),
	}

	// Split by NUL byte (-z flag)
	entries := bytes.Split(output, []byte{0})

	for _, entry := range entries {
		if len(entry) == 0 {
			continue
		}

		line := string(entry)

		// Parse header lines (start with #)
		if strings.HasPrefix(line, "# ") {
			parseStatusHeader(line, status)
			continue
		}

		// Parse status entries
		if len(line) >= 2 {
			switch line[0] {
			case '1', '2': // Ordinary or renamed/copied changed entry
				parseChangedEntry(line, status)
			case 'u': // Unmerged entry
				status.Unmerged++
			case '?': // Untracked
				status.Untracked++
			}
		}
	}

	return status
}

// parseStatusHeader parses porcelain v2 header lines
func parseStatusHeader(line string, status *GitStatus) {
	// Format: # <header_name> <value>
	parts := strings.SplitN(line, " ", 3)
	if len(parts) < 3 {
		return
	}

	key := parts[1]
	value := parts[2]

	switch key {
	case "branch.head":
		status.Branch = value
	case "branch.upstream":
		status.Upstream = value
	case "branch.ab":
		// Format: +<ahead> -<behind>
		parseAheadBehind(value, status)
	}
}

// parseAheadBehind parses the +N -M ahead/behind counts
func parseAheadBehind(value string, status *GitStatus) {
	parts := strings.Fields(value)
	for _, part := range parts {
		if strings.HasPrefix(part, "+") {
			if n, err := strconv.Atoi(part[1:]); err == nil {
				status.Ahead = n
			}
		} else if strings.HasPrefix(part, "-") {
			if n, err := strconv.Atoi(part[1:]); err == nil {
				status.Behind = n
			}
		}
	}
}

// parseChangedEntry parses a changed file entry from porcelain v2
// Format: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
// Format: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><tab><origPath>
// XY is index/worktree status: first char is staged, second is unstaged
func parseChangedEntry(line string, status *GitStatus) {
	if len(line) < 4 {
		return
	}

	// XY is at position 2-3 (after "1 " or "2 ")
	xy := line[2:4]
	if len(xy) < 2 {
		return
	}

	indexStatus := xy[0]
	worktreeStatus := xy[1]

	// Staged changes: index status is not '.' (unchanged)
	if indexStatus != '.' {
		status.Staged++
	}

	// Unstaged changes: worktree status is not '.' (unchanged)
	if worktreeStatus != '.' {
		status.Unstaged++
	}
}
