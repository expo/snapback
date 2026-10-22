# SEC8 workstream report

Branch: `sb4-b24-sec8`. Product code: `7d86b4af03`. No push or version bump.
Merged `origin/main` at `fc5b38f511` in `d3bed65fbe`. Its incoming code is
Postgres-only; all reviewed SEC8 input hashes remain unchanged. Both appended
journal suffixes were preserved when resolving the sole merge conflict. The
post-merge offline Postgres codec test passes (1 test, `--features postgres`).
Version remains 0.4.38; ROLL 0.4.39 had not landed on main at the final fetch.
Client and model runs completed before integration; no publication receipt or
whole-suite green claim is made. Cleanup evidence is in the final archive.

## Changes and commits

1. **Presence intent / reachable upload gate** — `a776d53a21`, `3d7984cb96`.
   Optional media advice and the specification draft offer permanent presence
   (`invariant TABLE always .COLUMN != null`) or creation-only presence
   (`invariant TABLE.insert only .COLUMN != null`). Both reach the existing
   narrow gate; optionality without independent intent remains advisory.
   Required child fields do not require a child row: separate child-photo advice
   covers 008/033, including text URL/photo models. The complete upload recipe and
   both exact lines run from an installed native/client pack, including nullable
   counterexamples. No natural-language requirement is silently compiled.
2. **Honest and deeper `test`** — `a776d53a21`, `3903d32711`, `394020130f`,
   `7d86b4af03`. Default output names unsupported invariant targets/sites/reasons
   and visited runtime unknown judgments; the verdict is incomplete on those
   gaps. Unknown is never policy false. Exit 1 remains actual failures/refutations;
   incomplete without an observed failure retains exit 0 (explicit reporting decision).
   Existing verified asset materialization uses real actor-owned ledgers. Creator
   ordering preserves opposing booleans before both root slots fill, enforces
   per-target row caps, and reports omitted tuples. Directed bounds are depth 12,
   aggregate 4,096 attempts, 8 argument tuples, 3 successors, 5 beam worlds and at most
   16 retained worlds. Source-offset Time candidates preserve 14-day setup and
   past-time controls. A single pre-derived observation recognizes explicit
   parent/child intent dependencies from bound policies and concrete syntax;
   unrelated reference-taking creators cannot preempt pending resource roots.
3. **Lifecycle questions** — `a776d53a21`. Stale eligibility covers non-default literal
   enum state writes without an approval word list. New advisory questions
   cover ignored approval flags, post-approval edits/replacement, independently
   attached media children, reusable guards, overdue writes, dependent deadline
   bases and calendar-duration boundaries. They introduce no heuristic gates.
4. **Output / individual decisions** — `f4e4af29a7`, `3d7984cb96`.
   Human restatement/role questions share a table questionnaire; restatement-only
   noise keeps its lower rank. JSON retains all original questions, sites and
   individual IDs. Advisories accept individual specification rationales.
   Stable IDs and column/rule bindings survive unrelated queries, comments and
   declarations. Helper, grant-writer and authority dependencies invalidate
   relevant decisions. Complex notes use an explicit conservative declaration/
   writer closure; same-resource edits can require renewed review. Source-race,
   atomic record, malformed-file and no-acknowledging-refutation protections stay.
5. **Re-measurement** — `56120dd219` and final-measurement evidence. All 39 variants
   (13 findings × none/own/one independent spec line) and 450 corpus projects completed from
   isolated schema copies. Relevant default questions: 12/13 with none or own
   intent. Exact appended-invariant fixture witnesses: 9/13. One-line upload
   gates: 2 (007F2/036F1). Corpus: 36 inherited retained-role gates on 15 projects,
   zero new/removed gates and unchanged gate messages; no new false gates.
   This comparison does not independently re-certify all 450 product specs.
   The four unsupported findings are 013 F1 (clock), 015 F1 (clock), 031 F1 (cross-row)
   and 033 F1 (read-through). 033's unrelated own-invariant failure is not counted
   as an evidence-presence catch. 016 has no new specific advisory; its declared
   intent is caught. 029 uses bakeoff §2.2's column-update intent, not the weaker
   aggregate alternative. See `snapback4/reports/20261022-sec8/final-measurement/`.

DX7 owns staging-clock persistence, renderedText/viewport, upgrade messaging and
schema ergonomics. This internal pointer remains out of packaged documentation.
The user-visible SEC8 changes are in the 0.4.40 changelog entry. The client pool
caught the initial ownership sentence in that public entry; it was removed and
the packaged-docs tests pass 2/2. No guide/runtime content changed in that repair.

## Reviews

LLP 3000.036.004 §17 is the governing amendment. Verbatim Muse/fresh-Codex logs,
input hashes and amendment snapshots are under `llp/reviews/`.
Both families marked the final r11 semantic delta READY. R2 Muse timed out and
is not represented as a review. R8 witness replacement was rejected for violating
the vector-length generated-origin boundary and fully withdrawn before landing.
R7/R10 source reviews passed but runtime regressions exposed missing breadth/
concrete-child cases; those execution failures remain recorded. Source review is
not presented as runtime proof. The final code preserves append-only witnesses.

## Verification

- Setup: frozen Bun install, native build, wasm build and client build completed.
- Complete Cargo workspace: 468 targets, 7,443 passed, 27 failed, 275 ignored, exit 101.
  Six initial SEC8 expectation failures are repaired; the remaining 21 unchanged
  metadata fixtures are tracked below. Original red evidence is retained.
- Full language run: 2,486 passed, 11 failed, 16 ignored, exit 101; affected repairs
  were rerun on final source.
- Final all 15 security targets plus guide: 374 passed, 2 ignored, exit 0.
- Final affected targets under full workspace features: 228 passed, exit 0.
- Linux decision-record checks: 9 unit and 4 public CLI tests passed. The workspace
  rerun includes the 4 public tests against final source.
- Mac Studio, `~/sb4-ws-sec8` only: final SEC7/SEC8 sets 17+12 passed. Earlier
  unchanged filesystem decision-record tests 9 and past-time history 1 also passed.
  Every remote target directory was removed. No other Mac was used.
- Final packed security/guide test: 3 passed; its native digest equals the final
  matrix/corpus digest. Every added upload intent line and its complete context
  runs verbatim from the installed pack.
- Fixture wrapper pool: 9 passed. Ordinary pool: 428 files, 7,889 tests, 7,831 passed,
  2 failed, 56 skipped (original exit 1). The public changelog ownership failure
  is fixed and its 2-test rerun passes; the residency failure matches the open
  metadata ticket. All 89 model tests pass, with 5,000 sequences for each session
  tier and 3,000 online-client sequences. The runner recorded clean git status
  immediately after the pool. Original failures remain in the evidence.
- Differential immutable snapshot: run 20,000 and device seeds 0–999 exit 0, zero
  disagreements. Lean 100,000 exit 1, 761 disagreements in 5 existing signatures,
  zero new signatures. This is no-new-signatures, not a green Lean comparison.
- Fresh qualify-linux consumer-only: initial compatibility/DX/Expo/release/
  dormant proofs pass; Day5's installed residency recipe fails existing E_SCHEMA.
  Consumer-only respects the explicit ban on scripts/test.sh; source/client
  suites run separately. No publication qualification receipt exists.
- Independent same packed R9 inputs pass clean Ubuntu and Alpine proot
  roundtrips and starter toolchains. Later changes are bounded offline campaign
  ordering; no distribution/runtime/protocol changes were made by SEC8.
- Wasm: 734,863 gzip bytes / 735,388 budget, passed; no budget change.
- Docs: README 319/320 and self-containment test passed. Root install/hoist/
  generated artifacts completed; inventories 365 package tests, 35 scripts tests,
  31 demos, 487 publication leaves, 162 guide pages / 1,937 snippets passed. Guide:
  all 22 checks passed. Ref-check: 565 LLPs, 12,373 refs before integration; 12,377 refs after, zero errors/unchecked.
- Qualified test commands have bounded timeouts and the required three Cargo
  profile flags. One early docs-budget invocation omitted the profiles; it was
  rerun correctly and its 3.2 GB incremental output was removed. The forbidden
  full scripts/test.sh was never run.

## Deferrals and limits

The core/release follow-up is
`issues/20261022-snapback4-source-reservation-full-suite-failures.md`:
CLI residency/timeline 4, device read-auth 8, language live-parent 6 and predecessor
execution-facts 1, simulator maintains-recorded 2. The same reservation error also
blocks packed Day5 and the client residency test. Inheritance is inferred from
unchanged code/fixtures, not claimed from a separately executed baseline.
The metadata validator was preserved rather than weakened to make tests pass.

Clock/cross-row/read-through evaluator capability remains out of scope; SEC8
reports those gaps honestly. No complete-suite, publication, empty-app reachability
or universal application-security claim is made. Frozen app evidence was read-only;
credentials were not printed. Final cleanup and clean-status evidence are archived with the client results.

Final cleanup removed 28.73 GB of worktree build output and 125 owned temporary
entries. The Mac test driver removed its target directory. Cleanup receipt:
`snapback4/reports/20261022-sec8/client-final/cleanup.json`.
