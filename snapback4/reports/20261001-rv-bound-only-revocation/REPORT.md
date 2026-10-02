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
