'use client';

import { useVisualizerThemeStore } from '@/stores/visualizerTheme';

/**
 * Empty state components for the visualizer themes.
 * Provides friendly illustrations and call-to-action buttons for empty states.
 */

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'sessions' | 'activity' | 'territories' | 'generic';
}

/**
 * Main empty state component with theme-aware styling
 */
export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  variant = 'generic',
}: EmptyStateProps) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  const defaultIcons: Record<string, Record<string, string>> = {
    sessions: {
      'bridge-control': '🖖',
      civilization: '🏛️',
      botspace: '🛸',
    },
    activity: {
      'bridge-control': '📡',
      civilization: '📜',
      botspace: '📡',
    },
    territories: {
      'bridge-control': '🌌',
      civilization: '🗺️',
      botspace: '🌌',
    },
    generic: {
      'bridge-control': '⭐',
      civilization: '🏰',
      botspace: '🤖',
    },
  };

  const displayIcon = icon || defaultIcons[variant]?.[theme] || defaultIcons.generic[theme];

  return (
    <div
      className={`viz-empty-state viz-empty-state--${variant} viz-empty-state--${theme}`}
      role="status"
    >
      <div className="viz-empty-icon" aria-hidden="true">
        {displayIcon}
      </div>
      <div className="viz-empty-content">
        <h3 className="viz-empty-title">{title}</h3>
        {description && <p className="viz-empty-description">{description}</p>}
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          className="viz-empty-action"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * No sessions empty state
 */
export function NoSessionsState({ onStartSession }: { onStartSession?: () => void }) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  const content = {
    'bridge-control': {
      title: 'NO ACTIVE SESSIONS',
      description: 'The bridge is quiet. Start a new session to begin operations.',
      action: 'START A SESSION',
    },
    civilization: {
      title: 'No Territories Claimed',
      description: 'The map awaits exploration. Start a session to claim your first territory.',
      action: 'Claim Your First Territory',
    },
    botspace: {
      title: 'No Orbits Active',
      description: 'The station is ready. Start a session to begin operations.',
      action: 'Launch Session',
    },
  };

  const c = content[theme] || content.botspace;

  return (
    <EmptyState
      variant="sessions"
      title={c.title}
      description={c.description}
      actionLabel={onStartSession ? c.action : undefined}
      onAction={onStartSession}
    />
  );
}

/**
 * No activity empty state
 */
export function NoActivityState() {
  const theme = useVisualizerThemeStore((state) => state.theme);

  const content = {
    'bridge-control': {
      title: 'AWAITING ACTIVITY',
      description: 'Ship systems are standing by. Activity will appear here as sessions work.',
    },
    civilization: {
      title: 'No Recent Activity',
      description: 'Your advisors await your command. Activity will appear here as you work.',
    },
    botspace: {
      title: 'No Activity Yet',
      description: 'Start working in a session to see activity here.',
    },
  };

  const c = content[theme] || content.botspace;

  return (
    <EmptyState
      variant="activity"
      title={c.title}
      description={c.description}
    />
  );
}

/**
 * No territories empty state (Civilization theme specific)
 */
export function NoTerritoriesState({ onClaimTerritory }: { onClaimTerritory?: () => void }) {
  return (
    <EmptyState
      variant="territories"
      title="No Territories Claimed"
      description="The frontier is vast and unexplored. Start a session to establish your presence."
      actionLabel={onClaimTerritory ? 'Claim Your First Territory' : undefined}
      onAction={onClaimTerritory}
    />
  );
}

/**
 * Search results empty state
 */
export function NoResultsState({ query }: { query?: string }) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  const title = theme === 'bridge-control' ? 'NO MATCHES FOUND' : 'No Results Found';
  const description = query
    ? `No results found for "${query}". Try a different search term.`
    : 'Try adjusting your search or filters.';

  return (
    <EmptyState
      variant="generic"
      title={title}
      description={description}
      icon="🔍"
    />
  );
}

/**
 * Inline empty state for smaller containers
 */
export function InlineEmptyState({
  message,
  icon,
}: {
  message: string;
  icon?: string;
}) {
  const theme = useVisualizerThemeStore((state) => state.theme);

  return (
    <div className={`viz-inline-empty viz-inline-empty--${theme}`} role="status">
      {icon && <span className="viz-inline-empty-icon" aria-hidden="true">{icon}</span>}
      <span className="viz-inline-empty-message">{message}</span>
    </div>
  );
}
