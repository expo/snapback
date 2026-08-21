# Checked benchmark publication tools

These tools implement LLP 0197's record-to-publication boundary. They do not
publish a site or authorize a benchmark claim.

## Commands

Run repository scripts under the pinned Node version when the ambient Node 25
runtime is unstable:

```sh
volta run --node 24.18.0 node benchmarks/tools/validate-records.mjs
volta run --node 24.18.0 node benchmarks/tools/publish.mjs \
  --manifest path/to/claim-manifest.json \
  --output path/to/generated-comparison.md
volta run --node 24.18.0 node benchmarks/tools/publish.mjs \
  --manifest path/to/claim-manifest.json \
  --output path/to/generated-comparison.md \
  --check
```

`validate-records.mjs` asks Git for every committed
`benchmarks/records/*.json`, parses every one, and validates the known current
shape. Existing Markdown-only records are reported as historical with their
missing machine fields; committed JSON records that predate required current
metrics are likewise labeled with the missing paths. They are not converted or
silently upgraded, and a claim manifest cannot select them.

`publish.mjs` accepts only a committed manifest, committed machine records,
and committed evidence. It validates every committed machine record before it
selects the manifest's comparison set. The generated Markdown starts with a
do-not-edit marker. `--check` is the CI form: it recomputes the complete output
and fails if the checked-in rendering differs.

### Lane setup and routing preflight

Create every private lane directory before its agent starts, then generate its
bounded first-read files against the already-provisioned read-only instrument:

```sh
node benchmarks/tools/lane-setup.mjs setup \
  --lane-dir /path/to/run/lanes/sol-high-clique-explicit-r01 \
  --lane-id sol-high-clique-explicit-r01 \
  --instrument-root /path/to/run/instrument \
  --profile snapback-explicit-v1 \
  --backend-pin '@expo/snapback-*@0.1.24' \
  --instrument-pin social-messenger@0.3.2-m8 \
  --skill snapback-authoring
```

The command writes `AGENTS.md`, one `BENCHMARK-ORIENTATION.md`, and
`lane-report.json` at the lane's initial directory. Rerunning the same input is
deterministic; it refuses to overwrite a non-matching generated file. The two
steering documents are measured as delivered UTF-8 bytes and refused above
LLP 0259's 16 KiB ceiling. `lane-report.json` records that byte accounting and
the selected skill set before its `firstProductEdit` snapshot is joined.

Immediately before the driver's first product edit, stamp the metering marker
from that report (the driver supplies its own event timestamp):

```sh
node benchmarks/tools/lane-setup.mjs mark-first-edit \
  --lane-report /path/to/lane/lane-report.json \
  --at 2026-08-21T12:34:56.000Z
```

This writes `first-product-edit.json` in the lane with the metering joiner's
exact input shape: `{at, orientationBytes, selectedSkills}`. Pass it to the
meter's `--first-product-edit` option; its output replaces the report's seeded
top-level `firstProductEdit` object with the cumulative native token snapshot.

At the M1 preflight boundary, inspect the retained harness JSONL:

```sh
node benchmarks/tools/lane-setup.mjs preflight \
  --lane-dir /path/to/run/lanes/sol-high-clique-explicit-r01 \
  --events /path/to/run/logs/sol-high-clique-explicit-r01.jsonl
```

The detector recognizes normalized `skill.loaded` events and skill-file reads
in Codex-style command events. It warns, without relabeling the application
result, when a physical-device/EAS-delivery or generic Expo/Tuft scaffold skill
was loaded before the first product edit. Reporting-file edits do not close the
orientation boundary.

## Additive P0.0 seam

The loader reads `benchmarks/schema/run-record.schema.json` at runtime and
validates all fields the current schema knows. Unknown additive fields are
tolerated so LLP 0198 P0.0 can extend capture without making this lane the
schema owner. Missing known metrics are not tolerated: fields must be present,
using explicit `null` wherever the current schema permits an unmeasured value.

A publication claim adds, without changing the current schema, these two
recognized fields:

- `recordDigest`: `sha256:` plus the SHA-256 of canonical JSON after removing
  `recordDigest` itself (object keys recursively sorted, array order preserved,
  compact JSON, one trailing newline);
- `publication`: `comparisonSet`, positive `repetition`, unique `attemptId`,
  serial `position`, `resultStatus` (`success` or `capability-failure`), one or
  more `proofEvidence` pointers, and a `sanitizedTrace` pointer.

The claim manifest must set
`requiredClaimFields: ["recordDigest", "publication"]`. The loader tolerates
other additive P0.0 fields, but the publisher fails with
`UNKNOWN_REQUIRED_CLAIM_FIELD` if a manifest asks it to rely on a field it
does not understand. This is the tolerant-but-fail-closed seam: capture may
grow independently; claim authority may not.

The manifest also preregisters the two lane configurations, expected attempt
count, minimum successful observations (fixed at 3), minimum success rate, and
maximum allowed success-rate difference. It carries the proof-bar, fairness,
aid/starter, exact version, and human disclosure-review statements. These
fields can contain disclosure prose and pointers, never displayed arithmetic.
All numbers, medians, ranges, success counts, ratio-of-medians, and paired
ratios come from records.

If N is below 3, either lane has fewer than 3 successes, the success-rate floor
is absent/missed, or success rates differ beyond the preregistered threshold,
the generated document headlines capability outcomes and omits cost ratios.
Failed attempts stay visible and are never turned into timeout durations for a
ratio.

## Publication-safe action evidence

Raw traces must begin outside the repository. Sanitization requires both an
out-of-repository private store and an HMAC key file of at least 32 bytes with
no group/world permissions:

```sh
export SNAPBACK_BENCHMARK_HMAC_KEY_FILE=/access-controlled/keys/benchmark-hmac.key
volta run --node 24.18.0 node benchmarks/tools/sanitize-trace.mjs \
  --input /access-controlled/incoming/run-r01.json \
  --private-store /access-controlled/benchmark-private \
  --output benchmarks/records/public/run-r01.trace.json
```

The public output contains only normalized action class, tool name, start/end
timing, result status, an opaque evidence ID, documented redaction codes, and
an HMAC-SHA-256 integrity commitment. Tool arguments, transcripts, and the
complete original invocation are written with mode 0600 to the private layout
described in [PRIVATE_STORE.md](./PRIVATE_STORE.md). A final automated scan
checks retained public strings for secret, email, phone, private-path, IP, and
machine-identifier patterns.

The sanitizer fails when redaction would erase a required audit field. Its
output says `reviewRequired: true`; a repository-disclosure authority must
review it and produce the evidence named by the manifest's
`disclosures.humanReview` entry before the checked publisher will render a
claim.

## Synthetic fixtures

`fixtures/` is explicitly synthetic. It includes an N=3 passing comparison,
an N=2 comparison with no success-rate floor (ratio-subordination), a missing
evidence manifest, and a raw trace whose only tool-name content is a private
path (unsafe redaction). Run:

```sh
volta run --node 24.18.0 node --test benchmarks/tools/checked-publisher.test.mjs
```
