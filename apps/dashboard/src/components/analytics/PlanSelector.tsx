'use client';

import { Check } from 'lucide-react';
import { useUsageStore, PLAN_LIMITS, type PlanType } from '@/stores/usage';
import { cn } from '@/lib/utils';

interface PlanSelectorProps {
  onClose: () => void;
}

const PLAN_OPTIONS: Array<{ id: PlanType; tokens: string }> = [
  { id: 'free', tokens: '100K' },
  { id: 'pro', tokens: '1M' },
  { id: 'max', tokens: '5M' },
  { id: 'unlimited', tokens: 'Unlimited' },
];

export function PlanSelector({ onClose }: PlanSelectorProps) {
  const { plan, setPlan } = useUsageStore();

  const handleSelect = (planId: PlanType) => {
    setPlan(planId);
    onClose();
  };

  return (
    <div className="p-3 bg-muted/50 rounded-lg space-y-2">
      <p className="text-xs text-muted-foreground mb-2">
        Select your plan to track usage limits:
      </p>
      <div className="grid grid-cols-2 gap-2">
        {PLAN_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => handleSelect(option.id)}
            className={cn(
              'flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
              plan === option.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-background hover:bg-accent'
            )}
          >
            <div className="flex flex-col items-start">
              <span className="font-medium">{PLAN_LIMITS[option.id].description}</span>
              <span className="text-xs opacity-70">{option.tokens} tokens/week</span>
            </div>
            {plan === option.id && <Check className="h-4 w-4" />}
          </button>
        ))}
      </div>
    </div>
  );
}
