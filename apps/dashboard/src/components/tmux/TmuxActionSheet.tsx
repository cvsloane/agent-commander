'use client';

import type { MutableRefObject } from 'react';
import Link from 'next/link';
import {
  Clipboard,
  Plus,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Files,
  Focus,
  Moon,
  Plug,
  Power,
  Send,
  Shield,
  Sun,
  Unplug,
  X,
} from 'lucide-react';
import type { Session } from '@agent-command/schema';
import type { TerminalController } from '@/components/TerminalView';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { getSessionDisplayName } from '@/lib/utils';
import { TmuxPaneControls } from './TmuxPaneControls';

interface TmuxActionSheetProps {
  open: boolean;
  session?: Session | null;
  terminalControllerRef: MutableRefObject<TerminalController | null>;
  idlePending: boolean;
  terminating: boolean;
  onClose: () => void;
  onDetach?: () => void;
  onIdleToggle: () => void;
  onSendTo: () => void;
  onOpenMcp: () => void;
  onTerminate: () => void;
  onLaunchWindowHere?: () => void;
  onSelectSession: (sessionId: string) => void | boolean | Promise<boolean>;
  onSetPaneFocus?: (focused: boolean) => boolean | Promise<boolean>;
}

export function TmuxActionSheet({
  open,
  session,
  terminalControllerRef,
  idlePending,
  terminating,
  onClose,
  onDetach,
  onIdleToggle,
  onSendTo,
  onOpenMcp,
  onTerminate,
  onLaunchWindowHere,
  onSelectSession,
  onSetPaneFocus,
}: TmuxActionSheetProps) {
  const title = session ? getSessionDisplayName(session) : 'No pane selected';

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="bottom"
        hideClose
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-xl p-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <SheetTitle className="text-sm font-semibold">Pane actions</SheetTitle>
            <SheetDescription className="truncate text-xs">{title}</SheetDescription>
          </div>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={onClose} aria-label="Close actions">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-2 px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => terminalControllerRef.current?.attach()}
            >
              <Plug className="h-4 w-4" />
              Attach
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => onDetach ? onDetach() : terminalControllerRef.current?.detach()}
            >
              <Unplug className="h-4 w-4" />
              Detach
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => terminalControllerRef.current?.takeControl()}
            >
              <Shield className="h-4 w-4" />
              Take Control
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => terminalControllerRef.current?.focus()}
            >
              <Focus className="h-4 w-4" />
              Focus
            </Button>
          </div>

          {session && (
            <TmuxPaneControls
              session={session}
              variant="sheet"
              onSelectSession={onSelectSession}
              onSetPaneFocus={onSetPaneFocus}
            />
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => terminalControllerRef.current?.copySelection()}
            >
              <Copy className="h-4 w-4" />
              Copy selection
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => terminalControllerRef.current?.copyLastLines(50)}
            >
              <Clipboard className="h-4 w-4" />
              Copy last 50
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => terminalControllerRef.current?.copyAll()}
            >
              <Files className="h-4 w-4" />
              Copy all
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={!session}
              onClick={() => terminalControllerRef.current?.paste()}
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste
            </Button>
          </div>

          <Button
            variant="outline"
            className="justify-start gap-2"
            disabled={!session || idlePending}
            onClick={onIdleToggle}
          >
            {session?.idled_at ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {session?.idled_at ? 'Wake pane' : 'Mark pane idle'}
          </Button>
          <Button
            variant="outline"
            className="justify-start gap-2"
            disabled={!session}
            onClick={onSendTo}
          >
            <Send className="h-4 w-4" />
            Send to another session
          </Button>
          <Button
            variant="outline"
            className="justify-start gap-2"
            disabled={!session}
            onClick={onOpenMcp}
          >
            <Plug className="h-4 w-4" />
            Open MCP tools
          </Button>
          <Button asChild variant="outline" className="justify-start gap-2" disabled={!session}>
            <Link href={session ? `/sessions/${session.id}` : '#'}>
              <ExternalLink className="h-4 w-4" />
              Open full session page
            </Link>
          </Button>
        </div>

        <div className="border-t px-4 py-4">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive"
            disabled={!session || terminating}
            onClick={onTerminate}
          >
            <Power className="h-4 w-4" />
            Kill pane
          </Button>
          {onLaunchWindowHere && (
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={!session}
              onClick={onLaunchWindowHere}
            >
              <Plus className="h-4 w-4" />
              New window here
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
