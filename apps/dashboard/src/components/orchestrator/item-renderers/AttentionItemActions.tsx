'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  ExternalLink,
  Loader2,
  Moon,
  Send,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OrchestratorItem } from '@/stores/orchestrator';
import type { DetectedAction } from '../DetectionEngine';
import type { AttentionResponseMode } from '../attentionActions';

interface AttentionItemActionsProps {
  item: OrchestratorItem;
  mode: AttentionResponseMode;
  loading: boolean;
  success: boolean;
  onRespond: (choice: string) => Promise<boolean>;
  onIdle?: (sessionId: string) => void;
}

function TerminalShortcut({
  item,
  label = 'Open terminal',
}: {
  item: OrchestratorItem;
  label?: string;
}) {
  if (item.sessionId) {
    const hostParam = item.sessionHostId
      ? `host_id=${encodeURIComponent(item.sessionHostId)}&`
      : '';
    return (
      <Link href={`/?${hostParam}session_id=${encodeURIComponent(item.sessionId)}&mode=terminal&attach=1`}>
        <Button size="sm" variant="outline" className="w-full gap-1">
          <Terminal className="h-4 w-4" aria-hidden="true" />
          {label}
        </Button>
      </Link>
    );
  }
  const runId = item.automationRunId || item.governanceRunId;
  return (
    <Link href={runId ? `/automation?run=${encodeURIComponent(runId)}` : '/automation'}>
      <Button size="sm" variant="outline" className="w-full gap-1">
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        Open automation
      </Button>
    </Link>
  );
}

function YesNoButtons({
  loading,
  yes,
  no,
  onRespond,
  denyVariant = 'destructive',
}: {
  loading: boolean;
  yes: { label: string; value: string };
  no: { label: string; value: string };
  onRespond: (choice: string) => Promise<boolean>;
  denyVariant?: 'destructive' | 'outline';
}) {
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        className="flex-1 bg-green-600 hover:bg-green-700"
        onClick={() => void onRespond(yes.value)}
        disabled={loading}
      >
        {loading
          ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          : <CheckCircle className="mr-1 h-4 w-4" aria-hidden="true" />}
        {yes.label}
      </Button>
      <Button
        size="sm"
        variant={denyVariant}
        className="flex-1"
        onClick={() => void onRespond(no.value)}
        disabled={loading}
      >
        {loading
          ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          : <XCircle className="mr-1 h-4 w-4" aria-hidden="true" />}
        {no.label}
      </Button>
    </div>
  );
}

function IdleAndStreamActions({
  item,
  onIdle,
}: {
  item: OrchestratorItem;
  onIdle?: (sessionId: string) => void;
}) {
  if (!item.sessionId) return null;
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        className="flex-1 gap-1"
        onClick={() => onIdle?.(item.sessionId!)}
      >
        <Moon className="h-3 w-3" aria-hidden="true" />
        Mark Idle
      </Button>
      <Link href={`/sessions/${item.sessionId}`} className="flex-1">
        <Button size="sm" variant="outline" className="w-full gap-1">
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Go to Stream
        </Button>
      </Link>
    </div>
  );
}

function MultiChoiceActions({
  options,
  allowCustom,
  loading,
  onRespond,
}: {
  options: NonNullable<DetectedAction['options']>;
  allowCustom?: boolean;
  loading: boolean;
  onRespond: (choice: string) => Promise<boolean>;
}) {
  const [customChoice, setCustomChoice] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {options.slice(0, 5).map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="outline"
            onClick={() => void onRespond(option.value)}
            disabled={loading}
            className="text-xs"
          >
            {loading && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />}
            {option.value}. {option.label.slice(0, 20)}
            {option.label.length > 20 ? '…' : ''}
          </Button>
        ))}
      </div>
      {allowCustom && (
        <div className="flex gap-2">
          <Input
            value={customChoice}
            onChange={(event) => setCustomChoice(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && customChoice.trim()) {
                void onRespond(customChoice.trim());
              }
            }}
            placeholder="Other…"
            className="h-8 flex-1 text-sm"
            disabled={loading}
          />
          <Button
            size="sm"
            onClick={() => customChoice.trim() && void onRespond(customChoice.trim())}
            disabled={loading || !customChoice.trim()}
            className="h-8 gap-1"
          >
            {loading
              ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              : <Send className="h-3 w-3" aria-hidden="true" />}
            Send
          </Button>
        </div>
      )}
    </div>
  );
}

function TextEntryActions({
  placeholder,
  loading,
  onRespond,
}: {
  placeholder: string;
  loading: boolean;
  onRespond: (choice: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const submit = () => text.trim() && void onRespond(text.trim());
  return (
    <div className="flex gap-2">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && submit()}
        placeholder={placeholder}
        className="h-8 flex-1 text-sm"
        disabled={loading}
      />
      <Button
        size="sm"
        onClick={submit}
        disabled={loading || !text.trim()}
        className="h-8 gap-1"
      >
        {loading
          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          : <Send className="h-3 w-3" aria-hidden="true" />}
        Send
      </Button>
    </div>
  );
}

function QuickResponseActions({
  label,
  placeholder,
  loading,
  onRespond,
}: {
  label: string;
  placeholder: string;
  loading: boolean;
  onRespond: (choice: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const submit = () => text.trim() && void onRespond(text.trim());
  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full gap-1"
        onClick={() => setOpen(true)}
      >
        <Send className="h-3 w-3" aria-hidden="true" />
        {label}
      </Button>
    );
  }
  return (
    <div className="flex gap-2">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className="h-8 flex-1 text-sm"
        disabled={loading}
        autoFocus
      />
      <Button
        size="sm"
        onClick={submit}
        disabled={loading || !text.trim()}
        className="h-8 gap-1"
        aria-label="Send response"
      >
        {loading
          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          : <Send className="h-3 w-3" aria-hidden="true" />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(false)}
        className="h-8"
        aria-label="Cancel response"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  );
}

function normalizedYesNo(item: OrchestratorItem) {
  const options = item.action?.options?.map((option) => ({
    ...option,
    normalized: option.value.toLowerCase(),
  })) ?? [];
  const yes = options.find((option) => (
    ['y', 'yes', 'allow', 'approve'].includes(option.normalized)
  )) ?? options[0];
  const no = options.find((option) => (
    ['n', 'no', 'deny', 'reject'].includes(option.normalized)
  )) ?? options[1];
  return {
    yes: {
      label: yes?.label || (item.source === 'approval' ? 'Allow' : 'Yes'),
      value: yes?.value || (item.source === 'approval' ? 'allow' : 'y'),
    },
    no: {
      label: no?.label || (item.source === 'approval' ? 'Deny' : 'No'),
      value: no?.value || (item.source === 'approval' ? 'deny' : 'n'),
    },
  };
}

function WaitingItemActions(props: AttentionItemActionsProps) {
  const { item, loading, onRespond } = props;
  if (item.action?.type === 'multi_choice' && item.action.options?.length) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <MultiChoiceActions
          options={item.action.options}
          allowCustom={item.action.allowCustom}
          loading={loading}
          onRespond={onRespond}
        />
        <TerminalShortcut item={item} />
      </div>
    );
  }
  if (item.action?.type === 'yes_no' && item.action.options?.length === 2) {
    const { yes, no } = normalizedYesNo(item);
    return (
      <div className="mt-3 flex flex-col gap-2">
        <YesNoButtons
          yes={yes}
          no={no}
          loading={loading}
          onRespond={onRespond}
          denyVariant="outline"
        />
        <TerminalShortcut item={item} />
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      <QuickResponseActions
        label="Send Message"
        placeholder="Send a message…"
        loading={loading}
        onRespond={onRespond}
      />
      <TerminalShortcut item={item} />
    </div>
  );
}

function PlanReviewItemActions(props: AttentionItemActionsProps) {
  const { item, loading, onRespond, onIdle } = props;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <TerminalShortcut item={item} label="Review Plan in Terminal" />
      <YesNoButtons
        yes={{ label: item.source === 'approval' ? 'Approve' : 'Yes', value: item.source === 'approval' ? 'allow' : 'y' }}
        no={{ label: item.source === 'approval' ? 'Reject' : 'No', value: item.source === 'approval' ? 'deny' : 'n' }}
        loading={loading}
        onRespond={onRespond}
      />
      <IdleAndStreamActions item={item} onIdle={onIdle} />
    </div>
  );
}

function YesNoItemActions(props: AttentionItemActionsProps) {
  const { item, loading, onRespond, onIdle } = props;
  const isUnresolvedApproval = item.sessionStatus === 'WAITING_FOR_APPROVAL'
    && !(item.source === 'approval' && item.approval);
  if (isUnresolvedApproval) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <TerminalShortcut item={item} label="Review in Terminal" />
        {item.sessionId && (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1"
            onClick={() => onIdle?.(item.sessionId!)}
          >
            <Moon className="h-3 w-3" aria-hidden="true" />
            Mark Idle
          </Button>
        )}
      </div>
    );
  }
  const { yes, no } = normalizedYesNo(item);
  const hasNoContext = item.source === 'approval' && !item.action?.context?.trimEnd();
  return (
    <div className="mt-3 flex flex-col gap-2">
      {hasNoContext && <TerminalShortcut item={item} label="Review in Terminal" />}
      <YesNoButtons yes={yes} no={no} loading={loading} onRespond={onRespond} />
      {!hasNoContext && <TerminalShortcut item={item} />}
      {hasNoContext && <IdleAndStreamActions item={item} onIdle={onIdle} />}
    </div>
  );
}

function TextInputItemActions(props: AttentionItemActionsProps) {
  const { item, loading, onRespond, onIdle } = props;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <TextEntryActions
        placeholder={item.action?.placeholder || 'Type your response…'}
        loading={loading}
        onRespond={onRespond}
      />
      <TerminalShortcut item={item} />
      <IdleAndStreamActions item={item} onIdle={onIdle} />
    </div>
  );
}

function GenericItemActions(props: AttentionItemActionsProps) {
  const { item, loading, onRespond, onIdle } = props;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <QuickResponseActions
        label="Quick Response"
        placeholder="Quick response…"
        loading={loading}
        onRespond={onRespond}
      />
      <TerminalShortcut item={item} />
      <IdleAndStreamActions item={item} onIdle={onIdle} />
    </div>
  );
}

export function AttentionItemActions(props: AttentionItemActionsProps) {
  const { item, mode, loading, success, onRespond } = props;
  if (success || !item.action) return null;
  if (mode === 'waiting') return <WaitingItemActions {...props} />;
  if (item.source === 'governance') {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <YesNoButtons
          yes={{ label: 'Approve', value: 'approve' }}
          no={{ label: 'Deny', value: 'deny' }}
          loading={loading}
          onRespond={onRespond}
        />
        <TerminalShortcut item={item} />
      </div>
    );
  }
  if (item.source === 'run') return <div className="mt-3"><TerminalShortcut item={item} /></div>;
  if (item.action.type === 'plan_review' || item.approvalType === 'plan_review') {
    return <PlanReviewItemActions {...props} />;
  }
  if (item.action.type === 'yes_no') return <YesNoItemActions {...props} />;
  if (item.action.type === 'multi_choice' && item.action.options) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <MultiChoiceActions
          options={item.action.options}
          allowCustom={item.action.allowCustom}
          loading={loading}
          onRespond={onRespond}
        />
        <TerminalShortcut item={item} />
      </div>
    );
  }
  if (item.action.type === 'text_input') return <TextInputItemActions {...props} />;
  return <GenericItemActions {...props} />;
}
