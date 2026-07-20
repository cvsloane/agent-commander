import type { SessionGroup } from '@agent-command/schema';

export interface GroupWithChildren extends SessionGroup {
  children: GroupWithChildren[];
  session_count: number;
}
