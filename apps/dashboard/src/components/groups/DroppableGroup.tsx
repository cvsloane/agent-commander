'use client';

import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface DroppableGroupProps {
  groupId: string | null; // null for "ungrouped" / root
  children: ReactNode;
  className?: string;
}

export function DroppableGroup({
  groupId,
  children,
  className,
}: DroppableGroupProps) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: groupId ?? 'ungrouped',
    data: {
      type: 'group',
      groupId,
    },
  });

  // Only show drop indicator when dragging a session
  const isSessionDragging = active?.data?.current?.type === 'session';

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'transition-colors duration-200',
        isOver && isSessionDragging && 'bg-primary/10 ring-2 ring-primary ring-inset rounded-md',
        className
      )}
    >
      {children}
    </div>
  );
}
