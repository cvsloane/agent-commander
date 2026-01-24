import { create } from 'zustand';

export type NotificationType = 'approval' | 'error' | 'warning' | 'success' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  sessionId?: string;
  approvalId?: string;
  duration?: number; // ms, 0 = persistent
  createdAt: string;
}

interface NotificationStore {
  notifications: Notification[];
  add: (notification: Omit<Notification, 'id' | 'createdAt'>) => string;
  remove: (id: string) => void;
  removeByApprovalId: (approvalId: string) => void;
  removeBySessionId: (sessionId: string) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],

  add: (notification) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNotification: Notification = {
      ...notification,
      id,
      createdAt: new Date().toISOString(),
      duration: notification.duration ?? 5000, // Default 5 seconds
    };

    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));

    // Auto-remove if duration > 0
    if (newNotification.duration && newNotification.duration > 0) {
      setTimeout(() => {
        get().remove(id);
      }, newNotification.duration);
    }

    return id;
  },

  remove: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
  removeByApprovalId: (approvalId) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.approvalId !== approvalId),
    }));
  },
  removeBySessionId: (sessionId) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.sessionId !== sessionId),
    }));
  },

  clear: () => {
    set({ notifications: [] });
  },
}));

// Helper hook for adding notifications
export function useNotifications() {
  const { add, remove, removeByApprovalId, removeBySessionId, clear } = useNotificationStore();

  return {
    success: (title: string, message?: string, options?: Partial<Notification>) =>
      add({ type: 'success', title, message, ...options }),
    error: (title: string, message?: string, options?: Partial<Notification>) =>
      add({ type: 'error', title, message, duration: 8000, ...options }),
    warning: (title: string, message?: string, options?: Partial<Notification>) =>
      add({ type: 'warning', title, message, ...options }),
    info: (title: string, message?: string, options?: Partial<Notification>) =>
      add({ type: 'info', title, message, ...options }),
    approval: (
      title: string,
      message?: string,
      sessionId?: string,
      approvalId?: string
    ) =>
      add({
        type: 'approval',
        title,
        message,
        sessionId,
        approvalId,
        duration: 0, // Persistent until dismissed or actioned
      }),
    remove,
    removeByApprovalId,
    removeBySessionId,
    clear,
  };
}
