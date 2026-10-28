# MUSE1 workstream report

Worktree `/home/ccheever/projects/sb4-b34-lat1`, branch `sb4-b37-muse1`.
Started from clean `d6f0253bfa`, including the pre-existing readauth census fix.
No push, version bump or Mac work is authorized. This is a living report;
unfinished validation below is not a claim of completion.

## 1. Diagnosis recorded before product edits

Sources: all 40 exact-draw wave34r1 and wave34r2 archived builder sessions,
paired by idea/model/frontend. Reused wave34r1-repro/tx/parse.py (including
Codex's issuing-call index fix), agg.py, calls.py and docs.py; wall.py supplied
the timing interpretation. Local per-call output is under
`/tmp/muse1-analysis/`; sanitized durable evidence will accompany the change.
One additional parser correction recognizes `npm run verify` before the generic
shell-read classifier: the inherited proof regex duplicated `npm run` around
that pattern. The purpose classifier also had an unreachable rerun branch
(`any(... for f in [])`); the local wrapper now assigns a red family’s rerun
to fix-after-red. Both controls are treated identically. Purpose is the first
tool in each call; combined shell commands and masked exits limit attribution.
Token attribution is the parser's context-gap estimate weighted by subsequent
calls, not an exact tokenizer partition or an independent causal experiment.

| Mean per lane | Muse .46 → .47 (15) | Codex .46 → .47 (25) |
|---|---:|---:|
| Calls | 94.87 → 121.47 | 35.52 → 34.92 |
| Input tokens | 9.419M → 16.568M | 2.161M → 2.332M |
| Wall minutes | 15.42 → 25.18 | 14.64 → 11.82 |
| Tool minutes (union) | 5.01 → 9.59 | 0.72 → 0.78 |

Muse's call growth is authoring +9.7, verification +6.9, own reads +5.2,
lookup +3.4 and learning +1.8. Waiting falls 4.1 → 3.1 calls; classified
fix-after-red calls, including reruns, fall 16.3 → 15.5. The loop is extra proof construction
and exploration, not an increase in waiting calls. The latter classification
cannot assign all masked failing proof runs to repair cycles.

Muse reads mentioning the scaffold average 7.9 tools / 51,983 output characters,
14,077 entering-context tokens and 1.347M repeated input tokens per lane.
All script/acceptance reads grow 3,937 → 17,092 entering tokens and
0.255M → 1.602M repeated input. Code-write tool output adds 4,890 entering
and 0.438M repeated tokens; generated API reads add only 168 entering and
0.064M repeated tokens. Model-authored output and the extra calls also compound
all earlier context: these file-attribution figures do not sum to the full
7.149M increase by themselves. Muse's pooled mean context/call rises
99,289 → 136,400 tokens. A symmetric arithmetic split attributes 3.135M (44%)
of the extra input to call count and 4.014M (56%) to mean-context growth;
this is an accounting identity, not causal identification. The parser's
repeated model-output component grows 2.736M → 5.508M and initial-context
component 3.146M → 4.029M (the initial context itself stays ~33.17k).
Codex's post-schema lookup calls fall 5.5 → 4.2;
its scaffold reading is about one tool per lane, supporting retention of an
available helper rather than deleting it.

The four largest Muse input regressions are child talent (019: 6.92M/80 →
30.53M/179), gown preservation (032: 11.28M/107 → 27.87M/162), wildlife
exclusion (026: 9.63M/100 → 20.89M/140), real estate photos (035:
6.83M/74 → 15.63M/128). These are the four replay selections. Codex controls
are CPAP (001, Expo) and e-bike (014, Expo), the latter a strong .47 gain.

Concrete mechanisms, checked against source and per-call traces:

* `cases.mjs` eagerly expands every operation × role plus every guard into
  required placeholders, including required clock cases. Initial reads are
  20,503 bytes (019), 30,531 (032), 30,355 (026). This is a second application
  specification to fill before the scaffold admits any execution.
* 019 reads all seven packet leaves and verify infrastructure in calls 15–18,
  rewrites cases repeatedly, and debugs its frontend through call 158. 032
  fills the matrix in calls 49–55, then creates multiple acceptance clones and
  debugging drivers through call 110. 026 reads schema facts three times,
  fills the matrix and repairs refusal expectations in calls 76–95.
* Intentionally incomplete assertions refuse before any host work. This is
  truthful proof behavior, but making this exhaustive matrix the default route
  imposes substantial construction work. We must not turn missing tests green.
* `check` does NOT rewrite identical bytes every time. It updates hash-owned
  packet leaves on schema changes, preserves edited leaves, and maintains a
  current-schema hash so an edited/stale facts file cannot conceal new guards.
  Automatic refresh can expand unedited drafts as a schema grows; this is a
  secondary incentive to reread, not evidence of unconditional rewrites.
* `verify` already stops at first red, has three successful summary lines and
  up to six extracted diagnostic lines on failure, with full details private.
  It does not print every successful phase's log. Successful phases do rerun
  on every invocation; no incremental proof claim should be invented.
* Muse waiting tool time rises despite fewer calls: lengthy browser repairs and
  repeated complete proof execution remain. Direct verify mentions account for
  only ~1.5k entering tokens / 0.11M repeated input per lane in tools whose
  retained commands mention verify (a lower bound: compound writes/run commands
  can hide its name or output); the large default
  packet and its required completion dominate direct reading growth.

Decision: retain `npm run verify` and its cleanup/first-red/bounded output gains.
Make the exhaustive proof scaffold an explicit opt-in rather than the default
check/start path. Keep its helpers, refusal assertions, truthful coverage and
packed positive/negative controls available to builders who choose it. Ordinary
checks must preserve opted-in code and still invalidate stale bound facts.
Replays will test whether this evidence-led scope meets the requested bars;
source-byte savings alone are not a performance result.

## 2. Implementation

Implemented explicit `check --proof-scaffold`, validated before alternate-mode
work, plus optional start/workflow wording. Ordinary checks do not create a
packet; existing opted-in/0.4.47 packets refresh only schema.json and its
manifest. Code drafts remain byte-identical until explicitly requested. Edited
facts still refuse through current-schema binding. Existing SCAF1 coverage,
real users, refusal assertions and private lifecycle remain intact.

`npm run verify` is retained unchanged: first red, bounded summary, private full
log and parent/process cleanup. No speculative incremental proof cache.

Initial checks: scaffold integration 12/12 passed; wasm 738,640 gzip bytes
within 739,140; client build passed; ref-check passed. The workflow's first
revision exceeded its 8,000-byte contract; its optional-matrix wording is now
inside that unchanged budget. Packed correctness and full sessions are pending.

## 3. Whole-session controls

Pending: 4 Muse + 2 Codex draws × .46, .47 and branch, empty directories,
exact harness CLI/flags/brief and terminal response. Copies under
`/tmp/muse1-replay/` will be deleted after evidence capture.

## 4. Verification, integration and commits

Pending affected packed starters/proof-kit/consumer-only qualification, reviews,
ref-check and final affected run. Main currently fetched at d6f0253bfa;
Integration 32 must be merged when available before finishing.

Integration 32 merged from origin/main 1e9a50c8a7 before branch replays.
Documentation-only conflicts retain TOK5 §15, GEN1 §16, and MUSE1 §17;
release-history content stays under main’s reference/ layout with MUSE1 in
Next. Root workstream report retains this lane’s report; Integration 32’s
durable report remains under snapback4/reports/integration32/. The provisional
.47 consumer build was stopped during compilation before proofs; it makes no
qualification claim. Branch measurements will use integrated .48 bytes.


## 5. First complete replay: opt-in-only candidate (rejected)

All 18 empty-directory sessions reached their terminal response and exited 0;
installed native/client pins were verified and all replay application copies
were deleted. Frozen candidate source: 8f60156e9d (.48 including TOK5/GEN1).
See snapback4/reports/20261028-muse1/replays-v1.json for exact per-idea results.

| Model | Version | Median calls | Median input | Median wall min |
|---|---|---:|---:|---:|
| muse | v46 | 96 | 8,993,342 | 16.31 |
| muse | v47 | 117.5 | 16,457,696 | 23.43 |
| muse | branch | 118.5 | 13,175,756 | 18.98 |
| codex | v46 | 41.5 | 2,397,016 | 11.51 |
| codex | v47 | 34.5 | 2,227,055 | 10.74 |
| codex | branch | 40.5 | 2,718,899 | 12.85 |

The candidate MISSES both Muse bars against .46 and both Codex bars against
.47. Source correctness/reviews do not override this outcome. No same-code
retry or favorable-result selection will replace these failures.

Second mechanism decision: preserve the low-cost account/lifecycle convenience
that Codex used, with a default three-file <=8KB draft containing ONE authored
business scenario. Never rewrite/expand it on check; derive operation handles
from the existing generated API, without a second large schema facts packet.
The exhaustive operation/role/guard matrix remains opt-in and its stale-fact
coverage refusal remains unchanged. Missing/empty business assertions still
refuse. Coverage is explicitly application-owned, not a global matrix claim.
Run six new candidate sessions on the same fixed draws, retaining the twelve
completed before controls and all six rejected candidate sessions.

Compact source checks: scaf1 Rust integration 14/14 passed. Fresh Muse round 2
and Codex round 4 returned READY from the same restricted snapshot; verbatim
artifacts and provenance are under llp/reviews/. Neither is performance evidence.

Guide checks: the first compact pass was 134/135 because the installed-path
guard did not yet recognize generated proof-draft outputs. Registered exact
application filenames (no directory-prefix exemption); rerun 135/135 passed.
No shipped runtime change was needed for that test correction.

Compact frozen package source: 773f3dfd1f (.48), native SHA-256
f7c878e89bc917ce8d43c365f7ed2f1d2d6e36b84aa5520c261ff0b4d9aefd03.
Packed scaffold consumer passed: compact <=8KB syntax, real-account positive
business assertion and exact refusal, empty/unfilled negatives, unchanged bytes;
full exhaustive positives/negatives and Chromium proof also passed. Full
consumer-only qualification is running on these client/expo bytes. Six compact
whole-session after draws started only after this direct packed control passed.

First compact consumer-only qualification stopped at production-adaptation's
private-output inventory: it recognized only the old exhaustive packet. Added
exact three compact output paths while retaining byte-preservation and repeated
apply assertions. This is a test-only change; frozen replay bytes are unchanged.
The failed attempt remains in /tmp/muse1-evidence/consumer-compact.log; a fresh
complete consumer-only run follows, without claiming partial qualification.

## 6. Compact-default result and explicit fallback

Completed Codex: CPAP 33 calls/1,675,163 input; e-bike 39/2,408,528. Medians
36/2,041,845.5 versus .47's 34.5/2,227,055: input PASS, calls MISS (+4.35%).
Completed Muse: child talent 93/9,630,048, gown 118/12,882,917. Gown took 29.7min
and expanded its small cases file to 16KB; .46 was 83/8,014,586/15.8min.
Remaining two Muse sessions must complete and stay in the record. These results
justify withdrawing the mandatory compact route without waiting to relabel it
a win. Both drafts become explicit choices: --proof-draft (compact, once),
--proof-scaffold (exhaustive). Default remains app-owned assertions plus verify.
No auto-rewiring application package scripts and no same-code reroll. Six new
fallback after sessions reuse fixed draws and twelve completed before controls.
