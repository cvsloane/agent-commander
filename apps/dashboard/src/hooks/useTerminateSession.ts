'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@agent-command/schema';
import { bulkOperateSessions } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useNotifications } from '@/stores/notifications';
import { getSessionDisplayName } from '@/lib/utils';

export function useTerminateSession() {
  const [isTerminating, setIsTerminating] = useState(false);
  const updateSessions = useSessionStore((state) => state.updateSessions);
  const queryClient = useQueryClient();
  const notifications = useNotifications();

  const terminateSession = useCallback(async (session: Session) => {
    if (isTerminating) return;
    setIsTerminating(true);
    try {
      const result = await bulkOperateSessions('terminate', [session.id]);
      const error = result.errors?.find((err) => err.session_id === session.id);
      if (error || result.error_count > 0) {
        throw new Error(error?.error || 'Failed to terminate session');
      }

      updateSessions([{ ...session, archived_at: new Date().toISOString() } as Session]);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      notifications.success('Session terminated', getSessionDisplayName(session));
    } catch (error) {
      notifications.error('Failed to terminate session', (error as Error).message);
      throw error;
    } finally {
      setIsTerminating(false);
    }
  }, [isTerminating, notifications, queryClient, updateSessions]);

  return { terminateSession, isTerminating };
}
