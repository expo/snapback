# QRY — wave-18 read semantics, target 0.4.35

Complete on `sb4-b18-qry`, local commits only. No push or version bump.
Package version remains 0.4.34; user-visible changes are in its **0.4.35 guide
changes** entry. The inherited Integration 18 report is preserved under
`snapback4/reports/20261019-qry/INHERITED-INTEGRATION18-REPORT.md`.

## Per-item changes

### 1. Returning branches and silent empty results

The original 009/032/048 bodies already had fallback returns. Reconstructing
009 with its full frozen schema reproduced the real defect: the engine summed
two mutually exclusive 5,005-read reservations to 10,010, exceeding its fixed
8,192 allowance before opening either cask page. The query returned empty and
partial after reading only staffRoles. It now reserves max(5,005, 5,005), before
any private probe, and returns the seeded cask for staff and owner.

`6f2e003bd7` introduces path-sensitive reservation accounting. Sequential and
condition work add, alternative returning paths take their maximum, loops and
expression blocks conservatively sum static occurrences, and once-per-occurrence
credit consumption remains. No physical/logical ceiling, authority, protocol,
or store migration changes. `2e9a10bc3b` adds advisory N_QUERY_FALLTHROUGH with a
concrete uncovered branch/zero-iteration/entry path and explicit []/null repair;
compatibility fallthrough remains null. N_QUERY_RESERVATION names oversized
static paths. The user-authorized warning option avoids breaking old schemas.

Detecting query-path tests cover max versus sum, sequential paths, condition
work, loops, one-use credit, indexed time order, role alternatives, hidden
populations and real meter cuts. Packed-client tests execute the same read
semantics and verify the ordinary console fallthrough warning.

### 2. Hidden lookups and refusal precedence

Optional points already return null for hidden, absent or expired rows. The
observed refusal comes from an authored `! else CODE` assertion (or a later
require/default), which retains CODE and statement precedence. Keeping that
ladder avoids revealing stored hidden existence. No runtime hiding clause is
exposed and no new lookup operator or read bypass is introduced.

`2e9a10bc3b` corrects guide rules/reads/programs/refusals and adds
N_LOOKUP_FILTERED for optional private side-table reads in mutations without
proved read authority. `f1546d5080` covers read-through rules and nested helpers,
transfers bounded diagnostic-only viewer/exact-point facts, invalidates them on
writes/rebinding, and seals caller/target namespaces so constants or outer focal
fields cannot silence advice. These facts never authorize, narrow types or
change prediction. Written tables, assertions, public and proved reads stay
quiet; existing N_LOOKUP_HIDDEN and specialized ephemeral/maintained advice stay.

Optional-lookup tests cover all these distinctions, missing/hidden/readable
expiry, helper guards, write/rebind invalidation, false constants and focal/key
capture. Guide excerpts and recovery definitions are pinned; retained guide
Quarry blocks compile and the rules ladder executes through packed packages.

### 3. Other read/query friction clusters

Read the complete wave-18 bakeoff and relevant friction/transcripts; skimmed
wave-17 day-two. The 032 issuedAt/id symptom shares the alternative-reservation
failure, rather than requiring another index. 015/019/027/037/045 assertion
precedence, 025's caller-hidden funding default, 029's caller-filtered program
exists and 032's hidden upsert collision are explained in
`snapback4/reports/20261019-qry/FROZEN-REPRO.md`. Only original 009 was executed
with its complete recovered schema; 032/048 reservation figures are explicitly
source-level analysis. Equivalent runtime detecting witnesses are committed.

SEC4 owns invariant/escalation/security-note tooling. DX4 owns staging,
provisioning, uploads, clocks/sessions and setup/proof ergonomics. Their code and
worktrees were not changed. Frozen wave apps were read-only throughout.

## Design and commits

LLP 3000.036.002 **§15** amends §10 and documents all semantic choices;
§10 explicitly points to the refinement. Status is Implemented. Four rounds
used fresh independent Muse and Codex sessions per the common rules. Both
round-4 reviews mark the same semantic amendment revision READY. Eight verbatim
reviews and provenance are under `llp/reviews/3000.036.002-qry-r*`. Muse's wrapper
used its authorized fallback after plan quota errors; no key was read or printed.

- `6f2e003bd7` — fix mutually exclusive bounded query reservations.
- `2e9a10bc3b` — return-path/lookup advice, guide ladder and detecting tests.
- `f1546d5080` — helper/through proof precision, invalidation and namespace sealing.
- `2a3876cfda` — READY reviews and initial corpus/differential evidence.
- Final evidence commit — this report, final corpus/census/Linux receipts and
  documentation reconciliation; no product semantic changes after qualification.

The same budget-increase commit records its reason in JOURNAL.md and the budget
metadata. Locked Linux wasm is **2,387,388 raw / 727,580 gzip**, +1,546/+567 versus
Integration 18; artifact allowance **728,080** is measurement + exactly 500 B.
Strict serde-family and server/Unicode absence audits pass. This is whole-artifact
measurement, with no independent per-feature size or Mac-size claim.

## Verification results

All shell launches were bounded. Every Cargo invocation used
CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0 and CARGO_PROFILE_TEST_DEBUG=0.
No full scripts/test.sh invocation was made.

| Crate | Default unit/integration targets completed | Tests passed | Existing ignored |
| --- | ---: | ---: | ---: |
| snapback4 | 54/54 | 860 | 10 |
| snapback4-core | 43/43 | 381 | 2 |
| snapback4-lang | 171/171 | 2,304 | 14 |
| snapback4-device | 102/102 | 1,570 | 4 |
| snapback4-difftest | 11/11 | 96 | 0 |
| snapback4-native | 1/1 | 0 | 0 |
| snapback4-sim | 44/44 | 749 | 7 |
| **Total** | **426/426** | **5,960** | **37** |

Six crate doctest targets also pass, including **17 core doctests**. The
one-hour workspace command timed out in a language target already covered by
the separate full language run; that 15-minute language command also needed
three remaining-target batches (19/18/18). All default targets are accounted
for by the retained Cargo inventory and completed result summaries; incomplete
segments do not count. The final simulator/difftest and native runs completed.
Final diagnostic refinements are covered by the full 170-target language
integration inventory; final max implementation also has the focused witnesses.
These timeouts are not represented as successful single-command runs.

The initial broad attempt caught a missing registered recovery excerpt, fixed
before final checks, plus a shutdown-console timing failure; the complete CLI
rerun passed. No failed test remains in the final census. The retained audit is
replayable with `timeout 15 python3 snapback4/reports/20261019-qry/test-census.py`.

- Linux focused: **139 pass** (guide 126, optional lookup 7, query paths 6).
- Mac Studio, only `/Users/ccheever/sb4-ws-qry`: same **139 pass**. An initial
  source-only copy lacked an LLP/generated-client prerequisite; copied those
  prerequisites and reran. No black M5 publication host used.
- Affected packed rule/client file: **23 pass**, normal console warning included.
- Difftest run: **20,000 cases / 1,220,035 comparisons / zero findings**.
- Devices seeds 0–999: **1,000 cases / 27,922 comparisons / zero findings**.
- Lean: **20,000 cases / 56,917 comparisons**, unchanged 130 findings in four
  known signatures: code E_RULE~NOT_FOUND (3), continuation-next (35), next (67),
  prelude-code E_RULE~NOT_FOUND (25). **No new signature**.
- 200-schema before/final survey: waves 15/16/18 = 100/50/50; **200/200 compile
  before and after**, all source hashes unchanged. Only **11 N_LOOKUP_FILTERED
  additions in five apps**; no removed notes, changed security notes/errors,
  new fallthrough notes or new reservation notes. Every added site is explained
  in SURVEY.md. Finished apps already contain the old branch workarounds.
- Fresh-pack `qualify-linux --consumer-only`: **PASS** at exact source
  `2a3876cfdaf32bbcf3b01575592b7855ff03587a`. Ubuntu 24.04 and Alpine round trips,
  web/Expo/adapted/template starters, release transitions, day2/day4/day5,
  production, proof kit, client/rule recipes, frontend, security, migrations and
  staging proofs pass. Exact client/Expo/Linux tarballs and consumer.json remain
  in `/home/ccheever/sb4-qry-packed`; hashes and receipts are committed.
- Root frozen Bun 1.4.2 install, hoist and generated-artifact preconditions pass.
  Inventories: **365 package tests / 35 script tests / 31 demos / 487 leaves**.
  The final inventory delivery recheck also passes after expanding an initial
  three-minute timeout to a 900-second bound. Root guide: **22 pass**,
  162 pages / 1,937 snippets, no skipped checks or
  missing preconditions; 121 inherited warnings.
- Final `./ref-check --verbose`: **0 errors, 0 unchecked**, 556 LLPs / 12,099 refs.
  README **319/320**, executable first-screen and full guide compression budget
  pass. Strict wasm family/absence checks pass. git diff --check passes.

## Delivery limits and cleanup

No QRY implementation is deferred. Consumer-only Linux qualification was the
necessary scope adjustment because the user forbade full scripts/test.sh; it
records publicationQualified=false and supplies **no publication receipt**.
Default ignored/opt-in tests remain explicit; no Postgres or release/publication
claim is made. Corpus advice is not a claim that every caller is denied or a
complete application-security proof. Root checks retain their inherited warnings.

Owned Linux and Mac target directories, Lean build output, expanded consumer
projects and survey scratch were removed after retaining exact packs and compact
receipts. No sibling/shared build directory or foreign /tmp path was removed.
Shared Linux free space recovered to about 55 GB. Package/wasm built leaves and
installed dependencies remain available. `cleanup.json` records removed paths.
The evidence directory contains compressed logs, final per-target census,
independent reviews, complete survey deltas and original-source analysis.
