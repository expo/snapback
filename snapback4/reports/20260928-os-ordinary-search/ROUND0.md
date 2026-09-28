# Lane OS — independent current-scope ordinary search

**Status: coherent subset; LLP 3000.028 §3.3 and §7.2 are NOT complete.**
The RFC explicitly permits the inferred current-scope plan to land independently.
No mixed-host plan is shipped. Online fallback still replaces the whole all-chat
answer, so a mixed retained/current screen must keep its existing selection.
Nothing is pushed or published.

Started at `a745b110f2187004abb1cec8380b33b6d1396108` on
`sb4-intent/os-ordinary-search`, after the requested
`git fetch origin && git merge origin/main` reported `Already up to date.`
The evidence store and WAL were copied as bytes into this worktree's ignored
`experiments/p19-one-query/.work/`; the original was never opened by SQLite or
Snapback. Input hash guards pass before and after. Other lanes were not modified.

## Delivered behavior

**Deliberate behavior change:** a bare membership-audience word search goes from
an empty incomplete server answer to the compact membership page for the admitted
class, within the existing ceilings. This is a result change, not merely a new
spelling. The source read rule still runs.

The compiler requests the ordinary scoped words index without adding a membership
predicate to the stored device program. A shared schema/IR proof recognizes one
bare returned word page, an exact membership read rule, the matching sync audience,
a required total unique membership key, a non-expiring and provably readable
membership source, and the compact plan's existing uniformity requirements.
A uniformly denied discovery source is deliberately excluded: rule existence can
grant message access without granting reads of its membership witness.
Server execution substitutes the
existing compact evaluator. The bare device program still searches its authorized
current and retained holdings. Explicit membership predicates, held operations,
guarded operations, joins, native functions and unsupported audiences keep their
evaluators. No guard is removed.

The inferred server page uses the ordinary word cursor's original index descriptor
and identical ordering suffix. Cursor construction reserves that actual descriptor
before allocating. This permits ordinary local observation and fallback on a server
continuation without turning the server cursor into a two-source continuation.
The existing server meter, physical authorization bound, E_SEARCH_OPEN refusal,
drain-cut continuation and final result-copy reservation remain in force.
`check --cost` uses the effective server plan, names the inferred audience and gives
the grouped repair. Empty needles keep the previous browse evaluator; its remaining
N_NEVER_COMPLETE note now says when it applies.

The guide includes the unguarded ordinary per-chat body. It explicitly separates
that body from existing guarded `searchIn`/`inChat`, and explains the current all-chat
composition limitation. It continues to require an incomplete state instead of
“No matches” for incomplete empty answers.

## Acceptance evidence and limits

The reproducible harness is
[`ordinary-search.mjs`](../../experiments/p19-one-query/ordinary-search.mjs).
It uses public `createClient` and `createLocalClient`, a process device and the wasm
web device with memory persistence. It is not a browser/React/Expo lifecycle witness.
It preserves the complete builder program and adds only the ordinary search bodies
and experiment personas. Original mutations create chats, send 503 messages,
remove members and rejoin them; no alternate query evaluator or direct store edit
constructs the results. Background change polls are held and explicit sync applies
transitions. Logged query requests count `/q/` invocations, separately from sync.

| Requirement | Evidence / disposition |
| --- | --- |
| u0500, coffee online | Both tiers' first three 20-hit ordinary pages match `searchNewest` exactly; one original-operation server invocation per page. `builder-search.jsonl` records the original 100-membership corpus; `u0500/builder-search.jsonl` adds the floor fixtures to that identity. |
| Offline bare scan | Both tiers match the held scan, with 20 hits, incomplete coverage and zero query requests. A server continuation is also accepted offline and stays incomplete. |
| Ordering, deduplication, filters | Native regression traverses complete synthetic streams against the explicit oracle for common, absent, rare and multi-term prefixes, timestamp ties and tombstones. Existing membership-search expiry/refill tests pass unchanged. |
| Acquisition floor and per-chat pagination | For u0500, 27 coffee hits straddle the full `(conversation, ordinal, id)` acquisition floor of a 503-message chat with a 500-row acquisition. The oracle independently enumerates original ordinary history and sorts `(at, id)`. Online current membership returns all 27; offline and departed membership return the 24 acquired hits over two pages. Unique tokens immediately below, exactly at and above the floor are also checked. |
| Departure, both link states | Both tiers keep acquired exact/above-floor hits with zero fallback, never recover the unacquired below-floor hit, and never return the post-leave coffee row. Explicit membership search excludes the departed token. |
| Rejoin | Both tiers again find the unacquired below-floor token online after sync. The harness explicitly checks link readiness before calling an observation online. |
| Unchanged-program control | Original builder compiles. Every original program's serialized IR is identical after adding the bare query. Guarded `searchIn` remains NOT_MEMBER on server and both devices, online/offline after departure; held server search remains E_QUERY_HELD. |
| Unsupported audience / disclosure | Expiring memberships, denied membership discovery, no matching sync, authored guards and explicit membership queries do not infer. Adding 1,000 hidden messages leaves the inferred page, continuation, completeness and receipt identical. |
| Opening and drain | Pure server tests sweep examined limits: opening refuses E_SEARCH_OPEN; successful opening followed by a drain cut stays incomplete and resumes through its emitted prefix. 100 and 1,000 memberships complete; 10,000 refuses. This is not the requested mixed-host drain test. |
| Empty needles | Existing browse semantics and the word/browse cursor-variant refusal are tested. This subset does not promise complete global empty-needle browsing. |
| Acquired empty departed chat | Honest incomplete empty result, zero fallback, on both tiers. The builder acquires by ordinal and searches by timestamp; the existing coverage proof does not certify this empty word range. Recorded limitation, not claimed complete. |
| Retained-dominates-first-page | **Not implemented or passed.** No two-source merge or consumed-prefix buffering exists. |
| Mixed server drain / one invocation | **Not implemented or passed.** Pure-server and current-scope request-count tests do not substitute for this requirement. |
| Shared coordinator/device ledger | **Not implemented or passed.** No SDK coordinator or third allowance is added. |
| Remaining lifecycle | Membership changes during response delivery, mixed link changes, mixed state reset, retained edits/expiry races, remount/reopen and mounted React/Expo transitions remain unqualified here. |

Consequently §7.2 remains open. The largest missing piece is the new bridge between
SDK-owned composition/cursor state and the Rust device scan's meter, including
revalidation of retained ownership. Shipping an SDK array union would violate this
contract. There is no dormant or partly activated mixed plan in this commit.

## Costs

The exact builder already has all necessary indexes from its held and explicit
membership queries: the regression asserts unchanged index maps for every existing
table. A standalone bare query adds a normal scoped words index, with the normal
server write and device index costs; it does not add synced rows, projection tables,
new grants, per-query receipts or search sessions. Compiler plan descriptors are
schema/program-derived, and the device IR stays unchanged. Complete §6 resource,
wire/storage, adoption and lifecycle measurements are not claimed by this subset.
Index requests precede the final bound proof: a candidate rejected only by that
proof can still leave an ordinary scoped index and its normal maintenance cost,
while keeping its original evaluator. Avoiding unused candidate indexes outside
the admitted class remains a compiler refinement; the exact builder has no index
delta. No maintenance work is exempted from its existing meter.

`server-meters.json` records the first three u0500/coffee pages on the lane's
builder copy. Every page in both ordinary `osSearch` and explicit `searchNewest`
returns 20 rows with 141 examined rows, 141 index entries, 140 probes, 1,619 steps,
8,251 output bytes, zero writes and no cut. Ordinary heap receipts are 431,179 B
then 602,776 B; explicit receipts are 433,439 B then 611,100 B. Ordinary cursor
strings are 363 ASCII bytes versus 379 B explicit. Single samples range 22–43 ms
ordinary and 20–22 ms explicit; these are not latency benchmarks or a p95 claim.
No device/coordinator meter comparison is claimed. The capture script is
[`ordinary-search-meters.mjs`](../../experiments/p19-one-query/ordinary-search-meters.mjs).

Same host/toolchain wasm builds:

| | Raw | gzip (`gzip -9 -c`) |
| --- | ---: | ---: |
| Before | 2,019,815 B | 585,384 B |
| Final | 2,019,815 B | 585,378 B |
| Delta | 0 B | −6 B |

The budget remains **586,193 B**; final headroom is 815 B. No ceiling was raised.
An intermediate build grew by 28 raw / 124 gzip bytes because cursor pricing
re-looked up a descriptor on the shared device path. Keeping the original index
reference under the device feature set removed that unnecessary work. The final
artifact hash and exact command are in `wasm-size.json`; the small remaining gzip
difference is code generation/layout, not an additional device feature.
No tool was installed. Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127
were already available. Builds use this worktree's target and generated artifacts.

## Verification and every failure

Successful focused checks: 9 new ordinary-search tests; 24 existing compact
membership-search tests; 11 search-merge tests; 8 search certificate tests; whole
guide **92 passed, 0 failed**; original full builder `check`; extended builder
`check --cost`; both public full-store probes; input hash guards and whitespace.
Final affected controls also pass: four read-cut tests, the simulator word-limit
test and both memory/SQLite device word-limit tests. Reference and whitespace
audits pass. Final reference audit: **522 LLP docs, 9,756 refs, 0 errors,
0 unchecked** (`ref-check-final.log.gz`).

Full `scripts/test.sh` exact summary: **`== 1 failure(s) in 1882 s`**.
The failing step is `cargo test`, containing exactly the three assertion failures
listed below. All other suite steps pass. Client tests: main run 3,845 passed,
10 skipped; seven acquisition/server shards total 56 passed; models 79 passed.
There were no environmental qualification failures and no other full-suite reds.
The requested suite ran once, with `CARGO_BUILD_JOBS=8`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_INCREMENTAL=0`,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, `RUST_TEST_THREADS=8`,
`NODE_OPTIONS=--max-old-space-size=4096` and an open-file limit of 65,536.
The full log is `suite.log.gz`; logs and JSONL observations are archived as gzip
files with their original names plus `.gz`.

The one full-suite invocation began before the control-assertion corrections and
the final restriction requiring provably readable membership discovery. Those
changes have final affected-test reruns; the whole guide was rerun as well. The
suite built the intermediate wasm noted above. The final canonical wasm rebuild,
budget check and package rebuild pass separately. This is not a claim that the
single full-suite log qualifies every final source byte.

Failure ledger (all earlier logs retained; final successes do not erase them):

- **Ours, fixture/setup:** the initial new test used `ordinary.q`, which namespaces
  the operation, then looked for unqualified `ordinary`. Fixed its filename to
  `schema.q` before using the expected-red behavior result.
- **Baseline, intended reproduction:** the corrected new test failed its
  completeness assertion on the original bare evaluator.
- **Ours, compilation:** the new catalog field was initially missing from one
  explicit constructor; the concurrent CLI build saw the same error. Two new test
  additions then needed a slice `to_vec()` and an explicit `collect::<Vec<_>>()`.
  These compilation errors were corrected; focused tests pass.
- **Ours, expected assertion update:** the old `search_merge` guidance assertion
  expected the now-inferred word branch's N_NEVER_COMPLETE repair. Its remaining
  note applies to the empty browse branch; the test now checks that condition and
  the inference proof. The initial failure is retained.
- **Ours, full-suite assertions for the deliberate behavior change:** three
  `snapback4-sim::clique` tests failed: `read_cut::nonuniform_full_response_sweep_including_cut`
  encountered E_SEARCH_OPEN at a zero-row envelope;
  `read_cut::calibration_uniform_words_continue_and_hidden_prefix_has_a_walk_bound`
  expected the bare query to stop at the hidden walk bound; and
  `search_global::lazy::w14a_uniform_words_past_32_keep_later_scopes_and_nonuniform_stays_capped`
  expected the nonuniform 32-word cut. Their old-evaluator controls now have an
  explicit authored guard, preserving those assertions. The calibration also
  tests the new unguarded inferred result on the same 99,090-row fixture.
  Focused reruns pass (all four read-cut tests, the simulator word-limit test,
  and both memory/SQLite device versions of the word-limit test).
  The full suite was run once; its historical red result is preserved.
- **Baseline coverage / ours expectation:** the first full-store probe expected
  complete empty departed-chat search. It observed false completeness with retained
  certification and zero fallback on the unchanged device semantics. The harness
  now explicitly records and asserts that existing limitation; the implementation
  does not claim to solve it.
- **Ours, harness readiness:** the first u0500 floor run reached rejoin with an
  incomplete stale local result and zero fallback, despite intending an online
  read. The harness had not verified the link after sync. Link readiness is now
  explicit, prior evidence is retained in `u0500-round1/`, and the second run passes.
  The original transport cause is not established; it is not labeled an engine fix.
- **Ours, operational commands:** one build-log redirect used a duplicated
  `snapback4/` prefix, one version inspection used a wrong relative binary path,
  and an apply-patch request contained an empty hunk. No source was partially
  applied. Early file discovery hit absent guessed paths and the unpopulated
  local skill symlink; subsequent discovery found the real paths.
  The initial temporary meter capture also used an incorrect relative package
  import; its setup failure is retained and the corrected capture succeeds.

## Orientation and reproduction

Read LLP 3000.028 in full, Snapback 4's command sheet and exclusions, LLP 3000's
root decisions, the adopted design brief/rules, journal tail and search guide.
Applied llp-orient read-only from the initialized `lane-a5` copy because this
lane's skill symlink points to an unpopulated submodule. Relevant constraints:
LLP 3000.028 §3.3/§7.2, LLP 3000.024's compact opening/continuation Decision,
LLP 3000.015 §2's accounting/disclosure boundary, and the existing ordinary
retained-query routing. No Snapback 1/2 gates or runtime bootstrap apply.
Updated NOT-DOING before implementation; guide and governing RFC notes land with
code. The journal records one entry for this lane.

From `snapback4/`, after building the package and binary, run the harness against
new lane-owned copies (an existing app copy carries prior test mutations):

```sh
node experiments/p19-one-query/ordinary-search.mjs
OS_FLOOR_U0500=1 node experiments/p19-one-query/ordinary-search.mjs
python3 experiments/p19-one-query/verify-inputs.py
```

The scripts never open the original database. Move only your own previous `.work`
app copies aside before a fresh run. Credentials are parsed from the supplied
fixture only for login and are not recorded. Servers/devices are closed by the
harness; no other lane's processes are stopped.
