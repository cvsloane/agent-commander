'use client';

import { useEffect, useState } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { SessionUsage } from '@/stores/usage';

interface CivTopBarProps {
  sessions: SessionWithSnapshot[];
  usage?: Map<string, SessionUsage>;
  toolsUsed: number;
}

export function CivTopBar({ sessions, usage, toolsUsed }: CivTopBarProps) {
  // Calculate aggregate stats
  const activeSessions = sessions.filter(
    (s) => s.status === 'RUNNING' || s.status === 'STARTING'
  ).length;

  const totalTokens = usage
    ? Array.from(usage.values()).reduce((sum, u) => sum + (u.total_tokens ?? 0), 0)
    : 0;

  const totalCost = usage
    ? Array.from(usage.values()).reduce((sum, u) => sum + (u.estimated_cost_cents ?? 0), 0)
    : 0;

  const tokensPulse = usePulse(totalTokens);
  const costPulse = usePulse(totalCost);
  const toolsPulse = usePulse(toolsUsed);
  const sessionsPulse = usePulse(activeSessions);

  return (
    <div className="civ-top-bar">
      <div className="civ-resource-counter civ-resource-science">
        <span className="civ-resource-icon">🔬</span>
        <div>
          <span className={`civ-resource-value ${tokensPulse ? 'civ-updating' : ''}`}>
            {formatNumber(totalTokens)}
          </span>
          <span className="civ-resource-label">Tokens</span>
        </div>
      </div>

      <div className="civ-resource-counter civ-resource-gold">
        <span className="civ-resource-icon">💰</span>
        <div>
          <span className={`civ-resource-value ${costPulse ? 'civ-updating' : ''}`}>
            {formatCost(totalCost)}
          </span>
          <span className="civ-resource-label">Cost</span>
        </div>
      </div>

      <div className="civ-resource-counter civ-resource-production">
        <span className="civ-resource-icon">⚙️</span>
        <div>
          <span className={`civ-resource-value ${toolsPulse ? 'civ-updating' : ''}`}>
            {toolsUsed}
          </span>
          <span className="civ-resource-label">Tools</span>
        </div>
      </div>

      <div className="civ-resource-counter civ-resource-culture">
        <span className="civ-resource-icon">🏛️</span>
        <div>
          <span className={`civ-resource-value ${sessionsPulse ? 'civ-updating' : ''}`}>
            {activeSessions}/{sessions.length}
          </span>
          <span className="civ-resource-label">Sessions</span>
        </div>
      </div>
    </div>
  );
}

function usePulse(value: number) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 300);
    return () => clearTimeout(timer);
  }, [value]);

  return pulse;
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
