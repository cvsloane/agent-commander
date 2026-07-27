package usage

import "testing"

func deref[T any](t *testing.T, label string, v *T) T {
	t.Helper()
	if v == nil {
		t.Fatalf("%s: expected a value, got nil", label)
	}
	return *v
}

// Every pattern in this package parses console snapshot text. Five of them were
// written with `\\s`/`\\.` inside raw string literals, which matches a literal
// backslash rather than whitespace, so they never fired against real output.
// These cases lock the corrected behaviour in.
func TestPercentPatternsMatchRealConsoleText(t *testing.T) {
	for _, tc := range []struct {
		name    string
		line    string
		pattern string
	}{
		{"percent used", "20% used", "used"},
		{"percent used with decimal", "20.5% used", "used"},
		{"percent left", "88% left", "left"},
		{"percent left with decimal", "88.5% left", "left"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var match []string
			if tc.pattern == "used" {
				match = percentUsedPattern.FindStringSubmatch(tc.line)
			} else {
				match = percentLeftPattern.FindStringSubmatch(tc.line)
			}
			if len(match) < 2 {
				t.Fatalf("pattern did not match %q", tc.line)
			}
		})
	}

	if m := resetLinePattern.FindStringSubmatch("Resets 17:50"); len(m) < 2 || m[1] != "17:50" {
		t.Fatalf("resetLinePattern failed on %q: %#v", "Resets 17:50", m)
	}
}

func TestParseClaudeUsageFromText(t *testing.T) {
	text := `
Current session
  20% used
  Resets 17:50
Current week (all models)
  45.5% used
  Resets Sunday
Current week (Opus)
  12% used
`
	usage := ParseUsageFromText("claude_code", text)
	if usage == nil {
		t.Fatal("expected usage, got nil")
	}
	if got := deref(t, "SessionUtilizationPercent", usage.SessionUtilizationPercent); got != 20 {
		t.Errorf("SessionUtilizationPercent = %v, want 20", got)
	}
	if got := deref(t, "WeeklyUtilizationPercent", usage.WeeklyUtilizationPercent); got != 45.5 {
		t.Errorf("WeeklyUtilizationPercent = %v, want 45.5", got)
	}
	if got := deref(t, "WeeklyOpusUtilizationPercent", usage.WeeklyOpusUtilizationPercent); got != 12 {
		t.Errorf("WeeklyOpusUtilizationPercent = %v, want 12", got)
	}
	if got := deref(t, "SessionResetText", usage.SessionResetText); got != "17:50" {
		t.Errorf("SessionResetText = %q, want %q", got, "17:50")
	}
	if usage.Provider != "claude_code" {
		t.Errorf("Provider = %q, want claude_code", usage.Provider)
	}
}

func TestParseClaudeUsageIgnoresUnrelatedText(t *testing.T) {
	if usage := ParseUsageFromText("claude_code", "nothing to see here\njust prose\n"); usage != nil {
		t.Fatalf("expected nil for text without usage, got %#v", usage)
	}
}

func TestParseCodexContextWindow(t *testing.T) {
	usage := ParseUsageFromText("codex", "Context window: 45% left (12.3K used / 128K)")
	if usage == nil {
		t.Fatal("expected usage, got nil")
	}
	if got := deref(t, "ContextLeftPercent", usage.ContextLeftPercent); got != 45 {
		t.Errorf("ContextLeftPercent = %v, want 45", got)
	}
	// The K/M/B suffix must be applied: "12.3K" is 12300 tokens, not 12.
	if got := deref(t, "ContextUsedTokens", usage.ContextUsedTokens); got != 12300 {
		t.Errorf("ContextUsedTokens = %v, want 12300", got)
	}
	if got := deref(t, "ContextTotalTokens", usage.ContextTotalTokens); got != 128000 {
		t.Errorf("ContextTotalTokens = %v, want 128000", got)
	}
}

func TestParseCodexLimits(t *testing.T) {
	usage := ParseUsageFromText("codex", "5h limit: [####----] 88% left (resets 17:50)")
	if usage == nil {
		t.Fatal("expected usage, got nil")
	}
	if got := deref(t, "FiveHourLeftPercent", usage.FiveHourLeftPercent); got != 88 {
		t.Errorf("FiveHourLeftPercent = %v, want 88", got)
	}
	if got := deref(t, "FiveHourResetText", usage.FiveHourResetText); got != "17:50" {
		t.Errorf("FiveHourResetText = %q, want %q", got, "17:50")
	}

	weekly := ParseUsageFromText("codex", "weekly limit: 30% left (resets Sunday)")
	if weekly == nil {
		t.Fatal("expected weekly usage, got nil")
	}
	if got := deref(t, "WeeklyLeftPercent", weekly.WeeklyLeftPercent); got != 30 {
		t.Errorf("WeeklyLeftPercent = %v, want 30", got)
	}
}

func TestParseGeminiUsageFromText(t *testing.T) {
	text := "│  gemini-2.5-flash               -      100.0% (Resets in 24h)  │\n" +
		"│  gemini-2.5-pro                 -      40.0% (Resets in 6h)    │\n"

	usage := ParseUsageFromText("gemini_cli", text)
	if usage == nil {
		t.Fatal("expected usage, got nil")
	}
	// Reports the most-constrained model: 40% left => 60% utilized.
	if got := deref(t, "DailyLeftPercent", usage.DailyLeftPercent); got != 40 {
		t.Errorf("DailyLeftPercent = %v, want 40", got)
	}
	if got := deref(t, "DailyUtilizationPercent", usage.DailyUtilizationPercent); got != 60 {
		t.Errorf("DailyUtilizationPercent = %v, want 60", got)
	}
	if got := deref(t, "DailyResetHours", usage.DailyResetHours); got != 6 {
		t.Errorf("DailyResetHours = %v, want 6", got)
	}
}

func TestParseGeminiModels(t *testing.T) {
	text := "│  gemini-2.5-flash               -      100.0% (Resets in 24h)  │\n" +
		"│  gemini-2.5-pro                 -      40.0% (Resets in 6h)    │\n"

	models := ParseGeminiModels(text)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d: %#v", len(models), models)
	}
	if got := models["gemini-2.5-pro"]; got.UsageLeft != 40 || got.ResetHours != 6 {
		t.Errorf("gemini-2.5-pro = %#v, want {40 6}", got)
	}
}

func TestStripANSI(t *testing.T) {
	if got := stripANSI("\x1b[31mred\x1b[0m"); got != "red" {
		t.Errorf("stripANSI = %q, want %q", got, "red")
	}
}

func TestParseScaledNumber(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want float64
	}{
		{"1500", 1500},
		{"1,500", 1500},
		{"12.3K", 12300},
		{"1.5M", 1500000},
		{"2B", 2000000000},
		{"not-a-number", 0},
	} {
		if got := parseScaledNumber(tc.in); got != tc.want {
			t.Errorf("parseScaledNumber(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestUsageTrackerEmitsOnlyOnChange(t *testing.T) {
	tracker := NewUsageTracker()
	const sessionID = "session-1"
	text := "Current session\n  20% used\n"

	if first := tracker.ParseAndCheckChanged(sessionID, "claude_code", text); first == nil {
		t.Fatal("expected first parse to report usage")
	}
	if repeat := tracker.ParseAndCheckChanged(sessionID, "claude_code", text); repeat != nil {
		t.Fatalf("expected unchanged usage to be suppressed, got %#v", repeat)
	}

	changed := tracker.ParseAndCheckChanged(sessionID, "claude_code", "Current session\n  35% used\n")
	if changed == nil {
		t.Fatal("expected changed usage to be reported")
	}
	if got := deref(t, "SessionUtilizationPercent", changed.SessionUtilizationPercent); got != 35 {
		t.Errorf("SessionUtilizationPercent = %v, want 35", got)
	}

	tracker.RemoveSession(sessionID)
	if afterRemove := tracker.ParseAndCheckChanged(sessionID, "claude_code", text); afterRemove == nil {
		t.Fatal("expected usage to be reported again after RemoveSession")
	}
}
