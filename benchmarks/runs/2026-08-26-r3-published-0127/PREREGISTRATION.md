# R3 scorecard and execution preregistration

Committed before any campaign cell starts. Target: published Snapback 0.1.27;
instrument `social-messenger@0.3.4-m8`; host and harness bytes are bound by
`harness-config.json`. All attempts and failures remain reported; no best-of or
post-hoc configuration substitution is allowed.

## Registered legs and claims

| Leg | Family / effort | Profile | Conditions | N | Cells | Eligibility |
| --- | --- | --- | --- | ---: | ---: | --- |
| A | gpt-5.6-sol / xhigh | full M1–M6+M8 + fresh M7 | Clique/Coterie × Explicit/Familiar | 3 | 12 | scored, family/profile scoped |
| B | claude-opus-5 / harness-default | reduced M1–M3 | same four | 3 | 12 | scored reduced-profile only |
| C | grok-4.6 / xhigh | reduced M1–M3 | same four | 1 | 4 | exploratory, claim-ineligible |

There is no cross-family number, pooled family result, full-journey Claude/Grok
result, or general app-stack claim. Leg C may retain product findings but cannot
enter a scorecard. R2 and the 2026-08-25 capstone are context annotations only.

## Counterbalancing and exact serial order

The base condition order is Clique/Explicit, Coterie/Explicit,
Clique/Familiar, Coterie/Familiar. Replicate 2 rotates left once; replicate 3
rotates left twice. Filtering the global order by Leg A or B yields those exact
three rotations. Every position count differs by at most one as required for
N=3 over four conditions. Leg C uses the replicate-1 order. The global order is
strict; only one cell may hold the host lock.

| # | Cell | Leg | Scope |
| ---: | --- | --- | --- |
| 1 | sol-clique-explicit-1 | A | full |
| 2 | opus-clique-explicit-1 | B | reduced |
| 3 | grok-clique-explicit-1 | C | reduced exploratory |
| 4 | sol-coterie-explicit-1 | A | full |
| 5 | opus-coterie-explicit-1 | B | reduced |
| 6 | grok-coterie-explicit-1 | C | reduced exploratory |
| 7 | sol-clique-familiar-1 | A | full |
| 8 | opus-clique-familiar-1 | B | reduced |
| 9 | grok-clique-familiar-1 | C | reduced exploratory |
| 10 | sol-coterie-familiar-1 | A | full |
| 11 | opus-coterie-familiar-1 | B | reduced |
| 12 | grok-coterie-familiar-1 | C | reduced exploratory |
| 13 | sol-coterie-explicit-2 | A | full |
| 14 | opus-coterie-explicit-2 | B | reduced |
| 15 | sol-clique-familiar-2 | A | full |
| 16 | opus-clique-familiar-2 | B | reduced |
| 17 | sol-coterie-familiar-2 | A | full |
| 18 | opus-coterie-familiar-2 | B | reduced |
| 19 | sol-clique-explicit-2 | A | full |
| 20 | opus-clique-explicit-2 | B | reduced |
| 21 | sol-clique-familiar-3 | A | full |
| 22 | opus-clique-familiar-3 | B | reduced |
| 23 | sol-coterie-familiar-3 | A | full |
| 24 | opus-coterie-familiar-3 | B | reduced |
| 25 | sol-clique-explicit-3 | A | full |
| 26 | opus-clique-explicit-3 | B | reduced |
| 27 | sol-coterie-explicit-3 | A | full |
| 28 | opus-coterie-explicit-3 | B | reduced |

Main port blocks are sequential non-overlapping 60-port ranges from
57000–58679 in this order. The 12 Leg A fresh-M7 blocks are sequential
non-overlapping 60-port ranges from 59000–59719. `allCampaignPorts()` must equal
the union of every main block and every present M7 block: 2,400 unique ports.

## Scorecard

The zero-count structural targets remain primary, but this wave computes a row
only from a registered typed signal scoped to that exact target. Silence,
free-text correction summaries, and broader counters cannot establish zero or
failure. The frozen instrument dispositions are:

1. **covered-fact source inspections — `instrument-incomplete`:** the registered
   `source-inspection` action class does not classify whether the inspected fact
   was covered by LLP 0295 Phase 1/W1–W3. Raw source-inspection counts therefore
   neither pass nor fail this row;
2. **custom fixed-origin relay/binding implementations —
   `instrument-incomplete`:** no registered typed action or advisory identifies
   this scoped implementation;
3. **destructive restart/reseed for additive milestone schema —
   `instrument-incomplete`:** lifecycle counters are typed but scope-blind to
   the additive-schema cause;
4. **silent auth/query waits requiring an app timeout —
   `instrument-incomplete`:** no registered typed action or advisory identifies
   this condition; and
5. **advertised-path Guide/type/codegen/runtime/client disagreements —
   `instrument-incomplete`:** no registered typed action or advisory identifies
   a vertical-path disagreement.

An empty `correctionLoops` array is instrument silence for these rows, not a
zero observation. The wave emits status exactly `instrument-incomplete` for all
five and does not publish constituents synthesized from unrelated evidence.

The four remaining LLP 0186 commissioned rows are frozen as follows:

6. **bounded orientation packet — `computed`:** the typed, hash-bound
   `firstProductEdit.orientationBytes` carrier supports this row. Every successful eligible cell
   must retain a first-edit orientation packet of at most 16 KiB. Publish every
   constituent, median, range, and N. Missing evidence is never zero;
7. **choreography retry ceiling:** measurable from the hash-bound controller and
   choreography streams. Per successful eligible cell, derive retry counts by
   failed assertion identity; require at most one retry for each failed
   assertion and zero retries for unaffected assertion identities. Publish
   every constituent, maximum, median, range, and N;
8. **grouped migration advisories — `instrument-incomplete` for this wave:**
   no producer in this instrument emits the registered typed carrier. The only
   registered advisory record is a top-level native-stream record whose `event`
   equals `migration-advisory`; advisories are read only from its
   `migrationAdvisories[]` path. Sessions without such a record remain
   `instrument-incomplete` and never pass as a zero count. A cell becomes
   computable only when its retained native stream contains an explicit typed
   carrier, including an explicit record with an empty `migrationAdvisories`
   list. Nested tool payloads and arbitrary objects with similarly named fields
   are not advisory records. When computed, group advisories by normalized
   repair class; require exactly one advisory per class with its exact
   affected-table count. Publish every class/count constituent, median class
   count, range, and N; and
9. **debug-artifact attribution:** the sole excluded row. This published-npm
   wave builds no debug binary, so debug artifact size/link attribution belongs
   to a source-build wave and cannot be inferred here.

Rows 10–12 are the registered semantic-correction, output-token, and M1
wall-to-first-green contrasts below. These twelve rows, their aggregations, and
the sole explicit exclusion are also frozen machine-readably in
`harness-config.json`.

An `instrument-incomplete` structural row cannot pass or fail a
family/profile/app comparison set. Any future computed structural row requires
a preregistered scoped typed classifier and passes only when every eligible
constituent cell is zero. Inapplicable facts are named; missing observations
are not treated as zero.

The registered effect-size bars are 40% for semantic correction actions, 20%
for output tokens, and 30% for M1 wall to first green. Because historical runs
are not comparators, these are minimum-magnitude descriptive bars on the two
internal contrasts, not before/after improvement claims:

- profile contrast: Explicit minus Familiar, paired within family × app ×
  replicate;
- app contrast: Clique minus Coterie, paired within family × profile ×
  replicate.

The sign is always reported (positive means the second named arm is lower); no
direction is presumed favorable. For each metric and contrast, publish arm
medians, the median paired percentage difference, range, every constituent,
and counts. Percentage difference is `(first - second) / first`; a zero first
value yields an absolute-only row, never an invented percentage.

## Variance guard

For each family/profile-scoped contrast independently:

1. form exact same-replicate pairs after eligibility filtering;
2. report matched-arm medians and paired percentage differences;
3. require all non-tied paired differences to have the same direction before
   labeling a direction consistent;
4. run an exact two-sided paired sign test over non-tied replicate differences,
   with ties reported and omitted from the binomial denominator; and
5. report the exact p-value and N without converting N=3 into a significance or
   variance claim. No conventional alpha cutoff is preregistered; the test is a
   guard and disclosure, not a license to overstate the small sample.

## Successful-completion floor

`SUCCESSFUL` means the checked validator accepts the complete record and every
milestone registered for that leg profile is green: M1–M6+M8 and fresh M7 for
Leg A, and M1–M3 for Legs B/C. A scored contrast requires at least three such
validator-clean successful replicates on **each** side. If either side has
fewer than three, publish **“insufficient successful replicates”** and do not
compute that contrast at reduced N or pool across family, profile, app, or
history.

A fully metered failed replicate remains in attempt and failure-rate reporting.
It never enters token, correction-action, or wall-to-green ratios. The paired
sign-test guard is applied only after the N>=3 successful-per-side floor holds.

[`compose-scorecard.mjs`](./compose-scorecard.mjs), with the SHA-256 registered
at `config.scoring.composer`, is the only sanctioned scorecard path. It consumes
`config.scoring`, validates every supplied record before producing any output,
derives `SUCCESSFUL` from the run-record milestone verdicts registered for that
cell's leg profile, and mechanically enforces the N>=3 floor independently for
both ratio sides. A validation failure refuses the entire composition. A failed
but validator-clean replicate is excluded from ratios and retained in the
failure-rate denominator.

## Eligibility and retention

A cell is scorecard-ineligible if any required phase metering is missing, any
loadavg-1/5/15 sample exceeds the inclusive 10.00 ceiling, or any provider/API
interruption occurs. A Leg A row additionally requires the fresh M7 session's
native metering. Ineligible cells retain product findings and failure evidence;
they are not silently excluded from outcome reporting.

## Admission, finalization, and disk

Admission requires a pristine slot, exact committed config/source/instrument
bytes, registered host/harness identity and auth, clean loader environment,
exclusive host lock, all 2,400 campaign ports unbound, three passing load
samples, and at least 20 GiB free. Admission re-measures free bytes after the
load samples, immediately before issuance. Below the disk floor at either
measurement, refuse without consuming the slot using
`R3_ADMISSION_DISK_FLOOR`.

Finalization is same-config only. After a committed record or blocked report
seals a cell, the conductor removes only rebuildable workspace node_modules and
build outputs, never evidence capsules, then repeats the next admission gates.

## Budgets and conductor stop

The controller enforces one 14,400-second (four-hour) wall cap for the complete
cell. Expiry aborts every subsequent stage transition, terminates the native
process group, and holds custody while the operation settles for the registered
bounded grace. Failure to settle fails the whole cell closed; launch/write logic
cannot resume after timeout. The retained disposition is
`R3_CELL_WALL_CAP_TIMEOUT` with capability-failure / `wall-cap` classification.
If the operation remains unsettled after grace, the controller additionally
retains `R3_CELL_WALL_CAP_CUSTODY_POISONED`, poisons every subsequent cell
mutation, and keeps the exclusive lock held for manual recovery.

Token caps use LLP 0201's cap-family formula: twice the largest
validator-clean green pilot fresh-input-plus-output count for the same cap
family and milestone. If any registered condition lacks such a figure, use
LLP 0201's 2,000,000-token safety figure as the pilot figure, hence a 4,000,000
cap. R2 lacks complete trusted per-condition figures, so Leg A M1–M6+M8 and
Leg B M1–M3 use 4,000,000. The capstone fresh-M7 session recorded
273,343 fresh input plus 58,355 output = 331,698, doubled to 663,396. Leg C is
null/advisory because its registered adapter cannot report native tokens. The
Codex and Claude caps are enforced from their registered native usage streams;
cap exhaustion terminates the process group before another turn.

Before admitting a cell, admission reads committed records and blocked reports
for previously executed slots in the preregistered order. If the two
immediately preceding executed cells in the requested cell's leg both failed
with the same retained `rootCauseClass`, admission refuses non-consumingly with
`R3_CONDUCTOR_REVIEW_REQUIRED`. A successful same-leg cell resets the sequence.
The conductor may resume only after orchestrator review. The orchestrator
commits `reviews/pause-<n>.ack.json`, naming the exact two failure-disposition
SHA-256 identities, the one next cell admitted, and a rationale. Admission
validates those committed bytes and consumes the receipt only for that named
next cell; a missing or mismatched hash still refuses non-consumingly. The rule
does not silently skip, reorder, or consume a different cell.
