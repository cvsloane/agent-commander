'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, X, ArrowRight, ArrowLeft, Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  getSessionLinks,
  createSessionLink,
  deleteSessionLink,
  getSessions,
  type SessionLinkWithSession,
  type SessionLinkType,
} from '@/lib/api';
import { getProviderDisplayName, getProviderIcon, getRepoNameFromSession, getSessionDisplayName, getStatusIndicator } from '@/lib/utils';

interface LinkedSessionsPanelProps {
  sessionId: string;
  sourceGroupId?: string | null;
  onSendTo?: (targetSessionId: string) => void;
}

const LINK_TYPE_LABELS: Record<SessionLinkType, { label: string; description: string }> = {
  complement: { label: 'Complement', description: 'Working together on the same task' },
  review: { label: 'Review', description: 'One reviews the other\'s work' },
  implement: { label: 'Implement', description: 'Implements plans from source' },
  research: { label: 'Research', description: 'Provides research context' },
};

export function LinkedSessionsPanel({ sessionId, sourceGroupId, onSendTo }: LinkedSessionsPanelProps) {
  const queryClient = useQueryClient();
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [selectedLinkType, setSelectedLinkType] = useState<SessionLinkType>('complement');
  const [linkError, setLinkError] = useState<string | null>(null);

  const { data: linksData, isLoading: loadingLinks } = useQuery({
    queryKey: ['session-links', sessionId],
    queryFn: () => getSessionLinks(sessionId),
  });

  const { data: sessionsData, isLoading: loadingSessions } = useQuery({
    queryKey: ['sessions', 'for-linking'],
    queryFn: () => getSessions({ status: 'RUNNING,IDLE,WAITING_FOR_INPUT' }),
    enabled: showLinkDialog,
  });

  const links = linksData?.links || [];
  const linkedSessionIds = new Set(links.map((l) => l.linked_session_id));
  const availableSessions = (sessionsData?.sessions || []).filter(
    (s) => s.id !== sessionId && !linkedSessionIds.has(s.id)
  );
  const sortedSessions = [...availableSessions].sort((a, b) => {
    const aGroup = a.group_id || null;
    const bGroup = b.group_id || null;
    const aScore = sourceGroupId && aGroup === sourceGroupId ? 0 : 1;
    const bScore = sourceGroupId && bGroup === sourceGroupId ? 0 : 1;
    if (aScore !== bScore) return aScore - bScore;
    return getSessionDisplayName(a).localeCompare(getSessionDisplayName(b));
  });

  const createMutation = useMutation({
    mutationFn: () => createSessionLink(sessionId, selectedTargetId, selectedLinkType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-links', sessionId] });
      setShowLinkDialog(false);
      setSelectedTargetId('');
      setLinkError(null);
    },
    onError: (error: Error) => {
      setLinkError(error.message || 'Failed to create link');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (linkId: string) => deleteSessionLink(sessionId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-links', sessionId] });
    },
  });

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Linked Sessions
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLinkError(null);
              setShowLinkDialog(true);
            }}
            className="h-7 px-2"
          >
            <Plus className="h-4 w-4 mr-1" />
            Link
          </Button>
        </div>
      </CardHeader>
      <CardContent className="py-2">
        {loadingLinks ? (
          <p className="text-sm text-muted-foreground py-2">Loading...</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No linked sessions. Link sessions to enable quick content sharing.
          </p>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <LinkedSessionCard
                key={link.id}
                link={link}
                onDelete={() => deleteMutation.mutate(link.id)}
                onSendTo={onSendTo ? () => onSendTo(link.linked_session_id) : undefined}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}

        {/* Link Dialog */}
        {showLinkDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background border rounded-lg shadow-lg w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Link Session</h2>
                <button
                  onClick={() => setShowLinkDialog(false)}
                  className="p-1 hover:bg-accent rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Target Session
                  </label>
                  <select
                    value={selectedTargetId}
                    onChange={(e) => setSelectedTargetId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                    disabled={loadingSessions}
                  >
                    <option value="">Select a session...</option>
                    {sortedSessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {getSessionDisplayName(session)}
                        {getRepoNameFromSession(session) ? ` · ${getRepoNameFromSession(session)}` : ''}
                        {session.git_branch ? ` · ${session.git_branch}` : ''}
                        {` [${getProviderDisplayName(session.provider)}]`}
                      </option>
                    ))}
                  </select>
                  {availableSessions.length === 0 && !loadingSessions && (
                    <p className="text-xs text-muted-foreground mt-1">
                      No available sessions to link
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Link Type
                  </label>
                  <select
                    value={selectedLinkType}
                    onChange={(e) => setSelectedLinkType(e.target.value as SessionLinkType)}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  >
                    {(Object.entries(LINK_TYPE_LABELS) as [SessionLinkType, { label: string; description: string }][]).map(
                      ([type, { label, description }]) => (
                        <option key={type} value={type}>
                          {label} - {description}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {linkError && (
                  <div className="text-sm text-destructive">
                    {linkError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowLinkDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createMutation.mutate()}
                    disabled={!selectedTargetId || createMutation.isPending}
                  >
                    {createMutation.isPending ? 'Linking...' : 'Create Link'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface LinkedSessionCardProps {
  link: SessionLinkWithSession;
  onDelete: () => void;
  onSendTo?: () => void;
  isDeleting: boolean;
}

function LinkedSessionCard({ link, onDelete, onSendTo, isDeleting }: LinkedSessionCardProps) {
  const statusIndicator = getStatusIndicator(link.linked_session_status);
  const linkTypeInfo = LINK_TYPE_LABELS[link.link_type as SessionLinkType];

  return (
    <div className="flex items-center gap-2 p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-mono">
        {getProviderIcon(link.linked_session_provider)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {link.linked_session_title || 'Untitled'}
          </span>
          <Badge variant="outline" className="text-xs shrink-0">
            {linkTypeInfo?.label || link.link_type}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {link.direction === 'outgoing' ? (
              <ArrowRight className="h-3 w-3" />
            ) : (
              <ArrowLeft className="h-3 w-3" />
            )}
            {link.direction}
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            {statusIndicator.symbol} {statusIndicator.label}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {onSendTo && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onSendTo}
            className="h-7 w-7"
            title="Send content to this session"
          >
            <Send className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={isDeleting}
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          title="Remove link"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
