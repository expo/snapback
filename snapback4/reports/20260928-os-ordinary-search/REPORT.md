# Lane OS — round 7: bounded current-ID overlap

The three Astra blockers are repaired. Current point readability suppresses a
retained replacement image inside the page's existing server invocation;
source-row metadata gates SDK accumulation; early permanent refusals terminate
instead of refreshing identity. Immutable scope admission is no longer needed.
The local wasm budget remains the sole expected qualification failure. Nothing
is pushed or published, and no budget or shared installation is changed.

Prior evidence remains in [round 0](./ROUND0.md), [round 1](./ROUND1.md),
[round 2](./ROUND2.md), [round 3](./ROUND3.md), [round 4](./ROUND4.md),
[round 5](./ROUND5.md), and the preserved [round 6](./ROUND6.md).
Round-7 commands/results live under `round7/`; compressed logs retain their
original output. No `scripts/test.sh` invocation belongs to this round.

## Integration and review

First fetched and merged origin/main in `d023a8fd6`. Both journal conflicts
preserve both parents' appended records; source merged automatically, including
main's delivery/client fixes. Read the binding prompts, prior reports and OS
journal records, Snapback 4 fence and LLP/guide context. Applied llp-orient
read-only from an existing populated skill copy; `round7/ORIENTATION.md` records
the scoped constraints and location. No skill/tool installation.

Read Astra's full NOT READY review and copied all four reproductions. Their
shared setup is extracted into `helpers/astra-search.mjs`, preserving the
reproductions without three copies of unrelated tests. Grok had only progress
notes initially; its final READY review arrived during this round and was read
in full. Both review texts are preserved in `round7/os-r56.*.md`.

Grok's review used a scripted coordinator harness, not the 600 real-host seeds.
Its cut-model Low is fixed below. Its cursor-wording Low is fixed in the search
card: both sources seek the combined consumed key. Its completeness observation
is the existing page contract, now stated explicitly and tested: `complete`
can coexist with `next`, which determines whether more results remain. Its
untested per-page `seen` defense is not claimed as the ID-lifetime proof; the
point overlap and generated ID-reuse cases establish the new boundary. The
mutable-scope regression now also requires the current body and one request on
each page. Astra's real projection/ID-reuse reproductions take precedence over
Grok's narrower assertions that string IDs and immutable scopes were sufficient.

## Implementation

**One metered, authorized overlap.** The SDK sends only this page's retained
candidate IDs in `searchRetained`. The server recomputes the eligible descriptor,
rejects lists longer than limit plus lookahead, and uses ordinary authorized
`byId` point reads in the same transaction, Context and meter as the search.
A capped point refuses rather than certifying absence. `searchCurrent` returns
only supplied IDs whose current row is readable; hidden, absent and expired
rows are indistinguishable. Point and output work share the server's original
allowance; SDK candidate allocation/serialization, decode, validation, ID lookup
and cursor work share the device scan's allowance.

Current IDs win even when the new image is older, no longer matches, is filtered
by the query, or is outside this keyset page. No new row body, order key, scope
or discovered ID is returned by the check. LLP 3000.028 §3.3 records the disclosure
argument. This also covers mutable-scope updates, so both immutable admission and
N_SEARCH_MUTABLE_SCOPE are removed. Immutable order advice remains. Ordinary
server inference and explicit/guarded/held queries keep their previous meaning.

Suppressed candidates are safe consumed discards. A page may be short, or empty
with an advancing cursor, when its entire bounded retained prefix is suppressed.
It cannot pass an unproved retained head or refill automatically. Both sources
continue after the combined key; an unconsumed fetched server hit remains
eligible. Two real-host tests replace every retained row with a nonmatching
current image and traverse to all remaining current hits after an empty first
page. Other tests cover older replacements, hidden replacements, mutable moves,
Unicode IDs, request count and candidate/proof bounds. A missing overlap protocol
refuses permanently rather than publishing unchecked retained images.

**Accumulate proven identities only.** The TypeScript emitter adds `rowKey: "id"`
only to source-row page handles (`Ty::Page`), not arbitrary projected objects.
`Pages` uses that metadata to retain the first display position and newest
observed image. Projections with `id: .room` preserve both distinct messages.
Existing search/history image refresh, suffix withdrawal, deadline and retention
checks still pass. No new public Read field or accumulated server session.

**Refusals.** Authenticated early input/op/body refusals use a single reader's captured
store/head/generation. The coordinator handles refusals before cursor-identity
refresh: a refusal publishes neither rows nor a continuation. It also handles
loading before that refresh. State, local-scan and second-state refusals already
precede their associated success checks; decoder/coordinator bounds still end
in E_BOUND. Transport failures stay unavailable. Unauthenticated auth/origin refusals retain their metadata-free envelope: exposing
a store head before authentication would be a disclosure. An unavailable store cannot
supply truthful metadata and remains a retryable transport/store refusal; no
identity is invented. Tests cover malformed JSON, bad/extra arguments, wrong or
missing operations, malformed overlap, old-server/missing-proof behavior, and
E_INPUT/E_OP/E_SEARCH_OPEN/E_BOUND with and without retryability at the SDK seam.
The mounted real React/wasm observation and process observation each make one
request for `{q:123}`, settle E_INPUT and stay settled over 200 ms.

The deliberate round-0 change remains: admitted bare membership word search
returns the compact current-scope page instead of the old empty incomplete result.
No runtime allowance or authority is relaxed.

## Oracle: findings before fixes and independence

Before any product fix, generated seeds **1, 2 and 4 failed on both hosts**:
projected non-identity IDs collapsed, invalid input became loading, and a
reinsertion left a stale retained image. Seed 3's changed-needle check passed.
`generated-before.log` preserves all traces. The copied Astra tests separately
reported **6 failures / 2 passes**: the same three blockers, with argument binding
already working. These are inherited lane defects, not baseline-main failures.

The extended generator uses seeded page sizes, first/last direction, tied and
Unicode IDs, and replacement selection. It generates ID reuse, projected `id`
fields, invalid/permanently refused inputs (including observed request counts),
and argument changes with an old cursor. The main inter-page schedule retains
sync/no-sync, membership, writes, body/order/mutable-scope edits, expiry,
store/generation replacement, reset/reopen and link flaps. Mutable scopes now
exercise composition rather than fallback.

Restart and expected withdrawal derive from modeled acquisition, membership,
identity and link events. The test no longer decodes response cursors to select
its expected domain or restart. Lane suspension is derived from the fixture's
known 32-word and examined-row conditions. Offline partial discovery samples
check authorized row images, order, incompleteness and progress, then stop that
safety sample without advancing a model from returned rows. Ordinary uncut pages,
including offline pages that fill before the meter limit, retain exact keyset
comparison. Online suspended-lane pages compare exactly to current server rows.
An overlap-limited short/empty prefix advances the independent model through its
own computed discarded candidate, never through a returned row.

The first extended 300-seed sweep failed **225, 240, 300 on each host** because
my new safety branch incorrectly assumed every offline page in a cut fixture
must be incomplete. Their offline reads actually fill the page before cutting,
or have fewer words after reset. Correcting the fixture-based classification
preserves exact comparison and passes those seeds; no product fix or weaker
assertion was needed. `oracle-first.log`, `oracle-cuts-fixed.log` and the
subsequent complete sweeps preserve that development history.

Final acceptance: **300/300 seeds on process and 300/300 on wasm**, zero failed
seeds. Process 183.141 s; wasm 134.262 s (317.403 s combined). Each host covers
50 generated ID reuses and 74 each of projections, invalid inputs and changed
arguments; the separate cut schedules keep their original fixture. The final summary/coverage is in
`round7/oracle-acceptance.json`, with every passing seed in the matching log.
Each host also runs **22 current-only differential schedules / 194 identical
pages**, comparing full row images, completeness and continuation presence.
Stable-row exactly-once and terminal keyset completeness remain asserted.
The explicit accepted cut/refusal cases are not counted as complete searches.

Removing arguments from the cursor binding in an isolated copied package fails
both Astra's named needle-change test and generated seed 3, on both hosts:
**4/4 mutation checks fail for the intended result mismatch**. The product files
and final artifacts were never mutated. `mutation-arguments.log` retains the
negative control; the normal tests pass.

## Acceptance matrix

| Requirement | Round-7 evidence |
| --- | --- |
| ID reuse and scope updates | Point overlap; copied rebirth and mutable-move regressions pass on process/wasm; current body asserted. |
| Current ID not matching or before/after key | Generated reinsertion plus nonmatching, older and hidden replacement cases; current authority independent of search match. |
| Bounded authorized overlap | Rust cap/hidden/absent/tombstone/ordinary-ID-bound/meter cases; supplied IDs only; at most one page plus lookahead. |
| One invocation, consumed prefix, no refill | Real-host request counters, all-suppressed empty-progress traversal and word-dense drain continuation. |
| Projected non-identity id | Copied two-message projection and generated projection cases preserve list semantics; emitter test proves metadata exclusion. |
| Newest source-row accumulation | Existing search/history Pages refresh, metadata-only revalidation, suffix-drop and deadline cases pass with source-identity metadata. |
| Permanent refusals | One-shot process/wasm, generated observed inputs, real mounted React/wasm and early HTTP identity cases; one request. |
| Oracle independence | Modeled events select restart/withdrawal; fixture conditions select suspension; partial safety never supplies a next model key. |
| Argument binding | Copied test, generated category and four failing mutation controls. |
| Generated/differential | 300 seeds per host; 22 additional server-only differential schedules per host. |
| Existing identity/audience/reset/retention | Prior named store, generation, reset, same-count audience, expiry, unrelated sync and retained-only filter tests pass. |
| Rust and whole guide | 83 affected Rust tests plus 94 whole-guide tests; one existing scale fixture ignored by name. |
| JavaScript | 161 affected cases; additional codec/family and TypeScript checks pass. |
| Builder u0500 / coffee / floor / guarded control | Historical round-1 501-page / 10,014-ID walks, searchChat floor and NOT_MEMBER matrix retained; full copied store not rerun. |
| Wasm | 2,039,451 raw / 592,719 gzip B; delta from round 6: 0 raw / −3 gzip B. Local unchanged cap still fails. |
| Full suite | Not run, as instructed. Supervisor owns landing rerun and budget decision. |

## Meter envelope and wasm

The prior 249-scope × words drain fixture now refuses during opening because
20 overlap points spend the same 8,192 examined allowance. That is an honest
new cost, not an extra allowance. The revised fixture has **248 current scopes**:
the existing live scope, 246 full 32-word scopes and one 25-word scope. It opens,
drain-cuts and preserves unconsumed server hits through a third explicit request.
The original 4,077-scope refusal/differential control also remains passing.
The nearly exhausted device ledger now refuses while reserving candidate request
storage, before HTTP; its expected request count is zero, with no meter reset.
Mixed comparison and ID-hashing exhaustion still have exact boundary controls.

Canonical Rust 1.97.0 / wasm-bindgen 0.2.127, file-input GNU gzip -9, no wasm-opt:

| Artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Round 6 recorded | 2,039,451 | 592,722 |
| Round 7 final | 2,039,451 | 592,719 |
| Delta | 0 | −3 |

SHA-256: `7189290aff31e3e7cdf33141cf30d09235abb14d58ca65bceb8333784ca8444d`.
`round7/wasm-size.json` records toolchain and measurement. Over the unchanged
586,193 B cap by **6,526 B**. The new overlap is server-feature-only; Query
metadata/emission, coordinator and Pages are outside device wasm. No new device
function family is introduced. The whole-artifact comparison includes merged
main and source/layout changes; no additive per-feature gzip claim is made.
Existing descriptor, state/identity, ledger and retained-filter costs remain
rounds 3–6's attribution. Family/codec/server-only absence checks pass.

## All failures and qualification limits

Final affected Rust, JavaScript, guide, typecheck, codec/family and reference
checks pass. The one final failing qualification is **wasm build — ours,
inherited expected cap**, 6,526 B over. **Baseline failures: none.
Environmental failures: none.** No full-suite or publication claim.

All development failures are retained and classified:

- **Ours, reproduced product defects:** six copied Astra failures and generated
  seeds 1/2/4 on both hosts before repairs; argument tests already pass.
- **Ours, model:** 225/240/300 per host in the first 300-seed sweep, as explained
  above. An attempted targeted rerun before correcting a failed edit repeated
  the same three failures (`oracle-cuts.log`). The corrected reruns pass.
- **Ours, fixture expectations:** first affected JS run had two failures: the
  ledger now refused before HTTP (expected 1 request, observed 0), and the old
  dense drain reached E_SEARCH_OPEN after point charges. The smaller replacement
  fixture then exposed a test assumption that every fetched server hit had been
  consumed; it now asserts the precise consumed key and recovery of the remaining
  hits on the third page. Final affected checks pass without a budget change.
- **Ours, final-review regression:** the first metadata patch attached the store
  head to pre-authentication E_AUTH responses too. A new negative test fails
  before repair (`auth-boundary-before.log`); pre-authentication responses now
  retain their original metadata-free envelope. Authenticated input refusals
  still carry captured generation, and all refusals still terminate before
  identity refresh. Final query tests pass.
- **Ours, intentional mutation:** four failures when deleting argument binding;
  isolated under this worktree's ignored target directory.
- **Ours, operational:** several guessed read paths and edit commands with a
  duplicated `snapback4/` prefix failed without changing files; corrected to
  absolute worktree paths. A few log probes preceded file creation. These are
  not counted as product tests or baseline/environment failures.
- **Ours, expected wasm cap:** both canonical builds produce the same artifact
  and exit 1 at the unchanged cap. No other qualification stage fails.

Rust HTTP filtering leaves the existing prepared-M7 scale test ignored because
SNAPBACK4_ADOPTION_HTTP_DB was not supplied. Native Expo and the full-scale
builder copy were not rerun; the real mounted browser uses the wasm device and
shared React hooks. These are explicit limits, not inferred passes.

The reproduction commands and affected JS filenames are in
[round7/COMMANDS.md](./round7/COMMANDS.md). The default
`ordinary-search-oracle.test.mjs` runs 300 seeds per host plus differential.
Use `SB4_SEARCH_SEEDS=1,2,3,4` for the new categories and `=225,240,300` for the
cut-model controls. Environment and exact results are recorded in `round7/`.
