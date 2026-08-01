# Guide gap: local config automation lacks a runnable request shape

**Status:** Open
**Area:** Guide, Local operations, Secrets and config, Headless client
**Found by:** LLP 0102 Partiful/Snapback deep-round arm
**Date:** 2026-07-28
**Governing:** LLP 0036, LLP 0061, LLP 0102

## Problem

`guide/operating/secrets-and-config.md` names the admin-gated `status`, `set`,
`unset`, and `verify` operations, but does not show a runnable local request or
first-party client method for any of them. The Partiful arm needed to configure
an Action's secret pool and had to inspect the All Aboard acceptance helper to
discover the route, method, body, generation, and admin-token shape.

The Cloudflare page documents its deployment-specific `config-set.mjs`, but
that is not the local target journey described by the operating page.

## Suggested resolution

- Add CI-verified local examples for `status`, `set`, `unset`, and `verify`.
- Prefer direct typed methods on the privileged headless client or a local CLI
  command over copied raw HTTP.
- Include generation handling, pool replacement/append behavior, and the
  value-redaction boundary.

## Evidence

- `demos/backend-bakeoff/arms/partiful/snapback/work/tests/acceptance.mjs`
  (`configApi`)
- `demos/backend-bakeoff/arms/partiful/snapback/run-capsule.v1.json`
  (`assistanceEvents`)
- `diaries/0030-partiful-backend-bakeoff.diary.md`

## Acceptance

- a clean local demo can set and inspect declared config using only the Guide;
- the example is exercised by `node scripts/check-guide.mjs`; and
- no config value appears in argv, logs, status output, or committed fixtures.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** guide/operating/secrets-and-config.md §"The callable routes" gives the four routes with exact bodies, the value/values exclusivity refusal, append-vs-replace semantics, the loopback transit rule, and the never-in-argv custody boundary.
