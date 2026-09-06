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
