# Lane U round 5: incomplete execution, remembered answers, and publication semantics

2026-09-25. Implements the supervisor's round-5 refinements to the numbered
publication procedure. Read both reviews in full:
`~/sb4-intent/reviews/u-r4.astra.md` (READY WITH CHANGES) and
`~/sb4-intent/reviews/u-r4.grok.md` (NOT READY). Rechecked the latter before
qualification. The governing offline-memory and composition sections of
LLP 3000.007 §6.5 and LLP 3000.001 were reread. This report supersedes round
4's claims about placeholder publication and removal of remembered answers.
The earlier reports remain unchanged as historical records.

Implementation commits: `5c84b38d8`, `8ad1778b6`, `e3da4f618`. No push or package publication.

## Procedure, with evidence for each rule

| Rule | Final behavior | Tests |
|---|---|---|
| 1. Session/incarnation | Check the session, incarnation and local-commit authority after each routing await and at publication, including memory recovery. Existing caller-side checks remain. | Ten real-client `query-publication-session` sign-out/close interleavings, including delivery and final-publication outbox waits; four direct router session cases; four new remembered-answer sign-out/close cases across recovery and publication. |
| 2. Known complete local wins | A complete known local answer wins regardless of `runs`. Narrow possible tables only when `unknown === false && complete === true`; otherwise retain static plus executed tables. Native/unexecuted programs remain opaque. | Known complete Quarry/native × held/ordinary controls; real known conditional-feed branches and untaken held false/null branches; two direct scalar/heap cut outcomes; real wasm/native `count(events)` over 8,193 fully synced rows followed by a shaped feed. The actual device reports loading, unknown false, complete false and only events executed; a pending own post still prevents any server query. |
| 3. Engine withholding | Engine-unavailable or unexecutable queries stay exactly loading offline, fenced or held. Other cases send original arguments, including cursor. Transport failure stays loading. Memory does not replace an engine-withheld page. | Existing five engine-withheld routing branches, native reset/install failure, preflight refusals, real card/repost/inbox floors, original-cursor/native pagination, and examined-prefix controls all remain. Two-tier unknown-branch tests now require loading for placeholder values while fenced. |
| 4. Available local values | Row-bearing unknown values remain partial data. Null, empty and scalar placeholders use server memory when permitted, otherwise E_OFFLINE for direct reads or loading for watches; a prediction or held status prevents external recovery. Local freshness is computed at publication, using the current link/identity/sync state and last sync timestamp. | Seven placeholder shapes exercise memory, cold refusal and fencing. Real audits/auditById and absent-principal presence recover server values offline, with fresh false and since; cold reopen has no lifetime memory. Real wasm/native withProfile keeps predicted feed rows beside an unknown profile and checks freshness after failed fallback. Direct offline/failed-fallback freshness controls and page-ready cache invalidation checks. |
| 5. External publication | Server, memory, composed, refusal, loading and E_OFFLINE candidates pass the final session/prediction gate. Only accepted whole server data enters memory. Refusal/loading retire old memory. Composed operations never recover/cache a whole server answer. Authoritative refusal/loading survive composition unless fenced; transport failure keeps the local fallback. | Existing late-prediction delivery/publication tests; two new memory-admission races; six composed E_BOUND/application-refusal/loading × fenced/unfenced cases; two cache-retirement cases. Real wasm/native composed queries with 26 × 50,000-byte payloads preserve the original server E_BOUND rather than publishing the local one-row partial value. LocalReads verifies commit invalidation clears memory and in-flight watch answers. |

## Publishing-path audit

| Path | Gate and result | Witness |
|---|---|---|
| Server data | Dispatch, delivery and final external checks; original input preserved. A late prediction keeps safe local data or loading. | `rule 5: prediction arriving at delivery/publication`; real bounded/native cursor cases. |
| Remembered data | Recovery and final external checks both recompute P ∩ S, including offline. Session/authority invalidation retires it. Always fresh false with answer timestamp. | `remembered answer rechecks prediction/sign-out/close during recovery/publication`; residency audit/presence cases. |
| Local unknown | Row-bearing data stays partial. A placeholder cannot publish as null, an empty page or presence. An external replacement still needs the gate. | `available unknown Following`; real `withProfile`; seven placeholder cases; unknown conditional branches. |
| E_OFFLINE | Only a placeholder without memory, for a direct query; shares the final external gate. Held/fenced cases return loading. | Placeholder cases, cold auditById/presence, headless-generation remoteCounter disjoint-read cases. |
| Server refusal/loading | Authoritative original-query answers survive composition and pass the final external gate. | Six composed result cases; actual oversized composed query on wasm/native; old memory retirement. |
| Local known | Complete results win locally; known meter prefixes keep their continuation. Freshness is assigned just before return. | Complete branch controls, examined meter prefix cases, offline freshness controls. |

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Refine the numbered procedure, retain static reads after incomplete execution, distinguish row-bearing values from placeholders, route remembered answers through the gate, compute local freshness at publication and preserve authoritative composed refusal/loading. Tag candidate origins so memory is only admitted after the final gate. |
| `packages/snapback4/src/local-reads.ts` | Restore client-lifetime server-answer memory under LocalReads; clear it with every local-commit/incarnation invalidation. |
| `packages/snapback4/src/local.ts` | Supply the existing offline refusal and LocalReads memory to the evaluator. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | State the refined five-rule behavior in three reference lines, including stale memory, placeholders, final fences and authoritative refusal/loading. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Add cut/static-set, placeholder memory, memory/session races, freshness, composed refusal/loading and cache retirement regressions. Existing partial-row fixtures now use row records rather than strings. |
| `packages/snapback4/test/local-reads.test.mjs` | Verify a local commit also removes remembered server answers. |
| `packages/snapback4/test/bounded-following.test.mjs` | Add the actual 8,193-row count-cut witness on both tiers and freshness assertions around failed withProfile fallback. Unknown conditional placeholders stay loading; an offline online-only scan recovers its prior server page. |
| `packages/snapback4/test/retained-history.test.mjs` | Add actual oversized authoritative composition on wasm and native process devices, checking local retained coverage and exact server E_BOUND preservation. |
| `packages/snapback4/test/residency.test.mjs` | Restore audit/auditById stale-memory and cold-offline expectations. Presence queries an absent principal, so authoritative false differs from the device's speculative true. |
| `packages/snapback4/test/page-ready.test.mjs` | Unknown empty acquisition results no longer masquerade as data; scalar placeholders recover memory with stale freshness; later unavailable results/commits retire it. |
| `packages/snapback4/test/client-seams.test.mjs` | Held empty horizon searches now remain loading; observe actual device execution and retain raw empty/unknown/incomplete assertions and zero server calls. |
| `packages/snapback4/test/readauth.test.mjs` | Retained-authority unknown placeholders load on the client. Preserve every raw device authorization result, including point/page/merge/count/probe, after reopen and replay; positive ruleProbe remains data. |
| `packages/snapback4/test/client-lifecycle.test.mjs` | Unknown unwrap misses recover E_OFFLINE instead of inventing NOT_FOUND; use row records in the partial-row routing matrix. All durability and lifecycle assertions remain. |
| `packages/snapback4/test/sync-generation.test.mjs` | Four headless-generation cases expect E_OFFLINE for a disjoint unknown remoteCounter placeholder with no memory. Pending state and generation evidence remain unchanged. |
| `reports/20260925-bounded-following-r5/mutations.py` | Reproducible scoped mutations of built JavaScript, restored in finally. |
| `reports/20260925-bounded-following-r5/*.log.gz` | Focused, mutation, development-failure and complete-suite evidence. |
| `reports/20260925-bounded-following-r5/REPORT.md` | This report. |
| `JOURNAL.md` | One dated append-only entry after qualification. |

## Forms and engineering decisions

No new authoring form, diagnostic or wire field. Existing forms compile and run:

```quarry
query countedFeed(c: cursor ?):
  n = count(events)
  return feed last 20 by .at after c { *, post: posts[.post] }
```

With 8,193 fully synced events and an unobserved predicted own post, the scalar
cut withholds the query without sending a page that omits the post. The source
and seeded test are in bounded-following.test.mjs; neither ceiling is changed.

```quarry
query auditById(id: audit):
  return audit[id]
query audits(c: cursor ?):
  return audit after c last 10 by byTime
query presence(p: principal):
  return exists connected[p]
```

Over an online-only audit table, server results are remembered for this client
lifetime and recovered stale offline. A cold client has no answer memory;
a direct query refuses E_OFFLINE and a watch loads. An absent principal's
remembered false is not replaced by the device's speculative presence value.

No deviation from the round-5 requests. Decisions where implementation was
unspecified:

- Partial row-bearing values are recognized structurally: nonempty record
  pages, row records carrying id, or such values nested in returned records.
  Scalar-only projections and empty/null values are conservatively placeholders.
  This check never establishes coverage: unknown results remain incomplete.
  No general per-value provenance, engine meter charge or wire change is added.
- Memory is client-lifetime only, keyed by operation and original arguments.
  Direct and watched placeholder reads may recover it. A cold watch loads;
  a cold direct query returns E_OFFLINE. Existing invalidation clears memory,
  and only a result accepted through the final gate can populate it.
- Engine withholding remains separate from placeholder recovery: even a prior
  server page does not make an unavailable Following page publishable offline.
- A composed refusal/loading is preserved before re-observation, then passes
  the same final external gate. Composition is only meaningful for data.
- Freshness is assigned once at final local publication; the review's former
  construction-site mutation therefore targets this new authoritative site.

No Rust, wasm, storage, authorization rules, package version or acquisition
policy changes. No timeout or ceiling increases, disabled tests, push or
publication. Source files remain under 1,500 lines (local.ts: 1,404;
local-query.ts: 226).

## Qualification

Final full suite: **`== 0 failure(s) in 631 s`**, exit 0. Command:
`taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh`.
Rust passed in 223 seconds; main client tests passed **1,581**, failed **0**,
with **10 existing skips**; all **34** acquisition/server shard tests and all
**78** model tests passed. Both 5,000-sequence session models preserve all
thirteen invariants. Builds, docs/release guard, package/app checks and fixture
wrappers passed. Evidence: `test-final.log.gz`. No final failures, baseline or
environmental waivers, changed timeouts, reduced case counts or raised ceilings.
CPU affinity limits concurrency on the shared host; it changes no test.

Wasm is unchanged: **1,776,325 bytes raw / 495,299 gzip**, below the unchanged
496,000-byte budget. The final reference audit passed: `ref-check: ok — 509 LLP docs, 9294 refs in 26153 files, 0 errors, 0 unchecked`.

The first full run completed with **`== 1 failure(s) in 615 s`**:
client tests. Main client results were 1,577 passed, four failed, ten existing
skips. All 34 shard tests, all 78 models, Rust, builds, docs and app checks
passed. All four failures were ours and are listed below; their corrected
focused rerun passed four of four. The final full run follows that correction.

Focused checks: 75 routing/session/composition/local-cache tests passed; six
new real-device cut/profile/composition cases passed. The first compatibility
run passed 218, failed 11, skipped one; all failures are classified below.
The next run passed 158, failed one, skipped one; the final page-ready rerun
passed all three cases. No failures were waived.

Four intentional mutation probes were rejected:

| Mutation | Result |
|---|---|
| Narrow whenever unknown is false, ignoring completeness | One of two cut tests fails. |
| Also narrow whenever loading is true | Both cut tests fail. |
| Force local freshness true at its final assignment | Both offline/transport-failure freshness tests fail. |
| Discard composed authoritative refusal/loading | All three unfenced cases fail; fenced controls pass. |

These are intentional test-strength failures, not qualification failures.
The harness always restores the original built module.

Reproduce from `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/query-publication-session.test.mjs packages/snapback4/test/following-routing.test.mjs packages/snapback4/test/local-reads.test.mjs
node --test --test-name-pattern='scalar cut before|unknown profile|authoritative bound' packages/snapback4/test/bounded-following.test.mjs packages/snapback4/test/retained-history.test.mjs
python3 reports/20260925-bounded-following-r5/mutations.py
taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

## Development failures and disposition

All 11 first compatibility-run failures were ours: old expectations or fixtures
that this round deliberately changes. No baseline/environmental failures were
used to excuse them.

| Tests | Count | Correction |
|---|---:|---|
| wasm/native background timestamps and horizon unwraps | 2 | An unknown missing fact must not publish NOT_FOUND. Assert E_OFFLINE after commits retired the remembered result. |
| W13b offline missing fact, held, retained, pending predictable write | 4 | The fixture claimed to return held rows but used a scalar string array. Return actual row records and keep the same fallback/coverage assertions. |
| page-ready account restoration/new chat | 1 | With sync deliberately offline, the unacquired empty history is unknown and has no memory. Assert E_OFFLINE. An intermediate loading expectation also failed in the second focused run; corrected to the direct-query refusal. |
| wasm/process × stream/staged headless generation | 4 | The pending write touches counters, while the query reads remoteCounters. This is deliberately disjoint: preserve all durable evidence and assert E_OFFLINE, not a null placeholder or a fence. |

Full-suite failures, all ours, with no timeout increase or waiver:

| Tests | Count | Correction |
|---|---:|---|
| W8a native/web held horizon watch | 2 | The absent search is unknown and empty. Wait for the real device evaluation, assert its unchanged empty/unknown/incomplete result, require loading from direct and watched clients, and retain zero HTTP fallback. The former waits timed out because they expected placeholder data. |
| wasm-memory/native-sqlite retained read authorization | 2 | Keep the original device empty/null/zero/false and incomplete-coverage oracle, with an explicit unknown check for each read. Assert client loading instead of publishing those placeholders. Reopen/replay and all positive-authority checks remain. The former waits timed out on placeholder expectations. |

The baseline tail was read before qualification: its recorded summary is
`== 1 failure(s) in 276 s` (cargo test). No baseline waiver is taken here.

## Prior inventory and remaining scale limit

No new routing problem is known. This round does not remeasure acquisition.
The prior round-1 inventory, with owned events fully synced, remains:

| Table | Before rows | After rows | Before row bytes | After row bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| owned events | 49,228 | 49,228 | 7,796,444 | 7,796,444 |
| tombstones | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| inbox | 24,555 | 1,000 | 7,938,537 | 327,458 |
| profiles | 1,008 | 1,008 | 357,825 | 357,825 |
| work | 63 | 63 | 22,132 | 22,132 |
| Whole partition, including other tables | 171,330 | 98,543 | 35,901,571 | 15,092,169 |

Prior cold Chromium acquisition: **281,263.9 → 117,812.5 ms (2.387×)**.
Fully synced owned events dominate afterward. The 5× target and packed-format
measurement remain unclaimed; no statement about main's current packed-format
status is made by this routing-only round. Reproduction and measurement context:
`node reports/20260925-bounded-following-r1/measure.mjs` after its production
build; see the [round-1 report](../20260925-bounded-following-r1/REPORT.md).
