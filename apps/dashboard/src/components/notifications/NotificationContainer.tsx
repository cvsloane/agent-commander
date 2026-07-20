'use client';

import { useNotificationStore } from '@/stores/notifications';
import { NotificationToast } from './NotificationToast';

export function NotificationContainer() {
  const { notifications } = useNotificationStore();

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+8rem)] right-[max(1rem,env(safe-area-inset-right))] z-50 flex max-h-[calc(100dvh-10rem)] max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto md:bottom-[calc(env(safe-area-inset-bottom)+4rem)] md:max-h-[calc(100dvh-6rem)]">
      {notifications.map((notification) => (
        <NotificationToast key={notification.id} notification={notification} />
      ))}
    </div>
  );
}
