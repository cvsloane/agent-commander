import {
  AlertTriangle,
  CircleOff,
  GitBranch,
  MessageCircleQuestion,
  PauseCircle,
  ShieldAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { Session } from '@agent-command/schema';
import { Badge } from '@/components/ui/badge';
import { isTmuxSessionDirty } from '@/lib/tmuxRoster';
import { cn } from '@/lib/utils';

export type SessionHealthKind =
  | 'waiting-input'
  | 'waiting-approval'
  | 'error'
  | 'idle'
  | 'dirty-git'
  | 'host-offline'
  | 'unmanaged';

export interface SessionHealthBadgeModel {
  kind: SessionHealthKind;
  label: string;
  title: string;
}

export function deriveSessionHealthBadges(
  session: Session,
  context: { hostOnline?: boolean } = {}
): SessionHealthBadgeModel[] {
  const badges: SessionHealthBadgeModel[] = [];
  if (session.status === 'WAITING_FOR_INPUT') {
    badges.push({ kind: 'waiting-input', label: 'Input', title: 'Waiting for input' });
  } else if (session.status === 'WAITING_FOR_APPROVAL') {
    badges.push({ kind: 'waiting-approval', label: 'Approval', title: 'Waiting for approval' });
  } else if (session.status === 'ERROR') {
    badges.push({ kind: 'error', label: 'Error', title: 'Session error' });
  } else if (session.status === 'IDLE' || Boolean(session.idled_at)) {
    badges.push({ kind: 'idle', label: 'Idle', title: 'Session is idle' });
  }

  if (isTmuxSessionDirty(session)) {
    badges.push({ kind: 'dirty-git', label: 'Dirty', title: 'Git working tree has changes' });
  }
  if (context.hostOnline === false) {
    badges.push({ kind: 'host-offline', label: 'Offline', title: 'Host is offline' });
  }
  if (session.metadata?.unmanaged) {
    badges.push({ kind: 'unmanaged', label: 'Unmanaged', title: 'Pane is not managed by Agent Command' });
  }
  return badges;
}

const BADGE_ICONS: Record<SessionHealthKind, LucideIcon> = {
  'waiting-input': MessageCircleQuestion,
  'waiting-approval': ShieldAlert,
  error: AlertTriangle,
  idle: PauseCircle,
  'dirty-git': GitBranch,
  'host-offline': WifiOff,
  unmanaged: CircleOff,
};

const BADGE_VARIANTS = {
  'waiting-input': 'waiting',
  'waiting-approval': 'approval',
  error: 'error',
  idle: 'idle',
  'dirty-git': 'outline',
  'host-offline': 'outline',
  unmanaged: 'outline',
} as const;

interface SessionHealthBadgesProps {
  session: Session;
  hostOnline?: boolean;
  compact?: boolean;
  selected?: boolean;
  className?: string;
}

export function SessionHealthBadges({
  session,
  hostOnline,
  compact = false,
  selected = false,
  className,
}: SessionHealthBadgesProps) {
  const badges = deriveSessionHealthBadges(session, { hostOnline });
  if (badges.length === 0) return null;

  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {badges.map((badge) => {
        const Icon = BADGE_ICONS[badge.kind];
        return (
          <Badge
            key={badge.kind}
            variant={BADGE_VARIANTS[badge.kind]}
            className={cn(
              'h-5 gap-1 px-1.5 text-[10px] leading-none',
              badge.kind === 'dirty-git' && 'border-amber-500/50 text-amber-700 dark:text-amber-300',
              badge.kind === 'host-offline' && 'border-slate-500/50 text-slate-600 dark:text-slate-300',
              badge.kind === 'unmanaged' && 'border-violet-500/50 text-violet-700 dark:text-violet-300',
              selected && BADGE_VARIANTS[badge.kind] === 'outline' && 'border-primary-foreground/50 text-primary-foreground'
            )}
            title={badge.title}
            aria-label={badge.title}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {!compact && badge.label}
          </Badge>
        );
      })}
    </span>
  );
}
