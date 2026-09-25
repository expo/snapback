# Lane U round 8: expiry on every publication and speculative compositions

2026-09-25. Based on `cdb029a83`, branch `sb4-intent/u-bounded-following`.
Implementation commit: `2919dd93d`. No push or publication. This report supersedes round 7's retained-component
exception; the five procedure numbers are unchanged.

## Contract decision

Used the round-8 brief's explicitly authorized **whole-composition loading**
fallback. `Read<T>` (`packages/snapback4/src/contract.ts:52`) admits `data: T`,
whole loading, or refusal. It has neither component loading metadata nor a
partial record type. LLP 3000.001's composition contract publishes one complete
record atomically; its component coverage is a device-to-client fact, not a
public result variant. For `T = { older: Message[], events: Event[] }`, emitting
`data: { older }` would violate the contract, and an empty `events` would publish
the placeholder. A contract change belongs to the supervisor. No rows are
removed from the device: a later answer can recover retained history.

## Rules and tests

| Rule | Behavior and coverage |
|---|---|
| 1. Session/incarnation | All existing await/publication checks remain. `query-publication-session.test.mjs` covers sign-out and close at local execution, dispatch, transport, delivery and final publication; router cases also cover remembered recovery. |
| 2. Known complete local wins | Unchanged local-first precedence and narrowing only when known **and complete**. Quarry/native and held controls, real known branches, untaken cards, and the 8,193-event scalar cut remain. New `delayed local data expires (complete=true)` proves known data still cannot publish after its deadline. |
| 3. Engine withholding | Original arguments, offline/prediction/held precedence and transport-failure loading remain. Existing card/repost/inbox-floor, meter-prefix, meaningful native cursor and native reset/install tests remain. |
| 4. Unknown available results | Delete the retained-sibling exception. A speculative composition loads as a whole when fallback cannot supply its missing knowledge; no whole-answer memory. Twelve routing cases cover retained nonempty/empty/scalar values beside speculative null, fenced/unfenced and offline/failed transport. Real wasm/process retainedPoint and homePage cases cover speculative null/empty components. Non-speculative retained data and predicted pages retain their existing partial-data tests. Real wasm/native nonempty speculativePage is withheld even when it contains the predicted post. |
| 5. Publication fence and expiry | Every data candidate now checks nextExpiry immediately before publication, including origin local. Real wasm/process `MQ expiry local left` delays a live retained row's device reply across its deadline. `MQ local permit` delays the final outbox wait across a synced secret's permit deadline, then verifies a fresh device evaluation denies that secret. Existing server/composed delayed deadlines, late predictions, remembered races, original-since and caughtUp/identityChecked tests remain. |

Publishing paths stay behind the same numbered procedure: server and composed
answers use the dispatch/delivery/final prediction gates; remembered answers and
E_OFFLINE use recovery and final gates; known local results avoid fallback;
unknown local results use rule 4. Authoritative server refusals/loading remain
answers, covered by page-authority and the composed-refusal router cases.
All data origins now share the same final expiry check.

## Files

| File (relative to snapback4/) | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Remove retainedComposition; speculative local fallback loads. Remove the local-origin exemption from final expiry rejection. Update the numbered procedure comment. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Three client-reference lines explain whole-composition withholding, preservation of non-speculative history, and expiry checks for all data. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Change the four old retained/speculative assertions to loading; extend to retained empty/scalar values; add delayed complete and partial local expiry cases. |
| `packages/snapback4/test/bounded-following.test.mjs` | Add speculativePage to the real wasm/native prediction-fence reproduction: a nonempty shaped owned-event page with speculative device presence, including the predicted own post. |
| `packages/snapback4/test/retained-history.test.mjs` | Update retainedPoint offline/failed-fallback expectations; add real row-deadline and permit-deadline interleavings, the filtered home record, and an independently composable online-only events-page control. |
| `reports/20260925-bounded-following-r8/mutations.py` | Reproducible old local-expiry exemption, restored/broadened retained exception, and nonempty-array placeholder mutations; always restores the built module. |
| `reports/20260925-bounded-following-r8/*.log.gz` | Qualification and mutation evidence. |
| `JOURNAL.md` | One dated append-only entry. |

## Forms exercised

No new language spelling or refusal code. Existing forms compiled and run on
both device hosts include:

```quarry
query retainedPoint():
  return {left: messages['left'] last 50 by byTime, right: messages['held-0']}
query home():
  return {older: messages['left'] last 50 by byTime, events: feedPosts last 10 by .at where exists eventSwitch['gate']}
query homePage():
  return {older: messages['left'] last 50 by byTime, events: eventSwitch first 10 by byId}
query speculativePage():
  return feedPosts last 10 by .at {post: .postId, online: exists connected[.authorId]}
```

`retainedPoint` and `homePage` keep their server-backed compositions online and
load offline/under the fence, never publishing speculative null/empty siblings.
`speculativePage` has a nonempty local array, including own-gated, but its
presence values are speculative, so it loads under the fence on both hosts.

The exact filtered `home` form compiles, but **this checkout's compiler refuses
a component plan for a field with two read sites** (feedPosts plus eventSwitch).
The test asserts that fact: offline it recovers the whole remembered server
answer with real events and fresh=false; while fenced it loads. The `homePage`
control has one read per field and proves actual retained component coverage,
offline and with predictable unobserved post/message writes. No compiler
eligibility rule was weakened to manufacture the review's component envelope.

## Review disposition, deviations and open problems

Read all four requested reviews: Z-r2 Astra and Grok, U-r7 Astra and Grok.
Grok U-r7 arrived during the full suite; its new speculative-sibling finding
is covered by this implementation. The shared Highs are fixed. Astra's empty/scalar retained
mutation gap is superseded by whole-composition loading and covered explicitly.
Grok U-r7's suggestion to substitute null for a speculative component conflicts
with the round-8 decision: null is still a placeholder and need not belong to
that field's type. Its proposal to keep non-speculative components separately
hits the same public-contract limit documented above. Its surviving
`c.retained || c.speculative === false` mutation concerns the deleted exception;
restoring that broader exception fails all twelve new loading assertions too.
Its request to keep the local-origin expiry exemption until another engine
signal exists is superseded by the explicit round-8 all-origin deadline rule.
Lane Z's snapshot-accounting mutations belong to code absent from this worktree;
no event-slot storage changes are imported into U.

**Stopped the repeated Medium request to keep unrelated remembered rows after
ordinary row expiry.** The accepted reply has one nextExpiry, with no distinction
between a returned row's lifetime and an authorization witness's lifetime. A
client-only exception cannot be sound. Concrete counterexample: an online-only
secret has no own expiry and is readable through an expiring permit; its cached
answer contains that secret and nextExpiry=T. Keeping it after T discloses a row
that a fresh device/server evaluation refuses. The new real permit regression
makes the same problem observable for a local composition during an await.

Separating deadline reasons requires an engine/wire design decision; preserving
only unaffected values of a projected result can additionally require provenance
or a partial-result contract. Neither is supplied by this lane's decided design.
For example, `{message: messages[id], typing: exists typing[p]}` has no expired row
object to remove: keeping true past typing's lifetime is a placeholder, and
omitting that required field is not `Read<T>`. The brief explicitly rules out
value-level provenance and permits whole-result loading when the component
contract is insufficient. We retain the hard cutoff and do not claim this
availability finding fixed.

Reproduction of the remaining limitation: cache an online-only two-row answer
containing a live message and a typing row expiring at T; disconnect; query after
T returns E_OFFLINE, and the watch loads. The live message is also withheld until
an authorized reevaluation can answer. No expired answer is published.

No acquisition, packed IndexedDB, inventory or browser-time remeasurement this
round. Historical whole-partition evidence, measured in round 1 with events
fully synced, remains the following (raw serialized row bytes, not IndexedDB
file bytes):

| Table | Before rows | After rows | Before bytes | After bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| followingPosts | 49,228 | 49,228 | 7,796,444 | 7,796,444 |
| followingRemovedEvents | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| followingFeed | 24,555 | 1,000 | 7,938,537 | 327,458 |
| profiles | 1,008 | 1,008 | 357,825 | 357,825 |
| followingWork | 63 | 63 | 22,132 | 22,132 |
| **Whole partition, including other tables** | **171,330** | **98,543** | **35,901,571** | **15,092,169** |

Cold Chromium acquisition: **281,263.9 -> 117,812.5 ms (2.387x)**. The 5x
target remains unmet; fully synced owned events dominate. The complete table,
fixture and browser reproduction are in the
[round-1 report](../20260925-bounded-following-r1/REPORT.md). This is historical
evidence, not a new packed-format measurement. No timeout/ceiling increase, new skip, reduced model count,
contract extension, source file above 1,500 lines, push or publication.

## Qualification

Affected client run: **227 passed, 0 failed, 0 skipped**, 245.475 s, across
prediction-routing, bounded-following, retained-history, residency,
page-authority and query-publication-session. Frozen dependency install and
package build passed. Reference audit before the final evidence append:
`ref-check: ok — 509 LLP docs, 9296 refs in 26159 files, 0 errors, 0 unchecked`.

Mutation checks (expected failing tests, not product-suite failures):

| Mutation | Tests rejecting it |
|---|---|
| Restore origin != local exemption | Four real-device row/permit deadline tests, 0 passed / 4 failed. |
| Restore retained-sibling exception | Twelve retained nonempty/empty/scalar routing cases, 0 passed / 12 failed. |
| Broaden exception to retained OR non-speculative component | The same twelve cases, 0 passed / 12 failed; the U-r7 Grok mutation no longer survives. |
| Permit nonempty speculative arrays | Both real wasm/native speculativePage fence tests, 0 passed / 2 failed. |

The script restores the built module in finally; the full suite rebuilds it.

Development failures (all ours; corrected before qualification):

- First new real-device run: four failures. speculativePage used view aliases
  `.post`/`.actor` on the owned table; corrected to `.postId`/`.authorId`.
  The first home example used noncanonical inline `if` syntax; corrected it,
  then used the review's compiling `where exists` alternative.
- Home positive-control assertions initially failed on both hosts because the
  two-read filtered field has no component plan here. The same two failures
  recurred in focused diagnosis. Kept that home form and asserted its actual
  compiler boundary; added independent homePage so retained component coverage
  is asserted on both hosts rather than assumed.
- One editing command used a root-relative path while already in snapback4;
  it raised FileNotFoundError before any edit. Corrected the working path.
- The earlier eight-case focused run was 6 passed / 2 home-fixture failures;
  both home cases and both new permit cases passed after correction. The final
  six-file affected run above passed every case, including all these scenarios.

The baseline log ends `== 1 failure(s) in 276 s` (cargo test). No baseline
failure is used as a waiver. The one full-suite run this round passed:

**`== 0 failure(s) in 1578 s`**, exit 0.

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

Rust passed in **179 s**. The client suite passed **1,669 tests, 0 failures,
10 existing skips** in **1,152 s** (the 34 acquisition/server cases are included
in this serial total). All **78 model tests passed** in **233 s**, including
both unchanged 5,000-sequence I1–I13 session sweeps. Builds, guide/release guards,
package/app typechecks and all nine fixture-wrapper tests passed. The full
summary has **no failures: ours, baseline, or environmental**. The serial-client
setting is the suite's existing mode; no counts or timeouts were changed.
Evidence: `test-final.log.gz`.

The implementation remains commit `2919dd93d`; subsequent changes are report,
reproducible mutation evidence and the journal only. The final broader-exception
mutation was run after the full suite and restored the built module. No product
changes occurred after full qualification.

Final reference audit: `ref-check: ok — 509 LLP docs, 9296 refs in 26159 files, 0 errors, 0 unchecked`.
