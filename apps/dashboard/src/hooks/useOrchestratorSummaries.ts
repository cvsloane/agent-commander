'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { generateSummary, getSummaryStatus } from '@/lib/summaryApi';
import { useOrchestratorStore, type OrchestratorItem } from '@/stores/orchestrator';

const MAX_CONCURRENT_SUMMARIES = 3;
const SUMMARY_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

const inFlightSummaries = new Set<string>();
const failedSummaries = new Map<string, number>();

/**
 * Build context string for an orchestrator item
 * For snapshots, use the action context (terminal output)
 * For approvals, build context from the approval payload
 */
function buildContextForItem(item: OrchestratorItem): string {
  // If we have terminal context from action, use it
  if (item.action?.context) {
    return item.action.context;
  }

  // For approval items, build context from the approval payload
  if (item.source === 'approval' && item.approval?.requested_payload) {
    const payload = item.approval.requested_payload as Record<string, unknown>;
    const details = (payload.details || {}) as Record<string, unknown>;

    const parts: string[] = [];

    // Add tool info
    const tool = payload.tool || payload.tool_name || details.tool || details.tool_name;
    if (tool) parts.push(`Tool: ${tool}`);

    // Add command info
    const command = details.bash_command || payload.bash_command || payload.command || details.command;
    if (command) parts.push(`Command: ${command}`);

    // Add path info
    const path = payload.path || payload.file || details.path || details.file;
    if (path) parts.push(`Path: ${path}`);

    // Add description
    const description = payload.description || details.description;
    if (description) parts.push(`Description: ${description}`);

    // Add args if present
    const args = payload.args || details.args;
    if (args && typeof args === 'object') {
      parts.push(`Args: ${JSON.stringify(args)}`);
    }

    // Add reason
    const reason = payload.reason || details.reason;
    if (reason) parts.push(`Reason: ${reason}`);

    return parts.join('\n') || 'Approval requested';
  }

  return '';
}

export function useOrchestratorSummaries(
  items: OrchestratorItem[],
  enabled: boolean
) {
  const { setSummary, setSummaryLoading, setSummaryFailed } = useOrchestratorStore();

  const { data: summaryStatus, isLoading: summaryStatusLoading } = useQuery({
    queryKey: ['orchestrator', 'summary-status'],
    queryFn: getSummaryStatus,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const summariesEnabled = summaryStatus?.available ?? false;

  useEffect(() => {
    if (!enabled || !summariesEnabled) return;

    const now = Date.now();

    // Generate summaries for all items that have action and some context
    const needsSummary = items.filter((item) => {
      if (!item.action) return false;
      if (item.summary || item.summaryLoading) return false;
      if (inFlightSummaries.has(item.id)) return false;

      // Check cooldown for failed items
      if (failedSummaries.has(item.id)) {
        if (now - (failedSummaries.get(item.id) ?? 0) <= SUMMARY_RETRY_COOLDOWN_MS) {
          return false;
        }
      }

      // Must have some context to generate summary
      const context = buildContextForItem(item);
      return context.length > 0;
    });

    const availableSlots = MAX_CONCURRENT_SUMMARIES - inFlightSummaries.size;
    if (availableSlots <= 0) return;

    const toGenerate = needsSummary.slice(0, availableSlots);

    for (const item of toGenerate) {
      inFlightSummaries.add(item.id);
      setSummaryLoading(item.id, true);

      const context = buildContextForItem(item);

      generateSummary({
        session_id: item.sessionId,
        capture_hash: item.captureHash || item.id,
        action_type: item.action?.type || 'unknown',
        context,
        question: item.action?.question || '',
      })
        .then((response) => {
          setSummary(item.id, response.summary);
          failedSummaries.delete(item.id);
        })
        .catch((err) => {
          console.error('Failed to generate summary:', err);
          setSummaryFailed(item.id, true);
          failedSummaries.set(item.id, Date.now());
        })
        .finally(() => {
          inFlightSummaries.delete(item.id);
        });
    }
  }, [enabled, summariesEnabled, items, setSummary, setSummaryLoading, setSummaryFailed]);

  return { summariesEnabled, summaryStatusLoading };
}
