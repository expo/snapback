# Linear deep arm — SpacetimeDB 2.7.0

This arm implements the frozen LLP 0102 Linear workload against an exact, fresh SpacetimeDB standalone target. It uses private source tables, caller-dependent public views, reducers, generated TypeScript bindings, and native WebSocket subscriptions.

## Result

- Ten product scenarios passed locally before finalization.
- Native full-text issue search is `GAP`.
- Provider-backed persistent offline views and mutation queueing are `GAP`.
- Hosted Maincloud deployment is `UNAVAILABLE_REMOTE_DEPENDENCY` because no credential was available; the local target is never presented as hosted.
- The exact isolated database, runtime credentials, CLI/config/data roots, and ports are cleaned after evidence capture.

The authoritative result is in `evidence/acceptance-results.json`; timings are in `evidence/performance-samples.json`; the protocol capsule is `run-capsule.v1.json`.

## Layout

- `work/server/spacetimedb/src/index.ts` — V2 module.
- `work/server/migrations/v1/index.ts` — retained pre-migration module.
- `work/harness/prepare.ts` — exact seed and development identities.
- `work/harness/verify.ts` — three-actor acceptance and performance harness.
- `work/client/` — neutral React/Vite issue-tracker shell.
- `evidence/` — authoritative receipts, failed attempts, UI proof, cleanup proof, and inventory.
- `handoff/diary-entry-draft.md` — append-only diary material for the coordinator.

Runtime credentials belong only under ignored `state/`; they must never be committed or embedded in Vite output. The UI accepts a development identity through `sessionStorage["linear-spacetimedb-token"]` at runtime.

## Reproduction outline

Use SpacetimeDB CLI and client 2.7.0. Start an isolated standalone server on 3320 with arm-local CLI/config/data roots, create an owner identity, publish V1, run `npm run seed`, publish V2 with `--delete-data=never`, regenerate bindings, and run `npm run verify`. The exact commands and target identity are retained in the deployment, migration, cleanup, and capsule receipts.

The finalized repository intentionally does not retain runtime credentials or a live target.
