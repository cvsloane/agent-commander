# Mobile tmux UX Program — Plan for Owner Assessment (2026-07-20)

Evidence: three-agent deep study at main `6e928a4` (v0.4.0) — element-by-element mobile terminal audit, tap-by-tap journey traces, known-issues + backlog inventory. Target device (owner facts, 2026-07-20): **Samsung Galaxy S25 Ultra, Brave browser (Chromium), thumb-only (no S Pen), single user**. All prior verification assumed iPhone 390×844 in headless Chromium; the actual target is ~412×915 with Android keyboard semantics and adb-debuggable.

## What the study found (condensed)

**Two structural root causes of "tmux is still challenged":**
1. **All tmux controls vanish while typing.** `html[data-virtual-keyboard-open] [data-terminal-key-controls] { display:none }` hides BOTH key strips the moment the OS keyboard rises — no Esc, Ctrl-C, arrows, or prefix exactly when interacting. Interrupting an agent mid-type = dismiss keyboard → tap → refocus.
2. **SIGWINCH churn + size clobbering.** Every visualViewport resize/scroll/keyboard animation sends a real tmux resize; full-screen TUIs repaint-storm; a phone attach shrinks the tmux window for the desktop client too (tmux sizes to smallest client).

**Owner-confirmed pain, quantified:** the terminal gets **~303px of 844 (≈22 rows at hard-coded 11px)** keyboard-closed — chrome is ~55% of the screen: app header + shell header + mode toggle + card header + window strip + toolbar + TWO always-on key strips (~112px, duplicated arrows) + composer. Keyboard-open: **~5–8 rows**. A plain SSH client gives ~50/~30. Enter and arrows are the LAST keys on an overflowing strip.

**Navigation friction:** in-app selection never carries `attach=1` (only server hrefs do) → every landing needs a manual Attach tap plus a dead "highlighted but not shown" state; cold open restores nothing (4 taps to last night's pane); **the window strip + Prev/Next mutate tmux but don't move the viewer** (the single most confusing trap); cross-host switch is 5 taps and blanks the terminal.

**Precision/content:** no way to begin a drag selection by touch; copy = "last 50 lines" or all; history pager hidden behind the Actions sheet; copy-mode is an exit trap; pane "directional" nav is fake (linear order); prefix hard-coded to C-b; paste path was written around iOS limits — likely fine on Brave/Android but unverified; read-only state is a bare amber dot.

## Prior art — what would make it BETTER (survey of web/mobile tmux implementations, 2024–2026)

Surveyed: Termius, Blink SmartKeys, Termux extra-keys, JuiceSSH, mosh, tmate, ttyd/GoTTY/wetty, sshx, **Zellij's first-party web client (0.43, 2025)**, Wave, Warp, VS Code terminal, WezTerm/kitty, xterm.js ecosystem, plus the 2025 agent-supervision wave (VibeTunnel, DagsHub tmux-mobile, webtmux, muxplex, Happy/Omnara). Full sourced report in the study output; validation: Zellij chose the same two-channel binary/control WS split we have; tmux-mobile independently arrived at per-viewer grouped sessions — which we already ship.

Mechanisms adopted into this plan (ranked value-for-effort):
1. **Server-side size pinning + letterboxed fixed grid** — pin the viewed window (`window-size manual` on our per-viewer grouped session), scale font to fit width; keyboard show/hide changes visible rows only, never SIGWINCHes. (→ M-D, upgrades decision 4)
2. **Termux-style user-definable key rows** — JSON-configured keys/chords/macros (e.g. a `y↵` approve key, `/compact`, prefix combos) with swipe-up popup layers. (→ M-B, upgrades decision 1)
3. **VirtualKeyboard API overlay mode** — `overlaysContent=true` + `env(keyboard-inset-height)` docks the rail in the keyboard inset; Chromium-only but that includes Brave/Android — your exact platform. visualViewport fallback kept. (→ M-B)
4. **Blink-style sticky/lockable modifiers with layer swap** — tap=one-shot, hold=chain, double-tap=lock Ctrl/Alt; active modifier swaps arrows→Home/End/PgUp/PgDn. (→ M-B)
5. **Termius long-press-drag arrow synthesis** — long-press enters cursor mode, drag emits accelerated arrow keys; double-tap word-select + copy-on-select in our own selection overlay (xterm.js touch is officially weak — replace, don't fight). (→ M-B/M-E)
6. **Scroll-freeze reading mode** — swipe-up freezes a snapshot while live output buffers behind a "N new lines" pill; no more viewport yanked mid-read. (→ M-E)
7. **Thumbnail pane switcher + agent-status badges** — bottom-sheet grid of live `capture-pane` snapshots (infra exists) badged waiting/running/idle; horizontal swipe on terminal = next/prev window. (→ M-C)
8. **Command marks + sticky command header** (VS Code/Warp, honest scope) — OSC 133 via tmux `allow-passthrough` for shell panes; for agent TUI panes (Claude Code emits no OSC 133 — open upstream requests) mark agent-turn boundaries heuristically; xterm decorations + prev/next jump on the rail. (→ M-E, second wave)
9. **Serialize-addon warm reattach** — buffer snapshot paints the pane in one frame on switch/resume instead of replay; makes pane switching feel native-instant. (→ M-C)
10. **Predictive local echo** (mosh, browser-proven by sshx) — deferred/optional: highest implementation risk, and agent supervision is read-heavy; revisit after MW2 if typing feel still lags.

Cheap extras adopted: keep OS voice-typing unobstructed (Termius markets exactly this for Claude workflows); haptic tick on rail keys (works on Android). Explicitly rejected for PWA: volume-key hacks, mosh UDP roaming (our WS resume tokens are the browser-native equivalent).

## Vision

**SSH-client density with agent superpowers.** On the S25 Ultra: ≥40 terminal rows keyboard-closed and ≥20 keyboard-open at a readable font; a single slim key rail that NEVER disappears (only what Android's keyboard can't provide: Esc, sticky-Ctrl, arrows, prefix, History); every navigation lands live in one tap; the grid stays stable while the keyboard animates; and the agent layer (composer, approve, badges) rides on top without stealing rows.

## Proposed decisions (owner approve/veto)

1. **One adaptive key rail, always visible.** Merge TmuxKeyBar + VirtualKeyboard into a single ~44px rail docked above the keyboard inset (visible with keyboard open — this alone fixes root cause 1). Contents: Esc · sticky-Ctrl (tap Ctrl then a letter = chord; enables Ctrl-C/D/Z/R/L…) · ↑↓←→ (long-press = Home/End/PgUp/PgDn) · Tab · prefix · History · Copy. Everything else (Shift-Tab, splits, zoom, copy-mode entry) moves to long-press or the Actions sheet. Rarely-used keys are gone from permanent chrome per your steering.
2. **Full-bleed terminal mode.** When attached on mobile: collapse app header + shell header + card header into ONE slim status row (session name · window · status dot · overflow menu); window strip becomes compact (28px) with auto-scroll-to-active; remove the fixed 604px card (fill the viewport, no under-the-fold overflow). Target ≥40 rows closed / ≥20 open.
3. **Readable, adjustable type.** Default mobile font 13px (from 11px hard-coded), settings slider 11–18px, pinch-to-zoom on the terminal surface. Owner picks default.
4. **Stable grid policy.** Resize tmux only on *settled* size changes (keyboard animation end, rotation) — never on visualViewport scroll; and a "phone never resizes tmux" option (letterbox + pan) so your phone stops shrinking the desktop's window. Proposed default: letterbox ON when a desktop client is attached, off otherwise.
5. **Attach-on-navigate everywhere.** In-app roster/recents/quick-switch/window-strip selections carry the same `attach=1` contract server hrefs use; **window strip re-targets the viewer** (select_window + selectSession together); cold open restores the last pane live (0 taps); cross-host switch keeps the old pane warm. Single-user ⇒ auto-attach default ON (closes the old A6 open question).
6. **Single-user simplifications (locked-in scope cuts).** Tenancy/per-user scoping: dropped. iOS-specific fallbacks: dropped. Full screen-reader pass: deprioritized. Multi-viewer stays read-only-default (it's you on phone+desktop) with the existing 1-tap Take Control.
7. **Verify on YOUR device, not a fiction.** Playwright device profile moves to 412×915 Android metrics; an on-device checklist (10 min, guided) runs on your S25 Ultra via Brave at each wave gate — including the **Brave push check** ("Use Google services for push messaging" must be on for web push; likely why notifications may have seemed dead). adb/Chromium remote debugging for anything ambiguous.

## Workstreams

- **M-A Canvas & density**: decisions 2+3 — chrome collapse, full-bleed mode, font system, fixed-height removal, read-only/connection state made visible (pill not dot).
- **M-B Input & keys**: decision 1 upgraded by research #2/#3/#4/#5 — ONE user-definable rail (JSON config, swipe-up popup layers, macro keys incl. a `y↵` approve and `/compact`), docked in the keyboard inset via the VirtualKeyboard API (Brave/Android supported; visualViewport fallback), sticky/lockable Ctrl-Alt with layer swap, Termius long-press-drag arrow synthesis, per-host prefix setting (kills hard-coded C-b), copy-mode exit affordance, Android/Brave paste verification + fix, haptic tick.
- **M-C Navigation & attach**: decision 5 — attach contract in-app, window-strip viewer re-targeting, cold-open restore, quick-switch seeding from roster (not only recents), "＋ window here" prefilled launch (6 taps → 2), warm-socket window extension (5 min → configurable 30). Plus research #7/#9: thumbnail pane switcher with agent-status badges, horizontal-swipe next/prev window, serialize-addon warm reattach for instant pane switching.
- **M-D Grid stability & resilience**: decision 4 upgraded by research #1 — server-side `window-size manual` pinning on our per-viewer grouped session + letterboxed fixed grid with font-scale-to-fit; settle-based resize for deliberate changes only; WebGL context re-create (currently degrades forever), resume/hard-reset toasts, `idle_timeout` one-tap resume. Includes the carried command-result feedback item (A5: surface dispatch outcomes so optimistic UI has truth).
- **M-E Precision & content**: research #5/#6/#8 — own touch-selection overlay (double-tap word, copy-on-select), scroll-freeze reading mode with "N new lines" pill, exact-range copy (line-numbered selection in the pager), History promoted to the rail, command marks + sticky command header (shell panes via OSC 133 passthrough; agent-turn heuristics for agent panes; second-wave scope), waiting-badges on collapsed cluster rows + filter→pane auto-expand, real directional pane nav (spatial, via topology geometry we already have).
- **M-F Device verification**: decision 7 — Android journey profiles, on-device checklist runs with you, Brave push setting doc + settings-page hint.

## Execution shape (same ADL model)

Two waves, four codex lanes, split across both machines; ~comparable to half the last program:
- **MW1**: `MOB-CANVAS` (M-A+M-B; homelinux) ∥ `MOB-FLOW` (M-C+M-D; heavisidelinux) — the structural fixes.
- **MW2**: `MOB-PRECISION` (M-E) ∥ `MOB-VERIFY` (M-F + journey-suite updates + carried small items A9/A10/A11) — then on-device pass with you, PR, deploy, v0.4.1.
Same firewalls/gates/reviews/receipts; per-wave deploy.

## Backlog assessment (Inventory B → recommendation)

**Fold into this mobile program (small, adjacent):** legacy `/tmux` hrefs from launch/open responses (A9); probe short-circuit + web-vitals gating (A10); window-strip arrow auto-activation (A11); docs-site screenshot (MW2); command-result feedback topic (A5 → M-D).
**Do now as 10-minute ops tasks (no program needed):** run the GitHub release workflow for v0.4.0 notes; `fs.inotify.max_user_instances=1024` sysctl on heavisidelinux (durable, replaces polling workaround); verify VAPID/web-push end-to-end on your phone WITH the Brave setting (part of M-F anyway).
**Next program candidates (your priority call, in my recommended order):**
1. **Hermes/open-agents deep integration** — the owner-requested 5-track item from 0.3.0, untouched: run lifecycle → Hermes, Hermes as work-item client, `ac` CLI/MCP contract for relay tasks, memory bridge, identity mapping. Biggest strategic value; its own program.
2. **Automation/memory finishing** — distillation is near-dead, budget enforcement thin (0.3.0 findings). Medium.
3. **Binary-only terminal migration** (server+schema+client with ordering guarantee) — clean-up, low urgency, pairs well with any future CP wave.
**Defer indefinitely (recommend):** tmux `-CC` transport (current hooks model is delivering), APK/native (PWA is fine on Android), R3F/Drei + TS-seam + uuid-advisory debt (harmless, batch into a future modernization), `/sessions`-vs-Command-Center merge (works as is), host capability write API (single-user, no need).
**Dropped by your single-user ruling:** tenancy/per-user scoping; iOS support work; full AT/screen-reader audit.

## What I need from you

1. Approve/veto the 7 proposed decisions (especially: rail contents, font default, letterbox default, auto-attach ON).
2. Pick the next-program priority (Hermes vs automation-finishing vs neither) so MW2 can hand off cleanly.
3. ~10 minutes on your phone at each of the two wave gates for the on-device checklist — the study's biggest systemic gap is that no wave was ever verified on real hardware, and yours is the only hardware that matters.
