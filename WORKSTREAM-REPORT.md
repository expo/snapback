# MUSE1 workstream report

Worktree `/home/ccheever/projects/sb4-b34-lat1`; branch `sb4-b37-muse1`.
Started clean at d6f0253bfa with the pre-existing readauth census fix retained.
Main merged through 085cb67d7d; final fetch found no newer main.
No push or version bump. Mac and the complete battery were excluded as requested.

**Result: Muse's requested input/call bars PASS; Codex's bars MISS. The overall
performance goal is not fully met.** The final source implements the authorized
opt-in fallback, keeps both helper choices and retains verify unchanged. Packed
Linux consumers passed. Final affected check status is recorded in §5.

## 1. Diagnosis recorded before product edits

Sources: all 40 exact-draw wave34r1 and wave34r2 archived builder sessions,
paired by idea/model/frontend. Reused wave34r1-repro/tx/parse.py (including
Codex's issuing-call index fix), agg.py, calls.py and docs.py; wall.py supplied
the timing interpretation. Local per-call output is under
`/tmp/muse1-analysis/`; sanitized durable evidence is under snapback4/reports/20261028-muse1/.
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
The subsequent experiments and their missed bars are reported below;
source-byte savings alone are not a performance result.

## 2. Final implementation and decisions

- Ordinary green `check` creates neither proof packet. Start/workflow/init/README
  make both helpers optional; application assertions plus `npm run verify` remain
  the default. TOK5/GEN1 and `bind/security/**` were not modified by this lane.
- `check --proof-draft` explicitly creates three files totaling <=8KB with one
  business scenario, shared real-account/lifecycle/upload/clock helpers and an
  acceptance runner. It is created once and never rewritten, even on repeated
  requests. Existing files/directories/symlinks remain author-owned; delete its
  directory to request a fresh draft. No exhaustive operation/role expansion.
- `check --proof-scaffold` explicitly creates/refreshes the exhaustive packet.
  Ordinary checks still refresh existing matrix facts/manifest only; code never
  expands or reappears without a request. Stale facts and missing coverage refuse.
- The flags are mutually exclusive and reject audit, Lean and saved-release modes
  before work. Missing, empty and refusal-only compact suites refuse before deploy;
  success requires a business assertion and reports application-owned coverage.
- `verify` is unchanged: ordered first-red stopping, bounded output (three summary
  lines plus up to six diagnostic lines), private full log and process cleanup.
  No incremental cache, skipped-proof claim or automatic application-script rewiring.

Three changed-code candidates were measured. Opt-in-only exhaustive scaffolding
was insufficient; a compact default retained convenience but still invited work
(the gown builder expanded cases to 16KB). That default was withdrawn. The final
fallback keeps the compact option without making it a required path. Every
unfavorable session is retained; no unchanged-code reroll replaced a failed draw.

| Candidate | Product commit / frozen source | Muse median calls / input | Codex median calls / input |
|---|---|---:|---:|
| Full matrix opt-in, no compact helper | 8c78f21bdb; frozen 8f60156e9d | 118.5 / 13.176M | 40.5 / 2.719M |
| Compact default, matrix opt-in | 8817e6693e; frozen 773f3dfd1f | 106.5 / 11.504M | 36 / 2.042M |
| Both explicit choices (final) | de211888be + 5f29c81549; qualified fc71b6edcc | 83 / 8.114M | 46 / 2.879M |

The initial decomposition was committed before product edits as 9ec7a73c10.
Main integration commits are f9782b3243 (Integration 32/.48) and 085cb67d7d
(fixture/test pin corrections). The latter changed no runtime/scaffold/guide input;
repacking produced identical client, Expo and platform bytes. Review/evidence
commits retain the intervening corrections and negative outcomes.

## 3. Whole-session remeasurement

Four Muse selections were fixed from the largest archived input regressions:
019 child talent (Expo), 032 gown (React), 026 wildlife (React), 035 real-estate
photos (Expo). Codex controls: 001 CPAP and 014 e-bike (both Expo). Each ran once
on .46, .47 and each of the three changed candidates: **30 full sessions**.
The same twelve before controls are reused for the later experiments.

All began with only the exact rendered harness BRIEF in an empty directory and
no installed package, using the harness builder CLIs/flags. Only paths, isolated
ports and pinned package versions changed. Sessions ran to terminal response;
all exited 0 and wrote REPORT.md. No in-session feedback or early stopping.
Original parser and provider input/call totals agree exactly for all 30; no missing
sessions. All native/client lock pins were verified before deleting copies; full
381-file client comparison was added after the first four captures and covers all
six final draws. All replay copies have been deleted.

.46/.47 package/native pins match the wave source references 67740e5975 and
11fb847329. Final candidate is unpublished .48 with Integration 32's TOK5/GEN1;
its effects are not isolated from those upstream changes. Final native SHA-256:
`4b4767de85072da0aeaa866a5d857b8fbf6da9218049dc2838f3cc366b7d309b`.
The platform tarball exactly matches consumer qualification. Baseline/final
manifests, scripts, [all results](snapback4/reports/20261028-muse1/RESULTS.md)
and [exact counts](snapback4/reports/20261028-muse1/replays-final.json) are retained.

| Model | Version | Median calls | Median input | Median uncached | Median wall min |
|---|---|---:|---:|---:|---:|
| muse | .46 | 96 | 8,993,342 | 143,121 | 16.31 |
| muse | .47 | 117.5 | 16,457,696 | 260,868 | 23.43 |
| muse | final .48 | 83 | 8,114,108 | 179,086 | 16.69 |
| codex | .46 | 41.5 | 2,397,016 | 62,104 | 11.51 |
| codex | .47 | 34.5 | 2,227,055 | 139,119 | 10.74 |
| codex | final .48 | 46 | 2,878,928 | 75,920 | 10.53 |

Muse versus .46: absolute median calls **−13.54%**, input **−9.78%**; PASS/PASS.
Median paired ratios also pass: calls 0.8680, input 0.9031. Three of four ideas
improve on calls/input; gown regresses. Median wall is 16.69 versus 16.31min;
uncached input is higher than .46. Do not describe this as a measured wall win.

Codex versus .47: calls **+33.33%**, input **+29.27%**; MISS/MISS. Paired medians
also miss: 1.3298/1.3257. Median wall is 10.53 versus 10.74min and uncached input
is lower, but neither substitutes for the requested total-input/call bars.

Small samples, shared provider windows and stochastic authoring limit causal
claims (including wall/κ). The results are exploratory across three changed
candidates, not an independent population-wide confirmation. No performance claim
follows merely from source size, source reviews or package correctness.

## 4. Remaining gap and follow-up

The final Codex CPAP session made five fixture-based test runs and six related
poll tools, with three E_SECURITY_NOTES refusals; .47's CPAP control had no such
fixture-test tools. This is a concrete extra loop, not proof that all twenty
extra model calls have one cause or that the security diagnostic is wrong.
Both final Codex builders declined the optional helpers. Availability did not
preserve their measured gains. No security gate was weakened to improve counts.

Follow-up: [Codex bars and fixture/security-note loops](issues/20261029-sb4-muse1-codex-bars-and-fixture-proof-loops.md).
Investigate authoring/proof routing and diagnostic repair guidance; coordinate any
`bind/security/**` change with its owner. Do not claim Codex non-regression or an
overall bakeoff win from this branch. This is the material deferral.

## 5. Verification, reviews and limits

- Final scaffold CLI integration: **14/14 passed**; guide: **135/135 passed**.
- Direct installed tarball controls passed for no default packet, explicit compact
  creation, <=8KB/syntax/custody, real-account business/refusal assertions,
  empty/unfilled negatives, full matrix uploads/deadline/approval coverage,
  stale-fact/missing-role negatives and Chromium writes.
- Fresh restricted-snapshot Muse round 3 and Codex round 5 both returned READY
  for the final source/amendment. Verbatim artifacts/provenance are under
  llp/reviews/3000.037.000-muse1-*. Earlier NOT READY/corrected rounds remain;
  one earlier contaminated Codex round was not counted as independent readiness.
- Final `qualify-linux.mjs --consumer-only` **passed**, source fc71b6edcc, unchanged
  checkout. Includes packed starters, proof kit, frontend, staging, migrations,
  production, client recipes and Linux/proot consumers. ELF passed; native and
  platform tarball bytes match the final replays. Full receipt and summary are
  consumer-optin.json.gz / consumer-optin-summary.json in the evidence directory.
  Suite is deliberately `not-run`; `publicationQualified:false`. No publication.
- Initial affected run: all 16 commands exited 0, but its input-stability guard
  refused because provenance commits landed during it. No final-pass claim from it.
  Final scoped affected run: **PENDING_FINAL_AFFECTED**.
- Two compact consumer attempts are retained: the first exposed the exact output
  inventory correction; the second completed proofs but source changes prevented
  a receipt. Final qualification ran frozen and passed. These failed attempts are
  not recast as qualifications.

The full selector plan expands the shared CLI table/root report to the complete
battery expressly excluded by the brief. Its plan is retained. The scoped runner
uses planAffected/runPlan for CLI, guide and five proof/client test files plus all
mandatory root guide/inventory/generated/diagnostic/docs/ref checks; only unrelated
W8B residency calibration is skipped. No language/planner/store semantic change,
full multi-crate/client pool, difftest, Mac qualification or full scripts/test.sh.
Long jobs used user systemd scopes with MemoryMax=40G/OOMPolicy=continue, at most
four expensive workers, no Cargo incremental/debug payloads. Large completed
consumer/replay applications were removed; frozen packs and sanitized audit data
remain privately under /tmp/muse1-evidence/.
