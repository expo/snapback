**Verdict: request changes.** Bound to the packet FILE SHA256 headers below (no separate `inputs.json` body was in this packet). I did not run tests, builds, or benchmarks; implementation-team results are not my evidence.

The success-path v4 work is mostly in the right shape: per-dataset denial, conditional `clearSession`, fail-closed successor/invalidation, receipt-seq withdrawal before yield, owned row custody, list-only admission, fresh-skip guards, owner 32 with unchanged 20ms/1MiB/15MiB bounds, and original journal identities. One public cancel path still republishes a withdrawn dataset.

---

## Confirmed defects

### P1 — Cancel during automatic revalidation is overwritten back to durable ready

**Files:** `snapback3/packages/snapback3/src/client.ts`

**Counterexample (public APIs only):**

1. `await client.acquire(spec()).completed` so disk has `status: 'ready'`.
2. A later commit or live invalidation hits `suspendAcquisitions` (`548–558`): it snapshots `resumable` after `prepareAutomaticResume()` (`115–121`), then `void persistFailClosed({ invalidateAcquisitions, acquisitionsInvalidated })`.
3. While that write is in flight, `acquisition.cancel()` (`95–102` → `570–576`). The handle is `cancelled`, current `completed` rejects with `S3_ACQUISITION_CANCELLED`, and a cancelled checkpoint is queued.
4. When invalidation lands, `then()` still calls `startAcquisition(id)` for the captured id. That does **not** look at handle status (`585–588`).
5. `runAcquisition` never treats `metadata.status === 'cancelled'` as terminal. With `acquisitionsInvalidated` or `phase === 'validate'` it does `metadata.status = 'acquiring'` (`709–718`). `cancelAcquisition` also keeps `resourceKeys`/rows (`574–575`).
6. The loop then `persistProgress` with `status: 'ready'` (`750–751`), `acquiredFacts.set` (`755–757`), and `readLocal`. `handle.finish` is a no-op on a cancelled handle (`123–125`), so the handle stays `cancelled` while RAM and disk serve the dataset again.

Offline `query` works. Process reopen restores a ready checkpoint. `resume()` after that cancel can finish immediately from the rogue ready record (`692–704`). Cancel’s durable withdrawal is lost.

Same hole exists for same-sequence `invalidate` and for seq-advancing `rejected`/`conflict`/`committed` receipts, because all of them go through `suspendAcquisitions`.

---

### P2 — Immediate reopen can load withdrawn authority before `clearSession` is issued

**Files:** `snapback3/packages/snapback3/src/client.ts` `1350–1365`, `350–365`; `snapback3/packages/snapback3/src/resource/storage.ts` `98–107`

`persistFailClosed` issues `clearSession` only in the write’s `.catch`. Memory/IndexedDB `tail` swallows the failed write **before** that catch runs (`storage.ts` `105–106`). `close()` with caller-supplied storage does not wait for persistence (`364`).

**Counterexample:** delay a successor-manifest write (as the existing test does), `client.close()`, resolve the failure, then immediately `createClient({ storage })` **without** waiting for `session === null`. `load()` can resume on the swallowed tail and restore the old generation/session (`initialize` `372–391`) in the gap before `clearSession` is queued. That is the same program as `closing during a delayed successor-manifest failure…` minus the `eventually(session === null)` fence.

This is not the acknowledged “every write fails” case: the fallback still runs, just after a new client can republish.

---

## What held up under inspection

These were checked against the requested invariants. I am not treating tests I did not run as execution proof.

| Invariant | Result |
| --- | --- |
| Per-dataset denial | On the success path, only that id is cancelled (`829–841`); siblings stay restorable. RAM snapshots are rebuilt from remaining pools before durability. Fail-closed of the **whole** session if that write fails is the documented authority fallback, not sibling isolation. |
| Conditional `clearSession` | Both adapters match **current** token + principal id + authEpoch (`storage.ts` `18–21`, `38–41`, `195–200`). A newer token is preserved; a match erases session, frame, acquisitions, floor, and invalidation in the same transaction. |
| Receipt seq before yield | `minimumSeq` and `renewResources()` run for any advanced `committed`/`rejected`/`conflict` **before** `await persist({ operations })` (`1163–1172`). Same-seq committed still renews after persist. |
| Row custody | Restore hashes **owned** bytes (`acquisition.ts` `82–98`), checks table ∈ schema, `row.id`, map-key vs `versionKey`. Fresh `storedResource` freezes and pre-marks validated (`108–109`). |
| List-only pages | Typed `T extends readonly unknown[]` (`25`); runtime refuses non-list `envelope.data` before admission (`105–106`) and again in `chainValue` (`177–180`). |
| Fresh RAM skip | Only `freshTraversal && phase === 'traverse'` with every walked key newly delivered at `metadata.seq` (`742–744`). Resume, `unchanged`, sequence change, and `acquisitionsInvalidated` clear the skip. No max-seq relabel: `unchanged` retags seq only after owner re-execution + validator match. |
| Owner 32 | `ACQUISITION_EXECUTIONS = 32`; 20ms / 1MiB / 15MiB unchanged (`protocol.rs` `18–21`). Soft/time/count are checked **before** the next execution after the first page (`421–428`), so one legal page may exceed soft limits. Unexecuted continuations keep request args (`751–784`). |
| Journal | Terminal persist still writes the original intent id/body (`1166–1171`). Session/generation clears do not wipe operations. |

---

## Structural / scaling (not correctness rejects)

**Envelope ownership is one-time on the wire path, not on restore/walk.** `decodeDeliveryMessage` now returns `ownDeliveryEnvelope` (`protocol.ts` `206–209`). `envelopeFromStored` builds a **new** `{ ...resource.envelope, rows }` (`acquisition.ts` `117–125`), which misses the WeakSet and re-runs `decodeDeliveryEnvelope` including `JSON.stringify` sizing (`protocol.ts` `145–155`). Completion `walk` / `chainValue` / `restoreAcquiredPool` therefore re-decode every page. That undercuts LLP 16 step 4 (“prepare once”). Not a false-ready.

Honest leftover limits, not hidden passes: IndexedDB `load()` still `getAll`s the retained corpus (`storage.ts` `150–167`); old row versions are not GC’d until authority cleanup; `gzipSync` is still synchronous on finite `/api/acquire` replies (`http.ts` `358–372`); if every write fails, disk erasure is not guaranteed. V4 performance / foreground / real-IDB qualification is still pending. LLP 16’s 2.6–2.9s figures are explicitly unqualified.

---

## Tests (assertion review only)

`acquisition-client.test.ts` actually asserts the v4 contracts it names: sibling denial through offline reopen (`358–378`), successor fail-closed (`499–515`), delayed successor + close (`518–532`), newer-account guard (`535–548`), failed invalidation (`580–598`), rejected/conflict seq withdrawal before receipt persist (`617–634`), row hash/identity (`637–656`), composite list refusal (`660–672`).

`test-acquisition-storage.mjs` asserts v1 journal-byte preservation, whole-transaction floor rollback, and conditional clear vs a newer token (`220–239`).

Gaps: no test for **cancel during in-flight invalidation**; committed advanced receipts share the `if (advanced)` path but are not asserted the way rejected/conflict are.

---

## Optional / nits (not confirmed defects)

- After denial, `acquire(same id + revision)` returns the sealed handle forever (`252–258`). RFC says sealing is permanent for that handle; restart needs a new client, id, or revision.
- First acquire with `minimumSeq === 0` sends `expectedSeq: 0`, gets `S3_SEQUENCE_CHANGED`, then restarts. Extra round trip, not false-ready.
- `pages(string, …)` is not list-constrained at the type level; runtime still refuses.

---

## Hash binding

| Path | SHA256 |
| --- | --- |
| `snapback3/packages/snapback3/src/client.ts` | `8bb66126a9ca03c3c9492e83b0fb6dbfff74eb14f4a08400ba2c85848f9c7223` |
| `snapback3/packages/snapback3/src/resource/acquisition.ts` | `99fd5a3d50d28241637df65333d4d80116bdea2ca0c0a402d8624c6d137b1f1b` |
| `snapback3/packages/snapback3/src/resource/storage.ts` | `cf1869bbe3eae7c2afdd67d9d245fb35b192e3d2368c725dfcdb93b92b52f90a` |
| `snapback3/packages/snapback3/src/resource/types.ts` | `6899cbdcfb4fb0a4dfb056a3da74ed2ea87155a7ec827b9b1bde6e078a97c46c` |
| `snapback3/packages/snapback3/src/resource/facts.ts` | `443b83d2b025a7b6b5a718554aec98d67f69ea8bad1a1be9c085b946e50e55f2` |
| `snapback3/packages/snapback3/src/resource/protocol.ts` | `96c6708a8147c6ab59335412feaad868ab0d62ce3c3c5c2877684a7da997217f` |
| `snapback3/packages/snapback3/src/resource/signal.ts` | `459f2fe1bd8b2075e93fee4e19fa6fe5d1cfc94787da3c1707e0c7e902f04812` |
| `snapback3/packages/snapback3/src/resource/row-values.ts` | `c27cb8f44114f1e12414a945eb22e3e3c626033172f57644471c53e6ce18772e` |
| `snapback3/packages/snapback3/src/node/http.ts` | `16e29bd5cd5818278b376d171f3c71601c8ec7378239d1b219980fb2d6cfc195` |
| `snapback3/crates/snapback3-worker/src/protocol.rs` | `3a5f354bca9d84767667520e02719c263a0e3dd7b34155a4a852a0989dd84340` |
| `snapback3/tests/acquisition-client.test.ts` | `36d24d5deca5533d34979ddb203c6c69c5e62f340a1675c308dc0cbf99e5d01f` |
| `snapback3/tests/manifest-custody.test.ts` | `b5224137ccbf53c4f181502004f49973be9601c83a2155a9df95369346b0a6aa` |
| `snapback3/scripts/test-acquisition-storage.mjs` | `f9c0533d52429debcc7df6e7b6a647ad98fa2f1e4b9f16f797a90628b8ddddf0` |
| `snapback3/guide.md` | `37363b763cbe203cb1432d10ceae213784c6668a5cb06f2111c69107ad5cbd0c` |
| `llp/2000-snapback3.rfc.md` | `91c11fb239baa32b845db6408d8cdd2199d715bac16860c2db5fc88e144c8226` |

**Blocker:** `client.ts` `548–558` + `709–718` + `750–757` — cancel during automatic revalidation can persist `ready` and republish acquired facts. Fix that, and fence initialize/load against in-flight fail-closed fallback, before treating v4 as closed.
