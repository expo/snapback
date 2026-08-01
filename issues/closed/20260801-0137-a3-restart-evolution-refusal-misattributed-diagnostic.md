# A3 sweep: sessions restart-after-regenerate refusal is misattributed to a runtime/codegen mismatch

- **Status:** Resolved
- **Opened:** 2026-08-01
- **Resolved:** 2026-08-01 (between-arms fix lane)
- **Systems:** CLI, Auth, Diagnostics
- **Related:** LLP 0137 (A3 arm), LLP 0058 §Cold startup artifact carrier,
  demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f4-restart-evolution-refusal-misattributed-diagnostic.json,
  issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md

Stop dev, regenerate evolved schema/functions, start again over the same
sessions database: the server refused with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` (the startup artifact-pair pin),
but the CLI wrapped it in `SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH` with
runtime reinstall/`SNAPBACK_RUNTIME_BINARY` advice that cannot help.

## Root cause

`packages/snapback-cli/index.mjs` listed the literal code
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` in `ARTIFACT_DECODE_EVIDENCE`, so
every startup failure whose stderr carried the pin refusal was classified as
an artifact-decode failure (the stale-runtime case) — including the
identity refusal from a healthy runtime that parsed both manifests and
correctly refused a pair that differs from the pinned deployment. The
refusal's `expectedDeployment`/`observedDeployment` details never reached
the operator either: the native binary printed only `code: message`, though
LLP 0058 says the CLI "emits the exact expected deployment identity".

## Fix

- `src/cli.rs`: startup-artifact refusals from auth-mode composition now
  emit one structured `snapback.startup-diagnostic.v1` stderr line carrying
  the complete diagnostic (code + expected/observed deployment identities;
  hashes only, no secret material) before the process exits.
- `packages/snapback-cli/index.mjs`: `refineGeneratedArtifactFailure` first
  classifies the auth startup **pin** refusal — via the structured line
  (`observedDeployment` present proves both identities computed, i.e. the
  pair decoded) with a prose fallback on the two identity-refusal messages —
  and surfaces `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` as the primary
  structured diagnostic with the expected/observed identities and a recovery
  naming the sanctioned evolution path (provision through the running dev
  server's reload; cold-start repair via the pinned pair). Carrier
  shape/format failures with the same code remain decode-classified, so the
  genuine stale-runtime cascade (and its existing regression test) is
  unchanged. The pin itself stays fail-closed.

## Regression test (proven to fail pre-fix)

`packages/snapback-cli/sessions-dev-loop.test.mjs`: after the stale-runtime
restart block, evolve the schema, regenerate, restart — asserts the primary
diagnostic is `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` with
`causeCode: SNAPBACK_DEV_SERVER_START_FAILED`, both deployment identities,
a recovery naming the running-server evolution path, and none of the
runtime-identity rebuild/override advice. Pre-fix the same sequence produced
`SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH`.

## Note

The sanctioned evolution path this recovery names (live reload through the
running supervisor) is real again as of the f5 fix: it previously wedged
whenever a live subscriber was attached (see the related closed ticket).
