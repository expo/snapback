# DX5 — wave 20, target 0.4.36

All four DX5 items are implemented and committed. No push, publication or version
bump. The repository version remains 0.4.35. Initial worktree status was clean;
inherited commits between sb4-loop and HEAD were retained.

## Governing context and reviews

Used llp-orient. Read the complete wave-20 bakeoff, Snapback 4 fence/rules and
relevant guide pages. Governing documents: LLP 3000 §7, 2000.000,
3000.000.000.001 §§8–10, 3000.000.000.002 §4, 3000.036.002 §15.2,
3000.013.002 §2, and 3000.011.003.000 §§7.2/11.

DX5 amends §10 of LLP 3000.000.000.001 and adds pointers in the other governing
LLPs. SEC5 retains security intent/campaign/exposure ownership; the 0.4.36 guide
changes entry leaves its one-line pointer. No universal security claim is made.

Both Muse Spark 1.3 Contributor and a fresh Codex gpt-6.1-sol session returned
READY in round 5 on the same final product/amendment revision. Earlier rounds
found quiet-upgrade warning delivery, old Metro README custody, a timestamp
consumer, and starter proof custody problems; all were repaired. Verbatim
reviews, stderr and provenance are committed under `llp/reviews/dx5/`.
`r5-sources.json` binds the reviewed files; all 45 product/guide/amendment hashes
still match. Subsequent commits only repair test expectations and save evidence.

## Item 1 — staging clock

`advance()` returns `{now, fired, held}`; `now()` remains numeric. HTTP and CLI
retain the old schedules field and explain fired/held outcomes. Restarting a
reused store reports equal/future persisted-boundary holds, the reason and
recovery path. Maintenance errors carry an explicitly incomplete report and do
not retry automatically. Expiry guidance no longer suggests unsafe dev doors.
Timestamp consumers use `.now`; report duplication has a bounded byte budget.

Main commits: `1446521e03`, `34035768d3`.

Tests: 45 clock tests, packed real staged HTTP/restart/fire/hold/recovery case,
CLI warning and advance, no-clock-movement budget refusal controls, and affected
Mac clock tests all passed. The packed case follows the wave-20 clock035 repro.

## Item 2 — lookup and unique-conflict diagnostics

Asserted and same-table mutation lookups get source advice naming the authored
read rule and a safe rewrite. Existing specific N_LOOKUP_HIDDEN advice takes
precedence. Named unique declarations on private tables explain that hidden
conflicts retain generic E_RULE; readable conflicts retain their declared code.
Runtime help is constant across private and ordinary refusals. There is no new
hidden-row existence, key or identifier disclosure.

Main commit: `addd95471a`.

Tests: exact source sites and safe rewrites, optional lookup and constraints
suites, executable guide authority recipes, and real Alice/Bob packed wire and
receipt comparisons all passed. Hidden/missing lookups and hidden/ordinary
refusals are paired; meter controls normalize argument lengths. Existing runtime
authorization assertions remain. Later commits repair previous note-free/generic
help expectations rather than suppressing unknown diagnostics.

## Item 3 — upgrade path

The new wrapper prints project warnings on the first ordinary check after an
old-CLI upgrade. Captured stderr cannot acknowledge nonempty warnings, so old
quiet upgrades leave advice pending for a visible check. Empty scans can be
acknowledged; scan failures are advisory and JSON stdout stays pure. The bounded
shell/argv scan finds multiline legacy `data --json` uses and reports paths.
The guide changes entry gives the one-line fix: `JSON.parse(stdout).rows`;
callers retain `more`/`limit` when pagination matters.

Main commit: `cdaea32d37`.

Tests: all 17 known wave-19 production-script candidates among 50 lanes were
found, with no extra lanes in that census. Six installed-old-CLI `npx snapback4
upgrade` combinations passed: ordinary, quiet and JSON+quiet from each of 0.4.33
and 0.4.35. 0.4.33 came from public npm with recorded integrity. Public npm still
returned 404 for 0.4.35 at the final check (2026-10-21 08:59 UTC); those three cases
use the retained wave-20 registry package at 127.0.0.1:4873, with integrity
recorded. Candidate metadata is aliased to 0.4.36 inside the isolated acquisition
proxy to force installation, without changing repository/native versions or
publishing anything. A public-npm 0.4.35 acquisition rerun remains externally
blocked by that package's availability.

## Item 4 — frontend and starter weight

ReadState renders loading/denied/empty/data for lists and preserves partial or
stale data. Denied defaults to QueryRefusal; loading/empty default to null.
The exact ListScreen guide snippet executes from the packed package and checks
types. Expo exports packaged Metro configuration/transformer and native-smoke;
starters emit a small Metro loader and pin playwright-core. Metro preserves
consumer configuration and resolves consumer Expo dependencies.

`init --adapt` retains frontend-proof commands/files, recognizes the old README
prose, and removes untouched legacy helpers only when no planned source still
references them. Custom helpers/proofs and unknown symlinks remain. Generic
proof scaffolds render and explicitly return E_FRONTEND_SCENARIO until business
write assertions are authored; public/no-identity scaffolds can prove rendering
without an irrelevant sign-in prerequisite. Smoke priming is explicit and does
not affect normal launch.

Main commits: `b64bc2055c`, `674756badc`.

Tests: ReadState states/type inference, exact packed snippet, native smoke modes,
Metro consumer builds, adapt custody, public and guest proof scaffolds, six
starter templates and Expo toolchains passed on Linux; platform-sensitive
Rust/client cases passed on the assigned Mac Studio.

Measurements use copies of three read-only wave-20 Expo lanes and the frozen
harness frontend bucket (non-whitespace characters; authored long lines remain).
All migrated copies typecheck; original hashes are unchanged. Package support
migration applies to all three; lane 032 also uses ReadState in two lists.

| Lane | Before | After | Saved |
|---|---:|---:|---:|
| 006 athletic trainer injuries | 15,287 | 13,557 | 1,730 |
| 032 zoo keeper diets | 19,544 | 17,720 | 1,824 |
| 033 lead service swaps | 16,444 | 14,826 | 1,618 |

Evidence: `snapback4/reports/dx5/frontend.json` and `measure-frontend.mjs`.

## Verification

Every shell command was bounded by timeout. Cargo invocations used
CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0 and CARGO_PROFILE_TEST_DEBUG=0.
The prohibited monolithic scripts/test.sh was never run.

- Snapback 4 setup passed: frozen Bun install, native build, wasm build and
  client build. Wasm gzip: 733,824 bytes, budget 734,193.
- Full five-crate Cargo run completed, including doctests, with --no-fail-fast
  and a two-hour bound. Its raw result summaries contain 7,097 passes, 21
  failures and 45 ignores (child-probe summaries included; not a deduplicated
  census). Eight targets initially failed on changed advice/help expectations
  and a zero-duration flock observation. Every corrected target rerun passed:
  full CLI bin 504 passed/5 existing ignores; held_unknown, mp_reproduction and
  receipt_gaps 49 passed; wave11_docs, wave12_rule_recipes, wave13_rules and
  wave14_authorization 37 passed. No failing target remains unresolved.
  The earlier 40-minute attempt timed out; the second full run completed.
- Affected client pool: 13 files, 115 tests passed. Production starter tests:
  5 passed. Qualification harness tests: 55 passed. Guide tests: 127 passed;
  optional lookup and constraints: 9 each passed.
- Assigned Mac Studio only, ~/sb4-ws-dx5: 109 affected CLI Rust tests and 69
  client tests passed. After the public-scaffold change, 15 starter tests
  passed again, plus one lock-barrier and one SQLite paired-world cleanup
  test. Intermittent SSH and two required benchmark include fixtures were
  repaired/retried within the assigned checkout. Its target was removed.
- Fresh packed qualify-linux --consumer-only passed at source
  7d39c6229e441485c5845280e3570ce4e768a80e. All host cases and isolated proot
  Ubuntu 24.04/Alpine builds passed, including DX5, regression, staging,
  migration, privacy, rule, generated frontend and starter proofs. This mode
  avoids prohibited scripts/test.sh; the separately completed full Cargo and
  client runs provide that scope. The saved result correctly says
  publicationQualified: false and suite: not-run. It is not a publication
  receipt. Later changes contain only tests/evidence; reviewed product hashes
  are identical.
- Final root frozen Bun install, ensure-workspace-hoist and
  check-generated-artifacts passed. Final ref-check passed: 564 LLP docs,
  12,222 refs, zero errors/unchecked. Final docs-budget passed: 319/320 README
  lines and the self-contained first-account guide test.
- Final root inventory passed: 365 package tests, 35 scripts tests, 31 demos,
  487 publication leaves and 162 guide pages/1,937 snippets. Existing expired
  capability-gap review warnings remain. Final guide check passed: 22 passed,
  zero failures/skips/preconditions; 162 pages, 1,937 snippets, 121 existing
  freshness/gap warnings.

Compact JSON evidence and compressed complete logs are committed under
`snapback4/reports/dx5/`; the qualification's source/integrity identities remain
historical after scratch removal.

## Follow-up fixes and commit map

Qualification/tests: `34035768d3`, `417f94b92d`, `d8b1c036c1`, `c86d3a9a3f`,
`ce7f900506`, `0c26e126d4`. Fixture cleanup and bounded flock observation:
`d9723fa5c3`. Design/review checkpoints: `e8acda1db8`, `7d39c6229e`.
All commits use Charlie Cheever <ccheever@firewoodagent.com>.

The full run exposed a SQLite paired-world fixture that removed the main file
but left WAL/SHM files. Its single-connection fixture now removes all three;
1,636 previous sidecars were removed. Packed projects, packs, npm cache and all
31 GB of this worktree's Snapback 4 target were removed after saving evidence.
Assigned Mac build outputs were removed. Workstream temporary logs and the
interrupted qualification's temporary pack are removed after evidence retention.
Read-only wave-20 originals and other worktrees were not modified.

Only external deferral: repeat the 0.4.35 acquisition cases from public npm when
that version is available. SEC5 scope remains with SEC5. No push or version bump.
