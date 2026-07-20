# FW4-SURFACES — Correction round R2 (Wave 4)

Lane: FW4-SURFACES (attempt 2) · Same worktree/branch/firewall. Your `9cf7bef` is integrated; reviewer returned SHIP-WITH-NOTES with these items assigned here. Fix only these three.

1. **Ctrl+K must not fire in editable/terminal targets** (`src/components/search/CommandPalette.tsx` ~149-155): the editable-target guard applies only to `/`, so Ctrl+K while typing in the terminal BOTH sends readline kill-line (`\x0b`) to the PTY and opens the palette. Exempt `ctrlKey`-based activation when `isEditableTarget(event.target)` (xterm's helper is a TEXTAREA); keep ⌘K (metaKey) global on mac. Test: synthetic Ctrl+K on a textarea target does not open the palette; ⌘K does.
2. **Zero the rotated token on dialog close** (`app/(dashboard)/hosts/page.tsx` ~420-453): call `rotateMutation.reset()` (and the create mutation equivalent if applicable) when the one-time enrollment dialog closes, so the token doesn't linger in the JS heap.
3. **Derive ws/wss from the control-plane scheme** (`src/lib/hostEnrollment.ts` ~101-108): the generated agentd config hard-forces `wss:`; derive `ws:`/`wss:` from the resolved base URL scheme so non-TLS/localhost setups get a correct config. Test.

Gates as before (full TS chain). Commit prefix `fix(surfaces):`. Update handoff (attempt: 2, new frozen_sha, R2 section), then print exactly:

`FW4-SURFACES-R2 FROZEN <full-sha>`
