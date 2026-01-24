'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ExternalLink,
  X,
  AlertCircle,
  MessageSquare,
  CheckCircle,
  XCircle,
  Loader2,
  Moon,
  Sun,
  Sparkles,
  Terminal,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn, getProviderIcon } from '@/lib/utils';
import { sendCommand, decideApproval } from '@/lib/api';
import { buildResponse, type DetectedAction } from './DetectionEngine';
import type { OrchestratorItem as OrchestratorItemType } from '@/stores/orchestrator';

/**
 * Extract and display relevant context from an approval's requested_payload
 */
function ApprovalContext({ payload }: { payload: Record<string, unknown> }) {
  const details = (payload.details || {}) as Record<string, unknown>;

  // Extract common fields that might contain useful context
  const command = payload.command || details.command;
  const tool = payload.tool || payload.tool_name || details.tool || details.tool_name;
  const path = payload.path || payload.file || details.path || details.file;
  const description = payload.description || details.description;
  const args = payload.args || details.args;

  // For bash/shell commands
  const bashCommand = details.bash_command || payload.bash_command;

  // Build context items to display
  const contextItems: { label: string; value: string }[] = [];

  if (tool) {
    contextItems.push({ label: 'Tool', value: String(tool) });
  }
  if (bashCommand) {
    contextItems.push({ label: 'Command', value: String(bashCommand) });
  } else if (command) {
    contextItems.push({ label: 'Command', value: String(command) });
  }
  if (path) {
    contextItems.push({ label: 'Path', value: String(path) });
  }
  if (args && typeof args === 'object') {
    // Show key args if it's an object
    const argStr = Object.entries(args as Record<string, unknown>)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');
    if (argStr) {
      contextItems.push({ label: 'Args', value: argStr });
    }
  }
  if (description) {
    contextItems.push({ label: 'Description', value: String(description) });
  }

  // If no structured context, try to show raw payload keys
  if (contextItems.length === 0) {
    const relevantKeys = Object.keys(payload).filter(
      k => !['reason', 'details', 'approval_type', 'input_schema'].includes(k) && payload[k]
    );
    if (relevantKeys.length > 0) {
      const preview = relevantKeys.slice(0, 3).map(k => {
        const val = payload[k];
        const valStr = typeof val === 'string' ? val : JSON.stringify(val);
        return `${k}: ${valStr.slice(0, 50)}${valStr.length > 50 ? '...' : ''}`;
      }).join(', ');
      contextItems.push({ label: 'Details', value: preview });
    }
  }

  if (contextItems.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 text-xs space-y-1">
      {contextItems.map(({ label, value }, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-muted-foreground shrink-0">{label}:</span>
          <code className="text-foreground bg-muted px-1 py-0.5 rounded text-[11px] break-all line-clamp-2">
            {value}
          </code>
        </div>
      ))}
    </div>
  );
}

interface OrchestratorItemProps {
  item: OrchestratorItemType;
  onDismiss: (itemId: string) => void;
  onResponseSent?: () => void;
  onIdle?: (sessionId: string) => void;
  onUnidle?: (sessionId: string) => void;
  summariesEnabled?: boolean;
  mode?: 'action' | 'waiting';
  showSummary?: boolean;
  showItemActions?: boolean;
}

const NON_BLOCKING_APPROVAL_TOOLS = new Set([
  'askuserquestion',
  'exitplanmode',
  'enterplanmode',
]);

function hasNonEmptyValue(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function approvalHasDecisionPayload(payload: Record<string, unknown>): boolean {
  const details = (payload.details || {}) as Record<string, unknown>;
  const command =
    details.bash_command ||
    payload.bash_command ||
    details.command ||
    payload.command;
  const path = payload.path || payload.file || details.path || details.file;
  const args = payload.args || details.args;
  const url = payload.url || details.url || payload.uri || details.uri;

  return (
    hasNonEmptyValue(command) ||
    hasNonEmptyValue(path) ||
    hasNonEmptyValue(args) ||
    hasNonEmptyValue(url)
  );
}

function extractApprovalTool(payload: Record<string, unknown>): string | null {
  const details = (payload.details || {}) as Record<string, unknown>;
  const tool = payload.tool || payload.tool_name || details.tool || details.tool_name;
  if (!tool) return null;
  return String(tool);
}

function shouldUseApprovalDecision(item: OrchestratorItemType): boolean {
  if (!item.approval) return false;
  const requestedPayload = item.approval.requested_payload as Record<string, unknown>;
  const tool = extractApprovalTool(requestedPayload);
  if (tool && NON_BLOCKING_APPROVAL_TOOLS.has(tool.toLowerCase())) {
    return false;
  }

  const approvalType = item.approvalType || item.approvalInput?.type || 'binary';
  if (approvalType === 'plan_review') return true;
  if (item.sessionStatus !== 'WAITING_FOR_APPROVAL') return false;
  if (approvalType === 'text_input') return false;

  return approvalHasDecisionPayload(requestedPayload);
}

export function OrchestratorItem({
  item,
  onDismiss,
  onResponseSent,
  onIdle,
  onUnidle,
  summariesEnabled = false,
  mode = 'action',
  showSummary = true,
  showItemActions = true,
}: OrchestratorItemProps) {
  const [loading, setLoading] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [quickResponseMode, setQuickResponseMode] = useState(false);
  const [customChoice, setCustomChoice] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  const preview = item.action?.context?.trimEnd();
  const previewLines = preview
    ? preview.split('\n').slice(-60).join('\n')
    : '';
  const hasSummaryContext = Boolean(item.action?.context?.trim());

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [previewLines]);

  const renderTerminalShortcut = (label: string = 'Take me to terminal') => (
    <Link href={`/sessions/${item.sessionId}?view=terminal`}>
      <Button size="sm" variant="outline" className="w-full gap-1">
        <Terminal className="h-4 w-4" />
        {label}
      </Button>
    </Link>
  );

  const handleSendResponse = useCallback(async (choice: string) => {
    if (!item.action) return;

    setLoading(true);
    setError(null);

    try {
      if (
        mode !== 'waiting' &&
        item.source === 'approval' &&
        item.approval &&
        shouldUseApprovalDecision(item)
      ) {
        // Handle approval via API
        const approvalType = item.approvalType || item.approvalInput?.type || 'binary';

        if (approvalType === 'text_input') {
          await decideApproval(item.approval.id, {
            decision: 'allow',
            mode: 'both',
            payload: {
              updatedInput: {
                text: choice,
              },
            },
          });
        } else if (approvalType === 'multi_choice') {
          await decideApproval(item.approval.id, {
            decision: 'allow',
            mode: 'both',
            payload: {
              updatedInput: {
                selected: choice,
              },
            },
          });
        } else {
          const normalized = choice.trim().toLowerCase();
          const decision =
            normalized.startsWith('y') ||
            normalized === 'allow' ||
            normalized === 'approve'
              ? 'allow'
              : 'deny';
          await decideApproval(item.approval.id, { decision, mode: 'both' });
        }
      } else {
        // Handle terminal input via send_input
        const response = buildResponse(item.action, choice, false);
        await sendCommand(item.sessionId, {
          type: 'send_input',
          payload: {
            text: response,
            enter: true,
          },
        });
      }

      setSuccess(true);
      setTimeout(() => {
        onDismiss(item.id);
        onResponseSent?.();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response');
    } finally {
      setLoading(false);
    }
  }, [item, mode, onDismiss, onResponseSent]);

  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim()) return;
    handleSendResponse(textInput.trim());
  }, [textInput, handleSendResponse]);

  const renderYesNoButtons = (
    yesLabel: string,
    noLabel: string,
    yesValue: string,
    noValue: string
  ) => (
    <div className="flex gap-2">
      <Button
        size="sm"
        className="flex-1 bg-green-600 hover:bg-green-700"
        onClick={() => handleSendResponse(yesValue)}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
        {yesLabel}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        className="flex-1"
        onClick={() => handleSendResponse(noValue)}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />}
        {noLabel}
      </Button>
    </div>
  );

  const getActionIcon = () => {
    if (!item.action) return <AlertCircle className="h-4 w-4 text-muted-foreground" />;

    switch (item.action.type) {
      case 'yes_no':
        return <MessageSquare className="h-4 w-4 text-blue-500" />;
      case 'multi_choice':
        return <MessageSquare className="h-4 w-4 text-purple-500" />;
      case 'text_input':
        return <MessageSquare className="h-4 w-4 text-green-500" />;
      case 'plan_review':
        return <MessageSquare className="h-4 w-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
    }
  };

  const getStatusBadge = () => {
    let status = item.sessionStatus;

    if (mode === 'waiting') {
      status = 'WAITING';
    }

    // Override status based on detected action type
    // If agent shows RUNNING but we detected an action that requires input, show WAITING FOR INPUT
    if (mode === 'action' && item.action && status === 'RUNNING') {
      if (item.source === 'approval') {
        status = 'WAITING_FOR_APPROVAL';
      } else {
        const actionRequiresInput = ['yes_no', 'multi_choice', 'text_input', 'plan_review'].includes(
          item.action.type
        );
        if (actionRequiresInput) {
          status = 'WAITING_FOR_INPUT';
        }
      }
    }

    const variant =
      mode === 'waiting' ? 'secondary' :
      status === 'ERROR' ? 'error' :
      status === 'RUNNING' ? 'running' :
      status.startsWith('WAITING') ? 'approval' :
      'secondary';

    return (
      <Badge variant={variant as 'error' | 'running' | 'approval' | 'secondary'} className="text-xs">
        {status.replace(/_/g, ' ')}
      </Badge>
    );
  };

  const renderMultiChoiceButtons = (
    options: NonNullable<DetectedAction['options']>,
    allowCustom?: boolean
  ) => (
    <div className="flex flex-col gap-2 mt-3">
      <div className="flex flex-wrap gap-2">
        {options.slice(0, 5).map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="outline"
            onClick={() => handleSendResponse(option.value)}
            disabled={loading}
            className="text-xs"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {option.value}. {option.label.slice(0, 20)}
            {option.label.length > 20 ? '...' : ''}
          </Button>
        ))}
      </div>
      {allowCustom && (
        <div className="flex gap-2">
          <Input
            value={customChoice}
            onChange={(e) => setCustomChoice(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && customChoice.trim() && handleSendResponse(customChoice.trim())
            }
            placeholder="Other..."
            className="flex-1 h-8 text-sm"
            disabled={loading}
          />
          <Button
            size="sm"
            onClick={() => customChoice.trim() && handleSendResponse(customChoice.trim())}
            disabled={loading || !customChoice.trim()}
            className="h-8 gap-1"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send
          </Button>
        </div>
      )}
    </div>
  );

  const renderWaitingActions = () => {
    if (success) return null;
    if (item.action?.type === 'multi_choice' && item.action.options?.length) {
      return (
        <div className="flex flex-col gap-2 mt-3">
          {renderMultiChoiceButtons(item.action.options, item.action.allowCustom)}
          {renderTerminalShortcut()}
        </div>
      );
    }
    if (item.action?.type === 'yes_no' && item.action.options?.length === 2) {
      const normalizedOptions = item.action.options.map((option) => ({
        ...option,
        normalized: option.value.toLowerCase(),
      }));
      const yesOption =
        normalizedOptions.find((option) =>
          ['y', 'yes', 'allow', 'approve'].includes(option.normalized)
        ) || normalizedOptions[0];
      const noOption =
        normalizedOptions.find((option) =>
          ['n', 'no', 'deny', 'reject'].includes(option.normalized)
        ) || normalizedOptions[1];
      return (
        <div className="flex flex-col gap-2 mt-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => handleSendResponse(yesOption.value)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {yesOption.label}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => handleSendResponse(noOption.value)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {noOption.label}
            </Button>
          </div>
          {renderTerminalShortcut()}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2 mt-3">
        {quickResponseMode ? (
          <div className="flex gap-2">
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSubmit();
                if (e.key === 'Escape') setQuickResponseMode(false);
              }}
              placeholder="Send a message..."
              className="flex-1 h-8 text-sm"
              disabled={loading}
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleTextSubmit}
              disabled={loading || !textInput.trim()}
              className="h-8 gap-1"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setQuickResponseMode(false)}
              className="h-8"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1"
            onClick={() => setQuickResponseMode(true)}
          >
            <Send className="h-3 w-3" />
            Send Message
          </Button>
        )}
        {renderTerminalShortcut()}
      </div>
    );
  };

  const renderQuickActions = () => {
    if (mode === 'waiting') {
      return renderWaitingActions();
    }
    if (!item.action || success) return null;

    const { type, options, placeholder } = item.action;

    // Plan review: Navigate to terminal view
    // Check both action.type AND item.approvalType since approval-source items
    // may have action.type='yes_no' while approvalType='plan_review'
    if (type === 'plan_review' || item.approvalType === 'plan_review') {
      const yesLabel = item.source === 'approval' ? 'Approve' : 'Yes';
      const noLabel = item.source === 'approval' ? 'Reject' : 'No';
      const yesValue = item.source === 'approval' ? 'allow' : 'y';
      const noValue = item.source === 'approval' ? 'deny' : 'n';

      return (
        <div className="flex flex-col gap-2 mt-3">
          {renderTerminalShortcut('Review Plan in Terminal')}
          {renderYesNoButtons(yesLabel, noLabel, yesValue, noValue)}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1"
              onClick={() => onIdle?.(item.sessionId)}
            >
              <Moon className="h-3 w-3" />
              Mark Idle
            </Button>
            <Link href={`/sessions/${item.sessionId}`} className="flex-1">
              <Button size="sm" variant="outline" className="w-full gap-1">
                <ExternalLink className="h-3 w-3" />
                Go to Stream
              </Button>
            </Link>
          </div>
        </div>
      );
    }

    // Yes/No buttons
    if (type === 'yes_no') {
      // If session is WAITING_FOR_APPROVAL but we don't have approval data,
      // show "Review in Terminal" instead of yes/no buttons since sending
      // terminal input won't work - the agent needs an approval decision
      const isWaitingForApproval = item.sessionStatus === 'WAITING_FOR_APPROVAL';
      const hasApprovalData = item.source === 'approval' && item.approval;

      if (isWaitingForApproval && !hasApprovalData) {
        return (
          <div className="flex flex-col gap-2 mt-3">
            {renderTerminalShortcut('Review in Terminal')}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1"
                onClick={() => onIdle?.(item.sessionId)}
              >
                <Moon className="h-3 w-3" />
                Mark Idle
              </Button>
            </div>
          </div>
        );
      }

      const normalizedOptions = options?.map((option) => ({
        ...option,
        normalized: option.value.toLowerCase(),
      })) || [];
      const yesOption =
        normalizedOptions.find((option) =>
          ['y', 'yes', 'allow', 'approve'].includes(option.normalized)
        ) || normalizedOptions[0];
      const noOption =
        normalizedOptions.find((option) =>
          ['n', 'no', 'deny', 'reject'].includes(option.normalized)
        ) || normalizedOptions[1];

      const yesLabel = yesOption?.label || (item.source === 'approval' ? 'Allow' : 'Yes');
      const noLabel = noOption?.label || (item.source === 'approval' ? 'Deny' : 'No');
      const yesValue = yesOption?.value || (item.source === 'approval' ? 'allow' : 'y');
      const noValue = noOption?.value || (item.source === 'approval' ? 'deny' : 'n');

      // For approval items without context, add a Review in Terminal link
      const hasNoContext = item.source === 'approval' && !preview;

      return (
        <div className="flex flex-col gap-2 mt-3">
          {hasNoContext && (
            renderTerminalShortcut('Review in Terminal')
          )}
          {renderYesNoButtons(yesLabel, noLabel, yesValue, noValue)}
          {!hasNoContext && renderTerminalShortcut()}
          {hasNoContext && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1"
                onClick={() => onIdle?.(item.sessionId)}
              >
                <Moon className="h-3 w-3" />
                Mark Idle
              </Button>
              <Link href={`/sessions/${item.sessionId}`} className="flex-1">
                <Button size="sm" variant="outline" className="w-full gap-1">
                  <ExternalLink className="h-3 w-3" />
                  Go to Stream
                </Button>
              </Link>
            </div>
          )}
        </div>
      );
    }

    // Multi-choice buttons
    if (type === 'multi_choice' && options) {
      return (
        <div className="flex flex-col gap-2 mt-3">
          {renderMultiChoiceButtons(options, item.action.allowCustom)}
          {renderTerminalShortcut()}
        </div>
      );
    }

    // Text input - direct input field
    if (type === 'text_input') {
      return (
        <div className="flex flex-col gap-2 mt-3">
          <div className="flex gap-2">
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
              placeholder={placeholder || 'Type your response...'}
              className="flex-1 h-8 text-sm"
              disabled={loading}
            />
            <Button
              size="sm"
              onClick={handleTextSubmit}
              disabled={loading || !textInput.trim()}
              className="h-8 gap-1"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send
            </Button>
          </div>
          {renderTerminalShortcut()}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1"
              onClick={() => onIdle?.(item.sessionId)}
            >
              <Moon className="h-3 w-3" />
              Mark Idle
            </Button>
            <Link href={`/sessions/${item.sessionId}`} className="flex-1">
              <Button size="sm" variant="outline" className="w-full gap-1">
                <ExternalLink className="h-3 w-3" />
                Go to Stream
              </Button>
            </Link>
          </div>
        </div>
      );
    }

    // Error or needs_attention - three action layout with quick response option
    return (
      <div className="flex flex-col gap-2 mt-3">
        {quickResponseMode ? (
          <div className="flex gap-2">
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSubmit();
                if (e.key === 'Escape') setQuickResponseMode(false);
              }}
              placeholder="Quick response..."
              className="flex-1 h-8 text-sm"
              disabled={loading}
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleTextSubmit}
              disabled={loading || !textInput.trim()}
              className="h-8 gap-1"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setQuickResponseMode(false)}
              className="h-8"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1"
            onClick={() => setQuickResponseMode(true)}
          >
            <Send className="h-3 w-3" />
            Quick Response
          </Button>
        )}
        {renderTerminalShortcut()}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1"
            onClick={() => onIdle?.(item.sessionId)}
          >
            <Moon className="h-3 w-3" />
            Mark Idle
          </Button>
          <Link href={`/sessions/${item.sessionId}`} className="flex-1">
            <Button size="sm" variant="outline" className="w-full gap-1">
              <ExternalLink className="h-3 w-3" />
              Go to Stream
            </Button>
          </Link>
        </div>
      </div>
    );
  };

  return (
    <Card className={cn(
      'relative transition-all',
      success && 'opacity-50',
      item.action?.type === 'error' && 'border-red-500/50',
      item.idledAt && 'opacity-60 border-dashed'
    )}>
      <CardContent className="p-3">
        {/* Header */}
        <div className="flex items-start gap-2">
          {/* Provider icon */}
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-bold">
            {getProviderIcon(item.sessionProvider || 'unknown')}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title + Status */}
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm truncate">
                {item.sessionTitle || item.sessionCwd?.split('/').pop() || 'Session'}
              </span>
              {getStatusBadge()}
            </div>

            {/* Question/Action */}
            {item.action && (
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                {getActionIcon()}
                <span className="line-clamp-2">
                  {item.action.question || 'Action required'}
                </span>
              </div>
            )}

            {/* Approval context - show what's being requested */}
            {item.source === 'approval' && item.approval?.requested_payload && (
              <ApprovalContext payload={item.approval.requested_payload as Record<string, unknown>} />
            )}

            {/* Terminal preview */}
            {previewLines && (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Terminal Preview
                </div>
                <div
                  ref={previewRef}
                  className="mt-1 rounded border bg-muted/40 px-2 py-1.5 text-xs font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto overflow-x-hidden"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {previewLines}
                </div>
              </div>
            )}

            {/* AI Summary - visible for all items */}
            {showSummary && item.action && (
              <div className="mt-2 text-xs">
                <div className="flex items-start gap-1.5 text-muted-foreground min-h-[18px]">
                  {item.summaryLoading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Generating summary...</span>
                    </>
                  ) : item.summary ? (
                    <>
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-purple-500" />
                      <p className="leading-relaxed">{item.summary}</p>
                    </>
                  ) : item.summaryFailed ? (
                    <>
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="italic">Summary unavailable</span>
                    </>
                  ) : !hasSummaryContext ? (
                    <>
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="italic">No terminal context captured</span>
                    </>
                  ) : summariesEnabled ? (
                    <>
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-purple-500" />
                      <span className="italic">Summary pending...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-purple-500" />
                      <span className="italic">AI summary unavailable</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Quick actions */}
            {renderQuickActions()}

            {/* Error message */}
            {error && (
              <p className="text-xs text-destructive mt-2">{error}</p>
            )}

            {/* Success indicator */}
            {success && (
              <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Response sent
              </p>
            )}
          </div>

          {/* Action buttons */}
          {showItemActions && (
            <div className="flex flex-col gap-1 shrink-0">
              {/* Idle/Unidle button */}
              {item.idledAt ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onUnidle?.(item.sessionId)}
                  title="Bring back"
                >
                  <Sun className="h-3 w-3" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onIdle?.(item.sessionId)}
                  title="Mark idle"
                >
                  <Moon className="h-3 w-3" />
                </Button>
              )}
              {/* Dismiss button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onDismiss(item.id)}
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
