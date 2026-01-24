'use client';

import { useCallback, useRef } from 'react';
import type { ServerToUIMessage } from '@agent-command/schema';
import { useWebSocket } from './useWebSocket';
import { useNotifications } from '@/stores/notifications';
import { useUsageStore } from '@/stores/usage';

// Trigger warning when usage reaches these thresholds
const USAGE_WARNING_THRESHOLDS = [50, 75, 90, 100];

export function useNotificationWebSocket() {
  const notifications = useNotifications();
  const { getUsagePercentage, plan } = useUsageStore();

  // Track which thresholds we've already warned about
  const warnedThresholds = useRef<Set<number>>(new Set());

  const handleMessage = useCallback((message: ServerToUIMessage) => {
    switch (message.type) {
      case 'approvals.created': {
        const payload = message.payload as {
          approval_id: string;
          session_id: string;
          provider: string;
          requested_payload: {
            type?: string;
            tool_name?: string;
            content?: string;
          };
        };

        // Extract tool/action info for the notification
        const requestPayload = payload.requested_payload || {};
        let actionDescription = 'Action requested';
        if (requestPayload.type === 'tool_use' && requestPayload.tool_name) {
          actionDescription = `Tool: ${requestPayload.tool_name}`;
        } else if (requestPayload.content) {
          // Truncate content for display
          const content = requestPayload.content;
          actionDescription = content.length > 50 ? content.slice(0, 50) + '...' : content;
        }

        notifications.approval(
          'Approval Required',
          actionDescription,
          payload.session_id,
          payload.approval_id
        );
        break;
      }

      case 'approvals.updated': {
        const payload = message.payload as {
          approval_id: string;
          session_id: string;
          decision: 'allow' | 'deny';
        };

        if (payload.decision === 'allow') {
          notifications.success('Approval Granted', 'Session can continue', {
            sessionId: payload.session_id,
            duration: 3000,
          });
        } else {
          notifications.info('Approval Denied', 'Action was not permitted', {
            sessionId: payload.session_id,
            duration: 3000,
          });
        }
        break;
      }

      case 'sessions.changed': {
        const payload = message.payload as {
          sessions: Array<{
            id: string;
            status: string;
            title?: string | null;
            cwd?: string | null;
          }>;
        };

        for (const session of payload.sessions) {
          // Notify on error status
          if (session.status === 'ERROR') {
            const sessionName = session.title || session.cwd?.split('/').pop() || 'Session';
            notifications.error(
              'Session Error',
              `${sessionName} encountered an error`,
              { sessionId: session.id }
            );
          }
        }
        break;
      }
    }
  }, [notifications]);

  useWebSocket(
    [
      { type: 'approvals', filter: { status: 'pending' } },
      { type: 'sessions' },
    ],
    handleMessage
  );

  // Check usage thresholds and notify
  const checkUsageWarnings = useCallback((currentTokens: number) => {
    if (plan === 'unlimited') return;

    const percentage = getUsagePercentage(currentTokens);

    for (const threshold of USAGE_WARNING_THRESHOLDS) {
      if (percentage >= threshold && !warnedThresholds.current.has(threshold)) {
        warnedThresholds.current.add(threshold);

        if (threshold === 100) {
          notifications.error(
            'Usage Limit Reached',
            `You've reached your weekly ${plan} plan limit`,
            { duration: 0 } // Persistent
          );
        } else {
          notifications.warning(
            `${threshold}% Usage`,
            `You've used ${threshold}% of your weekly limit`,
            { duration: 6000 }
          );
        }
      }
    }
  }, [plan, getUsagePercentage, notifications]);

  return { checkUsageWarnings };
}
