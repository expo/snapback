# Matrix lanes load irrelevant app-building skills before the Snapback packet

**Status:** Closed
**Opened:** 2026-08-20
**Closed:** 2026-08-21
**Systems:** Benchmarks, Agent context, Templates, Skills, Token efficiency
**Related:** LLP 0186; LLP 0201; LLP 0259; LLP 0277; LLP 0295

## Problem

At least one retained 0.1.24 lane began by loading three generic Expo/Tuft
skills, including a long physical-phone/EAS delivery workflow, even though the
benchmark was a fixed web-only Expo Router task with its own frozen instrument
and Snapback start packet. Other lanes repeatedly opened overlapping
instrument files and package types before reaching the same first-use facts.

This is not a Snapback runtime defect, but it consumes context and agent turns
before product work and makes profile comparisons partly measure ambient skill
routing. The event streams preserve the evidence; the run lacks per-phase
token snapshots, so no exact token share is claimed.

## Requested repair

- Put a bounded lane-local `AGENTS.md`/start packet at the initial directory
  that names the only applicable skills and explicitly classifies the task as
  web-only, no EAS/device delivery, no generic app scaffold substitution.
- Provide one generated benchmark orientation artifact containing the brief
  scope, contract, assertion applicability, fixture entrypoints, pins, and
  required output paths; link to detail rather than requiring six overlapping
  first reads.
- Record bytes/tokens loaded before the first product edit and the selected
  skill set in the lane report.
- Add a harness preflight warning when known out-of-scope skill families are
  loaded before milestone M1.

## Exit

Matched probe lanes reach the first product edit after one bounded Snapback
start packet, with no device/EAS skill context and with orientation bytes
reported separately from authoring tokens.

## Resolution

`benchmarks/tools/lane-setup.mjs` now installs a deterministic lane-root
`AGENTS.md`, the sole generated `BENCHMARK-ORIENTATION.md`, and an initial
`lane-report.json`. Setup requires an explicit web-Snapback, native-Simulator,
or competitor lane kind and renders the corresponding backend/proof contract.
It verifies the frozen instrument pin, manifest digests, and choreography
version without any live-source fallback.

The lane report inventories and hashes every generated or skill-body pre-edit
carrier, records content-hash deduplication, and enforces LLP 0259's component
and true 16 KiB aggregate ceilings. It also carries the selected skill allowlist.
Its meter-ingest marker uses
`{laneRunId, at, orientationBytes, selectedSkills}` and is hash-bound by the
driver manifest; the report seed/joined snapshot separately uses
`{at, orientationBytes, orientationTokens, selectedSkills}`, preserving all
five native counters without leaking the marker-only lane identity into the
schema. Preflight compares the marker receipt field by field, classifies every
registered off-allowlist skill while leaving unregistered IDs fail-open, and
deterministically retains warnings in the report. A lane-local `instrument`
symlink gives every artifact href the same relative prefix, keeping orientation
bytes and hashes invariant across shallow and nested run layouts.

Unit coverage verifies fail-closed snapshot provenance, matching lane-kind
instructions, true steering caps/dedup, cross-root and cross-layout
determinism, warning retention, the hash-bound meter marker round trip,
marker-bound classification, and positive/negative local-ref schema validation.

landing SHA: TBD
