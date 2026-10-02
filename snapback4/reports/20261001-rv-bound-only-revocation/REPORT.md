# RV round 0 — bound only possible row revocation

Starting commit: `9845a1f013cf0c0a14194efecef86f865cfdc2a1` (`main` at branch creation). Branch: `sb4-intent/rv-bound-only-revocation`. Host: Linux x64, Rust/Cargo 1.97.0, Node 24.13.1, Bun 1.3.14. No push or publication.

Answers stay visible and `revalidating` until replaced unless change evidence may revoke a row; then the existing one-second withdrawal bound applies. There is no application option.

**Publication fence:** device replies gain one additive, top-level `preserved: string[]` on successful `apply`, `admit` and `settle`. Existing `ok` payloads and query replies do not change. `schema-capabilities.test.mjs` permits this exact field only on those three operations, validates its bounded string-list shape, and keeps the existing query `scopes` allowance separate. Its new confinement test passes. The four published-0.2.33 comparison cases skip on Linux: **the operator must run this file on darwin-arm64 before landing.** This report does not claim the macOS fence passed.

## Implementation and soundness argument

The shared Rust classifier derives authorization inputs from the compiled schema: local read-rule columns, positive/negative rule probes, audiences and membership tables, inherited/through authority, aggregate sources and row-key owners, assets and expiry. A deletion excludes its own table. Any change to a table used as an external authorization input excludes its dependents. Inserts into an answer's own table and changes outside its policy columns can preserve existing authorized IDs. Unknown dependencies and `once` ledger dependencies certify nothing. Opaque native queries and replies without a compiled scope plan remain bounded.

Both device stores record bounded net transaction images: initial/final images, at most 256 IDs and 256 KiB of observed images. Prediction restore/replay of the same ID is folded before classification. Rollback, physical clears and overflow widen. Durable server commits lazily create `_change_evidence` and persist only a table/column summary; opening an old native device does not migrate its store. No row values, IDs or principals enter the certificate. `/changes` and `/sync` certify contiguous intervals of at most 500 commits, including any later image head. Missing legacy summaries, gaps and overflow widen. Online acknowledgements certify their own non-replayed commit and carry generation. Ephemeral epochs retain intersectable certificates; gaps, incarnation changes and mutation-time sweeps widen.

Device `apply` intersects its own effects with the server certificate. Snapshots and previously staged intervals remain conservative. Local `admit`/`settle` classify their committed net effects. All channels preserve existing invalidation/version/cut behavior; certification only selects bounded versus plain `ReadObservation.reload`. A safe event cannot erase an already-open revocation episode. Facade approvals retain their answer's dependency plan so source B cannot hide still-displayed A's dependencies. Selection and immediate scope withdrawal consult both.

The local client, online client, facade, `useQuery` and `usePage` share that episode. Scope loss, generation/store/viewer/credential changes, sign-out, resets, `clear_rows`, `settle_exit` and expiry keep their hard boundaries. PRL batching and PQ eight-start/eight-active limits are unchanged; local bounded episodes still exclude capacity wait and online bounded episodes include it.

Orientation used the Snapback 4 fence, LLP 3000, the design brief, LLP 3000.019 §3.3, LLP 3000.023 §3/§10 and the current client/reads guide. LLP 3000.023 §12 records the narrowed rule and protocol; LLP 3000.019 §3.3 records which premise changed. README, CLIENT-AND-OPERATIONS and the client/reads/social guide cards now teach the rule. The guide fact inventory tracks the revised statement without relaxing the guide's word or fact-preservation budgets.

## Model and controlled regression

`cargo test -p snapback4-lang --test revocation_soundness -- --nocapture` (`soundness-decoder.log`, final) runs the engine's own authorization evaluation before and after random physical commits over deduplicated, context-expanded guide schemas plus Clique and expiry fixtures. Guide schemas include receipts and assets. It generates a superset of reachable physical states, including missing and negative inputs; it does not assume application mutation invariants. Original compiled programs remain installed for expiry/jobs and generated point queries enumerate IDs for three viewers.

```
RV soundness: seeds=[52560001, 52560002, 5256cafe, 5256beef]; schemas=89; no-durable-table schemas=1; commits=11392; certified viewer/table checks=300666; retained authorized ids=485915; revoking losses covered=4990; failures=0
```

Four seeds, 32 commits per schema/seed. Every certified before-ID remains authorized afterward; there are no limits in these point queries, so no displacement exemption is used. Same-ID updates are evaluated on their resulting image. Time is fixed at 100 in this model: expiry-column changes/deletions are modeled, while deadline progression is exercised by existing expiry tests. Every persisted certificate is also compared with an ordinary serde decode of the same summary. This is randomized evidence, not an exhaustive proof over all values or query shapes. During development it found a missing derived row-key authority dependency; the classifier now includes it.

`revocation-retention.test.mjs` exercises public online watches under a controlled clock with replacements held beyond 1,001 ms: insert retention for omitted/true keep, delete withdrawal, missing/malformed classification and opaque replies. Additional cases cover retry exhaustion followed by revocation, facade-held A/source B dependencies, and insert/delete/generation mutation acknowledgements. All 16 pass, including a failed safe reread followed by another safe event: failed evaluations preserve the displayed dependency plan. The publication-allowance unit test also passes; four macOS-only cases skip.

The same first 11 cases run against a temporary SDK with the client/local-client/evidence-routing modules transpiled from the starting commit (unchanged support modules use the current build): exactly the two insert cases fail, while nine controls pass. `RV_TEST_SDK` selects this control without changing production code. See `main-regression.log` and `regression.log`.

Core directed tests cover net replay, deletion, policy columns, membership inputs and unknown envelopes. The ephemeral test covers insert certification, deletion, sweep, incarnation mismatch and ring gaps.

## Chromium qualification

Run `node scripts/qualify-revocation-retention.mjs` after building the binary, wasm and package. It starts real `snapback4 dev`, Vite and Chromium, opens a real wasm device and mounts raw/facade watches plus React `useQuery`/`usePage`. Its bridge holds completed device query calls while sync and real storage commits continue.

Chrome 151.0.7922.34 on Linux: eight held re-reads, 24 competing observations, nine new messages, eight receipts and eight reactions. At 1,502 ms every mounted surface remains `revalidating`, zero `loading` publications occur, and release converges to ten messages. Controls in the same harness:

| Change | Withdrawal after request start | After device commit |
| --- | ---: | ---: |
| Delete | 1,008 ms | 991 ms |
| Unsend | 1,010 ms | 990 ms |
| Rule-column move | 1,016 ms | 992 ms |
| Membership removal | 19 ms | 2 ms |

Wall timings include transport and scheduling. The controlled-clock tests establish the exact episode boundary. The unsend fixture deletes the message; this is not a separate client-side hiding convention. See `chromium-final.log` for certificates and surface states. Each control drains prior-phase work before holding the next reads; the existing exclusion of local capacity wait remains in force.

## Verification ledger

The initial invocation and a Rust follow-up were terminated by the model-capacity restart, so neither has a final summary. One complete `bash scripts/test.sh` invocation after recovery finished with this exact summary:

```
== 1 failure(s) in 1459 s
   client tests
```

The failed phase had **5,769 tests: 5,758 passed, one failed, ten skipped**. Its only failure was **ours**: the newly added two-event dependency-plan regression ran in a worker that had loaded the package before its fix. The rebuilt package passes all 16 RV cases and the 95-test affected retention/bound/expiry sweep. The full run is not relabeled green. The later native-only lazy-metadata adjustment also passes the final codec, server protocol and Chromium checks.

The complete Rust inventory passed (282 binaries, 995 executions and doctests), as did both app typechecks, fixture wrappers, package checks, release guard, wasm and docs budgets. All **79 client-model tests passed**, retaining all 5,000 online + 5,000 local three-runtime session seeds and 3,000 online-client interleavings. Runtime exceeded the script's 60-second target; no rebuilt baseline timing or performance attribution is claimed.

[FAILURES.md](FAILURES.md) names and attributes every failure in the interrupted invocation and the complete one, including the unchanged row-existence test that passes in the complete run. Logs are retained with trailing whitespace normalized; follow-ups do not rewrite earlier outcomes.

- Whole guide: 110 passed, zero failed (`guide.log`; also passed in the complete Rust inventory).
- Final plan-retention/bound/expiry sweep: 95 passed (`plan-retention-final.log`).
- Compiler/authorization classifier: three directed tests passed (`classifier.log`).
- Ephemeral engine: 16 passed (`ephemeral-classifier.log`).
- Initial affected client sweep: 465 tests, 444 passed, 21 failed; the failures were lane-owned old expectations and missing-metadata handling, fixed with focused follow-ups.
- Focused queue/linger follow-up: 51 passed (`retention-followup.log`).
- Focused bound/failure follow-up: 92 passed (`bound-followup.log`).
- Expiry follow-up: 28 passed (`expiry-followup.log`).
- Raw deadlines, episode and existence follow-up: 88 passed (`deadlines-followup.log`).
- Device codec follow-up after lazy server metadata: 12 passed (`codec-final.log`).
- Final server wire test: 1 passed; final server protocol suite: 16 passed (`server-wire-final.log`, `server-protocol-final.log`).
- Publication structure and codec census: 27 passed, four macOS-only skips (`publication-structure-final.log`).
- Event-slot follow-up after Rust trace generation: 48 passed (`event-slots-followup.log`).
- Delivery await census: new classifier file has zero awaits; all existing hashes/classifications stay unchanged (`delivery-census.log`).
- `ref-check --verbose`: passes; final count recorded in `ref-check-final.log`.

## Wasm

Locked size-first build: **2,032,740 bytes raw / 610,046 bytes gzip**. The prior budget was 605,225 bytes gzip; this artifact exceeds it by 4,821 bytes. With the user's explicit authorization, the same commit raises `metrics/wasm-budget.json` to **610,546 bytes**, measured size plus **500 bytes** cross-host headroom, with the reason in the ratchet record.

Against the recorded starting artifact (2,015,329 raw / 604,725 gzip), the whole-artifact delta is +17,411 raw / +5,321 gzip. That control was not rebuilt here. No per-feature size attribution is claimed. Runtime meter, row, heap and batching ceilings are unchanged.

## Round 1 — Astra and Grok review corrections (2026-10-02)

Base: `87ec64d87247cb76be768530e51c1e9464a41062`, same lane and branch. The operator reports the round-0 darwin-arm64 publication fence passed **5/5**, with macOS wasm **610,154 B gzip**. That supersedes the round-0 report's pending-fence note; it is not a round-1 macOS qualification.

### Changes and authorization audit

**P1:** the shared classifier now walks each `Table.written_by` authority whose `audience` flag is false and records its **owner column** using the same dependency operation as a read-rule field. It does not depend on the private value. A private value edit remains preserving; an owner transfer may revoke disclosure even on a public row. `readable by audience` fields do not acquire an owner dependency. No client timer or invalidation implementation changed.

The scoped orientation used LLP 3000 (the Snapback 4 root), LLP 2000.000, LLP 3000.023 §12, LLP 3000.015 §1, and the current client, reads, rules and assets guide. Both .023 and .015 are in `llp/current/`. The audit followed compiled `Schema`/`Table`, `Disclosed::visible`, `authorize_image`, rule evaluation, field delivery, `recorded::public_image`, asset access and the existing classifier. Findings:

| Decision/input | Coverage and disposition |
| --- | --- |
| Private field ownership (`written_by.owner`) | **Missing in round 0; fixed.** Includes owner defaults: an override or removal still changes the owner column. |
| `written_by.audience`; table `public`/read markers | Compiled schema facts, not per-commit values. Audience-readable fields have no owner-dependent read restriction; schema/program changes keep the existing hard fence. Private-value-only edits remain ordinary staleness. |
| Row read rules, service grants, positive/negative `exists` probes | Existing exhaustive `RuleExpr` walk records local terms and conservatively depends on whole target tables. Viewer/credential changes are already hard boundaries. |
| Sync audience columns and membership targets | Existing column/whole-target dependencies, including recursively encountered field owners. |
| `through`, inherited residency, maintained sources, row-key owners and captured parents | Existing recursive whole-input dependencies and reference-column walk. Maintained values can change without removing disclosure. |
| Row and witness expiry, inherited deadlines, ephemeral lifetime | Existing expiry-column, `$deadline` and `$parentDeadline` dependencies plus independent published `nextExpiry` fences. Time passing does not need a row commit. |
| Image/video references, including optional/nested lists | Existing recursive asset-column dependency. Placement/removal can revoke asset access even while the row field remains present. |
| `once` per-reader consumption ledger | Already unknown, including a zero-length commit interval. Real consumption has no public row commit; no certificate is invented for it. |
| Recorded captures, event slots and internal deadline fields | Query output hides these by schema-defined projection; they are not separately disclosed per reader. Dynamic inherited authority is covered above; device coverage/program boundaries stay unchanged. |
| Defaults, sequences, indexes, constraints, update rules, leave/horizon metadata | No additional per-reader field projection decision. Their effects on row images flow through the existing read/audience/expiry dependencies; ordering and filtering remain answer replacement. |

No additional omitted per-reader field-disclosure input was found. The missing owner dependency is shared by ordinary values and private asset fields. The Postgres evaluation adapter remains conservative: its transaction tail records commits without `_change_evidence`, so it emits no preservation certificates. A missing-summary-table control verifies widening; this round does not claim a new live Postgres qualification.

**P2:** `record_commit` deletes evidence at or before `seq - 1000` inside the same transaction. This retains twice the 500-commit certification window. Rollback restores both the pruned summaries and the attempted insert. Missing/pruned/overlong intervals certify nothing; the latest 500-commit interval still certifies. Opening an old native device still creates no evidence metadata.

**P3:** the publication comparison strips `preserved` only for successful `apply`, `admit` or `settle` envelopes (both replies have `ok`, neither has `denied`). It keeps the 256-entry limit and bounds each string to 128 characters. Controls reject missing/denied/mixed envelopes, 129-character and million-character names, 257 entries, malformed lists and other operations; exact boundary sizes pass.

### Stronger model and regressions

The oracle now stores, for each viewer/table/id, the **set of disclosed field names** and the engine's deadline. Every certified commit must retain each authorized row and every previously disclosed field. Values may change. Unconditional point reads prove authorization independently of ordered/filtered query membership.

Seeds: `0x52560001`, `0x52560002`, `0x5256cafe`, `0x5256beef`. Viewers: `a`, `b`, `dev:alice`, `dev:bob`, `outsider`, `service:auditor`.

- Guide/fixture corpus: **90 schemas**, one no-durable-table schema skipped; **11,520 physical commits**, **601,860 certified viewer/table checks**, **885,943 retained rows**, **3,254,742 retained fields**, **8,062 revoking row losses**, **16 field losses**, **242 clock-induced losses** covered by deadlines.
- Real mutation model: **512 steps**, **572 commits**, **275 expiry-maintenance calls**, **1,614 certified checks**, **3,696 retained rows**, **19,096 retained fields**, **306 row losses**, **27 field losses**, **1,002 clock-induced losses**, **63 preserving ordered-limit changes**. These counts exclude the 16 initial seeding mutations.
- Asset model: four type shapes (optional image/video, nested images, nested once images), **32 real placement/removal mutations**, **4 per-viewer once consumptions**, **216 access checks**, **16 asset sweeps**. Asset inventory is fixture-supplied; placement, access, consumption and cleanup use engine APIs.
- Directed controls prove owner transfer revokes private disclosure, private-value edits preserve it, audience-readable owner transfers preserve it, same-ID filter exit preserves it, and limit displacement preserves it while the next query returns the new selection.

Time advances between corpus/model commits. A time-only loss must have a previously published deadline at or before the new clock; the subsequent commit is compared at that same advanced clock. This tests the separate hard expiry boundary instead of treating time loss as a commit certificate. The model still uses bounded generated values and physical states, not an exhaustive proof of every application/program. Failed point reads cannot establish a before-authority claim; loss of a previously successful result under certified evidence fails the oracle.

**Negative controls:** before changing production code, the stronger oracle ran on the `87ec64d872` implementation and failed exactly on Alice losing `secret` from the still-readable P1 row (`round1/p1-baseline.log`). Both review schemas also fail through the retained round-0 server binary and public online client over each channel: four failures, with the original 16 tests passing (`round1/client-baseline.log`). A second control rebuilt exact `87ec64d872` in a clean detached checkout with its own target directory: the new oracle fails on the same missing `secret`, and all four public-client cases fail on the same retained-field assertion (`round1/p1-clean-baseline.log`, `round1/client-clean-baseline.log`). The injected model test was then restored, leaving that checkout clean. After rebuilding the lane, all **20** public-client RV cases pass, including withdrawal after 1,600 ms with replacement reads held, fresh-query redaction, and convergence after release. Both the acknowledgement and real `/changes` response exclude the affected table.

Expiry controls pass on online, native and wasm clients: a preserving answer remains visible at 2,999 ms and one millisecond before its row deadline, then withdraws at that deadline while replacement reads remain held. All **31** cases in `keep-expiry.test.mjs` pass. The 500/501-commit history boundary, rollback and missing metadata controls pass.

### Evidence history measurements

Command, before and after: `cargo test -p snapback4-core --test revocation_history measure_history -- --ignored --nocapture`. Three fresh on-disk SQLite stores per version, 20,000 transactions updating one row, same optimized test profile. The transaction includes the row write, evidence and commit metadata. JSON totals and `dbstat` pages below count **only `_change_evidence`**, not `_commits`, indexes or WAL. No vacuum is required for the steady-state result.

| Commits | Before summaries / JSON B / SQLite B | After summaries / JSON B / SQLite B |
| --- | --- | --- |
| 1,000 | 1,000 / 90,993 / 106,496 | 1,000 / 90,993 / 106,496 |
| 10,000 | 10,000 / 909,993 / 1,028,096 | 1,000 / 91,000 / 110,592 |
| 20,000 | 20,000 / 1,819,993 / 2,052,096 | 1,000 / 91,000 / 110,592 |

Mean microseconds per commit across three trials:

| Segment | Before | After |
| --- | ---: | ---: |
| 1–1,000 | 120.809 | 90.280 |
| 1,001–10,000 | 86.395 | 71.611 |
| 10,001–20,000 | 86.250 | 72.519 |

The bounded version adds one indexed deletion per transaction and shows no write-cost regression in these samples. These are sequential measurements on a shared host, not a claim that pruning alone causes the observed speedup. Raw trials: `round1/history-before-2.log`, `round1/history-after.log`.

### Qualification

- Whole guide: **110 passed**, zero failed (`round1/guide.log`).
- Public-client RV plus publication allowance: **21 passed**, four darwin-only comparisons skipped on Linux (`round1/client-fixed.log`).
- Exact expiry/retention suite: **31 passed** (`round1/expiry.log`).
- Chromium 151.0.7922.34 on real wasm: eight held rereads, 24 competitors, all four surfaces `revalidating`, **zero loading publications after 1,501 ms**, successful convergence. Delete/unsend/rule-column withdrawal took **1,007/1,006/1,012 ms** from request start (**993/994/999 ms** after device commit); membership loss **14 ms** (**1 ms** after commit). `round1/chromium.log`.
- Reference check: **525 LLP docs, 10,069 refs in 31,489 files, zero errors/unchecked** (`round1/ref-check-final.log`, including report/journal additions).

The complete Rust inventory ran **283 test binaries / 996 executions plus doctests**, including **5/5 final soundness-model tests** and the bounded-history test. It reports two failures, both reproduced with identical values in a separate clean `87ec64d872` checkout: `sqlite_allocation_probes` (13,240 B versus an 8,192 B bound) and `search_heads_and_overlap_ignore_posting_population` (one extra physical call/payload and four VM steps in its comparison baseline). See the [failure ledger](FAILURES.md) and `round1/baseline-allocation.log` / `round1/baseline-scale.log`. No related implementation or assertion was relaxed.

The full client phase passes: **5,776 tests, 5,766 passed, zero failed, 10 skipped**. This includes the four ownership regressions, three exact-expiry controls and publication allowance. All **79 client-model tests** pass, retaining the full configured seed counts. Both app typechecks, fixture wrappers, package checks, release guard, wasm and docs budgets pass.

One complete `bash scripts/test.sh` run (exit 1) finished with this **exact** summary:

```
== 1 failure(s) in 1429 s
   cargo test
```

The one failed phase contains the two baseline failures above. Final qualification failures: **ours 0; baseline 2 tests / 1 phase; environmental 0**. The four platform-dependent publication comparisons are skips, not passes or failures. The full run exceeds the script's 60-second target; no timing regression or performance attribution is claimed. Every development fixture failure and intentional negative control is retained and attributed in [FAILURES.md](FAILURES.md). Final production code was unchanged throughout this complete run. Logs have only trailing whitespace/newline normalization; the full log is `round1/test-sh.log.gz` and its exit status is `round1/test-sh.exit`.

### Wasm and scope

Locked Linux build: **2,032,879 B raw / 610,174 B gzip**, **+139 raw / +128 gzip** versus round 0. The growth is the missing field-owner walk required on the shared device/server classifier; server-only history pruning contributes no wasm code. The classifier stays on the device because local admit, settle and apply replay cannot be certified solely by a server interval.

Budget: **610,782 B** (the macOS estimate remains unqualified). Round 0's measured macOS artifact was 108 B above Linux; applying this round's +128 B estimates **610,282 B**, with **500 B** reserved above that estimate. Round-1 macOS was not measured here: the local fleet file is absent, and no qualification host was supplied in response to the asynchronous request. The budget leaves 628 B over the supplied, actually measured round-0 macOS figure, and 500 B over the round-1 estimate; an operator must still check the actual round-1 macOS artifact before publication. No round-1 macOS fence pass is claimed. Runtime ceilings are unchanged. No push or publication.
