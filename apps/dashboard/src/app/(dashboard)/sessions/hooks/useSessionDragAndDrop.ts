'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { assignSessionGroup } from '@/lib/api';
import { useSessionStore } from '@/stores/session';

export function shouldAssignSessionGroup(
  currentGroupId: string | null | undefined,
  targetGroupId: string | null
): boolean {
  return (currentGroupId ?? null) !== targetGroupId;
}

export function useSessionDragAndDrop() {
  const [dragEnabled, setDragEnabled] = useState(false);
  const updateSessions = useSessionStore((state) => state.updateSessions);
  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      const session = active.data.current?.session;
      if (!over || !session) return;
      const targetGroupId = (over.data.current?.groupId as string | null) ?? null;
      if (!shouldAssignSessionGroup(session.group_id, targetGroupId)) return;
      try {
        const result = await assignSessionGroup(active.id as string, targetGroupId);
        updateSessions([result.session]);
        void queryClient.invalidateQueries({ queryKey: ['groups'] });
      } catch (error) {
        console.error('Failed to assign session to group:', error);
      }
    },
    [queryClient, updateSessions]
  );

  return { dragEnabled, setDragEnabled, sensors, handleDragEnd };
}
