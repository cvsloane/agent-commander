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

  it('keeps desktop window and key controls named and keyboard operable', () => {
    const windowStrip = source('src/components/tmux/TmuxWindowStrip.tsx');
    expect(windowStrip).toContain('role="tablist"');
    expect(windowStrip).toContain('role="tab"');
    expect(windowStrip).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(windowStrip).toContain('aria-label="New tmux window"');

    const keyBar = source('src/components/tmux/TmuxKeyBar.tsx');
    expect(keyBar).toContain('role="toolbar"');
    expect(keyBar).toContain('aria-label="tmux keyboard shortcuts"');
    expect(keyBar).toContain('aria-label={key.ariaLabel}');
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
    expect(styles).toContain("html[data-virtual-keyboard-open='true'] [data-terminal-key-controls]");

    expect(source('src/components/terminal/TerminalSearch.tsx')).toContain(
      'bottom-[var(--keyboard-inset-height,0px)]'
    );
    expect(source('src/components/tmux/PromptComposer.tsx')).toContain(
      'data-terminal-bottom-controls'
    );
  });
});
