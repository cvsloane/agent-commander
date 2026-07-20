# Wave 4 Fleet UI Brief

## Context

- User: a single operator supervising orchestrators and workers from desktop or phone.
- Routes: `/orchestrator`, `/tmux`, `/automation`, and the global dashboard shell.
- Primary workflow: find waiting work, understand its owning orchestrator, respond without entering a terminal, then attach only when deeper intervention is needed.
- Primary actions: send a prompt, approve/deny, open a terminal, wake/nudge automation.
- Device contexts: 360–430px phone, 768px tablet, and 1366px+ desktop.
- Existing system: Tailwind semantic tokens, Radix primitives, compact operational cards, and tmux accordion rows.

## Hierarchy

1. Waiting/error state and the owning orchestrator.
2. Child sessions, in-process tasks, latest structured report, and current budget.
3. tmux window/pane detail, automation policy detail, and administrative forms.

## Layout

- Keep the desktop sidebar; add fixed mobile tabs for tmux, Orchestrator, Sessions, and More.
- Use compact expandable rows in `/tmux`; orchestrator edges supersede tmux-window grouping.
- Use one coherent orchestrator card per lead session with its tree, report, approvals, prompt, and attach action.
- Move automation creation/wake/work/nudge forms into right-side sheets and make tabs URL-addressable.

## States

- Loading: stable skeleton/spinner regions with labels.
- Empty: explain that no orchestrators, panes, approvals, or automation records exist.
- Error/partial: preserve successful data and identify the unavailable source.
- Success: inline sent/approved feedback without layout shift.
- Disabled: explain inactive runtimes/terminal sessions via nearby status text.
- Permission errors: surface API error text in the action region.

## Verification

- Unit-test fleet grouping, cross-host separation/sorting, and attention ownership.
- Run dashboard test/typecheck/lint and dashboard smoke gate.
- Browser-check 390x844, 768x1024, and desktop layouts; verify keyboard focus, overflow, 44px mobile targets, and safe-area padding.
