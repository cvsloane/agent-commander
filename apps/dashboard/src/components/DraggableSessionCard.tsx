'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { SessionWithSnapshot, Host } from '@agent-command/schema';
import { SessionCard } from './SessionCard';

interface DraggableSessionCardProps {
  session: SessionWithSnapshot;
  groupName?: string;
  host?: Host | null;
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  showSnapshotPreview?: boolean;
}

export function DraggableSessionCard({
  session,
  groupName,
  host,
  selectionMode = false,
  isSelected = false,
  onSelect,
  showSnapshotPreview = true,
}: DraggableSessionCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: session.id,
    data: {
      type: 'session',
      session,
    },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? 'z-50 relative' : ''}
    >
      <SessionCard
        session={session}
        groupName={groupName}
        host={host}
        selectionMode={selectionMode}
        isSelected={isSelected}
        onSelect={onSelect}
        showSnapshotPreview={showSnapshotPreview}
      />
    </div>
  );
}
