# Approvals

Approvals are permission requests raised by provider hooks. They appear in the approvals queue and the orchestrator.

## Flow

1. A provider hook emits an approval request to agentd.
2. agentd sends `approval.requested` to the control plane.
3. The dashboard shows the approval with session context.
4. An operator decides allow or deny.
5. The decision is sent back to agentd and the hook resumes.

## Decision modes

- `hook` - respond through the provider hook API.
- `keystroke` - send keystrokes into tmux as a fallback.
- `both` - attempt hook response and keystrokes.

## Timeouts

Approvals can time out if a provider does not receive a decision in time. A periodic
database sweep marks them inactive after `APPROVAL_TIMEOUT_MS` (10 minutes by
default); `APPROVAL_SWEEP_INTERVAL_MS` controls how often the sweep runs. The
same transaction clears matching session approval metadata and returns the
session to `IDLE`; the control plane publishes both approval and session updates.

Successful decisions also append an `approval.decided` timeline event in the same
database transaction as the approval update and durable command enqueue.

## API

- `GET /v1/approvals` - list approvals.
- `POST /v1/approvals/:id/decide` - allow or deny.

See [Provider Hooks](hooks.md) for setup.
