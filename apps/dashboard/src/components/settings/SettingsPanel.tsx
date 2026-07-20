'use client';

import { cn } from '@/lib/utils';
import { AlertsPanel } from './AlertsPanel';
import { LaunchPanel } from './LaunchPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { SessionDefaultsPanel } from './SessionDefaultsPanel';
import { UsagePanel } from './UsagePanel';
import { WorkspacePanel } from './WorkspacePanel';

interface SettingsPanelProps {
  className?: string;
}

export function SettingsPanel({ className }: SettingsPanelProps) {
  return (
    <div className={cn('space-y-8', className)}>
      <WorkspacePanel />
      <NotificationsPanel />
      <AlertsPanel />
      <UsagePanel />
      <SessionDefaultsPanel />
      <LaunchPanel />
    </div>
  );
}
