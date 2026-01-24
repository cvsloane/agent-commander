# Orchestrator

The orchestrator is the attention center. It surfaces sessions that need a human decision or input.

![Orchestrator](images/orchestrator.png)

## What appears in the queue

- Sessions waiting for input
- Sessions waiting for approvals
- Sessions in error state
- New approvals as they arrive

## Real time updates

The orchestrator subscribes to:
- Session changes
- Snapshot updates
- Approval events

This allows the queue to update without refresh.

## Idle and wake

Operators can idle a session to remove it from the active queue. An idled session remains visible in the idle list and can be reactivated at any time.

## Summaries

If the summary service is configured, the orchestrator can request a short context summary for each item. Summaries are cached by snapshot hash to keep costs low.

## Full page and modal

The orchestrator is available as:
- A full page view (`/orchestrator`)
- A quick modal overlay from the header

Both surfaces use the same data and filters.
