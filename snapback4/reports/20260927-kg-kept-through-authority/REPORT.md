# Lane KG round 8 — one shared approval, closed facades keep one identity

Branch: `sb4-intent/kg-kept-through-authority`. Read all round-0–7 prompts,
reports and KG journal entries, Astra's complete round-7 NOT READY review,
and Grok's review as it arrived during qualification (READY WITH CHANGES).
Grok raises the same waiting-facade, rejection, remount and approval-lifetime
issues. Its deduplication test-strength Low is also covered by the new
round-8 remount tests, verified with its exact mutation. The supervisor's
shared-approval ruling governs the findings' resolution,
superseding the reviews' proposed per-identity repairs.
The supervisor's round-8 ruling supersedes round 7's per-identity design and
its two corresponding test expectations. Earlier reports remain below as
historical records. No push or publication.

## Integration and implementation

First fetched and merged `origin/main` at `8112f4ef6` in `c212b8e65`.
The journal was the only conflicted file; both histories are preserved:
71 additions/zero deletions against the lane parent and 456 additions/zero
deletions against main. Incoming CQ top-N code, guide changes, client tests
and both CQ journal entries remain intact.

`2a3e34980` restores the shared approval and implements the closed-facade
rule, answering all four Astra Mediums. `adcfe61e9` preserves opening-remount
notification ownership through a withdrawal followed by reapproval. Every
commit, including the final evidence commit, carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

Paths below are relative to `snapback4/`:

| File | Round-8 change |
| --- | --- |
| `packages/snapback4/src/read-approval.ts` | One shared approval object per raw watch. Replacement releases the previous follower, expiry registration and episode before reusing it. Withdrawal clears the approval, peeks and registrations; one empty slot preserves opening listeners for later reapproval. No old approval generations accumulate. |
| `packages/snapback4/src/app-client.ts` | Close captures the currently visible answer and detaches from shared approval updates. Every closed policy checks its saved identity against the source and enforces deadlines; mismatch/withdrawal latches its stable loading object, or denial. Closing twice and late authority cannot revive it or add listeners. Round-7 emission deduplication stays. |
| `packages/snapback4/test/keep-authority.test.mjs` | Shared peer success, bounded approval ownership after 100 replacements, shared rejection, matching remount getter/notifications, close-time capture, and reapproval after withdrawal. Existing refusal-count and deadline tests stay. |
| `packages/snapback4/test/retention-lifecycle.test.mjs` | Apply the closed rule to all 24 different/same-body replacements on online/wasm through guardClient/createApp. Expand unchanged-identity row-expiry coverage from eight to 24 cases across all policies. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Remove round 7's per-facade authority boundary. State shared authorization for live facades and the closed rule for every policy, including identical replacement data and silent closed handles. |
| `JOURNAL.md` | Preserve both merge histories; append one dated round-8 entry. |
| `reports/20260927-kg-kept-through-authority/REPORT.md` | This report, preserving rounds 0–7 below. |

The extra remount case was found during self-review: approve A, block a
remount's opening authority, withdraw A, then let a live peer approve B. Simply
restoring round 6 would let the getter follow B with no callback. The empty
shared slot keeps the notification owner consistent across this boundary;
withdrawn data is never retained as approved, and followers/timers still release.
The final build/typecheck and affected tests completed during the full suite's
Rust phase, before client discovery. Its client phase therefore uses the final
runtime and tests; the whole suite was not restarted.

## Forms that compile and run

No new API or syntax:

```ts
const bounded = app.client.observe(api.inbox, {});
const lingering = app.client.observe(api.inbox, {}, { keep: true });
const withdrawing = app.client.observe(api.inbox, {}, { keep: false });
```

The retaining forms hold marked A, with A's original freshness, since,
episode and row deadlines, while B is unapproved. A peer's successful check
then moves every live facade of the watch to B, including a waiting facade.
For each form, `watch.close()` captures the last answer. It stays readable
only while its identity remains the source's and its own deadlines hold.
A peer's different identity, even another identical body, makes the closed
handle return stable loading immediately and still at A's deadline 5000;
it never adopts B or notifies.

## Tests and discrimination

Thirty new tests, plus the two explicitly superseded round-7 expectations:

- **24 replacement cases**, all three policies, online/wasm, guardClient/
  createApp, different and identical bodies. A expires at 5000, B at 8000.
  After the peer approves B the closed facade is already loading; repeated
  reads, 4999, 5000 and rollback retain the same loading object. No callbacks.
- **24 unchanged-identity deadline cases** (16 added) check a closed answer's
  own row expiry with and without a live peer, including callback-time access
  and rollback. A still-valid detached local answer remains readable.
- **Two shared-peer cases**, revised from round 7: both hold marked A until
  a peer approves B; the still-waiting facade changes to B with one callback.
  Another invalidation while its own check remains blocked keeps shared B.
- **Two 100-replacement cases** require one follower and one subscriber,
  with no abandoned followers after old episode/row deadlines.
- **Two shared-rejection cases** reject an opening remount after a peer
  approved B while another facade waited. Every live facade receives the
  same E_CLIENT denial exactly once; the follower and peek are cleared;
  old A deadlines cannot turn the denial into loading.
- **Two opening-remount cases** require its getter and callback snapshots
  to agree through A→B→C while its first check stays blocked.
- **Four close-time capture cases** close an opening or waiting facade
  after shared B arrives. It keeps that visible B until raw C, then stays
  loading through late authority; double close and resubscription are silent.
- **Four reapproval cases** open a remount before/after a hard withdrawal,
  block its opening check, and require one callback for the peer's later B.

The initial selected run against merged round-7 code is **9 passed / 24
failed**. All eight assigned shared-approval cases and all 16 retaining closed
replacement cases fail. The additional reapproval regressions fail **4/4**
without their follow-up fix.

Process-local module mutations do not edit live source or dist:

| Mutation | Discriminating result |
| --- | --- |
| Restore round-7 per-identity approvals | 14 failures / 3 controls pass, including all eight assigned shared cases and four reapproval cases. |
| Restore the old closed getter/close lifecycle, keeping final shared approvals | 16 retaining replacement failures; eight false controls pass. |
| Compare payloads instead of identities | All 12 same-body replacement cases fail; 12 different-body controls pass. |
| Omit close-time snapshot capture | All four opening/waiting close cases fail. |
| Remove deduplication and insert `{ reject(snapshot); emit(); }` | All five exact authority-refusal notification cases fail. |
| Delete the empty shared slot on withdrawal | All four withdrawal/reapproval remount cases fail. |
| Deduplicate by `answerIdentity` rather than snapshot object identity (Grok test-strength Low) | Both existing round-8 remount replacement cases fail on the missing second revalidation callback. |

Final affected set: **446 passed / 0 failed**, 19.035 s. Whole guide:
**86 passed / 0 failed**, 2.55 s test execution. Frozen Bun install,
package build/typecheck, docs budget and whitespace validation pass.
Reference audit: **518 LLP documents, 9,672 references, zero errors / zero
unchecked**. Changed sources/tests remain below 1,500 lines (largest: 454).
No earlier regression expectation is weakened: only round 7's
closed-retention and per-facade authority assertions change under the explicit
supervisor ruling.

## Full qualification

Ran `scripts/test.sh` **exactly once**. Exact summary:
**`== 0 failure(s) in 1268 s`**, exit **0**. Every failure: **none** —
zero round-8-owned, baseline or environmental failures. Intentional pre-fix
and mutation failures above are discrimination evidence, not suite failures.

- Rust tests/doctests: **3,931 passed / 0 failed / 24 ignored**, 543 s.
- Main client: **3,141 passed / 0 failed / 10 skipped**, plus **56/56**
  acquisition/server shard tests; client phase 427 s.
- Final seeded models: **79 passed / 0 failed**, 260 s. Both 5,000-sequence
  session models and the 3,000-sequence online model pass.
- Fixture wrappers: **9/9**. Native/wasm builds, both app typechecks, package
  build/typecheck, docs budget, release guard and chat schema check pass.

All 64 expanded round-8 regression/control cases, all eighteen delayed-authority
createApp sequences and both Chromium input-preservation witnesses pass in
the complete run. Earlier rounds' regressions remain green. No full-suite
restart or rerun. The runtime-budget limitation remains explicit below.

Wasm from that run: **1,981,453 B raw / 572,553 B gzip**, **288 B below**
the unchanged 572,841 B budget. SHA-256:
`3bb763b9f9eee9f76dba6965a3a7a940a7ea1bd3fcc2b69b215404ff7c6a4aaa`.
Relative to round 7: -137 raw / -55 gzip bytes, from the merged main inputs.
Round 8 changes no Rust or wasm input; no separate component-size attribution.

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug off,
file limit 65,536. Existing tools selected through worktree-local symlinks;
no tool installed or changed on a shared path. Optional wasm-opt is absent
from the selected PATH. No meter, package version or budget change.

Evidence: ignored `target/lane-kg-r8/` holds build/install/typecheck,
affected/guide/full-suite/reference logs and exit files, measurements, and
all seven mutation loaders with their source snapshots and results. Reproduce
from `snapback4/` after the package build:

```sh
node --test packages/snapback4/test/retention-lifecycle.test.mjs \
  packages/snapback4/test/keep-authority.test.mjs
node --import ./target/lane-kg-r8/per-identity-loader.mjs --test \
  --test-name-pattern='shared|opening remount getter' \
  packages/snapback4/test/keep-authority.test.mjs
```

## Decisions, deviations and remaining issues

No counterexample to the supervisor ruling was found. The only extension to
the assigned reproductions is keeping opening notifications consistent after
a hard withdrawal followed by reapproval; it preserves the same single-slot
design. No new public API, engine authorization/disclosure rule, durable
format, diagnostic, dependency, version or Rust change. No independent round-8
review is claimed; the supervisor owns that review and integration.

No unresolved assigned finding, merge issue or test failure remains. The
inherited 60-second complete-suite budget is exceeded (1268 s); reproduce
with `cd snapback4 && bash scripts/test.sh`. No timeout or budget was raised.

llp-orient context: scope is shared approval ownership, closed facade access
and notification delivery. Governing current LLPs: 3000 §4 (Snapback 4 fence),
3000.023 §§3.1/3.4/3.6 (episode, own deadlines, shared source withdrawals),
3000.019 §3.3 (held answer expiry), and 3000.013 §6 (facade revocation).
None is in foundation. Current client manual read before editing. No new LLP
proposal or design decision is needed; the supervisor's ruling and existing
RFC govern this work. Manual, report and journal updates suffice. Hand-off: none.

---

# Historical round-7 report

# Lane KG round 7 — approvals preserve each facade's answer

Branch: `sb4-intent/kg-kept-through-authority`. Read the round-0 through
round-6 prompts, reports and KG journal entries, plus both complete round-6
READY WITH CHANGES reviews. Previous reports remain below as history.
No push or publication.

## Integration and findings

`d0f9c7942` merges `origin/main` at `d17f8b3cc` before implementation,
without conflicts. Both journal histories and the incoming guide, adoption and
receipt changes are retained. `30ccd0d9f` answers all three round-7 findings.
Every round-7 commit includes `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

1. **Grok Medium: a closed retaining facade adopts its peer's replacement.**
   A new answer identity allocates a new approval. The previous snapshot,
   follower, episode and held expiry remain intact. Releasing an old approval
   removes the map entries only if they still point to it. A closed facade
   keeps revalidating A under A's deadlines; a peer can independently approve B.
2. **Astra Low: duplicate authority-refusal delivery.** `emit` deduplicates
   against the snapshot identity already announced while preserving the shared
   broadcast. It uses the visible denial after a facade fence, so an unchanged
   internal approval cannot suppress revocation notification.
3. **Grok Low: payload-only identity tests.** Added same-body republishes with
   a new expiry, alongside the different-body cases. The tests wait for a new
   answer identity, not just a matching payload, before checking withdrawal.

## File map

Paths below are relative to `snapback4/`.

| File | Round-7 change |
| --- | --- |
| `packages/snapback4/src/read-approval.ts` | Allocate approvals by answer identity; preserve older holds; conditionally remove current map entries on release. |
| `packages/snapback4/src/app-client.ts` | Deduplicate snapshot announcements, with facade-fence denial precedence. |
| `packages/snapback4/test/retention-lifecycle.test.mjs` | Extend four prior cases to all policies and both different/same-body replacements, on online/wasm and guardClient/createApp. |
| `packages/snapback4/test/keep-authority.test.mjs` | Exact refusal callback counts, independently gated peer approvals and fence notification controls. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document independent approval identities/deadlines and single refusal delivery. |
| `JOURNAL.md` | One dated round-7 append; preserve earlier entries. |
| `reports/20260927-kg-kept-through-authority/REPORT.md` | This evidence, preserving rounds 0–6 below. |

## Tests and negative controls

Thirty added tests, with no existing assertion relaxed:

- **20 additional lifecycle cases** expand the existing four to 24. Approve A
  with expiry 5000 at server time 1000, close the first facade, then approve B
  (or another `"private A"`) at expiry 8000 on its peer. A retaining closed
  facade still has A's identity, freshness and since, marked revalidating at
  4999; at 5000 every closed policy is stable loading while the peer keeps its
  replacement. Rollback cannot restore A. Host time is held fixed so the
  episode cap cannot mask a missing row-deadline check.
- **Five exact refusal-count cases:** replacement refusal with omitted/false/
  true, and opening refusal with omitted/true. Each denied facade receives
  exactly one callback; the opening case's live peer also receives exactly one.
- **Two independently gated peer cases:** omitted/true. One facade approves B
  while the other's check waits; the waiting facade still shows marked A,
  then shows B only after its own successful check.
- **Three fence controls:** all policies still notify once when the facade is
  revoked after its last approved answer was announced.

The pre-fix selected run is **9 passed / 20 failed**: 16 retaining replacement
cases and four retaining refusal counts fail; withdrawing controls pass.
Final affected set: **416 passed / 0 failed**, 18.997 s. Whole guide:
**86 passed / 0 failed**, 2.65 s test execution. Frozen Bun install, package
build/typecheck, reference audit and whitespace validation pass. Reference
audit: **517 LLP docs, 9,663 refs, zero errors/unchecked**. All changed source
and test files remain under 1,500 lines.

Isolated process-local module mutations, without touching live source/dist:

| Mutation | Result |
| --- | --- |
| Restore merged-input approval reuse | 18 failures: all 16 retaining lifecycle cases and both waiting-peer cases; 8 withdrawing controls pass. |
| Compare payloads instead of answer identities | All 4 closed keep:false same-body cases fail; the other 20 lifecycle cases pass. |
| Restore unconditional emit and insert `{ reject(snapshot); emit(); }` | All 5 refusal-count tests fail. |
| Deduplicate against the cached approval without fence-denial precedence | All 3 fence-notification controls fail. |

## Existing forms that compile and run

No new API or syntax:

```ts
const bounded = app.client.observe(api.inbox, {});
const lingering = app.client.observe(api.inbox, {}, { keep: true });
const withdrawing = app.client.observe(api.inbox, {}, { keep: false });
```

After `bounded.close()` or `lingering.close()`, a live peer's replacement
cannot supply a new identity or later deadline. `withdrawing.close()` keeps
its earlier identity-withdrawal behavior even when the replacement data is
identical. Authority refusal notifies each affected subscriber once.

## Full qualification

Ran `scripts/test.sh` **exactly once**. Exact summary:
**`== 0 failure(s) in 1378 s`**, exit **0**. Every failure: **none** — zero
round-7-owned, baseline or environmental failures. Intentional pre-fix and
mutation failures above are separate discrimination evidence.

- Rust tests/doctests: **3,924 passed / 0 failed / 24 ignored**, 644 s.
- Main client: **3,111 passed / 0 failed / 10 skipped**; seven additional
  acquisition/server shards: **56/56**; client phase 427 s.
- Final seeded models: **79 passed / 0 failed**, 258 s.
- Fixture wrappers: **9/9**. Native/wasm builds, both app typechecks, package
  build/typecheck, docs budget, release guard and chat schema check pass.

All 34 cases in the expanded round-7 regression/control groups, all 18
delayed-authority createApp sequences and both Chromium input-preservation
witnesses pass. Both round-6 baseline timeline targets now pass, with main's
corrections carried by the initial merge. Rust/Cargo/native-fixture inputs
match the merged main `d17f8b3cc` exactly. The script selected normal client
concurrency at host load 21.72 across 96 CPUs.

Wasm: **1,981,590 B raw / 572,608 B gzip**, **0 B delta** and byte-identical
to round 6, **233 B below** the unchanged 572,841 B budget. SHA-256:
`f31efbe90951a07e45d98bb115f907030da51fc36d2bf6afce6941d0ce04e93c`.
This round changes no Rust or wasm input.

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug off,
file limit 65,536. Existing Node/Bun selected through worktree-local symlinks;
no tool installed or modified on a shared path. Optional wasm-opt is absent
from the selected PATH. No runtime meter or wasm budget change.

Evidence: ignored `target/lane-kg-r7/`, including install/build/typecheck,
affected, guide, reference and full-suite logs/exit files, and the four
isolated mutation loaders plus their source snapshots and results.
Reproduce the changed test files from `snapback4/`:

```sh
node --test packages/snapback4/test/retention-lifecycle.test.mjs \
  packages/snapback4/test/keep-authority.test.mjs
node --import ./target/lane-kg-r7/payload-identity-loader.mjs --test \
  --test-name-pattern='closed facade keeps' \
  packages/snapback4/test/retention-lifecycle.test.mjs
```

## Decisions, deviations and remaining issues

No design deviation, stopped design part or unresolved assigned finding.
The small fence-denial detail preserves existing notifications while applying
Astra's deduplication. No engine authorization/disclosure, meter, durable
format, diagnostic, dependency, version or Rust change in this round. The
full run is not restarted or rerun. The inherited 60-second full-suite runtime
budget remains exceeded (1378 s); reproduce with `cd snapback4 && bash
scripts/test.sh`. No timeout or budget was raised. No other open issue was
found in the assigned scope.

llp-orient context: scope is approval identity/lifetime and facade notification.
Governing current LLPs: 3000 §4 (Snapback 4 fence), 3000.023 §§3.1/3.4/3.6
(episode, own deadlines and source withdrawals), 3000.019 §3.3 (held answer
expiry) and 3000.013 §6 (facade revocation). None is in foundation. Current
manual read before editing. No new LLP decision; manual, journal and report
updates suffice. Hand-off: none.

---

# Historical round-6 report

# Lane KG round 6 — detached answers cannot borrow replacement deadlines

Branch: `sb4-intent/kg-kept-through-authority`. Read all six prior prompts,
reports and KG journal entries, plus Astra's full round-5 READY WITH CHANGES
review. Grok's round-5 run produced no review; none is claimed here. Previous
reports remain below as historical evidence. No push or publication.

## Integration and commits

- `36f970290` merges `origin/main` at `09e55ad98` before implementation.
  Kept both journal histories (zero removed lines against either parent) and
  both Revised histories in LLP 3000.019. Main's sync-scale changes merge
  automatically; local.ts takes the 10,000-row initial page while retaining
  KG's expiry/presence handling. FX's deterministic useNow tests remain intact.
- `6cc971eee` answers both Astra findings, including the regressions and manual.
- The final evidence commit records this report and one dated journal append.

Every commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

## Findings and discriminating tests

1. **Astra Medium, closed keep:false facade borrows B's deadlines.** The
   getter compares the raw answer's identity with its cached answer before
   returning data from a closed withdrawing facade. A mismatch replaces that
   private snapshot with its stable loading object. It neither adopts B nor
   starts another authority check. Source loading/denial still passes through.
   Four real online/wasm cases cover guardClient and createApp: approve A with
   expiry 5000, attach a live peer, close the first facade, replace the raw
   answer with B expiring at 8000, advance to 5000. The peer shows B and the
   closed facade is loading. Repeated access and rollback to 1000 preserve
   the loading object's identity. Before replacement, the unchanged authorized
   A remains valid after detach. Tests deliberately avoid inspecting the closed
   facade during the intermediate raw loading publication, so that earlier
   withdrawal cannot mask the identity defect. All four fail on merged input
   and pass after the fix; the final tests also fail with only app-client.ts
   restored from 36f970290 through an isolated loader.
2. **Astra Low, standalone cleanup lacked coverage.** Two tests, online and
   wasm, assert the raw owner's initial map presence, subscriber and armed row
   timer; close removes it from the map, empties subscribers and clears expiry,
   presence and linger timers. Explicit old-owner publication and a fresh
   observation's real B publication deliver zero callbacks to the closed
   facade. Reopening owns a different raw watch. Both pass current cleanup;
   replacing source.close with the reviewer’s keep:false skip fails both at
   the map-removal assertion. No production cleanup change was needed.

Six tests added. No existing assertion relaxed. All negative controls are
process-local module loaders; they never change live source or built output.
The initial pre-fix run passes both cleanup tests and fails the four identity
reproductions. These intentional failures are discrimination evidence.

## File map

Paths are relative to `snapback4/`, except the named root LLP.

| File | Round-6 change |
| --- | --- |
| `packages/snapback4/src/app-client.ts` | Three-line identity fence for closed keep:false snapshots, referencing LLP 3000.023 §3.4. |
| `packages/snapback4/test/retention-lifecycle.test.mjs` | Four replacement-deadline regressions, two standalone cleanup tests, and controlled online change-feed replacement support. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | State closed-facade identity withdrawal, authority preservation and standalone keep:false cleanup. |
| `JOURNAL.md` | Preserve both merge histories; append one round-6 entry. |
| `reports/20260927-kg-kept-through-authority/REPORT.md` | This evidence, preserving rounds 0–5 below. |
| Root `llp/3000.019-what-the-builder-still-wrote.rfc.md` | Preserve both Revised histories during merge; no design amendment. |

## Forms that compile and run

No new syntax or API. The same observation can be opened through guardClient
or createApp:

```ts
const closed = app.client.observe(api.inbox, {}, { keep: false });
const peer = app.client.observe(api.inbox, {}, { keep: false });
// After both have approved A:
closed.close();
// After the live peer receives replacement B:
closed.getSnapshot(); // stable { loading: true }, never A or unchecked B
```

The standalone form closes its raw owner and cancels its subscriptions/timers:

```ts
const watch = guarded.client.observe(api.inbox, {}, { keep: false });
watch.subscribe(render);
watch.close(); // later publications cannot call render
```

## Qualification

Frozen Bun install, package build and typecheck pass. Changed lifecycle file:
**150 passed / 0 failed**. Affected retention/deadline/authority/clock/presence
set: **386 passed / 0 failed**, 18.804 s. Whole guide: **86 passed / 0 failed**,
2.52 s test execution. Reference audit: **517 LLP docs, 9,661 refs, zero errors
and unchecked**. Changed source/test files are under 1,500 lines; merged
local.ts is 1,498 lines. Whitespace validation passes.

Ran `scripts/test.sh` **exactly once**. Exact summary:
**`== 1 failure(s) in 4034 s`**, exit **1**. The script counts failed phases:
**cargo test** failed with the two baseline assertions below. There are **zero
round-6-owned and zero environmental failures**. The complete run was neither
restarted nor rerun.

- Rust tests/doctests: **3,908 passed / 2 failed / 24 ignored**, 1,068 s.
- Client tests: **3,137 passed / 0 failed / 10 skipped**, 2,658 s. The script
  chose serial file execution automatically: measured host load 110.36 across
  96 CPUs. Acquisition/server-e2e cases run inside this one set, not extra shards.
- Final seeded models: **79 passed / 0 failed**, 258 s.
- Fixture wrappers: **9/9**; native/wasm builds, package and both app typechecks,
  docs budget, release guard and chat schema check pass.

All six round-6 regressions, all eighteen delayed-authority createApp sequences,
and both Chromium input-preservation witnesses pass in the complete client run.


Every full-run failure:

| Failure | Classification | Evidence |
| --- | --- | --- |
| `snapback4::timeline`, `lifecycle::activation_refuses_each_populated_event_or_edge_table`, lifecycle.rs:32 | Baseline | Expected diagnostic substring `planned view`; fetched main now says `planned home query`. |
| `snapback4::timeline_adoption`, `redefinition_refuses_atomically_and_delivery_keeps_running`, timeline_adoption.rs:203 | Baseline | Required wording includes `event identities` and `planned view`; fetched main replaced it with concrete post/repost and planned-home-query wording. |

Main commit `bbece7c3e` changed these diagnostics. Every Rust source, test,
Cargo manifest/lock and native-fixture input in this checkout matches fetched
`origin/main` (`09e55ad98`) exactly. Each failed test also reproduces alone on
those unchanged inputs, in `baseline-timeline.log` and
`baseline-timeline-adoption.log`. No unrelated assertion was changed and the
complete red run is not relabeled green.

Reproduce the two baseline failures:

```sh
cargo test -p snapback4 --test timeline \
  lifecycle::activation_refuses_each_populated_event_or_edge_table -- --exact
cargo test -p snapback4 --test timeline_adoption \
  redefinition_refuses_atomically_and_delivery_keeps_running -- --exact
```


Wasm from the full run: **1,981,590 B raw / 572,608 B gzip**, **233 B below**
the unchanged 572,841 B budget. SHA-256:
`f31efbe90951a07e45d98bb115f907030da51fc36d2bf6afce6941d0ce04e93c`.
Relative to round 5's recorded artifact, the merged build is +78 raw / +559
gzip bytes. Round 6 changes no Rust or wasm input; the new baseline includes
main's device optimizations. No separate per-component size attribution.

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug
information disabled, file limit 65,536. Existing Node/Bun selected through
worktree-local symlinks; optional wasm-opt absent from the selected PATH.
No tool installed or modified on a shared path.

Evidence: ignored `target/lane-kg-r6/`, containing focused, affected, guide,
full-suite and reference logs/exit files, measurements, and both isolated
mutation loaders with their source snapshots and logs. Reproduce from snapback4:

```sh
node --test packages/snapback4/test/retention-lifecycle.test.mjs
node --import ./target/lane-kg-r6/old-identity-loader.mjs --test \
  --test-name-pattern='closed withdrawing facade drops A' \
  packages/snapback4/test/retention-lifecycle.test.mjs
node --import ./target/lane-kg-r6/skip-close-loader.mjs --test \
  --test-name-pattern='standalone withdrawing facade' \
  packages/snapback4/test/retention-lifecycle.test.mjs
```

## Decisions, deviations and remaining issues

No design deviation, stopped design part, or new LLP decision. The identity
check follows Astra's requested closed-withdrawing scope. Cleanup remains
unchanged and now has discriminating coverage. No engine authorization,
disclosure, meter, durable format, diagnostic, dependency, version or budget
change in round 6. No new round-6 independent review is claimed.

Both baseline diagnostic-wording failures remain open, with the exact
reproductions above. No unresolved defect in the two assigned round-6 findings
remains. The inherited 60-second full-suite budget is still exceeded (4034 s);
reproduce with `cd snapback4 && bash scripts/test.sh`. No timeout or budget
was raised. The automatic serial client selection accounts for 2658 seconds
of this run.

llp-orient context: scope is app-client.ts detached access and its lifecycle
tests. Governing current LLPs: 3000 (Snapback 4 fence), 3000.023 §§3.4/3.6
(exact withdrawal and facade authority), 3000.019 §3.3 (answer identity and
own deadlines), 3000.013 §6 (facade lifetime). None is in foundation. Current
client manual read before editing. Risk: treating a replacement's deadline
as authority for an older private snapshot; covered by the four reproductions.
Manual/report/journal updates suffice. Hand-off: none.


---

# Historical round-5 report

# Lane KG round 5 — detached deadlines and exact withdrawal delivery

Branch: `sb4-intent/kg-kept-through-authority`; release target: 0.4.5.
Read the round-0 through round-4 prompts, reports and KG journal entries, and
both full round-4 reviews (Astra and Grok, READY WITH CHANGES). Earlier reports
remain below as historical evidence. No push or publication. Every round-5
commit includes `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

## Integration and commits

- `5bf924483` merges `origin/main` at `941a3698c` before implementation.
  Preserved both sides of the journal append conflict (zero removed lines
  against either parent) and both Revised histories in LLP 3000.019.
  The local read changes merged automatically. FX's deterministic useNow
  harness is unchanged from round 4; main's cold-acquisition fallback refresh
  behavior is retained.
- `107f9484c` answers findings **1–4**, with the regressions and client manual.
- `2472b30ca` extracts the merged presence scheduling helper: combining main
  with KG made local.ts 1,506 lines; it is now 1,496. The helper keeps the
  same interval, stopped-client behavior and callback. No feature was removed.
- The final evidence commit records this report and one dated journal append.

## Findings and discriminating tests

1. **Astra Medium, closed keep:false facade.** `detach()` releases the raw
   subscription and closes its handle, but retains the handle for synchronous
   snapshot/deadline checks. Eight real online/wasm cases cover guardClient
   and createApp, standalone and with a live peer sharing the query. At expiry
   5000, the closed facade is loading, including inside the live peer's
   withdrawal callbacks. Rolling time back to 1000 cannot restore A.
   Restoring only `source = undefined` fails all **8/8** cases.
2. **Astra Low, duplicate facade withdrawal.** The facade records the snapshot
   its last delivery announced. Raw refresh suppresses a withdrawal already
   delivered by shared approval, while withdrawing facades and opening remounts
   retain their notification. Exact-count tests cover the default episode
   timer, true's shared hard withdrawal, and false's raw withdrawal. Removing
   the comparison fails **2/3**, with false as the passing control. A separate
   closeWatchAnswers test uses three policy owners and two subscribers apiece:
   all six receive exactly one callback after every peer has its denial.
   Calling each close subscriber twice fails **1/1**.
3. **Grok Low, episode notification during grouped commit.** The raw episode
   callback now uses deliverReadNotifications. The two-watch test starts A's
   episode at 1000, leaves B settled, then commits at 2000 under deferral.
   A gets exactly one callback after the loop, with A loading and B marked
   revalidating. Restoring direct callback delivery fails **1/1**.
4. **Grok Low, sign-out coverage.** All seven wasm guard policy-pair cases
   require E_AUTH before close and E_CLOSED afterward. The test records the
   actual close invocation because signOut calls close internally. It checks
   raw snapshots captured before accessor side effects as well as both exposed
   reads. That detail prevents a getter's denial repair from masking a bad raw
   publish. Replacing local's sign-out denial with loading fails **7/7**.

There are **13 added tests** and seven strengthened sign-out cases. No existing
product assertion was relaxed. Mutations use process-local module loaders;
production source and built files are never changed for negative controls.
The corrected pre-fix pair of test files passes 190 and fails 11; final code
passes all 201. An initial test draft treated all sign-out callbacks as occurring
before close and checked a peer before opening authority attached it; those
fixture errors were corrected before qualification. These development and
intentional negative-control failures are not final-code suite failures.

## File map

Paths are relative to `snapback4/`, except the explicitly named root LLP.

| File | Round-5 change |
| --- | --- |
| `packages/snapback4/src/app-client.ts` | Retain detached source handles; track delivered snapshots and suppress duplicate raw withdrawal emission. |
| `packages/snapback4/src/read-observation.ts` | Route episode onWithdrawal through deferred read notification delivery. |
| `packages/snapback4/src/local-reads.ts` | Own the extracted armLocalPresence helper, preserving the merged main behavior. |
| `packages/snapback4/src/local.ts` | Delegate presence scheduling to that helper to satisfy the 1,500-line source limit. |
| `packages/snapback4/test/retention-lifecycle.test.mjs` | Eight closed-facade regressions using real online/wasm clients, createApp fixture support, and seven exact sign-out denial cases. |
| `packages/snapback4/test/retention-episode.test.mjs` | Three facade notification-count cases, the six-subscriber close count, and the grouped two-watch episode case. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | State detached checks, single withdrawal delivery and grouped episode ordering. |
| `JOURNAL.md` | Preserve both merged histories and append one round-5 entry. |
| `reports/20260927-kg-kept-through-authority/REPORT.md` | This evidence, with earlier reports preserved. |
| Root `llp/3000.019-what-the-builder-still-wrote.rfc.md` | Merge both Revised histories; no round-5 design amendment. |

## Forms that compile and run

No new spelling. The existing forms are exercised:

```ts
const bounded = app.client.observe(api.inbox, {});
const withdrawing = app.client.observe(api.inbox, {}, { keep: false });
const lingering = app.client.observe(api.inbox, {}, { keep: true });
withdrawing.close();
const snapshot = withdrawing.getSnapshot(); // Still honors the raw handle's withdrawal/deadline.
```

The default episode withdraws once at its deadline; false still withdraws
immediately; true still has its existing retention and linger. Every new data
answer continues through authority. Ordinary successful rereads keep their
existing no-loading behavior.

## Qualification

- Frozen Bun install, package build and typecheck pass.
- Changed test files: **201 passed / 0 failed**.
- Final affected set: **380 passed / 0 failed**, 18.704 s, including all
  retention tests, raw-read-deadlines, read-observation, keep-authority,
  keep-observation, keep-clock, keep-app-expiry and presence-refresh.
- Whole guide: **86 passed / 0 failed**, 2.51 s test execution.
- Reference audit: **517 LLP docs, 9,658 refs, zero errors/unchecked**.
- Changed source/test files are below 1,500 lines; whitespace check passes.

Ran `scripts/test.sh` **exactly once** on the final implementation and tests.
Exact summary: **`== 0 failure(s) in 1510 s`**, exit **0**.
Every failure: **none** — no lane-owned, baseline or environmental test failure.
The deliberate pre-fix and mutation failures are separate discrimination evidence.

- Rust tests/doctests: **3,907 passed / 0 failed / 24 ignored**, 773 s.
- Main client: **3,074 passed / 0 failed / 10 skipped**, 427 s; seven extra
  client shards: **56/56**.
- Final seeded models: **79 passed / 0 failed**, 269 s, including both
  5,000-sequence session models and the 3,000-seed online-client model.
- Fixture wrappers: **9/9**. Native/wasm builds, package and both app
  typechecks, docs budget, release guard and chat schema check pass.

All thirteen added tests and seven strengthened sign-out cases pass in the
full run, along with all eighteen delayed-authority createApp sequences, both
Chromium input-preservation witnesses, FX's deterministic useNow cases, and
main's live fallback while snapshot publication is blocked. The latter also
checks the unchanged behavior of the extracted presence scheduler.

Wasm from the full run: **1,981,512 B raw / 572,049 B gzip**, **792 B below**
the unchanged 572,841 B budget. SHA-256:
`1be50bb70f066dcfb224e9c26149c9a734a385f101429be26e3f5a504dec4928`.
Against round 4's artifact: 0 raw / -4 gzip bytes, with the new main merged;
this round changes no Rust or wasm input, so its implementation adds no device
bytes. This is not a claim of byte identity with round 4.

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug
information disabled, file limit 65,536. Existing tools selected through
worktree-local symlinks. No tool was installed or modified on a shared path.

Evidence: ignored `target/lane-kg-r5/`, including affected, focused, guide,
full-suite and reference logs/exit files, measurements, and five isolated
mutation loaders and their logs. Reproduce the regression set from snapback4:

```sh
node --test packages/snapback4/test/retention-lifecycle.test.mjs \
  packages/snapback4/test/retention-episode.test.mjs
node --import ./target/lane-kg-r5/signout-loading-loader.mjs --test \
  --test-name-pattern='wasm guard: sign-out' \
  packages/snapback4/test/retention-lifecycle.test.mjs
```

## Decisions, deviations and remaining issues

No design deviation or stopped design part. Suppression records actual
notification delivery, rather than assuming a shared snapshot update has
already called its listeners; this preserves delivery while deferral is active.
The source-limit extraction is the only implementation work beyond the four
findings, required by the merged file size. No authorization/disclosure rule,
meter, durable format, API, diagnostic, dependency, version or budget changes.
No independent review is claimed; the supervisor owns the two-family review.

No unresolved round-5 implementation or merge problem remains. The inherited
60-second full-suite budget remains exceeded (1510 seconds); reproduce with
`cd snapback4 && bash scripts/test.sh`. No timeout or budget was raised.

llp-orient context: Snapback 4's fence (LLP 3000); LLP 3000.023 §§3.1,
3.4–3.6 (single episode withdrawal, exact hard boundaries, and facade authority);
LLP 3000.019 §3.3 (held deadlines and live fallback); current client manual.
The governing LLPs are in current, not foundation. Scope is detached facade
access, withdrawal delivery and grouped commits. No new design decision or
LLP hand-off is needed; manual/report/journal updates suffice.


---

# Historical round-4 report

# Lane KG round 4 — synchronous facade withdrawal for every policy

Branch: `sb4-intent/kg-kept-through-authority`; release target: 0.4.5.
Read the four lane prompts, prior reports and KG journal entries, and Astra's
round-3 review. The previous reports remain below as historical evidence.
No push or publication. Every round-4 commit has the requested Astra trailer.

## Findings and commits

Merged `origin/main` at `f39598de7` in `5fd4cacd2` before implementation.
Commit `2c7200715` answers both round-4 findings:

1. **Astra High: withdrawing facade peers.** Before returning a cached read,
   `getSnapshot()` now reads its source and immediately honors `loading` or
   `denied`, updating the private snapshot too. Data still passes through the
   existing authority check. The boundary matrices now cover false/false and
   false beside omitted/true in both orders, as well as opening lingering
   remounts beside each peer policy. They exercise online discovery, offline,
   close and sign-out; wasm offline, close and sign-out; and replacement and
   restore through guardClient and createApp. Restoring only the old getter
   causes 56 of the 170 lifecycle/store cases to fail. All 170 pass with the
   fix. A separate mutation that lets the getter return unchecked source data
   fails all three existing createApp delayed-authority cases.
2. **Astra Low: preserve newer remembered answers.** A real wasm regression
   closes A (expiry 5000), remembers B for the same query (expiry 8000),
   observes A's expiry at 5000, rolls back to 1000, and fails transport.
   Recovery returns B with fresh:false. Replacing the inactive expiry callback's
   estimated server time with Infinity fails this exact assertion. The existing
   expired-A rejection controls remain. No read-expiry runtime change was needed.

## File map and merge resolutions

Paths below are relative to `snapback4/`.

| File | Round-4 change |
| --- | --- |
| `packages/snapback4/src/app-client.ts` | Synchronous source-withdrawal check in the facade getter, with LLP 3000.023 §3.6 reference. |
| `packages/snapback4/test/retention-lifecycle.test.mjs` | Add 84 peer-policy cases and the newer-memory regression; parameterize fixture data and expiry. |
| `packages/snapback4/test/retention-store-withdrawal.test.mjs` | Add 24 peer-policy cases across replacement/restore and opening remounts. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | State synchronous facade access and preservation of newer unexpired memory. |
| `packages/snapback4/test/expired-server-watch.test.mjs` | Merge FX's scheduled retry, forced invalidation, recovery and close assertions unchanged; preserve KG's warm-answer withdrawal coverage as three separate cases without the replaced wall-clock gap assertion. |
| `packages/snapback4/test/helpers/react-harness.mjs` | Merge FX's extracted pending-peer harness while retaining KG's revalidating/freshness and explicit keep:false assertions. |
| `packages/snapback4/test/react.test.mjs` | Keep FX's shared-storage ordering, clear-event and listener-lifetime coverage, using its positional harness call consistently. |
| `JOURNAL.md` | Preserve both sides of all merge append conflicts; append one round-4 entry. |
| `reports/20260927-kg-kept-through-authority/REPORT.md` | This qualification and reproduction record; retain earlier reports. |

The journal merge removes zero existing lines against either parent. The
React runner equals fetched main; the harness differs from it only in KG's
three retention-contract assertions. Every changed source stays below 1,500
lines: the largest imported source is guide.rs (1,487), and the largest KG
merge-conflict resolution is the React harness (1,427).

FX round 2 reached main during Rust qualification. Merged `8dfbf7daa` in
`4d02beeca` before client-test discovery. The change is test-only: the
ServerClock import, controlled useNow clock/timer case and Vite alias carry
through unchanged. KG's three retention assertions remain in the harness.
The merged complete React file passes **48/48**, 3.404 s. FX's ticket moved
to `issues/closed/20260927-snapback4-react-usenow-deadline-flaky.md`; its
round-2 report records the midpoint-bias cause. No runtime useNow change was
needed. The full suite exercised this final merged test file.

## Forms that compile and run

No new spelling:

```ts
const bounded = app.client.observe(api.inbox, {});
const immediate = app.client.observe(api.inbox, {}, { keep: false });
const lingering = app.client.observe(api.inbox, {}, { keep: true });
```

All three honor hard withdrawals before peer callbacks inspect them, even
when peers use different policies. Replacement data still waits for authority.
Omission keeps its original bounded episode; true keeps its linger semantics.

## Qualification

- Affected suite: **358 passed / 0 failed**, 18.874 s. Includes every retention
  test and raw-read-deadlines, read-observation, keep-authority,
  keep-observation, keep-clock and keep-app-expiry.
- Merge-conflict checks: **58 passed / 0 failed**, 12.619 s, covering the full
  React and expired-server-watch files, including all three warm cases.
- Whole guide: **86 passed / 0 failed**, 3.78 s test execution.
- Frozen Bun install, package build and typecheck pass.
- Reference audit: **517 LLP docs, 9,646 refs, zero errors/unchecked**.
- Mutation controls are process-local module loaders: old getter **114 pass /
  56 fail**; Infinity **0 pass / 1 fail**; unchecked source data **0 pass /
  3 fail**. No production or built source was mutated for these controls.

There are 109 added lifecycle/store cases plus three separately retained warm
cases from merge reconciliation. No existing product assertion was relaxed.
FX's timer-driven retry checks replace the unreliable request-arrival-gap
assertion; they still enforce all exponential delays and the one-second cap.

Ran `scripts/test.sh` **exactly once**. Final summary and client/model totals:
**`== 0 failure(s) in 1383 s`**, exit **0**. The script counts failed phases.
Final seeded models: **79 passed / 0 failed**, 313 s.

Every failure: **none** — no lane-owned, baseline or environmental test failure.
The expected pre-fix and mutation failures above are discrimination evidence,
not failures of the final code. The complete suite was not restarted or rerun.

Main client: **3,054 passed / 0 failed / 10 skipped**, 426 s; the seven
additional client shards pass **56/56**. All 170 lifecycle/store cases,
three warm-answer cases, all 18 delayed-authority sequences, both Chromium
input-preservation witnesses and FX's useNow deadline case pass in this run.

Rust tests/doctests: **3,882 passed / 0 failed / 24 ignored**, 625 s.
Both app typechecks and all nine fixture-wrapper tests pass. Native/wasm
builds, docs budget, release guard, package typecheck/build and chat schema
check pass. The FX test-only merge was included before client discovery;
runtime bytes were unchanged throughout the run.

Wasm: **1,981,512 B raw / 572,053 B gzip**, **0 B delta**, 788 B below the
unchanged 572,841 B budget. SHA-256:
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
No Rust, engine authorization/disclosure, meter, durable format, API, diagnostic,
dependency, version or budget change in this round's implementation.

Node 24.13.1, Bun 1.3.14, Rust 1.97.0, eight Cargo jobs, dev/test debug
information disabled and file limit 65,536. Tools are selected through
worktree-local symlinks to existing executables. No tool was installed or
modified on a shared path.

Evidence lives under ignored `snapback4/target/lane-kg-r4/`: build/typecheck,
merge-tests, affected, guide, full-suite, ref-check, measurements, old-getter,
infinity and unchecked-data logs and exit-status files.

Reproduce the assigned regressions from snapback4:

```sh
node --test packages/snapback4/test/retention-lifecycle.test.mjs \
  packages/snapback4/test/retention-store-withdrawal.test.mjs
node --import ./target/lane-kg-r4/infinity-loader.mjs --test \
  --test-name-pattern='closed A expiry preserves' \
  packages/snapback4/test/retention-lifecycle.test.mjs
node --import ./target/lane-kg-r4/old-getter-loader.mjs --test \
  packages/snapback4/test/retention-lifecycle.test.mjs \
  packages/snapback4/test/retention-store-withdrawal.test.mjs
```

## Decisions, deviations and remaining issues

No design deviation or stopped design part. The finite-time expiry fence was
already correct; finding 2 changes coverage only. The getter changes only
withdrawal propagation, preserving the existing data-authority mechanism.
The merge reconciles both lanes' test intentions instead of restoring the old
wall-clock pacing checks that FX replaced. No independent review is claimed;
the supervisor's two-family round-4 review remains external to this lane.

No unresolved round-4 implementation or merge problem remains. FX's earlier
expiry-retry and useNow flakes pass in this complete run. The inherited
60-second suite budget is still exceeded (1383 seconds); reproduce with
`cd snapback4 && bash scripts/test.sh`. No timeout or budget was raised.

llp-orient context: Snapback 4 fence (LLP 3000); LLP 3000.023 §§3.4–3.6 and
§5 (all policies withdraw synchronously); LLP 3000.019 §3.3 (held deadlines,
authority and newer-memory preservation); the current client manual. These
LLPs are in current, not foundation. The source getter and read-expiry callback
are the queried scope. The risk is exposing cached private data from peer
callbacks or over-deleting remembered answers; both have discriminating
regressions. The manual, report and journal are the only needed doc updates;
no new design decision or LLP hand-off.

---

# Historical round-3 report

# Lane KG round 3 — complete withdrawal and expiry lifecycles

Branch: `sb4-intent/kg-kept-through-authority`; release target: 0.4.5.
Merged `origin/main` in `a9624aab4` before implementation; no conflicts.
Read the three lane prompts, round-2 reviews, earlier reports and KG journal
entries. Previous reports remain below as historical evidence. No push or
publication. All round-3 commits include the required Astra co-author trailer.

## Findings and commits

| Finding | Commit | Resolution and discriminating evidence |
| --- | --- | --- |
| 1 — Grok High: client close changes denial into loading at row expiry | `cccacaa47` | Both clients use `closeWatchAnswers`: stop row timers and clear deadlines before denial. Twelve actual online/wasm cases cover all three policies and live/detached handles. Self-review found non-lingering detached local handles absent from the close sweep: read now gives the owner's denial precedence. Both detached cases fail before that correction. |
| 2 — both: every withdrawal must finish before callbacks inspect peers | `cccacaa47` | Discovery reuses the grouped reset; online/local link publication defers shared notifications; close batches lingering retirement and all denials. Early sign-out retirement moved into the grouped withdrawal. Thirty-five peer tests cover discovery, offline, close and sign-out, raw/guarded clients and opening lingering remounts. They inspect both raw snapshots, both exposed reads and the peer peek from shared/raw/link callbacks. Grok's first-watch-only offline mutation fails all five online cases. |
| 3 — both Medium: resubscription must rearm row expiry | `cccacaa47` | Local start rearms the saved absolute device/server/local-wakeup deadlines before rerun. Two actual wasm cases, omitted and keep:false, hold device evaluation, deliver timers at the server deadline and inspect the published field without an accessor. Removing rearming fails both. |
| 4 — Grok Medium / Astra High: inactive expiry must fence memory | `cccacaa47` | Inactive access invokes withdrawHeld with estimated server time before expire. Real wasm recovery expires A, rolls time back and fails transport: query returns E_OFFLINE. Deleting only the callback fails the closed-handle case; the live control stays green. |
| 5 — Astra Low: early episode timer mutation survives | `f32bb700e` | Start at 1000, deliver early at host time 1500, deliver the rearmed timer at 2000 without accessors. Require loading and exactly one notification. Deleting only callback rearming fails. No production episode change was needed. |

## Implementation, file by file

Paths below are relative to `snapback4/packages/snapback4/`.

| File | Change |
| --- | --- |
| `src/client.ts` | Group schema discovery, offline/sign-out publication and close; move link callbacks after withdrawals. |
| `src/local.ts` | Group offline/sign-out publication and close, and rearm saved row deadlines before a resumed evaluation. |
| `src/observe-watch.ts` | Shared close helper withdraws lingering and active watches, cancels row/presence timers, clears deadlines and defers callbacks. |
| `src/read-expiry.ts` | ExpiryClock includes estimatedServerNow; inactive server expiry applies the remembered-answer fence before withdrawal. |
| `src/read-observation.ts` | An explicit owner refusal has precedence over saved deadlines, including on a detached local handle. |
| `test/retention-lifecycle.test.mjs` | 51 regressions/controls using the actual online client and Rust/wasm local client with a controlled wire. |
| `test/retention-episode.test.mjs` | One discriminating early-delivery episode test. |
| `CLIENT-AND-OPERATIONS.md` | Record callback ordering, stable close denial, resumed absolute deadlines and memory fencing across rollback. |

This report and the single dated journal append record qualification. No Rust,
authorization rule, disclosure policy, meter, public API, diagnostic, durable
format, version, dependency, timeout or budget changed. No old assertion was
relaxed. Largest changed source: local.ts, exactly 1,500 lines. The close
helper shares the identical lifecycle operation instead of duplicating it.

## Forms that compile and run

No new spelling. The existing policies remain:

```ts
const bounded = app.client.observe(api.inbox, {});
const immediate = app.client.observe(api.inbox, {}, { keep: false });
const lingering = app.client.observe(api.inbox, {}, { keep: true });
```

All withdraw before peers' callbacks at the relevant boundary. Close preserves
one terminal denial past row deadlines. A non-resetting raw local handle keeps
its saved deadline, resubscription rearms it, and observing its server expiry
prevents subsequent offline recovery of the expired body after clock rollback.

## Qualification

There are **52 new tests**: 51 lifecycle regressions/controls and one early
clock-delivery regression. The final focused set is **125 passed / 0 failed**
(5.933 s); package build and typecheck pass. The whole guide is **86/86**
(2.56 s execution). Reference audit: **517 LLP docs, 9,635 refs, 0 errors,
0 unchecked**. Whitespace and source-size checks pass.

The broader affected run is **455 passed / 1 failed**, 428.258 s. All 18
50-ms delayed-authority sequences and both Chromium input-preservation
witnesses pass. Its sole failure is `ephemeral-keep.test.mjs`, online kept
typing, line 91: `no publication hides typing during the burst`. This is
classified **environmental/transient (inference, not a reproduced root cause)**:
the case passes immediately in isolation on final code and on the merged-input
module control; three additional baseline probes also pass, with bursts taking
2.17–2.55 s. The failed run ended at 4.051 s in a test with a four-second row
lifetime. No product assertion or timeout was changed. The full-run result
below remains independent evidence. The broader run began before the six
detached-handle controls and the denial-precedence follow-up; the final focused
set and the complete suite include those final changes.

Discrimination logs restore the five changed runtime modules from merged
input a9624aab4 in memory: **34/51 lifecycle tests fail**, the other 17 are
controls. Individual mutations fail both resubscription cases, only the
closed-memory case (live control passes), all five first-watch-only online
link-loss cases, and the early episode case. The detached-handle negative
control separately fails both non-lingering wasm cases before its fix.
The loaders never alter built files used by the full suite.

Ran `scripts/test.sh` **exactly once** on the final runtime and tests.
Exact summary: **`== 1 failure(s) in 1243 s`**, exit **1**.
The script counts failed phases, not individual assertions.

Rust tests/doctests: **3,835 passed / 0 failed / 24 ignored**, 542 s.
Main client: **2,937 passed / 3 failed / 10 skipped**, client phase 429 s.
Seven additional client shards: **56/56**. Final seeded models:
**79 passed / 0 failed (261 s)**. Fixture wrappers: **9/9**. Both app typechecks,
native/wasm builds, docs budget, release guard, and package build/typecheck
pass. All 52 new tests, all 18 authority sequences, and both Chromium witnesses
pass in the full run; the typing test from the affected run passes on all
three tiers here.

Every full-run failure (all in `expired-server-watch.test.mjs`):

| Failure | Classification | Evidence |
| --- | --- | --- |
| recover, keep=true | Baseline | Line 62: timed out waiting for paced expired-response retries. The exact variant and message reproduce on the merged-input module control. |
| close client, keep=false | Baseline | Line 64: retry 1 must back off; first gap 3.956 ms. Same variant/assertion fails on the merged-input control (8.635 ms). The failure occurs before the test calls close. |
| close client, keep=true | Baseline | Line 62: paced expired-response retries timeout, before close. Same timeout signature reproduces on merged input in recover/true and was already recorded in round 2; policy/ending variants vary between runs. |

No full-run failure is attributed to this round's changes. The merged-input
control is **4 passed / 3 failed**: recover/true times out; close watch/false
and close client/false fail first-retry pacing. It restores all five changed
runtime modules from a9624aab4, not an entire independent checkout. The
full-suite result remains red and was not rerun.

Open baseline issue: the expiry retry tests intermittently violate their
pacing/wait assertions. Reproduction:
`cd snapback4 && node --test packages/snapback4/test/expired-server-watch.test.mjs`.
The exact control is
`node --import ./target/lane-kg-r3/merged-baseline-loader.mjs --test packages/snapback4/test/expired-server-watch.test.mjs`.
Root cause beyond baseline reproduction remains unresolved. The affected
suite's transient typing assertion can be attempted with its same file set
(recorded below); its isolated
reproduction command is
`node --test --test-name-pattern='online: kept typing' packages/snapback4/test/ephemeral-keep.test.mjs`.
The original transient did not reproduce in isolation or the complete suite.
No assertion, timeout or budget was loosened. The inherited 60-second
full-suite budget remains exceeded.

Affected command, from snapback4:

```sh
node --test packages/snapback4/test/retention-*.test.mjs \
  packages/snapback4/test/raw-read-deadlines.test.mjs \
  packages/snapback4/test/read-observation.test.mjs \
  packages/snapback4/test/keep-*.test.mjs \
  packages/snapback4/test/answer-withdrawal.test.mjs \
  packages/snapback4/test/expiry-retry-watch.test.mjs \
  packages/snapback4/test/ephemeral-keep.test.mjs
```


Wasm from the full suite: **1,981,512 B raw / 572,053 B gzip**, delta **0 B**,
**788 B below** the unchanged 572,841 B cap. SHA-256:
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
Node 24.13.1, Bun 1.3.14, Rust 1.97.0, wasm-bindgen 0.2.127; frozen Bun
install, eight Cargo jobs, dev/test debug information disabled and file limit
65,536. No tool was installed or changed globally. The full-run PATH uses
worktree-local symlinks to existing Node/Bun and the existing Cargo toolchain;
the optional incompatible shared optimizer from round 2 is absent. Native and
wasm build inputs and budgets are unchanged.

Evidence: ignored `snapback4/target/lane-kg-r3/`, including `affected.log`,
`lifecycle-final.log`, `guide.log`, `full-suite.log`, `full-suite.exit`,
`ref-check-final.log`, `measurements.json`, `lifecycle-final-baseline.log`,
`detached-before.log`, the four mutation logs, and typing baseline/isolated
logs. All mutations are process-local source transforms.


## Decisions, deviations and remaining issues

No design deviation or stopped design part. Small engineering additions within
the close finding: sharing both close loops, preserving denial precedence for
a detached handle outside the map, and moving early lingering sign-out
retirement inside the complete withdrawal. The latter has failing-before
opening-remount tests on both clients. Local offline recovery retains its
existing semantics: fresh answers withdraw first; a later successful offline
read can publish remembered data. Peer tests hold that replacement so they
measure the withdrawal boundary itself.

The first test draft passed undeclared query arguments on the real device;
it was corrected to two declared query operations. Initial resubscription
assertions expected one raw notification, but expiry also triggers rerun;
the regression now requires timer notification and one stable loading object.
The exact-once assertion remains on the episode test as requested. These are
resolved test-authoring errors, not loosened existing tests.

llp-orient context: Snapback 4 fence (LLP 3000), Accepted LLP 3000.023
§§3.1, 3.4–3.6 and §6, LLP 3000.019 §3.3, and the current client manual.
The governing documents are in current, not foundation. The fixes restore
existing constraints; no new LLP decision or hand-off is needed. The previous
§3.5 keep-branch audit remains in the historical round-1 report.

---

# Historical round-2 report

# Lane KG round 2 — withdrawal boundaries and discriminating regressions

Branch: `sb4-intent/kg-kept-through-authority`; release target: 0.4.5.
Merged `origin/main` in `7d2ff6d8f` before implementation, retaining both sides
of the journal's two append conflicts. A diff against each merge parent
confirms zero removed journal lines. The previous reports follow below as
historical evidence. The Accepted LLP 3000.023 contract is unchanged.

## Findings and commits

| Finding | Commit | Resolution and discrimination |
| --- | --- | --- |
| 1 — Astra High: schema discovery loses the episode | `cb32f7971` | Discovery resets to loading and clears row deadlines. Two online regressions hold a revocation reread, advertise ephemeral support, and stall schema discovery; both fail on the old spread-copy reset. No new episode starts. |
| 2 — Astra High: a store callback sees a peer's old approval | `260eceafb` | Defer shared notifications around all store withdrawal, including endLingering. Ten tests fail before the fix and pass after: replacement/restore, createApp/guarded clients, omitted/true, and opening remounts of lingering watches. Each callback inspects a peer synchronously. |
| 3 — both Medium: opening remount misses revalidation | `185c542c0` | Return the shared notification when the follower changes the displayed snapshot, through deferred delivery. Four tests hold opening authority during reload/replacement for omitted/true. All fail without the fix; no notification is emitted for an unchanged snapshot. |
| 4 — Grok Low: closed raw local handle loses deadlines | `0e10969e2`, `85dc6ddc1` | Stop episode and row timers while retaining deadlines on non-resetting close. A removed watch enforces row expiry directly because it is no longer in the live sweep. Six deterministic tests fail before the fix; four actual wasm/process local-client tests pass, and all four fail with the old close behavior restored by an in-memory loader. A follow-up regression also proves resubscription rearms the original deadline without renewing it. |
| 5 — Astra test strength: raw access-time row check | `0d1fc50a2` | Eight live raw snapshot/peek tests cross device/server row deadlines with timers suppressed and no facade or episode. Removing only checkReadExpiry(this) fails all eight. Stable loading, one notification and rollback latching are asserted. |
| 6 — Grok test strength: live online link loss | `d1c1aabcd` | Six live online tests cover all three policies with settled/already-invalidated data and a held reread. Replacing the offline publication with reload fails four retaining cases; Grok's narrower mutation only for already-revalidating snapshots fails two. The withdrawing controls still pass. |

All commits, including the merge and final evidence commit, carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. No push or publication.

## Implementation, file by file

Paths are relative to `snapback4/packages/snapback4/`.

| File | Change |
| --- | --- |
| `src/client.ts` | Hard schema-discovery withdrawal and grouped store-withdrawal notification delivery. |
| `src/read-approval.ts` | Shared snapshot changes return their notification to the existing deferred-delivery path. |
| `src/read-episode.ts` | Separate stopping the timer from clearing its deadline, and rearm the same deadline when a handle resumes. |
| `src/read-observation.ts` | Retirement stops the episode timer while keeping access-time expiry. |
| `src/observe-watch.ts` | Clear row deadlines only when close also resets the snapshot; always stop timers. |
| `src/read-expiry.ts` | An inactive handle latches due row expiry itself. A remembered server answer still ignores a local reobservation wakeup. |
| `test/retention-online-boundaries.test.mjs` | Two discovery and six live offline regressions. |
| `test/retention-store-withdrawal.test.mjs` | Ten synchronous peer-observation tests across store boundaries. |
| `test/keep-authority.test.mjs` | Four opening-remount revalidation/deferral tests. |
| `test/raw-read-deadlines.test.mjs` | Seven closed/resubscribed-handle and eight live raw-accessor tests, with explicit clock and timer control. |
| `test/keep-expiry.test.mjs` | Four real local-client closed-handle regressions on wasm/process devices, checking both row and episode deadlines. |

This report and the single appended `snapback4/JOURNAL.md` entry record the
work and qualification. No Rust, local.ts, contract, guide card, diagnostic,
public API, authorization rule, meter, durable format, version, dependency or
budget change. Existing assertions were not relaxed in this round.

## Forms that compile and run

No new spelling. All three existing observation policies are covered:

```ts
const bounded = app.client.observe(api.inbox, {});
const immediate = app.client.observe(api.inbox, {}, { keep: false });
const lingering = app.client.observe(api.inbox, {}, { keep: true });
```

Omission retains for its original one-second episode; false withdraws on an
invalidation; true retains without that episode cap and lingers. Every policy
withdraws on discovery, store change and link loss. An opening remount receives
the revalidating mark before its own authority check finishes. After a raw local
observation closes without resetting, getSnapshot still latches its existing
row and episode deadlines; its timers and live-map membership are stopped.

## Qualification

Forty-one new tests. Initial affected set: **401 passed / 0 failed**, 20.326 s.
After the resubscription correction, its focused set passes **121/121**.
Final affected set on the complete change: **402 passed / 0 failed**, 21.017 s.
Whole guide: **86 passed / 0 failed**, 2.53 s execution. Package typecheck and
build pass. Reference audit: **517 LLP docs, 9,632 refs, 0 errors, 0 unchecked**.
Changed source/test files remain below 1,500 lines; whitespace validation passes.
Node 24.13.1, Bun 1.3.14, Rust 1.97.0; frozen Bun install, eight Cargo jobs,
dev/test debug information disabled, file limit 65,536.

Ran `scripts/test.sh` **exactly once** on the merged lane. Exact summary:
**`== 2 failure(s) in 1315 s`**, exit **1**. Failed phases: **wasm build** and
**client tests**. The script reports failed phases, not individual assertions.

Rust tests/doctests: **3,836 passed / 0 failed / 24 ignored** (607 s).
Main client: **2,886 passed / 2 failed / 10 skipped** (427 s); seven additional
shards: **56/56**. Final seeded models: **79 passed / 0 failed** (270 s). Fixture wrappers: **9/9**.
Native build, docs budget, release guard, package build/typecheck, chat schema
check and both app typechecks pass. All 41 added regressions and both Chromium
authority witnesses pass in the full run.

Every full-run failure:

| Failure | Classification | Evidence |
| --- | --- | --- |
| wasm build: wasm-opt validation rejects generated sign-extension instructions | Environmental | Binaryen 108 appeared on PATH during this task; script and input are unchanged from the merge. The supported build with the optional optimizer absent succeeds with identical bytes. |
| expired-server-watch.test.mjs: `expired server replies: recover, keep=undefined` | Baseline | Timeout at `paced expired-response retries`, line 62. The same timeout signature reproduces when all changed runtime modules are restored from the merged input. |
| expired-server-watch.test.mjs: `expired server replies: close client, keep=false` | Baseline | `retry 1 must back off`, line 64: first gap 5.158 ms. This assertion also fails on the merged-input module control. |

No full-run failure is attributed to the round-2 runtime delta. The red full
run remains red; no timeout, assertion or budget was loosened. The baseline
control and optimizer recovery are described with reproduction commands below.

Wasm is byte-identical to the round-1 input: **1,981,512 B raw / 572,053 B
gzip**, delta **0 B**, **788 B below** the unchanged 572,841 B budget. Gzip
uses the build script's gzip -9 invocation, including its filename header.
SHA-256: `5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.

Evidence is under ignored `snapback4/target/lane-kg-r2/`: affected.log/affected-final.log,
guide.log, full-suite.log/full-suite.exit, the per-finding before/after logs,
closed-devices-mutated.log, raw-access-mutated.log, offline-mutated.log and
offline-marked-mutated.log, resubscribe-before.log/resubscribe-after.log, wasm-without-optimizer.log,
plus the in-memory mutation loaders. Mutation
runs change only loaded source in their own Node process, never repository or
built package files used by the suite.

## Decisions, deviations and remaining issues

No design deviation or stopped design part. The closed-handle fix needs one
additional detail beyond retaining deadline fields: its owner has left the map,
so the normal current-watch check and live sweep cannot withdraw it. The
accessor now withdraws that inactive snapshot directly, preserving the local
wakeup exception. No timer, background reread or renewed episode is introduced.

The resubscription correction was found during self-review after the full suite
started. Its new test fails before the correction. The package was rebuilt and
typechecked during the suite's Rust phase, before client test discovery; all final
runtime and test bytes participate in that full run.

Both original prompts, both round-1 reviews, prior reports and KG journal
entries were read. llp-orient context: Snapback 4's fence (LLP 3000), Accepted
LLP 3000.023 §§3.1–3.6 and §6, LLP 3000.019 §3.3, and the current client
manual. The changed behavior restores those constraints; no LLP hand-off is
needed. The generic root inventories and Snapback 1–3 gates do not apply.

Open baseline issue: expired-response retry tests fail intermittently. Reproduce
with `cd snapback4 && node --test packages/snapback4/test/expired-server-watch.test.mjs`.
The isolated final-code rerun is **5 passed / 2 failed**: close client with
omitted options times out at `paced expired-response retries` (line 62), and
close client with false fails `retry 1 must back off` (line 64; observed gap
7.626 ms). This rerun is additional evidence, not a substitute for the full run.

An isolated loader restores all six changed runtime modules from merged-input
commit `7d2ff6d8f`, preserving the unchanged test and remaining package. That
baseline control is **3 passed / 4 failed**: recover/false and close watch/false
fail retry-1 pacing (8.812 ms and 7.798 ms); recover/true and close client/omitted
time out waiting for paced retries. Thus both failure signatures predate this
round; the affected policy variant varies. Reproduce that control with
`node --import ./target/lane-kg-r2/merged-baseline-loader.mjs --test
packages/snapback4/test/expired-server-watch.test.mjs`. It is an isolated module
baseline, not a claimed full baseline checkout. Root cause beyond reproduction
is unresolved; no assertion or product code was changed to hide it.

Environmental issue: `wasm-opt version 108`, installed into this shared host's
`~/.local/bin` during the task, rejects the generated sign-extension instructions
with the existing build script's flags (`Fatal: error validating input`).
Reproduce with the ordinary `bash scripts/build-wasm.sh` while that optimizer
is on PATH. The script and wasm input match the merged baseline exactly.
The supported path with the optional optimizer absent passes: run the script
with PATH containing the task's node symlink, `~/.cargo/bin` and system bins,
excluding `~/.local/bin`. It produces byte-identical wasm at 572,053 B gzip.
No global tool or build script was modified, and the full suite was not rerun.

The inherited 60-second full-suite budget remains exceeded. No timeout or
budget was raised. No unresolved implementation defect in the six assigned
findings remains; the baseline retries and host optimizer above remain explicit
qualification limits.

Resolved lane-authored development issues: the initial close fix stopped an
episode timer without restarting it on resubscription; the follow-up above
corrects this with a discriminating test. A test drafting error also occurred: when splitting the new boundary
file, the schema cases temporarily moved into the store test without their
imports. They were returned to the correct file and the schema commit was
amended before qualification. The preserved per-finding failure evidence was
rerun on the corrected files. Expected negative-control failures are deliberate
evidence, not failures of the final implementation.

---

# Historical round-1 report

# Lane KG round 1 — bounded default retention and authority holds

Branch: `sb4-intent/kg-kept-through-authority`. Release target: 0.4.5.
The current contract is Accepted LLP 3000.023. The round-0 report is retained
below as historical evidence; its keep-only scope, `fresh: false` mark and
exception for a replacement's earlier expiry are superseded here.
No push, publication, version bump or budget change.

## Result and integration

Merged `origin/main` at `9642d406c` in `9c131c4eb`. Kept both sides of the
JOURNAL append conflict and both Revised histories in LLP 3000.019. Read both
blind round-0 reviews in full. Grok's ordering-test finding and Astra's three
Highs plus Medium are addressed. The fixes and their discriminating tests
landed in `47befc1a8`, before the RFC implementation.

Omitted options retain an answer in one non-renewable episode ending one
second of host time after invalidation processing. `revalidating: true`
preserves `fresh`, `since` and answer identity. `keep: false` withdraws at once;
`keep: true` has no episode cap and retains its existing 30-second linger.
Each has its own watch key. Hard withdrawals replace for every policy.
The facade inherits A's episode by value, follows A's own row deadlines, and
clears shared approvals and peeks on every source withdrawal, including B's
expiry. Accessors enforce deadlines without timer delivery. Episode withdrawal
writes one stable loading snapshot without fencing a valid late replacement.

## Implementation, file by file

Paths in this table are relative to `snapback4/packages/snapback4/`.

| File | Round-1 change |
| --- | --- |
| `src/read-episode.ts` | New absolute host timestamp metadata and a timer/accessor latch; copies never renew an episode. |
| `src/read-observation.ts` | Split retain/linger, preserve identity/freshness in revalidation, check row and episode deadlines, always replace on loading, normalize per-call false, and leave a successful/interrupted internal fallback to the whole evaluation. Episode expiry changes neither revision nor resetVersion. |
| `src/read-expiry.ts` | Deadline-aware raw and held access, with the remembered-answer fence; recursive rearming preserves `withdrawHeld`. |
| `src/read-approval.ts` | Shared approval access checks row/episode deadlines, holds `revalidating` copies, inherits the timestamp by value, and withdraws/announces every reset, refusal, retirement, failure and source expiry. |
| `src/read-notifications.ts` | New synchronous notification deferral for grouped withdrawals: all source/approval snapshots change before application callbacks. |
| `src/app-client.ts` | All five keep gates follow retention; held getters use the accessor; withdrawals clear approvals for opening remounts; the refresh-version authority fence remains. |
| `src/observe-watch.ts` | Three policy keys, deadline-aware peeks, separate linger policy/timer record, retirement notification, and episode notifications to subscribers; close stays `linger || resetOnClose`. |
| `src/client.ts` | Online viewer/credential resets and rereads cover every policy, unconditional resetVersion fence, default reload retention, and explicit hard failure publication/deadline installation. |
| `src/local.ts` | Same local reset/fence/retention changes, deferred shared-approval notifications, exact expiry sweep delivery, and hard failed/expired candidate withdrawal. |
| `src/local-reads.ts` | Ordinary apply/admit/settle retain according to policy; reset operations stay hard; retaining watches preserve row timers. |
| `src/local-query.ts` | Ordinary fallback, including ephemeral refresh, defers to watch policy; explicit expiry retry still passes false. |
| `src/react.tsx` | Preserve omitted keep through observe/peek/usePage; extract Pages. |
| `src/react-pages.ts` | Combined reads carry revalidating; consult all page accessors before a cached result; handle synchronous suffix removal during deadline checks while keeping Object.is stability. |
| `src/contract.ts` | Read's optional readonly `revalidating` field, rewritten Read card and three-state ObserveOptions; explicit action-gating guidance. |
| `CLIENT-AND-OPERATIONS.md` | Default forms, episode clock/start/cap, three policies, failures, fallback composition, reset/facade rules, page cache behavior and action gating. Removed the old fallback/exhaustion exceptions too. |
| `test/retention-episode.test.mjs` | New deterministic replacement, policy, progress, deadline, key, hard-withdrawal and shared-facade tests. |
| `test/retention-pages.test.mjs` | New first/later page deadline-without-timers, stable cache, mark and cursor suffix tests. |
| `test/helpers/authority-fixture.mjs` | Extracted shared fixture with independently gated authority, controllable split clocks and the real remembered-answer cache. |
| `test/keep-authority.test.mjs` | All review regressions and their ordering cases; reverse the earlier-B-expiry expectation per RFC §3.6; preserve freshness with the new mark. |
| `test/keep-observation.test.mjs` | New loading/retention semantics, omitted facade variant, relaxed round-7 hold before A's deadlines, and a real commit revision fence. |
| `test/read-observation.test.mjs` | Separate revalidation from freshness and preserve in-progress nonpublishing fallback. |
| `test/keep-device.test.mjs` | Omitted variants for apply/admit/settle/revocation/leave/refusal and obsolete-evaluation fencing on wasm/process. |
| `test/answer-withdrawal.test.mjs` | Real membership apply, predicted leave, owner transfer and remount controls; omitted/false policies, held/thrown/unavailable/exhausted results, exact episode boundary and late null publication. |
| `test/answer-row-authority.test.mjs` | Existing immediate-withdrawal assertions explicitly choose keep:false. |
| `test/online-read-order.test.mjs` | Existing immediate-withdrawal control explicitly chooses false; ordering protections stay. |
| `test/online-client-model.test.mjs`, `test/helpers/online-client-model.mjs` | R1's immediate-revocation model explicitly chooses false; add the full-run seed-2345 replay and rerun all 3,000 interleavings. Default episodes retain their separate generated coverage. |
| `test/page-authority.test.mjs` | Preserve immediate-withdrawal/fencing controls with false; default fallback retains original freshness and marks revalidation. |
| `test/presence-refresh.test.mjs` | The explicit immediate-invalidation control uses false; failed background sampling remains uncapped. |
| `test/maintained-column-adoption.test.mjs` | Count newly served answers using fresh && !revalidating, excluding a preserved old answer before schema discovery. |
| `test/server-clock-regressions.test.mjs` | Retention keeps since unchanged; remembered wakeups preserve answer identity while notifying revalidation; completed-read clock clamping stays tested. |
| `test/ephemeral-keep.test.mjs` | Simultaneous omitted/false/true typing reads through durable bursts and held replies on every tier. |
| `test/expired-server-watch.test.mjs` | Warm answer before expired-reply series, omitted/false/true policies; verify loading throughout paced retries and recovery. |
| `test/expiry-retry-watch.test.mjs` | Replace old remembered-wakeup snapshot/no-notification assertions with preserved answer identity/data/fresh/since, one mark notification and clearing on replacement. |
| `test/keep-expiry.test.mjs` | Omitted variants across ordinary commits; failures now withdraw immediately. |
| `test/keep-incarnation.test.mjs` | Omitted ephemeral adoption plus all three credential/viewer fences; first viewer discovery retires every policy's old fetch. |
| `test/keep-adoption.test.mjs` | Omitted variants for active/peer adoption and first schema installation. |
| `test/keep-clock.test.mjs` | Omitted split-clock, rollback, delayed memory-body and newer-memory cases, keeping existing true/linger coverage. |
| `test/keep-reset.test.mjs` | Omitted raw and facade variants across wasm/process resets, with blocked old reads and callback-driven remounts. |
| `test/keep-app-expiry.test.mjs` | Omitted and true real createApp/wasm held-expiry, memory barrier, rollback and public recovery. |
| `test/prediction-routing.test.mjs` | Real evaluateLocal fallback/composition with the second local read held; A stays until the full result is ready. |
| `test/keep-app-model.test.mjs` | Eighteen generated createApp sequences: three seeds × online/wasm/process × omitted/true, with delayed authority and measured episode caps. |
| `test/keep-authority-react.test.mjs` | Plain and true hooks through 20 updates, loaded cursor changes and authoritative removal; rendered values/input state/mount count asserted. |
| `test/react.test.mjs`, `test/helpers/react-harness.mjs` | Extract existing inline browser harness below the 1,500-line limit; intentional old withdrawal controls use false; revalidation assertions preserve fresh. |

At repository scope, `llp/3000.019-what-the-builder-still-wrote.rfc.md` §3.3
and Revised record the implemented successor contract. This report and one
new append-only `snapback4/JOURNAL.md` entry record qualification. No Rust,
authorization evaluator, disclosure rule, meter, durable format or diagnostic
changed. LLP 3000.023 remains the Accepted author text.

## Forms that compile and run

```ts
const read = useQuery(api.inbox, {});                    // bounded default
const page = usePage(api.thread, { conversationId });    // bounded pages
const exportWatch = app.client.observe(api.inbox, {}, { keep: false });
const remountWatch = app.client.observe(api.inbox, {}, { keep: true });
const canCopy = isReady(read) && !read.revalidating;
```

No Quarry syntax or new option spelling is introduced. `client.observe`
also accepts omitted options, and both hooks accept either explicit boolean.
False opts out of retention; true opts into uncapped retention and lingering.
`fresh: false` can still describe a completed offline read with no revalidation.

## Review findings: discriminating evidence

- Astra High 1: both held snapshot/peek access check device and server deadlines
  before timers, latch withdrawal and fence delayed remembered bodies across
  rollback. Reverting the accessors makes four new regressions fail.
- Astra High 2: rearmed timers retain the memory callback. Removing only the
  recursive callback argument fails the early-timer/rollback/newer-C test.
- Astra High 3: reset, refusal and retirement notify opening remounts after
  shared withdrawal. Removing those notifications makes three tests fail.
- Astra Medium and Grok: B and C have independent gates. Resolve B while C
  waits: A stays. Refuse C then approve B: denial stays. Removing the version
  fence fails both cases.

These four isolated negative controls ran before the full suite, with generated
bytes restored. Logs: `negative-accessors.log`, `negative-rearm.log`,
`negative-notifications.log`, `negative-ordering.log` under the evidence path.

The real Chromium witness also fails on replacement 1 when Vite substitutes
only main's `app-client.ts` from `9642d406c`: the query draft becomes empty.
Other final runtime modules remain present in that control, so this specifically
isolates main's facade withdrawal. This is not a claim of testing a full main
checkout. The final facade passes both plain and keep:true browser witnesses. The plain
witness delays each serialized storage read by 5 ms, keeping its three watches
inside the cap; true retains the 50 ms delay. The generated tests use 50 ms
for both policies and explicitly verify longer bursts withdraw at the cap.
The control uses an isolated transform; no live suite bytes were mutated.

## LLP 3000.023 §6 evidence index

| Item | Evidence and assertion |
| --- | --- |
| 1 | retention-episode + keep-device: data/null/empty/refusal replace A, preserve A's fresh/since during the wait, clear the mark on replacement and reject pre-commit work. |
| 2 | answer-withdrawal: real apply membership revocation, predicted admit leave and owner transfer on wasm/process, each held/throwing/unavailable/retry-exhausted; false controls withdraw at commit, default shows marked A before the cap, then loading or null. For local exhaustion the same real row query also samples an ephemeral table and receives four stale epochs: this exercises runLocal's finite retry path. Ordinary durable reads have no equivalent finite stale-epoch loop. Online membership exhaustion uses four obsolete sequence replies. |
| 3 | keep-clock/expiry/adoption/incarnation/reset, plus createApp keep-app-expiry: omitted policy through split clocks, rollback, memory fences, owner/peer adoption, first schema and blocked old reads; reset tests include raw and guarded wasm/process observations. |
| 4 | keep-authority + retention-episode + keep-observation: A→B hold, refusal, A/B expiry, late completion after reset, exact own deadline, and independent authority ordering. |
| 5 | keep-authority-react: real client/facade browser notifications, 20 updates, second-page cursor replacements and final empty removal; values, two draft inputs and one mount each checked. Main-facade control fails. |
| 6 | keep-device/keep-observation + retention-episode: join active watch, only true lingers, exact 30-second boundary before timers, scope isolation and both mixed acquisition orders. |
| 7 | keep-app-model: 18 sequences, seeds 23/44/445 on online/wasm/process, every authority-store read delayed 50 ms, observed sync pages/writes/predictions/settlements/server changes; loading allowed only at a measured cap or a named hard withdrawal. |
| 8 | retention-episode: timestamp begins at invalidation, A→B→C never extends it, peek/getSnapshot/timer share one stable loading snapshot, host rollback cannot resurrect A, late success still publishes. |
| 9 | retention-episode/pages, expired-server-watch, ephemeral-keep, prediction-routing and keep-incarnation: all three keys/options, forced false, warm expired replies, held composition, facade mark/source withdrawals, page cache/access deadlines, credential capture and live Bob viewer. |
| 10 | retention-episode + keep-expiry + answer-withdrawal + generated offline transitions: thrown rerun, retry exhaustion, transportOffline, link loss and explicit false are hard withdrawals for retaining watches. |
| 11 | keep-device and keep-observation use actual commit fences; pre-commit replies cannot land afterward with omitted options. |
| 12 | keep-incarnation's live viewer change covers omitted/false/true and clears Alice before Bob's held read; keep-reset covers local viewer resets. |
| 13 | plain createApp browser witness and default authority tests keep the child mounted until A's own deadline or its original episode cap. |
| 14 | retention-episode clear_rows/settle_exit plus real keep-incarnation/adoption/reset cases: hard resets never retain and stale work stays fenced. |

## §3.5 branch and per-call retention audit

Locations below refer to `47befc1a8` (merged main plus the review fixes), so a
reviewer can reproduce every original match. The final search has no watch
`keep` property; the remaining `options?.keep` uses preserve three values.

| Original branch/site | Final dependency |
| --- | --- |
| app-client.ts 85, 104, 113, 122, 214 (initial attach, refresh attach, hold, approve, peek) | Retain: each is `options?.keep !== false`. |
| client.ts 195 (resetKept reset), 196 (notify) | Every watch; renamed resetWatches, grouped withdrawal before notification. |
| client.ts 334 (setViewer reread), 452 (credential notification) | Every watch. Credential success rereads every watch. |
| client.ts 644 (refresh reload) | `watch.retain`, before the in-flight test; another invalidation never renews the episode. |
| client.ts 652 (skip deadline installation on loading/offline) | Removed; hard candidates replace and install their own deadlines. Ordinary reload preserves old deadlines separately. |
| client.ts 655 (resetVersion fence) | Every watch, unconditional. |
| client.ts 866 (normalize keep), local.ts 1207 (same) | Preserve undefined; observationKey chooses retain:/withdraw:/keep:. |
| local-reads.ts 130 (ordinary commit timer survival) | `watch.retain`; resets still clear timers for all watches. |
| local.ts 437 (credential reset), 497 (notify) | Every watch; clear deadlines and deliver shared reset notifications. |
| local.ts 979 (presence result deadlines), 1014 (rerun result deadlines) | Skip removed: explicit loading is hard; failed presence sampling still follows its separate existing no-publication path. |
| local.ts 992 (rerun reload) | `watch.retain`. |
| local.ts 1003 (resetVersion fence) | Every watch, unconditional. |
| observe-watch.ts 24 (peek map key) | Three policies via observationKey, combining retain and linger. |
| observe-watch.ts 48 (close reset) | `watch.linger || resetOnClose`, exactly as required. |
| observe-watch.ts 71 (release), 80 (acquire), 85 (unsubscribe) | `own.linger` only; timer bookkeeping is named `lingering`. |
| react.tsx 110/111 (observe/peek), 219 (Pages constructor) | Options passed intact; memo dependency keeps undefined/false/true distinct. |
| read-observation.ts 42 (fetch retain override) | `retain !== false && this.retain`; false wins even with linger. |
| read-observation.ts 91 (publish swallows loading) | Removed. publish always replaces; reload is the separate retaining operation. |
| ReadObservation constructor | `retain = keep !== false`, `linger = keep === true`; only retain without linger has an episode cap. |
| writes.ts 186/193/199 (`this.keep(...)`) | Unrelated durable receipt persistence method, unchanged. |

The `watch.kept` latch sites (client 632/661/668, local 762–766 in the RFC's
base; current client 639/668/675, local 767) now apply to every retaining
watch because reload sets the latch by retain, not linger. Local freshness
promotion reruns a revalidating answer instead of treating it as newly current.
The asset view's separate `this.options.keep` is unrelated to live observations
and is unchanged.

Per-call audit: local-query's ordinary `server(..., retain = true)` and
`routeLocal(..., retain = true)` now leave fetch's retain option absent. This
includes ephemeral refreshes, which formerly supplied false. The expiry retry
still calls `routeLocal(refreshed, false)` and passes `{ retain: false }`.
Online fetches defer to observation policy; one-shot reads have no watch.
`publishResult: false` never finishes a successful fallback early, and an
internal commit-interruption exception leaves withdrawal to the full rerun.
An exhausted whole read, loading candidate or explicit false remains hard.

## Qualification

Evidence directory: `snapback4/target/lane-kg-r1/` (ignored build output).
Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug
information disabled, fd limit 65,536. Frozen Bun installation and package
build/typecheck pass.

- Whole guide: **86 passed / 0 failed** (`guide.log`).
- Episode/authority focused set: **107/107** (`episodes.log`).
- Device/expiry regression set: **141/141** (`device5.log`).
- Default reset/clock set: **110/110** (`default-resets.log`).
- React/online/expired-reply compatibility set: **72/72** (`compatibility6.log`).
- Extended revocation, default memory and real composition set: **273/273**
  (`extended-evidence.log`); includes all six local revocation/exhaustion cases.
- Generated createApp sequences: **18/18** (`models2.log`), 427 s.
- Chromium authority witnesses: **2/2** (`browser2.log`).
- Final expiry-retry file after the full-run findings: **14/14** (`expiry-retry-final.log`).
- All five full-run finding files after correction: **59/59** (`full-findings-final.log`).
- Final immediate-revocation model: **27/27**, all **3,000 seeds**, including
  the new seed-2345 replay, 57.151 s (`online-model-final.log`).
- Reference audit: **0 errors / 0 unchecked** (`ref-check-final.log`); whitespace check passes.

These focused groups overlap; their counts must not be added as unique tests.
The full suite runs the combined set. The expanded test evidence and remaining
manual correction were completed during its Rust phase, before client discovery.
Seventeen old semantic assertions across the client tests and the immediate-
revocation model failed in that run and were then updated. The first two are
in `db86ef80c`; the remaining client assertions are in `80ed62092`. The model
now opts into its stated immediate-withdrawal policy. No runtime bytes changed
after the full suite began, and the full suite was not rerun.

Wasm: **1,981,512 B raw / 572,053 B gzip**, unchanged from merged main,
**788 B below the unchanged 572,841 B cap**. SHA-256:
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
The difference from round 0 is inherited from main, not this TypeScript change.
All changed source/test files are under 1,500 lines (`local.ts`: 1,497;
extracted React test harness: 1,430).

Ran `scripts/test.sh` **exactly once**. Exact summary:
**`== 2 failure(s) in 1406 s`**, exit **1**. Failed phases: **client tests**
and **client models**.

Rust tests/doctests: **3,835 passed / 0 failed / 24 ignored** (696 s).
Main client: **2,746 passed / 16 failed / 10 skipped**; seven additional shards:
**56/56** (client phase 428 s). Final seeded models: **77 passed / 1 failed**
(244 s). Fixture wrappers: **9/9**. Native/wasm builds, docs/wasm budgets,
release guard, package typecheck/build and both app typechecks pass.

Every full-run failure is listed below. All **17 are ours**: assertions of
behavior deliberately changed by LLP 3000.023, including the schema test's use
of fresh as a proxy for a newly served answer. No failure is attributed to the
baseline or environment. Runtime bytes needed no further change.

| Failed test | Classification | Correction |
| --- | --- | --- |
| `expiry-retry-watch.test.mjs` — expiry retry remembered branch timer watch wasm | Ours | Old same-snapshot/no-notification assertion; now pin revalidating, preserved identity/freshness and replacement. |
| `expiry-retry-watch.test.mjs` — expiry retry remembered branch timer watch process | Ours | Old same-snapshot/no-notification assertion; now pin revalidating, preserved identity/freshness and replacement. |
| `maintained-column-adoption.test.mjs` — column activation: sqlite, server watch | Ours | Fresh no longer excludes the retained copy; exclude revalidating when recording newly served answers. |
| `page-authority.test.mjs` — applied revocation clears kept and remembered answers and fences in-flight server publications (post-commit failure: false) | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — applied revocation clears kept and remembered answers and fences in-flight server publications (post-commit failure: true) | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — a server-class observation uses ordinary device-fallback retention during HTTP | Ours | Default fallback preserves fresh/since and adds revalidating; update the mark assertion. |
| `page-authority.test.mjs` — a predicted membership removal clears a kept private answer before the pending send | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — predicted expireSecret: every commit clears the pending observation | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — predicted expireMember: every commit clears the pending observation | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — online client drops a heap-aborted private answer within one fetch, including after revoke | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `presence-refresh.test.mjs` — an invalidation during a background refresh withdraws at once, and the late refresh is discarded | Ours | The immediate-invalidation control now explicitly uses keep:false. |
| `server-clock-regressions.test.mjs` — syncedAt, device since and remembered server since remain wall time under +25h skew | Ours | Revalidation preserves since (including its absence); completed-read publication still clamps clock age. |
| `server-clock-regressions.test.mjs` — freshness is clamped at publication after wall time rolls back | Ours | Revalidation preserves since (including its absence); completed-read publication still clamps clock age. |
| `server-clock-regressions.test.mjs` — remembered wakeup retains data until its own server deadline (null, early=false) | Ours | Remembered data stays with preserved identity/freshness and a revalidation notification. |
| `server-clock-regressions.test.mjs` — remembered wakeup retains data until its own server deadline (null, early=true) | Ours | Remembered data stays with preserved identity/freshness and a revalidation notification. |
| `server-clock-regressions.test.mjs` — remembered wakeup retains data until its own server deadline (600, early=false) | Ours | Remembered data stays with preserved identity/freshness and a revalidation notification. |
| `online-client-model.test.mjs` — online clients preserve R1–R6 across 3,000 seeded interleavings (seed 2345, client) | Ours | R1 pins immediate withdrawal; its observations now use keep:false, preserving the strict invariant. Added a named seed-2345 replay. |

The first two failures were independently reproduced with
`node --test --test-name-pattern='remembered branch timer'
packages/snapback4/test/expiry-retry-watch.test.mjs`; the final whole file passes
14/14. The five affected files then pass together: **59 passed / 0 failed**, in 11.641 s (`full-findings-final.log`).
The full model file then passes **27/27**, including all **3,000 seeds** and
the new seed-2345 replay, in 57.151 s (`online-model-final.log`), committed as
`6c0dec7f0`. The full-run red is preserved; it is not relabeled as green, and
the whole suite was not rerun. No unresolved lane failure remains.

## Decisions, deviations and open problems

Engineering choices: a WeakMap carries the absolute host timestamp alongside
the existing answer identity; a small latch owns timer/access checks; raw and
facade holds have independent latch state but share the timestamp by value.
This avoids adding an exported deadline field or coupling a late result to a
reset. Shared notification deferral preserves the two-phase withdrawal invariant
through raw reset batches and the existing expiry sweep. Pages and the browser
harness were extracted to stay within the source-size rule.

The accepted RFC deliberately supersedes round 0's scope, mark, source-B-expiry
exception and default-withdrawal assertions. Tests of the old immediate behavior
now request false; tests of retention assert revalidating without changing fresh
or since. There is no design deviation, engine authorization change, cap increase
or stopped design part. No new public option, external service or dependency.

Resolved lane-authored development failures included stale semantic assertions,
fixture timing/gating mistakes, an owner-transfer fixture initially sent by the
wrong owner, the new retry fixture's count syntax, and internal fallback
interruption briefly publishing loading. These were corrected and their focused
suites passed; expected negative-control failures are evidence, not suite failures.
Full-suite failures and any remaining issue are recorded with the result above.
The inherited 60-second complete-suite budget is still exceeded (reproduce with
`cd snapback4 && bash scripts/test.sh`); no test timeout or budget was raised.
This is an existing runtime-budget gap, not a failing product assertion.

Orientation: used llp-orient, the Snapback 4 fence (LLP 3000), 3000.023 §§3–6,
3000.019 §3.3, 3000.018 §3.2 and 3000.013 §6, plus the current client manual.
No unresolved design hand-off. Every lane commit carries the required
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer.

Round-1 commits: `9c131c4eb` (merge), `47befc1a8` (review fixes),
`53e2ea798` (RFC implementation and regression coverage), `4dd0aa619`
(generated actions and browser witnesses), `db86ef80c` (the first two full-run
assertion corrections), `80ed62092` (the remaining assertions, 59/59 final),
`6c0dec7f0` (immediate-revocation model and full seeded rerun), followed by
the evidence commit.

---

# Historical round-0 report

# Lane KG — kept answers through replacement authority

Branch: `sb4-intent/kg-kept-through-authority`, based on `9473e0a34`.
No push or package publication.

The facade keeps its last authorized answer while a replacement awaits
`authorized()`, with `fresh: false` and the original `since`. It shows the
replacement only after authority, refuses immediately when the check refuses,
and withdraws the held answer at its own deadline. Non-kept observations keep
their immediate replacement withdrawal.

## Implementation, file by file

All package paths below are relative to `snapback4/packages/snapback4/`.

| File | Change |
| --- | --- |
| `src/app-client.ts` | Attach shared approvals to kept observations, reuse them for peeks and opening remounts, gate replacement publication, reject held answers on opening or replacement authority failure, and release them on facade fencing. A refresh revision prevents an older check from publishing after a newer raw event. |
| `src/read-approval.ts` | New internal helper: one approved snapshot per facade/live raw watch. Carries stale metadata, listens for raw changes, owns one expiry registration, and shares notifications with remounts. Raw reset/close removes the registration; there is no separate retention window. |
| `src/read-observation.ts` | Weakly associate snapshots with their owning watch, preserve identity through freshness copies, expose the original freshness time, and notify internal followers about answers, scope resets and expiry. |
| `src/read-expiry.ts` | Attach held deadlines to the raw watch and include them in its existing timer/clock-correction sweep. Withdraw all due holds before any subscriber runs. Local reobservation wakeups do not expire remembered server data. |
| `src/client.ts` | Distinguish expiry of an online raw answer from a scope-ending reset. |
| `src/local.ts` | Make the same distinction for local reads, preserving immediate denial and existing remembered-answer expiry fencing. |
| `test/keep-observation.test.mjs` | Replace the old kept-answer withdrawal expectation; retain the non-kept control and reset/identity checks. |
| `test/keep-authority.test.mjs` | Add deterministic authority, deadline, remount, rollback, reset and opening-storage-error regressions. |
| `test/keep-app-expiry.test.mjs` | Exercise held expiry on a real wasm client, fence a late HTTP memory write across rollback, and recover newer B through the public client. |
| `test/keep-app-model.test.mjs` | Add six generated action sequences on the real server with online/wasm clients and delayed authority. |
| `test/keep-authority-react.test.mjs` | Add a real Chromium/React regression for both kept hooks and local input state through 20 replacements. |
| `CLIENT-AND-OPERATIONS.md` | Document held replacement authority, original deadlines, remount peeks and unchanged non-kept behavior. |
| `llp/3000.019-what-the-builder-still-wrote.rfc.md` (repository root) | Update §3.3 and the Revised header with the implemented contract. |

The journal entry and this report record qualification. `app.ts` and
`observe-watch.ts` need no edit: the existing authorization checks and raw
30-second linger lifecycle are reused.

## Forms that compile and run

No new public API or Quarry spelling:

```ts
const watch = app.client.observe(api.thread, { conversationId }, { keep: true });
const query = useQuery(api.inbox, {}, { keep: true });
const page = usePage(api.thread, { conversationId }, { keep: true });
const immediateWithdrawal = app.client.observe(api.inbox, {});
```

The first three preserve an approved answer during replacement authority.
The fourth retains the existing immediate withdrawal behavior.

## Tests and measurements

- `keep-observation.test.mjs`: 32 passing cases, including both `keep` settings
  for A → B with B's authority blocked; A stays stale only with keep, expires
  on a clock sample at its own deadline, and B appears after authority.
- `keep-authority.test.mjs`: 13 passing cases. Device and server deadlines
  each use timers and clock samples; opening remounts receive expiry even
  before their initial check completes; rollback cannot resurrect A;
  device wakeups do not expire remembered server data; B's earlier deadline
  cannot expire A; all held answers withdraw before callback-driven rollback;
  resets, denial, failed authority, fencing and linger close release holds;
  an opening storage error denies all subscribers instead of preserving data.
- `keep-app-expiry.test.mjs`: 1 passing wasm/createApp regression. Held A
  expires while raw B awaits authority; callback-driven clock rollback and a
  late higher-cut memory write cannot resurrect A, and public offline recovery
  still returns B. A process-local module-loader negative control that removes
  only the held-memory callback fails: the cache contains A instead of B.
- `keep-app-model.test.mjs`: 6 passing sequences, seeds 23, 44 and 445 on
  both online and real wasm clients. There are 108 generated actions total:
  remote changes, bursts, local writes, remounts and, on wasm, offline
  predictions and settlements. Every session-store read during those actions
  waits 50 ms. Assertions inspect every published snapshot after initial data,
  confirm actual sync pages/predictions/settlements, and require close to
  withdraw the answer.
- `keep-authority-react.test.mjs`: Chromium renders a kept `useQuery` editor
  and kept `usePage` editor, types distinct drafts, then delivers 20 server
  replacements under delayed authority. Both inputs preserve their text,
  each editor mounts once, stale data renders, and no loading commit occurs.
  Negative control: replacing only `app-client.ts` with the source at
  `9473e0a34` fails on replacement 1: empty text instead of `query draft`.
  The modified source was restored before qualification.
- Existing keep/clock/device/expiry/reset/adoption/incarnation/ephemeral
  regressions: 100 passing tests, including wasm and process-device coverage.
- Whole guide: 86 passed, 0 failed. Package typecheck/build pass. No diagnostic
  code or guide card was added. Source files changed here remain under 1,500
  lines (largest: `local.ts`, 1,477).
- Wasm, by `scripts/build-wasm.sh`: 1,980,253 B raw / 571,810 B gzip, unchanged
  from this lane's initial build, 1,031 B below the unchanged 572,841 B cap.
  SHA-256: `324a54065e8d7077fe63e1d73dd26b24db29d8e8583d8a35753643f106c3fecc`.
  There are no Rust or engine changes and no change to meters.

Ran `scripts/test.sh` exactly once. Exact summary: **`== 0 failure(s) in 1382 s`**,
exit **0**. No introduced, baseline or environmental suite failure. Rust tests
and doctests: **3,809 passed / 0 failed / 24 ignored**, 906 s. Client main:
**2,503 passed / 0 failed / 10 skipped**; seven additional shards: **56/56**,
client phase 197 s. Final seeded models: **78/78**, 260 s. Fixture wrappers:
**9/9**. Builds, typechecks, docs/wasm budgets and the release guard all pass.
The complete guide test runs both independently and in the full suite.
Reference audit: `./ref-check --verbose` passes with zero errors/unchecked.
Evidence logs are under `snapback4/target/lane-kg/` (ignored build output).

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug
information disabled and file limit 65,536. Frozen Bun installation passed.
The opening-refusal and fallback-memory hardening landed while the full suite
was in its Rust phase. The final package was typechecked and rebuilt before
the client phase; that phase ran every final runtime and test change.

## Decisions, deviations and remaining work

Chose to keep the superseded answer's deadline attached to the raw live watch,
rather than add a separate facade clock subscription. This preserves the
existing two-phase expiry sweep: every due answer is withdrawn at one captured
clock sample before any notification can roll the estimated server clock back.
The facade holds at most one approved answer per live watch, shares it across
remounts, and releases it when the raw watch resets/closes or the facade fences.

The internal `read-approval.ts` module and the online/local expiry distinction
are engineering choices within the brief. A replacement expiring earlier is
not a scope reset and must not expire a still-valid held answer. No public
contract, engine authorization, disclosure, durability, meter, version or
budget change was needed. There is no design deviation or stopped design part.
No open problem or reproduction remains after qualification. Both intentional
negative controls fail as expected; the full suite has no failures to classify.

The first generated-test draft incorrectly treated `/changes` as a POST,
and the first browser draft tried a mutation without browser durable
admission. These were test-harness defects. The initial browser harness also needed a
Vite alias for React’s JSX development runtime, and typechecking caught two
new internal type declarations that needed correction. All were corrected
before the full suite’s client phase; the final tests use the real change-feed
GET and browser server notifications. These are resolved lane-authored
development failures, not baseline or environmental failures.

## Orientation and scope audit

Applied the repository's `llp-orient` skill after initializing the missing
`vendor/llp` submodule. Governing constraints: LLP 3000 (Snapback 4 fence),
LLP 3000.019 §3.3 (keep, expiry, remount and reset), LLP 3000.018 §3.2
(background refresh and remembered expiry), and LLP 3000.013 §6 (facade
lifetime/authority). 3000, 3000.013 and 3000.019 are in `llp/current`; none is
in `foundation`. The lane brief supplies the accepted amendment to keep
through authority. Documentation updates are confined to §3.3, the client
manual, append-only journal and this evidence report. No further LLP hand-off.

## Commits

- `c1d5ff653` — keep approved app answers through replacement authority.
- `5b4e63249` — generated createApp and React editor regressions.
- `f1bfec08e` — opening authority errors withdraw shared held answers.
- `4b97bf06b` — held expiry fences fallback memory before clock rollback.
- Final evidence commit — this report and the single append-only journal entry.

Every commit includes the required GPT-6 Astra co-author trailer. No push,
publication, version bump, budget increase, full comparative, or Apple UI run.
The supervisor's independent reviews and integration remain external to this lane.
