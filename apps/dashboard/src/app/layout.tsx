import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Agent Commander',
  description: 'Mission control for AI agent sessions',
};

const runtimeConfig = {
  controlPlaneUrl:
    process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
    process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ||
    process.env.CONTROL_PLANE_URL ||
    process.env.CONTROL_PLANE_BASE_URL ||
    '',
  controlPlaneWsUrl:
    process.env.NEXT_PUBLIC_CONTROL_PLANE_WS_URL ||
    process.env.CONTROL_PLANE_WS_URL ||
    '',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="runtime-config"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.__AC_RUNTIME__=${JSON.stringify(runtimeConfig)};`,
          }}
        />
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
(() => {
  try {
    const stored = localStorage.getItem('theme-storage');
    if (!stored) return;
    const parsed = JSON.parse(stored);
    const theme = (parsed && parsed.state && parsed.state.theme) || 'system';
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  } catch (e) {}
})();
            `,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
