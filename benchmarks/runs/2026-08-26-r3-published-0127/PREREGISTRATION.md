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

The zero-count structural rows are primary. Each eligible scored cell reports:

1. zero Snapback/Exact source inspections for facts covered by LLP 0295 Phase
   1/W1–W3;
2. zero custom fixed-origin relay/binding implementations;
3. zero destructive restart/reseed for additive milestone schema;
4. zero silent auth/query waits requiring an app timeout; and
5. zero advertised-path Guide/type/codegen/runtime/client disagreements on
   paths closed by the vertical fixtures.

A row passes a family/profile/app comparison set only when every eligible
constituent cell is zero. Inapplicable facts are named; missing observations are
not treated as zero.

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

If eligibility leaves fewer than two matched replicate pairs, report the row
as insufficient rather than pooling across family, profile, app, or history.

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
samples, and at least 20 GiB free. Below the disk floor, refuse without consuming
the slot using `R3_ADMISSION_DISK_FLOOR`.

Finalization is same-config only. After a committed record or blocked report
seals a cell, the conductor removes only rebuildable workspace node_modules and
build outputs, never evidence capsules, then repeats the next admission gates.
