import { describe, expect, it, vi } from 'vitest';
import { createFailSoftSettingsSaver } from './settingsSyncFailSoft';

describe('createFailSoftSettingsSaver', () => {
  it('keeps local settings usable and reports a failed persist only once', async () => {
    const localSettings = { theme: 'dark', sidebarCollapsed: true };
    const persist = vi.fn().mockRejectedValue(new Error('settings endpoint unavailable'));
    const reportFailure = vi.fn();
    const save = createFailSoftSettingsSaver(persist, reportFailure);

    await expect(save(localSettings)).resolves.toBe(false);
    await expect(save(localSettings)).resolves.toBe(false);

    expect(localSettings).toEqual({ theme: 'dark', sidebarCollapsed: true });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  it('reports success without notifying', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const reportFailure = vi.fn();
    const save = createFailSoftSettingsSaver(persist, reportFailure);

    await expect(save({ theme: 'system' })).resolves.toBe(true);
    expect(reportFailure).not.toHaveBeenCalled();
  });
});
