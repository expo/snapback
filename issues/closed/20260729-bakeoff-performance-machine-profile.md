# Derive bakeoff performance machine identity at runtime

**Status:** Open  
**Area:** LLP 0102 benchmark tooling  
**Found by:** Linux final-confirmation evidence audit  
**Date:** 2026-07-29  
**Governing:** LLP 0102

## Problem

The frozen Todo and Chat Snapback runners hardcode
`small local Mac17,3 arm64 workload` into performance receipts. The final
package confirmations executed those unchanged scenarios on a Minisforum
Ubuntu x86_64 host. Their raw samples are genuine Linux measurements, but the
embedded machine field is contradicted.

Companion correction receipts retain the actual host facts and prohibit
cross-machine comparison. No scenario status changes, but the stale
description reduces confidence and could cause an invalid performance claim if
read without its companion.

## Required outcome

- Performance runners derive OS, architecture, CPU, and relevant runtime
  versions at execution time.
- A receipt cannot simultaneously carry observed host facts and a
  contradictory free-form profile.
- Validation rejects a hardcoded or mismatched machine profile.
- Reports join the environment receipt before presenting a sample, and label
  incomparable host windows explicitly.

## Evidence

- `demos/backend-bakeoff/arms/todo/snapback/work/scripts/run-arm.mjs`
- `demos/backend-bakeoff/arms/chat/snapback/work/scripts/run-arm.mjs`
- `demos/backend-bakeoff/arms/todo/snapback/final-confirmation-handoff/linux-x64/evidence/machine-context-correction.v1.json`
- `demos/backend-bakeoff/arms/chat/snapback/final-confirmation-handoff/linux-x64/evidence/machine-context-correction.v1.json`

## Acceptance

Run the same performance harness on macOS arm64 and Linux x86_64. Each receipt
contains independently observed matching host metadata, strict validation
passes, and a report generator refuses to compare latency windows until their
machine contexts are explicitly normalized.

---

**RESOLVED 2026-08-01 (fix-wave α1).** Both frozen runners now derive
machine identity at execution time (`observedMachineContext()`:
platform, arch, CPU model/count, memory, node version) and the
free-form profile no longer carries host claims, so a receipt cannot
contradict the host it ran on. Report-side normalization guards remain
with the 0102 harness owner.
