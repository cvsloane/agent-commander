package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/agent-command/agentd/internal/commands"
	"github.com/agent-command/agentd/internal/protocol"
)

const (
	defaultTranscriptPageSize = 200
	maxTranscriptPageSize     = 500
	maxTranscriptContentBytes = 16 * 1024
	maxTranscriptEntryBytes   = 32 * 1024
	maxTranscriptScannerToken = 8 * 1024 * 1024
)

var errInvalidTranscriptRequest = errors.New("invalid transcript request")

func (a *Agent) executeCaptureTranscriptCommand(session *SessionState, payload json.RawMessage) (map[string]any, error) {
	var request protocol.CaptureTranscriptPayload
	if err := json.Unmarshal(payload, &request); err != nil {
		return nil, err
	}
	if request.PageSize == 0 {
		request.PageSize = defaultTranscriptPageSize
	}
	if request.PageSize < 1 || request.PageSize > maxTranscriptPageSize {
		return nil, fmt.Errorf("page_size must be between 1 and %d", maxTranscriptPageSize)
	}
	if request.BeforeEntry != nil && *request.BeforeEntry < 0 {
		return nil, fmt.Errorf("before_entry must be nonnegative")
	}

	transcriptPath, source, err := a.resolveTranscriptPath(session)
	if err != nil {
		return nil, commands.NewResultError("no_transcript", "Claude transcript is unavailable")
	}
	entries, firstEntry, totalEntries, err := readTranscriptPage(transcriptPath, request)
	if err != nil {
		if errors.Is(err, errInvalidTranscriptRequest) {
			return nil, err
		}
		return nil, commands.NewResultError("no_transcript", "Claude transcript is unavailable")
	}
	return map[string]any{
		"entries":       entries,
		"first_entry":   firstEntry,
		"total_entries": totalEntries,
		"source":        source,
	}, nil
}

func (a *Agent) resolveTranscriptPath(session *SessionState) (string, string, error) {
	projectsRoot, err := a.transcriptProjectsRoot()
	if err != nil {
		return "", "", err
	}
	if retained := a.transcriptPathForSession(session.ID); retained != "" {
		if resolved, resolveErr := resolveTranscriptFile(projectsRoot, retained); resolveErr == nil {
			return resolved, "hook", nil
		}
	}
	if strings.TrimSpace(session.CWD) == "" {
		return "", "", fmt.Errorf("no Claude transcript for session")
	}

	projectDir := filepath.Join(projectsRoot, claudeProjectSlug(session.CWD))
	items, err := os.ReadDir(projectDir)
	if err != nil {
		return "", "", fmt.Errorf("no Claude transcript for session: %w", err)
	}
	var newestPath string
	var newestModTime int64
	for _, item := range items {
		if item.IsDir() || !strings.EqualFold(filepath.Ext(item.Name()), ".jsonl") {
			continue
		}
		candidate := filepath.Join(projectDir, item.Name())
		resolved, err := resolveTranscriptFile(projectsRoot, candidate)
		if err != nil {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil {
			continue
		}
		modTime := info.ModTime().UnixNano()
		if newestPath == "" || modTime > newestModTime {
			newestPath = resolved
			newestModTime = modTime
		}
	}
	if newestPath == "" {
		return "", "", fmt.Errorf("no Claude transcript for session")
	}
	return newestPath, "derived", nil
}

func (a *Agent) transcriptProjectsRoot() (string, error) {
	if a.claudeProjectsRoot != "" {
		return a.claudeProjectsRoot, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "projects"), nil
}

func claudeProjectSlug(cwd string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, cwd)
}

func resolveTranscriptFile(projectsRoot, candidate string) (string, error) {
	root, err := filepath.EvalSymlinks(projectsRoot)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(root, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("transcript path is outside Claude projects")
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("transcript path is not a regular file")
	}
	return resolved, nil
}

func readTranscriptPage(path string, request protocol.CaptureTranscriptPayload) ([]map[string]any, int, int, error) {
	totalEntries, err := countTranscriptEntries(path)
	if err != nil {
		return nil, 0, 0, err
	}
	endEntry := totalEntries
	if request.BeforeEntry != nil {
		endEntry = *request.BeforeEntry
		if endEntry > totalEntries {
			return nil, 0, totalEntries, fmt.Errorf("%w: before_entry %d exceeds total entries %d", errInvalidTranscriptRequest, endEntry, totalEntries)
		}
	}
	firstEntry := max(0, endEntry-request.PageSize)

	file, err := os.Open(path)
	if err != nil {
		return nil, 0, totalEntries, err
	}
	defer file.Close()
	scanner := newTranscriptScanner(file)
	entries := make([]map[string]any, 0, endEntry-firstEntry)
	entryIndex := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if entryIndex >= firstEntry && entryIndex < endEntry {
			var entry map[string]any
			if err := json.Unmarshal([]byte(line), &entry); err != nil {
				// Claude appends to these files live; a torn or corrupt line
				// must not fail the page. The stub renders as nothing.
				entries = append(entries, map[string]any{"type": "x-unparseable"})
			} else {
				entries = append(entries, sanitizeTranscriptEntry(entry))
			}
		}
		entryIndex++
		if entryIndex >= endEntry {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, 0, totalEntries, err
	}
	return entries, firstEntry, totalEntries, nil
}

func countTranscriptEntries(path string) (int, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	scanner := newTranscriptScanner(file)
	count := 0
	lastLine := ""
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" {
			count++
			lastLine = line
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	// Exclude a mid-append torn tail so the newest page ends on a complete
	// entry and count/page indices stay aligned across the retry.
	if count > 0 && !json.Valid([]byte(lastLine)) {
		count--
	}
	return count, nil
}

func newTranscriptScanner(file *os.File) *bufio.Scanner {
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), maxTranscriptScannerToken)
	return scanner
}

func sanitizeTranscriptEntry(entry map[string]any) map[string]any {
	trimmed := make(map[string]any, len(entry))
	for key, value := range entry {
		// Bulky non-rendered payloads (Bash stdout, Edit diffs, …) ride under
		// toolUseResult; the formatter never displays them.
		if strings.EqualFold(key, "toolUseResult") || strings.EqualFold(key, "tool_use_result") {
			continue
		}
		trimmed[key] = value
	}
	budget := maxTranscriptEntryBytes
	return sanitizeTranscriptMap(trimmed, true, &budget)
}

func sanitizeTranscriptMap(value map[string]any, inContent bool, contentBudget *int) map[string]any {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	cleaned := make(map[string]any, len(value))
	for _, key := range keys {
		item := value[key]
		if shouldDropTranscriptBlob(value, key, item) {
			continue
		}
		if strings.EqualFold(key, "content") {
			budget := maxTranscriptContentBytes
			cleaned[key] = sanitizeTranscriptValue(item, true, &budget, true)
			continue
		}
		countString := inContent && !isTranscriptMetadataKey(key)
		cleaned[key] = sanitizeTranscriptValue(item, inContent, contentBudget, countString)
	}
	return cleaned
}

func sanitizeTranscriptValue(value any, inContent bool, contentBudget *int, countString bool) any {
	switch typed := value.(type) {
	case map[string]any:
		return sanitizeTranscriptMap(typed, inContent, contentBudget)
	case []any:
		cleaned := make([]any, 0, len(typed))
		for _, item := range typed {
			cleaned = append(cleaned, sanitizeTranscriptValue(item, inContent, contentBudget, true))
		}
		return cleaned
	case string:
		if !inContent || contentBudget == nil || !countString {
			return typed
		}
		cleaned := truncateUTF8Bytes(typed, *contentBudget)
		*contentBudget -= len([]byte(cleaned))
		return cleaned
	default:
		return typed
	}
}

func isTranscriptMetadataKey(key string) bool {
	switch strings.ToLower(key) {
	case "id", "type", "role", "name", "media_type", "mime_type":
		return true
	default:
		return false
	}
}

func shouldDropTranscriptBlob(parent map[string]any, key string, value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	normalizedKey := strings.ToLower(key)
	if normalizedKey == "base64" || normalizedKey == "blob" {
		return true
	}
	if normalizedKey != "data" {
		return false
	}
	parentType, _ := parent["type"].(string)
	parentType = strings.ToLower(parentType)
	return parentType == "base64" || parentType == "binary" || looksLikeBase64(text)
}

func looksLikeBase64(value string) bool {
	if len(value) < 128 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '+' || char == '/' || char == '=' ||
			char == '\r' || char == '\n' {
			continue
		}
		return false
	}
	return true
}

func truncateUTF8Bytes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len([]byte(value)) <= limit {
		return value
	}
	truncated := []byte(value)[:limit]
	for len(truncated) > 0 && !utf8.Valid(truncated) {
		truncated = truncated[:len(truncated)-1]
	}
	return string(truncated)
}
