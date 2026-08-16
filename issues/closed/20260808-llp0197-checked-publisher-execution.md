# LLP 0197 execution: checked publisher + publication-safe evidence boundary

**Status:** Implemented in working tree — uncommitted by sandbox constraint
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 3
**Systems:** Competitive evaluation, Publishing, Documentation
**Date:** 2026-08-08
**Related:** LLP 0197 (governing RFC, Review at r8/r9), LLP 0198 P0
(schema/harness amendments — OWNED BY the 0198 program session, not
this lane; boundary below), benchmarks/records/

Boundary with LLP 0198 P0.0: the machine-record schema and harness
capture amendments land under 0198 P0.0 (its P3 commit 2fef4f397 says
README wiring lands with them). This lane executes only what 0197
uniquely adds: (1) the deterministic checked publisher — records →
tables/charts with schema conformance, evidence-pointer, digest,
aggregation, and disclosure-completeness verification, failing closed
(rule 12, Acceptance 3); (2) the rule-5 publication-safe boundary:
public normalized invocation metadata + opaque evidence IDs, private
store layout, keyed integrity commitments (no plain hashes of
low-entropy values). Built against the current record schema with an
explicit seam for P0.0's added fields. N≥3 calibration runs are 0198
P0.1's and are NOT claimed here.

## Execution log — 2026-08-08

Built the LLP 0197-only slice under `benchmarks/tools/`:

- `validate-records.mjs` and `lib/record-loader.mjs` enumerate every committed
  direct `benchmarks/records/*.json` machine record through Git, validate the
  known current schema dynamically, require explicit nulls for missing metrics,
  recompute fixed rubric and fully measured phase totals, and verify optional
  record digests. The
  two current Markdown comparison records are reported as historical with
  labeled missing machine fields; neither was rewritten.
- `publish.mjs` and `lib/publisher.mjs` implement the deterministic checked
  record-to-Markdown path. They require committed records/evidence in normal
  operation, verify claim overlays and digests, resolve diary/loop/proof/trace
  pointers, check paired repetitions and counterbalanced positions, recompute
  ratio-of-lane-medians plus median paired ratios, retain all raw values, and
  check rule-6/7/9/10 fairness, proof-bar, version, aid, and human-review
  disclosures. N<3, fewer than three successes, a missing/missed success-rate
  floor, unequal proof bars, or excessive success-rate divergence removes the
  ratio and headlines per-lane capability outcomes/success counts.
- `sanitize-trace.mjs` and `lib/sanitizer.mjs` implement the rule-5 boundary.
  Public traces contain only normalized action class, tool name, timing, result
  status, opaque keyed evidence ID, HMAC-SHA-256 commitment, and documented
  redaction codes. Canonical raw invocations (including arguments/transcripts)
  go to a mode-0700 out-of-repo private store as mode-0600 originals keyed by
  evidence ID. The key comes only from
  `SNAPBACK_BENCHMARK_HMAC_KEY_FILE`; in-repo, symlinked, short, or
  group/world-accessible keys/stores fail closed. The sanitizer runs a final
  secret/PII/path/machine-identifier scan and refuses a trace when redaction
  would erase action class, usable tool name, timestamp, result status, or
  evidence identity.
- `README.md` and `PRIVATE_STORE.md` document operation, manifest/overlay
  contracts, keyed commitments, private layout, review handoff, and redaction
  reason codes. `benchmarks/README.md` now routes to the tools.
- `fixtures/` and `checked-publisher.test.mjs` are explicitly synthetic. They
  exercise N=3 generation, missing-evidence refusal, unsafe-redaction refusal,
  N<3 plus missing-success-floor subordination, additive-field tolerance,
  unknown required-claim-field refusal, explicit-null discipline, and digest
  tamper detection. No public benchmark output or page was created.

P0.0 seam contract: this lane did not edit
`benchmarks/schema/run-record.schema.json`, `benchmarks/protocol.md`, any
brief, any harness capture path, or an LLP. The loader reads the current schema
at runtime and tolerates unknown additive record fields. A claim manifest must
explicitly require the two publisher-understood additive fields
`recordDigest` and `publication`; asking a claim to rely on any unknown future
field fails with `UNKNOWN_REQUIRED_CLAIM_FIELD`. Thus LLP 0198 P0.0 may add
capture fields independently without this publisher silently treating them as
claim evidence.

Checks run with Node 24.18.0 where applicable:

- `node --test benchmarks/tools/checked-publisher.test.mjs`: PASS, 8/8.
- `node benchmarks/tools/validate-records.mjs`: PASS; 0 committed JSON machine
  records, 2 historical Markdown records with labeled missing fields.
- `./ref-check --verbose`: PASS; 199 LLP docs, 3,646 refs, 0 errors.
- `node scripts/check-package-test-inventory.mjs`: PASS; 238 declared package
  tests. The new benchmark-local test is outside the package-test inventory's
  enumerated package/test roots, so no registration change is required.
- `git diff --check`: PASS.
- `node scripts/check-inventories.mjs`: FAIL on the pre-existing guide-manifest
  baseline only: missing generated competitive-checkpoint and todo-v2 Contract
  artifacts, plus stale generated symbol-registry/reference projections. It
  reported no package-test, demo, or publication-leaf inventory drift from this
  lane.
- `node scripts/check-guide.mjs`: FAIL on the same pre-existing missing
  generated demo/Contract inputs and stale symbol registry (106 pages / 1,089
  snippets checked; 62 authority-freshness warnings). This lane did not touch
  guide sources or generated guide outputs and did not regenerate unrelated
  artifacts.

What remains: LLP 0198 owns P0.0 schema/harness capture and P0.1's real N≥3
calibration. There are currently no committed JSON machine records, so this
lane intentionally generated no real comparison. A later integration must add
the real claim manifest/generated-output check to the appropriate native/CI
inventory once P0.0 records exist, arrange the repository-disclosure-authority
review evidence, and decide the publication destination. The unrelated guide
generation baseline above remains for its owning lane to repair.

## Resolution — 2026-08-15 (backlog sweep)

The 0197-only slice is committed: `benchmarks/tools/{validate-records,publish,sanitize-trace}.mjs`,
publisher/sanitizer libraries, fixtures, and `checked-publisher.test.mjs`.
The earlier "implemented in working tree — uncommitted by sandbox constraint"
status is obsolete. Remaining N≥3 calibration, real claim manifests, and
publication destination are owned by LLP 0198 / later integration, not this
execution ticket.
