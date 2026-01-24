'use client';

import { useRouter } from 'next/navigation';
import {
  X,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNotificationStore, type Notification } from '@/stores/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { decideApproval } from '@/lib/api';

interface NotificationToastProps {
  notification: Notification;
}

const typeConfig = {
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-500/10 border-green-500/30',
    iconColor: 'text-green-500',
  },
  error: {
    icon: AlertCircle,
    bgColor: 'bg-red-500/10 border-red-500/30',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-yellow-500/10 border-yellow-500/30',
    iconColor: 'text-yellow-500',
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-500/10 border-blue-500/30',
    iconColor: 'text-blue-500',
  },
  approval: {
    icon: ShieldCheck,
    bgColor: 'bg-orange-500/10 border-orange-500/30',
    iconColor: 'text-orange-500',
  },
};

export function NotificationToast({ notification }: NotificationToastProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { remove } = useNotificationStore();
  const config = typeConfig[notification.type];
  const Icon = config.icon;

  const approveMutation = useMutation({
    mutationFn: (decision: 'allow' | 'deny') =>
      decideApproval(notification.approvalId!, { decision, mode: 'both' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      remove(notification.id);
    },
  });

  const handleView = () => {
    if (notification.sessionId) {
      router.push(`/sessions/${notification.sessionId}`);
      remove(notification.id);
    }
  };

  return (
    <div
      className={cn(
        'w-80 rounded-lg border p-4 shadow-lg backdrop-blur-sm',
        'animate-in slide-in-from-right-full duration-300',
        config.bgColor
      )}
    >
      <div className="flex gap-3">
        <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', config.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-sm">{notification.title}</p>
            <button
              onClick={() => remove(notification.id)}
              className="p-0.5 hover:bg-background/50 rounded transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          {notification.message && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {notification.message}
            </p>
          )}

          {/* Action buttons for approvals */}
          {notification.type === 'approval' && notification.approvalId && (
            <div className="flex gap-2 mt-3">
              {notification.sessionId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleView}
                >
                  <ExternalLink className="h-3 w-3" />
                  View
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs bg-green-600 hover:bg-green-700"
                onClick={() => approveMutation.mutate('allow')}
                disabled={approveMutation.isPending}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-red-500/30 text-red-500 hover:bg-red-500/10"
                onClick={() => approveMutation.mutate('deny')}
                disabled={approveMutation.isPending}
              >
                Deny
              </Button>
            </div>
          )}

          {/* View button for sessions */}
          {notification.type !== 'approval' && notification.sessionId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs mt-2 gap-1"
              onClick={handleView}
            >
              <ExternalLink className="h-3 w-3" />
              View Session
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
