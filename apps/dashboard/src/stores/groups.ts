import { create } from 'zustand';
import type { SessionGroup } from '@agent-command/schema';

interface GroupWithChildren extends SessionGroup {
  children: GroupWithChildren[];
  session_count: number;
}

interface GroupsStore {
  groups: GroupWithChildren[];
  flatGroups: SessionGroup[];
  selectedGroupId: string | null;
  expandedGroups: Set<string>;
  setGroups: (groups: GroupWithChildren[], flat: SessionGroup[]) => void;
  setSelectedGroup: (id: string | null) => void;
  toggleGroupExpanded: (id: string) => void;
  setGroupExpanded: (id: string, expanded: boolean) => void;
}

export const useGroupsStore = create<GroupsStore>((set) => ({
  groups: [],
  flatGroups: [],
  selectedGroupId: null,
  expandedGroups: new Set(),

  setGroups: (groups, flat) => set({ groups, flatGroups: flat }),

  setSelectedGroup: (id) => set({ selectedGroupId: id }),

  toggleGroupExpanded: (id) =>
    set((state) => {
      const newExpanded = new Set(state.expandedGroups);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return { expandedGroups: newExpanded };
    }),

  setGroupExpanded: (id, expanded) =>
    set((state) => {
      const newExpanded = new Set(state.expandedGroups);
      if (expanded) {
        newExpanded.add(id);
      } else {
        newExpanded.delete(id);
      }
      return { expandedGroups: newExpanded };
    }),
}));
