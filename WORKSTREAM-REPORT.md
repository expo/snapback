# REL3 — wave 12 (target 0.4.29)

Worktree `/home/ccheever/projects/sb4-w12-rel3`, branch `sb4-w12-rel3`.
Started clean at `c22dfefc9c`; initial `git log sb4-loop..HEAD` was empty.
No push, publication or version bump. The coordinator owns the 0.4.29 version
and release integration. No other worktree or evidence application was modified.

## Commits

- `41f33453d5` — governing child RFC and parent amendment pointer.
- `e4234847f0` — served catalog/hook/helpers, rollback safeguards, fixture and
  upgrade/dev implementations, guide recipes and initial regression tests.
- `5b283a5244` — round-1 fixes: optional arguments, baseline nominal namespaces,
  either-release field privacy, independent catalog; reviewed guide definitions.
- `77f1520bf4` — round-2 fixes: first-fetch/credential generation floor, full
  baseline module identities, required fields on wholly new tables; regressions.
- Final review/evidence closeout commit recorded in git log; this report may
  remain uncommitted as requested.

## Governing context and decisions

Applied llp-orient and local-only llp-ship under the explicit branch/no-push
instructions. Read the Snapback4 fence, NOT-DOING and journal, LLP3000 and the
brief, retained-release RFC3000.000.000, and relevant client-lifetime,
fixture/starter, diagnostic and field-authority LLP references. Read the wave12
analysis prioritized list, verification ledger, DT2/3/6/7/16–18, NA12 and Exact
E3/P6/P8 evidence. Parent release §12 points to child RFC3000.000.000.000.

Two bounded helper agents implemented fixtures and upgrade/dev changes in this
worktree; the lead integrated and committed everything. Both requested external
reviewers use fresh sessions. Reviews, exact briefs, candidates and model
provenance are saved verbatim under `llp/reviews/3000.000.000.000-rel3-*`.

Decisions: compatibility is an application opt-in source baseline, not a Quarry
syntax extension. A directory retains original schema/module filenames;
single-file baselines also preserve their original module name. `since_release`
is an author label, distinct from monotone server generations. Availability is a
conservative exact name/kind/argument-shape check, never authorization or proof
of unchanged semantics. Dormant dependency warnings are conservative table
counts, not claims that every retained row matches a business guard. Fixture
relative times capture one invocation timestamp; engine expiry/sync semantics
are unchanged. Refusal codemods require an actual reproduced replacement code.

## #7 — release-spanning clients and rollback safeguards

Implemented and committed:

- Authenticated `GET /` adds public argument/field shapes; jobs/private/engine
  fields are excluded. `ServedType`, `ServedRelease` and `ReleaseSource` provide
  typed metadata; both client tiers expose it and React exports `useRelease`.
- Catalog subscriptions run with no query watches, survive change-feed refusal,
  poll quiet switches, and react to generation headers. Stale generations and
  old credential epochs cannot publish. Sign-out/close/retired facades withdraw.
- Generated operation handles expose `available(release)`. Optional baseline
  generation uses `snapback/client-compatibility.json`; added fields/projected
  results/parameters become optional, declared optionality is preserved, privacy
  in either schema stays optional, and old nominal results use independent
  baseline row definitions. Entirely new tables retain required row fields.
- `guide deploy` covers opt-in, field fallbacks, drafts above release gates,
  dormant versus deleted, signature races, and a bridge preserving a safety
  table/value domain/audience/require before contracting source. Card stays at
  its existing 150-line bound.
- Exact rollback previews relate dormant row counts/sample ids to target read
  dependencies, including rules, parents and maintains. Human/JSON hazards name
  release, operation and table. Existing live pointer/history remain unchanged.

Tests include both client tiers following v2→v1→v2 without query watches, a real
booking guard that stops seeing a dormant inspection and is restored by a bridge,
exact preview state equality, empty/nondependent controls, actual tsc checks,
module baselines, private fields, removed nested nominal result types, malformed
baselines, generation/credential races, and Chromium gate/draft/focus retention.

## #6 — every fixture/test/dev bullet

Implemented and committed:

- Recursive saved aliases in `data` and `match`; unknown aliases/paths fail
  `E_FIXTURE_ALIAS` by name. Existing literal escapes are retained.
- `match` recursively subsets objects; array length/order and scalars stay exact.
  `data` remains exact. Failure messages distinguish assertion mismatch.
- Typed time leaves in fixture rows and case args accept `now` and signed positive
  integral ms/s/m/h/d/w durations. Activation, seed, cases and sweep use one
  captured time; invalid/out-of-range values fail `E_FIXTURE_TIME`. Text/JSON stay
  literal. Cases execute before the derived sweep, so their writes are visible.
- Testing guide shows raw `/seed` arrays beside reset's wrapper and CLI/HTTP
  dev-clock forms. Existing KIT proof sections retain their owner; the old
  proof-kit alias sentence now points to the REL3 amendment.
- Private dev logs explain empty viewer-keyed rosters, including direct/aliased
  program guards and table rules; one bounded probe per distinct roster per
  request. No new HTTP or production row-count disclosure.
- Test help states sweep/default expectations and cases-before-sweep ordering.
- `check --fix` privately replays cases before replacing documented
  E_CONSTRAINT→E_UNIQUE expectations; hidden E_RULE and real id-collision
  E_CONSTRAINT expectations remain untouched. JSONL bytes outside expect remain.
- Upgrade snapshots persist per-query completeness classes. Deltas compare real
  old/new facts; missing old facts are explicitly unknown.

Tests cover positive/negative aliases, subset mismatches, time conversion and
literal preservation, ordering/derived args/help, dev versus production/no-roster
versus nonempty rosters, quiet refusal logging, conditional rename controls and
snapshot completeness classes.

## E3 / DT7 — Snapback half

Implemented using FIX28's separate runtime history acknowledgment: the first
check after a changed installed version prints exactly
`Exact device: bun exact.mjs snapback --rebuild` for device mounts, including
when compilation/device preflight subsequently fails. Later checks do not repeat
it. JSON mode uses stderr. Online mounts receive no device rebuild hint. Tests
cover all these cases. Exact2 runtime/session changes remain EX7's lane.

## Verification

All direct Cargo invocations used disabled incremental/dev-debug/test-debug.
Setup: frozen Snapback4 Bun install, binary build, wasm build and client build
passed. Wasm remains 707,674 gzip bytes against 708,174 budget; no core/wasm
semantic change or budget raise. TypeScript client typecheck/build pass.

| Command/scope | Result |
|---|---|
| Rust CLI binary suite | 434 passed, 0 failed, 5 existing opt-in ignores |
| Core retained/dormant/adoption tests | 47 passed, 0 failed |
| CLI check / check_notes / cli_friction / dev_refusals | 102 + 10 + 30 + 27 passed, 0 failed |
| Added directory/single-module baseline CLI test | 1 passed |
| Codegen compatibility regressions | 5 passed |
| Full Snapback4 guide suite | 123 passed |
| Clock and dev-reset integrations | 27 + 4 passed |
| Fixture focused units | 4 passed |
| Upgrade roster/surface/rename focused units | 1 + 2 + 1 passed |
| Ten affected client files | 206 passed, 0 failed, 8 existing platform/legacy skips |
| Final three release/client files after directory baseline support | 51 passed, 0 failed/skipped |
| Guide API index exports | 2 passed |
| `./ref-check` | 547 LLPs, zero errors/unchecked references |
| `node snapback4/scripts/docs-budget.mjs` | README320/320; named self-containment test1/1 |
| Root `node scripts/check-inventories.mjs` | PASS:365 package tests,35 script tests,31 demos,487 publication leaves,162 pages/1937 snippets |
| Root `node scripts/check-guide.mjs` | 22 passed, zero failed/skipped/preconditions;121 inherited warnings |

Client skips: seven published0.2.33 native fences require darwin-arm64; one
legacy-server compatibility test requires explicit SNAPBACK4_LEGACY_BIN. The
Chromium regression and both current native/wasm tiers actually ran.

Final release proofs use frozen binary SHA256
`c93b79542c3f9e799229002f5c496cb4ea5b65cb3ae91fb759acfc4f59ab7609`
at `/tmp/rel3-snapback4-final`, avoiding live debug relinking. Earlier broader
client pass used `bd054570522e8c71220056c534cb59b82b9713bc90be5036cb00ff48775e8a47`.
Full local command logs are `/tmp/rel3-*.log`.

Root setup followed Integration11: frozen root install,
`scripts/check-generated-artifacts`, `node scripts/ensure-workspace-hoist.mjs`,
then diagnostics/symbol/guide regeneration. Initial root checks exposed absent
Bun root workspace links; the documented helper fixed that, with no root source,
manifest or generated tracked drift. Earlier red tests remain red history:
fixture construction spelling mistakes, missing guide definition/action pins,
a stale pre-FIX28 double-counted dormant-cell expectation, and reviewed product
defects. Their corrected affected scopes and final reruns are green. An early
wrong-directory docs-budget invocation found no root script; its Snapback4
invocation and final profile-bound rerun pass. Two wrong-directory Cargo attempts
refused before building; no Snapback1 runtime bootstrap or code was modified.

## Review status and boundaries

Round1: both NOT READY; all four findings fixed. Round2: Muse READY; Codex
NOT READY on generation initialization and module identities, both fixed with
regressions. Round3 Muse and fresh Codex both mark `77f1520bf4` READY, with no remaining
material finding. Codex disclosed a late diff displayed RFC §8 after it had
reached its assessment; no reviewer files were read. This narrower reading-
isolation limitation is preserved verbatim, not hidden. All sessions were
fresh and used the exact commissioned model/effort/commands. The RFC is now
Implemented and its current/ link is removed to archive the completed work.

No product item intentionally deferred. No full `scripts/test.sh`, Mac
qualification, publication, version bump or git push. Other lane ownership:
KIT proof-kit/startup material; SURF general lifecycle/help/client recipes;
RULES2 rule/refusal recipes; LANG generic diagnostics/planner/sweep wording;
EX7 Exact2 runtime/session implementations. One-line pointers remain in the
shared guide/amendment rather than duplicating their text.
