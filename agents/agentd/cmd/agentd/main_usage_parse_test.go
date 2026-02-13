package main

import "testing"

func TestParseCodexStatusText_Buckets(t *testing.T) {
	status := `OpenAI Codex (v0.101.0)
Model: gpt-5.3-codex (reasoning xhigh, summaries auto)
5h limit: [____________________] 93% left (resets 13:41)
Weekly limit: [____________________] 49% left (resets 13:18 on 16 Feb)
GPT-5.3-Codex-Spark limit:
5h limit: [____________________] 100% left (resets 18:13)
Weekly limit: [____________________] 100% left (resets 13:13 on 20 Feb)
`

	entries := parseCodexStatusText(status)
	if len(entries) == 0 {
		t.Fatalf("expected entries, got none")
	}

	foundActiveModel := false
	for _, entry := range entries {
		label, _ := entry["label"].(string)
		if label != "active_model" {
			continue
		}
		model, _ := entry["model"].(string)
		if model != "gpt-5.3-codex" {
			t.Fatalf("expected active_model gpt-5.3-codex, got %q", model)
		}
		foundActiveModel = true
		break
	}
	if !foundActiveModel {
		t.Fatalf("expected active_model entry")
	}

	findRemaining := func(label, bucket string) (int, bool) {
		for _, entry := range entries {
			l, _ := entry["label"].(string)
			if l != label {
				continue
			}
			b, _ := entry["bucket"].(string)
			if b != bucket {
				continue
			}
			remaining, ok := entry["remaining_percent"].(int)
			return remaining, ok
		}
		return 0, false
	}

	if remaining, ok := findRemaining("5h limit", "gpt-5.3-codex"); !ok || remaining != 93 {
		t.Fatalf("expected 5h limit remaining_percent 93 for gpt-5.3-codex, got %v (ok=%v)", remaining, ok)
	}
	if remaining, ok := findRemaining("weekly limit", "gpt-5.3-codex"); !ok || remaining != 49 {
		t.Fatalf("expected weekly limit remaining_percent 49 for gpt-5.3-codex, got %v (ok=%v)", remaining, ok)
	}
	if remaining, ok := findRemaining("5h limit", "GPT-5.3-Codex-Spark"); !ok || remaining != 100 {
		t.Fatalf("expected 5h limit remaining_percent 100 for GPT-5.3-Codex-Spark, got %v (ok=%v)", remaining, ok)
	}
	if remaining, ok := findRemaining("weekly limit", "GPT-5.3-Codex-Spark"); !ok || remaining != 100 {
		t.Fatalf("expected weekly limit remaining_percent 100 for GPT-5.3-Codex-Spark, got %v (ok=%v)", remaining, ok)
	}
}

func TestExtractUsageFields_CodexPrefersActiveModelBucket(t *testing.T) {
	status := `OpenAI Codex (v0.101.0)
Model: gpt-5.3-codex (reasoning xhigh, summaries auto)
5h limit: [____________________] 93% left (resets 13:41)
Weekly limit: [____________________] 49% left (resets 13:18 on 16 Feb)
GPT-5.3-Codex-Spark limit:
5h limit: [____________________] 100% left (resets 18:13)
Weekly limit: [____________________] 100% left (resets 13:13 on 20 Feb)
`

	fields := extractUsageFields(nil, status)
	fiveHour, ok := fields["five_hour_utilization"].(float64)
	if !ok {
		t.Fatalf("expected five_hour_utilization float64, got %T", fields["five_hour_utilization"])
	}
	weekly, ok := fields["weekly_utilization"].(float64)
	if !ok {
		t.Fatalf("expected weekly_utilization float64, got %T", fields["weekly_utilization"])
	}

	if fiveHour != 7 {
		t.Fatalf("expected five_hour_utilization 7, got %v", fiveHour)
	}
	if weekly != 51 {
		t.Fatalf("expected weekly_utilization 51, got %v", weekly)
	}
}

func TestExtractUsageFields_CodexSparkOnly(t *testing.T) {
	status := `GPT-5.3-Codex-Spark limit:
5h limit: [____________________] 100% left (resets 18:13)
Weekly limit: [____________________] 100% left (resets 13:13 on 20 Feb)
`

	fields := extractUsageFields(nil, status)
	fiveHour, ok := fields["five_hour_utilization"].(float64)
	if !ok {
		t.Fatalf("expected five_hour_utilization float64, got %T", fields["five_hour_utilization"])
	}
	weekly, ok := fields["weekly_utilization"].(float64)
	if !ok {
		t.Fatalf("expected weekly_utilization float64, got %T", fields["weekly_utilization"])
	}

	if fiveHour != 0 {
		t.Fatalf("expected five_hour_utilization 0, got %v", fiveHour)
	}
	if weekly != 0 {
		t.Fatalf("expected weekly_utilization 0, got %v", weekly)
	}
}

func TestExtractUsageFields_CodexLegacySingleBucket(t *testing.T) {
	status := `5h limit: [____________________] 93% left (resets 13:41)
Weekly limit: [____________________] 49% left (resets 13:18 on 16 Feb)
`

	fields := extractUsageFields(nil, status)
	fiveHour, ok := fields["five_hour_utilization"].(float64)
	if !ok {
		t.Fatalf("expected five_hour_utilization float64, got %T", fields["five_hour_utilization"])
	}
	weekly, ok := fields["weekly_utilization"].(float64)
	if !ok {
		t.Fatalf("expected weekly_utilization float64, got %T", fields["weekly_utilization"])
	}

	if fiveHour != 7 {
		t.Fatalf("expected five_hour_utilization 7, got %v", fiveHour)
	}
	if weekly != 51 {
		t.Fatalf("expected weekly_utilization 51, got %v", weekly)
	}
}
