// Package providerusage parses the output of provider usage/status CLI commands
// (`claude usage`, `codex status`, `gemini stats`) into the flat field maps the
// control plane stores as provider_usage rows.
//
// This is distinct from internal/usage, which parses usage figures out of tmux
// console snapshots. Same domain, different input: the commands here emit JSON
// or a stable report layout, so the parsers are strict; the snapshot parsers in
// internal/usage must tolerate arbitrary terminal text.
package providerusage

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func RunUsageCommand(command string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/bin/sh", "-lc", command)
	return cmd.CombinedOutput()
}

func MaybeRetryClaudeUsage(command, raw string) string {
	cleaned := strings.ToLower(StripANSI(raw))
	if cleaned == "" {
		return raw
	}
	if strings.Contains(cleaned, "current session") || strings.Contains(cleaned, "extra usage") {
		return raw
	}

	scriptPath, err := exec.LookPath("script")
	if err != nil || scriptPath == "" {
		return raw
	}

	ttyCommand := fmt.Sprintf("%s -q /dev/null -c %q", scriptPath, command)
	output, err := RunUsageCommand(ttyCommand)
	if err != nil {
		return raw
	}
	retryRaw := strings.TrimSpace(string(output))
	if retryRaw == "" {
		return raw
	}
	return retryRaw
}

func LooksLikeJSON(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	return strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")
}

func ExtractUsageFields(rawJSON map[string]any, rawText string) map[string]any {
	fields := map[string]any{}
	if rawJSON != nil {
		flattened := map[string]any{}
		flattenMap("", rawJSON, flattened)

		if val := findNumber(flattened, []string{
			"weekly_remaining_tokens", "weekly_remaining", "remaining_weekly_tokens", "remaining_weekly", "weeklyRemainingTokens", "weeklyRemaining",
		}); val != nil {
			fields["weekly_remaining_tokens"] = *val
		}
		if val := findNumber(flattened, []string{
			"weekly_limit_tokens", "weekly_limit", "weekly_quota_tokens", "weekly_quota", "weeklyLimitTokens", "weeklyQuota",
		}); val != nil {
			fields["weekly_limit_tokens"] = *val
		}
		if val := findNumber(flattened, []string{
			"remaining_tokens", "tokens_remaining", "remaining", "remainingTokens", "tokensRemaining", "token_remaining",
		}); val != nil {
			fields["remaining_tokens"] = *val
		}
		if val := findNumber(flattened, []string{
			"remaining_requests", "requests_remaining", "remainingRequests", "requestsRemaining",
		}); val != nil {
			fields["remaining_requests"] = *val
		}
		if val := findNumber(flattened, []string{
			"weekly_remaining_cost_cents", "weekly_remaining_cost", "weeklyRemainingCostCents",
		}); val != nil {
			fields["weekly_remaining_cost_cents"] = *val
		}
		if resetAt := findTime(flattened, []string{
			"reset_at", "resetAt", "resets_at", "resetsAt", "weekly_reset_at", "quota_reset_at",
		}); resetAt != "" {
			fields["reset_at"] = resetAt
		}

		// Extract utilization percentages (Claude and Codex APIs)
		if val := findFloat(flattened, []string{
			"five_hour.utilization", "five_hour_utilization", "fiveHourUtilization",
		}); val != nil {
			fields["five_hour_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"five_hour.resets_at", "five_hour.reset_at", "five_hour_reset_at", "fiveHourResetsAt",
		}); resetAt != "" {
			fields["five_hour_reset_at"] = resetAt
		}
		if val := findFloat(flattened, []string{
			"seven_day.utilization", "weekly.utilization", "weekly_utilization", "weeklyUtilization",
		}); val != nil {
			fields["weekly_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"seven_day.resets_at", "weekly.resets_at", "weekly_reset_at", "weeklyResetsAt",
		}); resetAt != "" {
			fields["weekly_reset_at"] = resetAt
		}
		if val := findFloat(flattened, []string{
			"seven_day_opus.utilization", "weekly_opus_utilization", "weeklyOpusUtilization",
		}); val != nil {
			fields["weekly_opus_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"seven_day_opus.resets_at", "weekly_opus_reset_at",
		}); resetAt != "" {
			fields["weekly_opus_reset_at"] = resetAt
		}
		if val := findFloat(flattened, []string{
			"seven_day_sonnet.utilization", "weekly_sonnet_utilization", "weeklySonnetUtilization",
		}); val != nil {
			fields["weekly_sonnet_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"seven_day_sonnet.resets_at", "weekly_sonnet_reset_at",
		}); resetAt != "" {
			fields["weekly_sonnet_reset_at"] = resetAt
		}

		applyCodexBucketedEntries(fields, rawJSON)
		applyParsedUsageEntries(fields, rawJSON)
	}

	if len(fields) == 0 && rawText != "" {
		textFields := extractUsageFieldsFromText(rawText)
		for k, v := range textFields {
			fields[k] = v
		}
	}

	return fields
}

func ParseProviderUsageText(provider, raw string) []map[string]any {
	switch provider {
	case "claude_code":
		return parseClaudeUsageText(raw)
	case "codex":
		return ParseCodexStatusText(raw)
	case "gemini_cli":
		return parseGeminiStatusText(raw)
	default:
		return nil
	}
}

func parseClaudeUsageText(raw string) []map[string]any {
	lines := strings.Split(raw, "\n")
	var entries []map[string]any
	var current map[string]any
	var extraPending map[string]any

	flush := func() {
		if current != nil {
			entries = append(entries, current)
			current = nil
		}
	}

	usedRe := regexp.MustCompile(`(?i)(\d{1,3})%\s*used`)
	extraUsageCostRe := regexp.MustCompile(`(?i)\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*/\s*\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*spent`)

	applyExtraUsage := func(target map[string]any, line, lower string, match []string) {
		if spent, ok := parseUSDToCents(match[1]); ok {
			target["spent_cents"] = spent
		}
		if limit, ok := parseUSDToCents(match[2]); ok {
			target["limit_cents"] = limit
		}
		if resetIdx := strings.Index(lower, "resets"); resetIdx >= 0 {
			resetText := strings.TrimSpace(line[resetIdx:])
			if resetText != "" {
				target["reset_text"] = resetText
			}
		}
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(stripBoxChars(line))
		if trimmed == "" {
			continue
		}

		lower := strings.ToLower(trimmed)
		switch {
		case strings.HasPrefix(lower, "current session"):
			flush()
			current = map[string]any{"label": "current_session"}
			continue
		case strings.HasPrefix(lower, "current week (all models)"):
			flush()
			current = map[string]any{"label": "weekly_all_models"}
			continue
		case strings.HasPrefix(lower, "current week (opus"):
			flush()
			current = map[string]any{"label": "weekly_opus"}
			continue
		case strings.HasPrefix(lower, "current week (sonnet"):
			flush()
			current = map[string]any{"label": "weekly_sonnet"}
			continue
		case strings.Contains(lower, "extra usage"):
			flush()
			current = map[string]any{"label": "extra_usage"}
			continue
		}

		if current == nil {
			if match := extraUsageCostRe.FindStringSubmatch(trimmed); len(match) > 2 {
				if extraPending == nil {
					extraPending = map[string]any{"label": "extra_usage"}
				}
				applyExtraUsage(extraPending, trimmed, lower, match)
			}
			continue
		}

		if match := usedRe.FindStringSubmatch(trimmed); len(match) > 1 {
			if percent, err := strconv.Atoi(match[1]); err == nil {
				current["used_percent"] = percent
			}
		}

		if match := extraUsageCostRe.FindStringSubmatch(trimmed); len(match) > 2 {
			label, _ := current["label"].(string)
			if label == "extra_usage" {
				applyExtraUsage(current, trimmed, lower, match)
			} else {
				if extraPending == nil {
					extraPending = map[string]any{"label": "extra_usage"}
				}
				applyExtraUsage(extraPending, trimmed, lower, match)
			}
			continue
		}

		if resetIdx := strings.Index(lower, "resets"); resetIdx >= 0 {
			resetText := strings.TrimSpace(trimmed[resetIdx:])
			if resetText != "" {
				current["reset_text"] = resetText
			}
		}
	}

	flush()
	if extraPending != nil {
		foundExtra := false
		for _, entry := range entries {
			label, _ := entry["label"].(string)
			if label == "extra_usage" {
				foundExtra = true
				break
			}
		}
		if !foundExtra {
			entries = append(entries, extraPending)
		}
	}
	return entries
}

func ParseCodexStatusText(raw string) []map[string]any {
	lines := strings.Split(raw, "\n")
	var entries []map[string]any

	modelRe := regexp.MustCompile(`(?i)^model:\s*(\S+)`)
	bucketHeaderRe := regexp.MustCompile(`(?i)^(.+?)\s+limit:\s*$`)
	contextRe := regexp.MustCompile(`(?i)context window:\s*([0-9]{1,3})%\s*left\s*\(([^)]+)\)`)
	limitRe := regexp.MustCompile(`(?i)^(5h limit|weekly limit):.*?([0-9]{1,3})%\s*left\s*\(resets\s*([^)]+)\)`)
	creditsRe := regexp.MustCompile(`(?i)credits:\s*([0-9,]+)`)
	sessionRe := regexp.MustCompile(`(?i)session:\s*([A-Za-z0-9-]+)`)
	usedTotalRe := regexp.MustCompile(`(?i)([0-9.]+\s*[KMB]?)\s*used\s*/\s*([0-9.]+\s*[KMB]?)`)

	currentBucket := "default"

	for _, line := range lines {
		trimmed := strings.TrimSpace(stripBoxChars(line))
		if trimmed == "" {
			continue
		}

		if match := modelRe.FindStringSubmatch(trimmed); len(match) > 1 {
			model := strings.TrimSpace(match[1])
			if model != "" {
				entries = append(entries, map[string]any{
					"label": "active_model",
					"model": model,
				})
				if currentBucket == "default" {
					currentBucket = model
				}
			}
			continue
		}

		if match := bucketHeaderRe.FindStringSubmatch(trimmed); len(match) > 1 {
			bucket := strings.TrimSpace(match[1])
			if bucket != "" {
				currentBucket = bucket
			}
			continue
		}

		if match := sessionRe.FindStringSubmatch(trimmed); len(match) > 1 {
			entries = append(entries, map[string]any{
				"label":        "session_ref",
				"session_ref":  match[1],
				"display_text": match[1],
			})
			continue
		}

		if match := contextRe.FindStringSubmatch(trimmed); len(match) > 2 {
			entry := map[string]any{"label": "context_window"}
			if percent, err := strconv.Atoi(match[1]); err == nil {
				entry["remaining_percent"] = percent
			}
			if totals := usedTotalRe.FindStringSubmatch(match[2]); len(totals) > 2 {
				if usedTokens, ok := parseScaledNumber(totals[1]); ok {
					entry["used_tokens"] = usedTokens
				}
				if totalTokens, ok := parseScaledNumber(totals[2]); ok {
					entry["total_tokens"] = totalTokens
					if usedTokens, ok := entry["used_tokens"].(int64); ok {
						entry["remaining_tokens"] = totalTokens - usedTokens
					}
				}
			}
			entries = append(entries, entry)
			continue
		}

		if match := limitRe.FindStringSubmatch(trimmed); len(match) > 3 {
			label := strings.ToLower(strings.TrimSpace(match[1]))
			entry := map[string]any{"label": label}
			if currentBucket != "" {
				entry["bucket"] = currentBucket
			}
			if percent, err := strconv.Atoi(match[2]); err == nil {
				entry["remaining_percent"] = percent
			}
			entry["reset_text"] = strings.TrimSpace(match[3])
			entries = append(entries, entry)
			continue
		}

		if match := creditsRe.FindStringSubmatch(trimmed); len(match) > 1 {
			clean := strings.ReplaceAll(match[1], ",", "")
			if credits, err := strconv.ParseInt(clean, 10, 64); err == nil {
				entries = append(entries, map[string]any{
					"label":   "credits",
					"credits": credits,
				})
			}
			continue
		}
	}

	return entries
}

func parseGeminiStatusText(raw string) []map[string]any {
	// Gemini CLI /stats outputs JSON with model usage info
	// Expected format:
	// {
	//   "models": {
	//     "gemini-2.5-flash": { "usage_left": 100, "reset_period": "24h" },
	//     "gemini-2.5-pro": { "usage_left": 85, "reset_period": "24h" }
	//   }
	// }
	// This function handles the case where raw_json parsing already happened,
	// but we still want to return parsed entries for the text output case.
	var entries []map[string]any

	// Try to parse as JSON first
	var data map[string]any
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		// Not JSON, try parsing text output
		return parseGeminiTextOutput(raw)
	}

	// Extract models from JSON
	models, ok := data["models"].(map[string]any)
	if !ok {
		return entries
	}

	for modelName, modelData := range models {
		if m, ok := modelData.(map[string]any); ok {
			entry := map[string]any{
				"label": modelName,
			}
			if usageLeft, ok := m["usage_left"].(float64); ok {
				entry["usage_left"] = usageLeft
				entry["utilization"] = 100 - usageLeft
			}
			if resetPeriod, ok := m["reset_period"].(string); ok {
				entry["reset_period"] = resetPeriod
			}
			entries = append(entries, entry)
		}
	}

	return entries
}

func parseGeminiTextOutput(raw string) []map[string]any {
	// Parse Gemini CLI text output if it's not JSON
	// Look for patterns like "Model: gemini-2.5-flash, Usage: 85% left"
	var entries []map[string]any
	lines := strings.Split(raw, "\n")

	modelUsageRe := regexp.MustCompile(`(?i)(\S*gemini[^\s:,]*)[:\s]+.*?(\d+)%\s*(left|used)`)
	usageLeftRe := regexp.MustCompile(`(?i)(\d+)%\s*left`)
	usageUsedRe := regexp.MustCompile(`(?i)(\d+)%\s*used`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		if match := modelUsageRe.FindStringSubmatch(trimmed); len(match) > 3 {
			modelName := match[1]
			percent, _ := strconv.Atoi(match[2])
			direction := strings.ToLower(match[3])

			entry := map[string]any{
				"label": modelName,
			}
			if direction == "left" {
				entry["usage_left"] = float64(percent)
				entry["utilization"] = float64(100 - percent)
			} else {
				entry["utilization"] = float64(percent)
				entry["usage_left"] = float64(100 - percent)
			}
			entries = append(entries, entry)
			continue
		}

		// Generic usage patterns
		if match := usageLeftRe.FindStringSubmatch(trimmed); len(match) > 1 {
			percent, _ := strconv.Atoi(match[1])
			entries = append(entries, map[string]any{
				"label":       "daily",
				"usage_left":  float64(percent),
				"utilization": float64(100 - percent),
			})
		} else if match := usageUsedRe.FindStringSubmatch(trimmed); len(match) > 1 {
			percent, _ := strconv.Atoi(match[1])
			entries = append(entries, map[string]any{
				"label":       "daily",
				"utilization": float64(percent),
				"usage_left":  float64(100 - percent),
			})
		}
	}

	return entries
}

var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

func StripANSI(value string) string {
	if value == "" {
		return value
	}
	return ansiPattern.ReplaceAllString(value, "")
}

func stripBoxChars(line string) string {
	return strings.Trim(StripANSI(line), " │╭╰╮╯─")
}

func parseScaledNumber(value string) (int64, bool) {
	trimmed := strings.TrimSpace(value)
	re := regexp.MustCompile(`(?i)^([0-9]+(?:\.[0-9]+)?)\s*([KMB]?)$`)
	match := re.FindStringSubmatch(trimmed)
	if len(match) < 3 {
		return 0, false
	}
	num, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0, false
	}
	switch strings.ToUpper(match[2]) {
	case "K":
		num *= 1000
	case "M":
		num *= 1000000
	case "B":
		num *= 1000000000
	}
	return int64(num), true
}

func parseUSDToCents(value string) (int, bool) {
	clean := strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if clean == "" {
		return 0, false
	}
	parts := strings.SplitN(clean, ".", 3)
	dollars, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, false
	}
	cents := 0
	if len(parts) > 1 {
		fraction := parts[1]
		if len(fraction) == 1 {
			fraction += "0"
		} else if len(fraction) > 2 {
			fraction = fraction[:2]
		}
		if fraction != "" {
			parsed, err := strconv.Atoi(fraction)
			if err != nil {
				return 0, false
			}
			cents = parsed
		}
	}
	return dollars*100 + cents, true
}

func flattenMap(prefix string, value map[string]any, out map[string]any) {
	for key, val := range value {
		lowerKey := strings.ToLower(key)
		fullKey := lowerKey
		if prefix != "" {
			fullKey = prefix + "." + lowerKey
		}
		out[fullKey] = val
		switch nested := val.(type) {
		case map[string]any:
			flattenMap(fullKey, nested, out)
		}
	}
}

func findNumber(flattened map[string]any, keys []string) *int64 {
	for _, key := range keys {
		lowerKey := strings.ToLower(key)
		for candidate, val := range flattened {
			if candidate == lowerKey || strings.HasSuffix(candidate, "."+lowerKey) {
				if num := parseNumber(val); num != nil {
					return num
				}
			}
		}
	}
	return nil
}

func findTime(flattened map[string]any, keys []string) string {
	for _, key := range keys {
		lowerKey := strings.ToLower(key)
		for candidate, val := range flattened {
			if candidate == lowerKey || strings.HasSuffix(candidate, "."+lowerKey) {
				if ts := parseTime(val); ts != "" {
					return ts
				}
			}
		}
	}
	return ""
}

func parseNumber(value any) *int64 {
	switch v := value.(type) {
	case float64:
		n := int64(v)
		return &n
	case float32:
		n := int64(v)
		return &n
	case int:
		n := int64(v)
		return &n
	case int64:
		return &v
	case json.Number:
		if i, err := v.Int64(); err == nil {
			return &i
		}
	case string:
		clean := strings.ReplaceAll(v, ",", "")
		if clean == "" {
			return nil
		}
		if i, err := strconv.ParseInt(clean, 10, 64); err == nil {
			return &i
		}
	}
	return nil
}

func parseTime(value any) string {
	switch v := value.(type) {
	case string:
		// Accept RFC3339 or RFC3339Nano strings
		if ts, err := time.Parse(time.RFC3339, v); err == nil {
			return ts.UTC().Format(time.RFC3339)
		}
		if ts, err := time.Parse(time.RFC3339Nano, v); err == nil {
			return ts.UTC().Format(time.RFC3339)
		}
	}
	return ""
}

func extractUsageFieldsFromText(raw string) map[string]any {
	fields := map[string]any{}
	cleaned := StripANSI(raw)
	remainingTokensRe := regexp.MustCompile(`(?i)(weekly\s+)?(remaining|left)[^0-9]{0,10}([0-9][0-9,]*)\s*(tokens?)`)
	matches := remainingTokensRe.FindAllStringSubmatch(cleaned, -1)
	for _, match := range matches {
		value := match[3]
		clean := strings.ReplaceAll(value, ",", "")
		if num, err := strconv.ParseInt(clean, 10, 64); err == nil {
			if strings.TrimSpace(strings.ToLower(match[1])) != "" {
				fields["weekly_remaining_tokens"] = num
			} else if _, ok := fields["remaining_tokens"]; !ok {
				fields["remaining_tokens"] = num
			}
		}
	}

	resetRe := regexp.MustCompile(`(?i)reset[^0-9]*(\d{4}-\d{2}-\d{2}[^\s]*)`)
	if match := resetRe.FindStringSubmatch(cleaned); len(match) > 1 {
		if ts, err := time.Parse(time.RFC3339, match[1]); err == nil {
			fields["reset_at"] = ts.UTC().Format(time.RFC3339)
		}
	}

	// Claude /usage and Codex /status text parsing
	if parsed := ParseProviderUsageText("claude_code", cleaned); len(parsed) > 0 {
		applyParsedUsageEntries(fields, map[string]any{"entries": parsed})
	}
	if parsed := ParseProviderUsageText("codex", cleaned); len(parsed) > 0 {
		rawJSON := map[string]any{"entries": parsed}
		applyCodexBucketedEntries(fields, rawJSON)
		applyParsedUsageEntries(fields, rawJSON)
	}

	return fields
}

func findFloat(flattened map[string]any, keys []string) *float64 {
	for _, key := range keys {
		lowerKey := strings.ToLower(key)
		for candidate, val := range flattened {
			if candidate == lowerKey || strings.HasSuffix(candidate, "."+lowerKey) {
				if f := parseFloat(val); f != nil {
					return f
				}
			}
		}
	}
	return nil
}

func parseFloat(value any) *float64 {
	switch v := value.(type) {
	case float64:
		return &v
	case float32:
		f := float64(v)
		return &f
	case int:
		f := float64(v)
		return &f
	case int64:
		f := float64(v)
		return &f
	case json.Number:
		if f, err := v.Float64(); err == nil {
			return &f
		}
	case string:
		clean := strings.TrimSpace(strings.TrimSuffix(v, "%"))
		clean = strings.ReplaceAll(clean, ",", "")
		if clean == "" {
			return nil
		}
		if f, err := strconv.ParseFloat(clean, 64); err == nil {
			return &f
		}
	}
	return nil
}

func normalizeUtilization(value float64) float64 {
	if value <= 1.0 && value > 0 {
		value *= 100
	}
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func getParsedUsageEntries(rawJSON map[string]any) []map[string]any {
	if rawJSON == nil {
		return nil
	}

	entriesAny, ok := rawJSON["entries"]
	if !ok {
		if parsed, ok := rawJSON["_parsed"].(map[string]any); ok {
			entriesAny = parsed["entries"]
		}
	}
	var entries []map[string]any
	switch typed := entriesAny.(type) {
	case []any:
		for _, entryAny := range typed {
			entry, ok := entryAny.(map[string]any)
			if !ok {
				continue
			}
			entries = append(entries, entry)
		}
	case []map[string]any:
		entries = typed
	default:
		return nil
	}

	return entries
}

// Codex /status now includes multiple buckets (e.g. a Spark bucket) in one output.
// Prefer the active model's bucket for top-level utilization fields.
func applyCodexBucketedEntries(fields map[string]any, rawJSON map[string]any) {
	entries := getParsedUsageEntries(rawJSON)
	if len(entries) == 0 {
		return
	}

	activeModel := ""
	for _, entry := range entries {
		label, _ := entry["label"].(string)
		if strings.EqualFold(strings.TrimSpace(label), "active_model") {
			if model, ok := entry["model"].(string); ok && strings.TrimSpace(model) != "" {
				activeModel = strings.TrimSpace(model)
			}
		}
	}

	type bucketLimits struct {
		bucket                 string
		has5h                  bool
		remaining5hPercent     float64
		hasWeekly              bool
		remainingWeeklyPercent float64
	}

	limitsByBucket := map[string]*bucketLimits{}
	var bucketOrder []string
	seenBucket := map[string]bool{}

	getBucket := func(name string) *bucketLimits {
		if existing, ok := limitsByBucket[name]; ok {
			return existing
		}
		created := &bucketLimits{bucket: name}
		limitsByBucket[name] = created
		if !seenBucket[name] {
			seenBucket[name] = true
			bucketOrder = append(bucketOrder, name)
		}
		return created
	}

	for _, entry := range entries {
		label, _ := entry["label"].(string)
		label = strings.ToLower(strings.TrimSpace(label))
		if label != "5h limit" && label != "weekly limit" {
			continue
		}

		bucket, _ := entry["bucket"].(string)
		bucket = strings.TrimSpace(bucket)
		if bucket == "" {
			bucket = "default"
		}

		remaining := parseFloat(entry["remaining_percent"])
		if remaining == nil {
			continue
		}
		remainingPercent := normalizeUtilization(*remaining)

		limits := getBucket(bucket)
		if label == "5h limit" && !limits.has5h {
			limits.has5h = true
			limits.remaining5hPercent = remainingPercent
		}
		if label == "weekly limit" && !limits.hasWeekly {
			limits.hasWeekly = true
			limits.remainingWeeklyPercent = remainingPercent
		}
	}

	// Only apply bucket selection when multiple buckets exist (the Spark/dual-bucket case).
	if len(bucketOrder) < 2 {
		return
	}

	// Choose preferred bucket: active model first, then first non-spark, else first.
	preferred := ""
	if activeModel != "" {
		for _, bucket := range bucketOrder {
			if strings.EqualFold(bucket, activeModel) {
				preferred = bucket
				break
			}
		}
	}
	if preferred == "" {
		for _, bucket := range bucketOrder {
			if !strings.Contains(strings.ToLower(bucket), "spark") {
				preferred = bucket
				break
			}
		}
	}
	if preferred == "" && len(bucketOrder) > 0 {
		preferred = bucketOrder[0]
	}

	chosen := limitsByBucket[preferred]
	if chosen == nil {
		return
	}

	if _, exists := fields["five_hour_utilization"]; !exists && chosen.has5h {
		fields["five_hour_utilization"] = 100 - chosen.remaining5hPercent
	}
	if _, exists := fields["weekly_utilization"]; !exists && chosen.hasWeekly {
		fields["weekly_utilization"] = 100 - chosen.remainingWeeklyPercent
	}
}

func applyParsedUsageEntries(fields map[string]any, rawJSON map[string]any) {
	entries := getParsedUsageEntries(rawJSON)
	if len(entries) == 0 {
		return
	}

	for _, entry := range entries {
		label, _ := entry["label"].(string)
		label = strings.ToLower(strings.TrimSpace(label))

		var utilization float64
		var hasUtilization bool
		if used := parseFloat(entry["used_percent"]); used != nil {
			utilization = normalizeUtilization(*used)
			hasUtilization = true
		} else if remaining := parseFloat(entry["remaining_percent"]); remaining != nil {
			utilization = 100 - normalizeUtilization(*remaining)
			hasUtilization = true
		}

		if !hasUtilization {
			continue
		}

		switch {
		case label == "current_session" || strings.Contains(label, "5h"):
			if _, exists := fields["five_hour_utilization"]; !exists {
				fields["five_hour_utilization"] = utilization
			}
		case label == "weekly_all_models" || label == "weekly limit" || label == "weekly":
			if _, exists := fields["weekly_utilization"]; !exists {
				fields["weekly_utilization"] = utilization
			}
		case label == "weekly_opus":
			if _, exists := fields["weekly_opus_utilization"]; !exists {
				fields["weekly_opus_utilization"] = utilization
			}
		case label == "weekly_sonnet":
			if _, exists := fields["weekly_sonnet_utilization"]; !exists {
				fields["weekly_sonnet_utilization"] = utilization
			}
		}
	}
}
