'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Paperclip, RefreshCw } from 'lucide-react';
import { attachDropFile, getHostDropFiles } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AttachFilePanelProps {
  hostId: string;
  sessionId: string;
  /** Host advertises file_bridge; the panel renders nothing without it. */
  enabled: boolean;
  /** Receives the path written into the session cwd, for the prompt composer. */
  onAttached?: (path: string) => void;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Attaches a file that arrived via the host's sync folder (Nextcloud) into the
 * session's working directory, then hands the resulting path back so it can be
 * referenced in a prompt.
 *
 * Nothing is uploaded through the dashboard — the sync client already placed the
 * file on the host. This is only the last hop into the working directory, which
 * is why it is fast regardless of file size or the operator's connection.
 */
export function AttachFilePanel({
  hostId,
  sessionId,
  enabled,
  onAttached,
  className,
}: AttachFilePanelProps) {
  const [attachedPath, setAttachedPath] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['host-drop-files', hostId],
    queryFn: () => getHostDropFiles(hostId),
    enabled,
    staleTime: 10_000,
  });

  const attach = useMutation({
    mutationFn: (name: string) => attachDropFile(sessionId, name),
    onSuccess: (result) => {
      setAttachedPath(result.path);
      onAttached?.(result.path);
    },
  });

  if (!enabled) return null;

  const files = data?.files ?? [];

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          Attach from sync folder
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isRefetching}
          aria-label="Refresh files"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} aria-hidden="true" />
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Checking sync folder…</p>
      ) : isError ? (
        <p className="text-xs text-destructive">
          {(error as Error)?.message || 'Could not read the sync folder'}
        </p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing waiting. Drop a file into {data?.drop_dir ?? 'the sync folder'} from any device.
        </p>
      ) : (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={file.name}
              className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate" title={file.name}>
                {file.name}
                <span className="ml-2 text-muted-foreground">{formatSize(file.size_bytes)}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={attach.isPending}
                onClick={() => attach.mutate(file.name)}
              >
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}

      {attach.isError ? (
        <p className="text-xs text-destructive">
          {(attach.error as Error)?.message || 'Attach failed'}
        </p>
      ) : null}

      {attachedPath ? (
        <p className="break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
          Copied to {attachedPath}
        </p>
      ) : null}
    </div>
  );
}
