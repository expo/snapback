# Snapback 4 program_pipeline exceeds the zero-production store-port census

Status: Resolved
Date: 2026-10-26
Scope: snapback4/crates/snapback4-core/src/engine/program_pipeline.rs
Related: LLP 3000.009.001.000 §3.2; issues/closed/20261025-snapback4-g72-store-port-ratchet-adapter-types.md

DX12's full CLI run at origin/main bcf780d307 reports one production site in
program_pipeline.rs from `cargo test -p snapback4 --test store_port_ratchet`.
The engine file is unchanged by DX12. The earlier G7.2 adapter-types ticket is
closed; this is a current recurrence, with the ratchet reporting:
`production access must remain zero: {"crates/snapback4-core/src/engine/program_pipeline.rs": 1}`.

Reconcile the emitting site or its precise neutral-type classification without
raising the production allowance or weakening real database-access coverage.
DX12 changes only proof helpers, presentation, guides and their tests. No
allowance was changed. The other eight ratchet tests passed in that run.

Resolution (Integration 27): the site is the in-memory early_release::Durability barrier handle, not a driver connection or SQL access. Added its exact local adapter type to the neutral-type census, retaining external/constructor rejection controls and the zero-production allowance.
