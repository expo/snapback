# Clique cold packet omits a required choreography dependency

Status: Open
Date: 2026-09-06
Scope: benchmark packet construction and copied choreography layout

The cold Astra medium run for published Snapback2 0.0.13 uses the frozen
instrument at `f40559f37722c79178be664a11f8a6485f1508fd`. Its packet contains
the social-messenger subtree, but choreography's `setup-identity.mjs` imports
`../../lib/json-schema.mjs`, whose original file lives outside that subtree at
`benchmarks/tools/lib/json-schema.mjs`. Copying only choreography also leaves
its sibling metering imports unresolved until their original layout is restored.

The run retained `ERR_MODULE_NOT_FOUND` for both the missing metering sibling
and the schema helper. The builder subsequently installed a loader that
unconditionally replaces the helper with an AJV validator. That replacement
is not source-equivalent to the frozen validator and cannot silently qualify
the original harness. This is an instrument/environment packaging problem,
not a demonstrated Snapback product defect.

Evidence is under
`/Users/ccheever/clique-full-astra-next-primary-20260906/lanes/astra-snapback2/`:
`evidence/m1-choreo-startup.txt`, `evidence/m1-choreo-startup2.txt`,
`scripts/harness-loader.mjs`, `scripts/schema-validator.mjs`, and `run-log.md`.
Independent investigation and dependency closure are retained under
`/Users/ccheever/clique-improvement/revisions/astra013-supervision/instrument-layout/`.

Resolution must preserve the exact frozen dependency bytes and assertions,
retain the first failures, and keep the current session's original clocks.
Future packet construction should include the complete imported helper closure
and demonstrate that the documented copied layout resolves it before launching
a timed build. Do not repair this by substituting validators, weakening setup
checks, changing product requirements, or discarding the failed attempt.

The current restoration is being prepared. No successful corrected choreography
execution is claimed here. Existing competitor scores remain retained; restoring
an omitted frozen helper does not itself change the scoring rubric.

## 0.0.19 handoff observations — 2026-09-08

The new continuous builder received the complete frozen benchmark layout,
including metering and schema helpers, with Playwright provisioned before its
clock. Its source archive retains all 509 source/instrument entries unchanged.
No replacement validator was used. This repairs that lane's source closure;
it is not a general packet-constructor qualification.

The independent assessment copy installed app dependencies but initially omitted
the choreography directory's separate locked install. Its first acceptance
failed on missing Playwright, then passed after `npm ci` in that directory and
Chromium installation. The attempt and one environment retry are retained.
Fresh M7 preparation installs both locks before the author starts. Future
handoffs must verify both imported source closure and nested harness dependency
readiness; a successful app-only install is insufficient. See the
[0.0.19 diagnostic record](../../benchmarks/runs/2026-09-08-release-cold-headroom/README.md).

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — recurring packet-construction defect. **Triage priority:** P1.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

Earlier 0.0.19 packet repairs did not close the general constructor: the 0.0.21 run again aborted Astra attempt 1 because lib/json-schema.mjs was omitted. This is a fresh recorded recurrence, not a hypothetical missing-import concern.

benchmarks/runs/2026-09-10-clique-ri-0.0.21/README.md explicitly records the failed first attempt and second attempt. Root cause class remains incomplete imported source/dependency closure. Qualify a copied packet with exact helper bytes plus both locked dependency installs before the builder clock; do not replace the validator or discard the aborted attempt.
