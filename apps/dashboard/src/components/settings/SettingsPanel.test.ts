import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/pwa/PushNotificationsCard', () => ({
  PushNotificationsCard: () => createElement('div', { 'data-testid': 'push-notifications' }),
}));

describe('SettingsPanel', () => {
  it('renders every settings domain through the route shell', async () => {
    const { SettingsPanel } = await import('./SettingsPanel');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(SettingsPanel)
      )
    );

    for (const heading of [
      'Workspace',
      'Notifications',
      'Alerts',
      'Usage',
      'Session defaults',
      'Launch',
    ]) {
      expect(markup).toContain(heading);
    }
  });
});
