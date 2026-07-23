package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/agent-command/agentd/internal/commands"
	"github.com/google/uuid"
)

const (
	defaultCaptureSnapshotPageSize     = 500
	maxCaptureSnapshotPageSize         = 5000
	captureSnapshotIdleTTL             = 60 * time.Minute
	maxCaptureSnapshots                = 2
	maxCaptureSnapshotRows             = 100_000
	maxCaptureSnapshotBytes            = 32 * 1024 * 1024
	maxCaptureSnapshotPageContentBytes = 512 * 1024
)

type capturePaneSnapshot struct {
	id               string
	sessionID        string
	paneID           string
	stripANSI        bool
	lines            []string
	sourceTotalLines int
	truncated        bool
	lastAccess       time.Time
}

type capturePaneSnapshotCache struct {
	mu      sync.Mutex
	entries map[string]*capturePaneSnapshot
	now     func() time.Time
}

type capturePaneSnapshotPage struct {
	snapshot *capturePaneSnapshot
	content  string
	start    int
	end      int
	hasOlder bool
}

func (c *capturePaneSnapshotCache) create(
	sessionID string,
	paneID string,
	stripANSI bool,
	content string,
	pageSize int,
) (capturePaneSnapshotPage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = make(map[string]*capturePaneSnapshot)
	}
	now := c.currentTimeLocked()
	c.pruneExpiredLocked(now)
	lines, sourceTotalLines, truncated := retainCaptureSnapshotLines(content)
	snapshot := &capturePaneSnapshot{
		id:               uuid.NewString(),
		sessionID:        sessionID,
		paneID:           paneID,
		stripANSI:        stripANSI,
		lines:            lines,
		sourceTotalLines: sourceTotalLines,
		truncated:        truncated,
		lastAccess:       now,
	}
	page, err := buildCaptureSnapshotPage(snapshot, len(lines), pageSize)
	if err != nil {
		return capturePaneSnapshotPage{}, err
	}
	c.makeRoomLocked()
	c.entries[snapshot.id] = snapshot
	return page, nil
}

func (c *capturePaneSnapshotCache) continuation(
	snapshotID string,
	sessionID string,
	paneID string,
	stripANSI bool,
	beforeLine int,
	pageSize int,
) (capturePaneSnapshotPage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.currentTimeLocked()
	c.pruneExpiredLocked(now)
	snapshot := c.entries[snapshotID]
	if snapshot == nil ||
		snapshot.sessionID != sessionID ||
		snapshot.paneID != paneID ||
		snapshot.stripANSI != stripANSI {
		return capturePaneSnapshotPage{}, snapshotExpiredError()
	}
	if beforeLine < 0 || beforeLine > len(snapshot.lines) {
		return capturePaneSnapshotPage{}, fmt.Errorf(
			"before_line must be between 0 and %d",
			len(snapshot.lines),
		)
	}
	snapshot.lastAccess = now
	return buildCaptureSnapshotPage(snapshot, beforeLine, pageSize)
}

func (c *capturePaneSnapshotCache) currentTimeLocked() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

func (c *capturePaneSnapshotCache) pruneExpiredLocked(now time.Time) {
	for snapshotID, snapshot := range c.entries {
		if now.Sub(snapshot.lastAccess) >= captureSnapshotIdleTTL {
			delete(c.entries, snapshotID)
		}
	}
}

func (c *capturePaneSnapshotCache) makeRoomLocked() {
	for len(c.entries) >= maxCaptureSnapshots {
		oldestID := ""
		var oldestAccess time.Time
		for snapshotID, snapshot := range c.entries {
			if oldestID == "" ||
				snapshot.lastAccess.Before(oldestAccess) ||
				(snapshot.lastAccess.Equal(oldestAccess) && snapshotID < oldestID) {
				oldestID = snapshotID
				oldestAccess = snapshot.lastAccess
			}
		}
		delete(c.entries, oldestID)
	}
}

func snapshotExpiredError() error {
	return commands.NewResultError(
		"SNAPSHOT_EXPIRED",
		"capture snapshot expired; request a new snapshot",
	)
}

func splitCaptureSnapshotLines(content string) []string {
	if content == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(content, "\n"), "\n")
}

func retainCaptureSnapshotLines(content string) ([]string, int, bool) {
	return retainCaptureSnapshotLinesWithin(content, maxCaptureSnapshotRows, maxCaptureSnapshotBytes)
}

func retainCaptureSnapshotLinesWithin(content string, maxRows, maxBytes int) ([]string, int, bool) {
	source := splitCaptureSnapshotLines(content)
	retained := retainNewestCaptureLines(source, maxRows, maxBytes)
	return retained, len(source), len(retained) != len(source)
}

func retainNewestCaptureLines(source []string, maxRows, maxBytes int) []string {
	if maxRows < 1 || maxBytes < 0 || len(source) == 0 {
		return nil
	}
	firstAllowedRow := max(0, len(source)-maxRows)
	start := len(source)
	usedBytes := 0
	for index := len(source) - 1; index >= firstAllowedRow; index-- {
		addedBytes := len(source[index])
		if start < len(source) {
			addedBytes++
		}
		if addedBytes > maxBytes-usedBytes {
			break
		}
		usedBytes += addedBytes
		start = index
	}
	retained := make([]string, len(source)-start)
	for index, line := range source[start:] {
		retained[index] = strings.Clone(line)
	}
	return retained
}

func buildCaptureSnapshotPage(
	snapshot *capturePaneSnapshot,
	end int,
	pageSize int,
) (capturePaneSnapshotPage, error) {
	firstAllowedLine := max(0, end-pageSize)
	start := end
	encodedBytes := 2 // JSON string quotes.
	for index := end - 1; index >= firstAllowedLine; index-- {
		encodedLine, err := json.Marshal(snapshot.lines[index])
		if err != nil {
			return capturePaneSnapshotPage{}, fmt.Errorf("encode capture snapshot page: %w", err)
		}
		addedBytes := len(encodedLine) - 2
		if start < end {
			addedBytes += 2 // The joined newline is encoded as \n.
		}
		if encodedBytes+addedBytes > maxCaptureSnapshotPageContentBytes {
			break
		}
		encodedBytes += addedBytes
		start = index
	}
	if start == end && end > firstAllowedLine {
		return capturePaneSnapshotPage{}, fmt.Errorf(
			"capture snapshot line exceeds %d-byte page limit",
			maxCaptureSnapshotPageContentBytes,
		)
	}
	return capturePaneSnapshotPage{
		snapshot: snapshot,
		content:  strings.Join(snapshot.lines[start:end], "\n"),
		start:    start,
		end:      end,
		hasOlder: start > 0,
	}, nil
}

func (p capturePaneSnapshotPage) result() map[string]any {
	result := map[string]any{
		"content":            p.content,
		"line_count":         p.end - p.start,
		"capture_mode":       "snapshot",
		"snapshot_id":        p.snapshot.id,
		"range_start":        p.start,
		"range_end":          p.end,
		"total_lines":        len(p.snapshot.lines),
		"source_total_lines": p.snapshot.sourceTotalLines,
		"snapshot_truncated": p.snapshot.truncated,
		"has_older":          p.hasOlder,
	}
	if p.hasOlder {
		result["next_before"] = p.start
	}
	return result
}
