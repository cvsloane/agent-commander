import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_CENTER_SHELL_BREAKPOINT,
  NAV_MOBILE_BREAKPOINT,
} from '@/hooks/useIsMobile';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Command Center shell contracts', () => {
  it('locks navigation and internal shell breakpoints', () => {
    expect(NAV_MOBILE_BREAKPOINT).toBe(768);
    expect(COMMAND_CENTER_SHELL_BREAKPOINT).toBe(1024);
  });

  it('keeps legacy duplicate surfaces deleted', () => {
    expect(existsSync(resolve(dashboardRoot, 'src/components/SpawnSessionDialog.tsx'))).toBe(false);
    expect(existsSync(resolve(dashboardRoot, 'src/components/orchestrator/OrchestratorModal.tsx'))).toBe(false);
    expect(existsSync(resolve(dashboardRoot, 'src/app/(dashboard)/orchestrator/OrchestratorPageClient.tsx'))).toBe(false);

    const rootPage = readFileSync(resolve(dashboardRoot, 'src/app/(dashboard)/page.tsx'), 'utf8');
    expect(rootPage).toContain('Command Center');
    expect(rootPage).not.toContain('New in v0.2.0');
  });

  it('starts the installed PWA at the Command Center', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(dashboardRoot, 'public/manifest.json'), 'utf8')
    ) as { start_url?: string };

    expect(manifest.start_url).toBe('/');
  });
});
