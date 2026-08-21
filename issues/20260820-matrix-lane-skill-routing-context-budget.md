# Matrix lanes load irrelevant app-building skills before the Snapback packet

**Status:** Open
**Opened:** 2026-08-20
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
