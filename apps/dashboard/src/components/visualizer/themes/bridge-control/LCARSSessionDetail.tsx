'use client';

import { useEffect, useState } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { SessionUsage } from '@/stores/usage';

interface LCARSSessionDetailProps {
  session: SessionWithSnapshot | null;
  usage?: SessionUsage;
  toolsUsed: number;
  filesModified: number;
}

export function LCARSSessionDetail({
  session,
  usage,
  toolsUsed,
  filesModified,
}: LCARSSessionDetailProps) {
  const [animatedTokens, setAnimatedTokens] = useState(0);

  // Animate token count changes
  useEffect(() => {
    const target = usage?.total_tokens ?? 0;
    if (target === animatedTokens) return;

    const step = Math.ceil(Math.abs(target - animatedTokens) / 20);
    const timer = setInterval(() => {
      setAnimatedTokens((prev) => {
        if (prev < target) return Math.min(prev + step, target);
        if (prev > target) return Math.max(prev - step, target);
        return prev;
      });
    }, 50);

    return () => clearInterval(timer);
  }, [usage?.total_tokens, animatedTokens]);

  if (!session) {
    return (
      <div className="lcars-session-detail">
        <div className="lcars-detail-header">SESSION DETAIL</div>
        <div className="lcars-detail-empty">
          SELECT A SESSION TO VIEW TELEMETRY
        </div>
      </div>
    );
  }

  const statusClass = getStatusClass(session.status);
  const gitStatus = session.metadata?.git_status;

  return (
    <div className="lcars-session-detail">
      <div className="lcars-detail-header">
        <span className={`lcars-status-light ${statusClass}`} />
        <span>{session.title || session.cwd?.split('/').pop() || 'SESSION'}</span>
      </div>

      <div className="lcars-detail-body">
        {/* Status indicator */}
        <div className="lcars-detail-status">
          <div className={`lcars-status-badge lcars-status-badge--${statusClass}`}>
            {formatStatus(session.status)}
          </div>
        </div>

        {/* Metrics grid */}
        <div className="lcars-metrics-grid">
          <div className="lcars-metric">
            <div className="lcars-metric-label">TOKENS</div>
            <div className="lcars-metric-value lcars-data-readout animated">
              {formatNumber(animatedTokens)}
            </div>
          </div>
          <div className="lcars-metric">
            <div className="lcars-metric-label">TOOLS</div>
            <div className="lcars-metric-value">{toolsUsed}</div>
          </div>
          <div className="lcars-metric">
            <div className="lcars-metric-label">FILES</div>
            <div className="lcars-metric-value">{filesModified}</div>
          </div>
          {usage?.estimated_cost_cents != null && (
            <div className="lcars-metric">
              <div className="lcars-metric-label">COST</div>
              <div className="lcars-metric-value">{formatCost(usage.estimated_cost_cents)}</div>
            </div>
          )}
        </div>

        {/* Git status */}
        {gitStatus?.branch && (
          <div className="lcars-git-status">
            <div className="lcars-git-header">GIT STATUS</div>
            <div className="lcars-git-branch">
              <span className="lcars-git-icon">⎇</span>
              <span>{gitStatus.branch}</span>
              {gitStatus.ahead ? <span className="lcars-git-ahead">↑{gitStatus.ahead}</span> : null}
              {gitStatus.behind ? <span className="lcars-git-behind">↓{gitStatus.behind}</span> : null}
            </div>
            <div className="lcars-git-changes">
              {gitStatus.staged ? <span className="lcars-git-staged">+{gitStatus.staged}</span> : null}
              {gitStatus.unstaged ? <span className="lcars-git-unstaged">~{gitStatus.unstaged}</span> : null}
              {gitStatus.untracked ? <span className="lcars-git-untracked">?{gitStatus.untracked}</span> : null}
              {!gitStatus.staged && !gitStatus.unstaged && !gitStatus.untracked && (
                <span className="lcars-git-clean">CLEAN</span>
              )}
            </div>
          </div>
        )}

        {/* Directory */}
        <div className="lcars-detail-row">
          <span className="lcars-detail-label">DIRECTORY</span>
          <span className="lcars-detail-value lcars-mono">{session.cwd || '~'}</span>
        </div>

        {/* Provider */}
        <div className="lcars-detail-row">
          <span className="lcars-detail-label">PROVIDER</span>
          <span className="lcars-detail-value">{session.provider?.toUpperCase() || 'UNKNOWN'}</span>
        </div>
      </div>
    </div>
  );
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'RUNNING':
    case 'STARTING':
      return 'working';
    case 'WAITING_FOR_INPUT':
    case 'WAITING_FOR_APPROVAL':
      return 'waiting';
    case 'ERROR':
      return 'error';
    default:
      return 'idle';
  }
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(cents: number): string {
  if (cents === 0) return '$0';
  const dollars = cents / 100;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  return `${cents}¢`;
}
