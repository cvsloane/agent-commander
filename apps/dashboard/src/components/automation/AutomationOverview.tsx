import { Plus, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AutomationOverviewProps {
  metrics: Array<{ label: string; value: number }>;
  onCreateAgent: () => void;
  onWakeAgent: () => void;
  onCreateWork: () => void;
}

export function AutomationOverview({
  metrics,
  onCreateAgent,
  onWakeAgent,
  onCreateWork,
}: AutomationOverviewProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p className="text-2xl font-bold">{metric.value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Automation actions">
        <Button size="mobile-sm" onClick={onWakeAgent} className="shrink-0 gap-1.5">
          <Sparkles className="h-4 w-4" /> Wake agent
        </Button>
        <Button size="mobile-sm" variant="outline" onClick={onCreateWork} className="shrink-0 gap-1.5">
          <Send className="h-4 w-4" /> New work item
        </Button>
        <Button size="mobile-sm" variant="outline" onClick={onCreateAgent} className="shrink-0 gap-1.5">
          <Plus className="h-4 w-4" /> New agent
        </Button>
      </div>
    </div>
  );
}
