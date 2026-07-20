'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createGroup, updateGroup, getGroups } from '@/lib/api';
import type { GroupWithChildren } from '@/lib/groupTypes';

// Preset colors for groups
const PRESET_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

interface GroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  editGroup?: GroupWithChildren | null;
}

export function GroupModal({ isOpen, onClose, editGroup }: GroupModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [parentId, setParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  });

  // Flatten groups for parent selection
  const flattenGroups = (groups: GroupWithChildren[]): GroupWithChildren[] => {
    const result: GroupWithChildren[] = [];
    const traverse = (items: GroupWithChildren[], depth = 0) => {
      for (const item of items) {
        result.push({ ...item, name: '—'.repeat(depth) + ' ' + item.name });
        if (item.children.length > 0) {
          traverse(item.children, depth + 1);
        }
      }
    };
    traverse(groups);
    return result;
  };

  const availableParents = groupsData
    ? flattenGroups(groupsData.groups).filter((g) => !editGroup || g.id !== editGroup.id)
    : [];

  // Reset form when modal opens/closes or editGroup changes
  useEffect(() => {
    if (isOpen) {
      if (editGroup) {
        setName(editGroup.name);
        setColor(editGroup.color || '#6366f1');
        setParentId(editGroup.parent_id || null);
      } else {
        setName('');
        setColor('#6366f1');
        setParentId(null);
      }
      setError(null);
    }
  }, [isOpen, editGroup]);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string; parent_id?: string }) =>
      createGroup({
        name: data.name,
        color: data.color,
        parent_id: data.parent_id || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; name: string; color: string; parent_id?: string | null }) =>
      updateGroup(data.id, {
        name: data.name,
        color: data.color,
        parent_id: data.parent_id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (editGroup) {
      updateMutation.mutate({
        id: editGroup.id,
        name: name.trim(),
        color,
        parent_id: parentId,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        color,
        parent_id: parentId || undefined,
      });
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editGroup ? 'Edit Group' : 'Create Group'}</DialogTitle>
          <DialogDescription>
            Organize related sessions into a reusable sidebar group.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="group-name" className="mb-1 block text-sm font-medium">Name</label>
            <input
              id="group-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Group name"
              autoFocus
              disabled={isLoading}
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium mb-1">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`h-11 w-11 rounded-full border-2 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    color === c ? 'border-foreground' : 'border-transparent'
                  }`}
                  aria-label={`Use ${c} as the group color`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  disabled={isLoading}
                >
                  <span
                    className="block h-full w-full rounded-full"
                    style={{ backgroundColor: c }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Parent */}
          <div>
            <label htmlFor="group-parent" className="mb-1 block text-sm font-medium">Parent Group (optional)</label>
            <select
              id="group-parent"
              value={parentId || ''}
              onChange={(e) => setParentId(e.target.value || null)}
              className="h-11 w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={isLoading}
            >
              <option value="">No parent (root level)</option>
              {availableParents.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Actions */}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="mobile" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" size="mobile" disabled={isLoading}>
              {isLoading ? 'Saving...' : editGroup ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
