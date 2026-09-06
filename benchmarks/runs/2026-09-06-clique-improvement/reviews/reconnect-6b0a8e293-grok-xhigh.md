I'll run an independent read-only review of the Snapback2 range-store reconnect fix against LLP 1012, starting with the review skill and the allowed sources.I'll treat this as a direct independent review, not a nested subagent run, and load only the allowed sources plus LLP 1012.The patch is small; I'll read LLP 1012 §8 and the range-store fingerprint, nextSeq, and admission paths next.I'll inspect overlay retirement, refresh/nextSeq custody, fingerprint hashing, and the new regressions in full.I have enough to judge the store path against LLP 1012: the nextSeq invariant, same-seq conflict, and the regressions. I did not run tests.

# READY

The 17-line `PersistentRangeStore` change in `snapback2/packages/snapback2/src/store/range-store.ts` matches LLP 1012 §8: an `unchanged` refresh may advance held `seq` while the duplicate-delivery digest stays bound to the original full envelope’s sequence, already stored as `nextSeq`. A later full envelope at that refreshed `seq` is compared with **every existing fingerprinted field**, `seq` rewritten only to `nextSeq`, then ordinary full admission at the incoming `seq` renews fingerprint, pooled rows, and continuation evidence. There is no hash-format change and no field exemption.

I did not execute tests, talk to the network, read another review, or touch a benchmark app. Author-reported suite counts are quoted as claims, not as results of this review.

## What changed

On same-`seq` duplicate admission, after the existing exact-digest `continue`:

```1072:1083:snapback2/packages/snapback2/src/store/range-store.ts
      if (old && delivery.seq === old.seq && old.fingerprint !== undefined) {
        if (old.fingerprint === fingerprint) continue;
        // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — an
        // unchanged response advances seq, retaining the full delivery's digest.
        // Compare every content field at that original seq, then install this
        // full delivery normally: its rows and next link now have fresh evidence.
        const fullSeq = old.nextSeq ?? old.seq;
        if (fullSeq === delivery.seq
          || old.fingerprint !== sha256(canonical({ ...fingerprintPayload, seq: fullSeq }))) {
          throw new TypeError(`conflicting deliveries for ${delivery.op} at seq ${delivery.seq}`);
        }
      }
```

Fall-through is the whole fix. A remapped match does **not** `continue`; it takes the existing install that sets `nextSeq: delivery.seq` and `fingerprint` over the incoming payload **including** the new `seq`.

That is the defect: resume’s nonempty log still returns a full envelope on validator equality (`writer_resume.rs` only answers `{ unchanged: true }` when the tail is **empty** and the validator matches). Conditional query already moved held `seq` to that same value, so the old exact digest comparison was a false conflict before outbox flush.

## Equivocation and `nextSeq` as fingerprint identity

Stored digest is still `sha256(canonical({ op, args, state, data, next, seq, validator, receipt, rows, reason, rule }))`. The extra compare only substitutes `seq: fullSeq`. Two payloads compare equal iff every other fingerprinted field is canonically identical **and** `fullSeq` equals the `seq` that was hashed into the stored digest (or a SHA-256 collision).

`nextSeq` is that sequence on every current-product path:

| Transformation | `seq` | `nextSeq` | digest `seq` |
|---|---|---|---|
| Full install | `delivery.seq` | `delivery.seq` | `delivery.seq` |
| `unchanged` refresh | advances | `??=` original full `seq`, never raised | unchanged |
| Later refresh | advances again | stays | unchanged |
| Successful remapped install | new `seq` | new `seq` | new `seq` |
| Exact same-seq replay | unchanged | unchanged | `continue`, no rewrite |
| `delivery.seq < held.seq` | ignored | unchanged | old-frame skip |
| Auth-epoch swap | fingerprints stripped | kept | next full answer is a new guard |

Because a broken `nextSeq` (legacy answer whose `seq` was already advanced before `nextSeq` existed) makes `hash(incoming, seq=held.seq)` miss a digest that still contains the older `seq`, the failure mode is a **false reject**, not a false accept. Different bodies, pools, receipts, validators, cursors (`next`), states, reasons, or rules still throw. `op`/`args` are both keyed and fingerprinted.

Generation, `schemaHash`, `planHash`, principal, and auth epoch are not store delivery fields; the server validator includes them (LLP 1012 §8, `ValidatorPayload` in `offline.rs`, seq excluded). The store fingerprints `validator`, so an honest validator change still refuses. `OfflineRuntime.commitMany` never files a generation mismatch as a held delivery (supersession) and throws on epoch mismatch. Connected/volatile envelopes never enter durable answers (`envelope?.connected || readsConnected(...)`) and never get conditional `unchanged` (`conditional_frame`).

**Stale continuation from `unchanged` only:** overlay still uses `(page.nextSeq ?? page.seq) < committedSeq` to ignore a pre-commit `next`. Refresh does not raise `nextSeq` once set. Only the post-validation full install does. Forged `next` at the refreshed `seq` throws before that install.

## Atomicity, pooled rows, old frames, duplicates

`commit` clones state, `applySwap` mutates the draft, `backend.replace` runs only if that returns. A throw inside the new compare or the later `conflicting row` path discards the draft, including any earlier delivery in the same swap and any same-swap refresh.

Row guards are unchanged and run **after** the digest check, against live `state.rows` / `state.rowSeq`, at **incoming** `seq`:

- same seq, different body → `conflicting row`
- older `rowSeq` → overwrite (ordinary newer-wins)
- newer `rowSeq` → skip that row

So after a remapped install restamps the pool at 11, a second op at 11 with a different body of the same `(table, id)` still throws. Same-seq exact digest still `continue`s (idempotent, no restamp). Lower seq is ignored (cannot rewind). Higher seq is a new delivery and may change content.

The compare uses the **stored** digest, not a hash of possibly purged held rows.

## Lifecycle / reopen / legacy

Refresh still does `nextSeq ??= answer.seq` **before** advancing `seq`, so a first refresh after a full install records the full seq. Reopen is a carrier `replace` of the same answer object; `nextSeq` and the hex digest survive. Legacy plaintext fingerprints are still normalized to `sha256(oldString)` on load and will not match a structured digest — same-seq redelivery still throws, which is the old conservative behavior.

`fullSeq === delivery.seq` is equivalent to the remapped compare when `nextSeq` is missing or already equal to held `seq`; it does not open a new accept path.

## Regressions (reviewed as written, not run)

Author-reported pattern `conditional refresh then|reconnect after a conditional|full delivery at a refreshed` is nine node:test records: store parent + three carriers, owner parent + three shapes, overlay parent (two carriers inside one test). That matches “9 failed / 9 passed” without this reviewer running them.

They exercise the actual changed path:

- **Store, three carriers** (`store-review.test.ts`): refresh 10→11, reopen, `nextSeq` still 10; equivalent full at 11 installs and sets `nextSeq` 11; reopen + byte-identical replay is idempotent; `data` / `state` / `next` / `validator` / `rows` / `receipt` / `reason` / `rule` each throw with coverage unchanged; other-op pooled-row conflict at the new seq; seq-10 replay cannot rewind; seq-12 with new body is ordinary admission.
- **Overlay, file + fake IndexedDB** (`overlay-retirement.test.ts`): after refresh, a later page does not retire; forged `next` throws and overlay remains; validated `{ ...link, seq: 31 }` (no `resumeSeq`) retires. That is proven full continuation, not patience.
- **Owner, three queries** (`real-owner.test.ts` + `owner-harness.ts`): nested join replacing `conversationId`, the same join under alias `chat` (`inboxHeld`), and `inboxPlain` with no join. Real `/api/query` then `/api/resume` envelopes are pinned to **only `seq` different**, `{ ...full, seq: first.seq }` equals `first`, `online()` does not throw, the queued `messages.send` is `committed`, an independent client sees one row, and the held base page is not replaced by a tail. The remount-to-null-watermark setup is what makes resume re-deliver the first page at the already-refreshed seq.

Overlay still does not use SQLite; that is the pre-existing pattern in that file. SQLite is on the digest/reopen path.

## Spec

The new LLP 1012 §8 paragraph states the same rule the code implements: no digest rebuild from held rows, `unchanged` does not renew a continuation link, repeated full delivery after install is idempotent. The `@ref` slug matches heading 8.

## Residuals (not blockers, not claimed as run)

- Historical published 0.0.6 seq 1754 cannot be attributed without frames; this reduction is independent of that incident.
- Author-reported `scripts/test.sh` exit 0 (431 JS, 753 Rust with 4 skip + 1 leaky pass, 216 evaluator + 2 visibility, compiler typecheck + 400) was not reproduced here. No new browser or installed-package proof is in this change; the report already says the optional web witness did not accept.
- Snapshots that advanced `seq` before `nextSeq` existed can still false-reject; they cannot false-accept. Current full install always writes `nextSeq`.

No concrete changed-path counterexample. **READY.**
