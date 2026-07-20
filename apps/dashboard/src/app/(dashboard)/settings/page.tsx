import { Settings } from 'lucide-react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { UsageOverview } from './UsageOverview';

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <header className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure alerts, session defaults, and workspace preferences.
          </p>
        </div>
      </header>
      <UsageOverview />
      <SettingsPanel />
    </div>
  );
}
