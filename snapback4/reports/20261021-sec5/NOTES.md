# Invariant-free SEC5 notes

Initial implementation: `bbd0d25087` and `466a6f800e`. The subsequent precision
repairs are in the shared working tree for the parent integrator to commit.
No runtime admission or proof assumption is introduced. Advice identifies a
factual audience/authority pattern for specification review, not a confirmed
vulnerability.

## Final structural criteria

- Preserve existing whole-rule broad-read advice. Added roster disjunct advice
  requires a heterogeneous global role roster, a competing viewer/resource
  relationship, and explicit column privacy. Conjunctions retain their scope.
- Added pure role-wide row advice requires an actual authored literal enum
  update/upsert and a comparison of that same bound table field, a competing
  resource relationship, and a media/private boundary. A child media table
  referencing the resource qualifies (homes/photos in 033). Synthetic fields,
  role columns, immutable fields, mere enum categories, and insert-only enum
  values do not qualify. Complete creator branches are excluded. One question
  per table retains every candidate role and its complete branch condition.
  Existing SEC4 row-filtered media advice is retained separately.
- Explicit protected-column gates receive grouped questions listing columns and
  admitted pure roles, checked against effective row+column admission. These
  questions also name the actual mutable non-role enum columns; they do not
  infer that every enum is a lifecycle.
- Existing-row self-claim advice excludes immutable principal fields and
  insert-only enrollment. It recognizes narrow vacant/self/global-role gates
  trusted by another raw rule, while scoped approval/invitation evidence
  suppresses the note. Intentional self-claim remains an explicit alternative.
- Caller time follows lexical aliases and helper writes into fields used by
  clock guards or engine expire/not-before boundaries. Fixed-offset affine
  bounds propagate directionally across dominating argument comparisons from
  builtin `now`; unanchored argument cycles establish no bound. OR requires
  shared directional evidence. Optional `arg ?? now` defaults retain bounds.
  Jobs and exact, safely established service-seat-only operations are excluded.
  Caller arguments named periodEnd are not clocks. A one-sided bound does not
  prove the specification's permitted past/future window.

## Qualification

`security_sec5_notes`: 18 passed, including seven read-only wave-20 lanes with
both their own invariants and no invariants. The ignored external pure-notes
census passed over 338 sources in approximately 9 seconds. All 300 frozen source
hashes match the baseline. Four of the 38 supplementary live-wave-21 sources
changed since the original snapshot; both snapshot and current hashes are
recorded. Compilation produced zero diagnostics on all 338 sources. Notes do
not contribute a refusal. Dedicated CLI code-excerpt doctor test passed earlier.
The parent owns the full workspace and client qualification.

Evidence:

- `notes-precision-tests.log`
- `notes-precision-census.log` and `notes-precision-census.json`
- `notes-precision-summary.json` and `notes-precision-new-sites.json`
- `notes-precision-transition-only.json` preserves the earlier loose census
- `doctor-note-codes.log`

| Code | Frozen 300 baseline → final | Live 38 baseline → current |
|---|---:|---:|
| N_BROAD_READ | 353 → 354 | 5 → 5 |
| N_ROLE_WIDE_READ | 10 → 89 | 1 → 34 |
| N_CALLER_TIME | 0 → 57 | 0 → 6 |
| N_SELF_CLAIMED_RELATIONSHIP | 0 → 1 | 0 → 1 |
| N_INVARIANT_RESTATES_RULE | 583 → 621 | 141 → 147 |

The sole added broad-read site is wave-20 048's riders disjunct. The two
self-claim sites are 006 claimChild in waves 20 and 21. The 110 new role-wide
sites are conditional specification questions, not 110 confirmed defects.

## Finding-specific flags

Target-specific notes are unchanged when invariants are removed:

| Wave-20 lane | Relevant final note | Finding-specific flag |
|---|---|---|
| 001 | instruments.read apprentice/all status values | F1 |
| 006 | claimChild → athletes.parent → injuries | F1 |
| 025 | recordResult stoppedAt → suspensionUntil; recordExam → examAt | F2; additional unbounded exam time |
| 033 | homes.read crew/all status values, child photos boundary | F1 |
| 036 | sets.read sharpener/all status values | F1 |
| 048 | riders.read heterogeneous roster-wide disjunct | F1 |
| 050 | protected address/ownerName group admits intake | F1 |

Thus all three calibrated highs and four of the five high-to-medium findings
receive relevant advice without invariants. 001 F2 consent and 006 F2 inferred
diagnosis are not claimed as detected here. These are flags, not replayed catches.

## Precision inspection and remaining limits

Source/spec inspection exposed and removed several concrete regressions:

- Wave-15 026 jumpers.license and 036 requests.kitSize are categories, not
  lifecycle transitions. Wave-15 019 decisions.verdict is insert-only.
- Wave-15 036 coach trades and 044 parent spends have explicitly intended
  broad audiences and no media/private boundary; the new row advice is quiet.
- Single administrator rosters such as wave-15 029 directors and 082 admins
  no longer get added roster-disjunct advice.
- Wave-20 008 endsAt is bounded through startsAt, and wave-16 014 booking ends
  are bounded through their start; the transitive clock analysis is quiet.
- Wave-15 shareReaders/visitors and wave-18/19 users/roster upserts cannot take
  over their immutable principal fields; the self-claim advice is quiet.

Some remaining questions are intentionally answered “yes” by the specification:
wave-20 006's trainer/physician clinical columns and 050's senior report/value
columns are examples. Wave-20 002 frontdesk/owner contact fields, 037 registrar
identity/value fields and 042 coordinator contact fields likewise state
explicitly authorized global audiences. Other row-wide board questions remain
conditional until the product specification supplies exact states. The full
census establishes coverage and zero compilation refusals; it does not establish
zero specification noise, and the report must not claim that it does.
