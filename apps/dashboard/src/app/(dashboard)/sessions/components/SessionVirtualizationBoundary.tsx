import type { ReactNode } from 'react';

export function SessionVirtualizationBoundary({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  return (
    <div
      className="min-w-0"
      style={
        enabled
          ? {
              contentVisibility: 'auto',
              containIntrinsicSize: '380px',
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
