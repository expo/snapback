# Lane OS — round 9: linear overlap validation

The blocking round-7 pricing defect is repaired. The overlap subset uses a Set,
rejects an oversized proof before subset work, and charges **R + 2C steps** for
R retained and C current IDs. A full 100-ID overlap now costs 300 subset steps
instead of 1,360,100; 86 costs 258 instead of 1,005,942. Both Sets have prepaid
heap reservations. The shared 1,000,000-step ceiling is unchanged.

Both reviews' cheap test gaps are addressed. No other quadratic page-count
charge was found in the [composition charge audit](./round9/CHARGE-AUDIT.md).
Production changes are confined to local-search.ts. Point authorization,
expiry, one server invocation and combined consumed-prefix pagination retain
the existing contract. The deliberate earlier change remains: admitted bare
membership search returns the compact page instead of the old empty incomplete
answer; explicit predicates and guards retain their meanings.

Fetched origin: main **ae265b730** is already an ancestor, so no merge was done.
Prior report: [round 8](./ROUND8.md), linking rounds 0–7. Read the binding prompts,
reports/journal entries and reviews; [orientation](./round9/ORIENTATION.md) records
the governing context. No scripts/test.sh, push, publication, budget raise,
shared tool installation or changes outside this worktree.

## Regressions and oracle changes

- **Grok last 86 / last 100:** named coordinator tests and four real process/wasm
  cases reinsert every retained ID into a readable current room. Both sizes
  failed with E_BOUND on both hosts before the fix. The all-suppressed retained
  prefix advances, one invocation per page, and the complete traversal equals
  the independently authored current/retained domain.
- **Large generated pages:** twelve additional scenarios per host, three each
  of 86/100 × first/last, with randomized matching status and before/middle/after
  replacement positions. These accompany the original 300 mixed seeds and
  current-only differential schedules; no old schedule is removed.
- **Cut refusals:** the model allows E_BOUND only when its device source is
  suspended and there is no remaining proved current-server prefix. A cut
  fixture name alone can no longer excuse E_BOUND or E_SEARCH_OPEN.
- **Offline word cut:** compare the exact independent keyset prefix over the
  first 32 authorized lexical words in these fixtures, along with cut,
  incompleteness and progress. Returned rows never set the model position.
- **Reuse coverage:** independent seeded draws vary match, placement and expiry.
  Coverage asserts all six match/placement combinations and both live/expired
  replacements. Each host exercises 50 reuses: 26 coffee, 24 tea, 15 expired.
- **Expired replacement:** filter expired current rows before building the
  authoritative ID map; apply query filters afterward. A readable nonmatching
  current row still suppresses retained history. Named seed-64 regressions run
  on both hosts.
- **Per-page seen Set:** retained as defense in depth. A scripted same-page
  pair with an intentionally unmarked overlap proof must emit once. This test
  does not claim such an inconsistent proof is valid server behavior.

Before product/model fixes, the expanded 26-seed probe flags **64, 68, 75, 88,
92 and 100 on each host**. Seed 75's additional large page exposes the product
step charge; the other five expose the expired-current model bug. The full
initial sweep after those repairs has **zero failed seeds on either host**, but
both host tests fail the new coverage assertion because correlated random draws
never select 86/first. Size/direction are now stratified to guarantee all four
cells; the final full rerun qualifies that version.

## Acceptance matrix note

| Requirement | Round-9 evidence |
| --- | --- |
| Large overlap within the unchanged meter | Last 86/100 named cases, 12 generated large scenarios per host, malformed-length-first regression. |
| One invocation, retained dominance, consumed prefix, lifecycle and disclosure | All named affected cases plus the independent 300-seed-per-host oracle. |
| Current-only differential | 22 schedules / 194 identical pages per host; body, completeness and continuation presence all match. |
| Cut honesty | Proved current prefix required; exact offline discovered prefix; both removal controls fail on both hosts. |
| ID authority | All six reuse match/position cells, expired/live coverage, named expired replacement, same-page defense test. |
| Shared ledger | Linear subset reservation and existing exhaustion/comparison tests, with independent charge-removal controls. |
| Delivery independence | **313/313** RG matrix checks; no await, classification, recipe, allowlist or assertion changes. |
| Whole guide | **98/98**, no skips. |
| Wasm | Unchanged; the inherited cap remains the sole final qualification failure. |

## Verification

Final oracle: **300/300 process + 300/300 wasm**, with all coverage assertions
passing. Each host also passes **12 large-page scenarios**, **22 current-only
differential schedules / 194 identical pages**, and its three named large/expiry
regressions. Process 189.736 s; wasm 140.824 s. The oracle file reports **8 tests
passed, 0 failed/skipped**. Seven modeled cut/no-current-prefix cases per host
end in the specifically justified E_BOUND; six offline word-cut cases per host
match the exact partial prefix. [Seed/coverage record](./round9/oracle-final.json).

Other final checks: **165 affected JavaScript tests** (process, wasm, mounted
React and Pages), **54 simulator search + 12 device merge tests**, all **98 guide
tests**, **313 delivery matrix checks**, client build and typecheck pass. Reference
audit: 522 LLP docs, 9,835 refs, zero errors/unchecked. No affected case is skipped.
The full copied builder store/floor matrix and native Expo are not rerun; the
previous reports distinguish their historical evidence and remaining limits.

Six isolated negative controls fail for their intended assertions: remove the
seen guard; refuse every unresumable device cut; remove time-comparison charges;
remove tie charges; remove the subset charge; truncate an offline word-cut
prefix. The cut-refusal control fails seed 12 on both hosts. Offline truncation
fails seeds **24, 60, 120, 204, 216 and 252 on both hosts**. Live src/dist were never
mutated by the controls. [Control script](./round9/controls.py) and JSON/logs
preserve the exact mutations.

Every executed check has its command and exit under `round9/*.command.json`;
logs are compressed after completion without changing their content. Default
`node --test packages/snapback4/test/ordinary-search-oracle.test.mjs` runs 300
seeds per host, the differential and large scenarios, and named host regressions.
`SB4_SEARCH_SEEDS=64,75` selects reproductions. Controls run from snapback4/ with
`python3 reports/20260928-os-ordinary-search/round9/controls.py`.

## Wasm

Canonical build: **2,039,451 B raw / 592,719 B GNU file-input gzip-9**; delta from
round 8 **0 / 0**. SHA-256
`7189290aff31e3e7cdf33141cf30d09235abb14d58ca65bceb8333784ca8444d`.
The **586,193 B** cap is exceeded by **6,526 B**, so build-wasm.sh exits 1.
This is **ours, inherited**; the supervisor owns the landing budget decision.
No Rust/wasm input changed. Earlier composition state/digests, ledger,
retained filtering and reset-counter attribution remains; no new byte group.
Toolchain remains Node 24.13.1, Bun 1.3.14, Rust 1.97.0, wasm-bindgen 0.2.127,
without wasm-opt. [Measurement](./round9/wasm-size.json).

## Every failure

- **Ours, reproduced product:** ledger-before has three failures: 86/100 valid
  overlaps exhaust steps, and oversized proof validation returns E_BOUND rather
  than E_INPUT. large-before fails all four 86/100 × process/wasm host cases.
- **Ours, pre-fix generated product/model:** the twelve seed/host failures listed
  above, retained in categories-before.log.gz. The expired-shadowing mismatch
  belongs to the model; the real engines already return the retained image.
- **Ours, fixture pricing:** ledger-after initially fails its two tight comparison
  boundaries because Set creation now costs one step even with zero current IDs.
  Updated those fixed budgets by exactly one; the independent time/tie/subset
  charge-removal controls all fail, and final affected tests pass.
- **Ours, generator coverage:** oracle-first fails both host coverage assertions
  for absent 86/first, despite all 600 seeds passing. Stratified size/direction
  fixes the missing cell; the complete final run is recorded separately.
- **Ours, expected negative controls:** six deliberately broken copies fail their
  intended assertions. These are not product qualification failures or passes.
- **Ours, inherited budget:** canonical wasm build exits 1 at the unchanged cap,
  6,526 B over. No other final qualification check fails.
- **Ours, operational:** the local skill symlink is unpopulated; used a read-only
  sibling copy. Two guessed helper/HTTP source paths were absent. An initial
  test edit doubled the snapback4 path and changed nothing; the corrected edit
  supplied the regressions. One test-run command accidentally named a nonexistent
  file (affected-js.log.gz) and ran no tests; affected-search is the corrected
  passing command. No operational error is counted as a passing check.
- **Baseline failures: none observed. Environmental failures: none observed.**

The journal receives one append and LLP 3000.028 one scoped implementation note.
Commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
