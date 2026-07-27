'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Server } from 'lucide-react';
import { buildPreviewUrl, getHostPorts } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PreviewPortsPanelProps {
  hostId: string;
  /** Host advertises preview_ports; the panel renders nothing without it. */
  enabled: boolean;
  className?: string;
}

/**
 * Lists TCP services on the host and links to them over the tailnet.
 *
 * There is no tunnel here — the phone and the host are already Tailscale peers,
 * so a link to the host's tailnet address just works. The one thing that does
 * not work is a service bound to 127.0.0.1: it is invisible to every other
 * device. Those are shown but not linked, with the fix stated inline, because a
 * dead link produces a connection error the user cannot diagnose.
 */
export function PreviewPortsPanel({ hostId, enabled, className }: PreviewPortsPanelProps) {
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['host-ports', hostId],
    queryFn: () => getHostPorts(hostId),
    enabled,
    staleTime: 10_000,
  });

  if (!enabled) return null;

  const ports = data?.ports ?? [];
  const tailscaleIp = data?.tailscale_ip ?? null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Server className="h-4 w-4" aria-hidden="true" />
          Preview
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isRefetching}
          aria-label="Refresh ports"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} aria-hidden="true" />
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Scanning ports…</p>
      ) : isError ? (
        <p className="text-xs text-destructive">
          {(error as Error)?.message || 'Could not list ports'}
        </p>
      ) : ports.length === 0 ? (
        <p className="text-xs text-muted-foreground">No services listening.</p>
      ) : (
        <ul className="space-y-1">
          {ports.map((port) => {
            const url = buildPreviewUrl(port, tailscaleIp);
            return (
              <li
                key={port.port}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono font-medium">:{port.port}</span>
                  {port.process ? (
                    <span className="ml-2 text-muted-foreground">{port.process}</span>
                  ) : null}
                </span>

                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                  >
                    Open
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span
                    className="shrink-0 text-muted-foreground"
                    title={
                      port.loopback
                        ? `Bound to ${port.address} — only reachable on the host itself. Restart the server on 0.0.0.0 to preview it here.`
                        : 'This host has no tailnet address, so it cannot be previewed.'
                    }
                  >
                    {port.loopback ? 'local only' : 'no tailnet address'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
