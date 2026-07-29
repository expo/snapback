# Guide gap: outbound-action egress gate also applies during codegen

**Status:** Resolved
**Area:** Guide, Actions, Codegen, Outbound fetch
**Found by:** LLP 0102 Partiful/Snapback deep-round arm
**Date:** 2026-07-28
**Governing:** LLP 0009, LLP 0036, LLP 0061, LLP 0102

## Problem

`guide/backend/actions-and-fetch.md` says to set
`SNAPBACK_OUTBOUND_ACTIONS=1` for the deployment/process that should have
egress. A correctly declared fetch-using Action nevertheless failed generation
with `BUNDLE_UNSUPPORTED_FETCH` when the variable was absent from the codegen
process.

Source inspection was required to discover that the compile-time validator
consumes the same ambient gate. The guide describes the runtime boundary but
does not put the requirement on the generate/dev/build commands where an
author first encounters it.

## Suggested resolution

- Show the variable on every documented command that compiles a fetch-using
  Action bundle.
- Make `BUNDLE_UNSUPPORTED_FETCH` state whether codegen or runtime admission is
  missing and name the repair.
- Prefer carrying the declared Action capability into codegen through the
  ordinary app CLI rather than requiring an unexplained ambient shell value.

## Evidence

- `demos/backend-bakeoff/arms/partiful/snapback/evidence/failed-attempts.md`
- `demos/backend-bakeoff/arms/partiful/snapback/work/snapback/functions.mjs`
- `diaries/0030-partiful-backend-bakeoff.diary.md`

## Acceptance

- the Actions page explicitly distinguishes codegen-time and runtime egress
  admission;
- its CI-verified command path successfully generates the documented
  fetch-using Action from a clean shell; and
- the refusal diagnostic points to that path.

## Resolution

Resolved 2026-07-29 by `f7cdf4940`. The Actions page now distinguishes the
generation and exact-process runtime gates, shows the managed CLI commands, and
transcludes executable codegen and server-start witnesses. The Guide checker
and focused Node authoring-validation suite pass.
