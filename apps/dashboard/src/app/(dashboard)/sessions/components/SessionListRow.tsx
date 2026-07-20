import type { Host, SessionWithSnapshot } from '@agent-command/schema';
import { DraggableSessionCard } from '@/components/DraggableSessionCard';
import { SessionCard } from '@/components/SessionCard';
import { SessionVirtualizationBoundary } from './SessionVirtualizationBoundary';

export interface SessionListRowProps {
  session: SessionWithSnapshot;
  groupName?: string;
  host?: Host;
  selectionMode: boolean;
  isSelected: boolean;
  onSelectSession?: (id: string, selected: boolean) => void;
  dragEnabled: boolean;
  showSnapshotPreview: boolean;
}

export function SessionListRow({
  session,
  groupName,
  host,
  selectionMode,
  isSelected,
  onSelectSession,
  dragEnabled,
  showSnapshotPreview,
}: SessionListRowProps) {
  const CardComponent = dragEnabled ? DraggableSessionCard : SessionCard;
  return (
    <SessionVirtualizationBoundary enabled={!dragEnabled}>
      <CardComponent
        session={session}
        groupName={groupName}
        host={host}
        selectionMode={selectionMode}
        isSelected={isSelected}
        onSelect={selectionMode ? onSelectSession : undefined}
        showSnapshotPreview={showSnapshotPreview}
      />
    </SessionVirtualizationBoundary>
  );
}
