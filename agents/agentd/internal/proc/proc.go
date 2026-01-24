package proc

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Entry struct {
	Pid     int
	PPid    int
	Cmdline string
	Comm    string
}

type Snapshot struct {
	entries  map[int]*Entry
	children map[int][]int
}

func TakeSnapshot() *Snapshot {
	entries := make(map[int]*Entry)
	children := make(map[int][]int)

	dirs, err := os.ReadDir("/proc")
	if err != nil {
		return &Snapshot{entries: entries, children: children}
	}

	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}
		pid, ok := parsePID(dir.Name())
		if !ok {
			continue
		}

		statPath := filepath.Join("/proc", dir.Name(), "stat")
		stat, err := os.ReadFile(statPath)
		if err != nil {
			continue
		}

		comm, ppid, ok := parseStat(string(stat))
		if !ok {
			continue
		}

		cmdline := readCmdline(pid)
		entry := &Entry{
			Pid:     pid,
			PPid:    ppid,
			Cmdline: strings.ToLower(cmdline),
			Comm:    strings.ToLower(comm),
		}
		entries[pid] = entry
		children[ppid] = append(children[ppid], pid)
	}

	return &Snapshot{entries: entries, children: children}
}

func (s *Snapshot) HasDescendantCmd(pid int, substrings []string) bool {
	if s == nil || pid <= 0 {
		return false
	}

	queue := []int{pid}
	visited := make(map[int]struct{})
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if _, seen := visited[current]; seen {
			continue
		}
		visited[current] = struct{}{}

		if entry, ok := s.entries[current]; ok {
			haystack := entry.Cmdline
			if haystack == "" {
				haystack = entry.Comm
			}
			for _, substr := range substrings {
				if substr != "" && strings.Contains(haystack, substr) {
					return true
				}
			}
		}

		if kids := s.children[current]; len(kids) > 0 {
			queue = append(queue, kids...)
		}
	}

	return false
}

func parsePID(name string) (int, bool) {
	if name == "" {
		return 0, false
	}
	for _, ch := range name {
		if ch < '0' || ch > '9' {
			return 0, false
		}
	}
	pid, err := strconv.Atoi(name)
	if err != nil || pid <= 0 {
		return 0, false
	}
	return pid, true
}

func parseStat(stat string) (string, int, bool) {
	stat = strings.TrimSpace(stat)
	if stat == "" {
		return "", 0, false
	}

	rparen := strings.LastIndex(stat, ")")
	lparen := strings.Index(stat, "(")
	if lparen == -1 || rparen == -1 || rparen <= lparen {
		return "", 0, false
	}

	comm := stat[lparen+1 : rparen]
	rest := strings.Fields(stat[rparen+2:])
	if len(rest) < 2 {
		return comm, 0, false
	}

	ppid, err := strconv.Atoi(rest[1])
	if err != nil {
		return comm, 0, false
	}
	return comm, ppid, true
}

func readCmdline(pid int) string {
	path := fmt.Sprintf("/proc/%d/cmdline", pid)
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return ""
	}
	parts := strings.Split(string(data), "\x00")
	var fields []string
	for _, part := range parts {
		if part == "" {
			continue
		}
		fields = append(fields, part)
	}
	return strings.Join(fields, " ")
}
