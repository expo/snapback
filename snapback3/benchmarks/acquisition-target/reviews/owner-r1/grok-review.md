# Grok4.6 xhigh owner review

**No confirmed material defect** in the owner `acquire` path, HTTP `/api/acquire` mapping, or worker-frame interaction, relative to the stated design. I did not run tests or inspect files beyond the supplied source.

The unit pins one real `seq`/`generation` per turn, executes each selected query under the request session, returns conditional `unchanged` only after a full authorized execution, and treats `more`/transport success as a continuation signal rather than dataset completeness. Limits of that verdict are at the end.

---

### What holds

**Authorization.** HTTP `/api/acquire` requires a bearer token (`http.ts` 210–218) and never selects `project`/owner methods (`http.ts` 44–45, 210). The worker authenticates once, then runs every page with `Context::query` for that principal (`protocol.rs` 203–205, 284–319, 427–428). Unknown/`__*` ops and non-queries are rejected before the turn (`protocol.rs` 547–563). `follow:false` plus a validator still calls `query_delivery` before comparing digests (`protocol.rs` 428, 450–457). Validator content (from `offline.rs` `ValidatorPayload`) binds op, args, state, data, next, rows, receipt, generation, schema/plan hashes, principal, and `auth_epoch`; excluding `seq` is consistent with the stated intent.

**Cursor / completeness.** Follow only takes `envelope.next` on `Complete` or `Capped` (`protocol.rs` 441–448). Partial, denied, and capped-without-next stay in `pages` and are not requeued. `more` is exactly `!pending.is_empty()` (`protocol.rs` 484–494). Cursor repeats are detected per chain within one turn (`protocol.rs` 49–74). Across HTTP rounds there is no held SQLite snapshot; `expectedSeq` mismatch fails the whole unit (`protocol.rs` 395–405).

**Bounds.** Declarations are 1..64 with unique keys (HTTP `http.ts` 309–318; worker `protocol.rs` 372–390). The turn stops *before* the next execution once at least one page exists and `pages.len() >= 16` or soft bytes/time are hit (`protocol.rs` 417–424), so the last admitted page is complete. Worker success payload is then hard-capped at 15 MiB (`protocol.rs` 496–504). HTTP maps `S3_ACQUISITION_OVERSIZE` to 413 and seq/generation faults to 409 (`http.ts` 346–347). Worker frames default to 16 MiB (`worker.ts` 101), which still fits a 15 MiB result plus a JSONL envelope.

---

### Missing tests (not confirmed defects)

These are untested in the supplied owner tests (`protocol.rs` 682–841), not demonstrated failures:

1. **Soft 1 MiB / 20 ms stop** — the bounds test only exercises the 16-execution cap (`protocol.rs` 806–833).
2. **Hard 15 MiB** — no case that a legal turn is rejected as `S3_ACQUISITION_OVERSIZE`, or that a later oversize page is deferred as a continuation.
3. **Follow rules by `DeliveryState`** — no acquire case that `Partial`/`Denied` (and `Capped` with `next: null`) are not requeued, or that `Capped` with `next` is.
4. **Cursor repeat through `acquire`** — `S3_ACQUISITION_CURSOR_REPEAT` is only asserted on `PendingAcquisition::advance` (`protocol.rs` 834–840), not on a multi-chain turn that already pushed other pages.
5. **HTTP surface** — no supplied test for `acquisitionRequest`, gzip negotiation, or status mapping.
6. **`expectedSeq` omitted** — unchanged-at-new-seq after an unrelated commit is the reason `seq` is out of the validator; that path is not shown.

---

### Speculative performance / availability (not confirmed defects)

- Final `serde_json::to_vec(&response)` sits *after* the 20 ms check (`protocol.rs` 496–498), so encode time can exceed the soft work bound.
- `negotiatedJson` gzip’s the whole body on the HTTP event loop (`http.ts` 358–372).
- `CURSOR_REPEAT` and `S3_ACQUISITION_OVERSIZE` abort the unit and drop already-built `pages` (`protocol.rs` 468–469, 496–504). Design only requires whole-unit reject for `expectedSeq` mismatch. Narrow counterexample for oversize: page 1 is 100 KiB, page 2’s envelope JSON is 15.1 MiB; soft bytes still allow page 2 (`protocol.rs` 419–420, 465–467), then the hard check fails and page 1 is not returned as a continuation. That needs a single page ≳14 MiB to matter.

Default worker timeout is 10 s (`worker.ts` 69–70). The first execution is unbounded by the 20 ms stop (`protocol.rs` 418: `!pages.is_empty()`). That matches “after a complete page,” not a new acquire-specific hole.

---

### Limits of this verdict

- `Context::query_read_time` is not in the supplied source. Conditional `unchanged` is only sound for untimed queries if that function does **not** put a per-request wall clock into the validator. Acquire uses the same `query_delivery` path as `/query` (`protocol.rs` 327–328, 428).
- Engine guarantees for `envelope.next` (valid `Optional<Cursor>`, no duplicate at a fixed seq) are not in the supplied source. If `next` can be invalid, the next `query_delivery` becomes `S3_RUNTIME` and the whole turn fails.
- Worker JSONL dispatch is not in the supplied source. Snapshot pinning assumes one `Owner::call` at a time; Node can have concurrent HTTP, but a serial worker would queue `mutation` behind `acquire`.
- Continuations serialize the client-shaped `AcquisitionChain` (cursor updated, validator cleared on follow) (`protocol.rs` 68–74, 485–493), while each page reports normalized `actual_args` (`protocol.rs` 459–464). Resubmitting `continuations` as in the owner test is the intended loop; declaration identity across sparse vs normalized args is an SDK check, as specified.
- Unchanged stubs are `{state, seq, validator}` only (`protocol.rs` 455). Generation lives on the response root (`protocol.rs` 489–491). Completeness remains a later SDK check of binding and page chains, not `more == false`.
