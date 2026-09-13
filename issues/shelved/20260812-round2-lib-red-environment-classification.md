# Classify the 32 pre-existing lib reds seen at d6fc55d7f

**Found:** 2026-08-12

**Base:** `d6fc55d7f97798591ec68d3490c489375ae840dc`

A full lib run reported 32 reds. Exact serial classification found 28
environmental and four real stale tests/tables.

## Environment-only inventory

The 21 `auth::backup::tests::*` reds plus
`auth::runtime::tests::backup_quiescence_blocks_provider_write_and_key_rotation`,
`cli::tests::physical_restore_is_quarantined_until_exact_prebind_declaration`,
the three round-1 `store_state::tests::*` export/copy reds, and
`storage::auth::tests::auth_backup_excludes_push_registry_custody_rows` share
one sandbox signature: descriptor-bound SQLite online backup fails before the
intended assertion, ultimately reporting `SNAPBACK_SQLITE_ERROR` with detail
`"not an error"`. Local serial aggregate was 0/27; the same already-built
binary and Hermes framework passed 27/27 on an idle unsandboxed Mac.

`bench::tests::agent_safe_active_covered_worker_exercises_issuance_bearing_commits`
is also environmental here: the sandbox RSS observation was zero
(`idle.resident_kb_before > 0.0`), 0/1 locally and 1/1 with the same binary
unsandboxed.

Do not attribute these 28 reds to a landing without an unsandboxed exact-binary
control. Do not weaken their assertions: they pass under the filesystem and
process semantics they are designed to test.

## Real inventory

- `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`: real
  reviewed-table drift; fixed in the round-2 worktree.
- Three `local::tests::*` activation/live reds: real stale test-lane
  assumptions after LLP 0094 made retained authorization the sole frame
  source; fixed in the round-2 worktree.

## Reproduction

```sh
env -u DYLD_FRAMEWORK_PATH -u DYLD_LIBRARY_PATH TMPDIR=/tmp \
  target/debug/deps/snapback-<hash> '<exact-test-name>' \
  --exact --nocapture --test-threads=1
```

Retain this ticket as a landing-triage inventory until the managed sandbox can
provide the required descriptor-bound SQLite and process-RSS semantics.
