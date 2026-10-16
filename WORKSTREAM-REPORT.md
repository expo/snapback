# LANG3 — Wave 14 / 0.4.31

Implemented, reviewed, verified and committed. No LANG3 product item deferred.
Branch: `sb4-w14-lang3`; baseline: `4ef9f77fb3` (0.4.30).
No push or version bump. Integration owns the 0.4.31 release.

## Per-item changes

| Item | Final behavior | Main commits / tests |
| --- | --- | --- |
| Conditional completeness / 002 | Default check output names the query and missing pins. Full explanation remains verbose. | 63215272d0; CLI query/pin regression. |
| Held parent / 012 | Core rederives a bounded sufficient proof from held readable points and continuing audience branches, including arbitrary IR. Authored page and audience remain exact. Server-only. | 63215272d0, 7a0af20fb6, 018fafab47; observer/teacher/outsider execution, missing/wrong guards, ten adversarial IR tests. |
| Private parent/child / 004 | Checked optional parent-group cap keeps every audience branch and the original query. Product choice; existing data must fit. No inferred copied-field invariant or automatic audience change. | 63215272d0; owner/landlord/finalist/outsider execution after applying the exact cap. |
| E_CASCADE_BOUND | Authored product edit leads. Reservation arithmetic is behind terminal verbose output; optional JSON details preserve machine evidence. A second cascading parent names restrict/drop-column. | 63215272d0, dfaff7904b; default/verbose/JSON, joint-cap execution, two-parent regression, packed default/verbose cases. |
| Immutable notes / 095 | Correctness-review category. Stable pinned immutable-parent projections stay quiet as intentional equality guards. Runtime equality remains enforced, including historical rows. | 63215272d0; immutable-parent positive / mutable-parent negative; five survey notes removed. |
| P18 partial | A private conflict key proving readability gets the existing proven-change/fresh-clock refusal. Unknown timestamps and hidden-other-principal conflicts retain notes. Omitted/equal fields remain valid. | 63215272d0, 018fafab47; actual prewave14 fixture and fresh/uncertain/omitted variants, including packed compiler checks. |
| Proven notes / 049,091 | Roster facts survive unrelated writes; full cascade/set-null destinations, rebound names, helper/shape/spread effects invalidate them. Hidden-lookup warnings target actual required point-read gates, never blind mutable updates. Exact prior witnesses filter individual gates, including inside requirements, before grouping. Reference update attempts count inline and through mandatory helper paths. | b6b567f28b, dfaff7904b; role revocation, exact/wrong/rebound keys, later gates, nested effects, helper branches, actual blind-write versus required-read execution. |
| Top-N / 031,066 | Cursorless subjects share one explanation. Individual JSON subjects remain. | 63215272d0; CLI grouping regressions. |
| Mixed keys / sync / 055 | Positional/named mixing is named explicitly, retaining non-null-key cause. Sync diagnostics print literal replacement lines and full-acquisition consequence. | 63215272d0, dfaff7904b, 9eb1b4faa1; emitted replacements compile in their original schemas. |
| Enum flow / 077,085 | Boolean alternatives union finite enum facts; surviving return/refusal paths retain them. Unknown alternatives and rebinding remain conservative. | 63215272d0; OR/early-return positives, unknown-arm/rebinding negatives. |
| Sort / 035 | Sorting preserves the original complete capped population. Slicing/transforming cannot gain that proof. | 63215272d0; sorted update loop accepts, sliced loop refuses structural fanout. |
| Reserved names / 082,093,099 | Cheatsheet inventory and regression coverage for by/update/device and contextual builtins. Named reserved-declaration errors already existed and remain protected. | 63215272d0; exact parse-name tests and packed cheatsheet retrieval. |

User-visible changes are in the **0.4.31 `guide changes` entry**. Diagnostic
why pages and captions describe the final behavior. No executable guide
snippet or starter was added or changed; existing inline examples remain.
All new literal repair examples have compile/execution regressions.

RULES4 owns authorization recipes and failing-layer text; KIT3 owns null
fixture aliases. No other worktree, publication host or black M5 was touched.
No platform-sensitive product path changed, so no Mac run was required/claimed.

## Design and reviews

Applied llp-orient. Read Snapback 4 AGENTS/NOT-DOING/JOURNAL, common rules,
LLP 3000 and the governing language/completeness/reference documents and
current guide forms. Read the requested Wave 14 publish/fix/ledger/design/H9
and DT/NA/P/R evidence. Evidence lanes remained read-only.

Amendment: [LLP 3000.036.002 §12](llp/3000.036.002-intent-aware-lints-and-bootstrap.rfc.md).
Its governing pages 3000.007, 3000.036.001 and 3000.039 point back to it;
affected-scope documentation drift was reconciled.

**Final round 8: fresh Codex gpt-6.1-sol/high and Muse
muse-spark-1.3-contributor/high both READY on the same five frozen digests.**
Verbatim reviews, briefs and provenance are under
`llp/reviews/3000.036.002-lang3-r1.*` through `r8.*`.
Earlier verdicts bind their earlier snapshots and are explicitly superseded
where execution/review found further corrections. No review was fabricated.
Muse's supplied wrapper used its authorized API fallback after plan quota;
no key file was read or printed.

The corrections cover stale lexical versions, nullable ids, volatile ids,
short-circuit setup/reconstruction, occurrence grouping, shape effects,
helper update attempts and required reads nested inside requirements.
Execution also disproved the old blanket claim that a blind mutable update
reads under the program read rule; the final diagnostic targets the actual
required read gate instead. The reviews certify implementation separately
from the execution receipts below.

Core snapshot proof SHA256:
`666143f5995ff271186f6a046dcc641a86bf3a82e574efb5481b45da3befccd5`.
Final note-analysis SHA256:
`83f204a00b7d9213042d7e982fa20873596671be9636414c68b3a8e90cbcd784`.

## Verification receipts

Artifacts: [snapback4/reports/wave14-lang3](snapback4/reports/wave14-lang3/).
Logs are compressed; JSON includes full survey answers, multiset changes,
command reproductions, packed cases and compiler hashes.

- The combined five-crate command had a **3600-second timeout**. It completed
  all CLI targets (**1,247 passed / 15 existing ignores**) and core targets
  (**743 passed / 5 ignores**), with zero failures, then timed out during the
  587-case device row-view disclosure test. Its exit 124 is retained plainly.
  Remaining crates were run separately rather than labeling the timeout green.
- Full language rerun: **2,091 passed / 14 existing ignores**, 157 targets,
  exit 0. Covers the final note flow and all compatibility expectation fixes.
- Full device suite: **1,562 passed / 4 existing ignores**, 101 targets.
  The 587-case generated disclosure test passed in the resumed run.
- Full simulation: **749 passed / 7 existing ignores**.
  Full device/simulation command exits 0, including documentation tests.
  Combined completed scopes cover all five requested crates.
- Core documentation tests: **17/17 pass**. Final CLI units:
  **454 pass / 5 existing ignores**; CLI check and note targets **105 + 10 pass**.
- Focused source/IR/runtime contrast: **16 + 10 + 12 pass**, one existing
  ignored farm sweep. Exact/wrong requirement-condition witnesses are included.
- Affected clients: **42/42 pass** (server checks, page authority/readiness/cuts,
  existence, read-through upsert, published guide types).
- Native differential `run`: **20,000 compile; zero disagreements**.
- Device differential `run-devices`: **seeds 0–999; zero disagreements** on
  memory and SQLite.
- Lean: **lake build 58 jobs pass**; `run-lean` **20,000 compile**, exit 1 for
  **130 disagreements in four baseline-tracked signatures, zero new**:
  E_RULE~NOT_FOUND 3; prelude E_RULE~NOT_FOUND 25; next~no-next 67;
  continuation next~no-next 35. Their DIAGNOSIS.md files exist at 4ef9f77fb3
  (existing OPEN W4/C2). No introduced binder or runtime refusal signature.
- The differential runs bind the final runtime/planner/enum/immutable delta.
  Later changes affect advisory notes/help only, with no schema/IR/runtime
  semantic change; their complete affected language/CLI suites were rerun.
- Hundred-schema survey: **100/100 pass before and after; 371 → 357 notes**.
  Every changed note is explained in `survey-explanation.md`, with complete
  object multiset changes in `survey-changes.json`. This checks exactly each
  requested schema.q in a private copy; the analysis's broader app/toolchain
  99/100 result is a different scope. There is no new schema refusal.
- Packed client + locally packed Linux test compiler: `check`, full cheatsheet
  and four updated `why` pages pass with **no binary override**. Packed cascade
  default/verbose and actual P18 clock/uncertain/omitted cases **5/5 pass**.
  This uses a local native test compiler, **not a published/static-musl platform
  qualification**. Both package versions remain 0.4.30 for integration.
- Clean Wasm source b7a4a60213: **2,372,437 B raw / 723,160 B gzip /
  545,311 B Brotli**, strict family/absence audits pass. Budget **723,660 B**
  = measurement + exactly **500 B**. Raw/gzip sizes unchanged from 0.4.30;
  captured-parent proof is server-search-only, later corrections compiler-only.
  Node zlib quality 11 supplied Brotli because the executable is absent. An
  initial missing-Brotli zero reading was discarded, not treated as valid.
- `./ref-check --verbose`: **pass**, 550 documents / 11,365 refs / zero errors.
- Snapback 4 `node scripts/docs-budget.mjs`: **pass**, README 317/320 physical
  lines and named first-account self-containment test passes.
- Root frozen Bun install + ensure-workspace-hoist: **pass**.
- Root inventories: **exit 1** on inherited generated-artifact prerequisites.
- Root guide: **exit 1**, 19 passes / 0 content failures / 3 preconditions,
  from the same absent artifacts; legacy expired GAP warnings also remain.

Every shell command had a timeout. Retained Cargo qualification runs use
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
An initial docs-budget invocation inherited debug defaults, was stopped and
rerun correctly. Never ran scripts/test.sh. A redundant device-tail run was
stopped once the primary full device run completed; it is not counted as proof.

## Judgment calls, limits and deferrals

- Cap advice is an explicit product constraint, never automatic engine tuning
  or an authorization rewrite; adoption requires existing data to fit.
- Immutable-parent silence means an intentional runtime equality guard,
  never a global historical dependency.
- Default terminal cascade arithmetic is verbose; structured JSON retains its
  optional details for tools. No runtime wire format changed.
- Sufficient completeness proofs and advisory coverage remain conservative.
  A missing note proves neither existence nor authorization. Same-condition
  conjunct threading and wider helper warning discovery are precision limits,
  not permission grants or LANG3 item deferrals.
- Root checks need ignored legacy Snapback 1 artifacts absent here:
  `demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`,
  `demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts`, and
  `demos/todo-v2/snapback/generated/contract/runtime-links.ts`.
  They were run after the required root install/hoist. Rebuilding shelved
  Snapback 1/Contract backends is outside this lane; integration must
  materialize them if it needs green root checks. No check is claimed green
  by omission. No LANG3 product item is deferred.

## Commits (no push)

- 63215272d0 — audience proofs, narrowing, diagnostics and guide changes.
- 7a0af20fb6 — stable inhabited facts for captured authority.
- 018fafab47 — total-point proof, mixed-key guards, actual P18 fixture.
- c356415829 — initial independent review records.
- b7a4a60213 — measured device budget and exact 500-byte headroom.
- b6b567f28b — occurrence/effect/helper corrections.
- dfaff7904b — actual required-read gates and literal repair contracts.
- 0f5a9229b0 — correction reviews and final matching READY digests.
- 9eb1b4faa1 — complete literal sync replacement matrix.
- Final qualification/corpus/report commit follows this report; `git log sb4-loop..HEAD` identifies it. No push.
