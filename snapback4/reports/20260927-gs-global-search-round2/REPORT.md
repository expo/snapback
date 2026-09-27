# Lane GS round 2 — review repairs

2026-09-27. Local branch `sb4-intent/gs-global-search`. Read both complete
reviews, both earlier reports and journal entries, both binding prompts, and
LLP 3000.024 including its Decision. First fetched and merged `origin/main`
as `c86450e6d`. The sole conflict was JOURNAL.md: both parents' lines remain
verbatim and in order (verified as ordered subsequences before the merge
commit). No push or publication. All local commits carry the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer.

## Changes by file

Paths are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/Cargo.toml` | Adds the default server-only `server-search` feature. The existing device Wasm command does not enable it. |
| `crates/snapback4-core/src/lib.rs` | Exposes the shared server search-plan helpers only with that feature. |
| `crates/snapback4-core/src/search_plan.rs` | One eligibility predicate for runtime and certificate; declared-reservation fallback; schema-derived grouped, scoped and bare repairs; compiler/evaluated binding recovery. |
| `crates/snapback4-core/src/search_plan/print.rs` | Fallible Quarry rendering from bound scans, preserving scalar pins, residual filters, real order, direction, take and cursors. No prose or guessed compiler locals in query text. |
| `crates/snapback4-core/src/engine/read.rs` | Gates compact dispatch and selected state, and explicitly keeps device execution on its existing evaluator even when Cargo unifies server features during tests. |
| `crates/snapback4-core/src/engine/extrema.rs` | Gates compact key/head consumers. |
| `crates/snapback4-core/src/engine/authorized_point.rs` | Gates the selected-field adapter argument and branch; ordinary authorization and decoder admission are unchanged. |
| `crates/snapback4-core/src/engine/authorized_scan.rs`, `src/rows.rs`, `src/store.rs` | Gate the selected-row adapter and decoder module used only by compact server search. |
| `crates/snapback4-core/src/engine/row_views.rs` | Conditional argument at the shared authorized-scan call. |
| `crates/snapback4-core/src/engine/membership_search.rs` | Moves eligibility to the shared helper and attaches the bound grouped repair to the refusal. No ordering, meter or cursor algorithm changes. |
| `crates/snapback4-core/src/error.rs` | Gates the server-only refusal variant and publishes its constructed repair instead of hard-coded table/column names. |
| `crates/snapback4/src/scale/search.rs` | Classifies actual runtime eligibility; describes old cuts on the bounded explicit merge; confines decoration warnings to roster scans under message hits. |
| `crates/snapback4/src/scale/search_tests.rs` | Existing classifier test extracted plus five review regressions. |
| `crates/snapback4-sim/tests/membership_search.rs` | Four new runtime regressions: large declarations, exact visible counts, cross-word ordering, and compiled/executed refusal repairs. Existing refusal assertion now checks query text. |
| `crates/snapback4-sim/tests/search_global/mod.rs`, `search_global/forms.rs` | Distinguish server/device meter and envelope expectations while sharing exact answer fixtures. |
| `crates/snapback4-device/tests/search_global/forms.rs` | Pins the device's existing evaluator and compares every complete shared result and cursor directly with the server. |
| `crates/snapback4-lang/src/guide/search_all.md`, `guide/why/SEARCH.md` | Explain the server/device and wide-declaration fallback boundary and accurate diagnostic actions. |
| `../llp/3000.024-global-search-beyond-one-read.rfc.md` | Records round-2 feature scope, fallback and diagnostic contracts in the existing Decision. |
| `../issues/20260927-snapback4-server-watch-offline-freshness-flaky.md` | Records the reproduced baseline full-suite failure and follow-up. |
| `JOURNAL.md`, this report, qualification evidence | Append-only results and reproducible review record. |

## Findings and tests

1. **Wasm:** compact evaluator, its selected-field path/consumers and
   E_SEARCH_OPEN are absent without `server-search`. Device dispatch also
   stays old when native test dependencies unify the feature. Shared fixtures
   pin 3M+40 device examinations versus 2M+40 server examinations. The device
   keeps its existing heap-null boundary around 2,700 memberships; the server
   retains its measured compact envelope. Every complete shared device page
   and cursor equals the server result. No budget file changes.
2. **Large declaration:** the explicitly permitted fallback is implemented.
   Tables whose `decode_reservation` exceeds the default 16 MiB heap remain on
   the existing metered evaluator. The new test stores one membership and one
   tiny message with `body: text <=2000000`, no expiry: both the membership
   form and old explicit merge complete, return `hit`, and agree on data; the
   membership read uses less than 100,000 heap bytes. Both selected heads and
   emitted-point admission remain declared-size on the compact path; neither
   is silently relaxed. This round does not introduce actual-size private
   row admission.
3. **Grouped repair:** derive membership/message tables, scope fields,
   parameter names, scalar pins and residual filters from bindings. Put the
   original filters in both the existence search and preview. The runtime
   test compiles each emitted repair against its originating schema (`room`
   and renamed `roster`/`posts`/`roomId`), with no diagnostics or notes, then
   executes it: deleted-only and too-old chats are absent, and a deleted newer
   hit in a live chat is absent from its preview. Runtime-only compiler needle
   locals are rendered as the evaluated search literal; no `$intentNeedle`
   leaks into the repair.
4. **Counts:** an interrupted discovery reports exactly two authorized keys
   and the lower-bound wording. Completed discovery with interrupted head
   opening reports exactly four and no lower-bound qualifier. Adding 100
   unreadable memberships leaves the entire serialized refusal unchanged.
5. **Certificate:** N_SEARCH_OPEN uses the runtime predicate, including
   uniformity, source bound, guard/setup/filter and declaration fallback.
   The bounded hand-written merge receives the old heap-null/no-next behavior
   description, not a compact refusal promise. A grouped preview has no search
   warning; only membership/roster scans under a message hit receive
   N_SEARCH_SHAPE. Every recommended repair in the tests compiles without
   compiler diagnostics/notes. Grouped repairs also have no search advice;
   scoped/bare global repairs still correctly expose their independent
   opening/word costs, and no longer trigger the defect they repair.
   N_SEARCH_UNSCOPED preserves first/last, take 7, `.sent` order, `position`
   cursor, `needle` argument, sender and tombstone predicates, with no prose
   appended inside the query. The decoration repair is a bare global page;
   its accompanying message directs separate per-group detail reads.
6. **Cross-word heads:** `chat@100`/`coffee@1` and the converse run ascending
   and descending with one-hit pages. The winner and next page are exact in
   all four walks. This kills the first-word-only mutation: word discovery
   itself is ascending, so testing only chat@100 would not suffice.

## Forms

Existing forms remain accepted. On a schema with `roster(roomId, principal)`
and `posts(roomId, body, sender, tombstone, sent)`:

```quarry
query newest(needle: text <=100, position: cursor ?):
  return posts matching needle where not .tombstone and .sender = viewer and exists roster[.roomId, viewer] last 7 by .sent after position
```

The generated grouped repair uses the real schema and retains both filters:

```quarry
query grouped(needle: text <=100, position: cursor ?):
  return roster[principal = viewer] after position first 7 by .roomId, .id where exists (posts[roomId = .roomId, sender = viewer, tombstone = false] matching needle by .sent, .id) { roomId, hits: posts[roomId = .roomId, sender = viewer, tombstone = false] matching needle last 3 by .sent, .id }
```

The source query remains globally ordered; grouped recovery pages chats and
three previews per chat. Reset the cursor when changing between these forms.
The wide declaration uses the same `newest` spelling and the existing plan.
No new authoring syntax is introduced.

## Qualification

Implementation commit: `ad4ad7cf613cb603fefccf4d7d9dba10750fde26`.
Linux x86_64; Rust 1.97.0, Node 24.13.1, Bun 1.3.14, wasm-bindgen 0.2.127.
Eight Cargo build jobs; dev/test debug info and incremental builds disabled;
file descriptor limit 65,536 for the full suite. Frozen Bun install passes.

Affected checks pass: runtime membership 10/10; certificate 6/6; shared
server search 17/17; shared device search 50/50; device authorization and
census 81/81; merge search 11/11; entire guide 86/86. Runtime and certificate
pass again after restoring every negative control. Reference audit: 518 LLP
documents, 9,627 references, zero errors and zero unchecked. Whitespace check
passes. Every changed source file is below 1,500 lines; `engine/read.rs` is
1,444 lines.

All **eight negative controls** fail at the intended test assertion, not at
compilation: device routing, declaration fallback, hard-coded repair, dropped
tombstone, zero membership count, lost lower-bound qualifier, first-word-only
head selection, and the old certificate. [controls.json](controls.json) records
commands, mutations, exact failed-test summaries and log hashes. Each source
is restored byte-for-byte in a `finally` block and hash-checked.

The rebuilt CLI also checks **10 emitted repairs** with `check --cost --json`:
all return `ok: true`, no compiler diagnostics or notes. Grouped repairs have
no search advice at all. The scoped/bare global forms retain their valid
opening/word advice, as distinct resource classes; no repair repeats the
scope, opening or shape defect it addresses. [cli-repairs.json](cli-repairs.json)
retains the actual query text and residual advice.

Both the initial isolated build and the full suite's Wasm build measure
**1,983,444 B raw / 572,699 B gzip**, passing the unchanged **572,841 B** gate
with **142 B** headroom. Relative to the round-1 final artifact this is
−27,973 raw / −8,178 gzip bytes. Relative to the recorded same-host baseline
it is +1,932 raw / +646 gzip bytes. No budget change or wasm-opt installation.

Exact full-suite result: **`== 1 failure(s) in 1585 s`**, exit **1**. The suite ran
**once**, against the unchanged implementation commit. Rust: **3,947 passed,
0 failed, 24 existing ignored**, across 244 binaries / 957 executions plus
doctests (1,062 s). Client main: **2,636 passed, 1 failed, 10 existing skips**;
all seven additional shards pass **56/56** (client phase 197 s). All nine
fixture wrappers, both app typechecks, every earlier build/budget gate and
all **78 models** (265 s) pass. The inherited 60-second suite target was
exceeded; no deadline, seeded count or budget was raised.

**Every full-suite failure (one):** `client tests`, specifically
`server-class watches run locally first and recover remembered server data offline`
at `packages/snapback4/test/residency.test.mjs:134`. Its 8-second wait did not
observe `fresh === false` after simulated link loss; message:
`offline watch downgrades the remembered answer` (9,393.988324 ms test duration).
Classification: **baseline intermittent**, exact cause unresolved. The identical
failure is recorded in the round-3 table of
[the lane O report](../20260926-lane-o-pending-writes.md). This test and the client
sources are unchanged between the merged baseline and implementation; its
schema has no word search or membership merge. No lane-owned or confirmed
environmental full-suite failure occurred.

One post-suite focused probe passes **1/1**, with the unchanged assertion and
timeout (180.598508 ms test, 267.290277 ms process). That pass does not turn the
full run green or establish the race's cause. The open follow-up is
[issues/20260927-snapback4-server-watch-offline-freshness-flaky.md](../../../issues/20260927-snapback4-server-watch-offline-freshness-flaky.md).
Reproduce the observed intermittent context with the full suite; the focused
command in the ticket is not a deterministic failure reproduction. No unrelated
client fix was made.

[qualification.json](qualification.json) binds all qualification logs and the
Wasm artifact by SHA-256. [suite-failures.txt](suite-failures.txt) contains the
complete failing stack; [residency-isolated.txt](residency-isolated.txt) retains
the isolated result.

## Scope and remaining limits

The round-1 Decision remains one read. No retained search work, multi-request
continuation, new state lifetime, meter increase, cursor increase or Wasm
budget increase. No original calibration store was opened or changed in this
round. No tool was installed on any shared path.

The permitted declaration fallback is the deviation from implementing
actual-size selected heads and emitted-point fetches this round. Compact
search retains its declared reservations below the fallback threshold.
Device and legacy-plan opening cuts retain their existing meter-null/no-next
semantics; the new compact-server refusal is not promised for those plans.
Reproduce the device boundary with the shared `w13e_newest_measures_complete_page_and_opening_envelope`
fixture; reproduce the explicit-merge classification with
`explicit_bounded_merge_describes_the_legacy_opening_cut`.

Diagnostic rendering is conservative: an unsupported bound expression gets
no fabricated query that could drop part of its predicate. These regressions
cover scalar pins, compound predicates, renamed bindings and the review's
actual cases; they are not a general IR-to-source round-trip proof.


## Reproduction commands

From `snapback4/`, using the existing pinned tools:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
bun install --frozen-lockfile
cargo test -p snapback4-sim --test membership_search
cargo test -p snapback4 --bin snapback4 scale::search
cargo test -p snapback4-sim --test clique search_global
cargo test -p snapback4-device --test device search_global
cargo test -p snapback4-device --test readauth
cargo test -p snapback4-sim --test search_merge
cargo test -p snapback4-lang --test guide
scripts/build-wasm.sh
ulimit -n 65536
scripts/test.sh
```

Raw round-2 logs and executable control/CLI probe drivers remain under
`target/lane-gs-round2/`. The retained JSON evidence binds their results and
hashes without storing application data or credentials. Earlier development
failures were lane-owned and corrected before the full run: a seed iterator's
missing collect type; a repair test accidentally including the old explicit
merge's existing notes; the unscoped renderer spelling pins as explicit keys
(which prevented membership lowering); and guide definition/action wording.
The CLI probe initially treated any remaining N_SEARCH_WORDS advisory as a
compiler failure; it now distinguishes independent search-cost advice from
`check` errors/notes and the scope/opening/shape defect being repaired.
