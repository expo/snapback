# Integration 29 — REL3, SEC11b, SEC13; Snapback 4 0.4.45

Status: implementation and commissioned product checks complete; final metadata closure and landing follow. Negative metrology results remain explicit below.

## Changes and commits

Pre-merge main: `982e77a600987686239e8f8eb0157df2edb90457`.
Initial requested origin/main merge: `96b15e86ac`.
Ordered no-fast-forward lane merges: REL3 `510d3daf29` (e856f64ff2),
SEC11b `3c9717b91b` (75a492a14e), SEC13 `441efa2760` (ae9468c1fc).
Early version commit: `f8df5d7b8e`, `snapback4 0.4.45: recoverable releases and witnessed evidence and approval questions`.

REL3 makes redundant rollback idempotent and preserves subsequent forward
selection, repairs release/rollback result views and compatibility, and gives
specific refusal/repair advice. SEC11b adds approval-act/history, assignment
scope and transition questions. SEC13 adds current replay of missing evidence,
movable stored anchors and wrong event-time windows. One 0.4.45 guide changes
entry explains the new default nonblocking witnessed questions, release and
rollback behavior, retained rows/accounts, server-store fence/protocol 11,
restart requirements and generated alias client rebuilds. The 0.4.44 entry was
restored byte-for-byte. LLP 3000.037 records this integration.

## Integration seams

Authored security resolutions combine the lane candidate/observer families while
retaining SEC11L fixed search budgets, independent concurrent campaigns and
current gate evaluations. Time candidates join the existing batched compiler;
family sites and columns remain distinct. SECP omissions apply to advice only;
current executable questions are independently restored. Each decision has one
disposition. Unsupported SEC13 evidence cannot acquire a prose acknowledgment,
and a refused batch writes no partial decisions.

The first Codex review found that compact SEC13 cards lost their hypothesis
context. `dd68d838e8` repairs it without extra lines and adds focused formatter
and batched-time equivalence assertions. One Muse review and one fresh Codex
review independently approved the resulting resolution-only diff (both READY,
round 2). Actual verbatim reviews, provenance and original round-1 finding are
under `llp/reviews/3000.036.004.001-integration29-security-merge-*`.
Generated censuses, diagnostic registry, guide manifest, declaration digests
and inventories were regenerated, never hand-merged.

TOK1's four recorded pre-schema reading paths were replayed against the actual
new native binary. All output and README bytes match the original recorded
paths; measured token counts are 2315, 2315, 3014 and 3008, all below 10000.
This is deterministic reading replay, not a new agent bakeoff. No guide budget
was increased. The final native replays the same 7970-byte guide start card (explicit --repeat
for the existing reading cache) and unchanged README bytes. The 78-schema external sequential/unoptimized comparison has zero literal
decision-ID, witness-ID, tier and verdict mismatches. It disables batching,
concurrency, report/advice reuse and asset-byte caching while preserving merged
rules, fixed budgets and fixture constructors. Its strict raw comparator remains
exit 1 for the known wave23-008 arborist upload-ID presentation issue: 29 expanded
payload fields/summary scalars differ. Two cold runs of the identical final
executable reproduce that same raw mismatch with identical IDs and verdicts.
The existing ticket was updated; no scalar was normalized and no assertion was
weakened. Literal full-payload qualification is not established. Final cold/warm replay on 50 wave30 schemas has zero ID, witness, tier,
verdict or raw full-payload mismatches. Final exact compiler capture covers all
980 source snapshots and confirms exactly two changed models, 978 unchanged.

## Deterministic reds and FIX43

REL3's reported two-site store-port failure was already repaired on main in
`08632e34c7`. The unchanged ratchet passes 9/9 with zero production matches;
its ticket is closed. No allowance was relaxed.

Integration additionally repaired:

- `f5ef171038`: packed DX7 expected prose acknowledgment of an unwitnessed
  N_OPTIONAL_EVIDENCE question. It now requires E_SECURITY_NOTES/exit 2 and no
  decision file, then uses the existing N_BROAD_READ advisory control to test
  persisted decisions/refutation. The SEC13 guide/LLP and focused product test
  `missing_replay_cannot_close_an_evidence_question_or_publish_a_partial_batch`
  govern this expectation. Actual native controls and the complete consumer
  chain validate it; no assertion was weakened.
- `c3c56b5057`: the concrete-store census mistook Rust precise capture `use<>`
  for an import, consumed a function body, and failed to advance at a semicolon,
  appending paths until OOM. Exact capture syntax is excluded; a no-progress
  assertion fails closed. Regression controls include a real concrete import
  following a capture clause and a malformed group. All 8 tests pass; both
  concrete production handles and owning dereference bridges remain zero.

- `90769931be`: the complete survey exposed false production refusals in
  wave31-036 Mascot quote edits and wave33-036 Ring design-scan edits. A supported,
  authored, global, column-specific update policy now disposes only the inferred
  approval-input freeze on that column. Runtime authority, authored predicates,
  actual source old/next edit guards, sibling freezes and other derived families
  remain enforced. Generated `$enforced/` metadata cannot masquerade as intent.
  The final native deploys both applications successfully on fresh copies.
  Muse and fresh Codex approved the exact runtime patch in round 3; all six
  verbatim reviews and the earlier findings are retained under
  `llp/reviews/3000.036.004.000-integration29-column-intent-*`.
- `0cee533c0c`: an existing authored-history test assumed a same-column inferred
  freeze existed despite explicit authored edit intent. Its original authored
  predicate/site/operation/reachable assertion remains; a separate guestName
  approval input now provides a stronger, independent derived-freeze prerequisite.
  The focused target passes. No product assertion or allowance was weakened.

- `aeb6fd4c19`: the full packed consumer chain exposed newly reviewed
  GHSA-gcqx-w48m-w2h4 in Expo's deepmerge dependency. No patched upstream release
  exists. Generated Expo starters now include a local MIT fork fixing the actual
  prototype-poisoning paths, selected by an npm file override. The strict audit
  evaluator and empty allowlist are unchanged. A fresh real Expo install has zero
  audit findings and @expo/config resolves the fixed module; the published module
  reproduces the exploit, while the fork resists it. Direct/nested/scoped override
  conflicts, all four direct-dependency spec conflicts, and modified/leaf/ancestor
  symlink patch files refuse before any writes, including --skip-existing.
  The existing 30-file application-source ceiling remains; five licensed dependency
  leaves have an exact inventory. Native notices and generated license/provenance
  are included. Existing authored files remain owned; no silent init --adapt repin.
  Muse and fresh Codex approve runtime round3 and the two stale fixture expectation
  repairs separately in round4. All eight verbatim reviews remain in LLP reviews.
  Failed consumer-r4 retains exit1 and no complete receipt; consumer-r5 restarts
  the complete chain on the committed repair and passes every stage, including Ubuntu and Alpine clean userspace proofs.

## Verification scope and results

After the coordinator's 18:56Z session-wide OOM, incomplete aggregate outputs and
receipts were discarded, and affected checks, survey, timing and consumer proof
were restarted. Completed pre-OOM replay/identity/reading/shape evidence was
retained with its executable hash. Jobs use systemd scopes (MemoryMax=40G,
OOMPolicy=continue), cargo jobs=16, debug/incremental=0, at most two heavy jobs,
and at most four survey/identity workers. Original wave stores were never
opened; replays use copies without owner/token sidecars. Publication trees and
other worktrees were not modified.

The original affected plan against the pinned pre-merge main and the explicit
lean scoped plan/omissions are retained. Conservative version/lock/core inputs
expand the canonical plan into the expressly excluded full client and reverse
Rust pool. The commissioned scope instead executes the complete CLI, core and
language crate tests, changed/focused security, release, SDK and TOK1 client
files, fixture tests, typechecks, release guard, selector tests, root checks,
Wasm and differential checks. This is not a claim that the expanded canonical
selector passed. The completed scoped receipt has all Rust/client/root/build
commands green; its raw overall status remains red solely for the separately
reported Lean open-contract campaign below. No failed receipt was relabeled.

Final language coverage: library, all 199 integration targets and doctests pass,
partitioned honestly across the original final run, strengthened history target,
remaining 56 targets and docs. The original failed prerequisite attempt is
retained, not relabeled. Final CLI security_reviews passes 7/7. The whole final CLI crate at `23272b660c` passes. The subsequent starter-only
Expo repair has focused closure: ten new product/custody client cases, eleven
initializer unit cases and both updated initializer targets pass. The original
initializer target has 54 passed/2 stale-expectation failures; those two were
rerun successfully, with the failed receipt retained. Exact dependency inventory
and the 30-file application-source ceiling are preserved. All 21 selected client files pass on release source `aeb6fd4c19`
(205 passed, 8 platform skips; no failures). Core and other unchanged semantic
inputs retain the completed affected receipt. The retained-final-verification record verifies 15 source/verifier tree and blob
identities, complete consumer artifacts and all retained product results. The last
product delta is isolated to Expo initializer templates/guards, their tests,
notices and docs; engine/language/SDK runtime inputs are unchanged. The final
affected closure records metadata checks separately from the original raw
affected receipt; no failed campaign is relabeled.

Root generated-artifact, inventory, guide (22/22), ref-check (579 LLP docs,
12816 refs; zero errors/unchecked), docs-budget, packaged docs and type checks
pass. Fresh Wasm measurement is raw 2416590 B, named gzip
738765 B, Brotli 556128 B; budget 739265 B = measurement + 500 B
(`3254eaec36`). No guide budget increase.

Ordinary difftest run, seed 0, 2000 cases: 2000 compiled, 120026 executions,
zero disagreements across nine oracles. Lean run-lean, seed 0, 2000 cases:
1658 pass, 324 unsupported, 18 disagreements (5 continuation-next, 8 next,
5 prelude E_RULE/NOT_FOUND). All 16 saved source/JSON reproducers and every
oracle total match Integration 28 byte-for-byte. These are the documented
Lean OPEN.md contract points and existing 20261008 tickets, outside the
publication test.sh/consumer chain. The diagnostic run remains exit 1;
no model, expected result or oracle assertion was relaxed.

## Product evidence

Survey: 980 Snapback schemas across waves 15–33, with 940 exact source hashes
matched to Integration 28. No available day-two schema was byte-equal to day one.
Actual cold default check/JSON check/default deploy/JSON deploy on copies; four
workers. Compiler-derived contract/note and authored-invariant payload digests
identify exactly the two repaired schemas; their actual final-native replays
replace those two failed rows, with explicit affected-scope reuse of the other
978. Original failed survey and all source/hash/protocol manifests are retained.
This is not a fresh 980-schema run on the final binary.

Default check median/p90: **3/6 lines**; deploy: **5/8 lines** (max 16 each).
Seven gates and 1402 witnessed questions, with zero missing current IDs in
default output and one exclusive disposition per ID. All 20 remaining production
refusals and seven gates have carried source-supported predicates; zero false
gates or production refusals remain. Six SEC13 finding shapes and SEC11b
approval, assignment and transition shapes are visible in default output.
Calibrated M coverage, with exact operation/material/role/old-new matching:
wave30 11/14, wave31 12/16, wave32 6/8, wave33 6/15 (its calibration exists).
Unrelated findings and unwitnessed advisories do not count.

The cross-version exploratory audit does not claim all previous witness examples
remain byte-identical: 71 old operation-specific examples differ; 52 have the
same candidate with an alternate current witnessed operation, 13 have another
current candidate at that code/site, five remain expanded-review advice without
a current bounded witness, and one was the deliberately removed false Mascot
freeze. No previous gate is absent. These semantic/generated-example changes
are separate from the same-source sequential/cold-warm identity comparison.
SECP does not omit a current gate or witnessed question.

SEC13 actual native evidence: six finding shapes across five lanes, plus five
safe controls pass. REL3 release replay: 150 private store copies, 728 successful
moves, 22 expected refusals, 294 consistent rollback populations, zero hidden
rows, zero timeouts, zero new refusals or changed codes compared with REL3 final.
Native candidate SHA256:
`de5781296ff65db2ad32345a88d06c5d4d9a87bd041ce94ed95932c13ac637c8`.

Complete `qualify-linux.mjs --consumer-only` R5: **PASS**, source `aeb6fd4c19`,
production native SHA256
`e5488d6298ab87783662a776eb2781a8d506ff0e1ee6b36e996a04332b61c43a`.
The final client and Expo tarball SRI digests, native package digest, complete
consumer JSON, individual stage proofs, all six clean starter audits and both
Ubuntu/Alpine clean-userspace passes are retained under
`snapback4/reports/integration29/consumer-only/` and `consumer-summary.json`.
The full publication suite is explicitly not run, publicationQualified is false,
and no publication receipt is produced. Failed R4 and killed partial attempts
remain failed/discarded; none substitutes for this complete chain.

## Latency

All 800 paired commands completed without tool timeout. Latency does **not**
qualify: the cold regression exceeds paired noise and default p90 targets fail.
The existing SEC13 ticket remains Open, updated with exact profiles, baseline
provenance, confidence intervals and a preservation-constrained follow-up.

| Mode | 0.4.44 cold p50/p90 (s) | Merged cold p50/p90 (s) | Warm p90, .44 → merged (s) |
| --- | ---: | ---: | ---: |
| check --review | 6.384/15.525 | 10.326/22.995 | 14.795 → 15.454 |
| production deploy | 10.468/19.209 | 13.603/27.753 | 2.560 → 2.680 |
| default check | 6.407/16.454 | 10.226/21.676 | 14.841 → 15.869 |
| deploy --staging | 7.461/18.156 | 10.832/21.183 | 2.326 → 2.543 |

Default check p90 exceeds 10 s; staging p90 exceeds 15 s. The cheap redundant
time-candidate compile path was batched. Remaining cost is campaign/replay and
fixture initialization: worst cold check wave30-026 wall 19.475→31.846 s and
CPU 17.684→49.615 s. Reusing check's 512-work report for the 3072-work derived
witness campaign would lose questions and was not done. No work budget or
latency bar was weakened. All 50 timing fixtures have identical model payloads
after the later intent fix, but these remain measurements of the named
pre-repair native, not fresh measurements of final release native `e5488d62`.
Protocol: 50 source-identical wave-30 apps, one worker, four modes, independent
fresh source/fixture copies per binary/mode, then a warm repeat on the same copy.
Adjacent before/after pairs alternate which binary runs first. Shared host,
matched window; no unloaded-host claim. CPU, load and nested phase traces are
retained. Baseline is Integration 28's recorded 0.4.44 production timing binary
(source 9b9f1a74af4f, aa6a5388 SHA256), not its later d1bd consumer executable.
Later native differences are Postgres ownership/recovery and comment-only LLP
identifiers; this protocol uses SQLite copies. The exact baseline/main diff and
provenance are retained. No performance budgets or witness work limits were
raised, and no question/gate was omitted for timing.

## Landing and publication deferrals

Final metadata closure and late fetch/push outcome are recorded in the landing
record below. Product evidence is bound to unchanged semantic inputs; later
metadata commits do not claim a fresh whole-suite execution.
Full client pool, 20k/device differential runs, full qualify-linux/test.sh,
publication signing/publishing and Mac runs remain with publication, as requested.
