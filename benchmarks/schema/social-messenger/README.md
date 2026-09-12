# social-messenger scoring manifests and record schema

**Provenance:** LLP 0201 P1/P2 (D2/D3/D4), per
`benchmarks/tools/social-messenger/CONTRACT.md`; authority:
`benchmarks/briefs/social-messenger.md` and
`llp/0201-social-messenger-canonical-benchmark.plan.md`. **Version:**
`VERSION` (`0.3.0-m8` — DRAFT until the P3 freeze; M8 added by
LLP 0201's 2026-08-11 dated amendment).

`VERSION` names the compatible schema vocabulary, not the byte identity of
every additive draft revision. Exact schema identity is the SHA-256 recorded
for `runRecordSchema` and `runRecordExtensionSchema` in the frozen
`instrument.manifest.json`; lane setup verifies those digests before use.

- `assertions.json` — assertion-ID manifest: 51 checklist items
  (M1:7 M2:8 M3:7 M4:5 M5:5 M6:6 M7:5 M8:8) split into 116 atomic
  assertions with stable IDs and one executor class each.
  M6 and M8 simulator assertions are marked `greenRequired:false`: they remain
  separately recorded native/O4 evidence and do not gate web authoring green.
- `applicability.json` — the 16 rubric dimensions (45/55 weight
  split), observing milestones, applicability predicates,
  complete-lane enumeration, usable-grading-record gate.
- `run-record-extension.schema.json` — the social-messenger extension
  over `benchmarks/schema/run-record.schema.json` (per-milestone
  phases/statuses/charging, execution-ordered terminal boundaries,
  harness-native fresh/cache/output/reasoning
  counters, hash-bound session/receipt/clock provenance, the first-product-edit
  orientation snapshot, separate clocks, compaction, replay and probe results
  with O5 band inputs, grading pointers). Its optional additive `orientation`
  block carries the explicit lane kind, verified frozen-instrument identity,
  selected skill set, full steering-carrier inventory, bounded deduplicated
  byte accounting, and retained preflight warnings. The required sibling
  `firstProductEdit` field uses the metering joiner's exact
  `{at, orientationBytes, orientationTokens, selectedSkills}` shape. All five
  native counters remain present even when their values are null; those
  cumulative orientation tokens are not M1 authoring.
  Current R2 provenance additionally binds `recordBase`; semantic validation
  replays the complete native join and deterministic record composition rather
  than accepting self-consistent quantitative fields. Optional native
  cache/reasoning orientation counters may remain null without invalidating
  otherwise measured input/output-and-byte evidence.
  Additive D0.6 fields on each milestone retain hash-linked
  semantic-action and failure-to-recovery streams, restart/reseed counts,
  suite/choreography assertion attempts and wait wall, host-load samples, and
  API-interruption windows. The sibling optional `suiteStatusLinkage` block
  retains the startup-validated input and suite receipts. They remain optional
  in the version-2 JSON shape for old-record compatibility, while the semantic
  validator requires `instrumentVersion: "social-messenger@0.3.7-m8"`,
  `typingObservationBoundaryVersion: "v2"`, the
  exact matching orientation pin/protocol, all six as
  claimed-or-explicitly-non-claimed, and suite linkage for the current
  instrument. Browser-wait evidence is independently scoped to `suite` and
  `choreography`; complete coverage requires both. Current receipt JSONL is
  validated record-by-record against `receipts.schema.json`, while failed or
  aborted attempts may honestly end before a choreography segment summary is
  produced. `instrumentVersion` is unconditional for every plan record: a
  current protocol marker, current orientation pin, or current choreography
  version implies `social-messenger@0.3.7-m8` in both the schema and semantic
  validator. Coordinated deletion/downgrade cannot select a legacy validator,
  and substituting explicit `0.3.2-m8` or `0.3.3-m8` on an otherwise-current
  record is invalid. Historical `0.3.2-m8` records remain valid only with that
  explicit legacy marker set; retained `0.3.3-m8` records remain boundary-v1,
  and retained `0.3.4-m8` records remain bound to their own identity. Neither
  can aggregate with current records.
  The extension stays at version
  `2`, so retained records are never rewritten.
- `run-record.schema.json` — the complete composed record schema. It restricts
  `tokens.source` by `capFamily`; requires native lane totals and attempted
  milestone phases; and requires advisory or explicitly unavailable metering
  to use a stable reason plus null totals, phases, first-edit tokens, milestone
  token caps/counts, and charges without `capped-tokens`. The publication
  loader composes it with `benchmarks/tools/social-messenger/record-validator.mjs`
  to enforce D2 charging equalities and D0.6 aggregate/linkage equalities that
  JSON Schema cannot express.

The grader-side half of the instrument (frozen prompt, report schema,
calibration plan, probe machinery) lives in
`benchmarks/tools/social-messenger/grader/` — its README ties the two
directories together.

## Ambiguity log (P1 authoring decisions to confirm at P3)

Places where the brief under-determines a classification; each was
resolved explicitly here rather than silently:

1. **App-restart assertions (m1-a05, m1-a06):** the brief defines
   `[choreo]` as "two-client and simulator behavior"; kill/relaunch is
   single-client lifecycle behavior. Classified `choreo` (the harness
   choreography drives client lifecycle), not suite.
2. **M5 item 1's client-purge clauses (m5-a02, m5-a03):** the item is
   tagged `[grader]`, but purge-on-reconnect is client behavior; kept
   `grader` per the tag, verified by the grader via web automation.
3. **M6 item 6 (m6-a13):** "harness-validated" conformance check yet
   "inside M6's coverage manifest"; classified `suite-required` with a
   harness-validated receipt noted.
4. **m3-a11 (tap quoted excerpt jumps):** single-client UI
   interaction; classified `suite-required`, not choreo.
5. **m3-a13 (removed member keeps local history):** client-local
   observation on the removed member's client; classified `choreo`.
6. **Status naming:** the brief's `blocked-by-M{n}` is rendered as
   status `blocked` plus a `blockedBy` set in the record schema (the
   lowest member is the headline `n`), per the extension's task shape.
7. **Termination reason:** the brief pins the field but not a value
   enumeration; the schema takes a free string with suggested values.
