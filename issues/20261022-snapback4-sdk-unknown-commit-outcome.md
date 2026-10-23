# SDK must retain unresolved intent after an unknown commit outcome

Status: Open
Date: 2026-10-22
Scope: Snapback 4 SDK (`packages/snapback4/src/client.ts`, `local.ts`, `writes.ts`)
Severity: P1

Reviewer A's blind K0-Q round-2 review reproduced this with the actual SDK source
and an injected HTTP 500 `E_COMMIT_OUTCOME_UNKNOWN` envelope: a committed mutation
became `state: "failed"`, pending writes became empty, and a second application
invocation used a new operation ID. The online client clears pending custody,
the local client persists a failed receipt, and receipt recovery preserves that
failure rather than accepting a later acknowledgement. Retrying the apparent
failure with another ID can apply it twice.

K0-Q fix round 2 removes the serving acknowledgement timeout that manufactured
this error after 30 seconds. Genuine unknown outcomes remain possible when an
uncancellable Postgres COMMIT fails without a known rollback, or when the
committer dies after execution starts. The SDK must:

- Retain unresolved intent and pending custody rather than marking the write as
  definitively failed or deleting it.
- Reconcile by persisted receipt/operation ID, accepting later committed
  acknowledgement evidence and making the unresolved state visible to callers.
- Never automatically replay unkeyed work; lack of an acknowledgement is not
  evidence that the operation was not applied.

Add SDK regressions for an unknown envelope followed by a durable receipt, local
restart/recovery, and unkeyed work that cannot be safely replayed. Client changes
are explicitly outside the K0-Q lane. Server evidence and limitations are in
[the lane report](../snapback4/reports/20261022-k0q/REPORT.md).
