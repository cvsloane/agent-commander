# Terminal Interaction Fix: PTY-Based Architecture

## Problem Statement

Terminal interactions in the browser have several issues:
1. **No input echo** - Characters typed don't appear until command execution
2. **Cursor positioning** - Arrow keys, backspace don't work properly
3. **Line editing** - No readline-style editing (Ctrl+A, Ctrl+E, etc.)
4. **Signal handling** - Ctrl+C sometimes doesn't work as expected

## Root Cause Analysis

### Current Architecture (FIFO-based)
```
Browser → WebSocket → Control Plane → WebSocket → Agent → FIFO → tmux
                                                          ↓
                                                    send-keys (input)
                                                    pipe-pane (output)
```

**Key files:**
- `agents/agentd/internal/tmux/terminal.go` - FIFO-based paneBridge
- `agents/agentd/internal/tmux/pipe_mux.go` - Output capture via `stdbuf -o0 tee`

**Problems:**
1. `send-keys` bypasses PTY line discipline - no echo, no cursor handling
2. FIFO is unidirectional - can't provide proper terminal semantics
3. No controlling terminal for the tmux session from browser's perspective
4. Alternate screen + cursor addressing + full-screen apps are broken without a real TTY

### webtmux Architecture (PTY-based)
```
Browser → WebSocket → Go Backend → PTY Master FD → tmux attach
                                        ↓
                                   PTY Slave FD (terminal)
```

**Key insight from webtmux (`session.go`):**
```go
cmd := exec.Command("tmux", "attach", "-t", sessionID)
ptmx, err := pty.Start(cmd)  // Creates PTY, starts cmd with PTY as controlling terminal
// Read from ptmx → send to WebSocket
// Write from WebSocket → write to ptmx
```

The PTY provides:
- **Line discipline** - Echo, buffering, special character handling
- **Terminal emulation** - Cursor positioning, line editing
- **Signal generation** - Ctrl+C → SIGINT, Ctrl+Z → SIGTSTP

---

## Proposed Solution: PTY Bridge

Replace FIFO-based `paneBridge` with PTY-based `ptyBridge` that:
1. Spawns `tmux attach -t session` via PTY
2. Routes WebSocket input to PTY master fd
3. Reads PTY master fd for output broadcast
4. Uses PTY resize so tmux updates the client size (fixes cut-off + no-fit)

### Architecture Change

**Before (FIFO):**
```
paneBridge {
    fifoPath: "/tmp/ac-tmux-pane-123"
    readLoop() → reads from FIFO
    Write() → tmux send-keys
}
```

**After (PTY):**
```
ptyBridge {
    ptmx: *os.File  // PTY master
    cmd: *exec.Cmd  // tmux attach process
    readLoop() → reads from ptmx
    Write() → writes to ptmx
}
```

### Implementation Design

#### 1. New PTY Bridge (`agents/agentd/internal/tmux/pty_bridge.go`)

```go
package tmux

import (
    "os"
    "os/exec"
    "sync"

    "github.com/creack/pty"
)

type ptyBridge struct {
    sessionID   string
    paneID      string
    ptmx        *os.File
    cmd         *exec.Cmd
    channels    map[string]*ptyChannel
    channelsMu  sync.RWMutex
    closeOnce   sync.Once
    closed      chan struct{}
}

func newPtyBridge(sessionName, paneID string, readonly bool) (*ptyBridge, error) {
    // Start tmux attach with PTY (select the exact pane)
    args := []string{"attach-session", "-t", sessionName, ";", "select-pane", "-t", paneID}
    if readonly {
        args = []string{"attach-session", "-r", "-t", sessionName, ";", "select-pane", "-t", paneID}
    }
    cmd := exec.Command("tmux", args...)
    cmd.Env = append(os.Environ(),
        "TERM=xterm-256color",
        "COLORTERM=truecolor",
        "LANG=en_US.UTF-8",
        "LC_CTYPE=en_US.UTF-8",
    )
    ptmx, err := pty.Start(cmd)
    if err != nil {
        return nil, err
    }

    // Set terminal size
    pty.Setsize(ptmx, &pty.Winsize{Rows: 24, Cols: 80})

    bridge := &ptyBridge{
        sessionID: sessionName,
        paneID:    paneID,
        ptmx:      ptmx,
        cmd:       cmd,
        channels:  make(map[string]*ptyChannel),
        closed:    make(chan struct{}),
    }

    go bridge.readLoop()
    go bridge.waitForExit()

    return bridge, nil
}

func (b *ptyBridge) Write(data []byte) error {
    _, err := b.ptmx.Write(data)  // Direct write to PTY master
    return err
}

func (b *ptyBridge) Resize(rows, cols uint16) error {
    return pty.Setsize(b.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (b *ptyBridge) readLoop() {
    buf := make([]byte, 4096)
    for {
        select {
        case <-b.closed:
            return
        default:
            n, err := b.ptmx.Read(buf)
            if err != nil {
                return
            }
            if n > 0 {
                b.broadcast(buf[:n])
            }
        }
    }
}
```

#### 2. Update TerminalManager (`terminal.go`)

- Add `ptyBridges map[string]*ptyBridge` alongside existing `paneBridges`
- Add option to choose PTY vs FIFO mode (for backward compatibility)
- Default to PTY mode for browser-connected sessions

```go
type TerminalManager struct {
    // ... existing fields
    ptyBridges   map[string]*ptyBridge
    usePTYMode   bool  // Default true for browser sessions
}

func (tm *TerminalManager) ConnectSession(sessionID string, usePTY bool, readonly bool) (*TerminalChannel, error) {
    if usePTY {
        return tm.connectViaPTY(sessionID, readonly)
    }
    return tm.connectViaFIFO(sessionID)  // Legacy mode
}
```

#### 2a. Pane/session selection
- Determine tmux **session name** from pane ID before attaching:
  - `tmux display-message -p -t <pane> "#{session_name}"`
  - Attach to that session name, then `select-pane -t <pane>`
- This avoids attaching to the wrong session and ensures the correct window is focused.

#### 3. WebSocket Protocol Enhancement

Add resize + mode flags (read-only vs interactive). Prefer **binary frames** for IO data:
```go
// Message types
const (
    MsgTypeIO     = '1'  // Input/Output data
    MsgTypeResize = '2'  // Terminal resize
    MsgTypeMode   = '3'  // Mode toggle (read-only vs control)
)

// In websocket handler
switch msg[0] {
case MsgTypeIO:
    bridge.Write(msg[1:])
case MsgTypeResize:
    rows, cols := parseResize(msg[1:])
    bridge.Resize(rows, cols)
case MsgTypeMode:
    // toggle read-only / request control
}
```
**Recommendation:** send IO over WS **binary frames** to avoid UTF-8 corruption.
If JSON-only, base64-encode IO payloads and include an `encoding` field.

#### 4. Dashboard Terminal Updates (`TerminalView.tsx`)

Add resize handling:
```typescript
useEffect(() => {
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    fitAddon.fit();

    // Send resize to backend
    const { rows, cols } = terminal;
    sendMessage(`2${rows},${cols}`);

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        sendMessage(`2${terminal.rows},${terminal.cols}`);
    });
    resizeObserver.observe(containerRef.current);
}, []);
```

---

## Multi-Viewer Strategy (Critical)
We need multiple viewers (read-only) without breaking interactivity:
- **Default:** allow multiple read-only PTY clients (`tmux attach -r`).
- **Interactive:** at most one writable client per session pane. Use a lock in agentd:
  - If a writer is attached, other attachments are read-only unless the user explicitly steals control.
- **UI:** show who has control and add "Request Control" + "Take Control" actions.

This mirrors tmux’s own multi-client behavior and avoids input conflicts.

---

## Backpressure + Cleanup (Important)
- Use bounded channels + `io.CopyBuffer` to avoid memory growth under high output.
- If WS client is slow, drop output and show a warning banner (or disconnect after N drops).
- On disconnect:
  - Close PTY → tmux client detaches automatically.
  - Kill the attach process if still running.
- Periodic cleanup: if no attached viewers for a session, close the PTY bridge.

---

## Security / Safety
- Enforce read-only unless the user explicitly attaches in interactive mode.
- Require host/role checks before opening a PTY (terminal attach is shell access).
- Log audit events for attach/detach and control transfers.

---

## Compatibility Notes
- `tmux attach` requires a real session name; derive it from pane ID.
- PTY mode only on Linux/macOS; keep FIFO fallback for environments without PTY support.
- Override `TERM` to `xterm-256color` to fix color and cursor rendering.

## Migration Strategy

### Phase 1: Add PTY Bridge (Non-breaking)
1. Add `creack/pty` dependency to Go module
2. Create `pty_bridge.go` with PTY-based terminal handling
3. Keep FIFO bridge as fallback
4. Add feature flag to toggle between modes

### Phase 2: Wire to WebSocket
1. Update `TerminalManager.ConnectSession()` to use PTY mode
2. Add resize message handling in control plane WebSocket
3. Update dashboard to send resize messages
4. Test with existing sessions

### Phase 3: Cleanup
1. Make PTY mode the default
2. Deprecate FIFO mode (keep for edge cases)
3. Remove pipe-pane output capture for PTY sessions
4. Update documentation

---

## Files to Modify

### Agent (Go)
- `agents/agentd/go.mod` - Add `github.com/creack/pty` dependency
- `agents/agentd/internal/tmux/pty_bridge.go` - NEW: PTY-based bridge
- `agents/agentd/internal/tmux/terminal.go` - Add PTY mode option
- `agents/agentd/cmd/agentd/main.go` - Wire PTY bridge to WebSocket handler

### Control Plane
- `services/control-plane/src/ws/agent.ts` - Handle resize messages
- `services/control-plane/src/ws/dashboard.ts` - Forward resize to agent
- `services/control-plane/src/routes/terminal.ts` - Pass `readonly` / `control` flags, enforce auth

### Dashboard
- `apps/dashboard/src/components/TerminalView.tsx` - Send resize, handle fit
- `apps/dashboard/src/components/TerminalView.tsx` - Control/readonly toggle + control state UI

### Schema (Optional)
- `packages/ac-schema/src/terminal.ts` - Add resize message types

---

## Verification Plan

1. **Basic PTY test:**
   - Start tmux session
   - Connect via PTY bridge
   - Type characters → verify immediate echo
   - Use arrow keys → verify cursor movement
   - Use Ctrl+C → verify SIGINT works

2. **Resize test:**
   - Connect to session
   - Resize browser window
   - Verify terminal reflows properly
   - Run `stty size` → verify correct dimensions

3. **Multi-client test:**
   - Connect two browser tabs to same session
   - One tab read-only, one tab control
   - Type in control → verify appears in both
   - Request control from read-only → verify lock handoff

4. **Backward compatibility:**
   - Verify FIFO mode still works when PTY fails
   - Test CLI-only sessions (no browser)

---

## Risk Assessment

**Low Risk:**
- PTY is well-established technology
- webtmux proves the approach works
- Fallback to FIFO available

**Medium Risk:**
- Resource usage: Each browser connection needs PTY
- tmux attach limit: May need detach/attach cycling
- Platform compatibility: PTY behavior on macOS vs Linux
- Multiple writers: conflicting input if control not gated

**Mitigation:**
- Connection pooling for PTY bridges
- Graceful degradation to FIFO
- Platform-specific testing in CI
- Enforce single writer + explicit control handoff

---

## Alternative Considered: tmux Control Mode

tmux has a `-C` control mode that provides structured output:
```bash
tmux -C attach -t session
```

This was considered but rejected because:
1. Still requires parsing tmux protocol
2. Doesn't provide standard terminal emulation
3. webtmux doesn't use it - PTY approach is proven
4. More complexity for similar result

---

## Dependencies

- `github.com/creack/pty` v1.1.21+ (Go PTY library)
- No new npm dependencies (xterm.js already handles resize)
