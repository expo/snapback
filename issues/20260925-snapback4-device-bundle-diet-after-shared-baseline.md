# snapback4: device bundle diet after the shared-baseline landing (+52 KB gzip)

**Status:** Open · **Filed:** 2026-09-25 · **Systems:** snapback4 device (wasm), `snapback4/metrics/wasm-budget.json` · **Source:** LLP 3000.015 landing (branch `sb5/land`)

## What

Landing `written by` / `readable by audience`, `sequence by` and the row-keyed maintained view (LLP 3000.015 §1–§3) measured the device artifact at **549,038 B gzip** against about **495,000 B** on `main` the same day: roughly **+52 KB (+11%)** for the three additions plus their sixteen landing fixes, the largest single step since the September 18 device diet set this artifact's ratchet at 410,000. The ratchet was raised to 550,038 (measured + 1,000) so the landing could proceed under the author's 2026-09-25 ruling ("authoring absolutely top notch and performance excellent"); the size itself is the open debt.

## Where the bytes are, per the lane records

Whole-artifact measurements only; no lane attributed components independently. Candidates named by the eight review rounds and the integration: the accounting law's typed disclosure (`value/disclosed.rs`, `authorized_point.rs`, `authorized_scan.rs`, the `GuardedRows` token), the complete-rule expiry evaluator (`rules.rs`, `read_auth.rs`, now shared by three features), generated-matrix support code that may have leaked into non-test builds, and server-only paths that the web build may still compile (live-basis recount scheduling, adoption rebuilds, Postgres seeks were claimed server-only; verify with a `--target wasm32` symbol map).

## Done when

A measured attribution (twiggy or the build-stage delta method the lanes used) names the top five contributors, and the ratchet moves back below 520,000 without changing any runtime ceiling or the three features' contracts. The final landing review's item (e) names what its reviewer saw as avoidable; start there.

## Final landing review candidates (2026-09-25)

Astra named three avoidable contributions, without attributing individual byte
counts:

- **Server work-schema construction during device preparation.** Device
  initialization calls contribution-index preparation, which reaches
  `maintain/row_key.rs:102` (`prepare_row_views`) and constructs `$recount`
  and `$basis` tables. Those names occur in the wasm artifact. Separate device
  index preparation from server work-table construction.
- **Duplicated predicate evaluation.** `RowKey::matches` duplicates the ordinary
  `Predicate::matches` boolean/comparison walker. Sharing evaluation with
  different operand resolution is a plausible reduction.
- **Server branches retained behind runtime device checks.** Shared row-view
  code contains `if !self.device` maintenance paths worth separating at
  compilation boundaries.

Grok identified a fourth: the two-seek lifetime path is server-only, so the
web device retains the fallback decode loop in `engine/witness.rs` alongside
`probe_witness_uncached`. Check whether those two similar loops can share code.
These are optimization candidates, not measured explanations for the whole
artifact increase; neither reviewer found tests or parser/binder code in wasm.
