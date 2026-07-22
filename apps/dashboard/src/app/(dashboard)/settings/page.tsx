import { Download, Settings, Smartphone } from 'lucide-react';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { UsageOverview } from './UsageOverview';

export const dynamic = 'force-dynamic';

const APK_FILENAME = 'agent-command-android.apk';
const APK_PATH = path.resolve(process.cwd(), '..', '..', 'android-distribution', APK_FILENAME);

function getAndroidApkMeta() {
  if (!existsSync(APK_PATH)) return null;
  const apkStat = statSync(APK_PATH);
  return {
    size: `${(apkStat.size / (1024 * 1024)).toFixed(1)} MB`,
    updated: new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(apkStat.mtime),
  };
}

export default function SettingsPage() {
  const apk = getAndroidApkMeta();
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
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-labelledby="android-app-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 id="android-app-title" className="font-semibold">Agent Command for Android</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Install the private native terminal app, then sign in with the same Agent Command endpoint and access code.
              </p>
              {apk ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Signed APK · {apk.size} · Updated {apk.updated}
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-500">
                  The Android APK is not currently published on this server.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                GPLv3 source and build instructions are available in the{' '}
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href="https://github.com/cvsloane/agent-commander/tree/5071e128ce9822fbeae24bc54fd6187ebffccb5b/apps/android"
                  rel="noreferrer"
                  target="_blank"
                >
                  Android source directory
                </a>.
              </p>
            </div>
          </div>
          {apk && (
            <a
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              href="/api/downloads/android-apk"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download APK
            </a>
          )}
        </div>
        {apk && (
          <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            On your Samsung phone, open this page, download the APK, approve installation from your browser if prompted, and open Agent Command. Android updates install over the existing app when signed by the same release key.
          </p>
        )}
      </section>
      <UsageOverview />
      <SettingsPanel />
    </div>
  );
}
