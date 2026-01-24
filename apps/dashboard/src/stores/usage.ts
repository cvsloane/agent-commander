import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionUsageSummary } from '@agent-command/schema';

export type PlanType = 'free' | 'pro' | 'max' | 'unlimited';

// Session-level usage tracking
export interface SessionUsage {
  session_id: string;
  provider: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  estimated_cost_cents?: number;
  session_utilization_percent?: number;
  session_left_percent?: number;
  session_reset_text?: string;
  weekly_utilization_percent?: number;
  weekly_left_percent?: number;
  weekly_reset_text?: string;
  weekly_sonnet_utilization_percent?: number;
  weekly_sonnet_reset_text?: string;
  weekly_opus_utilization_percent?: number;
  weekly_opus_reset_text?: string;
  context_used_tokens?: number;
  context_total_tokens?: number;
  context_left_percent?: number;
  five_hour_left_percent?: number;
  five_hour_reset_text?: string;
  raw_usage_line?: string;
  reported_at: string;
}

export interface PlanConfig {
  weeklyTokens: number;
  description: string;
}

export const PLAN_LIMITS: Record<PlanType, PlanConfig> = {
  free: { weeklyTokens: 100_000, description: 'Free tier' },
  pro: { weeklyTokens: 1_000_000, description: 'Pro plan' },
  max: { weeklyTokens: 5_000_000, description: 'Max plan' },
  unlimited: { weeklyTokens: Infinity, description: 'API/Enterprise' },
};

interface UsageStore {
  plan: PlanType;
  setPlan: (plan: PlanType) => void;
  getPlanLimit: () => number;
  getUsagePercentage: (currentTokens: number) => number;

  // Session-level usage
  sessionUsage: Record<string, SessionUsage>;
  updateSessionUsage: (usage: SessionUsage) => void;
  getSessionUsage: (sessionId: string) => SessionUsage | null;
  removeSessionUsage: (sessionId: string) => void;
}

export const useUsageStore = create<UsageStore>()(
  persist(
    (set, get) => ({
      plan: 'pro',

      setPlan: (plan) => set({ plan }),

      getPlanLimit: () => {
        const { plan } = get();
        return PLAN_LIMITS[plan].weeklyTokens;
      },

      getUsagePercentage: (currentTokens: number) => {
        const limit = get().getPlanLimit();
        if (limit === Infinity) return 0;
        return Math.min(100, (currentTokens / limit) * 100);
      },

      // Session-level usage tracking (not persisted)
      sessionUsage: {},

      updateSessionUsage: (usage) =>
        set((state) => ({
          sessionUsage: {
            ...state.sessionUsage,
            [usage.session_id]: usage,
          },
        })),

      getSessionUsage: (sessionId) => {
        return get().sessionUsage[sessionId] || null;
      },

      removeSessionUsage: (sessionId) =>
        set((state) => {
          const { [sessionId]: _, ...rest } = state.sessionUsage;
          return { sessionUsage: rest };
        }),
    }),
    {
      name: 'usage-storage',
      // Only persist plan, not session usage (that's runtime data)
      partialize: (state) => ({ plan: state.plan }),
    }
  )
);

// Helper to format token counts
export function formatTokens(tokens?: number | null): string {
  if (tokens == null || !Number.isFinite(tokens)) {
    return '—';
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}K`;
  }
  return tokens.toString();
}

// Helper to format cost
export function formatCost(cents?: number | null): string {
  if (cents == null || !Number.isFinite(cents)) {
    return '—';
  }
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

// Helper to get the next Monday (week reset)
export function getNextMonday(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday;
}
