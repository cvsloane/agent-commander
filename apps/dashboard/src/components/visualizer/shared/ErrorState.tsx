'use client';

import { useVisualizerThemeStore } from '@/stores/visualizerTheme';

/**
 * Error state components for the visualizer themes.
 * Provides consistent error messaging with retry capabilities.
 */

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: string;
  variant?: 'connection' | 'session' | 'tool' | 'generic';
}

/**
 * Main error state component with theme-aware styling
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = 'Try Again',
  icon,
  variant = 'generic',
}: ErrorStateProps) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  const defaultIcons: Record<string, string> = {
    connection: theme === 'bridge-control' ? '📡' : '🔌',
    session: theme === 'bridge-control' ? '⚠️' : '🚫',
    tool: theme === 'bridge-control' ? '🔧' : '⚙️',
    generic: theme === 'bridge-control' ? '🚨' : '❌',
  };

  const defaultTitles: Record<string, string> = {
    connection: theme === 'bridge-control' ? 'CONNECTION LOST' : 'Connection Lost',
    session: theme === 'bridge-control' ? 'SESSION ERROR' : 'Session Error',
    tool: theme === 'bridge-control' ? 'TOOL FAILURE' : 'Tool Failed',
    generic: theme === 'bridge-control' ? 'ERROR DETECTED' : 'Error',
  };

  const displayIcon = icon || defaultIcons[variant];
  const displayTitle = title || defaultTitles[variant];

  return (
    <div
      className={`viz-error-state viz-error-state--${variant} viz-error-state--${theme}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="viz-error-icon" aria-hidden="true">
        {displayIcon}
      </div>
      <div className="viz-error-content">
        <h3 className="viz-error-title">{displayTitle}</h3>
        <p className="viz-error-message">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          className="viz-error-retry"
          onClick={onRetry}
          aria-label={retryLabel}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Connection lost banner - shown when WebSocket disconnects
 */
export function ConnectionLostBanner({
  onRetry,
  isReconnecting = false,
}: {
  onRetry?: () => void;
  isReconnecting?: boolean;
}) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  return (
    <div
      className={`viz-connection-banner viz-connection-banner--${theme}`}
      role="alert"
      aria-live="polite"
    >
      <div className="viz-connection-icon" aria-hidden="true">
        {isReconnecting ? '🔄' : '📡'}
      </div>
      <div className="viz-connection-content">
        <span className="viz-connection-status">
          {isReconnecting
            ? theme === 'bridge-control'
              ? 'RECONNECTING...'
              : 'Reconnecting...'
            : theme === 'bridge-control'
              ? 'CONNECTION LOST'
              : 'Connection lost'}
        </span>
      </div>
      {onRetry && !isReconnecting && (
        <button
          type="button"
          className="viz-connection-retry"
          onClick={onRetry}
          aria-label="Reconnect"
        >
          {theme === 'bridge-control' ? 'RECONNECT' : 'Reconnect'}
        </button>
      )}
      {isReconnecting && (
        <div className="viz-connection-spinner" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * Inline error for activity feed items
 */
export function InlineError({
  message,
  details,
  expanded = false,
  onToggle,
}: {
  message: string;
  details?: string;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  return (
    <div className={`viz-inline-error viz-inline-error--${theme}`} role="alert">
      <div className="viz-inline-error-header">
        <span className="viz-inline-error-icon" aria-hidden="true">
          {theme === 'bridge-control' ? '⚠️' : '❌'}
        </span>
        <span className="viz-inline-error-message">{message}</span>
        {details && onToggle && (
          <button
            type="button"
            className="viz-inline-error-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide details' : 'Show details'}
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>
      {details && expanded && (
        <div className="viz-inline-error-details">
          <code>{details}</code>
        </div>
      )}
    </div>
  );
}

/**
 * Session error card - shown in session list
 */
export function SessionErrorCard({
  sessionName,
  error,
  onRetry,
  onDismiss,
}: {
  sessionName: string;
  error: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  return (
    <div
      className={`viz-session-error viz-session-error--${theme}`}
      role="alert"
    >
      <div className="viz-session-error-header">
        <span className="viz-session-error-icon" aria-hidden="true">
          {theme === 'bridge-control' ? '🚨' : '⚠️'}
        </span>
        <span className="viz-session-error-name">{sessionName}</span>
        {onDismiss && (
          <button
            type="button"
            className="viz-session-error-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            ×
          </button>
        )}
      </div>
      <p className="viz-session-error-message">{error}</p>
      {onRetry && (
        <button
          type="button"
          className="viz-session-error-retry"
          onClick={onRetry}
        >
          {theme === 'bridge-control' ? 'RETRY' : 'Retry'}
        </button>
      )}
    </div>
  );
}
