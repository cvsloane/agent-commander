'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, Loader2, MessageSquare, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { OrchestratorItem } from '@/stores/orchestrator';
import type { AttentionResponseMode } from '../attentionActions';

function ApprovalContext({ payload }: { payload: Record<string, unknown> }) {
  const details = (payload.details || {}) as Record<string, unknown>;
  const command = payload.command || details.command;
  const tool = payload.tool || payload.tool_name || details.tool || details.tool_name;
  const path = payload.path || payload.file || details.path || details.file;
  const description = payload.description || details.description;
  const args = payload.args || details.args;
  const bashCommand = details.bash_command || payload.bash_command;
  const contextItems: { label: string; value: string }[] = [];

  if (tool) contextItems.push({ label: 'Tool', value: String(tool) });
  if (bashCommand) contextItems.push({ label: 'Command', value: String(bashCommand) });
  else if (command) contextItems.push({ label: 'Command', value: String(command) });
  if (path) contextItems.push({ label: 'Path', value: String(path) });
  if (args && typeof args === 'object') {
    const argString = Object.entries(args as Record<string, unknown>)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ');
    if (argString) contextItems.push({ label: 'Args', value: argString });
  }
  if (description) contextItems.push({ label: 'Description', value: String(description) });

  if (contextItems.length === 0) {
    const relevantKeys = Object.keys(payload).filter((key) => (
      !['reason', 'details', 'approval_type', 'input_schema'].includes(key) && payload[key]
    ));
    if (relevantKeys.length > 0) {
      const value = relevantKeys.slice(0, 3).map((key) => {
        const raw = payload[key];
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return `${key}: ${text.slice(0, 50)}${text.length > 50 ? '…' : ''}`;
      }).join(', ');
      contextItems.push({ label: 'Details', value });
    }
  }
  if (contextItems.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 text-xs">
      {contextItems.map(({ label, value }) => (
        <div key={label} className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">{label}:</span>
          <code className="line-clamp-2 break-all rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
            {value}
          </code>
        </div>
      ))}
    </div>
  );
}

function ActionIcon({ item }: { item: OrchestratorItem }) {
  switch (item.action?.type) {
    case 'yes_no':
      return <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />;
    case 'multi_choice':
      return <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />;
    case 'text_input':
      return <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />;
    case 'plan_review':
      return <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
    default:
      return <AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  }
}

export function AttentionItemStatus({
  item,
  mode,
}: {
  item: OrchestratorItem;
  mode: AttentionResponseMode;
}) {
  let status = mode === 'waiting' ? 'WAITING' : item.sessionStatus;
  if (mode === 'action' && item.action && status === 'RUNNING') {
    if (item.source === 'approval') status = 'WAITING_FOR_APPROVAL';
    else if (['yes_no', 'multi_choice', 'text_input', 'plan_review'].includes(item.action.type)) {
      status = 'WAITING_FOR_INPUT';
    }
  }
  const variant = mode === 'waiting'
    ? 'secondary'
    : status === 'ERROR'
      ? 'error'
      : status === 'RUNNING'
        ? 'running'
        : status.startsWith('WAITING')
          ? 'approval'
          : 'secondary';
  return (
    <Badge variant={variant} className="text-xs">
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}

export function AttentionItemDetails({ item }: { item: OrchestratorItem }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const preview = item.action?.context?.trimEnd();
  const previewLines = preview ? preview.split('\n').slice(-60).join('\n') : '';

  useEffect(() => {
    const node = previewRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [previewLines]);

  return (
    <>
      {item.action && (
        <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <ActionIcon item={item} />
          <span className="line-clamp-2">{item.action.question || 'Action required'}</span>
        </div>
      )}
      {item.source === 'approval' && item.approval?.requested_payload && (
        <ApprovalContext payload={item.approval.requested_payload as Record<string, unknown>} />
      )}
      {previewLines && (
        <div className="mt-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {item.source === 'run' || item.source === 'governance' ? 'Context' : 'Terminal Preview'}
          </div>
          <div
            ref={previewRef}
            className="mt-1 max-h-48 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground"
            style={{ overflowWrap: 'anywhere' }}
          >
            {previewLines}
          </div>
        </div>
      )}
    </>
  );
}

export function AttentionItemSummary({
  item,
  enabled,
}: {
  item: OrchestratorItem;
  enabled: boolean;
}) {
  if (!item.action) return null;
  const hasContext = Boolean(item.action.context?.trim());
  return (
    <div className="mt-2 text-xs">
      <div className="flex min-h-[18px] items-start gap-1.5 text-muted-foreground">
        {item.summaryLoading ? (
          <><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /><span>Generating summary…</span></>
        ) : item.summary ? (
          <><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" /><p className="leading-relaxed">{item.summary}</p></>
        ) : item.summaryFailed ? (
          <><Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span className="italic">Summary unavailable</span></>
        ) : !hasContext ? (
          <><Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span className="italic">No terminal context captured</span></>
        ) : enabled ? (
          <><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" /><span className="italic">Summary pending…</span></>
        ) : (
          <><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" /><span className="italic">AI summary unavailable</span></>
        )}
      </div>
    </div>
  );
}
