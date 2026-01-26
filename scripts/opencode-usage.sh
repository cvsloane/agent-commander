#!/usr/bin/env bash
set -euo pipefail

debug="${OPENCODE_USAGE_DEBUG:-}"
api_key="${MINIMAX_API_KEY:-}"
if [[ -z "$api_key" ]]; then
  if [[ "$debug" == "1" ]]; then
    echo "MINIMAX_API_KEY is required" >&2
  fi
  exit 1
fi

base_url="${MINIMAX_API_BASE_URL:-https://www.minimax.io}"
endpoint="${base_url%/}/v1/api/openplatform/coding_plan/remains"

response=""
if ! response="$(curl -sS --show-error --fail --connect-timeout 5 --max-time 10 \
  -H "Authorization: Bearer $api_key" \
  -H "Content-Type: application/json" \
  "$endpoint" 2>/dev/null)"; then
  if [[ "$debug" == "1" ]]; then
    echo "Failed to fetch OpenCode usage from Minimax" >&2
  fi
  exit 1
fi

if [[ -z "$response" ]]; then
  if [[ "$debug" == "1" ]]; then
    echo "Empty response from Minimax usage endpoint" >&2
  fi
  exit 1
fi

limit_override="${OPENCODE_REQUEST_LIMIT:-}"
count_mode="${OPENCODE_USAGE_COUNT_MODE:-remaining}"

if command -v jq >/dev/null 2>&1; then
  jq -c --arg limit_override "$limit_override" --arg count_mode "$count_mode" '
    def to_number:
      if type == "number" then .
      elif type == "string" then (gsub(","; "") | tonumber?)
      else null end;
    def normalize_time:
      if type == "number" then
        (if . > 1000000000000 then . / 1000 else . end | todateiso8601)
      elif type == "string" then .
      else null end;
    def pick($keys):
      [.. | objects | . as $o | $keys[] as $k | ($o[$k]? // empty)]
      | map(select(. != null))
      | .[0];
    def pick_number($keys): (pick($keys) | to_number);
    def pick_time($keys): (pick($keys) | normalize_time);
    def compute_remaining_requests($root; $mode):
      ($root.model_remains // []) as $models
      | if ($models|type) == "array" then
          ($models
            | map({
                total: (.current_interval_total_count | to_number),
                usage: (.current_interval_usage_count | to_number),
                remaining: (
                  .current_interval_remaining_count // .remaining_requests // .remaining_count
                ) | to_number
              })
            | map(select(.total != null and (.usage != null or .remaining != null)))
            | map(
                if .remaining != null then .remaining
                elif $mode == "used" then (.total - .usage)
                elif $mode == "remaining" then .usage
                else
                  (if .usage != null and .usage > (.total / 2) then .usage else (.total - .usage) end)
                end
              )
            | if length > 0 then .[0] else null end)
        else null end;
    def compute_reset_at($root):
      ($root.model_remains // []) as $models
      | if ($models|type) == "array" then
          ($models
            | map(.end_time | to_number)
            | map(select(. != null))
            | if length > 0 then (min | normalize_time) else null end)
        else null end;
    (if type == "object" then . else { data: . } end) as $root
    | $root + {
        remaining_tokens: ($root | pick_number([
          "remaining_tokens", "tokens_remaining", "token_remaining", "remaining_token", "remain_tokens",
          "remaining_token_count", "tokens_left", "left_tokens", "left_token"
        ])),
        remaining_requests: (($root | pick_number([
          "remaining_requests", "requests_remaining", "remaining_requests_count",
          "remaining_count", "remain_count", "remaining", "remain", "remaining_times", "remain_times",
          "quota_remaining", "quota_left", "requests_left", "left", "balance"
        ])) // (compute_remaining_requests($root; $count_mode))),
        reset_at: (($root | pick_time([
          "reset_at", "resets_at", "reset_time", "resetAt",
          "expires_at", "expire_at", "expire_time", "expiration", "quota_reset_at"
        ])) // (compute_reset_at($root)))
      }
    | (if ($limit_override | length) > 0 then
        . + { request_limit: ($limit_override | tonumber?) }
       else
        .
       end)
    | with_entries(select(.value != null))
  ' <<<"$response"
else
  echo "$response"
fi
