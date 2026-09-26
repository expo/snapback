# Snapback 4: a legacy acknowledgement can report a refused write as sent

- **Opened:** 2026-09-25, from Astra's review of lane V round 11. It was left for 0.4.3; the fix is lane V round 12, running.
- **Area:** `packages/snapback4/src/writes.ts` (`acknowledged`) and the outbox's `observed_seq`.
- **Severity:** High, but only on the upgrade path. A fresh 0.4.2 install cannot reach this state.

## What happens

The client treats an observed `_ops` row, meaning `observed_seq` is set, as proof that a write committed. The server also keeps `_ops` rows for **refused** mutations. Lane V round 11 made a known refusal win. But suppose a device upgraded from an earlier build holds an `observed_seq` for a refused write, and its refusal receipt was never persisted, for example after a crash. Then `acknowledged()` still reports `sent`.

Astra's reproduction: the server holds a `NOT_ADMIN` record and a legacy acknowledgement, and the client has no history. Retrying the id returned `sent / seq: 3`, and the server's audit stayed at 0; reopening still returned `sent`.

## The fix (lane V round 12)

An observation proves the server decided; it does not say what it decided.
- An acknowledgement is success-qualified only when it carries the outcome.
- An unqualified or legacy acknowledgement is revalidated against the original bound store before success is reported or custody retired. The client resends the same id, which the server answers from its idempotency record without executing it again.

## Resolution

Resolved 2026-09-26 by lane V rounds 12–15, integrated in 0.4.3. Acknowledgements
are outcome-qualified (the stream's `sent` map and `receipt_store.success_seq`). A
legacy sequence-only observation stays pending until a same-id replay to its
original store returns the recorded outcome. Receipt custody survives web upgrades,
and settlement never reads the shared window. The one residual, a `sent` receipt
manufactured before 0.4.2 that is already stored, moves to
`issues/20260926-snapback4-stored-manufactured-sent.md`.
