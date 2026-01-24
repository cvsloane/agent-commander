'use client';

import { useEffect, useState } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { SessionUsage } from '@/stores/usage';

interface LCARSMetricsBarProps {
  sessions: SessionWithSnapshot[];
  usage?: Map<string, SessionUsage>;
  toolsUsed: number;
}

export function LCARSMetricsBar({ sessions, usage, toolsUsed }: LCARSMetricsBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Calculate aggregate stats
  const activeSessions = sessions.filter(
    (s) => s.status === 'RUNNING' || s.status === 'STARTING'
  ).length;

  const waitingSessions = sessions.filter(
    (s) => s.status === 'WAITING_FOR_INPUT' || s.status === 'WAITING_FOR_APPROVAL'
  ).length;

  const totalTokens = usage
    ? Array.from(usage.values()).reduce((sum, u) => sum + (u.total_tokens ?? 0), 0)
    : 0;

  const systemStatus = getSystemStatus(sessions);
  const activePulse = usePulse(activeSessions);
  const waitingPulse = usePulse(waitingSessions);
  const totalPulse = usePulse(sessions.length);
  const tokenPulse = usePulse(totalTokens);
  const toolPulse = usePulse(toolsUsed);

  return (
    <div className="lcars-metrics-bar">
      <div className="lcars-metrics-section">
        <div className="lcars-metric-block">
          <span className={`lcars-status-light ${systemStatus.class}`} />
          <span className="lcars-metric-text">{systemStatus.label}</span>
        </div>
      </div>

      <div className="lcars-metrics-section">
        <div className="lcars-metric-block orange">
          <span className={`lcars-metric-number ${activePulse ? 'lcars-updating' : ''}`}>
            {activeSessions}
          </span>
          <span className="lcars-metric-label">ACTIVE</span>
        </div>
        <div className="lcars-metric-block purple">
          <span className={`lcars-metric-number ${waitingPulse ? 'lcars-updating' : ''}`}>
            {waitingSessions}
          </span>
          <span className="lcars-metric-label">WAITING</span>
        </div>
        <div className="lcars-metric-block blue">
          <span className={`lcars-metric-number ${totalPulse ? 'lcars-updating' : ''}`}>
            {sessions.length}
          </span>
          <span className="lcars-metric-label">TOTAL</span>
        </div>
      </div>

      <div className="lcars-metrics-section">
        <div className="lcars-metric-block">
          <span className={`lcars-metric-number lcars-data-readout ${tokenPulse ? 'lcars-updating' : ''}`}>
            {formatNumber(totalTokens)}
          </span>
          <span className="lcars-metric-label">TOKENS</span>
        </div>
        <div className="lcars-metric-block">
          <span className={`lcars-metric-number ${toolPulse ? 'lcars-updating' : ''}`}>
            {toolsUsed}
          </span>
          <span className="lcars-metric-label">TOOLS</span>
        </div>
      </div>

      <div className="lcars-metrics-section lcars-time-display">
        <div className="lcars-time-value">
          {currentTime.toLocaleTimeString('en-US', { hour12: false })}
        </div>
        <div className="lcars-stardate">
          STARDATE {formatStardate(currentTime)}
        </div>
      </div>
    </div>
  );
}

function getSystemStatus(sessions: SessionWithSnapshot[]): { label: string; class: string } {
  const hasError = sessions.some((s) => s.status === 'ERROR');
  const hasWaiting = sessions.some(
    (s) => s.status === 'WAITING_FOR_INPUT' || s.status === 'WAITING_FOR_APPROVAL'
  );
  const hasActive = sessions.some((s) => s.status === 'RUNNING' || s.status === 'STARTING');

  if (hasError) return { label: 'ALERT: ERROR DETECTED', class: 'error' };
  if (hasWaiting) return { label: 'AWAITING INPUT', class: 'waiting' };
  if (hasActive) return { label: 'OPERATIONS IN PROGRESS', class: 'working' };
  return { label: 'ALL SYSTEMS NOMINAL', class: 'idle' };
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function formatStardate(date: Date): string {
  const year = date.getFullYear();
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(year, 0, 0).getTime()) / 86400000
  );
  return `${year - 1000}.${dayOfYear.toString().padStart(3, '0')}`;
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
