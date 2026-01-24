'use client';

import type { SessionWithSnapshot, SessionUsageSummary } from '@agent-command/schema';

export interface OrbitInfoStats {
  toolsUsed: number;
  filesTouched: string[];
  activeSubagents: number;
  currentTool?: string | null;
}

interface OrbitInfoModalProps {
  open: boolean;
  session: SessionWithSnapshot | null;
  stats?: OrbitInfoStats;
  usage?: SessionUsageSummary;
  onClose: () => void;
}

export function OrbitInfoModal({ open, session, stats, usage, onClose }: OrbitInfoModalProps) {
  if (!open || !session) return null;

  const title = session.title || session.cwd?.split('/').pop() || 'Orbit';
  const statusLabel = session.status.toLowerCase().replace(/_/g, ' ');

  return (
    <div id="orbit-info-modal" className="modal-overlay visible" onClick={onClose}>
      <div className="modal-content orbit-info-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <span className="orbit-status-badge">{statusLabel}</span>
        </div>

        <div className="orbit-info-body">
          <div className="orbit-info-section">
            <h4>Details</h4>
            <div className="orbit-info-grid">
              <div className="orbit-info-label">Working Directory</div>
              <div className="orbit-info-value mono">{session.cwd || 'N/A'}</div>

              {session.git_branch && (
                <>
                  <div className="orbit-info-label">Git Branch</div>
                  <div className="orbit-info-value mono">{session.git_branch}</div>
                </>
              )}

              <div className="orbit-info-label">Provider</div>
              <div className="orbit-info-value">{session.provider || 'N/A'}</div>

              <div className="orbit-info-label">Host</div>
              <div className="orbit-info-value mono">{session.host_id?.slice(0, 8) || 'N/A'}</div>
            </div>
          </div>

          <div className="orbit-info-section">
            <h4>Activity</h4>
            <div className="orbit-info-grid">
              <div className="orbit-info-label">Tools Used</div>
              <div className="orbit-info-value">{stats?.toolsUsed ?? 0}</div>

              <div className="orbit-info-label">Files Touched</div>
              <div className="orbit-info-value">{stats?.filesTouched?.length ?? 0}</div>

              <div className="orbit-info-label">Active Subagents</div>
              <div className="orbit-info-value">{stats?.activeSubagents ?? 0}</div>

              {stats?.currentTool && (
                <>
                  <div className="orbit-info-label">Current Tool</div>
                  <div className="orbit-info-value highlight">{stats.currentTool}</div>
                </>
              )}
            </div>
          </div>

          {usage && (
            <div className="orbit-info-section">
              <h4>Usage</h4>
              <div className="orbit-info-grid">
                <div className="orbit-info-label">Input Tokens</div>
                <div className="orbit-info-value">{usage.input_tokens?.toLocaleString() ?? 0}</div>

                <div className="orbit-info-label">Output Tokens</div>
                <div className="orbit-info-value">{usage.output_tokens?.toLocaleString() ?? 0}</div>

                <div className="orbit-info-label">Total Tokens</div>
                <div className="orbit-info-value highlight">{usage.total_tokens?.toLocaleString() ?? 0}</div>
              </div>
            </div>
          )}

          {stats?.filesTouched && stats.filesTouched.length > 0 && (
            <div className="orbit-info-section files-section">
              <h4>Recent Files</h4>
              <div className="orbit-files-list">
                {stats.filesTouched.slice(-8).map((file, idx) => (
                  <div key={`${file}-${idx}`} className="orbit-file-item mono">
                    {file.split('/').pop()}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(10, 11, 16, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: var(--viz-z-modal, 100);
          backdrop-filter: blur(4px);
        }

        .modal-overlay:not(.visible) {
          display: none;
        }

        .orbit-info-content {
          background: var(--bs-surface, #24273A);
          border: 1px solid rgba(245, 166, 35, 0.3);
          border-radius: 12px;
          min-width: 400px;
          max-width: 500px;
          max-height: 80vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(245, 166, 35, 0.2);
        }

        .modal-header h3 {
          margin: 0;
          color: var(--bs-primary, #F5A623);
          font-size: 18px;
          font-weight: 600;
        }

        .orbit-status-badge {
          background: rgba(45, 212, 191, 0.2);
          color: var(--bs-secondary, #2DD4BF);
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
          text-transform: capitalize;
        }

        .orbit-info-body {
          padding: 16px 20px;
        }

        .orbit-info-section {
          margin-bottom: 20px;
        }

        .orbit-info-section:last-child {
          margin-bottom: 0;
        }

        .orbit-info-section h4 {
          margin: 0 0 12px;
          color: var(--bs-text-dim, #6E738D);
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .orbit-info-grid {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 8px 16px;
        }

        .orbit-info-label {
          color: var(--bs-text-dim, #6E738D);
          font-size: 13px;
        }

        .orbit-info-value {
          color: var(--bs-text, #CAD3F5);
          font-size: 13px;
        }

        .orbit-info-value.mono {
          font-family: var(--viz-font-mono, monospace);
          font-size: 12px;
        }

        .orbit-info-value.highlight {
          color: var(--bs-primary, #F5A623);
          font-weight: 500;
        }

        .orbit-files-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .orbit-file-item {
          background: rgba(245, 166, 35, 0.1);
          color: var(--bs-text, #CAD3F5);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          padding: 12px 20px;
          border-top: 1px solid rgba(245, 166, 35, 0.15);
        }

        .modal-btn-cancel {
          background: transparent;
          border: 1px solid rgba(245, 166, 35, 0.3);
          color: var(--bs-text, #CAD3F5);
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }

        .modal-btn-cancel:hover {
          background: rgba(245, 166, 35, 0.1);
          border-color: var(--bs-primary, #F5A623);
        }
      `}</style>
    </div>
  );
}
