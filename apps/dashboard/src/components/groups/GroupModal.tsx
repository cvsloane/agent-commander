'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createGroup, updateGroup, getGroups } from '@/lib/api';
import type { SessionGroup } from '@agent-command/schema';

interface GroupWithChildren extends SessionGroup {
  children: GroupWithChildren[];
  session_count: number;
}

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
    ? flattenGroups(groupsData.groups).filter(
        (g) => !editGroup || g.id !== editGroup.id
      )
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
    mutationFn: (data: {
      id: string;
      name: string;
      color: string;
      parent_id?: string | null;
    }) =>
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {editGroup ? 'Edit Group' : 'Create Group'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded"
            disabled={isLoading}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
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
                  className={`w-6 h-6 rounded-full border-2 ${
                    color === c ? 'border-foreground' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  disabled={isLoading}
                />
              ))}
            </div>
          </div>

          {/* Parent */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Parent Group (optional)
            </label>
            <select
              value={parentId || ''}
              onChange={(e) => setParentId(e.target.value || null)}
              className="w-full px-3 py-2 border rounded-md bg-background"
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
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : editGroup ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
