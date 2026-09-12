# Clique on Snapback 2 0.0.29 — LLP 1023 diagnostic wave

The wave produced substantial working applications and useful failure evidence,
but does **not** establish a jump in the complete builder experience. Both
builders finished the later poll/migration exercise with green acceptance and
browser receipts. The initial independent grades still expose serious problems
in ordinary UI flows and cold acquisition. These phases measure different
things; a green M7 does not replace the initial grade with a new whole-app grade.

The three LLP 1023 source tracks shipped in 0.0.29, the exact digest follow-up
in 0.0.30, and the independently reproduced read-coverage repair in 0.0.31.
Every actor in **this** wave retained 0.0.29. The parent remains Accepted:
the 80,000-byte objective is unmet and the one-client builder outcome is not
established. See the [program](../../../llp/1023-clique-builder-jump.rfc.md),
[0.0.29 release](../2026-09-12-snapback2-1023-release-0029/README.md) and
[0.0.31 release](../2026-09-12-snapback2-1023-release-0031/README.md).

## What completed

| Phase | Astra cell | Grok cell |
| --- | --- | --- |
| Continuous builder | Astra medium on EPYC; exited 09:24:15 UTC | Grok 4.6 xhigh on Ryzen 5 3600; exited 09:42:17 UTC |
| Initial independent Opus 5 grade | O1 73; O2 55; O3 null; O4 65; O5 band 30 | O1 52; O2 42; O3/O4/O5 null |
| Initial enumerated assertions | 101/119 pass, including M8 results retained outside the schema-limited assertion map | 75/119 pass, including M8 results retained outside the schema-limited assertion map |
| Full scale replay | All 167,157 actions settled; final counts and named invariants verified | Not attempted; adapter conformance incomplete |
| Fresh M7 | Acceptance and browser checks pass; final exit 11:03:42 UTC | Six acceptance checks and both browser checks pass; final exit 11:18:45 UTC |
| M7 limits | M4/M6 omitted from selected regressions after grader changed status files; text-only starter does not exercise populated media/reaction preservation | Two failed browser rounds preceded green; comparison omits timestamps/receipts and retains no post-export; final narrative discloses count-maintenance/tombstone limits |
| Narrative-only assessment | 81/100; inputs exclude the independent grade | 60/100; inputs exclude the independent grade; overall note omits the requested file citation |

O1 measures functional completeness; O2 records defects; O4 concerns offline
behavior; O5 is the scale band. These are the **pre-M7** independent grades.
O3 has no committed holdout input. No weighted objective total is computed.
The narrative assessment describes reported authoring experience and is neither
an objective quality grade nor a causal comparison with the historical 82.
The returned scores are [Astra](narrative-scores/astra/score.json) and
[Grok](narrative-scores/grok/score.json); both completed with zero observed
tool attempts. Astra's returned model identity is not attested. Grok reports
`grok-4.6` but not returned effort, advertises 25 tools despite the empty
requested allowlist, and omits a file citation in its overall note. These
limits remain in the audits; no score was edited or rerun. Narrative
attributions remain interpretations: for example, the
[independent auth assessment](attribution/grok-m3-auth.json) verifies the
two-password-attempt cap but does not establish it caused M3's failure.

## The expensive, structural problems

1. **One app still has to coordinate several kinds of readiness.** Restored
   authentication, held query coverage, current server answers, outbox admission
   and route lifetime are separate obligations. Astra retained an additional
   same-bearer reader for posts/profiles and extended that fallback to polls.
   An isolated real-owner reproduction established one actual SDK defect:
   a complete mixed `{row, count: 0}` answer could become unavailable in the
   durable client at the same sequence because completed public range coverage
   was not consumed for a missing unique Get. The narrowly qualified repair
   shipped in 0.0.31. That fix does not show that a fresh builder now needs
   only one client, nor does it explain every UI failure in either app.

2. **Cold acquisition is still expensive enough to feel broken.** Against a
   retained scale-store copy, Astra's independent grader observed three 30-second
   timeouts. A longer attempt completed at **62,217 ms**, with approximately
   **748 MB of JavaScript heap** at peak. A separate focused pagination check
   confirmed all 100 conversations; the initial suspicion of a 50-conversation
   truncation was withdrawn. Subscription shape, transferred data and SDK processing
   have not been separately profiled in this app. Later acquisition controls
   on main use another fixture and do not prove a repair of this observation.

3. **The storage representation amplifies a moderate logical fixture.** One
   canonical SQLite file occupied **5,196,644,352 bytes**. Generic index
   structures account for **70.020%**, rows and their primary index 15.517%,
   search postings 13.225%, and commit records 0.731%. Source inspection
   establishes four B-trees per ordinary generic index entry, repeated keys
   and addresses, expanded text/ID encoding and additional recipient delivery
   rows. This is server storage, not the client download. The safely removable
   fraction and per-application-table contributions have not been measured;
   unused space inside allocated pages is not a demonstrated vacuum saving.

4. **Bounded execution pushes algorithm design into ordinary features.**
   Cross-chat search required query fan-in and client merging. Exact periodic
   digests must handle expiry, read-state and membership changes across job
   chunks, then make the final emission correct and logically once. This was
   a real capability gap; the qualified 0.0.30 recipe now resolves its scoped
   envelope, so “no correct bounded recipe exists” is obsolete. In fresh M7,
   Astra's optional-column/backfill/required-column sequence worked, but a
   chunk of 100 exceeded multiple budgets and had to become a chunk of one.
   Those are meaningful authoring costs even when the final program works.

5. **Byte funding did not provide useful working room.** The deliberate first
   simplification saved 143 gzip bytes, far short of the 80,000 target. After
   correctness repairs and concurrent integration, further consolidation
   qualified the 0.0.31 runtime at **89,993 / 90,000 bytes**—seven spare.
   A later main-only optimization measured 89,983. An optional adjacent-proof
   optimization was deferred to fit the correctness repair; failed measurements
   are retained. No ceiling was raised. The current bakeoff ruling also freezes
   new runtime-ceiling changes. Small correctness work repeatedly paying this
   integration cost is the concern the funding proposal predicted.

## Serious but localized problems

- **A photo fetch that never retries.** Astra's sender-side web resolver calls
  `assetBlob` once and swallows a transient refusal. Three of six independent
  attempts left a blank bubble; reload recovered all three. Recipients rendered
  in four of four attempts. The missing recovery is established in application
  code; the initial refusal is not independently established as an SDK defect.
- **UI and application semantics diverged from working queries.** Grok's
  Insights screen showed zeros while its API returned correct totals, and it
  had no normal navigation entry. Delete-for-everyone hard-deleted instead of
  rendering a tombstone. Its digest used lifetime totals and hardcoded zero
  unread counts, emitting in quiet periods. These are application failures,
  not evidence that the backend cannot implement the features. Its final M7
  report also admits that the new visible-message count is updated on only
  some paths while settings use the raw row count; tombstone semantics remain
  incomplete despite green authored checks.
- **Small integration mistakes accumulated.** Feed page size changed from
  20 to 40; poll option identifiers initially defeated the browser choreography;
  API documentation omitted result shapes; duplicate-handle creation returned
  an ambiguous committed/null result. M7 eventually repaired its poll path.
- **Some diagnostics prescribed an invalid remedy.** Unsupported comparison
  advice could recommend a mutation-only `require` in read/channel contexts.
  The effect-aware wording repair shipped in 0.0.31 without changing refusal
  or authorization semantics.
- **Tests and the benchmark need ordinary maintenance.** Seeded-item assertions
  assumed page one, some uniqueness/once-open checks were vacuous, and stored
  green receipts could outlive source changes. The report schema accepts only
  M1–M7 assertion keys although M8 is in scope; its count label says 116 where
  the enumerated total is 119. Graders overwrote suite status sidecars before
  M7, which changed Astra's selected regression set. These defects are recorded,
  not silently repaired during a frozen run.

The independent checks that exercised revocation, authorization, expiry,
purge, once-open refusal and asset removal held. That positive evidence is
scoped to the exercised cases; this wave has no Apple-device proof.

## Evidence and limits

The instrument was frozen before launch at commit
`b323d61f60b5d167708ca6ebe6434b1d5a79c899`: instrument 0.3.8-m8,
UI 0.3.3, choreography 0.3.8, fixture 0.2.2. All 185 frozen files were checked
at handoff. The scale log SHA-256 is
`b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.
No repaired package or root diagnosis was supplied to the builders or fresh
M7 actors. Grader changes to files in the app were retained in the M7 handoff,
including the status-sidecar problem above. Scorers receive only the frozen brief and
their own cell's original continuous and fresh-M7 narratives, with missing
files marked explicitly; actual tool attempts are audited after completion.

Each cell is one diagnostic observation. Different hosts and efforts preclude
a matched timing comparison. Caps are prompt-only, authentic controller
wall/token usage joins are unavailable, no holdout set was committed, and the
grader family is uncalibrated. Linux Hermes exports are not Apple execution.
The two M7 sessions are not independent post-M7 full-app regrades. Failed runs,
status-sidecar mutations, missing inputs and corrected grader false negatives
remain part of the record. Large app/CLI archives and databases remain at the
immutable fleet paths in the collection manifests; the compact evidence here
contains no credential or raw reasoning stream.

The compact collections retain exact bytes and original fleet locations:

- Astra: [initial grade](astra/initial-grade/app/grading/grader-report.json),
  [M7 report](astra/final-m7/app/m7/final-report.md),
  [phase completion](astra/supervisor/COMPLETION.json), and
  [collection manifest](astra/collection-manifest.json).
- Grok: [initial grade](grok/initial-grade/reports/grader-report.json),
  [M7 report](grok/m7/reports/final-report.md),
  [migration assessment](grok/migration-preservation-assessment.json),
  [phase completion](grok/completion.json), and
  [evidence manifest](grok/evidence-manifest.json).
- [Storage attribution](storage/assessment.md),
  [Astra score audit](narrative-scores/astra/score-audit.json),
  [Grok score audit](narrative-scores/grok/score-audit.json), and
  [root collection](root-collection.json).

Reference checking passes. The cap check retains one inherited Snapback 1
failure: `snapback-agent-safe-paired.rs` is 1,504 lines, leaving 205 oversize
files against the 204-file baseline. The working set is 58/59 and foundation
12/12. No product source changed for this report; the source tests, failed
measurements, independent code reviews and package qualification remain in
the release records.
