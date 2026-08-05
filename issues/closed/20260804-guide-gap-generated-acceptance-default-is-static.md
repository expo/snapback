# Guide gap: generated default acceptance does not boot or drive Snapback

**Status:** Resolved
**Impact:** 5
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Scaffolds, Acceptance, Agent operation
**Date:** 2026-08-04
**Resolved:** 2026-08-05
**Governing:** LLP 0010, LLP 0024, LLP 0041, LLP 0061

## Problem

The acceptance guide defines the required surface as a headless suite that
boots a real server, loads real generated artifacts, and drives a product
client. It also promises vacuous-pass protection.

Generated defaults did something weaker:

- `todo-contract` mapped `test` to a static script that checked two generated
  JSON facts.
- The paved React template mapped `test` to static generated/source checks and
  kept real handler execution behind an opt-in `test:live` script.

Both default tests could exit `0` without ever starting a server or invoking a
function. The word "acceptance" and default `test` script therefore provided a
silent false done-oracle.

## Resolution

Both generated starters now map default `test` to an isolated runtime suite.
Each suite owns a temporary database and ready descriptor, waits for managed
generated-and-loaded state, verifies the loaded app/bundle identity, executes a
real generated query and mutation through its product client, observes the
write, performs bounded teardown, and emits one bounded
`snapback.starter-acceptance.v1` receipt with a non-zero exact check count and
cleanup result.

Static artifact/source checks are now named `test:static` and cannot satisfy
runtime acceptance. `test:live` remains a compatibility alias to the live
default. Package scaffold tests pin the mappings, and the public cold-install
proof parses and validates each default receipt rather than accepting exit `0`
alone. The acceptance and authoring-loop guide pages now state the distinction.

The stronger general `acceptance.run` host operation remains separately
unimplemented; this resolution does not claim it.
