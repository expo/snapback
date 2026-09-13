# Cold-install comparator checks fail with SNAPBACK_OUTBOX_NOT_WRITER on both platforms

- Status: open
- Created: 2026-08-28
- Area: client store single-writer ownership / outbox; packaged cold-install acceptance
- Found by: LLP 0314.000 Phase 1 exit evidence (`scripts/snapback-package-cold-install.mjs`)

## Summary

`scripts/snapback-package-cold-install.mjs` fails two comparator checks against a freshly
packed public-alias closure:

| check | status | diagnostic |
|---|---|---|
| `native-live-delivery` — cross-client native live delivery | failed | `SNAPBACK_OUTBOX_NOT_WRITER` |
| `atomic-declared-writes` — atomic declared write set | failed | `SNAPBACK_OUTBOX_NOT_WRITER` |

> this context does not hold single-writer ownership of the client store; the mutation
> was not queued

The other comparator checks pass, including `rejected-mutation-rollback`, which passes by
*observing* the same `SNAPBACK_OUTBOX_NOT_WRITER` code and an unchanged durable version —
so the suite's own expectations disagree about whether that refusal is the normal state.

## Evidence

Reproduced twice on Linux x64 (`expo-build-450b`) and once on Darwin arm64, from source
revision `3b2597b0e4c8c619aa34c93456139b3c9641e75e`, on clean checkouts with a fresh
`TMPDIR` (so it is not leftover lock state), against packages assembled from the
`--profile production` runtime:

- Linux: `/tmp/llp0314-linux.log`, `/tmp/llp0314-coldinstall2.log` (identical both runs)
- Darwin: same two ids, same code

## Why this is not LLP 0314.000 Phase 1

`SNAPBACK_OUTBOX_NOT_WRITER` is raised entirely inside `packages/snapback-client`
(`outbox-shared.mjs`), before any server round-trip. Phase 1 changed the runtime packers,
the CI/staging manufacture commands, the `snapback-build-identity` build script, and
documentation; it did not touch `packages/snapback-client`, whose bytes in the packed
closure are identical to `origin/main`. The failure also reproduces identically on both
platforms, whose binaries share nothing but that source.

Phase 1 therefore neither causes nor fixes this, and its Linux/Darwin exit evidence records
the cold-install leg as red rather than claiming it green.

## Related

`issues/shelved/20260825-cron-authored-delta-not-outbox-writer.md` reports the same diagnostic in the
all-aboard browser acceptance check and calls it a genuine product defect rather than a
host-setup problem. These are likely the same defect seen from two harnesses; if that is
confirmed, close this ticket into that one.

## Next check

Decide whether the comparator's actor context is supposed to hold single-writer ownership of
the client store, or whether the two failing checks should be asserting the refusal the way
`rejected-mutation-rollback` already does. The suite cannot be right both ways.
