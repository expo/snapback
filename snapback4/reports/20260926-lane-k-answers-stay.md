# Lane K: answers stay on screen

2026-09-26. Branch `sb4-intent/k-answers-stay`, base `99153132b`.
Scope: supplied LLP 3000.019 §3.3, parts 1–3. No push or publication.

## Built

- `packages/snapback4/src/react.tsx`: `usePage` returns the ready prefix while
  a subsequent page loads. Its read metadata describes that prefix; `hasMore`
  stays false while the pending page owns the continuation. A first-page
  reset still clears the prefix and closes the suffix; a refusal still
  propagates. Invalid non-array page data keeps the existing loading guard.
- `packages/snapback4/test/react.test.mjs`: changed the old assertion that
  a pending suffix makes the combined read loading. Added a Chromium case
  covering two loaded pages while a third loads, preserved input identity and
  draft, freshness/completeness/cut metadata, a later refusal, a first-page
  reset, a late obsolete reply, and an empty ready prefix.
- `packages/snapback4/README.md`: documents the pagination behavior in the
  existing hooks paragraph, without adding lines or Quarry syntax.
- `packages/snapback4/test/answer-withdrawal.test.mjs`: seven executable
  disclosure counterexamples, described below.
- `JOURNAL.md`: one dated entry for the implementation, measurements, and
  stopped work.

The existing form now keeps the editor mounted while loading more:

```tsx
const page = usePage(api.recent, {});
if ("loading" in page.read) return <Spinner />;
return <><Editor /><Rows rows={page.items} />
  <button disabled={!page.hasMore} onClick={page.loadMore}>More</button></>;
```

No client contract, query language, authorization rule, interpreter, meter,
wasm source, or package version changed. No diagnostics were added.

## Stopped parts 1–2: revocation is also an ordinary commit

The design says to retain on `apply`, `admit`, and `settle` under the same
authority, and also requires immediate withdrawal on authority changes.
These operation names do not distinguish the two cases. The supplied
acceptance requirement that a watch never publishes loading across those
operations cannot hold without an authority-change exception implemented at
the commit boundary. The client currently gets no separate authority-change
signal there. Adding a protocol or deriving an authority classifier would
require deciding that missing part of the design; this lane stops it per the
brief rather than weakening the existing withdrawal rule.

This also preserves the existing `page-authority.test.mjs` regressions for
applied revocation (including fallible work after commit), predicted membership
removal, and predictions that expire either a secret or its authorizing member.
Those are disclosure resets, not merely old spinner expectations to update.

Concrete schema and counterexample, run against both real devices:

1. `secrets.read <- exists members[.room, viewer]`, with `sync to
   members[.room]` and the default until-revoked retention. Alice and Bob are
   members; Bob observes a secret with body `private answer`.
2. Alice removes Bob's membership. The server emits an ordinary sync page
   containing the secret table's `scope` tombstone. The device commits it
   through `apply`. Neither store identity, credentials nor viewer changes;
   no `clear_rows`, `adopt`, resetting `observe_store`, or `settle_exit` runs.
3. Hold the replacement device query. The commit must immediately withdraw
   Bob's previous answer. Keeping it leaves unauthorized data in the snapshot
   for the entire held read. Once released, the real query returns null.
4. Bob's predicted `leave()` has the same problem at `admit`: its footprint
   includes `members/bob`; the old secret answer must disappear before the
   replacement query. A credential comparison does not detect this change.

The online counterexample uses the same server and schema. After Alice's
revocation, hold Bob's refetch triggered by `/changes`: the notification must
withdraw the old answer before the server's new answer returns. The existing
online `refresh` does not enable `retain`, contrary to the design's description
of that path.

Two further cases close Bob's watch before the remote revocation, let its
`apply` commit, and remount with the same operation, arguments, viewer and
store identity. The new watch must start loading, not with the pre-revocation
answer. Thus the proposed 30-second cache depends on the same missing
invalidation decision. It was not implemented separately with an invented
reset policy.

Reproduce the guard cases after building the package:

```sh
node --test packages/snapback4/test/answer-withdrawal.test.mjs
```

All seven pass with the existing withdrawal behavior. A negative experiment
changed only generated `dist/local-reads.js` to keep a data snapshot in
`LocalReads.clear` (still advancing its revision), and enabled `retain: true`
on the existing online watch fetch. Running the five `apply|admit|online:`
cases failed **5/5**: the actual snapshot still contained `private answer`
with `fresh: false`, instead of loading. Generated files were then restored
by `bun run build`; no unsafe retention change is committed. The two remount
cases establish the required invalidation boundary, not an implemented cache.

This stops the universal retention change and the cache, not the goal of
keeping answers for commits known to preserve authority. The supervisor
needs to specify how those commits are distinguished from withdrawals on
both clients. No implementation of `settle` retention or 30-second expiry was
attempted. Existing publication fences, server-answer store-cut ordering,
expiry behavior, and resets are untouched. Part 4 belongs to another lane.

## Verification

- `bun install --frozen-lockfile`, package build: passed.
- Targeted Chromium harness and disclosure cases: 33 passed, 0 failed,
  0 skipped, including the harness's parent test.
- Whole guide suite: 85 passed, 0 failed, 0 ignored.
- Wasm: 2,021,689 B raw; 581,094 B gzip; budget 582,094 B. This matches
  the recorded 0.4.3 baseline, so the delta is 0 B; budget unchanged.
- Required `scripts/test.sh`: **`== 0 failure(s) in 1352 s`**, exit 0.
  No failures to classify as introduced, baseline, or environmental. The
  main client batch passed 2,131 tests with 10 existing skips; the final
  model batch passed 78 with no skips. All seven new disclosure cases and
  the Chromium pagination case passed in this run. This was a cold test
  build, with `CARGO_BUILD_JOBS=8`, `CARGO_PROFILE_DEV_DEBUG=0`, and
  `CARGO_PROFILE_TEST_DEBUG=0`; the script was run once, unmodified.

## Round 1 — 2026-09-26: revision 3 misses authority in the protected row

**Parts 1 and 2 stopped again under the explicit counterexample clause.**
Revision 3's specified authority tables are the tables the watched tables'
read-rule `exists`, lookup and witness probes read. That set can be known
exactly and empty while a normal commit revokes the viewer's read access.
The native/opaque fallback therefore does not repair this case. Round 0's
`usePage` implementation remains intact.

### Built, file by file

- `packages/snapback4/test/answer-row-authority.test.mjs`: seven real-client
  regression guards for ownership transfer. The fixture checks the actual
  `/schema` representation, real commit footprints and device read results;
  it holds the replacement read across the assertion. No fake authorization
  verdict is substituted.
- `reports/20260926-lane-k-answers-stay.md`: this round-1 record, including
  the counterexample, experiment and verification.
- `JOURNAL.md`: one dated round-1 entry with the counterexample, measurements
  and final suite result.

No production client or engine change is made in round 1. The original seven
`answer-withdrawal.test.mjs` guards remain unchanged. No new syntax,
diagnostic, contract, version, meter or wasm-budget change is introduced.

### Compiling and running counterexample

These existing forms compile and run on the server and both devices:

```quarry
use personas alice, bob
table secrets:
  owner: principal
  body: text
  read <- .owner = viewer
  update <- allow
  sync to .owner
query secret():
  return secrets['private']
mutation transfer():
  update secrets['private'] { owner: 'dev:alice' }
```

Seed `secrets/private` with `owner: 'dev:bob'` and `body: 'private answer'`.
Bob observes `secret()`; its read rule in `/schema` is exactly
`{"Eq":[{"Field":"owner"},"Viewer"]}`. It contains no rule probes. The
query has an ordinary nonempty Quarry program body and is not native.
The schema has only the `secrets` table.

1. Run `transfer()` on the server as Bob. The next ordinary `apply` has
   `touched: ['secrets']` and a `del` event for Bob's old copy. Or call
   `client.mutate({ kind: 'mutation', name: 'transfer' }, {})` as Bob: its
   `admit` genuinely predicts `['secrets/private']`.
2. Neither commit touches a probe table: the authority set specified in
   revision 3 is empty. Neither triggers `clear_rows`, `adopt`, resetting
   `observe_store` or `settle_exit`; the viewer, credential and store identity
   stay the same.
3. A direct read of the real device now returns `null`. Bob can no longer
   read the row. Hold the client's replacement query at this boundary.
4. Revision 3 would keep the former owner's `private answer` visible until
   that query completes. Advancing the in-flight revision does not remove a
   snapshot already published. Marking it `fresh: false` does not withdraw
   its private data.

The cache has the same counterexample: close Bob's watch before the transfer,
let the client consume that commit, and remount the identical key within
30 seconds. The empty authority set fails to evict the old answer. On the
online client, a second watch keeps `/changes` running; the test waits for a
`secrets` notification at or beyond the transfer's returned sequence before
remounting the closed key with its new query held.

### Tests and negative experiment

The seven new guards are:

- wasm and process `apply` (two): a committed owner transfer immediately
  withdraws the old answer, before replacement evaluation;
- wasm and process `admit` (two): a predicted owner transfer does the same;
- wasm and process remount (two): a watch closed before the transfer cannot
  initialize a new observation with the former owner's answer;
- online remount (one): consuming the transfer notification also invalidates
  a closed key, before its new HTTP answer arrives.

A bounded negative experiment changed only generated `dist/local.js` and
`dist/client.js`, modeling revision 3 for this exact empty-authority-set
fixture. It restored data snapshots after the normal local invalidation
(which still incremented the revision), saved closed answers for 30 seconds,
and initialized remounted watches from them with `fresh: false` and `since`.
There is no intersecting authority commit to evict those entries in this
fixture. The experiment is not a general implementation or a claim that all
resets were implemented. **All seven guards failed**, each showing
`private answer` where loading was required. Generated files were restored
in `finally`; none of the mutant code is committed. Logs and exact generated
diffs are kept locally under `target/lane-k-round1-evidence/`.

Reproduce the committed disclosure guards from `snapback4/` after building:

```sh
node --test packages/snapback4/test/answer-withdrawal.test.mjs \
  packages/snapback4/test/answer-row-authority.test.mjs
```

### Deviations and open work

- Parts 1 and 2 remain unimplemented, as directed when a counterexample is
  found. A non-authority `apply`/`admit`/`settle` retention claim, the
  30-second cache and expiry claim, and a new all-reset cache qualification
  are not made. The existing conservative withdrawal behavior remains.
- The authority definition must cover disclosure dependencies in the
  protected row, in addition to the tables of its rule probes. Whether to
  include that table conservatively or distinguish changes to its authority
  fields is a supervisor design decision. This report does not claim that
  either alone is a complete classifier for every schema.
- The checkout's LLP 3000.019 still contains the original §3.3 wording.
  The latest user message supplies revision 3 and governs this round; the
  supervisor-owned RFC was not rewritten by this lane.
- No part-4 outbox work, push or publication was performed.

The governing context was LLP 3000's disclosure invariant, LLP 3000.001
repair B's commit/publication fencing, LLP 3000.007 §18.2's distinction
between retained history and revoked data, LLP 3000.018 §3.2's remembered
answer order, and the current reads/rules/sync guide cards. No governing
behavior was relaxed. The orientation skill was read from the installed
`landingA/vendor/llp` copy because this worktree's skill link is broken.

### Round-1 verification

- `bun install --frozen-lockfile` and package build: passed.
- Targeted disclosure, publication/authority and Chromium React tests:
  **53 passed, 0 failed, 0 skipped**, including all 14 withdrawal guards,
  existing delayed-response publication fences and the round-0 pagination case.
- The bounded retention mutant: **7 expected failures / 7 tests**; restored.
- Whole guide in the full suite: **85 passed, 0 failed, 0 ignored**.
- Wasm in the full suite: **2,021,689 B raw / 581,094 B gzip**, unchanged
  from round 0 (delta **0 B**), below the unchanged **582,094 B** budget.
- Required final `scripts/test.sh`, run **once**, unmodified:
  **`== 0 failure(s) in 1067 s`**, exit **0**. **No failures** to classify
  as introduced, baseline or environmental. Rust: 3,572 passed, 0 failed,
  19 ignored. Main client batch: 2,148 tests, 2,138 passed, 0 failed,
  10 existing skips; the separate client shards also passed. Models:
  78 passed, 0 failed, 0 skipped. All seven new guards passed in this run.
  Node 24.13.1, Bun 1.3.14, `CARGO_BUILD_JOBS=8`,
  `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`.
  Full output: `target/lane-k-round1-evidence/test-sh.log`; exit status:
  `target/lane-k-round1-evidence/test-sh.exit`.

The tests and counterexample were committed as `9b587ae59`; the final
qualification and journal are recorded in the following documentation commit.
No push or publication.

## Round 2 — 2026-09-26: explicit application keep

Implemented the supervisor's revision 4 supplied in the round-2 instruction.
The default remains the conservative withdrawal behavior, and the 14 round-0
and round-1 guards are unchanged. Applications can now opt into retaining a
published answer while its replacement is loading. No push or publication.

### Built, file by file

Paths below are relative to `snapback4/`.

- `packages/snapback4/src/contract.ts`: additive `ObserveOptions` and the
  optional third `Client.observe` argument, with the display trade-off stated
  beside `Read`. No change to the read union, wire or engine authorization.
- `packages/snapback4/src/read-observation.ts`: explicit keep preserves data
  through loading, marks it stale with its existing freshness age, and accepts
  a new answer or refusal. Reset bypasses keep and fences the pending fetch.
  A reset version also protects asynchronous local publication.
- `packages/snapback4/src/kept-answers.ts`: shared observation ownership and
  30-second idle memory. Kept and default watches have distinct keys;
  operation/arguments are scoped to viewer/store incarnation. The last
  unsubscribe or close stores an opted-in answer; remount consumes it and
  immediately re-reads. Timers release entries, deadline checks enforce expiry
  even if timers are suspended, and resets clear all entries. This memory is
  independent of the ordered remembered-server-answer cache.
- `packages/snapback4/src/local-reads.ts`: ordinary `apply`, `admit` and
  `settle` keep only opted-in snapshots while advancing the existing revision.
  The same commit still clears remembered server recovery. Other resets also
  discard idle memory.
- `packages/snapback4/src/local.ts`: wire those decisions into the existing
  synchronous committed hook; preserve store/adoption/exit/reset invalidation;
  clear kept memory on credential changes, sign-out and close. Local re-reads
  cannot publish an answer from before a reset. Shared ownership extraction
  reduces this source from 1,511 to 1,488 lines.
- `packages/snapback4/src/client.ts`: opt-in stale publication during online
  refetches, the same idle memory, immediate credential/viewer/store/adoption
  resets, and preservation of expiry withdrawal and existing sequence fences.
- `packages/snapback4/src/react.tsx`: optional third argument on `useQuery`
  and `usePage`; each page passes the option to its observation, and changing
  the option creates the appropriate resource. Round-0 loaded-prefix behavior
  remains unchanged.
- `packages/snapback4/src/app-client.ts`: forward the option through the
  guarded application client; its lifetime fence still withdraws data.
- `packages/snapback4/CLIENT-AND-OPERATIONS.md`, `packages/snapback4/README.md`
  and `crates/snapback4-lang/src/guide/reads.rs`: document the option, idle
  lifetime, resets and explicit risk of displaying revoked rows until the
  re-read lands. Correct former unconditional claims about online retention.
- `crates/snapback4-lang/tests/fixtures/guide-fact-homes.json`: update the
  existing `reads-06` fact to the revised guide text. No new inventory or gate.
- `packages/snapback4/test/keep-observation.test.mjs`: 23 publication/cache,
  online-client and app-facade tests, detailed below.
- `packages/snapback4/test/keep-device.test.mjs`: 17 tests on real stores and
  the real server, including the online remount case.
- `packages/snapback4/test/keep-reset.test.mjs`: 12 real-device reset tests
  with controlled network replies.
- `packages/snapback4/test/react.test.mjs`: one additional Chromium case for
  both hooks, editor identity/draft, pagination, option changes and resets.
- `reports/20260926-lane-k-answers-stay.md`: this round-2 report.
- `JOURNAL.md`: one dated round-2 entry recording implementation and final
  qualification; prior entries are untouched.

### Forms that compile and run

```tsx
// Keep a screen mounted while an existing query re-reads.
const inbox = useQuery(api.inbox, {}, { keep: true });
// Keep each loaded page while re-reading and keep the ready prefix during load-more.
const thread = usePage(api.thread, { conversationId }, { keep: true });
// The same application choice without React.
const watch = client.observe(api.inbox, {}, { keep: true });
// Existing forms retain their current meaning.
const ordinary = useQuery(api.inbox, {});
```

A retained answer can contain rows whose read authority has already been
revoked. It is a stale presentation of a previously published result, not a
new engine authorization decision. The server and device still evaluate
replacement reads under the current rules. A refusal replaces the data;
a later re-read of that refusal can use the normal loading state.

### Tests and evidence

- Real wasm and process devices: `apply`, predicted `admit` and `settle`
  publish no loading between a published answer and its replacement. A
  simultaneous default watch still withdraws; options cannot leak between
  subscribers. Replacement data, null and a program refusal are exercised.
- Explicit revocation record: applied membership removal and predicted leave
  retain the previous private answer during the held re-read. Applied removal
  checks that the real device already reads null. Releasing the read replaces
  the answer with null (or the fixture's explicit `HIDDEN` refusal).
- All three clients: last-subscriber ownership, immediate remount re-read,
  `fresh: false`/`since`, operation/argument/option isolation, 29,999 ms reuse,
  30,000 ms expiry, sign-out of active and idle data. The unit clock also proves
  the expiry timer physically removes memory, independent of a deadline check.
- Real wasm and process stores: adoption, replacement, credentials, viewer
  change, sign-out and close withdraw active and idle answers while reads are
  held. Replacement/adoption must commit on the real device. Local commit
  tests separately cover `clear_rows` and `settle_exit` through the exact
  `LocalReads.committed` policy used by the production callback; adoption and
  store reset use its unconditional clear path.
- Online client: mutations and change notifications, next answer/refusal,
  active/idle resets for adoption, replacement, same-store regression,
  credentials, viewer, sign-out and close; expiry withdrawal; app-facade
  forwarding and retirement. Online equivalents are notification and receipt
  invalidations: this tier has no device `apply`/`admit`/`settle` calls.
- Publication order: held obsolete evaluations never replace the kept answer
  after a newer commit, on the real wasm/process devices and online. Existing
  default publication and remembered-answer guards remain passing.
- Chromium: both hooks keep the editor and unsent draft mounted during a
  mutation re-read; two loaded pages stay while the third loads. A refusal,
  disabling keep, and sign-out replace the retained display.

The affected run passed **125 tests, 0 failed, 0 skipped**. After adding the
app-facade and explicit online-expiry cases, their targeted file passed
**23 tests, 0 failed, 0 skipped**. The whole guide suite passed **85 tests,
0 failed, 0 ignored**. Package build passed. `./ref-check --verbose` passed:
**512 LLP docs, 9,437 refs in 26,796 files, 0 errors, 0 unchecked**.

### Decisions, deviations and open problems

- No functionality was stopped in round 2. The additive `Client.observe`
  option is the necessary non-React entry point for both requested hooks;
  application guards forward it without bypassing their checks.
- Freshness age uses the existing wall-time semantics. A previously unknown
  `since` remains unknown; no server timestamp is invented for an incomplete
  offline answer. Existing expiry and ephemeral resets of active watches
  continue to withdraw answers.
- The checkout's supervisor-owned LLP 3000.019 still has the original §3.3
  text. The user's explicit revision-4 instruction governs this work; this
  lane does not rewrite the supervisor's RFC. Source annotations target §3.3.
- The compiler has no separate `client` card in this tree: the client-facing
  read guide is `guide reads`, updated alongside the package client guide and
  README. Its existing fact-home fixture now follows the revised statement.
- Implementation orientation used the installed `llp-orient` skill from
  `/home/ccheever/lanes/enginefix/vendor/llp`, since the lane's link is broken.
  No additional agent work was delegated.
- No new Quarry syntax or diagnostic, no interpreter/meter change, no wasm
  budget increase, no outbox work, and no version change. No push or publish.

Commits: `93562adc7` (implementation, documentation and focused tests),
`156952fd5` (real-device and Chromium evidence), `3313ce90d` (freeze the
remount test clock before retirement, so its exact boundary is independent of
host scheduling; applied before the full suite entered its client group). All
carry the requested co-author trailer. Final suite evidence and journal follow in a documentation
commit.

### Round-2 final qualification

- Required `scripts/test.sh`, run **once**, unmodified, completed with:
  **`== 1 failure(s) in 985 s`**, exit **1**. Failed group: **`client tests`**.
- Its sole failed test was **`README TypeScript examples compile and call
  every public function`**. Classification: **introduced by this lane**.
  The new `CLIENT-AND-OPERATIONS.md` snippet omitted imports for `useQuery`,
  `usePage` and `api`, and did not declare `conversationId` (five TypeScript
  diagnostics in that one test). No baseline or environmental full-suite
  failures occurred.
- Fixed in **`33711234b`** by making the example a self-contained custom hook.
  From `snapback4/`, `node --test packages/snapback4/test/readme-examples.test.mjs`
  now passes **5 tests, 0 failed, 0 skipped**, including compilation of **28
  blocks** covering calls to **46 public functions**. This is the exact
  reproducer of the failure before that commit and the passing repair check.
  The full script was **not repeated**, honoring the once-only instruction;
  no green full-suite result for the final tree is claimed.
- Full-run Rust: **3,572 passed, 0 failed, 19 ignored**. Whole guide:
  **85 passed, 0 failed**. Main client batch: **2,201 tests, 2,190 passed,
  1 failed, 10 existing skips**; all separate client shards passed. Models:
  **78 passed, 0 failed, 0 skipped**. **All 53 newly added retention tests and
  all 14 unchanged round-0/round-1 withdrawal guards passed in the full run.**
- Full-run wasm: **2,021,689 B raw / 581,094 B gzip**, delta **0 B**, below
  the unchanged **582,094 B** budget. Package typecheck/build, app checks,
  documentation budget, release guard and fixture wrapper checks passed.
- Runtime: Node **24.13.1**, Bun **1.3.14**; `CARGO_BUILD_JOBS=8`,
  `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`.
- Logs: `target/lane-k-round2-evidence/test-sh.log`, `test-sh.exit`, and
  `readme-repair.log`. The repair check must run from the Snapback 4 workspace;
  an initial invocation from the repository root could not resolve Node type
  declarations and was corrected by using that documented working directory.

No known product defect or unresolved failed affected test remains. The
qualification limitation is explicit: the sole full run is red from the
subsequently repaired documentation example. The supervisor still owns
integration of the revised RFC. No push or publication was performed.
