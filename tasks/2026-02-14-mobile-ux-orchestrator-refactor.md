# Agent Command — Mobile UX & Orchestrator Refactor

**Date:** 2026-02-14
**Status:** Implemented

---

## Changes Implemented

### Change 1: Fix Orchestrator Item Visibility

**Files modified:**
- `apps/dashboard/src/stores/orchestrator.ts` — Added status-source check to `isActionableItem()` so sessions in `WAITING_FOR_INPUT`/`WAITING_FOR_APPROVAL`/`ERROR` are treated as actionable
- `apps/dashboard/src/components/orchestrator/OrchestratorButton.tsx` — Added snapshot WS subscription + `snapshots.updated` handler for background monitoring
- `apps/dashboard/src/app/(dashboard)/orchestrator/OrchestratorPageClient.tsx` — Added waiting items section after active items
- `apps/dashboard/src/components/orchestrator/OrchestratorModal.tsx` — Added waiting items section after active items

### Change 2: Terminal Maximize/Fullscreen Toggle

**Files modified:**
- `apps/dashboard/src/app/(dashboard)/sessions/[id]/page.tsx` — Added `maximized` state, Maximize2/Minimize2 toggle button, fixed fullscreen overlay at z-[60], Escape key handler

### Change 3: Fix Mobile Terminal Touch Scrolling

**Files modified:**
- `apps/dashboard/src/components/TerminalView.tsx` — Replaced `touch-pan-y` with conditional `touch-none` on mobile, always `preventDefault` on vertical touchmove, added momentum scrolling with deceleration
- `apps/dashboard/src/app/globals.css` — Removed `touch-action: pan-y` from `.xterm .xterm-viewport`, set `touch-action: none` in mobile media query

---

## Follow-Up Improvements

- `apps/dashboard/src/app/(dashboard)/sessions/[id]/page.tsx` — Lock body/html scroll while terminal is fullscreen to prevent background scroll/bounce.
- `apps/dashboard/src/components/orchestrator/OrchestratorButton.tsx` — Disable header WebSocket subscription while the orchestrator modal is open to avoid duplicate ingestion.
- `apps/dashboard/src/components/TerminalView.tsx` — Axis-lock touch gestures and use measured xterm row height for smoother mobile scrolling (no initial jump when axis is decided).
