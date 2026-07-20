import type { Host, SessionWithSnapshot } from '@agent-command/schema';
import { SessionListRow } from './SessionListRow';

export interface SessionListGridProps {
  sessions: SessionWithSnapshot[];
  groupNameById: Map<string, string>;
  hostById: Map<string, Host>;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onSelectSession?: (id: string, selected: boolean) => void;
  dragEnabled: boolean;
  showSnapshotPreview: boolean;
}

export function SessionListGrid({
  sessions,
  groupNameById,
  hostById,
  selectionMode,
  selectedIds,
  onSelectSession,
  dragEnabled,
  showSnapshotPreview,
}: SessionListGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sessions.map((session) => (
        <SessionListRow
          key={session.id}
          session={session}
          groupName={session.group_id ? groupNameById.get(session.group_id) : undefined}
          host={hostById.get(session.host_id)}
          selectionMode={selectionMode}
          isSelected={selectedIds.has(session.id)}
          onSelectSession={onSelectSession}
          dragEnabled={dragEnabled}
          showSnapshotPreview={showSnapshotPreview}
        />
      ))}
    </div>
  );
}
