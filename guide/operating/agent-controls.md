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
reviewed-authorities-digest: sha256:b8784542ae2f90c964cfd9e17df728f5e7681a8964a5568504d60c356b59b6d8
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
The embedded build catalog contains **152 operations** at digest `sha256:47abff5d9167671a8b952b6d653bc50328f3b5eee1e290b8be5bb4743cdd5c68`. The counts and inventory below are generated; do not edit them by hand.

| Axis | Value | Count |
| --- | --- | ---: |
| surfaceAccess | `apiOnly` | 54 |
| surfaceAccess | `cliOnly` | 50 |
| surfaceAccess | `mcpOnly` | 2 |
| surfaceAccess | `native` | 42 |
| surfaceAccess | `none` | 4 |
| operability | `direct` | 113 |
| operability | `internal` | 11 |
| operability | `mediated` | 7 |
| operability | `unavailable` | 21 |

| Operation | Surface | Operability | Status | CLI | MCP | Guide |
| --- | --- | --- | --- | --- | --- | --- |
| `acceptance.run` | `mcpOnly` | `unavailable` | `unbuilt` | — | snapback_acceptance_run | testing/verify.md#author-snapbackverifyconfigmjs |
| `admin.link.exchange` | `cliOnly` | `mediated` | `shipped` | snapback admin link | — | operating/admin-console.md#hand-a-one-time-link-from-an-agent-terminal-to-a-remote-browser |
| `admin.link.mint` | `cliOnly` | `mediated` | `shipped` | snapback admin link | — | operating/admin-console.md#hand-a-one-time-link-from-an-agent-terminal-to-a-remote-browser |
| `admin.link.revoke` | `cliOnly` | `mediated` | `shipped` | snapback admin link --revoke <claim> | — | operating/admin-console.md#hand-a-one-time-link-from-an-agent-terminal-to-a-remote-browser |
| `admin.link.status` | `cliOnly` | `mediated` | `shipped` | snapback admin link --status <claim> | — | operating/admin-console.md#hand-a-one-time-link-from-an-agent-terminal-to-a-remote-browser |
| `app.ensure.provision` | `apiOnly` | `direct` | `shipped` | — | — | auth/sessions-and-principals.md#provision-sessions-artifacts-explicitly |
| `app.inspect` | `native` | `direct` | `shipped` | snapback inspect | snapback_inspect | operating/host-ops.md#served-request-operations |
| `app.readiness.v1` | `apiOnly` | `direct` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `app.reset` | `native` | `direct` | `shipped` | snapback reset | snapback_reset | backend/versioned-seeds.md#expect-the-reset-blast-radius-on-connected-clients |
| `app.seed.clear.v1` | `apiOnly` | `direct` | `shipped` | — | — | backend/versioned-seeds.md#use-the-generated-lifecycle |
| `app.seed.ensure.v1` | `apiOnly` | `direct` | `shipped` | — | — | backend/versioned-seeds.md#use-the-generated-lifecycle |
| `app.seed.preview.v1` | `apiOnly` | `direct` | `shipped` | — | — | backend/versioned-seeds.md#use-the-generated-lifecycle |
| `app.seed.reset-install.v1` | `apiOnly` | `direct` | `shipped` | — | — | backend/versioned-seeds.md#use-the-generated-lifecycle |
| `asset.delete` | `native` | `direct` | `shipped` | snapback assets delete | snapback_asset_delete | backend/assets.md#operate |
| `asset.ensureSeedFixture` | `cliOnly` | `direct` | `shipped` | snapback assets ensure-seed-fixture | — | backend/assets.md#operate |
| `asset.exportCut` | `native` | `direct` | `shipped` | snapback assets export-cut | snapback_asset_export_cut | backend/assets.md#export-the-asset-component-of-a-logical-backup |
| `asset.gcSweep` | `native` | `direct` | `shipped` | snapback assets gc-sweep | snapback_asset_gc_sweep | backend/assets.md#operate |
| `asset.importCut` | `native` | `direct` | `shipped` | snapback assets import-cut | snapback_asset_import_cut | backend/assets.md#validate-the-complete-cut-before-restore |
| `asset.inspect` | `native` | `direct` | `shipped` | snapback assets inspect | snapback_asset_inspect | backend/assets.md#operate |
| `asset.list` | `native` | `direct` | `shipped` | snapback assets list | snapback_asset_list | backend/assets.md#operate |
| `asset.put` | `cliOnly` | `direct` | `shipped` | snapback assets put | — | backend/assets.md#upload-and-attach |
| `asset.retry` | `native` | `direct` | `shipped` | snapback assets retry | snapback_asset_retry | backend/assets.md#operate |
| `asset.rotateSigningKey` | `native` | `direct` | `shipped` | snapback assets rotate-signing-key | snapback_asset_rotate_signing_key | backend/assets.md#invalidate-every-outstanding-signed-url |
| `auth.declared-clients` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/observability.md#check-health-and-recent-logs-in-the-console |
| `auth.declared-clients.bless` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.declared-clients.delete` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.declared-clients.resume` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.declared-clients.suspend` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.integrationResume` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.integrationRetire` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.integrations` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/observability.md#check-health-and-recent-logs-in-the-console |
| `auth.integrations.resume` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.integrations.retire` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.integrations.suspend` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.integrationSuspend` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.mailbox.read` | `apiOnly` | `direct` | `shipped` | — | — | auth/sessions-and-principals.md#mint-test-personas-the-complete-local-recipe |
| `auth.mintSession` | `cliOnly` | `direct` | `shipped` | snapback session mint --email <address> | — | operating/host-ops.md#mint-a-session-over-http |
| `auth.rehearsal.exercise` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.rehearsal.mint` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.rehearsal.revoke` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.rehearsal.status` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/host-ops.md#served-request-operations |
| `auth.rescueCollidingTable` | `apiOnly` | `direct` | `shipped` | — | — | auth/sessions-and-principals.md#provision-sessions-artifacts-explicitly |
| `branch.create.v1` | `apiOnly` | `direct` | `shipped` | — | — | operating/instance-forks.md#give-a-worktree-its-own-backend |
| `branch.drop.v1` | `apiOnly` | `direct` | `shipped` | — | — | operating/instance-forks.md#inspect-review-and-dispose-forks |
| `branch.execute.v1` | `apiOnly` | `direct` | `shipped` | — | — | operating/instance-forks.md#own-forks-per-worktree-per-agent-run-and-per-suite-lane |
| `branch.inspect.v1` | `apiOnly` | `direct` | `shipped` | — | — | operating/instance-forks.md#inspect-review-and-dispose-forks |
| `branch.list.v1` | `apiOnly` | `direct` | `shipped` | — | — | operating/instance-forks.md#inspect-review-and-dispose-forks |
| `branch.reap.v1` | `apiOnly` | `direct` | `shipped` | — | — | operating/instance-forks.md#inspect-review-and-dispose-forks |
| `capability.manifest.read` | `apiOnly` | `direct` | `shipped` | — | — | deploying/cloudflare.md#exact-supported-subset-and-non-claims |
| `cli.auth.backup` | `cliOnly` | `direct` | `shipped` | snapback auth backup | — | operating/backup-and-copy.md#recover-from-a-disaster |
| `cli.auth.restore` | `cliOnly` | `direct` | `shipped` | snapback auth restore | — | operating/backup-and-copy.md#recover-from-a-disaster |
| `cli.buildIdentity` | `cliOnly` | `direct` | `shipped` | snapback build-identity | — | operating/diagnostics.md#report-the-runtimes-own-readiness-identity |
| `cli.fork.create` | `cliOnly` | `direct` | `shipped` | snapback fork create | — | operating/instance-forks.md#give-a-worktree-its-own-backend |
| `cli.fork.diff` | `cliOnly` | `direct` | `shipped` | snapback fork diff | — | operating/instance-forks.md#read-the-diff-at-its-real-boundary |
| `cli.fork.drop` | `cliOnly` | `direct` | `shipped` | snapback fork drop | — | operating/instance-forks.md#inspect-review-and-dispose-forks |
| `cli.fork.list` | `cliOnly` | `direct` | `shipped` | snapback fork list | — | operating/instance-forks.md#inspect-review-and-dispose-forks |
| `cli.fork.reap` | `cliOnly` | `direct` | `shipped` | snapback fork reap | — | operating/instance-forks.md#inspect-review-and-dispose-forks |
| `cli.migrate.apply` | `cliOnly` | `direct` | `shipped` | snapback migrate apply | — | backend/migrations.md#run-the-reviewed-loop |
| `cli.migrate.approve` | `cliOnly` | `direct` | `shipped` | snapback migrate approve | — | backend/migrations.md#run-the-reviewed-loop |
| `cli.migrate.cancel` | `cliOnly` | `direct` | `shipped` | snapback migrate cancel | — | backend/migrations.md#run-the-reviewed-loop |
| `cli.migrate.preview` | `cliOnly` | `direct` | `shipped` | snapback migrate preview | — | backend/migrations.md#run-the-reviewed-loop |
| `cli.migrate.rehearse` | `cliOnly` | `direct` | `shipped` | snapback migrate rehearse | — | backend/migrations.md#run-the-reviewed-loop |
| `cli.migrate.rollback` | `cliOnly` | `unavailable` | `unbuilt` | snapback migrate rollback | — | backend/migrations.md#verify-cancel-and-the-unbuilt-rollback |
| `cli.migrate.verify` | `cliOnly` | `direct` | `shipped` | snapback migrate verify | — | backend/migrations.md#run-the-reviewed-loop |
| `cli.packaged.accept` | `cliOnly` | `direct` | `shipped` | snapback accept | — | testing/acceptance.md#the-backend-comparator-profile |
| `cli.packaged.agent` | `cliOnly` | `direct` | `shipped` | snapback agent | — | operating/agent-controls.md#native-resource-availability |
| `cli.packaged.audit` | `cliOnly` | `direct` | `shipped` | snapback audit | — | deploying/releases.md#verify-the-control-audit-chain |
| `cli.packaged.backup` | `cliOnly` | `direct` | `shipped` | snapback backup | — | deploying/releases.md#inspect-retained-backups |
| `cli.packaged.deploy` | `cliOnly` | `direct` | `shipped` | snapback deploy | — | deploying/releases.md#build-and-verify-the-release-closure |
| `cli.packaged.dev` | `cliOnly` | `direct` | `shipped` | snapback dev | — | getting-started/the-authoring-loop.md |
| `cli.packaged.doctor` | `cliOnly` | `direct` | `shipped` | snapback doctor | — | operating/diagnostics.md#diagnose-the-vendored-ibex-runtime-first |
| `cli.packaged.generate` | `cliOnly` | `direct` | `shipped` | snapback generate | — | getting-started/the-authoring-loop.md#2-regenerate |
| `cli.packaged.guide` | `cliOnly` | `direct` | `shipped` | snapback guide | — | index.md |
| `cli.packaged.hosted` | `cliOnly` | `direct` | `shipped` | snapback hosted | — | deploying/releases.md#qualify-an-adapter-and-prepare-a-release |
| `cli.packaged.inspect` | `cliOnly` | `direct` | `shipped` | snapback inspect | — | deploying/releases.md#query-bounded-logs-and-authenticated-inspection |
| `cli.packaged.logs` | `cliOnly` | `direct` | `shipped` | snapback logs | — | deploying/releases.md#query-bounded-logs-and-authenticated-inspection |
| `cli.packaged.mcpControl` | `cliOnly` | `direct` | `shipped` | snapback mcp-control | — | operating/agent-controls.md#native-resource-availability |
| `cli.packaged.new` | `cliOnly` | `direct` | `shipped` | snapback new | — | getting-started/the-authoring-loop.md |
| `cli.packaged.reset` | `cliOnly` | `direct` | `shipped` | snapback reset | — | backend/versioned-seeds.md#expect-the-reset-blast-radius-on-connected-clients |
| `cli.packaged.restore` | `cliOnly` | `direct` | `shipped` | snapback restore | — | deploying/releases.md#restore-into-an-isolated-destination-then-activate-explicitly |
| `cli.packaged.runtimeQualify` | `cliOnly` | `direct` | `shipped` | snapback runtime-qualify | — | operating/diagnostics.md#report-the-runtimes-own-readiness-identity |
| `cli.packaged.target` | `cliOnly` | `direct` | `shipped` | snapback target | — | deploying/releases.md#register-one-exact-containervm-target |
| `cli.packaged.verify` | `cliOnly` | `direct` | `shipped` | snapback verify | — | testing/verify.md#author-snapbackverifyconfigmjs |
| `cli.telemetry.query` | `cliOnly` | `direct` | `shipped` | snapback telemetry query | — | operating/observability.md#use-the-local-sql-hatch-for-bounded-investigations |
| `client-mutations.purge` | `apiOnly` | `internal` | `shipped` | — | — | sync/offline-and-retention.md#replay-and-settle-without-guessing |
| `config.plan` | `native` | `direct` | `shipped` | snapback config plan | snapback_config_plan | operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify |
| `config.set` | `cliOnly` | `direct` | `shipped` | snapback config set --entry <name> (--value-stdin\|--value-fd N) | — | operating/secrets-and-config.md#set-an-agent-held-value-without-exposing-it |
| `config.status` | `native` | `direct` | `shipped` | snapback config status | snapback_config_status | operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify |
| `config.unset` | `native` | `direct` | `shipped` | snapback config unset | snapback_config_unset | operating/secrets-and-config.md#set-and-inspect-config |
| `config.verify` | `native` | `direct` | `shipped` | snapback config verify <entry> | snapback_config_verify | operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify |
| `connection.disconnect` | `native` | `direct` | `shipped` | snapback connections disconnect | snapback_connection_disconnect | operating/host-ops.md#controlled-mutations-config-cron-jobs-connections |
| `console.approval.approve` | `cliOnly` | `mediated` | `shipped` | snapback admin approve | — | operating/admin-console.md#authenticate-the-operator-surface |
| `console.approval.poll` | `cliOnly` | `mediated` | `shipped` | snapback admin approve | — | operating/admin-console.md#authenticate-the-operator-surface |
| `console.approval.request` | `cliOnly` | `mediated` | `shipped` | snapback admin approve | — | operating/admin-console.md#authenticate-the-operator-surface |
| `console.credential` | `apiOnly` | `internal` | `shipped` | — | — | operating/admin-console.md#authenticate-the-operator-surface |
| `console.reachability.bind` | `apiOnly` | `internal` | `shipped` | — | — | operating/admin-console.md#open-a-phone-console-on-the-local-network |
| `console.reachability.drop` | `apiOnly` | `internal` | `shipped` | — | — | operating/admin-console.md#open-a-phone-console-on-the-local-network |
| `console.reachability.register` | `apiOnly` | `internal` | `shipped` | — | — | operating/admin-console.md#open-a-phone-console-on-the-local-network |
| `console.reachability.renew` | `apiOnly` | `internal` | `shipped` | — | — | operating/admin-console.md#open-a-phone-console-on-the-local-network |
| `control.catalog.describe` | `native` | `direct` | `shipped` | snapback controls describe <operation> | snapback-controls://operation/{operation} | operating/agent-controls.md#describe-one-operation |
| `control.catalog.instance.read` | `mcpOnly` | `direct` | `shipped` | — | snapback-controls://instance | operating/agent-controls.md#build-versus-instance-identity |
| `control.catalog.read` | `native` | `direct` | `shipped` | snapback controls list | snapback-controls://catalog | operating/agent-controls.md#search-the-build-catalog |
| `cron.list` | `native` | `direct` | `shipped` | snapback cron list | snapback_cron_list | backend/cron.md#inspect-declared-jobs-and-runtime-posture |
| `cron.runOne` | `native` | `direct` | `shipped` | snapback cron run | snapback_cron_run | backend/cron.md#test-deterministically |
| `cron.status.read` | `apiOnly` | `direct` | `shipped` | — | — | backend/cron.md#inspect-declared-jobs-and-runtime-posture |
| `cron.tick` | `native` | `direct` | `shipped` | snapback cron tick | snapback_cron_tick | backend/cron.md#test-deterministically |
| `data.patch.apply` | `native` | `direct` | `shipped` | snapback data patch --apply --input <file\|-> | snapback_data_patch_apply | operating/data-patch.md#apply |
| `data.patch.preview` | `native` | `direct` | `shipped` | snapback data patch --preview --input <file\|-> | snapback_data_patch_preview | operating/data-patch.md#preview |
| `data.scan` | `native` | `direct` | `shipped` | snapback data scan <table> | snapback_data_scan | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `debug.live.forceResync` | `native` | `direct` | `shipped` | snapback debug force-resync | snapback_live_force_resync | operating/host-ops.md#served-request-operations |
| `debug.networkProfileGet` | `native` | `direct` | `shipped` | snapback network-profile get | snapback_network_profile_get | operating/network-profiles.md#set-or-inspect-a-profile-from-the-cli |
| `debug.networkProfileSet` | `native` | `direct` | `shipped` | snapback network-profile set | snapback_network_profile_set | operating/network-profiles.md#set-or-inspect-a-profile-from-the-cli |
| `direct_runner.action` | `apiOnly` | `direct` | `shipped` | — | — | operating/host-ops.md#send-one-operation-receive-one-envelope |
| `direct_runner.mutation` | `apiOnly` | `direct` | `shipped` | — | — | operating/host-ops.md#send-one-operation-receive-one-envelope |
| `direct_runner.query` | `apiOnly` | `direct` | `shipped` | — | — | operating/host-ops.md#send-one-operation-receive-one-envelope |
| `direct_runner.unknown` | `apiOnly` | `unavailable` | `shipped` | — | — | operating/diagnostics.md#assert-on-codes-not-prose |
| `ephemeral.cleanup` | `native` | `direct` | `shipped` | snapback ephemeral cleanup | snapback_ephemeral_cleanup | realtime/ephemeral-state.md#clean-up-expired-entries-operationally |
| `ephemeral.operatorDelete` | `native` | `direct` | `shipped` | snapback ephemeral operator-delete | snapback_ephemeral_operator_delete | realtime/ephemeral-state.md#delete-one-entry-as-an-operator |
| `errors.issue` | `native` | `direct` | `shipped` | snapback errors issue | snapback_errors_issue | operating/host-ops.md#served-request-operations |
| `errors.issues` | `native` | `direct` | `shipped` | snapback errors issues | snapback_errors_issues | operating/host-ops.md#served-request-operations |
| `errors.transition` | `native` | `direct` | `shipped` | snapback errors transition | snapback_errors_transition | operating/host-ops.md#served-request-operations |
| `function.explain` | `apiOnly` | `direct` | `shipped` | — | — | operating/host-ops.md#send-one-operation-receive-one-envelope |
| `function.run` | `native` | `direct` | `shipped` | snapback run | snapback_run_function | operating/host-ops.md#served-request-operations |
| `functions.load` | `native` | `direct` | `shipped` | snapback load --functions <path> | snapback_load_functions | getting-started/the-authoring-loop.md#2-regenerate |
| `functions.reload` | `apiOnly` | `unavailable` | `unbuilt` | — | — | getting-started/the-authoring-loop.md#2-regenerate |
| `health` | `apiOnly` | `direct` | `shipped` | — | — | operating/observability.md#check-health-and-recent-logs-in-the-console |
| `health.read` | `apiOnly` | `direct` | `shipped` | — | — | deploying/cloudflare.md#run-the-remote-proof |
| `host.restart` | `native` | `direct` | `shipped` | snapback restart --ready-file <path> | snapback_restart | operating/host-ops.md#restart-with-one-credential-bound-receipt |
| `host.start` | `cliOnly` | `direct` | `shipped` | snapback start | snapback_start | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `host.stop` | `cliOnly` | `direct` | `shipped` | snapback stop | snapback_stop | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `host.wait` | `cliOnly` | `direct` | `shipped` | snapback wait --ready-file <path> --level <host\|application> | — | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `hostCall.dispatch` | `none` | `internal` | `shipped` | — | — | — |
| `inspect` | `apiOnly` | `direct` | `shipped` | — | — | operating/observability.md#query-the-typed-operations-from-the-cli |
| `jobs.drain` | `native` | `direct` | `shipped` | snapback jobs drain | snapback_jobs_drain | operating/host-ops.md#controlled-mutations-config-cron-jobs-connections |
| `jobs.list` | `native` | `direct` | `shipped` | snapback jobs list | snapback_jobs_list | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `jobs.show` | `native` | `direct` | `shipped` | snapback jobs show <id> | snapback_jobs_show | operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1 |
| `object.evict` | `apiOnly` | `direct` | `shipped` | — | — | deploying/cloudflare.md#hibernation-reconnect-and-idle-to-zero |
| `operations.explain` | `apiOnly` | `direct` | `shipped` | — | — | operating/agent-controls.md#describe-one-operation |
| `push.maintenance` | `apiOnly` | `internal` | `shipped` | — | — | backend/expo-push.md#register-the-current-installation |
| `receipts` | `apiOnly` | `direct` | `shipped` | — | — | operating/diagnostics.md#consume-the-diagnostic-shape |
| `remediation.apply` | `native` | `direct` | `shipped` | snapback remediation apply --input <file\|-> | snapback_remediation_apply | operating/diagnostics.md#apply-a-remediation-safely |
| `route.unknown.refuse` | `none` | `internal` | `shipped` | — | — | — |
| `schema.load` | `native` | `direct` | `shipped` | snapback load --schema <path> | snapback_load_schema | getting-started/the-authoring-loop.md#2-regenerate |
| `schema.reload` | `apiOnly` | `unavailable` | `unbuilt` | — | — | getting-started/the-authoring-loop.md#2-regenerate |
| `secretRead.mint` | `cliOnly` | `direct` | `shipped` | snapback secret-read-mint | — | operating/host-ops.md#mint-a-scoped-secret-read-lease |
| `storage.operation-coverage.activate` | `apiOnly` | `direct` | `shipped` | — | — | operating/agent-controls.md#specialist-api-operations-apionly |
| `storage.protected-erasure` | `apiOnly` | `direct` | `shipped` | — | — | operating/agent-controls.md#specialist-api-operations-apionly |
| `telemetry.events` | `native` | `direct` | `shipped` | snapback telemetry events | snapback_telemetry_events | operating/observability.md#query-the-typed-operations-from-the-cli |
| `telemetry.export` | `native` | `direct` | `shipped` | snapback telemetry export | snapback_telemetry_export | operating/observability.md#query-the-typed-operations-from-the-cli |
| `telemetry.stats` | `native` | `direct` | `shipped` | snapback telemetry stats | snapback_telemetry_stats | operating/observability.md#query-the-typed-operations-from-the-cli |
| `test.<subpath-determined-by-coordinator>` | `none` | `internal` | `shipped` | — | — | — |
| `test.corruptMeta` | `none` | `internal` | `shipped` | — | — | — |
<!-- END GENERATED CONTROL CATALOG: CONTROL CATALOG INVENTORY -->

## Specialist API operations (apiOnly)

Two shipped operator operations are deliberately `apiOnly`: they have typed
HTTP contracts but no CLI or MCP tool yet (usage evidence drives promotion —
LLP 0184 OQ2). Both take the ordinary admin credential
(`x-snapback-admin-token` or `x-snapback-console-credential`) against the
local instance from your readiness descriptor.

### Permanently erase one protected row

`POST /_snapback/api/storage/protected-erasure` (LLP 0165). Body (closed):
`{"operationId": "<caller-minted retry id>", "qualifiedTable": "<table>",
"rowId": "<row id>"}`. Irreversibly deletes the canonical row and its
retained journal history, invalidates every registered checkpoint copy, and
returns a durable authority/target-bound receipt
(`protected-record-erasure.receipt-v1`). Copies that cannot be destroyed yet
are reported as `openObligations`; repeat the SAME `operationId` to resume
them — exact retries are idempotent, while reuse with a different authority
or target refuses. This is destructive and privacy/compliance-sensitive:
catalog posture is `humanApprovalRequired` — confirm with a human before
invoking. A refusal names the exact diagnostic; a fresh `operationId`
against an already-erased row fails target-not-found rather than
succeeding.

### Activate operation-coverage writer admission

`POST /_snapback/api/storage/operation-coverage/activate` (LLP 0163). Body
(closed, v1): `{"schemaVersion": 1, "target": "local-dev-sqlite-ibex",
"coverageProfile": "local-envelope-mapped-writers.v1"}`. Rechecks the closed
writer inventory, persists and arms the exact writer manifest (ordinary and
host-child lanes), and returns the active manifest
(`operation.coverage-activation-response-v1`); the manifest survives restart
and re-arms on database open. An exact repeat is idempotent. Activation
changes future write admission (covered writers then require envelope
authority) but deletes nothing — and success does **not** publish the
AgentSafe capability; LLP 0162/0163's performance, review, complete-target,
and author-acceptance gates remain independent.
