package protocol

type ProviderUsagePayload struct {
	Provider                 string         `json:"provider"`
	HostID                   string         `json:"host_id,omitempty"`
	SessionID                string         `json:"session_id,omitempty"`
	Scope                    string         `json:"scope"`
	ReportedAt               string         `json:"reported_at,omitempty"`
	RawText                  string         `json:"raw_text,omitempty"`
	RawJSON                  map[string]any `json:"raw_json,omitempty"`
	RemainingTokens          *float64       `json:"remaining_tokens,omitempty"`
	RemainingRequests        *float64       `json:"remaining_requests,omitempty"`
	WeeklyLimitTokens        *float64       `json:"weekly_limit_tokens,omitempty"`
	WeeklyRemainingTokens    *float64       `json:"weekly_remaining_tokens,omitempty"`
	WeeklyRemainingCostCents *float64       `json:"weekly_remaining_cost_cents,omitempty"`
	ResetAt                  string         `json:"reset_at,omitempty"`
	FiveHourUtilization      *float64       `json:"five_hour_utilization,omitempty"`
	FiveHourResetAt          string         `json:"five_hour_reset_at,omitempty"`
	WeeklyUtilization        *float64       `json:"weekly_utilization,omitempty"`
	WeeklyResetAt            string         `json:"weekly_reset_at,omitempty"`
	WeeklyOpusUtilization    *float64       `json:"weekly_opus_utilization,omitempty"`
	WeeklyOpusResetAt        string         `json:"weekly_opus_reset_at,omitempty"`
	WeeklySonnetUtilization  *float64       `json:"weekly_sonnet_utilization,omitempty"`
	WeeklySonnetResetAt      string         `json:"weekly_sonnet_reset_at,omitempty"`
	DailyUtilization         *float64       `json:"daily_utilization,omitempty"`
	DailyResetAt             string         `json:"daily_reset_at,omitempty"`
}

type SessionUsagePayload struct {
	SessionID                      string   `json:"session_id"`
	Provider                       string   `json:"provider"`
	InputTokens                    *int     `json:"input_tokens,omitempty"`
	OutputTokens                   *int     `json:"output_tokens,omitempty"`
	TotalTokens                    *int     `json:"total_tokens,omitempty"`
	CacheReadTokens                *int     `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens               *int     `json:"cache_write_tokens,omitempty"`
	EstimatedCostCents             *int     `json:"estimated_cost_cents,omitempty"`
	SessionUtilizationPercent      *float64 `json:"session_utilization_percent,omitempty"`
	SessionLeftPercent             *float64 `json:"session_left_percent,omitempty"`
	SessionResetText               *string  `json:"session_reset_text,omitempty"`
	WeeklyUtilizationPercent       *float64 `json:"weekly_utilization_percent,omitempty"`
	WeeklyLeftPercent              *float64 `json:"weekly_left_percent,omitempty"`
	WeeklyResetText                *string  `json:"weekly_reset_text,omitempty"`
	WeeklySonnetUtilizationPercent *float64 `json:"weekly_sonnet_utilization_percent,omitempty"`
	WeeklySonnetResetText          *string  `json:"weekly_sonnet_reset_text,omitempty"`
	WeeklyOpusUtilizationPercent   *float64 `json:"weekly_opus_utilization_percent,omitempty"`
	WeeklyOpusResetText            *string  `json:"weekly_opus_reset_text,omitempty"`
	ContextUsedTokens              *int     `json:"context_used_tokens,omitempty"`
	ContextTotalTokens             *int     `json:"context_total_tokens,omitempty"`
	ContextLeftPercent             *float64 `json:"context_left_percent,omitempty"`
	FiveHourLeftPercent            *float64 `json:"five_hour_left_percent,omitempty"`
	FiveHourResetText              *string  `json:"five_hour_reset_text,omitempty"`
	DailyUtilizationPercent        *float64 `json:"daily_utilization_percent,omitempty"`
	DailyLeftPercent               *float64 `json:"daily_left_percent,omitempty"`
	DailyResetHours                *int     `json:"daily_reset_hours,omitempty"`
	ReportedAt                     string   `json:"reported_at"`
	RawUsageLine                   string   `json:"raw_usage_line,omitempty"`
}
