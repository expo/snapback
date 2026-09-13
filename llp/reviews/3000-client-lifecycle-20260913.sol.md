# Received client lifecycle review

Reviewer: Codex gpt-5.6-sol, xhigh, host lane; 2026-09-13.
Inspected: `50f933e80` against `cca6a2d0b`, JavaScript client/local/React/contract/mock and their tests. Native Rust excluded. Read-only review; the reviewer wrote none of these changes. The lead transcribes the received findings below; all four sequences were reproduced against the exact built delivery code.

- **P1 — adoption leaves old observations fresh.** A generation-one query observes table `a`; generation two changes it to table `b`. Successful adoption with an empty sync page never reruns the watch, while a page touching `b` also misses its old dependency set. The device advances but the old result stays fresh. All watches must rerun after successful adoption with usable new device state.
- **P1 — auth failure strands queued writes.** Two concurrent online mutations queue. A 401 settles the head and makes the client signed-out, so the flush loop exits with the never-sent tail still pending and no terminal `onWrite`. The dead session can never resume it. Never-sent tails need a terminal auth outcome.
- **P2 — an in-flight query recreates a closed observation's timer.** Close the watch before its response arrives; a response containing a future `nextExpiry` schedules a new timer even though the watch was removed. A dirty flag can also rerun it. Both tiers must verify watch identity after awaiting and before timer/rerun work.
- **P2 — failed session cleanup suppresses viewer notification.** Local invalidation clears the in-memory viewer but awaits `SessionStore.delete()` before listeners. A rejecting custom store prevents `onViewer`, leaving the hook stale. Notify the in-memory transition regardless of persistence cleanup.

Implementation was assigned to the separate client lane. Qualification and disposition follow in the journal.
