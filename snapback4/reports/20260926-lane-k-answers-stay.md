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

## Round 3 — 2026-09-26: an answer never outlives its deadlines

Read both blind reviews in full and accepted every finding. Fetched origin and
merged the requested `992cec75c` before changing implementation. Merge
`bd80dd6c3` keeps both journal histories, both import additions in `client.ts`
and `react.tsx`, the keep option and the custody `waitSeconds` API, and both
sets of reads-guide and client-reference corrections. The reads fact fixture
matches the combined card. Main's `app-online.ts`, `contract.ts`, `local.ts`,
`mock.ts`, `writes.ts`, starter intents, draft handling and known-outcome
preservation remain integrated. No push or publication.

### Findings, file by file

Paths below are relative to `snapback4/`.

- **Active expiry (both reviewers).** `src/local-reads.ts` keeps a displayed
  kept answer's expiry timer armed through `apply`, `admit` and `settle`.
  `src/local.ts` preserves it when a replacement is loading or throws, and
  expiry still calls `reset` before re-reading, fencing the held local result
  with `resetVersion`. `src/client.ts` preserves the displayed deadline through
  loading, transport failure, stale responses and retry exhaustion. Accepted
  replacement deadlines are installed before subscriber notification, so a
  synchronous close cannot cache a new answer with its predecessor's deadline.
  Schema-discovery loading also preserves a deadline when it preserves data.
- **Idle expiry (Astra).** `src/kept-answers.ts` stores the answer's device and
  server deadlines with the snapshot. `take` checks those clocks as well as the
  30-second wall-time lifetime, and rejects an expired answer synchronously.
  Both clients re-arm the original withdrawal deadline on an unexpired remount.
  `src/read-observation.ts` carries the internal deadline and ephemeral-interest
  metadata. New `src/read-expiry.ts` shares the timer mechanics and deadline
  predicate, including long-timer clamping and clock rechecks. A local wakeup
  of a remembered server answer remains distinct from that answer's expiry;
  its server deadline still ends retention. Clock corrections re-arm active
  deadlines in their original domains.
- **Ephemeral idle memory (Astra).** `src/ephemeral-reads.ts` invokes an idle
  retirement callback inside incarnation adoption, before iterating active
  interests. Both clients wire it to `KeptAnswers.clearEphemeral()`. Affected
  idle entries disappear before any subscriber can synchronously remount one;
  durable-only idle entries keep their ordinary lifetime.
- **Viewer discovery (Astra).** `src/client.ts` schedules kept watches after
  `setViewer`, including the null-to-viewer transition for `createClient({
  token })`. An in-flight watch is marked dirty and retries when its fenced
  response settles. A reset response cannot install obsolete expiry metadata.
  Live viewer changes still reset active and idle data while credentials stay
  valid. Replacement retries stop when credentials end.
- **Contradictory prose (Grok).** `CLIENT-AND-OPERATIONS.md` opens the default
  withdrawal paragraph with **“Without `keep`”**. It and
  `crates/snapback4-lang/src/guide/reads.rs` now say expiry ends active and idle
  retention, and ephemeral incarnation changes retire both. The existing
  `guide-fact-homes.json` reads fact is updated; no new inventory or gate.

Source paths above are under `packages/snapback4/` unless stated otherwise.
The largest changed source, `local.ts`, is 1,481 lines; none exceeds 1,500.

### Forms that still compile and run

```tsx
const inbox = useQuery(api.inbox, {}, { keep: true });
const thread = usePage(api.thread, { conversationId }, { keep: true });
const watch = client.observe(api.inbox, {}, { keep: true });
const ordinary = useQuery(api.inbox, {});
const submitted = await client.mutate(api.send, args, { waitSeconds: 0 });
```

The first three opt into stale presentation within the answer's lifetime;
the fourth keeps default withdrawal. The last is the merged custody boundary:
return at custody while the write's known outcome and saved draft remain owned
by the existing write/application machinery. No new authoring form is added
in round 3. The README check compiled 30 blocks covering 46 public functions.

### Regression tests and mutation evidence

`packages/snapback4/test/keep-expiry.test.mjs` adds **18 tests**:

- real wasm/process `apply`, `admit` and `settle` with an expiring row and the
  replacement held: withdrawal occurs at expiry, direct device reads are
  null, and releasing the pre-expiry payload cannot restore it (6);
- a real-server online change notification with its replacement held (1);
- throwing local re-reads on both devices, and online loading without
  `nextExpiry` and transport failure, all preserving the old deadline (4);
- each of wasm, process and online remounting before expiry with its original
  timer re-armed, or after expiry with synchronous rejection (6);
- separate device/server clock limits and remembered local-wakeup provenance
  in idle memory (1).

`packages/snapback4/test/keep-incarnation.test.mjs` adds **9 tests**:

- wasm, process and online incarnation replacement: capture an idle remount's
  snapshot *inside* the active notification callback, then require both
  watches to reach incarnation B when held reads are released (3);
- real wasm/process local reads evaluated before `refreshSession`, held
  through the credential reset and released while rotation is pending: their
  payload never publishes, even transiently; later reads recover (2);
- token-only initial queries with default and kept observations (2);
- a live online `setViewer` transition with credentials still up, active/idle
  withdrawal and replacement reads (1);
- a bounded child-process check that signed-out observations settle instead
  of starving the event loop with reset retries (1).

Executed mutations against generated JavaScript, restoring the original file
in `finally` after every experiment. **All eight killed; 16 expected assertion
failures, no surviving mutation**:

| Mutation | Expected failing tests |
| --- | ---: |
| Local `scheduleExpiry`: `reload()` instead of `reset()` for keep | 2 |
| Remove the local `resetVersion` conjunct | 2 |
| Local ephemeral callback: `if (reset && !watch.keep)` | 2 |
| Online ephemeral callback: `if (reset && !watch.keep)` | 1 |
| Remove `resetKept()` from live `setViewer` | 1 |
| Ordinary local commits disarm all expiry timers | 2 |
| Idle `take` ignores the answer's deadline | 3 |
| Incarnation adoption leaves idle answers | 3 |

The last extra mutation initially survived because the test checked the remount
after the active-interest iteration could reset it. Capturing the snapshot
inside the callback closes that blind spot. No mutant is committed. Exact
mutations, assertion logs and exit statuses are in
`target/lane-k-round3-evidence/` (`mutations.py`, `mutations.json`, named `.diff`
and `.log` files).

### Targeted verification and corrections during development

- On the merged tree before fixes: **189 passed**, covering keep/withdrawal,
  custody seams, online intent storage, React and README examples.
- Expanded read/expiry/reset/publication run: **111 passed**.
- Presence, remembered-answer ordering and capability discovery: **53 passed**.
- Final combined expiry/incarnation/React/README/capability run:
  **78 passed, 0 failed, 0 cancelled, 0 skipped**.
- Package build/typecheck and documentation budget passed. Reference audit:
  **513 LLP docs, 9,443 refs in 26,813 files, 0 errors, 0 unchecked**.
- During development, the new online reset retry initially applied to signed-out
  default observations and caused the Chromium AppProvider case to loop. The
  hung targeted run was terminated; a diagnostic run hit its 30-second limit.
  This was introduced here, fixed before the required full run, and covered by
  the new child-process regression plus the existing Chromium account-switch
  case. The final React harness passed all 36 tests including its parent.
- Test-only corrections: settlement may already display the admitted prediction;
  assertions about late payloads start after observed withdrawal; refresh
  fixtures need a session `kind`; the signed-out watchdog unsubscribes before
  close changes its refusal from `E_AUTH` to `E_CLOSED`. These are not waived
  failures or changed product requirements.

### Decisions, deviations and open problems

No requested finding was rejected, deferred or stopped. No design deviation:
explicit keep remains a presentation choice, expiry ends it, and default
withdrawal, engine authorization, meters, ordered remembered-server recovery,
write custody and publication fences remain in force. The internal expiry
helper keeps clock provenance explicit and keeps `local.ts` below the source
limit. Ephemeral eviction is restricted to affected ephemeral observations.

Orientation used the installed `llp-orient` skill from
`/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md` because
the lane's link is broken. Governing context: LLP 3000 §7, LLP 3000.001 repair
B, LLP 3000.007 §18.2, LLP 3000.016 §2.2, LLP 3000.017 §3.3, LLP 3000.018
§3.2 and LLP 3000.019 §3.3; the merged LLP 3000.008.002.000 supplies the
custody boundary. The merged supervisor RFC now contains the explicit-keep
revision, superseding round 2's note about its old wording. No LLP redesign,
new syntax, diagnostic, engine/meter change, budget increase, outbox feature,
version change, delegated agent, push or publication.

Implementation commits: `bd80dd6c3` (merge), `122cbdc30` (deadlines and idle
memory), `b6e0960e3` (incarnation/viewer recovery), `58f2c7578` (signed-out
retry termination). Guide-fixture repair: `a96152221` restores main's `writes-04` custody wording
and `language-19` client-card addition, both omitted in the first conflict
resolution. The full guide test exposed that merge error; its repair run passed
86/86. All commits end with the requested co-author trailer.

### Exact full-run qualification

Required `scripts/test.sh` ran **once**, unmodified, and finished:

```text
== 2 failure(s) in 1033 s
   cargo test
   client tests
```

Exit **1**. Every failure and its disposition:

1. **Introduced here: merge fixture omission.** Rust test
   `familiar::every_moved_fact_has_its_why_or_details_home` reported
   `writes-04 lost its Details home`. Inspection also found the omitted
   `language-19` update. The merge resolution had taken the old fixture wholesale
   and then replaced `reads-06`, losing those two nonconflicting main updates.
   Commit `a96152221` restores both verbatim from `992cec75c`, retaining the
   combined reads fact. Affected repair check:
   `cargo test -p snapback4-lang --test guide` — **86 passed, 0 failed,
   0 ignored**. Log: `target/lane-k-round3-evidence/guide-repair.log`.
2. **Baseline timing-sensitive test: incomplete ephemeral refresh.**
   `online: incomplete ephemeral answers refresh on a fixed 1 s cadence without
   a change` (`ephemeral-watches.test.mjs:54`) measured **15.16348 ms**, outside
   its 850–1,250 ms assertion. The test counts initial capability-discovery
   re-reads as cadence reads before schema installation settles. The unchanged
   affected file subsequently passed **4/4** on the final client. To establish
   attribution, built the exact `992cec75c` client sources in an isolated
   directory under this lane's `target/`, using the unchanged server/wasm
   artifacts. Its unmodified online cadence case passed **20/20** isolated
   attempts; adding only a **100 ms delay before `/schema`** in the copied
   test's fetch wrapper reproduced the same assertion on that baseline:
   **`cadence 105.211412`**, **1 test failed**, exit **1**. No lane production
   code was used in that client build and no test assertion was changed.
   The initial-discovery retry is legitimate; the test's assumption that its
   second and third requests must be timer-driven is not stable. No production
   cadence change or test weakening was made for this baseline issue.

The cadence assertion is the remaining **open baseline test problem**. A
concrete reproduction is to insert
`if (path === '/schema') await delay(100);` immediately before
`defaultFetch(input, init)` in that test's fetch wrapper and run only its
`online: incomplete` case on `992cec75c`. The executable copied reproduction
is at `target/lane-k-round3-evidence/baseline/snapback4/packages/snapback4/test/ephemeral-cadence-delay.mjs`;
its log is `baseline-cadence-delay.log`. `ephemeral-cadence-rerun.log` records
the final-tree 4/4 pass. This is an inherited timing assumption, not an
unresolved lane retention defect; no separate environmental failure was found.

Full-run Rust: **3,572 passed, 1 failed, 19 ignored**. Main client batch:
**2,264 tests, 2,253 passed, 1 failed, 10 existing skips**; all separate shards
passed. Models: **78 passed, 0 failed, 0 skipped**. All **27 new round-3
regressions** passed in the full run. The existing keep cases, withdrawal
guards, and Chromium cases passed too. Build/typecheck, docs budget, release
guard, both app typechecks and fixture wrappers passed.

Wasm: **2,021,689 B raw / 581,094 B gzip**, delta **0 B** from round 2;
unchanged budget **582,094 B**, headroom **1,000 B**. No budget increase.
Runtime: Node **24.13.1**, Bun **1.3.14**; `CARGO_BUILD_JOBS=8`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`.
Full log and exit: `target/lane-k-round3-evidence/test-sh.log` and
`test-sh.exit`. The full script was not repeated. The repaired final tree has
passing affected checks; **no green full-suite result is claimed**.

## Round 4 — 2026-09-26: the observation lingers, not a retired answer

Implemented the supervisor's revision 5 of LLP 3000.019 §3.3 part 2 after
reading both round-3 reviews in full. Every requested finding is addressed.
There is **one lifetime**: an opted-in observation remains in the live watch
map for 30 seconds after the last subscriber leaves. A matching remount joins
that observation, including its current `fresh` and `since`, without an extra
read. The 30-second cutoff uses elapsed monotonic time, independently of either
row-expiry clock. Scope-ending resets close lingering observations immediately.
No push or publication.

### Removed and built, file by file

- Deleted `packages/snapback4/src/kept-answers.ts`: no `KeptAnswers`, stored
  retired snapshots, retirement deadline copies, restore/re-arm path, per-entry
  ephemeral classification, adoption eviction, or second answer lifetime.
- Added `src/observe-watch.ts`: shared subscriber ownership, the 30-second
  linger timer, joining the same watch, cutoff enforcement on remount even
  when the host delays timers, and immediate closure on a scope-ending reset. Expiry, presence and
  ephemeral subscriptions stay attached during the grace period and stop when
  that observation closes. The old local default-close behavior is preserved.
- `src/client.ts` and `src/local.ts`: use ordinary watches throughout the
  grace period; end lingering on sign-out, credentials/viewer changes, store
  replacement/adoption and close. First online schema installation resets
  all watches before callbacks. Ephemeral reset callbacks separate reset from
  delivery. Online background publication rechecks after adoption callbacks.
- `src/ephemeral-reads.ts`: reset **every** affected interest, including the
  response's owner, before delivering any callback or scheduling a read; no
  idle eviction hook remains. The accepting response cannot preserve old rows
  when it is loading, or when a peer closes/remounts the adopting observation.
- `src/read-observation.ts`: acceptance can itself reset/close an observation;
  recheck its publication revision before publishing. Removed the ephemeral
  classification used only by retired-answer storage.
- `src/local-reads.ts`: removed its `KeptAnswers` owner. Lingering watches
  participate in the existing commit reset/reload loop. Ordered
  `RememberedAnswers` recovery, store-cut ordering, and the read revision are
  unchanged.
- `src/read-expiry.ts`: removed retirement-only deadline checks and wall-clock
  fallback. The displayed answer's normal expiry timer and clock-correction
  re-arm remain, including remembered local-wakeup provenance.
- `CLIENT-AND-OPERATIONS.md`, README, `guide/reads.rs`, and only the `reads-06`
  fact-home entry: replaced idle-answer wording with revision 5's live linger,
  current-snapshot metadata, reset rules and background cost.
- Existing `keep-device`, `keep-expiry`, `keep-incarnation`, `keep-observation`
  and `keep-reset` tests: updated the deliberately superseded stale-remount /
  immediate-refetch assertions; strengthened commit and scope-ending evidence.
- Added `test/keep-adoption.test.mjs` and `test/keep-clock.test.mjs`: **17 new
  regressions**, detailed below. Report and one append-only journal entry
  record this round.

Paths abbreviated `src/` and `test/` above are under `packages/snapback4/`.
The largest modified source, `local.ts`, is **1,486 lines**, below 1,500.

The existing forms still compile and run:

```tsx
const query = useQuery(api.inbox, {}, { keep: true });
const pages = usePage(api.thread, { conversationId }, { keep: true });
const watch = client.observe(api.inbox, {}, { keep: true });
```

**Cost:** each distinct lingering watch retains its observation, answer,
subscriptions and timers for up to 30 seconds. Local watches continue evaluating
on commits without a subscriber; server reads, change-feed interests, incomplete
answer refreshes and presence refreshes also continue normally. Rapid navigation
can therefore leave several screens' reads doing work concurrently during that
window. This is intentionally more background work than storing a retired
answer. Existing engine meters bound each evaluation; no new aggregate resource
cap or latency benchmark is claimed. Scope resets and the 30-second close
release the watch and its timers. Explicit keep's revoked-row presentation
trade-off during an ordinary re-read remains documented.

### Tests and mutation evidence

- All three clients: same-watch remount with unchanged `fresh`/`since`, no
  extra query on join, last-subscriber ownership, distinct keys, reuse at
  **29.999 s**, and loading at **30 s** even before the delayed timer runs.
  A timer test separately proves physical watch closure and no resurrection
  after moving time backwards.
- Real wasm/process devices: a lingering watch re-evaluates on `apply`,
  `admit`, `settle`, applied revocation, predicted leave and refusal, without
  needing a remount. The remount joins its current committed snapshot.
- Real wasm/process and online resets: adoption, store replacement,
  credential/viewer changes, sign-out and close; online also store regression.
  The old closed handle cannot resume after scope changes. `clear_rows` and
  `settle_exit` additionally exercise the shared `LocalReads.committed` policy
  with an actual lingering watch in the map; they do not claim a new public
  client verb or process exit transport.
- Nine adoption reproductions: online/wasm/process, each with a peer that
  inspects, closes, or closes and remounts the accepting watch. Its response
  carries incarnation B and `{ loading: true }`. The callback captures both
  the owner and a lingering third watch: every snapshot is already loading.
  Replacement reads are held, then released to prove progress to B.
- First online schema installation: an unclassified pre-discovery query
  lingers with generation 1; generation 2 installs while reads are held. The
  active callback sees the lingering snapshot already reset. Local clients
  install their first schema before exposing the client, so no local watch
  can predate that installation; subsequent real-device adoption is covered.
- Three split-clock reproductions: device time is two hours ahead of server
  time, and the displayed server answer has an hour left. Correcting server
  time to its deadline must reset active and lingering answers immediately;
  the original one-hour timer cannot satisfy the test. Server rollback and
  remount must leave loading. Replacement reads are loading online and held
  on each real local device.
- Two real-device remembered-answer cases: remount during linger preserves a
  remembered answer; its device wakeup, even after clock correction, starts
  reobservation without withdrawing it. Its independent server deadline still
  withdraws during that held reobservation.
- Two timer-domain tests: device-first and server-first deadlines disagree;
  assert the actual scheduled delay and which deadline fired.

Ten generated-code mutations were tested independently and restored; each
failed a behavioral assertion. Exact diffs, commands, logs and exit statuses
are under `target/lane-k-round4-evidence/` (`mutations.py`, `mutations.json`).

| Mutation | Tests killed |
| --- | ---: |
| Delete online clock-correction re-arm | 1 |
| Delete local clock-correction re-arm | 2 |
| Swap device/server delays only when arming expiry | 2 |
| Force `localWakeup: false` | 2 |
| Treat all device deadlines as local wakeups | 2 |
| Exclude the accepting owner from ephemeral reset | 9 |
| Notify inside the ephemeral reset loop | 9 |
| Skip lingering watches at first schema installation | 1 |
| Close immediately instead of lingering | 3 |
| Keep lingering local watches after a scope-ending reset | 6 |
| **Total expected assertion failures** | **37** |

Final positive evidence before the full script: expanded focused run **245
passed / 0 failed**, including Chromium, ephemeral, presence, expiry recovery
and README cases; strengthened scope run **35/35**; after restoring mutations,
combined new regressions and scope tests **52/52**. Whole guide **86/86**;
package build/typecheck and docs budget pass. The README remains 300 lines.
Reference audit: **513 LLP docs, 9,444 refs in 26,815 files, 0 errors,
0 unchecked**.

Test development caught two fixture mistakes, repaired before qualification:
unknown arguments on a zero-argument query, and existing fake refresh replies
missing the required session `kind`. The fixtures now use a second declared
query and valid user sessions. No production failure was waived.

### Decisions, deviations and open problems

No requested functionality is deferred or rejected. No second cache, engine or
authorization change, meter change, outbox work, new syntax/diagnostic, version
change, budget increase, agent delegation, push or publication. The supervisor's
revision-5 instruction governs part 2; its RFC remains supervisor-owned and the
lane updates the requested client documentation. No new LLP is needed.

Orientation used the same installed `llp-orient` skill as round 3 (the lane's
vendor link remains broken). Governing context: LLP 3000 §7, LLP 3000.001
repair B, LLP 3000.007 §18.2, LLP 3000.016 §2.2, LLP 3000.017 §3.3,
LLP 3000.018 §3.2, and revised LLP 3000.019 §3.3. Current reads guide and
client documentation were read before edits. No broken governing reference
was found.

The previously documented incomplete-ephemeral cadence test's startup-discovery
assumption remains an inherited test risk; the broader focused run passed it.
The concrete baseline reproduction is retained in round 3 above. Any outcome
in this round's full qualification is reported below without masking it.

Implementation: `4409e31c7`; new regression tests: `d970f4bf2`.
All commits carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

### Exact round-4 full qualification

Required `scripts/test.sh` ran **once**, unmodified, and finished:

```text
== 0 failure(s) in 1034 s
```

Exit **0**. **No failures** to classify as introduced, baseline or
environmental; no repair or repeat run was needed.

- Rust: **3,573 passed, 0 failed, 19 ignored**.
- Main client batch: **2,280 tests; 2,270 passed, 0 failed, 10 existing skips**.
  All seven separate acquisition/server shards also passed.
- Models: **78 passed, 0 failed, 0 skipped**, including both 5,000-sequence
  session models.
- All **17 new regressions**, strengthened existing keep/reset tests,
  withdrawal guards, Chromium cases and the previously timing-sensitive
  incomplete-ephemeral cadence case passed in this full run.
- Build/typecheck, docs budget, release guard, both app typechecks, fixture
  wrappers and the whole guide passed.
- Wasm: **2,021,689 B raw / 581,094 B gzip**, delta **0 B** from round 3;
  unchanged budget **582,094 B**, headroom **1,000 B**. No budget increase.

Runtime: Node **24.13.1**, Bun **1.3.14**; `CARGO_BUILD_JOBS=8`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`.
Full log and exit: `target/lane-k-round4-evidence/test-sh.log` and
`test-sh.exit`. Targeted checks and negative experiments are in the same
evidence directory. The final documentation commit adds only this report and
the round-4 journal record; tested implementation is unchanged.

## Round 5 — 2026-09-26: permanent expiry withdrawal and slow refresh progress

Read the lane prompt, rounds 0–4 report and the complete Astra round-4 review
(`k2-r4.astra.md`, NOT READY). Addressed both defects and the surviving cleanup
mutation. The reviewer-confirmed round-3/4 fixes and live-linger design remain.
No push or publication.

### Findings and files

Paths below are relative to `snapback4/`.

- **High, inherited remembered-answer resurrection:**
  `packages/snapback4/src/local.ts` now checks the query's remembered entry
  synchronously when its displayed server deadline fires. If that entry is
  expired, `RememberedAnswers.forget` removes it before reset notification or
  asynchronous recovery. The query key excludes the observation's `keep:`
  prefix. The existing `forget` operation preserves the ordering record,
  including LLP 3000.018 §3.2's highest cut. A newer entry with a future deadline,
  or an entry without a deadline, is left alone. `local-query.ts` needs no new
  recovery path: once forgotten, the old answer is unavailable even after a
  server-clock rollback.
- **Medium, starvation of slow online replies:**
  `packages/snapback4/src/client.ts` now checks `inFlight` and sets `dirty`
  before calling `reload()`. A periodic refresh during an outstanding request
  queues another read without advancing that request's publication revision.
  The store-cut, commit, reset, credential and ephemeral fences still reject
  obsolete replies.
- **Low, expiry-timer cleanup survived mutation:**
  `packages/snapback4/test/keep-observation.test.mjs` installs both expiry and
  presence timers before a watch lingers. It proves they remain armed at
  29.999 seconds, are explicitly cancelled when the watch closes at 30 seconds,
  and never invoke their callbacks at their later deadline. Production cleanup
  in `observe-watch.ts` was already correct and is unchanged.
- `packages/snapback4/test/keep-clock.test.mjs`: four rollback regressions
  cover active and lingering kept watches on real wasm and process devices.
  Each first remembers a server answer, goes offline, observes the remembered
  answer, holds replacement device reads, advances the server clock beyond
  expiry, observes withdrawal, rolls back the server clock, and releases the
  reads. Lingering cases remount before release. No expired data can publish,
  and an additional one-shot recovery returns `E_OFFLINE` without a new server
  reply. Active cases roll the clock back inside the withdrawal subscriber,
  proving cleanup precedes notification. Two further device cases remember a
  newer unexpired answer with a later deadline while the older answer remains
  displayed: expiry withdraws the older snapshot but recovery can still show
  the newer answer. Fixture controls now release held reads and set the
  server reply's deadline independently of the displayed deadline.
- `packages/snapback4/test/ephemeral-watches.test.mjs`: two online regressions
  cover active and lingering kept watches. After capability discovery, an
  incomplete ephemeral answer refreshes on its real one-second cadence; each
  replacement reply takes 1.15 seconds and is complete. The complete replacement
  must publish, and a lingering remount joins it without adding a read.
- `packages/snapback4/test/remembered-answers.test.mjs`: expiry cleanup leaves
  the highest store cut intact; a later-arriving reply below it cannot restore
  memory, while a newer read at the same cut can be remembered.
- This report and one appended dated `JOURNAL.md` entry record the round's
  measurements and qualification.

The same forms compile and run; this round adds no API or Quarry syntax:

```tsx
const query = useQuery(api.inbox, {}, { keep: true });
const pages = usePage(api.thread, { conversationId }, { keep: true });
const watch = client.observe(api.inbox, {}, { keep: true });
```

### Regression and mutation evidence

**Before the production fixes:** the selected ten tests produced **six expected
failures**: all four active/lingering rollback cases resurrected the old answer,
and both slow online cases still displayed the incomplete answer after three
successful complete responses. The newer-memory, highest-cut and existing
cleanup behavior passed. Log: `target/lane-k-round5-evidence/before.log`.

**After the fixes:** the initial focused run passed **53/53**. Nine new tests
were added and the existing timer-lifetime test was strengthened. The slow-reply
fixture then gained an explicit observed ephemeral-poll condition to finish
capability discovery before testing cadence, avoiding the inherited startup
assumption described in round 3.

Seven independent generated-code mutations were executed and restored in
`finally`; **all seven killed, 13 expected assertion failures**:

| Mutation | Failing tests |
| --- | ---: |
| Omit expiry's remembered-answer cleanup | 4 |
| Forget a newer, unexpired entry too | 2 |
| Move cleanup after subscriber notification | 2 |
| Reload before the online in-flight guard | 2 |
| Delete expiry-timer cancellation at close | 1 |
| Delete presence-timer cancellation at close | 1 |
| Forget the answer's ordering record as well | 1 |

Exact mutations, commands, diffs, logs and exits are in
`target/lane-k-round5-evidence/` (`mutations.py`, `mutations.json` and each
named `.diff` / `.log`). No mutation is committed.

After restoring all mutations, the broader affected run passed **187/187**,
with no failures, skips or cancellations: every keep test, the original and new
ephemeral cadence cases, remembered-answer ordering, local commit handling,
read-observation publication, presence refresh/composition, session publication
and page-authority regressions. Log: `target/lane-k-round5-evidence/fences.log`.
The package build passed. Reference audit: **513 LLP docs, 9,446 refs in 26,815
files, 0 errors, 0 unchecked** (`ref-check.log`).

Implementation commits: `0bee969a3` (expiry), `e0e414ce0` (slow refresh),
`26d7aedf7` (timer cleanup test). Each carries the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer. Git initially lacked
an author identity; per-command identity matching the previous lane commits
resolved that host configuration issue without changing global settings.

### Scope, decisions and open problems

No requested fix was rejected, deferred or redesigned. This round adds a
five-line expiry guard and reorders the existing refresh guard, using the
existing ordered cache and refresh queue. No additional cache, engine/meter change, authorization change,
outbox work, syntax/diagnostic, package version, budget increase, delegated agent,
push or publication. `local.ts` is 1,491 lines, below the 1,500-line source cap.

Used the installed `llp-orient` skill from
`/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md`, as in the
previous rounds. Governing context: LLP 3000 §7, LLP 3000.001 repair B,
LLP 3000.007 §18.2 and Rule 5, LLP 3000.018 §3.2's memory order, and
LLP 3000.019 §3.3 with the supervisor's round-4 live-linger ruling. The current
reads card and lane lifetime implementation were read before editing. No new
LLP decision is needed; the fixes enforce existing guarantees.

No known unresolved round-5 product defect. The previously recorded baseline
cadence test still assumes startup-discovery reads are periodic reads; its
reproduction and attribution remain in round 3. The old test and its assertion
are unchanged; this round's new cadence cases wait for discovery explicitly.

### Exact round-5 full qualification

Required `scripts/test.sh` ran **once**, unmodified, and finished:

```text
== 0 failure(s) in 959 s
```

Exit **0**. **No introduced, baseline or environmental failures** occurred in
this full run. No repair or affected-test rerun was necessary after it; the full
script was not repeated.

- Rust: **3,573 passed, 0 failed, 19 ignored**; whole guide **86/86**.
- Main client batch: **2,289 tests; 2,279 passed, 0 failed, 10 existing skips**.
  All seven separate acquisition/server shards also passed.
- Models: **78 passed, 0 failed, 0 skipped**, including both 5,000-sequence
  session models.
- All **nine new regressions**, the strengthened expiry/presence cancellation
  test, existing publication/reset/authority guards and Chromium cases passed.
  The original timing-sensitive incomplete-ephemeral cadence test passed too.
- Package build/typecheck, docs budget, release guard, both app typechecks and
  fixture-wrapper checks passed.
- Wasm: **2,021,689 B raw / 581,094 B gzip**, delta **0 B** from round 4;
  unchanged budget **582,094 B**, headroom **1,000 B**. No budget increase.

Runtime: Node **24.13.1**, Bun **1.3.14**; `CARGO_BUILD_JOBS=8`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`.
Full log and exit: `target/lane-k-round5-evidence/test-sh.log` and
`test-sh.exit`. The final documentation commit adds this report and one dated
round-5 journal entry; the qualified implementation is unchanged.

## Round 6 — 2026-09-26: withdraw all expired watches before callbacks

Read the lane prompt, rounds 0–5 report and Astra's complete round-5 review
(`k2-r5.astra.md`, NOT READY). Addressed both high findings and the surviving
rejoin mutation. The existing live-linger design and earlier fixes remain.
No push or publication.

### Findings and files

Paths below are relative to `snapback4/`.

- **High: one expiry callback could spare another expired watch.**
  `packages/snapback4/src/read-expiry.ts` adds `correctReadExpiries`: sample
  device and server time once, withdraw every due snapshot and remove its
  expired recovery memory before delivering any notification, then notify and
  refetch. Future deadlines are re-armed in their own clock domains.
  `src/client.ts` and `src/local.ts` use this procedure for clock corrections;
  their existing timer paths share the extracted withdrawal functions. Online
  expiry resets every due snapshot, including default observations. Local
  expiry uses the captured server sample for remembered-answer cleanup,
  preserves newer unexpired memory and highest-cut ordering, and keeps a local
  reobservation wakeup distinct from a server-answer deadline. Deferred delivery
  and refetch skip watches a callback closed or replaced.
- **High, inherited: the app facade delayed withdrawal behind storage.**
  `packages/snapback4/src/app-client.ts` synchronously forwards and notifies a
  source snapshot containing `loading` or `denied`. Data still waits for
  `refusal()` and the current facade authority check. The facade's permanent
  retirement fence remains in force.
- **Low: missing rejoin timer-cancellation evidence.** Production cancellation
  in `src/observe-watch.ts` was already correct and is unchanged. The new
  virtual-timer test rejoins at 29 seconds, subscribes, crosses the original
  30-second deadline, and verifies that the same live watch remains open. Its
  next unsubscribe gets a full new 30 seconds: open at 29,999 ms, closed at
  30,000 ms.
- `packages/snapback4/test/keep-clock.test.mjs`: three regressions run Astra's
  callback-rollback reproduction on online, real wasm and real process clients.
  Two kept answers share a server deadline; one lingers and replacement reads
  are held. The active subscriber rolls back the server clock, inspects the
  lingering snapshot and remounts it inside the callback. Both must already
  be loading. On both devices, releasing reads and a one-shot offline recovery
  additionally prove the other expired remembered entry cannot return.
- `packages/snapback4/test/keep-observation.test.mjs`: the rejoin test above,
  the `createApp` reproduction with `sessionStore.get` held at expiry, and two
  facade tests for synchronous `loading` and `denied`. Those two also hold the
  authority check for data before and after withdrawal and prove replacement
  data publishes only after authority resumes. The existing facade retirement
  regression remains unchanged and passes.
- This report and one appended dated `JOURNAL.md` entry record the round.

The same forms compile and run; this round adds no public API or Quarry syntax:

```tsx
const query = useQuery(api.inbox, {}, { keep: true });
const pages = usePage(api.thread, { conversationId }, { keep: true });
const watch = app.client.observe(api.inbox, {}, { keep: true });
```

### Tests and mutation evidence

Seven new tests were added. Before the production fixes, the selected run had
**six expected failures and one pass**: all three callback-rollback cases and
all three facade cases failed; production rejoin cancellation already passed.
After the fixes, the focused clock/observation/remembered-answer run passed
**54/54**. The final broader affected run passed **304/304**, with no failures,
skips or cancellations. It includes every keep test, app session/handle/
retirement cases, clock regressions, memory ordering, publication and authority
fences, and presence/composition/ephemeral refresh behavior.

Four independent generated-JavaScript mutations were tested and restored in
`finally`. **All four killed; nine expected assertion failures**:

| Mutation | Failing tests |
| --- | ---: |
| Notify inside the expiry sweep, before withdrawing other watches | 3 |
| Omit expired remembered-answer cleanup | 2 |
| Make the facade await authority before forwarding withdrawal | 3 |
| Delete `clearTimeout(watch.linger.timer)` on rejoin | 1 |

Exact commands, diffs, logs and exits are in
`target/lane-k-round6-evidence/` (`before.log`, `focused.log`, `affected.log`,
`mutations.py`, `mutations.json`, and each named mutation `.diff` / `.log`).
No mutation is committed. Package build/typecheck passed. Reference audit:
**513 LLP docs, 9,448 refs in 26,815 files, 0 errors, 0 unchecked**.
`local.ts` is **1,492 lines**, below the unchanged 1,500-line source limit.

Implementation commits, each carrying the requested co-author trailer:
`4cec3819a` (clock correction), `2f30f5e7e` (facade withdrawal),
`4c462c3b9` (rejoin timer regression).

### Scope, decisions and open problems

No requested finding was rejected, deferred or redesigned. The helper shares
withdrawal and clock-domain handling between the existing clients; it adds no
answer store or new lifetime. No engine, authorization, meter, outbox, public
API/syntax, version or wasm-budget change. No delegated agent, push or
publication. No known unresolved requested finding remains.

Orientation used the installed `llp-orient` skill at
`/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md` because
this lane's vendor link remains broken. Context: LLP 3000 §7 and LLP 2000.000
§7.2; LLP 3000.001 repair B; LLP 3000.007 §18.2 and the existing expiry rule;
LLP 3000.018 §3.2's ordered recovery; LLP 3000.019 §3.3 and the supervisor's
round-4 live-linger ruling. The root and 3000.019 remain in `llp/current/`;
none of these is in `llp/foundation/`. The current reads card and application
facade were read before editing. No new LLP decision or hand-off is needed.
The earlier recorded baseline cadence-test startup assumption remains described
with its reproduction in round 3; its unchanged test passed the affected run.

### Exact round-6 full qualification

Required `scripts/test.sh` ran **once**, unmodified, and finished:

```text
== 1 failure(s) in 960 s
   client tests
```

Exit **1**. Its sole failing test was **`online: mounting interest reissues a
held poll, invalidates without sync, and refetches at expiry`**, at
`packages/snapback4/test/ephemeral-watches.test.mjs:86`:
**`500.4352399999998 ms`** against a **500 ms** notification limit.

**Classification: baseline timing-sensitive test**, affected by host scheduling.
Astra's round-5 review independently recorded the same 500 ms notification-limit
failure at **510.5 ms** before these changes, followed by an isolated pass.
The test and its assertion are unchanged in round 6. It passed this round's
304-test affected run. After the full run's client batch failed, the unchanged
entire affected file passed **6/6**, exit 0:

```sh
node --test packages/snapback4/test/ephemeral-watches.test.mjs
```

No production repair or test weakening was needed. No introduced product failure
or separate environmental failure was observed. The baseline timing assertion
remains an open test risk: run this named case in the full parallel client batch
on the shared host to encounter the recorded failure; the isolated command above
passes. The prior startup-cadence risk described in round 3 is distinct, and its
unchanged test passed in this full run. **The full script was not repeated, and
no green full-suite result is claimed.**

- Rust: **3,573 passed, 0 failed, 19 ignored**; whole guide **86/86**.
- Main client batch: **2,296 tests; 2,285 passed, 1 failed, 10 existing skips**.
  All seven separate acquisition/server shards passed.
- Models: **78 passed, 0 failed, 0 skipped**, including both 5,000-sequence
  session models.
- All **seven new regressions**, the unchanged facade-retirement case,
  earlier withdrawal/publication/clock/memory-ordering guards, and Chromium
  cases passed in the full run.
- Build/typecheck, docs budget, release guard, both app typechecks and fixture
  wrapper checks passed.
- Wasm: **2,021,689 B raw / 581,094 B gzip**, delta **0 B** from round 5;
  unchanged budget **582,094 B**, headroom **1,000 B**. No budget increase.

Runtime: Node **24.13.1**, Bun **1.3.14**; `CARGO_BUILD_JOBS=8`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`.
Full log and exit: `target/lane-k-round6-evidence/test-sh.log` and
`test-sh.exit`; affected rerun: `ephemeral-rerun.log` and
`ephemeral-rerun.exit` in the same directory. This final documentation commit
adds only the report and one dated round-6 journal entry; qualified code and
tests are unchanged.

## Round 7 — 2026-09-26: expired reads cannot restore memory; remounts render the live answer

Read the lane prompt, rounds 0–6 report and Grok's complete delayed round-5
review (`k2-r5.grok.md`, NOT READY). Both new defects survived round 6:
`forget` still only deleted the answer, and the React resources still returned
loading before subscribing. Round 6's two-phase expiry sweep and synchronous
facade withdrawal addressed different races and remain intact. The review's
confirmed earlier fixes (slow online replies, expiry/presence timer cleanup,
adoption, clock domains, viewer discovery, scope resets and custody) remain.
No push or publication.

### Findings and files

Paths below are relative to `snapback4/`.

- **High: a server body begun before expiry could restore withdrawn memory.**
  `packages/snapback4/src/local-reads.ts`: `forget` preserves `seq` and
  `highest`, advances the ticket counter and records an expiry barrier.
  `admit` rejects a ticket below that barrier before considering a higher cut.
  Even a rejected answer or refusal contributes its named cut to `highest`.
  Accepting another answer preserves the barrier. A read begun or renewed
  after withdrawal can remember a new answer under the existing cut ordering.
- `packages/snapback4/test/keep-clock.test.mjs`: eight real-device cases,
  wasm/process × active/lingering × rollback/exact deadline. Rollback cases
  hold a background refetch's HTTP body, expire the displayed answer, roll
  back the server clock, release the same body and fail every later `/q/`.
  No notification or final snapshot may contain the withdrawn answer; a
  one-shot recovery must return `E_OFFLINE`. Exact-deadline cases start a
  separate read before expiry, hold its body, release and await it at exactly
  the deadline, then roll back and release the watch's held device retry.
  This prevents a later recovery from hiding a missing synchronous cleanup.
  Existing split-clock cases also check the same peek on all three tiers.
- `packages/snapback4/test/remembered-answers.test.mjs`: four new ordering
  tests cover unnamed/equal/higher cuts, an absent key, rejected refusals,
  cut learning from rejected bodies, preservation of the barrier after a new
  answer, and a renewed read's ability to remember a replacement.
- **Medium: React committed loading before acquiring a lingering watch.**
  `packages/snapback4/src/observe-watch.ts`: internal read-only watch-map
  peek, keyed by the client's observation implementation. It checks the
  current scope and `linger.until`, returns the existing snapshot by identity,
  and neither acquires/closes a watch nor touches its timer. Write-only client
  wrappers share the same observation implementation and therefore the peek.
  `src/client.ts` and `src/local.ts` bind their existing live maps.
- `packages/snapback4/src/react.tsx`: `Observation.getSnapshot` peeks before
  subscription; `Pages.getSnapshot` derives its first page from that same live
  peek, rechecking snapshot identity and the cutoff while unsubscribed.
  Subscription still owns acquisition. Current `fresh`/`since`, page-prefix
  behavior and reset semantics remain unchanged.
- `packages/snapback4/src/app-client.ts`: the facade permits a peek only for
  the exact live snapshot it previously authorized. A weak identity set
  retains no answers; new data still waits for the asynchronous authority
  check. An opening facade rechecks the live peek so a reset while storage is
  held withdraws synchronously. Retirement disables the peek permanently.
- `packages/snapback4/test/react.test.mjs`: four Chromium cases, both hooks
  directly and through the facade, capture the first committed DOM and read
  in a layout effect. Remounting inside the window commits the editor and
  data immediately, preserves metadata, and adds no read. At exactly 30 s,
  before the timer runs, the first commit is loading. StrictMode replay also
  must not commit an intermediate loading frame inside the window.
- `packages/snapback4/test/keep-observation.test.mjs`: two additional tests
  prove that peeking leaves the timer, map and snapshot untouched, respects
  scope/key/options and the exact cutoff, and that facade peeks cannot expose
  unapproved replacements or cross withdrawal/retirement.
- `packages/snapback4/CLIENT-AND-OPERATIONS.md`: states the first-commit
  remount behavior and the facade's authority boundary. This report and one
  dated appended `JOURNAL.md` entry record qualification.

The existing forms still compile and run; no public API or Quarry syntax was
added:

```tsx
const inbox = useQuery(api.inbox, {}, { keep: true });
const pages = usePage(api.thread, { conversationId }, { keep: true });
const watch = client.observe(api.inbox, {}, { keep: true });
```

### Tests and mutation evidence

Eighteen new regressions. Before the barrier fix, the selected expiry/order
run produced **8 expected failures and 4 passes**: every rollback case and
all four new ordering cases failed. The exact-deadline comparison was already
correct; its new tests specifically kill its surviving mutation. A partial
React implementation reproduced both facade first-commit failures and was
completed before qualification.

Focused expiry/ordering/observation/Chromium run: **108/108**. Final broader
run, including the strengthened Chromium cutoff assertions: **287/287**, no
failures, skips or cancellations. It covers all keep tests, memory ordering,
publication/session/authority fences, presence and ephemeral refresh/adoption,
app handles and retirement, React, and the README examples (30 blocks,
46 public functions). Package build/typecheck and docs budget pass.

Six independent mutations were tested and restored, with **20 expected
behavioral assertion failures**, plus the two React harness parent failures:

| Mutation | Failing behavioral tests |
| --- | ---: |
| Reduce `forget` to `this.answers.delete(key)` | 8 |
| Change local expiry cleanup from `<=` to `<` | 4 |
| Remove the barrier check before the higher-cut shortcut | 3 |
| Ignore `linger.until` in the peek | 1 |
| Make `useQuery` render loading before subscription | 2 |
| Make `usePage` render loading before subscription | 2 |

The first four mutate generated JavaScript; the last two temporarily mutate
React source because Chromium transpiles it directly. All files were restored
in `finally`. No mutation is committed. A runner initially matched the cutoff
comparison in both peek and acquisition; its uniqueness check stopped without
editing that file, and the corrected experiment targets only peek. Commands,
diffs, logs and exits are in `target/lane-k-round7-evidence/` (`mutations.py`,
`mutations.json`, `expiry-before.log`, `focused.log`, `affected.log`).
Reference audit: **513 LLP docs, 9,450 refs in 26,815 files, 0 errors,
0 unchecked**. Largest changed source: `local.ts`, **1,493 lines**.

Implementation commits, both carrying the requested co-author trailer:
`0b936e0ab` (expiry barrier and real-device/order tests), `18927fafb` (live
peek, guarded facade, React and timer evidence, client reference).

### Scope, decisions and open problems

Every requested finding is addressed; no design deviation or deferred fix.
The internal peek avoids adding to the public client contract. The facade's
weak approval identities preserve its existing asynchronous authority boundary
without a second answer store or lifetime. No engine, authorization, meter,
outbox, version or wasm-budget change; no delegated agent, push or publication.

Orientation used `llp-orient` from
`/home/ccheever/sb4-intent/lane-z/vendor/llp/skills/llp-orient/SKILL.md` because
this lane's link remains broken. Governing context: LLP 3000 §7, LLP 2000.000
§7.2, LLP 3000.001 repair B, LLP 3000.007 §6.5/§18.2, LLP 3000.018 §3.2 and
LLP 3000.019 §3.3 with the user's live-linger and round-7 rulings. The reads
card and client reference were read; no supervisor-owned RFC was rewritten.
No new LLP decision or hand-off is needed.

No known unresolved requested defect remains. The previously recorded baseline
cadence-startup and 500 ms notification assertions remain test-timing risks;
their reproduction and attribution are in rounds 3 and 6. The unchanged tests
passed this round's affected suite. Full-run results follow without replacing
the single required run with a later green run.

### Exact round-7 full qualification

Required `scripts/test.sh` ran **once**, unmodified, and finished:

```text
== 0 failure(s) in 966 s
```

Exit **0**. **No failures** to classify as introduced, baseline or
environmental. No repair, affected rerun or second full run was needed.

- Rust: **3,573 passed, 0 failed, 19 ignored**, in **503 s**; whole guide
  **86/86**.
- Main client batch: **2,314 tests; 2,304 passed, 0 failed, 10 existing skips**.
  All seven separate acquisition/server shards passed. Client group: **194 s**.
- Models: **78 passed, 0 failed, 0 skipped**, in **256 s**, including both
  5,000-sequence session models.
- All **18 new regressions** and the earlier expiry, withdrawal, publication,
  scope and custody cases passed. Both previously recorded timing-sensitive
  ephemeral tests passed unchanged in this full run.
- Package typecheck/build, documentation budget, release guard, both app
  typechecks and fixture wrappers passed.
- Wasm: **2,021,689 B raw / 581,094 B gzip**, delta **0 B** from round 6;
  unchanged budget **582,094 B**, headroom **1,000 B**.

Runtime: Node **24.13.1**, Bun **1.3.14**; `CARGO_BUILD_JOBS=8`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`. Full log and exit:
`target/lane-k-round7-evidence/test-sh.log` and `test-sh.exit`; reproduction
commands: `commands.txt` in that directory. This final documentation commit
adds only this report and the single dated round-7 journal entry; qualified
code and tests are unchanged. No push or publication.
