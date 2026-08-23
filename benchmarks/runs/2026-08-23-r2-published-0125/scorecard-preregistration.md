# R2 efficiency scorecard preregistration

This table is fixed before any R2 cell starts. It implements LLP 0186's
2026-08-21 amendment and LLP 0295 §Efficiency scorecard.

## Comparator rules

- A matched pair is the same app × profile × client stack × model/harness ×
  effort. Cross-model and cross-harness token comparisons are forbidden.
- Semantic correction actions are `correction`-tagged actions under the closed
  D0.6 taxonomy, never raw tool calls and never the old record's prose labels.
- The current landed schema cannot carry those action/episode/load fields.
  They may be staged as sidecars, but are ineligible until the coordinated W6
  bump lands and hash-links them from the validated run record; cell 1 is
  blocked meanwhile.
- Output tokens use the native output field directly. Grok is an advisory
  family under the landed meter, so its R2 token value is null and its four
  output comparisons are inapplicable.
- M1 wall ends at the later hash-bound green suite and choreography receipt.
- Any R2 cell missing phase usage or carrying `host-load-contamination` or
  `api-interruption` is scorecard-ineligible but retains product findings.
- A retained 0.1.24 stream that cannot support an episode/class boundary makes
  that cell/measure inapplicable, never estimated. If fewer than six matched
  cells are applicable for a measure, LLP 0186 requires a D0.6-only pre-wave.
- R2 reads medians across applicable matched pairs plus direction consistency.
  It is N=1 calibration evidence; an R3 N≥3 wave with a preregistered paired
  sign test is required for a claim-grade pass.

## Percentage rows by cell

`Output ceiling` is `floor(0.80 × baseline)`. `M1 ceiling` would be
`floor(0.70 × baseline)` once a load-qualified boundary is restored.

| Cell | 0.1.24 correction baseline | 0.1.24 output | R2 output ceiling | 0.1.24 M1 first-green | R2 M1 ceiling | Baseline contamination evidence |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| sol-clique-explicit | annotation absent | 120,825 | 96,660 | 2,408s (LLP 0277 narrative only) | 1,685s | shared-host status; per-cell samples absent |
| sol-clique-familiar | annotation absent | 139,934 | 111,947 | stream absent | inapplicable | shared-host status; per-cell samples absent |
| sol-coterie-explicit | annotation absent | 159,445 | 127,556 | stream absent | inapplicable | shared-host status; per-cell samples absent |
| sol-coterie-familiar | annotation absent | 152,614 | 122,091 | stream absent | inapplicable | shared-host status; per-cell samples absent |
| grok-clique-explicit | annotation absent | 141,020 | inapplicable under advisory meter | stream absent | inapplicable | shared-host status; per-cell samples absent |
| grok-clique-familiar | annotation absent | 188,471 | inapplicable under advisory meter | stream absent | inapplicable | `host-load-contamination` explicitly recorded |
| grok-coterie-explicit | annotation absent | 263,396 | inapplicable under advisory meter | stream absent | inapplicable | shared-host status; per-cell samples absent |
| grok-coterie-familiar | annotation absent | 196,650 | inapplicable under advisory meter | stream absent | inapplicable | shared-host status; per-cell samples absent |
| opus-clique-explicit | annotation absent | 387,583 | 310,066 | stream absent | inapplicable | `host-load-contamination`; `api-interruption` |
| opus-clique-familiar | annotation absent | 430,232 | 344,185 | stream absent | inapplicable | shared-host status; per-cell samples absent |
| opus-coterie-explicit | annotation absent | 365,823 | 292,658 | stream absent | inapplicable | shared-host status; per-cell samples absent |
| opus-coterie-familiar | annotation absent | 333,058 | 266,446 | stream absent | inapplicable | shared-host status; per-cell samples absent |

The correction-action measure is 0/12 applicable and the M1 measure is at
most 1/12 applicable from committed evidence. The required D0.6-only pre-wave
therefore triggers unless the retained raw streams are restored and at least
six matched cells become supportable. The one narrative M1 figure is recorded
for provenance, not treated as sufficient adjudication evidence.

## Registered targets

| Measure | R2 rule |
| --- | --- |
| Semantic correction actions | ≥40% lower median in applicable matched cells, direction-consistent |
| Harness-native output tokens | ≥20% lower median in applicable matched cells, direction-consistent |
| M1 wall to first green | ≥30% lower median in load-qualified applicable matched cells, direction-consistent |
| Snapback/Exact source inspections | zero for Phase 1/W1–W3-covered facts |
| Custom fixed-origin relay/binding implementations | zero |
| Destructive restart/reseed for additive milestone schema | zero |
| Silent auth/query wait requiring an app timeout | zero |
| Closed-path Guide/type/codegen/runtime/client disagreement | zero |
| Choreography retry | at most one per failed assertion; unaffected checks isolated |
| Orientation | one ≤16 KiB deduplicated packet plus selected detail |
| Repeated migration advisories | one grouped advisory per repair class with affected-table count |
| Debug artifact | like-for-like size/link-wall baseline with attribution; no size-only claim |
