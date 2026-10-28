# Snapback 4: imported main store-port census has two production matches

Status: Closed
Date: 2026-10-27
Scope: snapback4/crates/snapback4-core/src/engine/{command_batch,program_pipeline}.rs
Related: LLP 3000.009.001.000 §3.2; issues/closed/20261026-snapback4-program-pipeline-store-port-census.md

An untouched archive of origin/main `64e94e52cf` reproduces the ratchet failure:
`production access must remain zero` reports one match in `command_batch.rs`
and one in `program_pipeline.rs`. Its original scanner was compiled independently
with `rustc --test`, then executed against the archived main sources. Both emitting
files and the scanner are byte-identical in REL3. This is a lexical boundary
finding; the scan alone does not establish database access.

Reconcile the concrete typed sites or their precise neutral-type classification,
preserving zero production access and the scanner's rejection controls. These
batch/pipeline files belong to the concurrent latency work, outside REL3's release
and client-contract scope. REL3 changes no allowance or scanner rule.

Evidence: `snapback4/reports/20261027-rel3/baseline-facts.json` and
`baseline-ratchet.log.gz`. The older closed ticket records the earlier recurrence;
this ticket tracks the current two-site signature.

## Resolution — 2026-10-28

Imported main fix `9b0d37eda2` renames the two neutral-helper arguments without
adding a store-port allowance. The later scanner termination repair
`87fb2ecef4` is imported too. On merged REL4 commit `f6fb895af2`, the complete
CLI crate passes: all seven store-handle census tests, the zero-production-access
ratchet and its rejection controls. The original two-site signature no longer
reproduces. No REL4 source allowance was added.

Evidence: `target/affected/f6fb895af228-1793139949730.json` and the
`store_handle_census` / `store_port_ratchet` sections of the retained REL4
qualification output.
