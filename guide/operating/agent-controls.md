---
title: Discover agent controls
id: operating.agent-controls
order: 1
audience: agent-first
capabilities: [operating.agent-controls]
authorities: [llp/0184-agent-accessible-control-plane.rfc.md, llp/0031-server-route-taxonomy.spec.md, llp/0042-agent-mcp-surface.rfc.md, src/control_catalog.rs, src/cli.rs, packages/snapback-cli/mcp-control.mjs]
examples: []
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-06
reviewed-commit: 2715951cf
---

# Discover agent controls

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use the control catalog to find an operation by intent before guessing route,
CLI, or MCP names. The catalog describes a build; it does not grant authority
and it does not promise that one running target will admit an invocation.

## Search the build catalog

The native CLI works without a running server because it reads the catalog
embedded in its own executable:

```sh
snapback controls list --intent "network profile"
snapback controls list --intent "table scan" --json
```

Text output summarizes `operation`, `surfaceAccess`, `operability`, and
`status`. JSON output retains the build catalog's `schemaVersion`,
`catalogDigest`, build identity, and matching complete entries. Every word in
`--intent` must occur in the operation id, title, or intent keywords.

Through `snapback mcp-control`, read `snapback-controls://catalog`. It is the
same searchable JSON index, obtained by invoking the co-installed native
binary rather than reading a package snapshot. The resource list also exposes
one `snapback-controls://operation/<operation>` URI per row.

## Describe one operation

```sh
snapback controls describe debug.networkProfileSet
snapback controls describe debug.networkProfileSet --json
```

The complete row includes projections, route policy and response sensitivity,
destructive/approval posture, target/profile availability, Guide anchor, and
any CLI/MCP/internal/unavailable reason. The MCP resource template
`snapback-controls://operation/{operation}` returns the same native row with
the catalog digest in metadata.

## Build versus instance identity

An admin-authenticated running server exposes:

- `GET /_snapback/api/control-catalog` — the exact catalog bytes compiled into
  the server;
- `GET /_snapback/api/control-catalog/operations/{operation}` — one complete
  row with its build digest; and
- `GET /_snapback/api/control-catalog/instance` — startup nonce, target,
  profile, advisory enabled-operation ids, and the digest it instantiates.

The control MCP's `snapback-controls://instance` resource reads the instance
projection only from its validated ready-file target, compares it with the
co-installed native build catalog, and refuses a digest mismatch. A matching
snapshot can still become stale during one process lifetime. Invocation
admission is always authoritative; direct tools re-run the subsystem gate.

## Native resource availability

`mcp-control` does not ship a second Guide or control-catalog copy. It invokes
the co-installed native binary's `snapback mcp` server for Guide resources and
`snapback controls` for catalog resources. If a compatible native binary is
missing, `resources/list` reports
`SNAPBACK_MCP_NATIVE_DOCUMENTATION_UNAVAILABLE` in resource diagnostics and
does not list pretend Guide/catalog resources. Direct reads fail explicitly;
documentation absence never appears as success.

## Generated inventory

<!-- BEGIN GENERATED CONTROL CATALOG: CONTROL CATALOG INVENTORY -->
The embedded build catalog contains **114 operations** at digest `sha256:bb7a38241f6a013d9d25aa624b439fb291c1ea0629116599acb7d0d2f16305dd`. The counts and inventory below are generated; do not edit them by hand.

| Axis | Value | Count |
| --- | --- | ---: |
| surfaceAccess | `apiOnly` | 38 |
| surfaceAccess | `cliOnly` | 29 |
| surfaceAccess | `mcpOnly` | 2 |
| surfaceAccess | `native` | 41 |
| surfaceAccess | `none` | 4 |
| operability | `direct` | 82 |
| operability | `internal` | 11 |
| operability | `mediated` | 7 |
| operability | `unavailable` | 14 |

| Operation | Surface | Operability | Status | CLI | MCP | Guide |
| --- | --- | --- | --- | --- | --- | --- |
| `acceptance.run` | `mcpOnly` | `unavailable` | `unbuilt` | — | snapback_acceptance_run | — |
| `admin.link.exchange` | `cliOnly` | `mediated` | `shipped` | snapback admin link | — | — |
| `admin.link.mint` | `cliOnly` | `mediated` | `shipped` | snapback admin link | — | — |
| `admin.link.revoke` | `cliOnly` | `mediated` | `shipped` | snapback admin link --revoke <claim> | — | — |
| `admin.link.status` | `cliOnly` | `mediated` | `shipped` | snapback admin link --status <claim> | — | — |
| `app.ensure.provision` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `app.inspect` | `native` | `direct` | `shipped` | snapback host inspect | snapback_inspect | operating/host-ops.md |
| `app.reset` | `native` | `direct` | `shipped` | snapback host reset | snapback_reset | — |
| `app.seed.clear.v1` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `app.seed.ensure.v1` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `app.seed.preview.v1` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `app.seed.reset-install.v1` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `asset.delete` | `native` | `direct` | `shipped` | snapback assets delete | snapback_asset_delete | — |
| `asset.ensureSeedFixture` | `cliOnly` | `direct` | `shipped` | snapback assets ensure-seed-fixture | — | — |
| `asset.exportCut` | `native` | `direct` | `shipped` | snapback assets export-cut | snapback_asset_export_cut | — |
| `asset.gcSweep` | `native` | `direct` | `shipped` | snapback assets gc-sweep | snapback_asset_gc_sweep | — |
| `asset.importCut` | `native` | `direct` | `shipped` | snapback assets import-cut | snapback_asset_import_cut | — |
| `asset.inspect` | `native` | `direct` | `shipped` | snapback assets inspect | snapback_asset_inspect | — |
| `asset.list` | `native` | `direct` | `shipped` | snapback assets list | snapback_asset_list | — |
| `asset.put` | `cliOnly` | `direct` | `shipped` | snapback assets put | — | — |
| `asset.retry` | `native` | `direct` | `shipped` | snapback assets retry | snapback_asset_retry | — |
| `asset.rotateSigningKey` | `native` | `direct` | `shipped` | snapback assets rotate-signing-key | snapback_asset_rotate_signing_key | — |
| `auth.mailbox.read` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `auth.mintSession` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `auth.rescueCollidingTable` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `branch.create.v1` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `branch.drop.v1` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `branch.execute.v1` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `branch.inspect.v1` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `branch.list.v1` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `branch.reap.v1` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `capability.manifest.read` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `cli.auth.backup` | `cliOnly` | `direct` | `shipped` | snapback auth backup | — | — |
| `cli.auth.restore` | `cliOnly` | `direct` | `shipped` | snapback auth restore | — | — |
| `cli.buildIdentity` | `cliOnly` | `direct` | `shipped` | snapback build-identity | — | — |
| `cli.fork.create` | `cliOnly` | `direct` | `shipped` | snapback fork create | — | — |
| `cli.fork.diff` | `cliOnly` | `direct` | `shipped` | snapback fork diff | — | — |
| `cli.fork.drop` | `cliOnly` | `direct` | `shipped` | snapback fork drop | — | — |
| `cli.fork.list` | `cliOnly` | `direct` | `shipped` | snapback fork list | — | — |
| `cli.fork.reap` | `cliOnly` | `direct` | `shipped` | snapback fork reap | — | — |
| `cli.migrate.apply` | `cliOnly` | `direct` | `shipped` | snapback migrate apply | — | — |
| `cli.migrate.approve` | `cliOnly` | `direct` | `shipped` | snapback migrate approve | — | — |
| `cli.migrate.cancel` | `cliOnly` | `direct` | `shipped` | snapback migrate cancel | — | — |
| `cli.migrate.preview` | `cliOnly` | `direct` | `shipped` | snapback migrate preview | — | — |
| `cli.migrate.rehearse` | `cliOnly` | `direct` | `shipped` | snapback migrate rehearse | — | — |
| `cli.migrate.rollback` | `cliOnly` | `unavailable` | `unbuilt` | snapback migrate rollback | — | — |
| `cli.migrate.verify` | `cliOnly` | `direct` | `shipped` | snapback migrate verify | — | — |
| `cli.telemetry.query` | `cliOnly` | `direct` | `shipped` | snapback telemetry query | — | — |
| `client-mutations.purge` | `apiOnly` | `internal` | `shipped` | — | — | — |
| `config.plan` | `native` | `direct` | `shipped` | snapback config plan | snapback_config_plan | operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify |
| `config.set` | `cliOnly` | `direct` | `shipped` | snapback config set --entry <name> (--value-stdin\|--value-fd N) | — | operating/secrets-and-config.md#set-an-agent-held-value-without-exposing-it |
| `config.status` | `native` | `direct` | `shipped` | snapback config status | snapback_config_status | operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify |
| `config.unset` | `native` | `direct` | `shipped` | snapback config unset | snapback_config_unset | — |
| `config.verify` | `native` | `direct` | `shipped` | snapback config verify <entry> | snapback_config_verify | operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify |
| `connection.disconnect` | `native` | `direct` | `shipped` | snapback connections disconnect | snapback_connection_disconnect | — |
| `console.approval.approve` | `cliOnly` | `mediated` | `shipped` | snapback admin approve | — | — |
| `console.approval.poll` | `cliOnly` | `mediated` | `shipped` | snapback admin approve | — | — |
| `console.approval.request` | `cliOnly` | `mediated` | `shipped` | snapback admin approve | — | — |
| `console.credential` | `apiOnly` | `internal` | `shipped` | — | — | — |
| `console.reachability.bind` | `apiOnly` | `internal` | `shipped` | — | — | — |
| `console.reachability.drop` | `apiOnly` | `internal` | `shipped` | — | — | — |
| `console.reachability.register` | `apiOnly` | `internal` | `shipped` | — | — | — |
| `console.reachability.renew` | `apiOnly` | `internal` | `shipped` | — | — | — |
| `control.catalog.describe` | `native` | `direct` | `shipped` | snapback controls describe <operation> | snapback-controls://operation/{operation} | operating/agent-controls.md#describe-one-operation |
| `control.catalog.instance.read` | `mcpOnly` | `direct` | `shipped` | — | snapback-controls://instance | operating/agent-controls.md#build-versus-instance-identity |
| `control.catalog.read` | `native` | `direct` | `shipped` | snapback controls list | snapback-controls://catalog | operating/agent-controls.md#search-the-build-catalog |
| `cron.list` | `native` | `direct` | `shipped` | snapback cron list | snapback_cron_list | backend/cron.md#inspect-declared-jobs-and-runtime-posture |
| `cron.runOne` | `native` | `direct` | `shipped` | snapback cron run | snapback_cron_run | — |
| `cron.status.read` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `cron.tick` | `native` | `direct` | `shipped` | snapback cron tick | snapback_cron_tick | — |
| `data.patch.apply` | `native` | `direct` | `shipped` | snapback data patch --apply --input <file\|-> | snapback_data_patch_apply | operating/data-patch.md#apply |
| `data.patch.preview` | `native` | `direct` | `shipped` | snapback data patch --preview --input <file\|-> | snapback_data_patch_preview | operating/data-patch.md#preview |
| `data.scan` | `native` | `direct` | `shipped` | snapback data scan <table> | snapback_data_scan | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `debug.live.forceResync` | `native` | `direct` | `shipped` | snapback debug force-resync | snapback_live_force_resync | operating/host-ops.md |
| `debug.networkProfileGet` | `native` | `direct` | `shipped` | snapback network-profile get | snapback_network_profile_get | operating/network-profiles.md#read-the-active-profile |
| `debug.networkProfileSet` | `native` | `direct` | `shipped` | snapback network-profile set | snapback_network_profile_set | operating/network-profiles.md#set-a-profile |
| `direct_runner.action` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `direct_runner.mutation` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `direct_runner.query` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `direct_runner.unknown` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `ephemeral.cleanup` | `native` | `direct` | `shipped` | snapback ephemeral cleanup | snapback_ephemeral_cleanup | realtime/ephemeral-state.md#clean-up-expired-entries-operationally |
| `ephemeral.operatorDelete` | `native` | `direct` | `shipped` | snapback ephemeral operator-delete | snapback_ephemeral_operator_delete | realtime/ephemeral-state.md#delete-one-entry-as-an-operator |
| `errors.issue` | `native` | `direct` | `shipped` | snapback errors issue | snapback_errors_issue | operating/host-ops.md |
| `errors.issues` | `native` | `direct` | `shipped` | snapback errors issues | snapback_errors_issues | operating/host-ops.md |
| `errors.transition` | `native` | `direct` | `shipped` | snapback errors transition | snapback_errors_transition | operating/host-ops.md |
| `function.explain` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `function.run` | `native` | `direct` | `shipped` | snapback host run | snapback_run_function | — |
| `functions.load` | `native` | `direct` | `shipped` | snapback host load --functions <path> | snapback_load_functions | — |
| `functions.reload` | `apiOnly` | `unavailable` | `unbuilt` | — | — | — |
| `health` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `health.read` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `host.restart` | `native` | `direct` | `shipped` | snapback restart | snapback_restart | operating/host-ops.md#restart-with-one-credential-bound-receipt |
| `host.start` | `cliOnly` | `direct` | `shipped` | snapback host start | snapback_start | — |
| `host.stop` | `cliOnly` | `direct` | `shipped` | snapback host stop | snapback_stop | — |
| `hostCall.dispatch` | `none` | `internal` | `shipped` | — | — | — |
| `inspect` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `jobs.drain` | `native` | `direct` | `shipped` | snapback jobs drain | snapback_jobs_drain | — |
| `jobs.list` | `native` | `direct` | `shipped` | snapback jobs list | snapback_jobs_list | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `jobs.show` | `native` | `direct` | `shipped` | snapback jobs show <id> | snapback_jobs_show | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `object.evict` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `operations.explain` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `push.maintenance` | `apiOnly` | `internal` | `shipped` | — | — | — |
| `receipts` | `apiOnly` | `direct` | `shipped` | — | — | — |
| `route.unknown.refuse` | `none` | `internal` | `shipped` | — | — | — |
| `schema.load` | `native` | `direct` | `shipped` | snapback host load --schema <path> | snapback_load_schema | — |
| `schema.reload` | `apiOnly` | `unavailable` | `unbuilt` | — | — | — |
| `secretRead.mint` | `cliOnly` | `direct` | `shipped` | snapback secret-read-mint | — | — |
| `storage.operation-coverage.activate` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `storage.protected-erasure` | `apiOnly` | `unavailable` | `shipped` | — | — | — |
| `telemetry.events` | `native` | `direct` | `shipped` | snapback telemetry events | snapback_telemetry_events | operating/host-ops.md |
| `telemetry.export` | `native` | `direct` | `shipped` | snapback telemetry export | snapback_telemetry_export | operating/host-ops.md |
| `telemetry.stats` | `native` | `direct` | `shipped` | snapback telemetry stats | snapback_telemetry_stats | operating/host-ops.md |
| `test.<subpath-determined-by-coordinator>` | `none` | `internal` | `shipped` | — | — | — |
| `test.corruptMeta` | `none` | `internal` | `shipped` | — | — | — |
<!-- END GENERATED CONTROL CATALOG: CONTROL CATALOG INVENTORY -->
