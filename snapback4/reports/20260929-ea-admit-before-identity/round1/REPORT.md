# EA round 1 — deferred custody under overlapping owners

2026-09-29. Branch `sb4-intent/ea-admit-before-identity`.
Round 0: `2ccdf26baaf170725be4ec7ce2b6a0ef755eccf1`.
`git fetch origin && git merge origin/main` at entry and before final runs both
reported `Already up to date`; fetched main was
`b7d05baff661db08bb99250d80b1090a8ed99346`. No conflicts or discarded changes.
Nothing pushed or published.

## Context and constraints

Used `llp-orient` after reading the original lane prompt and report, the Snapback
4 command sheet/fence, NOT-DOING, journal, adopted rules and design brief.
The governing context is LLP 3000 §6 (at-most-once), LLP 3000.007 §20.4
(durable deferred custody) and §18.2 (incarnation/recovery), LLP 3000.013 §6
and §13.3 (dispatch binding and one terminal outcome), and LLP 3000.019 §3.3
(pending visibility). Read the client and E_ADMISSION guide cards.
No new public client vocabulary, raised budget, authorization bypass or admission
refusal relaxation. The decision extends the existing §20.4 amendment.

## Review disposition and negative controls

Both received reviews are preserved as `astra-r0.md` and `grok-r0.md`.
Grok contained progress notes at entry; its completed NOT READY review arrived
during implementation and was addressed before the full suite.

1. **Astra High: native accepted custody disappears.** Two real SQLite processes
   pause A after loading metadata, admit B, let overlapping A `sync_state` read
   B's metadata, then release A. Before the fix both admissions succeed but only
   A remains. Each plan attempt now owns its CAS expectation; an unrelated read
   cannot replace it. The loser reloads and retries. The test checks both IDs in
   durable metadata and after closing/reopening.
2. **Astra High: executed online intent expires as unsent.** A's identity probe
   is held; B recovers the same journal, commits dispatch and executes. With B's
   response held, A's deadline formerly erased custody and reported
   `E_ADMISSION_TIMEOUT`. With B already settled, A still emitted that false
   refusal. Expiry now adjudicates inside the journal lock against current
   intent and receipts. Dispatched custody remains pending; a receipt wins;
   only an expired, undispatched intent can commit an unsent refusal. Failed
   storage retains custody and retries without publishing an unproved refusal.
   Tests check durable state, lookup, one truthful notification and one POST.
3. **Astra High: deferred recovery uses ID-only deduplication.** A's deferred
   capture pauses while B identifies and ordinarily admits the same ID with
   different input. Before the fix both accept. Native deferred acceptance and
   ordinary admission now compare operation, arguments and viewer in SQLite's
   writer transaction. Both orderings preserve the first owner. Same-input
   retries, including reordered object keys, recover its original minted IDs.
   Recovery also compares input and traverses the incarnation check rather than
   accepting an ID-only match. The six variants cover both winners and all three
   input components.
4. **Astra additional coverage: same-generation incarnation replacement.** The
   existing native handoff test now separately replaces generation and store
   incarnation between validation and admission. Both refuse before a POST.
5. **Grok High: staged web snapshot overrides authenticated schema identity.**
   Two actual same-schema servers reproduce a save after replacement B is staged
   but before store publication, with `/schema` originally from A. Before the fix
   wasm and Worker each POST to B and receive `sent` (`grok-real-replacement.log`).
   Capture now prefers nonempty `expected_store` over staged identity. Both hosts
   return actionable `E_ADMISSION_STORE` without a POST.
6. **Grok Low: native onWrite/lookup refusal discrepancy.** The native in-device
   refusal previously emitted family `schema` and omitted repair fields, while
   lookup returned family `store`. Deferred recovery now normalizes that code
   through the same public identity refusal. Tests compare complete notification
   and lookup values, including family, site, guide and rewrite.

`reproduce-all.log` records all four Astra negative tests failing on round 0.
`grok-reproduce.log` records both native metadata failures and the initial web
binding test; `grok-real-replacement.log` strengthens the web reproduction to
actual execution on a second server. Every failure is classified in `FAILURES.md`.

## Model and verification

Each generated session sequence now begins with one controlled production-host
custody schedule: state-read/CAS overlap, deferred/ordinary input collision, or
peer execution before expiry. Variants rotate read overlap counts, both custody
winners, operation/argument/viewer conflicts, and held versus settled receipts.
The original I1–I13 session commands and coverage assertions remain. The full
5,000 seeds per tier run in five serial slices. The existing 240-second
per-test timeout now applies to each 1,000-seed slice, accommodating the extra
real-process work; counts and invariant assertions remain unchanged. SQLite
schedules use real processes. Online schedules use the production online client and journal, a
modeled server's execution ledger, and controlled clocks.

- Final new and original admission tests: **32/32** (`admission-final.log`).
- Expanded overlapping-owner races: 9/9 (`races-expanded.log`).
- Final Grok and native replacement tests: 4/4 (`grok-final.log`).
- Existing online custody, local receipts and native opening/e2e: 31/31.
- Delivery matrix: 319/319 (`delivery-matrix.log`). New online expiry awaits and
  native plan attempts are covered by the controlled schedules; all existing
  fault classifications remain, with only their reviewed boundary hashes updated.
- Whole guide: **98/98** independently (`guide.log`) and again after the final
  wording addition in the full Rust suite.
- TypeScript build/typecheck, docs budget and release guard pass in the full run.
  Typecheck also passes after the clock correction (`typecheck-final.log`).
- Reference check: 523 LLP documents, 9858 references, zero errors/unchecked.

The full client stage reports **4604 tests; 4593 pass; 1 fail; 0 cancelled;
10 skipped**. Its one failure is **ours (inherited from round 0)**:
`web: a legacy admission keeps its floor through upgrade, retirement and rollback`
in `server-clock-wire.test.mjs`. The deferred queue wrapper discarded
`restore_clock_floor` while forwarding a queue read. The unchanged assertion also
failed in isolation (`clock-wire-isolated.log`, 9/10). Forwarding the original
request on both web and native now preserves that transaction. Corrected clock
and custody coverage passes **42/42** (`clock-corrected.log`), plus the added
native-wrapper regression **1/1** (`native-clock-final.log`). The final delivery
matrix passes **319/319** (`delivery-matrix-final.log`).

The full suite was started before this discovered clock correction; its result
retains that failure. It is not a final green snapshot. The model process
loaded the pre-clock-correction client, whose three requested custody fixes were
already present. The added forwarding only changes legacy clock restoration;
the generated custody schedules use ordinary queue requests. No second full run
was made. Final affected admission, clock, matrix and type checks pass as above.

Ran `bash scripts/test.sh` **once**, exit **1**. Its exact final summary is:

```text
== 1 failure(s) in 1983 s
   client tests
```

All Rust targets and doctests passed (564 seconds), including the whole guide;
all other script stages passed except that one client assertion. Every failure
is **ours**; none is classified as baseline or environmental. This includes the
intentional negative controls and corrected fixture mistakes in `FAILURES.md`.

The model stage passed **91/91** tests in 910 seconds, including all **10,000
extended session sequences** (5,000 online, 5,000 local), their fixed regressions,
and the existing 3,000-sequence online-client model. The session coverage is:

| Tier | Seed range | State-read/CAS overlap | Input collision | Peer execution/expiry |
| --- | --- | ---: | ---: | ---: |
| Online | 1–5000 | 1666 | 1667 | 1667 |
| Local | 1–5000 | 1666 | 1667 | 1667 |

See `full-suite.log` and the extracted `full-models.log`. The existing I1–I13,
operation/fault coverage and deliberate corrupted-outcome negative controls all
pass. The wasm cap and existing invariant assertions are unchanged. Grok's
review was rechecked before completion; its digest still matches `grok-r0.md`.

## Wasm

Canonical build during `scripts/test.sh`:
`wasm 2040529 B raw, 592974 B gzip (budget 593719: ok)`.
745 B below the unchanged 593,719 B cap. Native deduplication additions are
excluded from wasm. Generated wasm is not committed.
