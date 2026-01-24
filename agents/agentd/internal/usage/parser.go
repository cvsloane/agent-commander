package usage

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// SessionUsage holds parsed token usage for a session
type SessionUsage struct {
	Provider         string
	InputTokens      *int
	OutputTokens     *int
	TotalTokens      *int
	CacheReadTokens  *int
	CacheWriteTokens *int
	CostCents        *int
	// Percent-based usage (from CLI output)
	SessionUtilizationPercent      *float64
	SessionLeftPercent             *float64
	SessionResetText               *string
	WeeklyUtilizationPercent       *float64
	WeeklyLeftPercent              *float64
	WeeklyResetText                *string
	WeeklySonnetUtilizationPercent *float64
	WeeklySonnetResetText          *string
	WeeklyOpusUtilizationPercent   *float64
	WeeklyOpusResetText            *string
	// Codex context info
	ContextUsedTokens   *int
	ContextTotalTokens  *int
	ContextLeftPercent  *float64
	FiveHourLeftPercent *float64
	FiveHourResetText   *string
	// Gemini daily usage
	DailyUtilizationPercent *float64
	DailyLeftPercent        *float64
	DailyResetHours         *int
	RawLine                 string
	ReportedAt              time.Time
}

// UsageTracker tracks per-session usage and emits on changes
type UsageTracker struct {
	lastUsage map[string]*SessionUsage // session_id -> last known usage
}

// NewUsageTracker creates a new usage tracker
func NewUsageTracker() *UsageTracker {
	return &UsageTracker{
		lastUsage: make(map[string]*SessionUsage),
	}
}

// ParseAndCheckChanged parses snapshot text for usage and returns usage if changed
// Returns nil if no usage found or if unchanged from last parse
func (t *UsageTracker) ParseAndCheckChanged(sessionID, provider, snapshotText string) *SessionUsage {
	usage := ParseUsageFromText(provider, snapshotText)
	if usage == nil {
		return nil
	}

	// Check if this is different from last known usage
	last := t.lastUsage[sessionID]
	if last != nil && usageEqual(last, usage) {
		return nil
	}

	// Update tracking
	t.lastUsage[sessionID] = usage
	return usage
}

// RemoveSession cleans up tracking for a removed session
func (t *UsageTracker) RemoveSession(sessionID string) {
	delete(t.lastUsage, sessionID)
}

// ParseUsageFromText extracts token usage from console output text
func ParseUsageFromText(provider, text string) *SessionUsage {
	switch provider {
	case "claude_code":
		return parseClaudeUsageFromText(text)
	case "codex":
		return parseCodexUsageFromText(text)
	case "gemini_cli":
		return parseGeminiUsageFromText(text)
	default:
		return parseGenericUsageFromText(provider, text)
	}
}

// Patterns for Claude Code usage output
var (
	// Matches patterns like: "Total cost: $0.12 (3,456 in / 1,234 out)"
	claudeCostPattern = regexp.MustCompile(`(?i)total\s*cost[:\s]*\$([0-9.]+)(?:\s*\(([0-9,]+)\s*(?:in|input)[^\)]*\/\s*([0-9,]+)\s*(?:out|output))?`)

	// Matches patterns like: "Tokens: 12,345 in / 6,789 out"
	claudeTokensPattern = regexp.MustCompile(`(?i)tokens?[:\s]*([0-9,]+)\s*(?:in|input)(?:\s*\/\s*|\s+)([0-9,]+)\s*(?:out|output)`)

	// Matches patterns like: "20% used" or "88% left"
	percentUsedPattern = regexp.MustCompile(`(?i)([0-9]+(?:\\.[0-9]+)?)%\\s*used`)
	percentLeftPattern = regexp.MustCompile(`(?i)([0-9]+(?:\\.[0-9]+)?)%\\s*left`)
	resetLinePattern   = regexp.MustCompile(`(?i)^resets?\\s*(.*)$`)

	// Matches patterns like: "12.3K tokens used"
	genericTokenPattern = regexp.MustCompile(`(?i)([0-9,.]+)\s*[KMB]?\s*tokens?\s*(?:used|total)`)

	// Matches patterns like: "Context: 45% (12K / 128K tokens)"
	codexContextPattern = regexp.MustCompile(`(?i)context\\s+window[:\s]*([0-9]+(?:\\.[0-9]+)?)%\\s*left\\s*\\(([0-9,.]+)\\s*[KMB]?\\s*used\\s*/\\s*([0-9,.]+)\\s*[KMB]?\\)`)

	// Matches patterns like: "5h limit: ... 88% left (resets 17:50)"
	codexLimitPattern = regexp.MustCompile(`(?i)^(5h\\s+limit|weekly\\s+limit)[:\\s].*?([0-9]+(?:\\.[0-9]+)?)%\\s*left(?:\\s*\\((?:resets?|reset)\\s*([^\\)]*)\\))?`)

	// Matches simple total pattern: "Total tokens: 12,345"
	simpleTotalPattern = regexp.MustCompile(`(?i)total\s*tokens?[:\s]*([0-9,]+)`)
)

func parseClaudeUsageFromText(text string) *SessionUsage {
	usage := &SessionUsage{
		Provider:   "claude_code",
		ReportedAt: time.Now().UTC(),
	}

	lines := strings.Split(text, "\n")
	section := ""
	found := false

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		lower := strings.ToLower(line)
		switch {
		case strings.HasPrefix(lower, "current session"):
			section = "session"
			continue
		case strings.HasPrefix(lower, "current week"):
			if strings.Contains(lower, "sonnet") {
				section = "weekly_sonnet"
			} else if strings.Contains(lower, "opus") {
				section = "weekly_opus"
			} else {
				section = "weekly"
			}
			continue
		}

		if match := percentUsedPattern.FindStringSubmatch(line); len(match) > 1 {
			if value := parsePercent(match[1]); value != nil {
				switch section {
				case "session":
					usage.SessionUtilizationPercent = value
				case "weekly":
					usage.WeeklyUtilizationPercent = value
				case "weekly_sonnet":
					usage.WeeklySonnetUtilizationPercent = value
				case "weekly_opus":
					usage.WeeklyOpusUtilizationPercent = value
				}
				if usage.RawLine == "" {
					usage.RawLine = line
				}
				found = true
			}
		}

		if match := percentLeftPattern.FindStringSubmatch(line); len(match) > 1 {
			if value := parsePercent(match[1]); value != nil {
				switch section {
				case "session":
					usage.SessionLeftPercent = value
				case "weekly":
					usage.WeeklyLeftPercent = value
				}
				if usage.RawLine == "" {
					usage.RawLine = line
				}
				found = true
			}
		}

		if match := resetLinePattern.FindStringSubmatch(line); len(match) > 1 && section != "" {
			text := strings.TrimSpace(match[1])
			if text != "" {
				switch section {
				case "session":
					usage.SessionResetText = &text
				case "weekly":
					usage.WeeklyResetText = &text
				case "weekly_sonnet":
					usage.WeeklySonnetResetText = &text
				case "weekly_opus":
					usage.WeeklyOpusResetText = &text
				}
				found = true
			}
		}

		if parsed := parseClaudeUsageLine(line); parsed != nil {
			mergeUsage(usage, parsed)
			usage.RawLine = line
			found = true
		}
	}

	if !found || !hasUsageData(usage) {
		return nil
	}
	return usage
}

func parseCodexUsageFromText(text string) *SessionUsage {
	usage := &SessionUsage{
		Provider:   "codex",
		ReportedAt: time.Now().UTC(),
	}

	lines := strings.Split(text, "\n")
	found := false

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		if match := codexContextPattern.FindStringSubmatch(line); len(match) >= 4 {
			if value := parsePercent(match[1]); value != nil {
				usage.ContextLeftPercent = value
			}
			if used := parseScaledNumber(match[2]); used > 0 {
				u := int(used)
				usage.ContextUsedTokens = &u
			}
			if total := parseScaledNumber(match[3]); total > 0 {
				t := int(total)
				usage.ContextTotalTokens = &t
			}
			usage.RawLine = line
			found = true
		}

		if match := codexLimitPattern.FindStringSubmatch(line); len(match) >= 3 {
			limitName := strings.ToLower(strings.TrimSpace(match[1]))
			if value := parsePercent(match[2]); value != nil {
				if strings.HasPrefix(limitName, "5h") {
					usage.FiveHourLeftPercent = value
				} else {
					usage.WeeklyLeftPercent = value
				}
				if usage.RawLine == "" {
					usage.RawLine = line
				}
				found = true
			}
			if len(match) >= 4 {
				resetText := strings.TrimSpace(match[3])
				if resetText != "" {
					if strings.HasPrefix(limitName, "5h") {
						usage.FiveHourResetText = &resetText
					} else {
						usage.WeeklyResetText = &resetText
					}
				}
			}
		}

		if parsed := parseCodexUsageLine(line); parsed != nil {
			mergeUsage(usage, parsed)
			usage.RawLine = line
			found = true
		}
	}

	// If we only have context used tokens, set total_tokens for UI display.
	if usage.TotalTokens == nil && usage.ContextUsedTokens != nil {
		usage.TotalTokens = usage.ContextUsedTokens
	}

	if !found || !hasUsageData(usage) {
		return nil
	}
	return usage
}

// Gemini CLI /stats session output pattern:
// │  gemini-2.5-flash               -      100.0% (Resets in 24h)                                                                     │
var geminiModelUsagePattern = regexp.MustCompile(`(?i)(gemini-[^\s]+)\s+[\d-]+\s+([0-9.]+)%\s*\(Resets?\s+in\s+(\d+)h(?:\s+\d+m)?\)`)
var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

func parseGeminiUsageFromText(text string) *SessionUsage {
	usage := &SessionUsage{
		Provider:   "gemini_cli",
		ReportedAt: time.Now().UTC(),
	}

	lines := strings.Split(text, "\n")
	found := false
	var minUsageLeft *float64
	var minResetHours *int

	for _, raw := range lines {
		// Strip ANSI and box-drawing characters
		line := stripANSI(raw)
		line = strings.Trim(line, " │╭╰╮╯─_")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Look for model usage lines like "gemini-2.5-flash    -    100.0% (Resets in 24h)"
		if match := geminiModelUsagePattern.FindStringSubmatch(line); len(match) >= 4 {
			usageLeftPct := parsePercent(match[2])
			if usageLeftPct != nil {
				found = true
				// Track minimum usage_left to report overall daily utilization
				if minUsageLeft == nil || *usageLeftPct < *minUsageLeft {
					minUsageLeft = usageLeftPct
				}
				if hours, err := strconv.Atoi(match[3]); err == nil {
					if minResetHours == nil || hours < *minResetHours {
						minResetHours = &hours
					}
				}
				if usage.RawLine == "" {
					usage.RawLine = line
				}
			}
		}
	}

	// Convert usage_left to utilization (100 - usage_left)
	if minUsageLeft != nil {
		utilization := 100.0 - *minUsageLeft
		usage.DailyUtilizationPercent = &utilization
		usage.DailyLeftPercent = minUsageLeft
		if minResetHours != nil {
			usage.DailyResetHours = minResetHours
		} else {
			resetHours := 24
			usage.DailyResetHours = &resetHours
		}
	}

	if !found {
		return nil
	}
	return usage
}

func stripANSI(value string) string {
	if value == "" {
		return value
	}
	return ansiPattern.ReplaceAllString(value, "")
}

type GeminiModelUsage struct {
	UsageLeft  float64
	ResetHours int
}

func ParseGeminiModels(text string) map[string]GeminiModelUsage {
	if text == "" {
		return nil
	}

	lines := strings.Split(text, "\n")
	models := make(map[string]GeminiModelUsage)

	for _, raw := range lines {
		line := stripANSI(raw)
		line = strings.Trim(line, " │╭╰╮╯─_")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if match := geminiModelUsagePattern.FindStringSubmatch(line); len(match) >= 4 {
			usageLeft := parsePercent(match[2])
			resetHours, err := strconv.Atoi(match[3])
			if err != nil || usageLeft == nil {
				continue
			}
			models[match[1]] = GeminiModelUsage{
				UsageLeft:  *usageLeft,
				ResetHours: resetHours,
			}
		}
	}

	if len(models) == 0 {
		return nil
	}
	return models
}

func parseGenericUsageFromText(provider, text string) *SessionUsage {
	usage := &SessionUsage{
		Provider:   provider,
		ReportedAt: time.Now().UTC(),
	}

	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if parsed := parseGenericUsageLine(line); parsed != nil {
			mergeUsage(usage, parsed)
			usage.RawLine = line
			break
		}
	}

	if !hasUsageData(usage) {
		return nil
	}
	return usage
}

func parseClaudeUsageLine(line string) *SessionUsage {
	usage := &SessionUsage{}
	found := false

	// Try cost pattern first (most informative)
	if match := claudeCostPattern.FindStringSubmatch(line); len(match) >= 2 {
		if cost, err := strconv.ParseFloat(match[1], 64); err == nil {
			cents := int(cost * 100)
			usage.CostCents = &cents
			found = true
		}
		if len(match) >= 4 {
			if in := parseTokenCount(match[2]); in > 0 {
				usage.InputTokens = &in
			}
			if out := parseTokenCount(match[3]); out > 0 {
				usage.OutputTokens = &out
			}
		}
	}

	// Try tokens pattern
	if match := claudeTokensPattern.FindStringSubmatch(line); len(match) >= 3 {
		if in := parseTokenCount(match[1]); in > 0 {
			usage.InputTokens = &in
			found = true
		}
		if out := parseTokenCount(match[2]); out > 0 {
			usage.OutputTokens = &out
			found = true
		}
	}

	// Try simple total pattern
	if match := simpleTotalPattern.FindStringSubmatch(line); len(match) >= 2 {
		if total := parseTokenCount(match[1]); total > 0 {
			usage.TotalTokens = &total
			found = true
		}
	}

	// Calculate total if we have in/out
	if usage.InputTokens != nil && usage.OutputTokens != nil && usage.TotalTokens == nil {
		total := *usage.InputTokens + *usage.OutputTokens
		usage.TotalTokens = &total
	}

	if !found {
		return nil
	}
	return usage
}

func parseCodexUsageLine(line string) *SessionUsage {
	usage := &SessionUsage{}
	found := false

	// Try context pattern
	if match := codexContextPattern.FindStringSubmatch(line); len(match) >= 3 {
		if used := parseScaledNumber(match[2]); used > 0 {
			total := int(used)
			usage.TotalTokens = &total
			found = true
		}
	}

	// Try generic token pattern as fallback
	if match := genericTokenPattern.FindStringSubmatch(line); len(match) >= 2 {
		if total := parseScaledNumber(match[1]); total > 0 {
			t := int(total)
			usage.TotalTokens = &t
			found = true
		}
	}

	if !found {
		return nil
	}
	return usage
}

func parseGenericUsageLine(line string) *SessionUsage {
	usage := &SessionUsage{}

	// Try generic token pattern
	if match := genericTokenPattern.FindStringSubmatch(line); len(match) >= 2 {
		if total := parseScaledNumber(match[1]); total > 0 {
			t := int(total)
			usage.TotalTokens = &t
			return usage
		}
	}

	// Try simple total pattern
	if match := simpleTotalPattern.FindStringSubmatch(line); len(match) >= 2 {
		if total := parseTokenCount(match[1]); total > 0 {
			usage.TotalTokens = &total
			return usage
		}
	}

	return nil
}

// parseTokenCount parses a token count string like "12,345"
func parseTokenCount(s string) int {
	clean := strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if n, err := strconv.Atoi(clean); err == nil {
		return n
	}
	return 0
}

func parsePercent(s string) *float64 {
	clean := strings.TrimSpace(strings.TrimSuffix(s, "%"))
	clean = strings.ReplaceAll(clean, ",", "")
	if clean == "" {
		return nil
	}
	if n, err := strconv.ParseFloat(clean, 64); err == nil {
		return &n
	}
	return nil
}

// parseScaledNumber parses numbers with K/M/B suffixes like "12.3K"
func parseScaledNumber(s string) float64 {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", "")

	multiplier := 1.0
	s = strings.ToUpper(s)

	if strings.HasSuffix(s, "K") {
		multiplier = 1000
		s = strings.TrimSuffix(s, "K")
	} else if strings.HasSuffix(s, "M") {
		multiplier = 1000000
		s = strings.TrimSuffix(s, "M")
	} else if strings.HasSuffix(s, "B") {
		multiplier = 1000000000
		s = strings.TrimSuffix(s, "B")
	}

	if n, err := strconv.ParseFloat(s, 64); err == nil {
		return n * multiplier
	}
	return 0
}

func mergeUsage(target, source *SessionUsage) {
	if source.InputTokens != nil && target.InputTokens == nil {
		target.InputTokens = source.InputTokens
	}
	if source.OutputTokens != nil && target.OutputTokens == nil {
		target.OutputTokens = source.OutputTokens
	}
	if source.TotalTokens != nil && target.TotalTokens == nil {
		target.TotalTokens = source.TotalTokens
	}
	if source.CacheReadTokens != nil && target.CacheReadTokens == nil {
		target.CacheReadTokens = source.CacheReadTokens
	}
	if source.CacheWriteTokens != nil && target.CacheWriteTokens == nil {
		target.CacheWriteTokens = source.CacheWriteTokens
	}
	if source.CostCents != nil && target.CostCents == nil {
		target.CostCents = source.CostCents
	}
	if source.SessionUtilizationPercent != nil && target.SessionUtilizationPercent == nil {
		target.SessionUtilizationPercent = source.SessionUtilizationPercent
	}
	if source.SessionLeftPercent != nil && target.SessionLeftPercent == nil {
		target.SessionLeftPercent = source.SessionLeftPercent
	}
	if source.SessionResetText != nil && target.SessionResetText == nil {
		target.SessionResetText = source.SessionResetText
	}
	if source.WeeklyUtilizationPercent != nil && target.WeeklyUtilizationPercent == nil {
		target.WeeklyUtilizationPercent = source.WeeklyUtilizationPercent
	}
	if source.WeeklyLeftPercent != nil && target.WeeklyLeftPercent == nil {
		target.WeeklyLeftPercent = source.WeeklyLeftPercent
	}
	if source.WeeklyResetText != nil && target.WeeklyResetText == nil {
		target.WeeklyResetText = source.WeeklyResetText
	}
	if source.WeeklySonnetUtilizationPercent != nil && target.WeeklySonnetUtilizationPercent == nil {
		target.WeeklySonnetUtilizationPercent = source.WeeklySonnetUtilizationPercent
	}
	if source.WeeklySonnetResetText != nil && target.WeeklySonnetResetText == nil {
		target.WeeklySonnetResetText = source.WeeklySonnetResetText
	}
	if source.WeeklyOpusUtilizationPercent != nil && target.WeeklyOpusUtilizationPercent == nil {
		target.WeeklyOpusUtilizationPercent = source.WeeklyOpusUtilizationPercent
	}
	if source.WeeklyOpusResetText != nil && target.WeeklyOpusResetText == nil {
		target.WeeklyOpusResetText = source.WeeklyOpusResetText
	}
	if source.ContextUsedTokens != nil && target.ContextUsedTokens == nil {
		target.ContextUsedTokens = source.ContextUsedTokens
	}
	if source.ContextTotalTokens != nil && target.ContextTotalTokens == nil {
		target.ContextTotalTokens = source.ContextTotalTokens
	}
	if source.ContextLeftPercent != nil && target.ContextLeftPercent == nil {
		target.ContextLeftPercent = source.ContextLeftPercent
	}
	if source.FiveHourLeftPercent != nil && target.FiveHourLeftPercent == nil {
		target.FiveHourLeftPercent = source.FiveHourLeftPercent
	}
	if source.FiveHourResetText != nil && target.FiveHourResetText == nil {
		target.FiveHourResetText = source.FiveHourResetText
	}
}

func usageEqual(a, b *SessionUsage) bool {
	return intPtrEqual(a.InputTokens, b.InputTokens) &&
		intPtrEqual(a.OutputTokens, b.OutputTokens) &&
		intPtrEqual(a.TotalTokens, b.TotalTokens) &&
		intPtrEqual(a.CacheReadTokens, b.CacheReadTokens) &&
		intPtrEqual(a.CacheWriteTokens, b.CacheWriteTokens) &&
		intPtrEqual(a.CostCents, b.CostCents) &&
		floatPtrEqual(a.SessionUtilizationPercent, b.SessionUtilizationPercent) &&
		floatPtrEqual(a.SessionLeftPercent, b.SessionLeftPercent) &&
		stringPtrEqual(a.SessionResetText, b.SessionResetText) &&
		floatPtrEqual(a.WeeklyUtilizationPercent, b.WeeklyUtilizationPercent) &&
		floatPtrEqual(a.WeeklyLeftPercent, b.WeeklyLeftPercent) &&
		stringPtrEqual(a.WeeklyResetText, b.WeeklyResetText) &&
		floatPtrEqual(a.WeeklySonnetUtilizationPercent, b.WeeklySonnetUtilizationPercent) &&
		stringPtrEqual(a.WeeklySonnetResetText, b.WeeklySonnetResetText) &&
		floatPtrEqual(a.WeeklyOpusUtilizationPercent, b.WeeklyOpusUtilizationPercent) &&
		stringPtrEqual(a.WeeklyOpusResetText, b.WeeklyOpusResetText) &&
		intPtrEqual(a.ContextUsedTokens, b.ContextUsedTokens) &&
		intPtrEqual(a.ContextTotalTokens, b.ContextTotalTokens) &&
		floatPtrEqual(a.ContextLeftPercent, b.ContextLeftPercent) &&
		floatPtrEqual(a.FiveHourLeftPercent, b.FiveHourLeftPercent) &&
		stringPtrEqual(a.FiveHourResetText, b.FiveHourResetText) &&
		floatPtrEqual(a.DailyUtilizationPercent, b.DailyUtilizationPercent) &&
		floatPtrEqual(a.DailyLeftPercent, b.DailyLeftPercent)
}

func intPtrEqual(a, b *int) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func floatPtrEqual(a, b *float64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func stringPtrEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func hasUsageData(u *SessionUsage) bool {
	return u.InputTokens != nil ||
		u.OutputTokens != nil ||
		u.TotalTokens != nil ||
		u.CacheReadTokens != nil ||
		u.CacheWriteTokens != nil ||
		u.CostCents != nil ||
		u.SessionUtilizationPercent != nil ||
		u.SessionLeftPercent != nil ||
		u.SessionResetText != nil ||
		u.WeeklyUtilizationPercent != nil ||
		u.WeeklyLeftPercent != nil ||
		u.WeeklyResetText != nil ||
		u.WeeklySonnetUtilizationPercent != nil ||
		u.WeeklySonnetResetText != nil ||
		u.WeeklyOpusUtilizationPercent != nil ||
		u.WeeklyOpusResetText != nil ||
		u.ContextUsedTokens != nil ||
		u.ContextTotalTokens != nil ||
		u.ContextLeftPercent != nil ||
		u.FiveHourLeftPercent != nil ||
		u.FiveHourResetText != nil ||
		u.DailyUtilizationPercent != nil ||
		u.DailyLeftPercent != nil
}
