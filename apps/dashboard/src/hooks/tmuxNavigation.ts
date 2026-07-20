export interface AttachedTmuxSelection {
  sessionId: string;
  hostId?: string | null;
}

export function getAttachedTmuxSelectionUpdates({
  sessionId,
  hostId,
}: AttachedTmuxSelection): Record<string, string> {
  return {
    ...(hostId ? { host_id: hostId } : {}),
    session_id: sessionId,
    mode: 'terminal',
    attach: '1',
  };
}

export function buildAttachedTmuxHref(selection: AttachedTmuxSelection): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(getAttachedTmuxSelectionUpdates(selection))) {
    params.set(key, value);
  }
  return `/?${params.toString()}`;
}

export function shouldRestoreLastTmuxAttachment(search: string): boolean {
  return new URLSearchParams(search).size === 0;
}
