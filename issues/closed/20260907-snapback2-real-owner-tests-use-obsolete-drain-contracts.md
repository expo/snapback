# Snapback 2 real-owner tests still expect obsolete log-drain contracts

**Status:** Resolved on main — 2026-09-08
**Date:** 2026-09-07
**Systems:** package real-owner regression fixtures; offline log eligibility
**Observed baseline:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`

Four existing tests in `snapback2/packages/snapback2/tests/real-owner.test.ts`
fail on both the DX candidate and a rebuilt baseline with the complete DX
patch reversed. The baseline ran on idle Hetzner450b with the existing
10,000 ms file deadline; it failed the same four tests in 6.155 s, without a
timeout. This is separate from the chat unsend replay discrepancy and from
parallel test timing failures.

- The object-wrapper resume refusal expects `/returns no page/`; the actual
  refusal names `integration.inboxObject`, `cursor-binding`, and the requirement
  that every returned page ascend after the same cursor with at most 50 rows.
- Three media/outbox regressions request log drains of `messages.thread`, which
  is descending. Admission correctly refuses `E_OFFLINE_RESUME`,
  `reason: unsupported-log`, `shape: descending`, before the intended outbox
  behavior is exercised. The tests are named “failed outbox admission or
  prediction leaves no upload, intent, or mutation request”, “an outbox
  persistence failure after commit retains media for replay”, and “queued
  media retains its uploaded bytes until the outbox commits”.

Update the refusal expectation and give the media regressions a certified
ascending delivery-log fixture while retaining their upload/intent/mutation
and custody assertions. Do not relax the log eligibility contract or count
these failures as passing outbox coverage. Coordinate with the current native/
offline owner before changing these shared tests.

Reproduce from `snapback2/packages/snapback2` after building the package and
`cargo build -p snapback2 -p snapback2-media` in the Snapback 2 workspace:

```sh
node --test --test-timeout=10000   --test-name-pattern='real owner refuses an object|failed outbox admission|outbox persistence failure|queued media retains'   tests/real-owner.test.ts
```

Evidence: [baseline control](../../benchmarks/runs/2026-09-07-snapback2-published-dx/fix-evidence/baseline-real-owner.log),
[commands and durations](../../benchmarks/runs/2026-09-07-snapback2-published-dx/fix-evidence/tail-verification.json),
and [full first failure](../../benchmarks/runs/2026-09-07-snapback2-published-dx/fix-evidence/full-tests.log).

## Resolution — 2026-09-08

The object-wrapper assertion now matches the certified cursor-binding refusal, and the three media tests use the supported ascending drain fixture. Original media admission, persistence and replay assertions remain intact.

The responsibility split is landed in `4e9f1e36d`. `tests/real-owner.test.ts` checks the `integration.inboxObject` refusal; `tests/real-owner-upload.test.ts` uses `integration.inbox`. Final canonical package qualification passes 796/796 at the original deadlines.

Evidence was reconciled against main `2ac15dc2c`. LLP 1018.000 §10 completion records canonical qualification at `c20a37e22` and final package/Chrome qualification at `ab8b225e6`; unchanged native/evaluator/compiler inputs retain their earlier execution evidence. This reconciliation ran no new product tests. It closes the filed source defect; release and fresh published-package confirmation remain separately tracked.
