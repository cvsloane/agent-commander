import { create } from 'zustand';

export type EventConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'disconnected';

interface ConnectionStore {
  eventStatus: EventConnectionStatus;
  setEventStatus: (eventStatus: EventConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  eventStatus: 'connecting',
  setEventStatus: (eventStatus) => set({ eventStatus }),
}));
