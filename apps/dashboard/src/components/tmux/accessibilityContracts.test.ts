import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function source(relativePath: string): string {
  return readFileSync(resolve(dashboardRoot, relativePath), 'utf8');
}

describe('Command Center accessibility contracts', () => {
  it('exposes the roster hierarchy and expansion/selection state', () => {
    expect(source('src/components/tmux/TmuxRoster.tsx')).toContain('role="tree"');

    for (const row of ['TmuxClusterRow.tsx', 'TmuxOrchestratorRow.tsx']) {
      const rowSource = source(`src/components/tmux/${row}`);
      expect(rowSource).toContain('role="treeitem"');
      expect(rowSource).toContain('aria-expanded={expanded}');
      expect(rowSource).toContain('aria-selected={active}');
      expect(rowSource).toContain('role="group"');
    }

    for (const row of ['TmuxWindowRow.tsx', 'TmuxPaneRow.tsx']) {
      const rowSource = source(`src/components/tmux/${row}`);
      expect(rowSource).toContain('role="treeitem"');
      expect(rowSource).toContain('aria-selected=');
    }
  });

  it('keeps desktop window and terminal rail controls named and keyboard operable', () => {
    const windowStrip = source('src/components/tmux/TmuxWindowStrip.tsx');
    expect(windowStrip).toContain('role="tablist"');
    expect(windowStrip).toContain('role="tab"');
    expect(windowStrip).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(windowStrip).toContain('aria-label="New tmux window"');

    const keyRail = source('src/components/mobile/TerminalKeyRail.tsx');
    expect(keyRail).toContain('role="toolbar"');
    expect(keyRail).toContain('aria-label="Terminal key rail"');
    expect(keyRail).toContain('aria-pressed={isCtrl ? ctrlActive : undefined}');
  });

  it('routes mobile sheets through the focus-trapping dialog primitive', () => {
    const sheetPrimitive = source('src/components/ui/sheet.tsx');
    expect(sheetPrimitive).toContain('<SheetPrimitive.Content');
    expect(sheetPrimitive).toContain('aria-label="Close sheet"');

    for (const sheet of [
      'src/components/launch/MobileLaunchSheet.tsx',
      'src/components/tmux/TmuxActionSheet.tsx',
    ]) {
      expect(source(sheet)).toContain('<SheetContent');
    }
  });

  it('retains reduced-motion and keyboard-safe bottom-control contracts', () => {
    const styles = source('src/app/globals.css');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).not.toContain("html[data-virtual-keyboard-open='true'] [data-terminal-key-controls]");
    expect(styles).toContain('env(keyboard-inset-height, 0px)');

    expect(source('src/components/terminal/TerminalSearch.tsx')).toContain(
      'bottom-[var(--keyboard-inset-height,0px)]'
    );
    expect(source('src/components/tmux/PromptComposer.tsx')).toContain(
      'data-terminal-bottom-controls'
    );
  });

  it('keeps Android clipboard reads and a manual paste fallback available', () => {
    const virtualKeyboard = source('src/components/mobile/VirtualKeyboard.tsx');
    expect(virtualKeyboard).toContain('navigator.clipboard.readText()');
    expect(virtualKeyboard).toContain('window.prompt(');
    expect(virtualKeyboard).not.toContain('Tap and hold to paste');

    const terminalClipboard = source('src/hooks/useTerminalClipboard.ts');
    expect(terminalClipboard).toContain('await readFromClipboard()');
    expect(terminalClipboard).toContain('window.prompt(');
  });
});
