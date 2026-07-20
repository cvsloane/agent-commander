'use client';

import { useState } from 'react';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { decideApproval, decideGovernanceApproval } from '@/lib/api';
import type { OrchestratorItem } from '@/stores/orchestrator';

interface InlineApprovalProps {
  item: OrchestratorItem;
  onDecided: () => void;
}

export function InlineApproval({ item, onDecided }: InlineApprovalProps) {
  const [pendingDecision, setPendingDecision] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (item.source !== 'approval' && item.source !== 'governance') return null;

  const decide = async (decision: 'approve' | 'deny') => {
    setPendingDecision(decision);
    setError(null);
    try {
      if (item.source === 'governance' && item.governanceApproval) {
        await decideGovernanceApproval(item.governanceApproval.id, {
          decision: decision === 'approve' ? 'approved' : 'denied',
        });
      } else if (item.approval) {
        await decideApproval(item.approval.id, {
          decision: decision === 'approve' ? 'allow' : 'deny',
          mode: 'both',
        });
      } else {
        throw new Error('Approval details are unavailable.');
      }
      onDecided();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not decide approval');
    } finally {
      setPendingDecision(null);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {item.action?.question || (item.source === 'governance' ? 'Governance approval' : 'Provider approval')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.source === 'governance' ? 'Automation governance' : 'Agent tool request'}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="mobile-sm"
          onClick={() => void decide('approve')}
          disabled={pendingDecision !== null}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
        >
          {pendingDecision === 'approve'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Check className="h-4 w-4" />}
          Approve
        </Button>
        <Button
          size="mobile-sm"
          variant="outline"
          onClick={() => void decide('deny')}
          disabled={pendingDecision !== null}
          className="gap-1.5"
        >
          {pendingDecision === 'deny'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <X className="h-4 w-4" />}
          Deny
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
