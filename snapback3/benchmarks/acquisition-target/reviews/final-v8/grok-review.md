**Verdict: accept.** Bound to `inputs.json` (`candidate: v8`, `frozenAt: 2026-09-12T21:11:51.007171+00:00`, `baseReview: final-v7`). I did not run tests, builds, or the IndexedDB harness.

Both v8 repairs hold under inspection. I have no remaining confirmed blocker on this delta.

---

## v7 P2 — repaired

Memory notification now uses the same `matchesClearSession` predicate as `merge` (`storage.ts` `37–40`, `51`, `117–118`): session token/principal/authEpoch **and**, when present, the nested six-field checkpoint.

A refused nested `clearSession` no longer broadcasts authority. The successor test forwards `subscribe` onto the inner memory store and, after the old-v1 fallback, asserts `v2` stays `ready` and the held live snapshot still has data (`acquisition-client.test.ts` `344–360`). That is the v7 counterexample.

IndexedDB already gated `authorityChanged` on the nested match (`213–216`); unchanged and still consistent.

---

## Mutable `AcquisitionSpec` — repaired

`acquire` copies the input before any handle work (`client.ts` `57–63`, `268–269`):

- `id` / `revision` by value
- `root` frozen with `ownJson(root.args)`
- `expand` by function reference (stated: closure remains application-owned; revision binds derivation)

`cancelAcquisition(spec)` and `startAcquisition(spec.id)` close over that owned spec (`296`, `610–616`). Later mutation of the caller object cannot retarget cancel or traversal.

The new test actually does that: it mutates `id` / `revision` / `root` / nested `args.global` / `expand` after registration, then checks original `/api/acquire` args, durable `declarationHash` for `history`/`v1`/`global: true`, `chains: 2`, and that `original.cancel()` withdraws only history while sibling stays `ready` (`254–283`).

Repeated `acquire` of an unchanged identity still returns the existing handle via the owned-spec identity (`273–275`). Resume still uses the captured id.

---

## Unchanged / follow-ups

Protocol, worker, transport, envelope cache, and `types.ts` hashes match v7. Known limits (whole-corpus load, no old-version GC, synchronous gzip, all-writes-fail erasure) are unchanged.

Optional, not a reject: IndexedDB inlines the same clear predicate instead of calling `matchesClearSession`. Behavior matches.

---

## Hash binding

| Path | SHA256 |
| --- | --- |
| `snapback3/packages/snapback3/src/client.ts` | `de9f1441744b2774d475ad47263ead06b0cf77789d16dcd783d89fd9d0940ad2` |
| `snapback3/packages/snapback3/src/resource/storage.ts` | `f6c37ba1044464424ec49d1e5c0606a8d027c39605a1216aeee7dc3d8578700c` |
| `snapback3/tests/acquisition-client.test.ts` | `b1ad6a59841e25bc4e515e38996ff4c487969e2a255de6e9162d593834073039` |
| `snapback3/guide.md` | `92fa4b09842ea00435055eda7a5bac331d81a1ceb6fdd125137aad73e582dc34` |
| `llp/2000-snapback3.rfc.md` | `691137e0f0e45eace57466b9ec861d2f6a505c10f1365ecb9891932e481cf3aa` |
| `acquisition.ts` / `types.ts` / `facts.ts` / `protocol.ts` / `signal.ts` / `row-values.ts` / `http.ts` / `protocol.rs` / `resource-client.test.ts` / `manifest-custody.test.ts` / `acquisition-envelope-cache.test.ts` / `test-acquisition-storage.mjs` | unchanged from the v8 `inputs.json` rows |

**Close:** v8 fixes the v7 memory-notify hole and owns mutable declaration inputs. No further correctness reject on this bounded delta.
