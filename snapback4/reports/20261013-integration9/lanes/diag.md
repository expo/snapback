# Workstream DIAG — wave 10

Branch: `sb4-w10-diag`, commissioned base `f9e40ef51515bf7237d8aaa6f73086dc65b5b4b6`.
No push, rebase, publication, other-worktree mutation, or full `scripts/test.sh`.
Design: `llp/3000.036.002-intent-aware-lints-and-bootstrap.rfc.md`.
Complete. Fresh Muse and fresh Codex both returned **READY** on frozen
`5b6cd28a1d`, document SHA-256 `6df24c51a8d5704b7ca45567fa321ca38e83738cd47914974000ffbda5fea88d` (round10). RFC status is Implemented;
its current link is archived. Final closure changes only records/status.

## Decisions

- Choose ordinary authenticated service-seat mutations for synced roster bootstrap. A whole positive `viewer = 'service:NAME'` branch proves membership-grant authority; existing read-service exclusion keeps these principals out of device audiences. No request-table/system-job enrollment workaround or wire change.
- Add advisory `N_UNREADABLE_PROBE`; preserve caller-visible program probes and all-row table-rule probes. Negative requirements and conditional guards are checked. Point-existence values (and mutation/job prefix observations) are checked at observation time to cover later aliases/helper-returned values. Positive existence requirements remain authorization checks; pure query prefix/search/seek answers remain ordinary visible-hit answers unless used as guards.
- Readability evidence must not be fabricated: follow helpers/shapes/spreads/viewer scopes, transfer only actual argument evidence with fresh names, invalidate on effects and relevant rebinding, account for loop backedges/exits, and require all extra rule equalities. Conservative advice is allowed; it is never an admission gate.
- Explain `!=` instead of expanding the table-rule language in DIAG. Bracket tests are named equalities; program filters observe caller-readable rows. PAGE2 owns general rule/planner expressiveness.
- Preserve public privacy: unread-parent and viewer-hidden lookup details live in development refusal traces, not new public refusal variants. Readable unique conflicts already use authored codes; pin this behavior with regressions. Trusted system fixture/job inserts now preserve real input/constraint causes.

## #5 — fixture intent

`check` scopes shared cases to declared operations and omits drift only when their actual argument decoding/signature/constraint outcome is expected E_INPUT. The runner executes those cases and prints the exact input cause. Non-object arguments can also assert E_INPUT; malformed case metadata and unknown operations remain runner errors.

Commits: `56853133a8`, `19e9293c94`.
Tests: CLI `check` 101/101 and `check_notes` 6/6, including intentional E_INPUT (missing/extra/typed/constraint/non-object), actual stale arguments, saved older schema/shared newer operations, and test rejection of unknown operations. No deferral.

## #7 — production bootstrap

- One `N_NO_PRODUCTION_WRITER` per blocked root component, with descendants; cycles coalesce and multiple roots can share dependents. Persona-only identity collapses to one note even with no blocked table.
- Mintable service-seat branches count as production writers. Positive service equality/AND branches prove membership authority; inequality, negation, arbitrary user literals and unguarded self-join remain rejected.
- Synced first-admin recipe compiles; seats create no device partition; grants/revocation use ordinary transactions and sync. Tokens still expire/revoke under existing policy; reserved service namespace cannot be minted by signup.
- Grant repairs absorb redundant member-and-extra alternatives rather than emitting the tautology. Inline roster recipes retain existing online residency/read predicates and use the schema's writable fields.
- Development E_RULE traces name an unread read-through parent; filtered seat lookups name the viewer and hiding read rule. Public answers remain nondisclosing.
- `guide deploy` adds password migration, roles, relationships, hard-coded persona owners, durable sessions, seat rotation and waiting for scope delivery.

Commits: `56853133a8`, `ac8e365d27`, `19e9293c94`, `4de5970333`, `1c301b51ab`, `4b944c3aac`, `edf8f92c3c`, `567c42e2a3`, `5b6cd28a1d`.
Tests: CLI readiness/root/cycle/persona cases in check/check_notes; core schema 6/6; trace renderer 8/8; runtime diagnostics 5/5 include grant/revoke/no service scope, expired/revoked tokens, reserved namespace, untrusted-grant refusal, private traces; guide 120/120; emitted service source and inline recipe goldens. No deferral.

## #15 — diagnostics (every bullet)

| Item | Change | Evidence |
|---|---|---|
| Mixed positional/named probes | Detect incomplete composite positional key even with extra named tests before misleading id-type errors; preserve full positional unique key plus extra tests | Guard and emitted mixed-key goldens |
| Nullable upsert | Explain unreadable result and full rollback; emitted `! else NOT_FOUND` and `.id` narrowing | Both optional row/id replacements compile in golden |
| `!=` in exists | Targeted equality-only bracket explanation, bounded program-filter alternative and visibility distinction | Program/rule refusal + compiling filter regression |
| E_STRUCTURAL_FANOUT | Point read by id and read-authorized maintained aggregate alongside scoped/invariant/job alternatives | Emitted point replacement compiles; wave6 constraint regressions |
| E_JOB_CURSOR_INDEX | Lead with stable default id order, then ordered-index alternative | Both emitted alternatives compile |
| E_SYNC applied fix | Exclude already-online read-through child from inherited union-audience conflict; name actual synced child and copied-column alternative | Guard/union regression + repaired schema compilation |
| Fixture-load constraints | System insert-upsert preserves actual Input/Constraint instead of NOT_FOUND; fixture loader retains table/constraint context | CLI + atomic runtime fixture regression |
| Unique-conflict codes | Readable conflicts retain authored code; hidden conflicts remain nondisclosing | Atomic runtime readable/hidden collision regression; existing guide collision tests |
| N_UNREADABLE_PROBE | Guard/observation note names hiding rule; scoped proof/effects/helper/shape/job analysis | 23 guard regressions; guide compiles clean |
| Inline staff roster | Schema-specific trusted-seat snippet in E_SYNC; preserve residency/read predicate, no tautology | Emitted source + entire snippet compile, online-roster predicate golden |

Commits: `56853133a8`, `ac8e365d27`, `19e9293c94`, `4de5970333`, `1c301b51ab`, `4b944c3aac`, `edf8f92c3c`, `567c42e2a3`, `5b6cd28a1d`.
Wave9 golden retained and extended: exhaustive SourceRewriteKind handling, exact emitted text applied to original schema, eight passing tests, plus runtime truth-table checks retained. Design-only alternatives remain explicitly guidance, not falsely labeled automatic source replacements. No deferral.

## Validation

Focused cargo commands and review instructions use `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`. Incremental compilation and debug information stay disabled. Product builds/tests use the Snapback4 manifest/workspace.

- Setup: `bun install --frozen-lockfile`, `cargo build -p snapback4`, `bash scripts/build-wasm.sh`, `bun run --cwd packages/snapback4 build`: pass.
- `cargo test -p snapback4 -p snapback4-lang --test check --test check_notes --test wave10_guard_notes --test wave10_runtime_diagnostics --test wave9_rule_diagnostic_rewrites --test guide` (manifest snapback4): check 101, check_notes 6, guide 120 passed. One new test initially had an off-by-one expected source line; corrected and reran the three new regression/golden targets: 17+5+8 passed (`/tmp/diag-final-scoped.log`, `/tmp/diag-final-regressions.log`). Earlier guard analyzer failures were fixed, not baselined away.
- Affected language suites: constraint_diagnostics 9, natural_forms 16, read_through_sync 5, sync_audiences 8, union_limits 4, wave6 12 (one existing ignored), wave7 16, wave8 6: pass (`/tmp/diag-commitable-lang.log`).
- Core schema units 6 and development refusal renderer 8: pass (`/tmp/diag-schema-unit-last.log`, `/tmp/diag-refusal-unit.log`).
- Simulator residency 17, roster 2, union 29 (two existing ignored), work_intent 12: pass (`/tmp/diag-sim.log`). Semantic runtime inputs unchanged since those passes.
- Rebuilt device artifact: 2,291,726 raw / 698,392 gzip bytes, below unchanged 698,886 gzip budget; TypeScript package build passed (`/tmp/diag-client-build.log`). No complete publication qualification claim.
- `./ref-check`: 544 LLP docs, 11,123 refs, zero errors/unchecked (`/tmp/diag-ref-scope.log`).
- Latest alias/wrapper pass: guide120, guard19, check101, check_notes6, rewrite8 pass (`/tmp/diag-alias-coverage.log`); object shorthand and loop-input follow-up guide120/guard19 pass (`/tmp/diag-alias-shorthand.log`, `/tmp/diag-alias-loop.log`). The horizon test now pins the single new warning at chat.q:83:22 with its hiding rule; targeted check passed (`/tmp/diag-horizon-pinned.log`). Final ref-check after this doc amendment passed (`/tmp/diag-ref-r6.log`).
- Final direct-input pass: guide120 and guard20 passed (`/tmp/diag-r7-final.log`); rewrite8 passed (`/tmp/diag-immutable-inputs.log`, `/tmp/diag-r7-scoped.log`); latest CLI check101/check_notes6 passed (`/tmp/diag-r7-cli.log`); ref-check passed (`/tmp/diag-ref-r7.log`). Row-dependent candidate filters remain quiet, global gates lower to conditionals and get checked, and proof ASTs are never modified by input traversal.
- Requirement-context pass: guide120, guard21 and golden8 passed (`/tmp/diag-require-inputs.log`); latest CLI101+6 and expanded guard21 (including shape inversion) passed (`/tmp/diag-r8-final.log`); ref-check passed (`/tmp/diag-ref-r8.log`).
- Shorthand/inline pass: guide120, guard22 and golden8 passed (`/tmp/diag-shorthand-normalized.log`); latest CLI101+6 passed (`/tmp/diag-r9-cli.log`); ref-check passed (`/tmp/diag-ref-r9.log`). Shorthand normalization is confined to analysis clones and changes no runtime expression.
- Broader reviewer evidence: Muse8 ran the binary suite; one supervisor/witness timing test failed once outside the DIAG diff, then the identical-tree rerun passed415/415. The verbatim artifact records this; affected DIAG suites were green. No complete-battery qualification claim.
- Final point-filter pass: guide120, guard23 and golden8 passed (`/tmp/diag-point-filters-final.log`); latest CLI101+6 passed (`/tmp/diag-r10-cli.log`); ref-check passed (`/tmp/diag-ref-r10.log`). An initial positive-filter fixture had overlapping declared indexes and was replaced with the exact single-unique-key reproduction; the product fix was retained.
- `git diff --check`: pass.

## Review record and ownership

Fresh Muse (`muse-spark-1.3-contributor`, high) and fresh Codex (`gpt-6.1-sol`, high) reviews are saved verbatim with commands/document provenance under `llp/reviews/3000.036.002-diag-r*.{muse,codex}.md`.

Rounds 1–9 drove seat lifecycle clarification, unresolved extra equality handling, helper effects/compound expressions, loop exits/rebinding, actual-index proof, shape/spread and job-viewer coverage. Round2 Muse's out-of-lane revert claim was a baseline error: `sb4-loop` is moving; commissioned base is fixed f9e40ef515. No HS files were reverted. Subsequent briefs pin that base. Round4's non-object negative-case consistency improvement is implemented. Round5 Muse was READY; Codex found wrapped requirements and query-prefix alias guard uses. Both are fixed, including shorthand objects, loop inputs and guard-consuming helper/shape inputs. Observation-time authority and ordinary returned prefix answers have explicit regressions. Round6 Muse was READY; Codex found direct helper/shape/loop expressions. These now use immutable input-value observation, with direct/alias/quiet row-filter cases and a cross-argument snapshot-name collision regression. Round7 Muse was READY; Codex found requirement-contained helper inputs, including returned inversion. Requirement context now observes every direct helper/shape input, with point/prefix/inversion/proven-role regressions. Round8 Muse was READY; Codex found local names hidden by shorthand and inline requirement shape bases. Analysis-only shorthand expansion now consistently exposes symbols to proof/effects/validation, and inline bases are inspected outside named-definition discovery. Same/different argument and inline inversion regressions pass. Round9 Codex found ordinary point filters still classified as guards; plain query values now use immutable value traversal consistently for point/prefix candidate predicates. Positive/negative point filters and global gates pass. Muse9 fallback stalled over25 minutes and was cancelled after ownership verification with no verdict; its actual output is preserved and round10 retries it.

Ownership pointers: HS owns Exact/device handshake and declarations; REL2 owns release lifecycle prose/behavior; DX2 owns starter/upgrade/witness/client recipes; PAGE2 owns general planner/rules expansion. No DIAG item is deferred to those lanes. The governing starter LLP carries the DIAG bootstrap pointer; overlapping deployment lifecycle text remains REL2's responsibility during integration.

## Local commits

1. `a0a9d6ed57` — design and first blind review record.
2. `56853133a8` — fixture intent, trusted fixture errors, root/persona readiness.
3. `ac8e365d27` — service grant authority, actual synced-child selection, private traces.
4. `19e9293c94` — usable diagnostic repairs, emitted-text goldens, compiled bootstrap/deploy recipe, review rounds 2–4.
5. `4de5970333` — unreadable guard observations and scoped-effect/helper evidence.
6. `1c301b51ab` — wrapped requirements, guard-consumed query-prefix aliases with original authority, horizon warning pin, round5 reviews/resolutions.
7. `4b944c3aac` — direct helper/shape/loop inputs, immutable proof traversal, snapshot marker collision and explicit-index protection, round6 reviews/resolutions.
8. `edf8f92c3c` — requirement-contained helper/shape inputs and returned inversion, point/prefix/proven-role regressions, round7 reviews/resolutions.
9. `567c42e2a3` — analysis-only shorthand normalization, scope/effect/argument validation and inline requirement shapes, round8 reviews/resolutions.
10. `5b6cd28a1d` — consistent ordinary query point/prefix candidate-filter boundary, global-gate regressions, round9 Codex review and incomplete Muse attempt record.

11. `0bf1b23e06` — independent round10 READY reviews, Implemented RFC status, archived current link and final journal/review record.

All requested DIAG items are complete; no DIAG deferrals. WORKSTREAM-REPORT.md remains uncommitted as allowed. Final ref-check after status/archive changes passed:544 LLP docs,11123 refs,zero errors/unchecked (`/tmp/diag-ref-closure.log`). No semantic source changed after both READY verdicts.
