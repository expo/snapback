# Lane OS — round 2, review corrections

**All four Astra findings repaired; Grok's publication finding and test gaps
covered. Round 1's wasm budget failure remains.** Nothing pushed or published.
[Round 0](./ROUND0.md) and [round 1](./ROUND1.md) preserve their reports, matrices
and full failure ledgers. Round-2 logs are in `round2/` (gzip-compressed).

Started on `sb4-intent/os-ordinary-search` at `d05e9d8df`. First fetched and merged
`origin/main`; merge commit `1ce4f594e` preserves both sides of the RFC revision
line and journal conflicts, including DG rounds 0–2 and OS rounds 0–1.
Read both lane prompts, both reports/journal entries, all of Astra's round-0
NOT READY review and Grok's available round-0 review. Applied `llp-orient`
read-only using the initialized lane-a5 skill copy. No tool was installed,
shared path changed, other lane modified or original evidence database opened.

## Corrections and regressions

1. **System execution:** skip inferred membership substitution for
   `Context::system()`. The regression compares every page, continuation,
   completeness and cut with the original evaluator, using an inert authored
   guard to select that evaluator. It sees all 12 non-tombstone messages across
   three rooms, including Bob's room. Before the fix the first page was empty.
2. **Optional index admission:** capture candidate operation names, bind the
   mandatory schema and program first, then propose the scoped index. Commit
   it to schema/catalog only after the runtime audience proof, structural schema
   validation and existing key/label budgets succeed. A declined candidate leaves
   no optional index or diagnostic. Both Astra schemas (`room: text <=380`,
   denied/readable discovery) compile with the baseline schema/IR and produce
   identical data, completeness, continuation and meter receipts. Denied
   discovery at width 20 also adds no index. A separate near-limit table-name
   case proves optional label overflow does not reject baseline compilation.
3. **Scope order:** prepend the scope to the bound ordinary index, preserving
   every equality pin, word component and cursor suffix. `zone` now provisions
   `[zone, tombstone, words(body), at, id]`. With 20,000 newer unreadable coffee
   rows, all eight authorized rows paginate completely against the explicit
   oracle. Previously recognition declined before execution.
4. **Standalone test:** the fixture contains one bare query, no explicit,
   guarded or held search and no declared scoped words index. It checks the
   precise index relationship, composition metadata, unchanged bare IR and
   complete four-page traversal against an explicit oracle in a separate engine.
   Replacing `intent_search::capture` with a no-op now fails this test.

Grok's complete-empty server replacement is already repaired by round 1's SDK
composition. New process and wasm tests leave **both** chats, assert that the
server sends `[]`, complete, and require the local answer to retain the newest
20 delivered hits with an honest incomplete continuation. Disabling the SDK
composition route reproduces the lost hits on both tiers. The existing mixed
retained-dominant case remains green. No stopgap suppression of current results
was added.

Grok's sync-proof mutation now fails a direct bound-schema test for mismatched
target and prefix (plus public sync), isolating the runtime admission condition
from earlier compiler refusals. A new process/wasm continuation test compares
exact offline IDs after a real server cursor against an independently sorted
full `(at, id)` oracle; accepting an arbitrary array is no longer sufficient.

**Deliberate behavior change retained from round 0:** an admitted bare
membership-audience word search changes from an empty incomplete server result
to the compact membership page. Explicit membership, guarded and held programs
retain their meaning. System queries and declined inference candidates retain
the original evaluator. No authorization or runtime meter ceiling changed.

## Acceptance matrix

| Requirement | Round-2 status and evidence |
| --- | --- |
| System compatibility | Pass: complete traversal matches original evaluator; no inferred scope proof. |
| Optional key/label admission | Pass: both 380-character schemas, small denied discovery and label-overflow controls preserve baseline schema/behavior. Restoring pre-fix provisioning fails both review schemas. |
| Scope after another equality pin | Pass: `zone`, 20,000 newer hidden rows, exact scope-first index and complete traversal. |
| Genuine standalone provisioning | Pass: one bare query; disabling capture fails. |
| Sync audience proof | Pass: mismatched target/prefix/public rejected; deleting the exact target/prefix guard fails. |
| Hidden population, refusals and existing programs | Pass: hidden receipt equality, opening refusal, emitted-prefix drain, held/guarded/explicit controls and all original builder IR/index controls rerun. |
| u0500 / coffee at full scale | Round 1's process/wasm evidence remains: each 501 pages / 10,014 unique IDs. Not rerun against the full copied store this round. Original builder compilation/IR/index equivalence rerun. |
| Retained dominates page one | Pass again on both real devices: 20 fetched server hits remain unconsumed, all 65 independently enumerated IDs appear exactly once, including full-key Unicode ties. Full-builder dominance evidence remains round 1's. |
| Complete empty current server | New pass on both real devices: all chats departed; local retained hits survive the server's complete empty page. Old replacement-route mutation fails. |
| One invocation / mixed drain | Pass again: the real 4,077-scope drain fixture and synthetic cut-stream traversal keep one invocation, constituent cuts and consumed prefixes. Builder-specific 245-scope × 32-word drain remains round 1's evidence. |
| Shared ledger | Pass again: real-device prepaid exhaustion and SDK decoding/coordinator exhaustion; counters cannot reset. Budget remains the existing device `Ceilings::default()` per-page allowance. |
| Membership during delivery | Pass again: held response withdrawn after leave sync, without refetch. |
| Link change and exact cursor suffix | Pass again for coverage-domain restart; new process/wasm server-cursor-to-offline tests require exact IDs. |
| Reset, state loss, reopen | Pass again on both tiers for reset and reopen; recomputation loses/skips no unconsumed hits. |
| Retained edits, expiry, rejoin | Pass again: delivered image survives remote edits, expiry withdraws delivery, unsynced rejoin withholds stale composition and synced rejoin uses current data. |
| searchChat floor matrix | Round 1's full builder current/departed × online/offline, exact acquisition-floor and rejoin matrix remains; no per-chat implementation change. |
| Guarded control | Rerun: explicit guard still returns NOT_MEMBER. Full builder's guarded searchIn floor/departure control remains round 1's. |
| Mounted React | Pass again: same operation across current, departed, offline and rejoin. Expo remains separately unwitnessed. |

## Qualification

Final checks after restoring every mutation:

- Affected Rust: **51 passed / 0 failed** — 16 ordinary search, 24 membership
  search, 11 search merge (`affected-rust.log.gz`).
- Whole guide: **92 passed / 0 failed** (`whole-guide.log.gz`).
- Affected compiler/library: **73 passed / 0 failed** — library tests plus
  intent order, variants, review, predicates, target and search guidance
  (`affected-compiler.log.gz`).
- Native build, client build and client typecheck: **pass**.
- Final public-client/coordinator tests: **26 passed / 0 failed**, process,
  wasm and mounted React (`merge-final.log.gz`).
- Reference audit: **522 LLP docs, 9,768 refs, 0 errors, 0 unchecked**.
  Original input hashes, including SQLite/WAL, unchanged; diff checks pass.

The merge tests also ran immediately after the system fix (22 passing cases),
and after optional admission/scope-order fixes (26 passing cases). The latter
includes the four new process/wasm cases. No round-1 merge regression was found.

The required full suite **was not rerun**, per this round's instruction. Round 1
ran it once, exact summary **`== 1 failure(s) in 1816 s`**, with only **wasm build
(ours)** failing. Its 3,864 client passes / 10 skips and 79 model passes remain
historical evidence, not a claim of a round-2 full-suite run.

## Wasm and remaining scope

Canonical `scripts/build-wasm.sh`: **2,044,274 B raw / 593,309 B gzip**,
**0 B raw / 0 B gzip delta from round 1**, unchanged **586,193 B** cap,
**7,116 B over budget**. This is **ours, inherited from OS round 1**; it is not a
new regression or a baseline-main failure. These fixes live in the compiler and
server-only substitution. The build uses Rust 1.97.0 / wasm-bindgen 0.2.127 with
no wasm-opt, as in the lane's previous measurement. No budget raised.

The full RFC, broader §6 costs and Expo recipe qualification remain outside this
round. The lane still lacks wasm budget qualification; no publication claim.

## Every failure and classification

- **Ours, expected pre-fix regressions:** system empty result, oversized optional
  key and alphabetically misplaced scope all failed the first executable run
  (`review-regressions-red`). Both denied and readable oversized schemas fail
  separately when restoring the old compiler (`mutation-old-index-provisioning`).
  These reproduce OS round-0 bugs, not main-baseline failures.
- **Ours, expected mutation failures:** no-op capture fails the standalone test;
  removing the sync target/prefix guard fails its dedicated proof test; disabling
  SDK composition loses departed hits in both process and wasm tests. Every
  temporary mutation was restored before final qualification.
- **Ours, initial test compilation:** three assertions compared `Option<&String>`
  with `Option<&str>`. Corrected by mapping the column reference to `str`; the
  failed build is retained as `review-regressions-before`.
- **Ours, operational reads/edits:** early discovery tried missing report/guide/skill
  paths before finding the actual files. One test-edit command repeated the
  `snapback4/` prefix while already inside that directory and changed nothing;
  it was rerun at the correct root. Several log-tail probes preceded log creation.
- **Ours, inherited budget failure:** `wasm.log` exits 1 at the unchanged cap.
  The artifact builds successfully; its size is unchanged from round 1.
- **Baseline:** none observed in this round. **Environmental:** none observed.

Prior-round failures remain exhaustively recorded in ROUND0.md and ROUND1.md.
Reproduce from `snapback4/`:

```sh
cargo test -p snapback4-sim --test ordinary_search --test membership_search --test search_merge
cargo test -p snapback4-lang --test guide
cargo test -p snapback4-lang --lib --test intent_order --test intent_variants --test intent_review --test intent_predicates --test search_guidance --test intent_target
cargo build -p snapback4
bash scripts/build-wasm.sh # known unchanged budget failure
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
node --test --test-concurrency=1 packages/snapback4/test/ordinary-search.test.mjs packages/snapback4/test/ordinary-search-ledger.test.mjs
```

Cargo qualification used `CARGO_BUILD_JOBS=8`, `CARGO_PROFILE_DEV_DEBUG=0`,
`CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_INCREMENTAL=0`,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and `RUST_TEST_THREADS=8`.
Native/client builds precede final public-client tests. Logs preserve all expected-red runs as well as green
reruns. No scripts/test.sh invocation belongs to round 2.
