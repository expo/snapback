<!-- Generated operating section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/operating/agent-controls.md -->
---
title: Discover agent controls
id: operating.agent-controls
order: 1
audience: agent-first
capabilities: [operating.agent-controls]
authorities: [llp/0184-agent-accessible-control-plane.rfc.md, llp/0031-server-route-taxonomy.spec.md, llp/0042-agent-mcp-surface.rfc.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, crates/snapback-server/src/control_catalog.rs, crates/snapback-cli/src/cli.rs, packages/snapback-cli/expo-dev.mjs, packages/snapback-cli/mcp-control.mjs, packages/snapback-client/index.mjs]
examples: []
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:c6f055b8850cc49ee1f314336d29eb906bc70fadafe3c48d8e4f5e4ef9f90912
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

## Control a detached Expo dev supervisor

`snapback dev --expo --json` publishes an owner-bound Unix control socket in
the same state directory as its ready file. The default path is
`.snapback/dev-control.sock`; read the exact path and lifecycle binding from
the `controlSocket` field in `.snapback/expo-supervisor.json` or the final
`snapback.expo-dev.v1` readiness event. Do not guess a path or signal a process
by name.

The socket is mode `0600`, owned by the supervisor UID, and registered with
the instance cleanup lease so ordinary shutdown and owner death remove its
exact inode. The filesystem mode is the kernel-enforced client gate. The UID
repeated in command JSON is an advisory descriptor-consistency check, not a
peer-credential check and not a substitute for mode `0600`.

This is transient instance-local state: do not copy it with the database or
treat a leftover endpoint as durable owner authority. Each request must repeat
the descriptor's `ownerPid`, `ownerUid`, `ownerIncarnationId`, and
`lifecycleReceipt`:

```json fragment reason="illustrative descriptor-bound control request"
{"schemaVersion":"snapback.dev-control-command.v1","requestId":"reload-1","verb":"reload-metro","owner":{"pid":1234,"uid":501,"incarnationId":"supervisor-…"},"lifecycleReceipt":"sha256:…"}
```

One connection carries one newline-delimited request. A valid verb first
returns `snapback.dev-control-ack.v1` with the same request id, then a
`snapback.dev-control-result.v1` after the operation settles. All acknowledged
verbs share one serialized lane. Once `stop-children` is acknowledged, new
work refuses with `SNAPBACK_DEV_CONTROL_STOPPING`; every earlier acknowledged
request is allowed to send its result before the endpoint closes. Wait for the
result before claiming the operation took effect. A client that reaches EOF
before its newline, or stays incomplete for five seconds, is closed without
retaining a half-open connection.

The socket's closed verb set is:

| Verb | Settled result |
| --- | --- |
| `reload-metro` | Stops the owned Metro process group, launches Metro again on the same planned port, re-verifies listener ownership, updates `expo-supervisor.json`, and reports the previous and replacement PIDs. |
| `stop-children` | Reclaims the supervisor-owned backend, Metro, bootstrap exchange, front, and port forwards; flushes the result; then removes the socket and lets the CLI owner exit. |

An endpoint or request naming another UID, owner incarnation, or lifecycle
receipt refuses with `SNAPBACK_DEV_CONTROL_OTHER_UID`,
`SNAPBACK_DEV_CONTROL_FOREIGN_OWNER`, or
`SNAPBACK_DEV_CONTROL_STALE_INCARNATION`. A live listener is always a foreign
owner. On relaunch, the lifecycle owner itself may reclaim a dead leftover
only when connecting returns `ECONNREFUSED`, the inode is same-UID and
unchanged, and the prior supervisor descriptor binds that exact inode and
incarnation. That owner recovery is not client authority. A client must never
unlink or replace an endpoint to bypass a refusal.

Interactive humans keep the existing stdin channel: TTY keys remain
`s`/`r`/`R`/`f`/`q`, and non-TTY
`snapback.dev-command.v1` input remains available when a launcher preserves a
pipe. Stdin EOF still does not stop the supervisor. The socket is the supported
agent path when stdin is `/dev/null`; it is not a FIFO and does not add recook
as a client verb.

## Run functions against sessions mode

`snapback run --ready-file .snapback/dev.ready.json <public-query>` keeps its
default authority anonymous. After the local administrative projection reaches
its scoped secret-read boundary, the native CLI retries a query through the
ordinary `/query/{name}` app route with the auth-client v1 offer and no admin
token, session bearer, lease, or `userId`. The function manifest stays
authoritative: public queries run, while authenticated queries refuse with
`SNAPBACK_AUTH_REQUIRED` and the mint recovery remains
`snapback session mint --ready-file <path> --email <address>` followed by
`createExternalSessionClient(baseUrl, { bearerToken })` in trusted server/test
code. `--user` is the client-asserted dev-mode posture; do not use it against a
sessions target. This behavior resolves the
[sessions-target public-query refusal](repo:issues/closed/20260824-snapback-run-sessions-target-public-query-refusal.md).

## Generated inventory

<!-- BEGIN GENERATED CONTROL CATALOG: CONTROL CATALOG INVENTORY -->
The embedded build catalog contains **156 operations** at digest `sha256:9cb4837ed97a4812f82f9699f99471e7eb8a655f06fb2f260db1338824787369`. The counts and inventory below are generated; do not edit them by hand.

| Axis | Value | Count |
| --- | --- | ---: |
| surfaceAccess | `apiOnly` | 54 |
| surfaceAccess | `cliOnly` | 54 |
| surfaceAccess | `mcpOnly` | 2 |
| surfaceAccess | `native` | 42 |
| surfaceAccess | `none` | 4 |
| operability | `direct` | 117 |
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
| `cli.packaged.auth` | `cliOnly` | `direct` | `shipped` | snapback auth | — | clients/react-expo.md |
| `cli.packaged.author` | `cliOnly` | `direct` | `shipped` | snapback author | — | getting-started/the-authoring-loop.md#suggest-review-and-apply-a-result-contract |
| `cli.packaged.backup` | `cliOnly` | `direct` | `shipped` | snapback backup | — | deploying/releases.md#inspect-retained-backups |
| `cli.packaged.deploy` | `cliOnly` | `direct` | `shipped` | snapback deploy | — | deploying/releases.md#build-and-verify-the-release-closure |
| `cli.packaged.dev` | `cliOnly` | `direct` | `shipped` | snapback dev | — | getting-started/the-authoring-loop.md |
| `cli.packaged.doctor` | `cliOnly` | `direct` | `shipped` | snapback doctor | — | operating/diagnostics.md#diagnose-the-vendored-ibex-runtime-first |
| `cli.packaged.generate` | `cliOnly` | `direct` | `shipped` | snapback generate | — | getting-started/the-authoring-loop.md#2-regenerate |
| `cli.packaged.guide` | `cliOnly` | `direct` | `shipped` | snapback guide | — | index.md |
| `cli.packaged.hosted` | `cliOnly` | `direct` | `shipped` | snapback hosted | — | deploying/releases.md#qualify-an-adapter-and-prepare-a-release |
| `cli.packaged.init` | `cliOnly` | `direct` | `shipped` | snapback init | — | clients/react-expo.md |
| `cli.packaged.inspect` | `cliOnly` | `direct` | `shipped` | snapback inspect | — | deploying/releases.md#query-bounded-logs-and-authenticated-inspection |
| `cli.packaged.logs` | `cliOnly` | `direct` | `shipped` | snapback logs | — | deploying/releases.md#query-bounded-logs-and-authenticated-inspection |
| `cli.packaged.mcpControl` | `cliOnly` | `direct` | `shipped` | snapback mcp-control | — | operating/agent-controls.md#native-resource-availability |
| `cli.packaged.new` | `cliOnly` | `direct` | `shipped` | snapback new | — | getting-started/the-authoring-loop.md |
| `cli.packaged.replay` | `cliOnly` | `direct` | `shipped` | snapback replay | — | testing/large-fixtures.md#general-bulk-path-headless-replay |
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

---

<!-- snapback-guide-source: guide/operating/secrets-and-config.md -->
---
title: Secrets and deployment config
id: operating.secrets-and-config
order: 1
audience: agent-first
capabilities: [operating.secrets-config]
authorities: [llp/0036-app-secrets-and-config.rfc.md, llp/0184-agent-accessible-control-plane.rfc.md, crates/snapback-cli/src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/tests/acceptance/egress.mjs]
examples: [demos/all-aboard, crates/snapback/tests/config_set_cli_v0.rs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-06
reviewed-authorities-digest: sha256:c00bd2ab8122d44b8578bf83a5b38c5361a65dfab0d8fd1a5c9d7054002b1b94
---

# Secrets and deployment config

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback config is deployment state, separate from app rows. Apps declare
secret entries in source; operators set values through the setup/admin
surface; only actions explicitly naming an entry in `uses` receive a
redacting handle.

## Declare names and acquisition help, never values

`defineConfig` puts public metadata in the generated function manifest:

```js source=demos/all-aboard/snapback/functions.mjs
export const appConfig = defineConfig({
  caltrainFeed: {
    description: '511.org Open Data API key',
    purpose: 'Fetches Caltrain StopMonitoring predictions for live departure boards',
    required: false,
    pool: true,
```

The v1 entry inventory is: `description`, `purpose`, `required`
(default true), `pool`, optional action `probe`, `howToGet`, and
`acquisition` metadata for the setup wizard. V1 values are secret; defaults
and non-secret values are deliberately rejected.

Values never belong in source, manifests, seed data, LLPs, or demo diaries.

## Set and inspect config

Use `/_snapback/admin/setup` for the browser wizard or the admin-gated config
API/host operations for automation. The core operations are `status`,
`set`, `unset`, and `verify`, plus the read-only `plan` dry-run.

`status` reports declaration, set state, member count, source, generation,
and verification—never value bytes:

```js source=demos/all-aboard/tests/acceptance/egress.mjs
  await suite.check('config.status reports names and states, never values', async () => {
    const { status, body, raw } = await configApi(on, 'GET', 'status');
    assertEqual(status, 200, 'status is readable');
    const entry = body.entries.find((e) => e.name === 'feedKeys');
    assert(entry, 'feedKeys is declared');
```

`set` replaces a scalar/pool or appends a pool member; `unset` removes the
deployment value. `verify` invokes the entry's declared action probe and
records only its outcome. Config survives `app.reset` because reset owns app
data, not deployment custody.

### The callable routes

The repo kit's `configApi` helper above is a thin wrapper. Consumers outside
this repository call the routes directly. Every one is admin-gated
(`x-snapback-admin-token`), and the three value-carrying writes additionally
require a loopback bind — a non-loopback plaintext bind refuses with
`SNAPBACK_CONFIG_TRANSIT_RULE`, and an SSH tunnel to the instance is the
blessed remote path.

| Operation | Request | Body |
| --- | --- | --- |
| status | `GET /_snapback/api/config/status` | — |
| plan | `GET /_snapback/api/config/plan?entry=<name>` | — |
| set | `POST /_snapback/api/config/set` | `{ "entry": "<name>", "value": "<string>" }` |
| set (pool) | `POST /_snapback/api/config/set` | `{ "entry": "<name>", "values": ["a", "b"], "append": true }` |
| unset | `POST /_snapback/api/config/unset` | `{ "entry": "<name>" }` |
| verify | `POST /_snapback/api/config/verify` | `{ "entry": "<name>" }` |

`plan` is a read-only dry-run: it reports the write locus, apply boundary,
and whether this transport would accept a value write, without writing
anything (the `entry` query parameter is optional).

Exactly one of `value` or `values` must be present: sending both, neither, or
the plausible-but-wrong `{ entry, member }` spelling refuses with
`SNAPBACK_CONFIG_VALUE_INVALID` ("provide exactly one of value or values").
Values are strings; a nested object is a deserialization error, not a config
diagnostic. `append: true` adds pool members, `append: false` (the default)
replaces the entry.

The write responses carry the new generation and set-state; they never carry
value bytes, and neither does `status`, the diagnostics ring, or any log
line. Pass values in the request body — never in argv, where a process list
would leak them.

## CLI and MCP projections for status/plan/verify

`config.status`, `config.plan`, and `config.verify` never carry a secret
value, so they are direct CLI and control-MCP tools (LLP 0184 Phase 2 P1).
`config.unset` is direct CLI and control-MCP too because it carries only an
entry name. `config.set` is deliberately CLI-only: MCP JSON-RPC has no defined
equivalent of the process-scoped stdin/fd secret carrier.

```sh
snapback config status --ready-file .snapback/dev.ready.json
snapback config plan --ready-file .snapback/dev.ready.json --entry caltrainFeed
snapback config verify --ready-file .snapback/dev.ready.json caltrainFeed
snapback config unset --ready-file .snapback/dev.ready.json --entry caltrainFeed
```

or, through `snapback mcp-control`: `snapback_config_status`,
`snapback_config_plan` (optional `entry`), and `snapback_config_verify`
(required `entry`), plus `snapback_config_unset` (required `entry`). Every
result is the operation's typed, value-free envelope; a missing/unset entry is
reported as declared state, not fabricated success.

## Set an agent-held value without exposing it

Start by detecting the gap and checking whether this target accepts value
writes:

```sh
snapback config status --ready-file .snapback/dev.ready.json
snapback config plan --ready-file .snapback/dev.ready.json --entry caltrainFeed
```

If a human holds the value, send them to
`http://127.0.0.1:<port>/_snapback/admin/setup`. The browser setup page accepts
the value directly; it does not hand the value back to the agent, and there is
no speculative agent-facing acquisition operation. Afterward, the agent uses
`config status` and `config verify` to observe completion.

If the agent already lawfully holds the value, send its exact UTF-8 bytes on
stdin. Keep the value in a shell-local variable populated by the credential
source without echoing it; do not paste a literal into this command:

```sh
printf '%s' "$AGENT_HELD_VALUE" |
  snapback config set --ready-file .snapback/dev.ready.json \
    --entry caltrainFeed --value-stdin
```

`printf '%s'` is the carrier adapter, not a place to type the value. Do not
export the variable, enable shell tracing, or use `echo`: exported state is
needlessly inherited, tracing prints expansions, and `echo` can add or rewrite
bytes. The CLI preserves the carrier bytes exactly, including whitespace and
line endings, and caps the CLI value at 1 MiB.

An inherited descriptor avoids even a shell expansion. Open an owner-only
secret source, pass its descriptor number, then close it:

```sh
exec 9<./operator-owned-secret
snapback config set --ready-file .snapback/dev.ready.json \
  --entry caltrainFeed --value-fd 9
exec 9<&-
```

For a pooled entry, add one member with the same carrier plus `--append`.

A heredoc is usually the wrong carrier. Its body may be retained by shell
history or terminal capture, and the newline before the delimiter becomes part
of the value because Snapback does not trim secret bytes. Use a pipe from the
credential-owning process or an inherited descriptor unless that final newline
is deliberately part of the credential.

There is intentionally no `snapback config set ... --value <secret>` spelling.
Argv is visible to process inspection, commonly retained in shell history, and
often quoted in parser diagnostics. Config-set parse failures are therefore
collapsed to a stable value-free usage diagnostic instead of replaying argv.
There is also no `snapback_config_set` MCP tool: defining one would make the
ordinary JSON-RPC parameter/result channel a secret carrier.

Complete the flow with value-free observation:

```sh
snapback config status --ready-file .snapback/dev.ready.json
snapback config verify --ready-file .snapback/dev.ready.json caltrainFeed
```

## Read through a granted handle

An action names entries in `uses`, then reads `ctx.secrets.get(name)` for the
entry or `ctx.secrets.rotating(name)` for round-robin pool selection. Handle
stringification, interpolation, JSON, and
debug formatting redact. `.expose()` is the narrow, explicit materialization
for building an outbound request; keep the returned string local and
short-lived.

The acceptance proves accidental materialization stays redacted:

```js source=demos/all-aboard/tests/acceptance/egress.mjs
    assertEqual(config.stringified, JSON.stringify(REDACTED), 'JSON.stringify redacts');
    assertEqual(config.template, REDACTED, 'template literal redacts');
    assertEqual(config.concatenated, `prefix:${REDACTED}`, 'string concat redacts');
    assert(!config.stringified.includes('key-'), 'no key material in stringified form');
```

Queries and mutations have no `ctx.secrets`; actions cannot access an entry
outside `uses`. Missing and undeclared entries fail with stable
`SNAPBACK_CONFIG_*` diagnostics. Besides actions, the declared push seam
(`definePushSeam`) may also name entries in `uses`; that grant feeds the
engine-owned send lane, never a handler handle, and unknown names fail at
codegen with `CONFIG_USES_UNKNOWN` just as for actions.

## Anti-patterns

- **Do not put values in `defineConfig`.** It declares names and operator
  help only.
- **Do not pass secrets as function arguments or store them in app tables.**
  Use an action's granted handle.
- **Do not log or return `.expose()`.** Redaction protects the handle, not a
  copied plaintext string.
- **Do not treat `app.reset` as credential rotation.** Use `set`/`unset`
  and verification on the deployment config surface.

---

<!-- snapback-guide-source: guide/operating/host-ops.md -->
---
title: Host operations
id: operating.host-ops
order: 2
audience: agent-first
capabilities: [operating.host-ops]
authorities: [llp/0024-agent-operating-surface.spec.md, crates/snapback-cli/src/cli.rs, crates/snapback-engine/src/host_ops.rs, crates/snapback-server/src/server.rs, crates/snapback-server/src/admin_secret_read.rs, packages/snapback-cli/mcp-control.mjs, crates/snapback/tests/host_ops_v0.rs]
examples: [demos/todo]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:e276d9f43b744ac2d28a8c7ee4a09cf25f08bf77f6f2a92d9c4a63efa65fd3dd
---

# Host operations

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Host operations give CLIs and agent tools one typed operating surface. The
in-process implementation and `POST /_snapback/api/host-ops` return the same
`hostOpsResult` envelope; operation variants are classified in the route
registry instead of inheriting one overly broad HTTP policy.

## Send one operation, receive one envelope

A request names `operation` plus its typed fields:

```json source=crates/snapback/tests/host_ops_v0.rs
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "title": "from host-ops" },
            "userId": "user_ada",
        }),
```

Every response contains `schemaVersion`, `resultKind: "hostOpsResult"`,
`requestId`, `operation`, `ok`, `target`, optional `authority`,
`artifacts`, `data`, `diagnostics[]`, and `next[]`. A known-but-unbuilt
operation returns `ok: false` with a structured diagnostic, never a fake 404
or empty success.

`artifacts.databaseVersion` contains an integer only when the durable cursor
decodes as an exact portable value. If storage cannot supply a trustworthy
cursor, the envelope becomes `ok: false`, serializes that value as `null`, and
carries the storage diagnostic; tooling must not substitute zero.

## Served request operations

<!-- BEGIN GENERATED CONTROL CATALOG: HOST OPS SERVED -->
The endpoint serves **49 request spellings**. This count and table are generated from the build catalog's LLP 0024 allowlist projection:

| Request operation | Purpose |
| --- | --- |
| `app.inspect` | Inspect the running app |
| `app.readiness.v1` | Evaluate declared application readiness |
| `app.reset` | Reset local app state |
| `app.seed.clear.v1` | Clear the versioned seed installation |
| `app.seed.ensure.v1` | Ensure the versioned seed installation |
| `app.seed.preview.v1` | Preview a versioned seed installation |
| `app.seed.reset-install.v1` | Reset and install the versioned seed |
| `asset.delete` | Delete one asset |
| `asset.ensureSeedFixture` | Ensure the asset seed fixture |
| `asset.exportCut` | Export a consistent asset cut |
| `asset.gcSweep` | Sweep reclaimable asset storage |
| `asset.importCut` | Import a consistent asset cut |
| `asset.inspect` | Inspect one asset |
| `asset.list` | List assets by availability |
| `asset.put` | Upload one asset |
| `asset.retry` | Retry pending asset work |
| `asset.rotateSigningKey` | Rotate the asset delivery signing key |
| `auth.integrationResume` | Resume an authentication integration through host ops |
| `auth.integrationRetire` | Retire an authentication integration through host ops |
| `auth.integrationSuspend` | Suspend an authentication integration through host ops |
| `auth.mintSession` | Mint a local test session |
| `auth.rehearsal.exercise` | Exercise an authentication rehearsal grant |
| `auth.rehearsal.mint` | Mint an authentication rehearsal grant |
| `auth.rehearsal.revoke` | Revoke an authentication rehearsal grant |
| `auth.rehearsal.status` | Read authentication rehearsal status |
| `auth.rescueCollidingTable` | Rescue a table colliding with sessions mode |
| `branch.create.v1` | Create a backend branch |
| `branch.drop.v1` | Drop a backend branch |
| `branch.execute.v1` | Execute against a backend branch |
| `branch.inspect.v1` | Inspect a backend branch |
| `branch.list.v1` | List backend branches |
| `branch.reap.v1` | Reap expired backend branches |
| `cron.list` | List cron jobs |
| `data.patch.apply` | Apply a bounded row patch |
| `data.patch.preview` | Preview a bounded row patch |
| `debug.live.forceResync` | Force a live subscription resync |
| `debug.networkProfileGet` | Read the active network profile |
| `debug.networkProfileSet` | Set a simulated network profile |
| `errors.issue` | Inspect one error issue |
| `errors.issues` | List error issues |
| `errors.transition` | Transition an error issue |
| `function.explain` | Explain a generated function |
| `function.run` | Run one generated function |
| `functions.load` | Load the generated function manifest |
| `remediation.apply` | Apply a generation-fenced remediation |
| `schema.load` | Load the generated schema manifest |
| `telemetry.events` | Read a bounded telemetry event page |
| `telemetry.export` | Export bounded telemetry |
| `telemetry.stats` | Read aggregate telemetry health |
<!-- END GENERATED CONTROL CATALOG: HOST OPS SERVED -->

## Mint a session over HTTP

`auth.mintSession` is the non-production host operation for a trusted
server-side identity broker. Prefer the paved CLI projection,
`snapback session mint --email <address> --ready-file <path>`, when the broker
can invoke it. When the broker must use HTTP, the exact endpoint is
`POST /_snapback/api/host-ops` with `content-type: application/json`, the
AdminWrite token in `x-snapback-admin-token`, and the process-bound
impersonation capability in `x-snapback-impersonation-capability`:

```sh
curl --fail-with-body \
  -H 'content-type: application/json' \
  -H "x-snapback-admin-token: $SNAPBACK_ADMIN_TOKEN" \
  -H "x-snapback-impersonation-capability: $SNAPBACK_IMPERSONATION_CAPABILITY" \
  --data '{"operation":"auth.mintSession","args":{"email":"person@example.test"}}' \
  "$SNAPBACK_ORIGIN/_snapback/api/host-ops"
```

The body is closed: it contains `operation: "auth.mintSession"`, an optional
string `requestId`, and `args` with exactly one required string member,
`email`. Any extra member refuses, including `role` inside `args`, `input`, or
a stray top-level `userId`. The stable refusal is
`SNAPBACK_AUTH_REQUEST_INVALID`; its safe `details` name
`operation: "auth.mintSession"`, carry the closed
`expectedArgumentContract`, and point `guideAnchor` back to this section.
They never echo the submitted email or request bytes.

HTTP returns 200 once a `hostOpsResult` envelope exists. Read the outcome from
the envelope's `ok` and `diagnostics[]`, not from the transport status. On
success, `diagnostics` is empty and `data` has exactly these five members:

```json fragment reason="Credential values, identifiers, and timestamps are runtime-owned per mint."
{
  "token": "sbs_…",
  "tokenType": "Bearer",
  "session": {
    "id": "ses_…",
    "userId": "usr_…",
    "provider": "email-code",
    "createdAt": 1786300000000,
    "expiresAt": 1786303600000,
    "absoluteExpiresAt": 1786904800000
  },
  "refreshAfter": 1786301800000,
  "authorityDescriptor": {
    "descriptorVersion": 1,
    "authorityInstanceId": "aut_…",
    "sessionGeneration": 1
  }
}
```

Minting is available only after Sessions mode is settled and active, on a
non-production server profile, and when all three independent authorities are
present: the AdminWrite token, the process-bound impersonation capability, and
active sessions mode. It is for local dev, test, and demo identity brokerage,
not hosted production identity. Responses are `cache-control: no-store,
private`. Keep both request authorities and the returned `sbs_…` bearer in
trusted server custody; never put them in a browser/native app bundle, logs, or
an app-visible environment variable.

`snapback session mint --email <address> --ready-file <path>` projects
`auth.mintSession` through the same target and authority handling and prints only
the resulting `hostOpsResult` JSON.

`snapback debug force-resync` projects `debug.live.forceResync`: a
non-production debug perturbation forcing exactly one live subscription
through the normal `resync_required` recovery path, changing no application
data. `--connection-id` and `--subscription-id` name the one subscription;
`--reason` is recorded in the printed receipt; `--clear-retained` makes the
client also discard retained rows rather than keep them until the fresh
snapshot lands; `--startup-nonce` defaults from the `--ready-file`
descriptor and must be given explicitly only when targeting `--url`
directly. The MCP projection is `snapback_live_force_resync`.

The six `branch.*.v1` operations are the closed operator surface for managed
in-app branches
([LLP 0162 §3](repo:llp/0162-agent-safe-storage-profile.rfc.md)). Each
accepts its closed v1 body only under `input` (with `schemaVersion: 1`),
refuses legacy sibling fields, and is registered AdminWrite; paths and
grants are server-owned.

`host.start` and `host.stop` are CLI-only lifecycle verbs—a running server
cannot safely own starting/stopping itself; over HTTP they fail as
`SNAPBACK_HOST_OP_CLI_ONLY`. `host.restart` has native CLI and MCP
projections, but its registered HTTP identity deliberately returns the same
CLI-only refusal.

## Restart with one credential-bound receipt

```sh fragment reason="The ready descriptor is a runtime-owned capability path."
snapback restart --ready-file .snapback/dev.ready.json \
  --reason "reload native dependency"
```

Both `snapback restart` and `snapback_restart` compose stop then start under
one request id and one `host.restart` envelope. Before any process signal,
they resolve a concrete administrator token and prove it through
`app.inspect` on the AdminRead-gated host-ops route; a missing or refused
credential leaves the old server running. The stop leg independently checks
the descriptor's startup nonce, and the start leg accepts only a successor
descriptor with the same database and a new startup nonce. Credentials never
enter child argv or the receipt. The fresh-spawn leg has no prior server
credential to hold.

`schema.reload`, `functions.reload`, and `acceptance.run` are pinned but
unbuilt and fail as `SNAPBACK_HOST_OP_UNIMPLEMENTED`. All three families are
registered at AdminWrite so an authenticated request reaches that structured
envelope; unknown names stay unregistered and fail closed before dispatch.

## Registered operation identities

<!-- BEGIN GENERATED CONTROL CATALOG: HOST OPS REGISTERED -->
The request spellings above expand into **62 registered operation identities**. This inventory is generated from each catalog row's LLP 0031 registry projection:

1. `host_ops.acceptance.run`
2. `host_ops.app.inspect`
3. `host_ops.app.readiness.v1`
4. `host_ops.app.reset`
5. `host_ops.app.seed.clear.v1`
6. `host_ops.app.seed.ensure.v1`
7. `host_ops.app.seed.preview.v1`
8. `host_ops.app.seed.reset-install.v1`
9. `host_ops.asset.delete`
10. `host_ops.asset.ensureSeedFixture`
11. `host_ops.asset.exportCut`
12. `host_ops.asset.gcSweep`
13. `host_ops.asset.importCut`
14. `host_ops.asset.inspect`
15. `host_ops.asset.list`
16. `host_ops.asset.put`
17. `host_ops.asset.retry`
18. `host_ops.asset.rotateSigningKey`
19. `host_ops.auth.integrationResume`
20. `host_ops.auth.integrationRetire`
21. `host_ops.auth.integrationSuspend`
22. `host_ops.auth.mintSession`
23. `host_ops.auth.rehearsal.exercise`
24. `host_ops.auth.rehearsal.mint`
25. `host_ops.auth.rehearsal.revoke`
26. `host_ops.auth.rehearsal.status`
27. `host_ops.auth.rescueCollidingTable`
28. `host_ops.branch.create.v1`
29. `host_ops.branch.drop.v1`
30. `host_ops.branch.execute.v1`
31. `host_ops.branch.inspect.v1`
32. `host_ops.branch.list.v1`
33. `host_ops.branch.reap.v1`
34. `host_ops.cron.list`
35. `host_ops.data.patch.apply`
36. `host_ops.data.patch.apply.impersonated`
37. `host_ops.data.patch.preview`
38. `host_ops.data.patch.preview.impersonated`
39. `host_ops.debug.live.forceResync`
40. `host_ops.debug.networkProfileGet`
41. `host_ops.debug.networkProfileSet`
42. `host_ops.errors.issue`
43. `host_ops.errors.issues`
44. `host_ops.errors.transition`
45. `host_ops.function.explain`
46. `host_ops.function.explain.impersonated`
47. `host_ops.function.run.query`
48. `host_ops.function.run.mutation`
49. `host_ops.function.run.action`
50. `host_ops.function.run.unknown`
51. `host_ops.function.run.impersonated`
52. `host_ops.functions.load`
53. `host_ops.functions.reload`
54. `host_ops.host.restart`
55. `host_ops.host.start`
56. `host_ops.host.stop`
57. `host_ops.remediation.apply`
58. `host_ops.schema.load`
59. `host_ops.schema.reload`
60. `host_ops.telemetry.events`
61. `host_ops.telemetry.export`
62. `host_ops.telemetry.stats`
<!-- END GENERATED CONTROL CATALOG: HOST OPS REGISTERED -->

Query/explain reads, durable writes, credential-producing operations, and
dev impersonation therefore keep distinct `RoutePolicy`, authority, effect,
and response-sensitivity classifications even though they share one carrier.

## Direct CLI/MCP projections beyond host-ops (LLP 0184 Phase 2 P1)

Some agent-relevant reads live on their own `SystemApi` routes rather than
the `/_snapback/api/host-ops` multiplexer above. Each now has a direct CLI
command and a control-MCP tool:

| Operation | CLI | MCP tool |
| --- | --- | --- |
| `data.scan` | `snapback data scan <table> [--limit N] [--offset N]` | `snapback_data_scan` |
| `jobs.list` | `snapback jobs list` | `snapback_jobs_list` |
| `jobs.show` | `snapback jobs show <id>` | `snapback_jobs_show` |

`data.scan` projects `DataQuery` exactly as shipped — `table`, `limit`,
`offset` — and **has no cursor**: the route does not have one. Offset paging
is not stable under concurrent writes; a row can shift between pages between
two calls issued moments apart. Prefer a narrow `--limit`, and treat a scan
as a snapshot-ish sample rather than a guaranteed-complete enumeration under
write load. A stable/snapshot-bound cursor would be a new storage semantic
and is out of this projection's scope.

```sh
snapback data scan messages --limit 20 --ready-file .snapback/dev.ready.json
```

Both `data.scan` and the CLI's `secret-read-mint` mint a scoped,
row/byte-budgeted secret-read lease automatically from the local readiness
descriptor when one is not supplied — never by reading an arbitrary URL for
credentials. `jobs.list`/`jobs.show` are the read-only half of LLP 0070's
one-off job surface; draining jobs is a separate, mutating operation this
slice does not add.

Three `host-ops` asset operations also gained MCP tools this phase — the CLI
paths (`snapback assets list|inspect|retry`) were already shipped:

| Operation | MCP tool |
| --- | --- |
| `asset.list` | `snapback_asset_list` |
| `asset.inspect` | `snapback_asset_inspect` |
| `asset.retry` | `snapback_asset_retry` |

The mutating asset operations also have direct MCP tools:
`snapback_asset_delete`, `snapback_asset_gc_sweep`,
`snapback_asset_rotate_signing_key`, `snapback_asset_export_cut`, and
`snapback_asset_import_cut`. Only `asset.put` and `asset.ensureSeedFixture`
stay CLI-only — see `snapback assets --help`.

## Respect admin, secret-read, and impersonation gates

The admin credential authenticates the transport; it does not silently invent
an app caller. In sessions mode, sensitive query/explain results additionally
require the bounded admin-secret-read lease. An impersonated branch requires
the process-bound capability and is unavailable in production. Destructive
reset, versioned reset-install, and versioned clear run through the same
authorization-stream coordinator and fail closed if that projection is
unavailable. Every `app.seed.*.v1` operation is AdminWrite + NonProd,
including preview. Its Rust-owned body belongs only under `input`; legacy
`seed`/`schema`/`functions` siblings are refused.

The partial local `servicePrincipal`/scoped-token slice is admitted only by
generated app-data calls. Host operations—including `function.run`—do not
resolve scoped tokens into authority; use the operation's explicit admin or
dev-impersonation gate instead.

## Mint a scoped secret-read lease

Sensitive raw reads — telemetry events and export, error-issue detail,
admin-credentialed inspect projections, receipts — require a short-lived,
budgeted secret-read lease in addition to the admin credential. Commands
addressed by `--ready-file` mint one automatically. When a command targets
`--url` directly, or another tool needs an explicit lease, mint one from the
readiness descriptor:

```sh
snapback secret-read-mint --ready-file .snapback/dev.ready.json --telemetry-events
```

This is deliberately a ready-file-only operation: the proof root is local
operator authority and can never be discovered from a URL. The printed JSON
carries the `sbrl_` bearer in its `lease` field; pass it as
`--secret-read-lease` on `snapback telemetry events|export` and
`snapback errors issue`, or as the `x-snapback-secret-read-lease` header on
a raw HTTP request.

Scope flags select what the lease can read, and every scope must be named
explicitly: `--table <name>`, `--function <name>`, and
`--explain-function <name>` (each repeatable), plus the boolean scopes
`--telemetry-events`, `--telemetry-export`, `--errors-issue`,
`--admin-inspect`, and `--receipts`. Budget flags bound the lease:
`--ttl-seconds` (default 60), `--row-budget` (default 500), and
`--byte-budget` (default 1,048,576).

## Controlled mutations: config, cron, jobs, connections

These operations sit beside the host-ops multiplexer — each is its own
admin-gated `POST /_snapback/api/...` route, not a `host-ops` request — but
now have the same direct CLI and control-MCP shape (LLP 0184 §P2's
"controlled mutations" projections). Each is `AdminWrite` and every CLI form
below accepts the same `--url`/`--ready-file`/`--token` target flags as
`snapback inspect`.

`config.unset` removes one config entry's stored value. It carries only the
entry identifier — no secret value crosses the wire, so it needs no secret
carrier (unlike `config.set`, which stays CLI-only pending a defined MCP
secret carrier):

```sh
snapback config unset --entry stripe.secretKey --ready-file .snapback/dev.ready.json
```

or `snapback_config_unset` (`{ "entry": "stripe.secretKey" }`) through
`snapback mcp-control`.

`cron.tick` force-claims and runs every currently-due cron job; `cron.runOne`
force-runs one named job regardless of its schedule:

```sh
snapback cron tick --ready-file .snapback/dev.ready.json
snapback cron run nightly-digest --ready-file .snapback/dev.ready.json
```

or `snapback_cron_tick` / `snapback_cron_run` (`{ "name": "nightly-digest" }`).

`jobs.drain` claims and runs due one-off jobs under an injected clock — the
deterministic seam that lets acceptance suites drive due-ness without
sleeping, instead of the wall clock `cron.tick` uses:

```sh
snapback jobs drain --ready-file .snapback/dev.ready.json --now-ms 1700000000000 --max-waves 3
```

or `snapback_jobs_drain` (`{ "nowMs": 1700000000000, "maxWaves": 3 }`, both
optional — absent `nowMs` means wall clock).

`connection.disconnect` is an explicit **debug perturbation** of one live
connection — force-closing a connection for local recovery/repair testing.
It is never application disconnect authority: the underlying route accepts
no request body, so `reason` is recorded in the CLI/MCP receipt for the
caller's own audit trail, not acknowledged by the server.

```sh
snapback connections disconnect conn_01h8x2 --reason "stuck presence repair" --ready-file .snapback/dev.ready.json
```

or `snapback_connection_disconnect` (`{ "connectionId": "conn_01h8x2", "reason": "stuck presence repair" }`).

## Anti-patterns

- **Do not call internal Rust methods from tooling.** Use the envelope so CLI
  and HTTP behavior stay identical.
- **Do not treat all host ops as AdminWrite.** The registry's kind-specific
  policy is part of the security boundary.
- **Do not interpret an unimplemented diagnostic as an absent operation.**
  Pinned future verbs fail explicitly.
- **Do not place credentials in request ids, logs, or `next[]`.** Credential
  operations use their dedicated response-sensitivity path.

---

<!-- snapback-guide-source: guide/operating/network-profiles.md -->
---
title: Network condition profiles
id: operating.network-profiles
order: 2
audience: agent-first
capabilities: [operating.network-profiles]
authorities: [llp/0167-network-condition-profiles.rfc.md]
examples: [demos/zero-bakeoff]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-05
reviewed-authorities-digest: sha256:430e7d2de7660d7ca5a556dd5ff753626578baa669e46f85e8a72728448a3c55
---

# Network condition profiles

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use a network condition profile when you need real Snapback responses to arrive
slowly while commits and server-side ordering remain unchanged. The delay is
applied on the server's mutation-ack, live-delta, and query-response egress
lanes, so optimistic UI, settlement, and convergence experience the same
conditions an actual client would.

## Choose a built-in or custom profile

Snapback ships three built-ins:

| Profile | Mutation ack | Live delta | Query response | Jitter | Use it for |
| --- | ---: | ---: | ---: | ---: | --- |
| `normal` | 0 ms | 0 ms | 0 ms | 0 ms | Ordinary operation; the identity profile. |
| `optimistic` | 1,000 ms | 1,000 ms | 0 ms | 0 ms | Exercising optimistic UI and coordinated post-commit settlement. |
| `demo-slow` | 2,000 ms | 2,000 ms | 2,000 ms | 250 ms | Making slow-server behavior visible in a demo. |

Anywhere a built-in name is accepted, you may instead supply an inline JSON
object with a name and the three lane delays. `jitterMs` is optional and
defaults to zero. This is the real `demo-slow` shape from the zero-bakeoff
acceptance environment:

```json source=demos/zero-bakeoff/protocol/environment.v2.json
{
      "name": "demo-slow",
      "mutationAckDelayMs": 2000,
      "liveDeltaDelayMs": 2000,
      "queryResponseDelayMs": 2000,
      "jitterMs": 250
    }
```

## Set or inspect a profile from the CLI

Address the running server through its readiness file. `get` is read-only;
`set` uses the ordinary admin-write authority and returns the structured
`hostOpsResult` envelope.

```sh
snapback network-profile get --ready-file .snapback/dev.ready.json
snapback network-profile set optimistic --ready-file .snapback/dev.ready.json
snapback network-profile set demo-slow --ready-file .snapback/dev.ready.json
```

Pass custom JSON as the positional profile value:

```sh
snapback network-profile set '{"name":"ack-slow","mutationAckDelayMs":1500,"liveDeltaDelayMs":0,"queryResponseDelayMs":0,"jitterMs":0}' --ready-file .snapback/dev.ready.json
```

## Give an agent the same control through MCP

The tools are exposed by `snapback mcp-control` and call the same host
operations as the CLI:

| Intent | MCP tool | Input |
| --- | --- | --- |
| Read the active profile and provenance | `snapback_network_profile_get` | No input. |
| Activate a profile | `snapback_network_profile_set` | `profile` is a built-in name or the inline object above; `operatorPrincipal` is optional. |

The underlying operations are `debug.networkProfileGet` and
`debug.networkProfileSet`. The latter is mutating even though a profile does
not change durable app data. Use `snapback_network_profile_set` with
`profile: "normal"` as the MCP restore step.

## Select a profile at server startup

Set `SNAPBACK_NETWORK_PROFILE` to a built-in name or inline JSON before the
server starts:

```sh
SNAPBACK_NETWORK_PROFILE=optimistic \
  snapback start --memory --ready-file .snapback/dev.ready.json
```

This is startup configuration. Restarting with the same environment selects
the profile again, and a non-`normal` selection is re-announced in startup and
readiness output. Startup selection still passes through the same activation
gate as every runtime control.

## Read or change the profile through the admin API

The admin API exposes one path with policy split by method:

| Request | Authority | Body |
| --- | --- | --- |
| `GET /_snapback/api/debug/network-profile` | `AdminRead` | None. |
| `PUT /_snapback/api/debug/network-profile` | `AdminWrite` | A JSON built-in name such as `"optimistic"`, or the inline profile object. |

For example, after resolving the server URL and admin token from the readiness
handoff:

```sh
curl -sS \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  http://127.0.0.1:4287/_snapback/api/debug/network-profile

curl -sS -X PUT \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  --data '"demo-slow"' \
  http://127.0.0.1:4287/_snapback/api/debug/network-profile
```

The response reports the active profile and activation provenance. Do not
build a separate policy path around these routes; the CLI, host-ops, MCP, and
console are thin clients over the same activation decision.

## Toggle a profile while debugging in the console

The admin console's Developer panel offers all three built-ins plus custom
fields. While any non-`normal` profile is active, the console shows a
persistent banner on every tab. The panel inherits the same refusal and
authority behavior as the API; it does not have a browser-only bypass.

## Know where activation is allowed

Network profiles fail closed at one activation chokepoint. The complete matrix
and rationale live in [LLP 0167](repo:llp/0167-network-condition-profiles.rfc.md),
but these limits matter when operating the feature:

- A local, non-`Prod` server may activate a non-`normal` profile.
- A primary hosted target refuses every non-`normal` profile. The narrow
  hosted exception is an LLP 0158 derived/forked instance with authoritative,
  boot-validated identity. On Cloudflare that identity comes from the dedicated
  `SNAPBACK_DERIVED_INSTANCE_ID` binding, independently of `SNAPBACK_TESTING`.
- An explicit or defaulted `ServerProfile` of `Prod` always refuses a
  non-`normal` profile, including on a derived instance.
- Hosted, missing, malformed, or contradictory classification refusals use
  `SNAPBACK_NETWORK_PROFILE_FORBIDDEN` on every activation surface.
- The hard per-response delay ceiling is 30,000 ms. A profile that could
  exceed it is refused with `SNAPBACK_NETWORK_PROFILE_DELAY_CEILING`; Snapback
  never silently clamps it.

These rules are why this page declares `targets: [local]`: the derived-instance
allowance is a contained exception, not general hosted or production support.

## Tell whether a response was perturbed

Every response served under a non-`normal` profile names the profile that
actually governed its delay:

| Surface | Observation marker |
| --- | --- |
| HTTP | `snapback-network-profile` response header, exposed through CORS. |
| Socket and poll live protocol | `network_profile` field on the frame. |

The profile is snapshotted when the response or frame enters the delay seam, so
a concurrent toggle cannot relabel an in-flight response. `normal` is a true
identity: it emits no marker and adds no measurable overhead.

## Understand what survives a restart

A profile selected at runtime through the API, host-ops, MCP, or console is
deliberately process-local and is not persisted. After restart, the server uses
`normal` unless `SNAPBACK_NETWORK_PROFILE` supplies startup configuration.
This prevents a forgotten interactive toggle from silently becoming durable;
an environment-selected profile is different because the launcher explicitly
selects it again at startup.

## Restore `normal` when you're done

Restoring the identity profile is mandatory cleanup for every test, demo, or
debugging session that activates a non-`normal` profile. It is part of the
honest-perturbation contract in LLP 0167, not an optional courtesy:

```sh
snapback network-profile set normal --ready-file .snapback/dev.ready.json
```

If the profile came from `SNAPBACK_NETWORK_PROFILE`, also remove that setting
from the launcher or change it to `normal`; otherwise the next restart will
select the non-`normal` profile again.

The exact MCP equivalent is `snapback_network_profile_set` with
`profile: "normal"`. Confirm with the CLI `get` command or
`snapback_network_profile_get` before handing the server to another task.

## Anti-patterns

- **Do not leave a slow profile active.** Always perform and verify the
  restore-to-`normal` step above, even when a test fails midway.
- **Do not add client-side sleeps to simulate server latency.** Latency
  Kanban's old sleep delayed the caller without exercising Snapback's pending,
  settlement, and live-convergence paths; the server profile exists to replace
  that false test.
- **Do not assume hosted or production accepts non-`normal`.** Primary hosted
  and every `Prod` profile refuse it; the derived-instance rule is the only
  narrow hosted exception.
- **Do not use latency profiles to model disconnects, drops, reordering, or
  offline state.** Profiles delay otherwise unchanged, in-order observations;
  those other perturbations belong to their dedicated test controls.

---

<!-- snapback-guide-source: guide/operating/diagnostics.md -->
---
title: Diagnostics and local doctoring
id: operating.diagnostics
order: 3
audience: agent-first
capabilities: [operating.diagnostics, clients.dev-diagnostics]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0094-wire-envelope-contract.spec.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0146-agentic-authoring-affordances.rfc.md, crates/snapback-types/src/diagnostic.rs, crates/snapback-kernel/src/diagnostic.rs, crates/snapback-kernel/src/remediation.rs, crates/snapback-kernel/src/authoring_suggestion.rs, packages/snapback-client/remediation.mjs, packages/snapback-cli/mcp-control.mjs, packages/snapback-codegen/index.mjs, packages/snapback-cli/runtime-recovery.mjs, demos/_kit/harness.mjs, scripts/ibex-doctor, scripts/runtime-link-smoke.mjs, scripts/bootstrap-ibex-runtime, llp/0219-client-dev-diagnostics-channel.rfc.md, packages/snapback-client/client-diagnostics.mjs, packages/snapback-client/client-diagnostics.d.mts, packages/snapback-client/index.mjs, packages/snapback-react/implementation.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, packages/snapback-codegen/authoring-validation.test.mjs, crates/snapback/tests/host_ops_v0.rs, packages/snapback-client/client-diagnostics.test.mjs, packages/snapback-react/dev-diagnostics-acceptance.test.mjs]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:1c25648b54546e0cba48be11aa9c86c92fe3548afc6b94f50767aa6b4761deab
---

# Diagnostics and local doctoring

Snapback failures carry stable machine identity. Assert and branch on the
`SNAPBACK_*` code; display the message to a human; inspect `details` only
for code-specific facts.

The same contract applies before runtime. Compiler, codegen, dev-server, and
surface-construction failures must carry a stable code, point at the authored
offender (file plus span when known), preserve the first actionable cause, and
report once per source/artifact generation—not once per reactive evaluation.
An authoring failure that can be known during codegen or boot must not be
deferred into an error-shaped data cell.

## Consume the diagnostic shape

The full diagnostic is:

- `code`: stable machine classification;
- `severity`: lowercase `info | warning | error | fatal`;
- `subsystem`: stable owning subsystem;
- `message`: human explanation, not an API;
- `details`: structured code-specific context.

Public unauthenticated projections intentionally drop `message` and
`details`, because they can contain source paths, handler text, arguments, or
operator context. Error envelopes expose the diagnostic at
`error.diagnostic`; some terminal mutation paths also attach a receipt.

<!-- since: 0.1.19 -->

## Inspect client-side dev diagnostics

Every `SnapbackClient` owns one bounded, process-local diagnostics channel,
available from `client.diagnosticsChannel()`. Its carrier is
`snapback.client-diagnostic.v2` with these exact fields: stable `code`,
`severity: 'error' | 'warning'`, `subsystem`, human `message`, structured
`details`, `occurrence: { firstAtMs, lastAtMs, count }`, and optional `site`.
The legacy `snapback.client-diagnostic.v1` object stays error-only;
`onDiagnostic` and `inspection().diagnostics` receive v1 projections through
`projectDiagnosticV1`, so warnings are filtered rather than silently widening
the frozen carrier.

Call `snapshot()` for the current frozen projection. `events` is bounded
history (256 entries by default). `activeConditions` is a separate keyed map
(64 entries by default) for conditions that are true now, such as an unchanged
durable queue head past its wedge deadline; history eviction does not clear a
condition. `counters.emitted` counts event emission attempts,
`counters.coalesced` counts repeats merged by code/site inside their cooldown,
and `counters.dropped` counts capacity eviction or post-disposal/condition-cap
drops. `subscribe(listener)` observes later emissions and condition changes;
read `snapshot()` first when you need initial state. A condition clear notifies
with `null` so consumers re-read the snapshot.

The default line reporter subscribes only when development is positively
identified: `__DEV__ === true`, a live bundler HMR host, or explicit
`NODE_ENV === 'development'`. Missing production markers are not proof of
development, and production never enables this reporter by default. Set
`devDiagnosticsReporter: false` to opt out even in development. Reporter
deduplication changes console volume only; every structured occurrence remains
accounted for by the channel.

Redaction is structural, not a best-effort scrub of rendered prose. The channel
admits bounded plain-data shapes and safe error summaries, caps strings,
entries, and depth, rejects functions/promises/exotic objects, and drops
payload-bearing keys such as args, inputs, payloads, presence values,
credentials, tokens, headers, and bodies. Producers contribute only
payload-safe scalar facts such as queue depth/age/sequence, transition counts,
generated-reference names, hashed canonical-input identity, and the
development-only hook site; transport provenance may be one string or a
bounded list of strings. Raw mutation arguments, presence values, credentials,
and application payloads never belong here.

For agent inspection, prefer the structured surface over console scraping:
headless agents read `diagnosticsChannel().snapshot()` or subscribe directly;
React-aware tools use `observeSnapbackDiagnostics(provider, listener)`; UI can
render the same object with `useSnapbackDiagnostics()`. These are projections
of one client-owned channel, not backend telemetry, and their history dies with
the client process. The [React guide](../clients/react.md#inspect-client-dev-diagnostics)
and [offline guide](../sync/offline-and-retention.md#keep-a-queued-react-mutation-pending)
show the shipped churn and queued/wedged producers.

## Use candidates from the served generation

After the existing authorization gate admits a caller, local unknown-operation,
unknown-function, unknown-field, and wrong-argument-shape refusals add
authoring help to the same `details` object:

- `candidateOperations` contains only currently served host operations;
- `candidateFunctions` names served function ids/names, kinds, exported names,
  and argument-contract hashes, filtered to the route's expected function
  kinds;
- `candidateFields` names served schema or argument fields with their expected
  type and required/optional posture;
- `expectedArgumentContract` carries the complete served argument contract for
  an argument refusal; and
- `artifactHash` or `servedShapeHash` identifies the generation that produced
  the suggestion.

Candidates contain served schema metadata only: the rejected spelling,
argument value, row value, and secrets are not echoed. A caller that cannot
pass the existing auth gate receives the existing uniform refusal and learns
no function-existence candidates.

`localMissSummary` is a bounded process-local hint. `sameMissCount` and
`repeated` tell you that this process has seen the same category, generation,
and rejected identifier before; `capacity` is 128 and counts cap at 255. The
runtime retains only a hash of the miss, evicts least-recently-used entries,
does not persist the summary, and does not promote popular mistakes into
aliases. Regenerate or reload your artifacts when the diagnostic's generation
does not match the artifact you used.

<!-- since: 0.1.19 -->

## Apply a remediation safely

A caller that passed the ordinary authorization gate may also receive
`details.remediationSet`. This is the only remediation carrier; outer HTTP,
host-operation, CLI, MCP, and hosted envelopes do not change. Decode it with
`decodeRemediationSet` from `@expo/snapback-client/remediation` instead of
copying its vocabulary.

The set has two independent identities:

- `schemaVersion: "snapback.remediation-set.v1"` governs the carrier;
- `registryVersion: "snapback.remediation-kinds.v1"` governs the global kind
  vocabulary;
- `artifactHash` is the exact served artifact observed at refusal time; and
- `items` contains at most eight contextual offers.

Unknown set or item members are ignored. An unknown kind is skipped. An
unknown schema or registry version makes only the remediation set unusable;
the surrounding diagnostic remains valid and should still be shown.
The shared decoder also validates every known kind's four safety axes and its
action/precondition pairing against the global registry. Never infer
machine-applicability from `requiresApproval: false`, and never consume a
hand-decoded item whose axes disagree with that registry.

A machine-applicable identifier repair looks like this:

```json fragment reason="illustrative subset of a refusal; candidate names and artifact hashes are application-specific"
{
  "schemaVersion": "snapback.remediation-set.v1",
  "registryVersion": "snapback.remediation-kinds.v1",
  "artifactHash": "sha256:0123456789abcdef",
  "items": [{
    "kind": "fixTypo",
    "riskClass": "mechanical",
    "machineApplicable": true,
    "requiresApproval": false,
    "authorityEffect": "none",
    "precondition": {
      "type": "artifact-hash",
      "artifactHash": "sha256:0123456789abcdef"
    },
    "action": {
      "type": "replaceIdentifier",
      "target": "function",
      "replacement": "listTodos"
    }
  }]
}
```

Copy the exact item and hash into a closed apply input. The native CLI keeps
the JSON out of argv:

```sh
snapback remediation apply --ready-file .snapback/ready.json --input repair.json
```

On the local native target, the equivalent control MCP tool is
`snapback_remediation_apply`; direct HTTP uses
`POST /_snapback/api/host-ops` with operation `remediation.apply`. Under
the same local generation lock that selects the replacement, the server
compares both supplied hashes with the currently served artifact and verifies
that the replacement still exists. Success returns the repaired identifier.
It does not invoke the function, create an alias, regenerate code, or write
application state; retry the original operation explicitly with the returned
value.

The hosted arm emits the same carrier in its unchanged Diagnostic, but does
not expose the local `remediation.apply` host operation. A hosted consumer
must refresh its deployed artifacts and retry through the hosted deployment
workflow; it must not treat the contextual item as a hosted write primitive.

If artifacts changed after the refusal, apply returns
`SNAPBACK_REMEDIATION_ARTIFACT_STALE` and makes no change. Fetch a fresh
diagnostic and select a new item; never overwrite the old hash or transplant
the replacement into a newly generated set.

Authority changes are different. For example, `requestGrant` has
`machineApplicable: false`, `requiresApproval: true`, and
`authorityEffect: "widens"`. `remediation.apply` returns
`SNAPBACK_REMEDIATION_APPROVAL_REQUIRED`; it never turns the suggestion into a
grant. Present it to the operator and use the existing reviewed authorization
workflow. A principal-changing item follows the same explicit-approval rule.

## Assert on codes, not prose

The shared acceptance helper demonstrates the rule:

```js source=demos/_kit/harness.mjs
export async function assertThrows(fn, code, message) {
  try {
    await fn();
  } catch (error) {
    const got = error.diagnostic?.code ?? error.message;
    if (code && got !== code) throw new Error(`${message ?? 'wrong error'}: expected ${code}, got ${got}`);
    return error;
  }
  throw new Error(`${message ?? 'expected an error'}: nothing thrown (wanted ${code})`);
}
```

Messages may improve without a compatibility event. A code change is a
contract change and must update its schemas, callers, tests, and docs together.

A native `snapback start` without `--ready-file` may hand process-bound
capabilities to a controlling terminal. A detached start has no safe carrier
and fails before database creation with
`SNAPBACK_READY_DESCRIPTOR_REQUIRED`; its diagnostic `details.next` names
`snapback start --ready-file <owner-only-path> ...` as the repair. Never scrape
the human startup log or redirect a bearer through inherited stdout/stderr.

## Repair ambient time and identifier diagnostics

During handler generation, `BUNDLE_UNSUPPORTED_TIME`,
`BUNDLE_UNSUPPORTED_RANDOM`, and `BUNDLE_UNSUPPORTED_TIMER` include a
suggested repair and route to
[trusted runtime time and identifiers](../backend/trusted-runtime-values.md).
Use `ctx.runtime.now()` for a trusted integer timestamp and
`ctx.runtime.id()` for a fresh identifier. Neither method is a general
replacement for randomness, delay, or scheduling.

## Diagnose the vendored Ibex runtime first

Run the read-only doctor before repairing runtime files by hand:

```sh
scripts/ibex-doctor
```

It checks the submodule state, prepared Hermes artifacts/framework, CLI,
required tools, and then the part file-presence checks cannot prove: an exact
link of this checkout's final `snapback` Cargo target in an automatically
cleaned temporary target directory, followed by launch and restricted
handler-VM qualification of that newly linked binary with `DYLD_*` and
`LD_LIBRARY_PATH` scrubbed. It also verifies, read-only, that the served
binary's persisted readiness receipt (`<binary>.runtime-readiness.json`) is
digest-coherent with that binary and the current Hermes artifacts. An older
runnable binary does not make the current checkout green. On a clean checkout, bootstrap before
Cargo build/test/run:

```sh
scripts/bootstrap-ibex-runtime
```

Bootstrap distinguishes a structurally complete Hermes set from one compatible
with the vendored Ibex revision. Before using installed artifacts or copying a
prepared checkout, it reconstructs the vendored authority-bound source-cache
keys and requires the artifact receipt to match. An incompatible `../ibex` (or
`SNAPBACK_IBEX_CHECKOUT`) is skipped for the vendored download/build fallback;
Ibex `build.rs` still performs the authoritative full-identity validation. Do
not copy a receipt or edit its identity by hand.

The stable bootstrap failure vocabulary is:
`SNAPBACK_IBEX_SOURCE_MISSING`,
`SNAPBACK_IBEX_SUBMODULE_BROKEN`,
`SNAPBACK_IBEX_SUBMODULE_INIT_FAILED`,
`SNAPBACK_IBEX_SUBMODULE_WEDGED`,
`SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING`,
`SNAPBACK_IBEX_HERMES_DOWNLOAD_FAILED`,
`SNAPBACK_IBEX_CARGO_BUILD_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LINK_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`,
`SNAPBACK_IBEX_RUNTIME_LINK_INTERRUPTED`,
`SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LOAD_FAILED`,
`SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED`,
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, and
`SNAPBACK_IBEX_HOST_UNSUPPORTED`.

The doctor additionally distinguishes uninitialized/conflicting/drifted
submodules, a missing vendored CLI, missing Node/Bun/Cargo, and dynamic-loader
configuration. Follow the emitted next checks; do not collapse those states
into “build failed.”

Every runtime entry point exposes the same
`snapback.runtime-recovery.v1` record: repository doctor (`runtimeRecovery` in
`--json`), bootstrap (one `runtime recovery record:` line), packaged
`snapback doctor` and `snapback dev` (`runtimeRecovery`), and demo
`startServer` (`handle.runtimeRecovery`, or `error.runtimeRecovery` on launch
failure). It names the selected binary and resolver rung, expected checkout
commit/dirty state, actual build stamp, whether the current checkout proved
buildable/runnable, why automatic reuse was allowed or refused, exact producer
inputs, and safe repair or explicit override.

The read-only native `snapback build-identity` command prints
`snapback.binary-identity.v1` without binding a port. Doctor and helpers use it
to obtain the executable's independently embedded commit, dirty state, crate
version, and build profile; older binaries that predate the command may still
be classified runnable via `--help`, but their actual stamp remains honestly
unknown.

Dirtiness here is scoped to the runtime binary's input set — the shared
pathspec list in `scripts/runtime-build-inputs.txt` (Rust sources and
manifests, `vendor/ibex`, and the build-embedded corpora). Uncommitted
edits to your app under `demos/`, or to LLPs, issues, and diaries, cannot
change the binary's bytes and do not count: a prepared binary stays
verified and reusable while you iterate on an app. A dirty *input set*
triggers the refusal posture at server spawn: the kit skips a prebuilt
`target/debug/snapback` it cannot verify against a committed identity
("this checkout's runtime input set is dirty or has no committed
identity") and falls back to the `cargo run` rung, which costs a
rebuild-check on every boot (~30 s). That is provenance working as
designed, not a fault. If you accept the local binary knowingly — a test
loop on intentionally dirty runtime sources — the sanctioned escape is
the same explicit override the diagnostic quotes:
`SNAPBACK_SERVER_BINARY=<path>`. The override's unpinned identity stays
visible in the spawn record, so acceptance is always a recorded choice,
never an ambient default.

When `SNAPBACK_IBEX_RUNTIME_LINK_FAILED` names compatibility symbols such as
`ex_hermes_create_no_eval`, do not delete Cargo output or rebuild Hermes
blindly. Run the recorded bootstrap command. If the record also names a
runnable stale binary, use its quoted `SNAPBACK_SERVER_BINARY=...` override
only as an explicit temporary escape; its independent stamp and resolver rung
remain visible, so the override cannot masquerade as a current-checkout build.

For an installed application runtime, run the packaged vertical-slice doctor:

```sh
snapback doctor --json
```

It emits `snapback.cli-doctor.v2` and succeeds only after
`SNAPBACK_RUNTIME_LAUNCH_OK`, `SNAPBACK_DOCTOR_BUNDLE_LOAD_OK`,
`SNAPBACK_DOCTOR_QUERY_OK`, `SNAPBACK_DOCTOR_MUTATION_OK`,
`SNAPBACK_DOCTOR_LIVE_OK`, and `SNAPBACK_DOCTOR_SHUTDOWN_OK`. The probe uses a
fresh temporary database and an owned ready descriptor. A path mismatch,
failed load, malformed query result, non-committing mutation, missing live row,
shutdown failure, or cleanup failure remains the first structured error and
cannot be converted into a green file-presence check.

## Report the runtime's own readiness identity

`doctor` proves the whole loop. When you want just the runtime's identity —
"which binary is this, and does its handler VM come up in the restricted
no-eval posture?" — ask the binary directly:

```sh
snapback runtime-qualify
```

It prints a `snapback.runtime-qualify.v1` result carrying the VM profile
(`restricted-no-eval-handler-vm`), `ok`, and the binary's build stamp. It
creates the same VM every JS handler uses, so a mismatched Hermes framework
or a runtime/glue contract skew fails here rather than at the first handler
invocation. This is the identity to quote in a bug report or a packaged
consumer's readiness note.

Persist the live verdict and its binary/Hermes digests in the app's managed
state, then re-verify it later without writing or launching the runtime:

```sh
snapback runtime-qualify --persist
snapback runtime-qualify --verify
```

The first command still performs the restricted-VM qualification and writes
`.snapback/runtime-readiness.json`; the second recomputes the installed
runtime bytes and refuses binary or framework drift. Use `--receipt <path>`
on both commands only when another app-owned custody path is required. The
receipt uses the same `snapback.runtime-readiness.v1` schema as the repo-side
bootstrap proof ([LLP 0010](repo:llp/0010-agent-dx-and-acceptance.spec.md))
but never writes into read-only `node_modules`. Doctor's live six-boundary
qualification stays authoritative — this retained identity complements it,
never replaces it.

## Preserve the first useful failure

Acceptance harnesses must fail during setup instead of reporting a vacuous
0/0 pass, bound every wait, include the diagnostic body when an assertion
fails, and clean up their server/handles. When one failure cascades, fix and
rerun from the earliest stable code rather than patching later symptoms.

## Anti-patterns

- **Do not parse `message` text.** Use `diagnostic.code` and typed details.
- **Do not expose full diagnostics on public endpoints.** Use the public
  classification projection.
- **Do not rebuild Hermes first.** Doctor, then let bootstrap select compatible
  prepared artifacts or the vendored fallback.
- **Do not accept a zero-check or timeout-only test result.** Require the
intended diagnostic and non-vacuous witnesses.

Two early data-seam examples are intentionally blocking:

- `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS` rejects a JavaScript query whose
  handler visibly returns an object literal; return `[row]` or `[]`. Dynamic
  result shapes still meet the runtime rows-array guard.
- `SNAPBACK_CONTRACT_QUERY_UNCONFIGURED` rejects a mounted component's
  `requiredQueries` before the multi-live surface opens any subscription.

---

<!-- snapback-guide-source: guide/operating/admin-console.md -->
---
title: Admin console
id: operating.admin-console
order: 4
audience: agent-first
capabilities: [operating.admin-console]
authorities: [llp/0017-admin-console-inspection-surface.rfc.md, crates/snapback-server/src/admin.rs, crates/snapback-server/src/admin_link.rs, crates/snapback-cli/src/cli.rs, packages/snapback-admin-client/index.mjs, packages/snapback-cli/index.mjs, packages/snapback-cli/admin-snapshot.mjs, packages/snapback-cli/runtime-readiness.mjs, packages/snapback-cli/expo-dev.mjs, admin-ui/auth-prompt.mjs, admin-ui/app.contract, admin-ui/build.mjs, admin-ui/dev.mjs, packages/snapback-contract/build-preset.mjs, admin-ui/tests/fatal-rendering.mjs, crates/snapback/tests/admin_claim_link_v0.rs, crates/snapback/tests/admin_reachability_v0.rs, crates/snapback/tests/admin_tailscale_v0.rs]
examples: [admin-ui]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:dafdda17e37afb44c53a58b7bd4cb9a1617fd14676e6f065815f05124c2f56a7
---

# Admin console

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The admin console is Snapback's browser debugger over
`/_snapback/api/*`. Its Contract app exposes Overview, Health, Errors, Logs,
Schema, Data, Functions, Secrets, Capabilities, Realtime, and Diagnostics views
from the same inspect/scan/runner/config boundaries used by tests and tools. Its Docs tab
renders the build-matched served guide from the generated manifest; the
console's text renderer never injects guide HTML.

## Launch the console

With a server running against a readiness descriptor (the packaged
authoring loop's `snapback dev` writes `.snapback/dev.ready.json`),
discover the token, mint a browser credential, and open the console:

```sh
snapback admin --ready-file .snapback/dev.ready.json
```

This is the exact command the Expo supervisor prints as its
`adminConsoleCommand`. The command always prints the complete fragment-bearing
URL, even when it successfully opens the browser. On a machine without a
controlling `/dev/tty`, it automatically behaves as `--no-open`. You can force
that behavior explicitly:

```sh
snapback admin --ready-file .snapback/dev.ready.json --no-open
```

For automation, add `--json`; the `snapback.admin-console.v1` result retains
the URL, expiry, and whether a browser open was requested.

The URL carries only a derived `sbcc_` credential and its expiry in the
fragment. It never carries the `sbat_` master token in either the query or the
fragment. The page removes the fragment before boot and stores the derived
record through the same `snapback_console_credential_v1` path used by the paste
fallback.

<!-- since: 0.1.19 -->

The server serves the immutable console snapshot at `/_snapback/admin/`.
Published `@expo/snapback-cli` installs carry a build-matched snapshot inside
the selected platform runtime package, and the CLI configures it automatically.
No consumer environment variable or Snapback source checkout is required. In
a source checkout, an unset value discovers `admin-ui/dist` when it exists;
contributors can set `SNAPBACK_ADMIN_DIST` to pin a deliberately different
built snapshot. If a source-built runtime has no dist, the route returns a
structured missing-dist diagnostic instead of a second embedded
implementation.

**Contributor variant (source checkout).** Build the static browser and
native Exact artifacts, then run the same commands through cargo:

```sh
bun install --frozen-lockfile --cwd admin-ui
bun run --cwd admin-ui build
cargo run -- start --memory --ready-file .snapback/dev.ready.json
# in another terminal: discover the token, mint a browser credential, and open
cargo run -- admin --ready-file .snapback/dev.ready.json
```

Every `snapback …` command on this page is the packaged spelling of the
same native binary; a checkout can always substitute `cargo run -- …` for
`snapback …`.

For a native Exact shell, point `EXACT_APP_CUSTOM_URL` at the
Snapback-served static admin URL. A browser-only dist returns a specific
native-artifact capability diagnostic.

## Use the browser development loop

Run Snapback at a known port, then start the Exact/Contract Vite app:

```sh
cargo run -- start --memory --port 4287
SNAPBACK_ADMIN_DEV_API=http://127.0.0.1:4287 bun run --cwd admin-ui dev
```

The dev server regenerates Contract bindings, watches their inputs, and proxies
`/_snapback/api/*` to the configured backend. It binds loopback by default.
Non-loopback proxy exposure requires both
`SNAPBACK_ADMIN_DEV_HOST` and
`SNAPBACK_ADMIN_DEV_ALLOW_NON_LOOPBACK=1`; treat that as exposing a
privileged operator surface.

If the backend is down, the proxy returns
`SNAPBACK_ADMIN_DEV_API_UNREACHABLE` rather than HTML or a blank app.
Static native artifacts remain build-only; request them from the served
`./build.sh` output, not the dev server.

## Authenticate the operator surface

Loopback reads are open until an admin token exists; writes and non-loopback
access follow the server's admin policy. Use the printed/token-file credential,
never app session credentials. Sessions-mode sensitive reads use a separate
short-lived admin-secret-read lease; neither credential substitutes for the
other.

The UI clears submitted credentials and renders hostile diagnostics as text:

```js source=admin-ui/tests/fatal-rendering.mjs
assert.equal(root.children[0].tagName, 'pre');
assert.equal(
  root.children[0].textContent,
  `Admin console failed to start:\n${hostile}`,
);
assert.equal('innerHTML' in root.children[0], false);
```

The production browser proof also enforces CSP hashes, Trusted Types, zero
runtime exceptions, zero console errors, and zero policy violations.

Active dev/loopback console credentials renew on a ten-minute sliding window,
up to eight hours from first mint. File-backed servers atomically persist only
the expiring SHA-256 digest metadata beside the database, so a restart does not
log out a live console. The master token remains in its separate owner-only
capability file and never enters browser storage or the digest store.

For a remote browser reached through SSH or another loopback-preserving tunnel,
the token prompt also displays a short-lived user code. Approve it from a
terminal with ready-file access:

```sh
snapback admin approve ABCD-1234 --ready-file .snapback/dev.ready.json
```

The browser polls for its derived credential. Codes expire after ten minutes,
are single-use, and the request, approval, poll, and pending-state lanes are
bounded. Non-loopback binds, hosted targets, and non-dev profiles cannot use
this flow.

### Hand a one-time link from an agent terminal to a remote browser

When the token-holding terminal is remote or agent-driven, keep Snapback bound
to loopback and forward the console origin through SSH or another tunnel. Mint
the browser handoff from the trusted ready file, substituting only the tunnel's
public origin in the printed link:

```sh
snapback admin link \
  --ready-file .snapback/dev.ready.json \
  --url-base https://snapback-console.example
```

The command prints
`https://snapback-console.example/_snapback/admin/#claim=sbcl_…` and stays
attached by default. Opening it removes the fragment before boot, sends the
claim only in a `POST` body, and stores the resulting `sbcc_` credential through
the ordinary console-credential path. Exactly one exchange wins. The link is a
bearer until its thirty-minute claim expiry, so keep it private while pending;
after redemption or expiry it is inert and may safely remain in agent
transcripts or scrollback. The master `sbat_` token must never enter those
channels.

The attached command reports redemption time and the direct transport peer.
Behind a tunnel that address is usually the tunnel endpoint, not the human's
browser. For detached automation, print and exit, then reattach or revoke with
the raw claim code:

```sh
snapback admin link --no-wait --ready-file .snapback/dev.ready.json
snapback admin link --status sbcl_… --ready-file .snapback/dev.ready.json
snapback admin link --revoke sbcl_… --ready-file .snapback/dev.ready.json
```

Attached automation can request JSON-line lifecycle records and an owner-only
readiness handoff. The readiness file exists only while the observer owns the
link and includes the exact fragment URL:

```sh
snapback admin link --json \
  --link-ready-file .snapback/admin-link.ready.json \
  --ready-file .snapback/dev.ready.json
```

`--link-ready-file` deliberately conflicts with `--no-wait`: an exited process
cannot truthfully own attached-observer readiness.

Claim-derived credentials have distinct provenance. Active use renews their
ten-minute sliding expiry, but the server fixes their absolute deadline at
ninety minutes from redemption rather than the ordinary eight-hour ceiling.
Status and revocation require the master bearer; neither the browser nor an
anonymous loopback caller can read the redemption record. Claim mint and
exchange refuse hosted or non-loopback targets even when another admin bearer
is present—remote access is always a tunnel terminating on loopback plus
`--url-base`.

### Open a phone console on the local network

Keep the Snapback server on loopback and let the attached command own a
short-lived relay on the one eligible physical LAN interface:

```sh
snapback admin link --lan --qr \
  --ready-file .snapback/dev.ready.json
```

If more than one interface is eligible, the command refuses and lists the
candidates. Select one explicitly with `--lan=en0` or
`--lan=192.168.1.20`; wildcard and loopback addresses are refused. The first
line and the terminal QR encode the same URL bytes. Scan it while the command
remains attached.

The relay is deliberately plain HTTP. Read the mint-time warning: another
party on that network can observe or hijack the session while it is live. The
compensating bounds are the single-use claim, ten-minute sliding credential
expiry, ninety-minute absolute cap, redemption record, and master revocation.
Use the tailnet recipe below on a network you do not trust.

Only the console shell/assets, the claim exchange, and requests already
carrying the derived console credential cross this relay. It refuses the
master exchange, the master-token header, non-console paths, ambiguous HTTP
framing, and hostile Host/Origin values. Closing the command, revoking the
claim, losing the observed server, or reaching claim/credential expiry closes
the listener. `--lan` therefore cannot be combined with `--no-wait`.

### Open the console across a tailnet

With tailscaled running and the target server on `127.0.0.1`, publish only the
Snapback namespace through tailnet-terminated HTTPS:

```sh
snapback admin link --tailscale --qr \
  --ready-file .snapback/dev.ready.json
```

The command creates or shares a Tailscale Serve mapping only for
`/_snapback`, records its exact mapping and live owners in owner-only receipt
files, and removes it when the last attached invocation exits. A later
invocation sweeps a receipt-owned mapping stranded by a crash. Existing or
externally changed operator mappings are refused and never removed. A missing
or stopped tailscaled is a stable refusal; there is no LAN or loopback
fallback. Like `--lan`, this mode cannot be detached with `--no-wait`.

Credentials redeemed through either managed origin are stored only in the
current tab's `sessionStorage`, keyed by reachability session and server
startup identity. Reload first verifies both identities without sending the
credential. Expiry, revocation, origin reuse by another backend, or early
front termination clears or invalidates the record; it never falls back to
`localStorage` on the relay or tailnet origin.

## Debug through declared views

- **Overview/Capabilities/Realtime/Diagnostics:** inspect target, artifacts,
  capability gaps, delivery state, receipts, and stable codes.
- **Health:** telemetry stat tiles, requests over time, per-route/function
  latency, top volume/error-rate entries, lifecycle markers, and coverage,
  with a link into Errors when issues need attention.
- **Errors:** triage open/regressed issues and resolve or ignore them;
  structural metadata is ordinary admin authority, while raw detail spends a
  scoped `errors.issue` secret-read lease.
- **Logs:** filter the same bounded `telemetry.events` operation agents use;
  raw rows require a `telemetry.events` secret-read lease.
- **Schema/Data:** inspect declared tables and page through rows; private reads
  remain subject to secret-read scope/budgets.
- **Functions:** run queries, mutations, and actions through the classified
  direct-runner boundary and inspect captured reads/writes.
- **Secrets:** see declaration/set/verification state and run declared probes;
  values never render.
- **Docs:** navigate the same manifest/corpus served at `/_snapback/guide`,
  with response hash/build identity checked before a page renders.

Use the [host operations](./host-ops.md) page for automation and
[diagnostics](./diagnostics.md) for code-driven troubleshooting.

## Verify the Contract/Exact seam

The build preset owns plugin ordering, route/entry preflight, static/native
targets, and the admin base-path rewrite. Snapback's Exact discovery/conformance
helpers remain optional for ordinary core work:

```sh
node packages/snapback-contract/exact-conformance.mjs
node packages/snapback-contract/exact-conformance.mjs --require
node packages/snapback-contract/exact-conformance.mjs --run
```

`--require` makes a lane fail unless Exact registers the provider suite;
`--run` invokes Exact's registered check. Generated descriptor/project
semantics are covered by the Contract adapter acceptance, not by a hand-written
admin binding layer.

## Anti-patterns

- **Do not run the privileged dev proxy on a LAN accidentally.**
- **Do not point a native shell at a browser Vite surface.** Use the built
  Snapback-served admin URL.
- **Do not persist admin or secret-read credentials in UI state/storage.**
- **Do not put the `sbat_` master token in any URL.** The CLI fragment handoff
  is for derived `sbcc_` credentials only.
- **Do not bypass generated Contract bindings with a second admin UI.**

---

<!-- snapback-guide-source: guide/operating/observability.md -->
---
title: Backend observability
id: operating.observability
order: 5
audience: agent-first
capabilities: [backend.observability-v1]
authorities: [llp/0154-minimal-observability.rfc.md, crates/snapback-services/src/telemetry.rs, crates/snapback-services/src/telemetry_query.rs, crates/snapback-cli/src/cli.rs, crates/snapback-engine/src/host_ops.rs, packages/snapback-cli/mcp-control.mjs, admin-ui/admin-boundary.mjs, scripts/telemetry-phase1-idle-proof.mjs, crates/snapback-tools/src/telemetry_bench.rs]
examples: []
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-19
reviewed-authorities-digest: sha256:e3e703626671703c1eed2b843555e7644074dc091c6590604b55b9cafe20286d
---

# Backend observability

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback records a bounded, loss-tolerant recent history of backend work with
no application setup. Use the fixed Health and Logs console pages for a quick
view; use the typed operations below when an agent needs exact filters,
coverage facts, or an export.

The local implementation, recurring smoke gate, and retained clean-release
idle/benchmark receipt are shipped together. The
[retained carrier](repo:tests/acceptance/telemetry-phase1-evidence.v1.json)
binds its measured clean source revision, the complete proof-source byte
closure, and the exact receipt bytes; the recurring local proof reopens it
before running the smoke profile.

This is the Phase-1 surface from
[LLP 0154](repo:llp/0154-minimal-observability.rfc.md): backend requests,
function and job runs, live/WebSocket lifecycle, process and release markers,
runtime logs, and standalone diagnostics. It does not include hosted telemetry,
declared product-analytics events, distinct-user metrics, funnels, or client
crash ingest. Grouped backend issue lifecycle is the separate
[error-tracking capability](./error-tracking.md) built on these rows.

## Check health and recent logs in the console

Open the admin console and select **Health** for request volume, request error
rate, p50/p95 latency, live connections, top routes/functions, lifecycle
markers, and drop counters. Select **Logs** to filter raw events by kind, name,
diagnostic code, or text and inspect one record.

Health reads the closed aggregate `telemetry.stats` projection. Logs reads
`telemetry.events`, whose records can contain authored log text or diagnostic
context and therefore require the separate scoped secret-read authority. The
console acquires that authority through its existing operator boundary; an app
session never grants it.

The stats HTTP projection also accepts `callerKey`, `lane`, and
`groupByCaller=true` for the bounded external-caller dimension. Declared
caller keys are digests and integration keys are registration IDs. The
declared-client and integration admin listings join a recent 24-hour count
from this rollup so operators can inspect usage beside suspension state.

## Query the typed operations from the CLI

Address the server by its readiness descriptor so the CLI can resolve its URL,
admin credential, and—only for raw reads—a short-lived scoped lease:

```sh
snapback telemetry stats --ready-file .snapback/server-ready.json --kind function_run
snapback telemetry events --ready-file .snapback/server-ready.json --kind log --limit 50 --order desc
snapback telemetry export --ready-file .snapback/server-ready.json --since 1760000000000 --until 1760086400000 > telemetry.ndjson
```

`stats` admits `--kind`, `--name`, `--from-ms`/`--since`, and
`--to-ms`/`--until`. `events` and `export` additionally admit `--status`,
`--code`, `--correlation`, and `--text`; `events` has the deterministic
`recorded_ts_ms` + `id` cursor and a page limit of 1–500. Export freezes one
snapshot and emits a self-describing NDJSON header followed by the visible
records.

When addressing `--url` instead, supply the admin token and a separately
minted `--secret-read-lease` for `events` or `export` — mint it with
`snapback secret-read-mint` as described in
[host operations — "Mint a scoped secret-read lease"](./host-ops.md#mint-a-scoped-secret-read-lease).
An admin token alone is deliberately insufficient for raw records. Responses
from raw HTTP carriers are `no-store`.

## Query from an agent tool

The control MCP exposes the same Rust-owned operations as:

- `snapback_telemetry_stats` — aggregate counts, error rates, latency,
  coverage, and variance;
- `snapback_telemetry_events` — one bounded raw-event page with an
  automatically minted scoped lease;
- `snapback_telemetry_export` — one immutable-snapshot page bounded by
  `maxRows` and `maxBytes`, plus an opaque continuation token when truncated.

The host-operation identities are `telemetry.stats`, `telemetry.events`, and
`telemetry.export`. The agent export is intentionally finite; follow its
continuation token rather than treating one page as the whole snapshot.

## Read the variance envelope before drawing conclusions

Every typed response reports its store backend, capability outcome, sampling,
freshness watermark, retention boundary, truncation, and drop counters.
Window totals are exact only when the reported coverage spans the requested
window. Per-name results become approximate when heavy-hitter folding occurred;
latency percentiles are histogram approximations with stated bounds.

Telemetry may shed under pressure. Since-boot and lifetime counters say what
was lost and why. A missing event after a nonzero drop count is not evidence
that the operation never happened, and an old freshness watermark is not a
current health reading. Telemetry is never billing authority.

## Use the local SQL hatch for bounded investigations

When the typed operations cannot express a local investigation, query the app
database's telemetry sibling through the CLI:

```sh
snapback telemetry query \
  "SELECT kind, name, count(*) AS n FROM telemetry_events_visible GROUP BY kind, name" \
  --db .snapback/dev.sqlite3 --max-rows 100 --max-time-ms 2000
```

The command opens `.snapback/dev.sqlite3.telemetry` read-only and permits one
statement over `telemetry_events_visible` or `telemetry_rollup_visible`.
Caller-aware investigations use the typed stats fields above.
Base-table reads, writes, pragmas, attach/detach, extension loading, and SQL
tails are refused. Row, SQLite-step, elapsed-time, and serialized-byte budgets
remain enforced even though the command is local. There is no network SQL
endpoint.

## Understand storage and retention

Telemetry uses its own generation-bound SQLite sibling and write connection;
it is not attached to the app database, does not enter application tables or
live-query changes, and rotates visibility with reset/restore incarnation.
Producers enqueue without waiting for SQLite. A record arrival arms a flush at
256 records or when the oldest record reaches 3 seconds; retention, rollups,
checkpointing, and generation cleanup ride that flush path rather than a
periodic timer.

The local defaults retain 7 days of raw events, reserve 512 of 4,096 buffer
slots for failure/terminal records, and cap the physical telemetry main + WAL
+ SHM footprint at 256 MiB. These are deployment-owned resource-safety
settings, not plan entitlements. `maxDays: 0` is a true persistence off switch.
Automation should inspect the returned retention/variance facts instead of
assuming defaults; the current author-facing CLI does not mutate this policy.

## Anti-patterns

- **Do not use telemetry to compute bills, audit ledgers, or durable app
  state.** It is explicitly loss-tolerant and priority-shedding.
- **Do not treat the admin token as raw-data authority.** Events and exports
  require their own short-lived, budgeted secret-read scope.
- **Do not open telemetry base tables or hand-edit the config sibling.** Use
  typed operations, or the bounded local visibility-view hatch.
- **Do not infer zero activity from an empty page without checking freshness,
  coverage, retention, truncation, and drops.**
- **Do not build product analytics or a second error-group lifecycle on raw
  Phase-1 rows.** Product analytics remains unbuilt; use the typed
  [error-tracking capability](./error-tracking.md) for backend issue triage.

---

<!-- snapback-guide-source: guide/operating/error-tracking.md -->
---
title: Backend error tracking
id: operating.error-tracking
order: 6
audience: agent-first
capabilities: [backend.error-tracking-v1]
authorities: [llp/0156-minimal-error-tracking.rfc.md, llp/0154-minimal-observability.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, crates/snapback-services/src/error_tracking.rs, crates/snapback-services/src/errors_query.rs, crates/snapback-services/src/telemetry.rs, crates/snapback-cli/src/cli.rs, crates/snapback-engine/src/host_ops.rs, packages/snapback-cli/mcp-control.mjs, admin-ui/app.contract, admin-ui/admin-boundary.mjs]
examples: []
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:2945c7d8f80d8a41b366ede5aee474f6f9b9e7105918f818896d99a704405709
---

# Backend error tracking

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback groups eligible backend failures into durable-within-retention
issues, keeps occurrence and suppression counts, and remembers whether each
issue is open, resolved, ignored, or regressed. Start with the fixed Errors
console page for triage. Use the typed operations when an agent needs exact
filters, raw exemplars, or compare-and-swap state transitions.

This is LLP 0156's local Phase E0/E1 capability, built on the
[observability substrate](./observability.md). It is partial rather than a
general crash service: grouped state does not ship on the Cloudflare target;
E2 alert delivery is unbuilt; and E3 client crash ingest is unbuilt.
Server-side stacks are raw rather than symbolicated.

When one handler terminal contains multiple ordered unhandled rejections, it
remains one observation. The first ordered rejection supplies the exception
class and normalized message template for one fingerprint and one exemplar;
the terminal increments that group's occurrence count once. The complete
ordered carrier vector remains in the raw telemetry event's
`details.rejectionCarriers` facts, within the ordinary bounded-details and
truncation rules. Snapback neither creates one group per rejection nor invents
an aggregate fingerprint.

## Triage open and regressed issues in the console

Open the admin console and select **Errors**. The list combines open and
regressed issues in last-seen order, with occurrence, release, and suppression
counts. Resolve or ignore an issue from its row. Each action sends the row's
current `stateSeq`, so another actor's intervening transition produces a
visible conflict instead of overwriting it.

Raw templates and stack heads are absent from list rows. Select the explicit
detail action to acquire the scoped raw-read lease and load one issue's
retained exemplars. Normal console bootstrap and Health polling never load raw
detail. Health's Errors tile is only a link-out count derived from the same
structural issue reads; it is not a second query path.

## Ask the release-first questions from the CLI

Address the server by its readiness descriptor so the CLI can resolve the
server, admin credential, and—only for raw issue detail—the short-lived scoped
lease:

```sh
snapback errors issues --ready-file .snapback/server-ready.json
snapback errors issues --ready-file .snapback/server-ready.json --since release-a --state regressed
snapback errors issue iss_00000000000000000000000000 --ready-file .snapback/server-ready.json
```

`errors issues` defaults `since` to the newest retained release. Supply
`--state`, `--kind`, `--name`, `--subsystem`, `--failure-disposition`,
`--release`, `--since`, `--from-ms`, `--to-ms`, `--order last-seen|count`,
`--cursor`, or `--limit` to narrow the structural list. An unknown release, or
one older than the visible activation floor, fails closed and reports the
known retained releases.

`errors issue <iss_…>` returns one structural issue plus retained template and
stack-head exemplars, bounded transition history, and a ready-to-run
`telemetry.events` correlation query per exemplar. With `--url` instead of a
readiness file, provide both the admin token and a separately minted
`--secret-read-lease` (minted with `snapback secret-read-mint --errors-issue`
— see [host operations — "Mint a scoped secret-read
lease"](./host-ops.md#mint-a-scoped-secret-read-lease)); an admin token alone
cannot read raw detail.

## Transition state without losing a concurrent update

Read the issue's current `stateSeq`, then supply it as the CAS expectation:

```sh
snapback errors transition iss_00000000000000000000000000 \
  --ready-file .snapback/server-ready.json --to resolved --expect-seq 3
```

The authored targets are `open`, `resolved`, and `ignored`; `regressed` is a
flusher-authored state when a new eligible occurrence is accepted after the
resolve barrier. A stale `expectSeq` returns a conflict with no transition.
Transition history is bounded, so use the group row's current state and
`stateSeq` as authority and read the reported history floor before treating
the visible history as complete.

For a deploy hook, resolve all open or regressed issues last seen before one
retained release activation:

```sh
snapback errors resolve --ready-file .snapback/server-ready.json --open-before release-a
```

The selector and transitions execute in one telemetry-store transaction. The
response reports an applied, skipped, missing, or conflict outcome per issue;
the command does not pretend every selected row was transitionable.

## Use the same operations from an agent tool

The control MCP projects the Rust-owned contract without another issue model:

- `snapback_errors_issues` projects `errors.issues`, the structural list;
- `snapback_errors_issue` projects `errors.issue` and automatically mints the
  bounded `errors-issue` secret-read lease; and
- `snapback_errors_transition` projects either the single CAS form or the
  atomic `openBefore` bulk-resolve form.

List and detail operations report the observability variance envelope plus
error-group facts. Check `groupHorizonStartMs` before assuming an old resolved
issue would still be remembered; `transitionHistoryFloorSeq` and
`transitionHistoryTruncated` before treating history as complete;
`exemplarStale` and exemplar drop counters before assuming raw detail never
existed; and `overflowFoldCount` before treating the visible groups as every
eligible fingerprint. Suppression counts record rollout/cooldown decisions;
they do not imply an alert was delivered, because E2 delivery is not built.

## Understand what survives and what does not

Issue groups, transitions, activations, and raw exemplars live in the same
generation-bound telemetry sibling database. The classification group can
outlive its raw exemplar, but deleting the telemetry file, rotating the app
generation, reaching the group horizon, or setting `maxDays: 0` removes it
from the visible issue surface. This is triage state, not an audit ledger.

Declared application refusals are issue-eligible only when the function
explicitly lists the admitted code in `trackedRefusals`. The private opt-in is
validated as a subset of `refusals` and is never added to public function
introspection. Ordinary caller errors and untracked app refusals remain out of
the issue list; tracking every failed request would erase the distinction
between actionable faults and routine domain outcomes.

## Anti-patterns

- **Do not query `error_groups` directly or build a second grouping store.**
  Use `errors.*`; grouping and raw telemetry share one flush transaction and
  one generation fence.
- **Do not put stack or template text on a structural list or webhook.** Raw
  content requires the scoped detail lease and must remain `no-store` on HTTP.
- **Do not update state without `stateSeq`.** A timestamp is informational;
  the sequence is the concurrency token.
- **Do not infer alert delivery from suppression counters.** E2's outbox,
  retries, webhook, and Sentry-formatted bridge are deferred and unbuilt.
- **Do not send browser or native crashes to the backend issue routes.** E3's
  authority, abuse limits, offline ordering, protocol, and symbolication are
  deferred to a separate RFC and are unbuilt.

---

<!-- snapback-guide-source: guide/operating/instance-forks.md -->
---
title: Local instance forks
id: operating.instance-forks
order: 7
audience: agent-first
capabilities: [operating.instance-forks]
authorities: [llp/0158-instance-forking.rfc.md, crates/snapback-cli/src/cli.rs, crates/snapback-kernel/src/instance_fork.rs, demos/_kit/instance-fork.mjs]
examples: [demos/todo/tests/acceptance/forked-parent.mjs, crates/snapback/tests/instance_fork_cli_v1.rs, tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-06
reviewed-authorities-digest: sha256:e111ece9828fd85ebb3493ac42dc0901b77a579a80c5f9287b74c89b673db916
---

# Local instance forks

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The source CLI can give one worktree a finite-lived, independent backend that
starts from a consistent copy of an existing file-backed local app. Use it for
schema- or function-divergent development against realistic rows. The fork has
the same logical `appId`, but fresh instance, authorization-stream,
data-stream, admin-token, and resume-keyring identities.

This is a **partial contributor-source local surface**, published for exactly
the two measured release platforms, `macos/aarch64` and `linux/x86_64`, by the
[source anchor](repo:crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json)
and its
[dated digest-bound receipt](repo:tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json).
The claim is a qualification-C snapshot under LLP 0189 scoped-digest custody:
post-C evolution of scoped source stays explicit as
`PUBLISHED_REQUALIFICATION_DUE` until the next natural cycle, while any
inconsistency in the frozen scope, digest, evidence, review, or acceptance
chain refuses publication. The separate
`agent_safe_derived_deployment_fork_v1` target-manifest tuple remains wholly
`Missing` by the author's ruling; the capability-index row is the narrow claim
carrier. The guide teaches the implemented source-checkout workflow.
Released-binary/npm parity and the Phase 6 normal-installation exit remain
open. This claim includes no public package, hosted/Cloudflare/remote target,
promotion or merge-back, or process sandbox.

## Give a worktree its own backend

Bootstrap this checkout first so `target/debug/snapback` is the qualified
binary for these exact source bytes. A parent may be a cold SQLite database or
a live server's ready file. Run creation from the worktree whose generated
schema and functions the fork should load:

```sh
scripts/bootstrap-ibex-runtime
target/debug/snapback fork create \
  --from /absolute/path/to/parent.ready.json \
  --ttl 2h \
  --app-root "$PWD" \
  --fork-root /absolute/path/to/shared-fork-root
```

The default JSON `hostOpsResult` contains `data.readyFile`, `data.database`,
`data.receipt.lineage.forkId`, and the effective `serverUrl`. Treat the ready
file as the connection handoff. Do not infer a port, reuse the parent's admin
token, or discover a database by scanning directories. For a shell that needs
exactly one value, add `--format url`, `fork-id`, `database-path`,
`ready-path`, or `admin-token-path`; JSON remains the primary automation
contract.

The fork operation does all of these before it returns:

- sweeps already-expired, safely verifiable forks in the selected fork root,
  completes any stale registry bookkeeping whose fork directory is already
  gone (reported as `data.automaticReap.clearedStaleRegistryIds`), or refuses
  creation if any expired target cannot be proved safe to remove;
- checks resource admission and refuses deterministically with
  `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` when the managed fork count, the
  source database's estimated bytes, or the fork root's total byte budget
  would exceed the configured limits (`--max-forks`, `--max-fork-bytes`,
  `--max-total-bytes`), reporting the admitted usage as
  `data.resourceAdmission`; a fork-root lock keeps the count/byte observation,
  registry intent, and publication one atomic admission interval even when
  creates race at a boundary; lock acquisition has a 30-second monotonic
  deadline and refuses with `SNAPBACK_FORK_ADMISSION_TIMEOUT` rather than
  waiting without bound; the creation TTL itself is bounded by the same maximum
  total fork lifetime that caps renewal;
- treats those byte checks as admission-time estimates, not a live disk
  quota: fork-local writes and uploads can grow after creation until finite
  TTL/reap cleanup, so use a filesystem/container quota when runtime growth
  itself must be contained;
- takes a consistent local snapshot and records the exact fork point;
- records the canonical invoking app root plus logical app id in registry and
  fork-local digest-bound evidence before publication, independently of
  whether a server is ever launched;
- scrubs copied sessions, agent credentials, and operational claims;
- rotates authorization and data-stream identities and mints fresh sidecars;
- when both generated manifests exist, admits the complete schema/function
  pair through an owner-only fork-local cold-start carrier, then arms the
  derived fork's generated-writer/SQLite-authorizer app-row coverage before
  listener bind; `data.writerCoverageReceipt` names the fork-point-bound
  manifest;
- preserves the historical post-bind schema/function loader only for a
  partial dev-manifest layout; that path returns
  `data.writerCoverageReceipt: null` and makes no whole-window coverage claim;
- boots cron, durable jobs, and asset maintenance inert;
- applies fail-closed `deny-all-v1` host egress; and
- records a finite expiry in the fork-root lifecycle registry; and
- starts a server that refuses boot after expiry and checks its expiry while
  serving.

Use a shared, explicit fork root when several worktrees derive from one
parent. Each `fork create` chooses a UUID-named direct child by default, so
worktrees do not share a database or port. Keep `--app-root` pointed at each
worktree: create records its canonical path and logical app id in registry and
fork-local digest-bound evidence. Every list, inspect, diff, renew, drop, reap,
and recover selection rechecks that identity before projecting paths or
credentials or mutating state. Consequently, even two worktrees with the same
`appId` cannot select one another through a shared `--fork-root`; a legacy row
without this binding fails closed rather than acting as a wildcard.

Library callers have the same contract without a launch step. Establish or
load the app root with `ensure_expected_app(app_root, app_id)` or
`load_expected_app(app_root)`, then pass the returned opaque
`ExpectedForkAppV1` to `publish_managed` or
`publish_managed_with_base`. Those APIs revalidate the canonical app-root
identity and persist it during mint; they never infer authority from the
destination's parent fork root. A fork minted this way can be inspected or
diffed immediately with the owning CLI `--app-root`. The low-level `publish`
crash-corpus primitive is deliberately unmanaged and cannot be selected by
managed lifecycle commands.

That root identity is a deliberate one-app pin. If a worktree must change to a
different logical app id, first use its current identity to list and drop (or
reap) every managed fork it owns. Then remove only
`.snapback/instance-fork-app-identity.v1.json`; the next `fork create` records
the new app id. Do not remove the identity while owned forks remain: doing so
makes them fail closed under managed lifecycle commands and does not transfer
their authority to the new app id.

## Fork instead of seeding an acceptance suite

Suites using `openHeadlessApp` opt in with `forkFrom`. The ordinary call still
starts a blank in-memory server and installs the demo seed. The fork-aware call
preserves parent rows, loads the current worktree's generated artifacts, and
makes `close()` perform an exact registry-bound `fork drop`:

```js source=demos/todo/tests/acceptance/forked-parent.mjs
  const app = await openHeadlessApp(import.meta.url, {
    appId: 'todo',
    forkFrom: parentDb,
    forkRoot,
    forkTtl: '10m',
    serverBinary,
  });
  cleanups.push(() => app.close());
```

Register `close()` with the shared acceptance cleanup stack immediately. The
finite TTL is an automatically enforced backstop for interruption, not a
substitute for attested test cleanup. Do not pass a seed on the fork path:
replacing realistic parent state would defeat the option's purpose.

After the suite writes, retain the bounded review receipt before cleanup:

```js source=demos/todo/tests/acceptance/forked-parent.mjs
    const receipt = await app.fork.diff();
    assertEqual(receipt.rows.length, 1, 'one fork-only app-row mutation');
    assertEqual(receipt.rows[0].postImage.title, forkOnlyTitle, 'diff post-image');
    assert(receipt.omissions.includes('auth and credential state'), 'diff must retain explicit omissions');
```

`app.fork.createEnvelope` retains the creation facts, including worker,
egress, secret, expiry, and lineage posture. `app.fork.diff()` returns the
journal-derived app-row receipt. The maintained Todo proof starts from a
parent-only edge-case row, mutates the fork, checks the receipt, and verifies
the live parent never sees the fork-only row.

## Own forks per worktree, per agent run, and per suite lane

The acceptance kit layers deterministic ownership over the CLI lifecycle
(`demos/_kit/instance-fork.mjs`). `startWorktreeFork` binds a fork to the
exact canonical git-worktree toplevel; `startAgentFork` binds one to an
explicit `ownerId`/`runId` pair. Both write a non-secret
`snapback.fork-owner.v1` record into the fork directory and return
shell-friendly `envExports` (fork id, URL, ready path). Discovery and
cleanup then bind to that exact recorded identity — never a guessed
directory — and every deletion still goes through registry-bound
`fork drop`:

```js fragment reason="illustrative composition; the CI-verified consumer is demos/todo/tests/acceptance/fork-parallel-dispositions.mjs"
import {
  startAgentFork, discoverOwnedForks, dropOwnedForks,
} from './demos/_kit/instance-fork.mjs';

const fork = await startAgentFork({
  ownerId: 'my-fleet-lane', runId: process.env.RUN_ID,
  from: parentDb, appRoot, repoRoot, forkRoot, ttl: '30m',
});
// … if this run dies without fork.stop(), a later sweep cleans up exactly:
await dropOwnedForks({ repoRoot, appRoot, forkRoot,
  match: { ownerId: 'my-fleet-lane', runId: process.env.RUN_ID } });
```

Parallel suites share one expensive prepared parent while each lane gets an
isolated derived instance on its own OS-assigned port. An interrupted run
settles into one of three named dispositions, each CI-proven in
`demos/todo/tests/acceptance/fork-parallel-dispositions.mjs`: a fully
cleaned state; an unexpired orphan swept later by its exact owner/run
record; or a quarantined incomplete publication repaired through
`fork recover`. Automatic reap separately handles the fourth shape — an
expired fork nobody swept.

## Inspect, review, and dispose forks

`list` is the deliberately advisory registry projection. Safety-sensitive
`inspect`, `diff`, `drop`, and `reap` re-bind each selected entry to the fork's
local lineage, mint receipt, database, and ready descriptor before reading,
signalling, or deleting anything:

```sh
target/debug/snapback fork list \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork inspect "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork diff "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root \
  --out /absolute/path/to/fork-diff.json

target/debug/snapback fork renew "$FORK_ID" --ttl 2h \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork drop "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork reap --now-ms "$PORTABLE_NOW_MS" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root
```

`inspect` is the bounded status projection: fork and parent identity, fork
point and expiry, process health, database/ready/admin-token paths,
scrubbed-or-copied secret disposition, inert cron/jobs/assets posture,
`deny-all-v1` egress, and a diff count/coverage summary without full rows. Its
five `--format` scalar values match `create`, so a script can write, for
example, `FORK_URL=$(... fork inspect "$FORK_ID" --format url ...)` without
parsing display text.

`renew` extends one fork's finite expiry from now by `--ttl`, bounded by a
configured maximum total lifetime from creation. It re-binds the exact
registry identity first, refuses to shorten or clear the expiry, refuses an
already-expired fork outright (`SNAPBACK_FORK_RENEW_EXPIRED` — reap and
recreate instead), and emits a durable `snapback.fork-renew.v1` receipt both
in the envelope and beside the fork database. A renewal that crashes mid-way
is completed by `fork recover` from its durable intent; a running fork server
re-reads the renewed expiry at its old deadline and keeps serving. On an armed
fork the lifecycle token permits the exact checkpoint before the lineage
transaction. An ordinary later failure compensates database lineage, mint
receipt, and registry to the previous expiry and refuses cleanly; an injected
or real crash preserves the sentinel/intent so `fork recover` can finish the
same sequence.

`drop` stops and removes exactly one verified fork; concurrent drop/reap of
the same fork settles with one winner and `SNAPBACK_FORK_NOT_FOUND` for the
rest, never a torn teardown. Explicit `reap` is a deterministic test and
operations surface: the caller supplies a portable millisecond clock and the
command removes only verified forks whose finite expiry is at or before that
clock, and additionally completes stale registry entries whose fork
directory is already gone (`data.clearedStaleRegistryIds`). `list` binds
every entry it can and reports the rest under `data.unboundRegistry` with
warning diagnostics instead of failing wholesale; it also projects
`data.resourceUsage` (fork count, total bytes, default limits). Normal
creation needs no injected clock: it uses the system clock to sweep the same
fork-root scope first and reports the reaped IDs in `data.automaticReap`. If
that sweep cannot safely remove every expired fork, creation fails closed
with `SNAPBACK_FORK_EXPIRED_REAP_FAILED`.

A derived server independently reads its recorded expiry. It refuses an
already-expired boot, then checks at least once per second while serving and
exits with `SNAPBACK_FORK_SERVER_EXPIRED` when the deadline arrives. That
expiry exit deliberately retains the non-secret ready descriptor: a later
`create`, `drop`, or `reap` can bind the recorded PID to the exact fork and
prove it gone before deleting storage. Nested forks are refused in local v1.

## Recover interrupted publication

Creation publishes through private staging and an advisory registry. If a
crash leaves an incomplete direct child, recover by its exact destination —
not by scanning a root or trusting a possibly stale registry row:

```sh
target/debug/snapback fork recover /absolute/path/to/shared-fork-root/FORK_UUID \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root
```

For pre-publication S0–S3 state, recovery removes disposable staging and
best-effort registry intent. For a published-but-unreconciled S4 destination,
it verifies local database lineage and minted evidence, reconciles the
registry when possible, and removes the publication sentinel. The JSON result
identifies the recovery disposition and registry outcome. Registry repair is
advisory: complete local evidence governs boot safety. The command refuses
unbounded lineage and does not start a process; after recovery, inspect or
dispose the repaired managed state explicitly.

## Act on fork diagnostics

Fork failures use stable `SNAPBACK_FORK_*` codes. Preserve the code and
details object in automation; the message is for people.

| Diagnostic | Action |
| --- | --- |
| `SNAPBACK_FORK_APP_BINDING_MISMATCH` | The selected fork belongs to another canonical app root or logical app identity, or the invoking app-root identity was replaced after it was loaded. Invoke from the owning `--app-root`; library callers should reload the opaque identity; never use the shared fork root as authority. |
| `SNAPBACK_FORK_APP_BINDING_REQUIRED` | The entry predates mint-time app binding, came from the unmanaged low-level primitive, or lost that evidence. It is deliberately unselectable; a managed fork does not enter this class merely because it was never launched. Legacy bytes still count against root admission. Stop and identify the exact legacy process/directory from independent provenance, then remove only that UUID's registry row and direct-child directory out of band; there is no wildcard/recursive unbound reap. |
| `SNAPBACK_FORK_PUBLICATION_PARTIAL` | Run `fork recover` on the exact sentinel-bearing destination before boot. |
| `SNAPBACK_FORK_QUARANTINED` | Treat the database as non-bootable; recover its managed publication rather than clearing stamps by hand. |
| `SNAPBACK_FORK_LINEAGE_INVALID` | Stop. Do not trust or delete the target until its local lineage provenance is understood. |
| `SNAPBACK_FORK_SIDECAR_MISSING` / `SNAPBACK_FORK_SIDECAR_MALFORMED` | Do not reuse parent credentials or invent replacements; recover if publication is partial, otherwise recreate the fork. |
| `SNAPBACK_FORK_REGISTRY_STALE` | Treat the registry as advisory and inspect the named exact path; never recursively sweep based only on the row. |
| `SNAPBACK_FORK_STOP_UNVERIFIED` | Resolve the missing/stale ready descriptor or live PID; Snapback intentionally will not signal or delete an unproved target. |
| `SNAPBACK_FORK_EXPIRED_REAP_FAILED` | Inspect the reported expired targets and restore enough evidence to stop/reap them safely before retrying create. |
| `SNAPBACK_FORK_ADMISSION_TIMEOUT` | Another creator did not finish its atomic admission/publication interval within 30 seconds. Inspect that creator and its exact staging/publication state; retry only after it exits or recovery resolves its destination. |
| `SNAPBACK_FORK_SERVER_EXPIRED` | Expected finite-TTL enforcement: use `create` or explicit `reap` to prove the stopped process and remove the fork, or `renew` **before** expiry to extend it. |
| `SNAPBACK_FORK_RENEW_EXPIRED` | Renewal never resurrects: the fork is already past expiry — reap it and create a fresh fork. |
| `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` | A configured bound refused deterministically; the details name the resource (`fork-count`, `fork-bytes`, `total-bytes`, `diff-work`, `renewal-lifetime`) and the observed usage. Net diff additionally reports its streaming `phase`, `limitKind`, journal/scanned rows, and bytes. Drop forks, raise the explicit flag, or bound the request. |
| `SNAPBACK_FORK_WRITER_COVERAGE_INVALID` | Do not treat the fork as whole-window covered. Its durable fork-point receipt is partial, tampered, late, or no longer matches the active stream/manifest; recreate it through `fork create`. |
| `SNAPBACK_FORK_WRITER_COVERAGE_GAP` | A registered writer observed a missing or contradictory boundary after coverage had armed. Snapback records the discontinuity in the database and `fork-app-row-coverage-gap.v1.json`; restoring a manifest cannot regain the class. Recreate the fork. |

## Read the diff at its real boundary

The default `snapback.fork-journal-diff.v3` receipt covers committed
**application-row journal entries in `(base, head]`**, in commit order. Its
stream-qualified `base` and `head` identify the data-version stream, commit
version, and exclusive/inclusive boundary. It says
`attribution: "absent-v1"`: row `operation` is insert/update/delete, not an LLP
0163 operation or principal identity. It explicitly omits:

- auth and credential state;
- asset blob operations;
- captured or refused egress payloads;
- privileged or raw-SQL writes outside the app journal; and
- sidecars and telemetry.

For an exact net base-to-head receipt, create the fork with
`--retain-base` (a digest-bound immutable snapshot; doubles the fork's byte
footprint, and admission accounts for it) and run `fork diff FORK_ID --net`.
The `snapback.fork-net-diff.v3` receipt is computed by comparing the
retained base against the head directly — independent of the journal — with
pre- and post-images, a named substrate (`retained-base-v1`) and
machine-readable covered/omitted domains. Both v3 receipt types carry
`receiptDigest`, a domain-separated SHA-256 digest over the JCS-canonical form
of every other emitted fact, so approval can bind the exact receipt. To verify
one, remove the top-level `receiptDigest`, serialize the remaining object with
JCS, prefix those bytes with
`snapback:fork-journal-diff-receipt:v3\n` or
`snapback:fork-net-diff-receipt:v3\n` according to `schemaVersion`, compute
SHA-256 over the concatenation, and compare the lowercase
`sha256:<64-hex>` spelling. A fork
created through the complete cold-start carrier path can advertise
`registered-connection-defensive-app-rows-v1` only
when its digest-bound coverage receipt proves the two app-row writer lanes
were armed at the fork point and the journal cross-check verifies through the
observed head. The active manifest and its per-stream continuity row are
protected carriers. Every registered writable connection must reconstruct the
matching database/file receipts, stream, manifest, and `continuous` row before
receiving a token. If one observes a gap, the continuity row becomes `broken`
and the sibling gap file is created; neither can be re-armed or erased by an
exact manifest restore. A partial generated layout remains
`journal-enumerated-v1` because its historical schema load occurs after bind.
Read
`writerCoverage.coverageWindow`, `manifestDigest`, `coveredLanes`, and
`uncoveredLanes` as separate facts. Uncovered app-effective writer families
are refused while the profile is armed; all non-app-row domains remain omitted.
The covered lane names are `derivedForkOrdinaryAppRowJournal` and
`derivedForkHostChildAppRowJournal`. They name the fork's generated-writer plus
journal boundary, not LLP 0163 operation-envelope coverage.
The receipt also says `attribution: "absent-v1"`: operation attribution is not
implemented by this net view. Any other unarmed or late-armed fork and a
retention gap remain `journal-enumerated-v1`. A change the journal cannot explain refuses
with `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH`; on the armed path, the same refusal
applies when a row's latest journal post-image disagrees with the independently
scanned head. Static receipt/fork-point contradictions refuse with
`SNAPBACK_FORK_WRITER_COVERAGE_INVALID`; a discontinuity observed by a
registered writer refuses with `SNAPBACK_FORK_WRITER_COVERAGE_GAP`, instead of
lending either condition cover. Without a retained base, `--net` refuses with
`SNAPBACK_FORK_NET_DIFF_UNAVAILABLE`.

The journal receipt is a review aid, not a complete audit and not production
migration admission. A long-lived fork can also outlive its journal floor;
then diff refuses instead of returning an incomplete receipt. The default
journal receipt pre-counts and bounds rows before materialization; it does not
have a byte-work budget. Net diff separately bounds journal rows, base/head
scanned rows, WAL validation bytes, and streamed bytes. Before converting a
scanned row to an owned document, it charges borrowed SQLite value lengths for
text escaping, blob hex expansion, JSON parsing, vector decoding, and bounded
serialization, so one oversized value refuses before proportional expansion.
Past `--max-rows` (default 100k), or past the fixed byte budget on net diff,
the operation refuses with
`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` and observed usage instead of
materializing an unbounded receipt. Use the
[reviewed migration rehearsal flow](../backend/migrations.md#rehearse-against-a-restore-derived-instance)
for production apply decisions.

The upgraded completeness class covers only Snapback-registered writable
connections with verified SQLite defensive mode and the shared default-deny
authorizer. The net receipt validates the raw WAL header and cumulative frame
checksums within its byte budget and detects/refuses ordinary raw WAL/app-row
divergence and direct page corruption, but it is not an OS/file-integrity
boundary. A same-user
process that bypasses the connection factory and coherently forges app data,
the version, and a matching journal entry is outside the claim; use an
OS/container/filesystem authority boundary for that threat.

## Know what the quarantine does not promise

- Local forks protect the parent from actions routed through the fork's
  runtime. They do not contain a malicious same-user process that can open the
  parent's files or make its own network calls; that requires an OS/container
  boundary.
- **Workloads containing arbitrary native code need an OS isolation boundary
  you provide.** The fork's `deny-all-v1` gate mediates Snapback-owned egress
  and custody surfaces only. If the app under test loads native modules,
  shells out, or executes untrusted code, run the fork server inside an OS
  containment tier — a dedicated OS user, a container (the fork directory and
  ready file are self-contained and bind-mountable), or a VM — and treat the
  fork root as inside that boundary. Snapback does not ship an integrated
  sandbox tier today; if one is added later it will be advertised as a
  separate containment tier, not folded into the runtime quarantine claim.
- The default is secret scrubbing. `--with-secrets` is an explicit high-risk
  opt-in for the config-secret sibling; it does not weaken credential minting
  or egress denial.
- Asset-bearing parents fork with **same-cut fork-private custody**: every
  blob the metadata cut names is copied into the fork's own store,
  digest- and length-verified, or publication refuses
  (`SNAPBACK_FORK_ASSET_CUT_INCOMPLETE`) — never a metadata-only success.
  Unknown stores and digest algorithms fail closed
  (`SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED`); parent-signed URLs never
  validate in the fork (fresh signing keys); creation admission counts the
  blob tree in the fork's byte estimate; `create`/`inspect` report the
  custody fact (`fork-private-same-cut` or `no-assets`).
- Manual cron tick and forced job-drain routes refuse in a fork under the
  deny-all posture; autonomous workers are also inert.
- There is no fork promotion or merge-back. Move conclusions or app-level
  changes, not fork storage, into the parent.
- There is no current derived-fork capability publication, hosted fork
  contract, released-binary/npm parity, normal-installation proof, or
  public-package claim. The withdrawn publication and required
  requalification are tracked in
  [`issues/closed/20260807-derived-fork-publication-wave-drift-requalification.md`](repo:issues/closed/20260807-derived-fork-publication-wave-drift-requalification.md).

## Anti-patterns

- **Do not copy SQLite and boot it by hand.** That bypasses credential
  scrub-and-mint, publication crash safety, fresh sidecars, and quarantine.
- **Do not share one fork across worktrees.** One worktree, one ready file, one
  finite-TTL fork keeps code, data, and cleanup ownership aligned.
- **Do not hand-kill a recorded PID or recursively delete a fork root.** Use
  `fork drop` or injected-clock `fork reap`; both prove the exact target first.
- **Do not present a diff receipt as “everything the agent did.”** Preserve its
  coverage and omissions wherever the receipt is reviewed or aggregated.
- **Do not enable secrets or external effects just to make a test pass.** Use
  deterministic provider doubles, or keep the missing external behavior an
  explicit acceptance nonclaim.

---

<!-- snapback-guide-source: guide/operating/data-patch.md -->
---
title: Patch one existing row safely
id: operating.data-patch
order: 8
audience: agent-first
capabilities: [operating.data-patch]
authorities: [llp/0184-agent-accessible-control-plane.rfc.md, llp/0024-agent-operating-surface.spec.md, llp/0031-server-route-taxonomy.spec.md, llp/0017-admin-console-inspection-surface.rfc.md, crates/snapback-kernel/src/data_patch.rs, crates/snapback-engine/src/local.rs, crates/snapback-server/src/server.rs, crates/snapback-cli/src/cli.rs, packages/snapback-cli/mcp-control.mjs]
examples: [crates/snapback/tests/data_patch_v1.rs, packages/snapback-cli/mcp-control.test.mjs]
status: current
targets: [local]
maturity: shipped
since: 0.1.10
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:a8646ba81d5d0a44332038047afe5eef25aadaf921bbf296e607e8c23eccbf46
---

# Patch one existing row safely

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use `data.patch` to correct known fields on one existing row without adding a
raw SQL, insert, delete, or arbitrary update surface. Preview validates the
closed patch and captures the row's own `_version`; apply consumes a
short-lived single-use capability and commits through the ordinary storage
changeset pipeline. Live queries therefore receive the normal commit
notification.

## Preview

Put the complete authority tuple and operation reason in a JSON file. This
example uses `devUser`, so the server evaluates the request as `user_ada` and
requires the process-bound impersonation capability advertised by the ready
file:

```json fragment reason="example identity, row id, and version are application-specific"
{
  "table": "todos",
  "rowId": "todo_01JEXAMPLE",
  "expectedVersion": 7,
  "patch": { "completed": true },
  "authority": {
    "mode": "devUser",
    "actorPrincipal": null,
    "effectivePrincipal": { "userId": "user_ada", "roles": [] },
    "localDevOnly": true,
    "adminBypass": false,
    "scope": null,
    "reason": null
  },
  "reason": "correct completion state after acceptance review"
}
```

Preview with the JSON body in a file or on stdin. Never put an apply token in
an argument:

```sh
snapback data patch --preview \
  --ready-file .snapback/dev.ready.json \
  --input patch.json > patch-preview.json
```

The response contains the validated before/after field diff, affected live
query classes, catalog digest, startup nonce, a non-authorizing token ID, and
the live apply token. Treat the live token as a short-lived secret. It is bound
to the target, process startup, catalog/schema identity, row and expected
version, normalized patch and diff, full authority tuple, reason, and expiry.

## Apply

Copy the token into the JSON body, not argv. This file-only command prepares
the exact preview input for apply:

```sh
node -e 'const fs=require("fs"); const i=JSON.parse(fs.readFileSync(process.argv[1])); const p=JSON.parse(fs.readFileSync(process.argv[2])); i.applyToken=p.data.applyToken; process.stdout.write(JSON.stringify(i));' \
  patch.json patch-preview.json > patch-apply.json

snapback data patch --apply \
  --ready-file .snapback/dev.ready.json \
  --input patch-apply.json
```

Apply holds the process-local token turn while it performs the normal
changeset commit, then consumes the token only when that commit succeeds. A
second successful apply cannot reuse it. If the same row changed after
preview, the per-row compare-and-swap fails and the token remains available
for a retry; a write to an unrelated row does not fail the patch. Because a
stale row remains stale, preview again to obtain a new row version unless the
failed operation was transient and the bound precondition is still current.

The receipt contains only the non-authorizing token ID/digest, catalog digest,
startup nonce, commit version, full authority tuple, and reason. It never
contains the live token.

## Give an agent the same operation through MCP

`snapback mcp-control` exposes two tools:

| Intent | MCP tool | Destructive annotation |
| --- | --- | --- |
| Validate and retain a preview capability | `snapback_data_patch_preview` | `false` |
| Consume that capability and commit | `snapback_data_patch_apply` | `true` (`confirmFirst` in the control catalog) |

The preview tool keeps the live capability inside the bounded MCP process and
returns only `applyTokenId`. Pass that non-authorizing ID plus the exact same
table, row, version, patch, authority, and reason to the apply tool. The raw
token is neither a tool argument nor a tool result. Restarting the MCP process
or letting the preview expire loses the capability; preview again.

## Choose the authority tuple honestly

The operation adds no authority mode. It accepts the existing LLP 0024 local
tuples as-is:

- `devUser` has `effectivePrincipal: { userId, roles }`, `localDevOnly: true`,
  and `adminBypass: false`. Different impersonated users are different token
  bindings.
- `devAdminBypass` has no effective principal, sets `adminBypass: true`, and
  repeats the required operation reason in `authority.reason`. Its receipt
  says `devAdminBypassAdmitted`: app authorization was skipped by an admitted
  local admin bypass, never "evaluated as if authorized."

Both modes still use AdminWrite transport policy. A closed schema rejects
unknown tuple or patch fields, and `_id`, `_version`, `_createdAt`, and
`_updatedAt` remain reserved.

## Know where the operation is refused

Both preview and apply run only on an ordinary primary local non-production
instance. Production profiles, hosted serving, and derived instances return
`SNAPBACK_DATA_PATCH_TARGET_REFUSED`, with `availability: "refused"` in the
diagnostic details. LLP 0158 has not granted derived recognition for this
purpose.

This is a target-availability refusal, not `operability: unavailable`: the
control-catalog rows remain shipped and directly operable on their declared
`local` target. Do not reinterpret a refusal on a different target as evidence
that the operation is missing.

Other stable refusal classes include stale row version, unknown or reserved
field, schema validator/invariant failure, missing/expired/consumed/mismatched
apply token, and invalid authority tuple. Inspect the `SNAPBACK_DATA_PATCH_*`
diagnostic instead of matching message text.

## Anti-patterns

- **Do not add a raw SQL escape hatch.** Use an application mutation when the
  correction needs logic beyond one closed row patch.
- **Do not use a database-wide version as `expectedVersion`.** Read the target
  row's `_version`; unrelated commits must not invalidate the patch.
- **Do not call apply without reviewing the diff.** Apply is deliberately
  destructive and single-use.
- **Do not describe `devAdminBypass` as app-authorized evaluation.** The
  receipt explicitly discloses the admitted authorization skip.
- **Do not expect the operation on forks, hosted instances, or production.**
  Those are deliberate availability refusals in v1.

---

<!-- snapback-guide-source: guide/operating/backup-and-copy.md -->
---
title: Back up, copy, and move a store
id: operating.backup-and-copy
order: 9
audience: agent-first
capabilities: [operating.store-durable-state]
authorities: [llp/0192-store-durable-state-set.decision.md, llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, crates/snapback-cli/src/store_state.rs, crates/snapback-cli/src/cli.rs, crates/snapback-auth/src/auth/backup.rs, crates/snapback-server/src/auth/runtime.rs, packages/snapback-cli/index.mjs]
examples: [crates/snapback-cli/src/store_state.rs, crates/snapback-cli/src/cli/tests.rs, packages/snapback-cli/load-generated.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:fd7ebe8e26470cb62e4958cff0a06be70be3a352ea820b3b8161758c587f1a19
---

# Back up, copy, and move a store

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

**A Snapback store is not one file.** `app.sqlite3` is the largest member of
its durable state, not the whole of it. Auth keys, config and secrets,
operation-detail keys, completeness-proof keys, and finalized asset blobs all
live in path-bound siblings of that database. Copy the `.sqlite3` alone and you
get a store that boots and is wrong: sessions stop resolving, config reads come
back empty, protected operation detail is unreadable, and asset rows point at
blobs that are not there.

This page is the answer to three questions: what is the durable state, how do I
copy it, and how do I get it back after a disaster.

**Aliases for the thing you are probably searching for:** backup, back up,
restore, copy database, clone database, duplicate store, move store, migrate
store, snapshot, disaster recovery, `cp app.sqlite3`, sqlite backup, WAL,
`auth-keyring.json`, missing keyring, `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`,
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`, dev-fresh reset, delete database
file, whole store.

If an artifact-mismatch refusal offers a destructive fresh-development repair,
follow its `snapback reset --dev-fresh --db <db>` command. That verb removes
and reseeds the managed whole store only when `<db>` is the canonical
CLI-owned `.snapback/dev.sqlite3`; custom, shared, and symlink-ambiguous paths
refuse before deletion. The deployment pin compared by the startup refusal is
stored in the database, but the reset remains whole-store so it cannot produce
a partial custody set. Use `snapback store export` first when the existing state
might matter.

These CLI verbs are **contributor-source** today: they exist in the source
`snapback` binary and are not yet part of a published `@expo/snapback-*`
closure. Build from source to use them.

## Ask the store what it is made of

Never guess the sibling list. Ask:

```sh
snapback store describe --db .snapback/dev.sqlite3
```

It prints every member of the durable-state set with its path, its disposition,
and whether it is present right now. It is read-only and does not need the
instance lock, so you can run it against a store while the server is serving.

## The durable-state set

Six dispositions, and the disposition decides what a copy does:

| Disposition | What it means |
| --- | --- |
| `Database` | The SQLite main database. Captured by SQLite's online backup, never by `cp`. |
| `Folded` | Already folded into the captured image. Copying it separately is a bug. |
| `Required` | A copy that omits it is not the same store. |
| `Optional` | Durable but re-minted on demand; carried when present. |
| `InstanceLocal` | Belongs to the running instance, not the store. Copying it wedges or misleads the copy. |
| `Refuse` | Its presence means this store cannot be copied by this verb at all. |

For a store at `<db>` in directory `<dir>`:

| Member | Path | Disposition |
| --- | --- | --- |
| `database` | `<db>` | `Database` |
| `sqliteWal` / `sqliteShm` / `sqliteJournal` | `<db>-wal`, `<db>-shm`, `<db>-journal` | `Folded` |
| `authKeyring` | `<db>.auth-keyring.json` | `Required` |
| `configStore` | `<db>.config.json` | `Required` |
| `operationDetailKeyring` | `<db>.operation-detail-keyring.json` | `Required` |
| `completenessProofKeyring` | `<dir>/completeness-proof-keyring.json` | `Required` |
| `assetBlobs` | `<dir>/assets/blobs/` | `Required` |
| `adminToken` | `<db>.admin-token` | `Optional` |
| `consoleCredentials` | `<db>.console-credentials` | `Optional` |
| `resumeKeyring` | `<dir>/resume-keyring.json` | `Optional` |
| `instanceLock` | `<db>.snapback.lock` | `InstanceLocal` |
| `targetInstanceReservation` | `<dir>.snapback.restore.lock` | `InstanceLocal` |
| `telemetry` (+ companions) | `<db>.telemetry*` | `InstanceLocal` |
| `assetStaging` | `<dir>/assets/staging/` | `InstanceLocal` |
| `managedBranchWorkspaces` | `<dir>/.<db-name>.in-app-branches-v1/` | `Refuse` |
| `forkMintReceipt` | `<dir>/fork-mint-receipt.json` | `Refuse` |

Two members keep **fixed names in the database's directory** rather than
db-prefixed names: `resume-keyring.json` and
`completeness-proof-keyring.json`. Two databases in one directory share them.
That is worth knowing before you put two stores side by side.

`<db>.auth-keyring.json` is the one that bites first. It holds the signing keys
for the auth catalog, and a marked catalog **never re-mints it** — startup
deliberately refuses to invent replacement keys for sessions that already
exist. A database copied without it boots with a `Ready` catalog and no way to
sign or verify email-code challenges.

## Copy a store

```sh
snapback store export --db .snapback/dev.sqlite3 --output /backups/dev-2026-08-08
```

The output is a directory that **boots directly**:

```text
/backups/dev-2026-08-08/
  dev.sqlite3
  dev.sqlite3.auth-keyring.json
  dev.sqlite3.config.json
  resume-keyring.json
  completeness-proof-keyring.json
  assets/blobs/...
  store-export.json
```

Serve the copy with no further ceremony:

```sh
snapback start --db /backups/dev-2026-08-08/dev.sqlite3
```

`store-export.json` records what was carried, what was excluded and why, and
the export's declared properties:

```json fragment reason="manifest shape; digests and timestamps are per-export"
{
  "formatVersion": 1,
  "sourceDatabaseBasename": "dev.sqlite3",
  "members": [{ "id": "authKeyring", "file": "dev.sqlite3.auth-keyring.json", "disposition": "Required" }],
  "excluded": [{ "id": "sqliteWal", "disposition": "Folded", "reason": "folded into the captured image by the online backup" }],
  "declaredProperties": { "walFolded": true, "carriesAdminAuthority": true, "carriesLiveSessions": true }
}
```

### It is WAL-consistent, and that matters

The database member is captured with SQLite's online backup API bound to the
staged file descriptor. Every committed page in the WAL is folded into the
image, and the image's header is normalized to rollback mode so it stands
alone. Consequences:

- **You do not need a clean shutdown.** A store whose server was `SIGKILL`ed —
  or whose shutdown stranded a large WAL — still exports completely, because
  the online backup reads committed WAL content rather than trusting the
  database file alone. There is no `PRAGMA wal_checkpoint` to race. This
  matters more than it sounds: a bare instance killed mid-run can leave a 4 KiB
  `.sqlite3` beside a 1.3 MiB `-wal`, so `cp app.sqlite3` copies essentially
  nothing.
- **Never copy a `-wal` file beside a database.** The exported directory has no
  `-wal` or `-shm` sibling by design, and one appearing next to an export is a
  sign somebody opened the copy, not that the copy was incomplete.

The export runs offline under the instance lock, exactly like
`snapback auth backup`. Against a running server it refuses and names the
owner:

```text
SNAPBACK_STORE_EXPORT_INVALID
  Snapback database is already owned by another local server:
    db: .snapback/dev.sqlite3
    server: http://127.0.0.1:51670
    pid: 57921
```

Stop the server and re-run. `snapback store describe` has no such
restriction — it takes no lock and answers while the server serves.

### Publication is atomic

The export stages into an unpredictable sibling directory, fsyncs every member,
renames once, and fsyncs the parent. Every exit reports one of three states:

| `publicationState` | Meaning |
| --- | --- |
| `Unpublished` | Nothing exists at the output path. The staging directory was cleaned up. |
| `Published` | The complete directory is durable at the output path. |
| `CommitAmbiguous` | The rename was attempted and something after it failed. A complete unit **may** exist at the output path; validate or remove it yourself. |

Only `Unpublished` may be described as "published nothing."

### What an export deliberately is and is not

An export is a **faithful copy**. It carries live sessions, agent tokens, and —
when the admin token is present — local admin authority over the copy. Treat
the output directory as being exactly as sensitive as the original store, and
do not hand somebody an export you would not hand your admin token to.

It does **not** carry device push-token bytes: the staged image drops the
push-token registry rows under LLP 0143 device-token custody, because an export
is an export surface and token custody does not travel across one. The schema
survives; the tokens do not.

It **refuses** rather than lying when the store carries state it cannot
faithfully copy: a non-empty managed-branch workspace directory, or a
`fork-mint-receipt.json` marking the store as a derived fork. Both refuse with
`SNAPBACK_STORE_EXPORT_REFUSED` naming the member. For a derived deployment,
use [local instance forks](./instance-forks.md) instead — that verb owns
lineage, scrubbing, and TTL.

## Copy versus restore versus fork

Three verbs, three different products. Pick by what you want to be true
afterwards:

| You want | Verb | Sessions and credentials afterwards |
| --- | --- | --- |
| A second store that behaves exactly like this one | `snapback store export` | Preserved — same sessions, same tokens, same admin authority |
| To recover an instance's auth unit from a disaster | `snapback auth backup` then `snapback auth restore` | Destroyed on purpose — restore revokes and requires an explicit `--restored-from-backup` declaration before the instance may bind |
| An independent, finite-lived development instance from realistic rows | `snapback fork create` | Rotated — fresh instance, authorization-stream, admin-token, and resume-keyring identities |

`snapback auth backup` publishes the neutral `database.sqlite3` /
`auth-keyring.json` layout that `snapback auth restore` consumes; it is not
directly bootable, and that is deliberate. `snapback store export` publishes a
bootable layout named after your database and does not revoke anything.

## Recover from a disaster

```sh
snapback auth backup --db .snapback/dev.sqlite3 --output /backups/auth-2026-08-08
# ... later, into a wholly absent instance directory:
snapback auth restore --from /backups/auth-2026-08-08 --db /srv/recovered/dev.sqlite3
# the restore prints a declarationId; the next start must present it:
snapback start --db /srv/recovered/dev.sqlite3 --restored-from-backup <declarationId>
```

The declaration is the safety interlock: a restored instance refuses to bind
until an operator explicitly says "yes, this is a restore," so a backup
directory can never be silently served as if it were the original.

## Diagnose a bad copy

A store copied without its keyring records this at startup — the message names
the exact file it wants:

```text
SNAPBACK_AUTH_PROVIDER_UNAVAILABLE
  email-code auth provider is unavailable: the auth keyring sidecar is missing
  durableStateMember: authKeyring
  path: /srv/copy/dev.sqlite3.auth-keyring.json
  cause: missing
```

`cause` is `missing`, `corrupt`, or `unavailable`. Read it from
`recentDiagnostics` in `snapback inspect`, or from the server's startup output.

The **503 returned to HTTP clients** carries the same code with no path and no
details. That asymmetry is deliberate: the operator gets the path, and an
unauthenticated caller does not learn your filesystem layout. Do not go looking
for the path in a client response — run `snapback store describe` instead.

## Anti-patterns

- **`cp app.sqlite3 elsewhere/`.** The defect this page exists to kill. It
  drops the keyring, config, operation-detail keys, completeness-proof keys,
  and every asset blob, and it may drop committed WAL content on top of that.
  Use `snapback store export`.
- **`cp app.sqlite3*` (glob).** Better, and still wrong. It picks up
  `-wal`/`-shm` (which the online backup would have folded, and which a naive
  copy can tear against a live writer), the instance lock (which wedges the
  copy), and the telemetry store — while still missing the two
  fixed-name directory members and the whole `assets/blobs/` tree.
- **Hard-coding the sibling list in a script or a test gate.** It has changed
  and it will change again. Call `snapback store describe` or
  `snapback store export`; a gate that re-derives the list is a gate that will
  discover the next new sibling the expensive way.
- **Copying a store while assuming a clean shutdown made it safe.** Shutdown
  can strand a WAL. The export does not care about shutdown state; a `cp` does.
- **Serving an `auth backup` directory directly.** It is not bootable, and if
  you rename it into a bootable shape you have skipped the restore declaration
  that exists to stop exactly that.
- **Treating an export as sanitized.** It is not. It carries sessions and, if
  the admin token was present, admin authority. Use `snapback fork create` when
  you want the scrubbed thing.

---

<!-- snapback-guide-source: guide/operating/replication.md -->
---
title: Continuously replicate a local SQLite store
id: operating.replication
order: 10
audience: agent-first
capabilities: [operating.replication]
authorities: [llp/0188-ltx-sqlite-replication.rfc.md, crates/snapback-services/src/replication.rs, crates/snapback-cli/src/cli.rs, scripts/g2-replication-drill, scripts/g2-receipts/20260809-self-hosted-async-minio-sustained.md]
examples: [scripts/g2-replication-drill]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:9b727f6437aaba9ddc8a5ca69cf043f818a3f6e9c109e65925fed2d341d564d7
---

# Continuously replicate a local SQLite store

> **Local target only.** This page describes the experimental self-hosted
> local lane. Hosted replication, supervisor custody, succession, and the G3
> checkpoint substitution are not shipped.

The contributor-source `snapback` binary can continuously copy a file-backed
SQLite instance to a filesystem or S3-compatible target as LTX segments. It
also copies the auth keyring as separately encrypted, content-addressed
snapshots. Use this lane to reduce a self-hosted instance's disaster-recovery
window; it is physical durability, not client sync and not a general hosted
backup product.

**Aliases:** replication, Litestream, LTX, SQLite streaming backup, continuous
backup, disaster recovery, RPO, restore point, restorable frontier, MinIO,
`snapback replicate`, `SNAPBACK_REPLICATION_TARGET`.

This is an **Experimental Guide classification only**. No target capability
manifest advertises replication, and passing the local G2 drill does not make
the hosted or full LLP 0188 corpus true.

## Configure the self-hosted async lane

Replication is off when `SNAPBACK_REPLICATION_TARGET` is absent or empty. When
it is set, a file-backed server requires an externally provisioned encryption
key file and starts the async replication runtime with the instance:

```sh
umask 077
openssl rand 32 > /srv/snapback/replication-key

export SNAPBACK_REPLICATION_TARGET='s3://my-backups/production'
export SNAPBACK_REPLICATION_REGION='us-east-1'
export SNAPBACK_REPLICATION_ACCESS_KEY_ID='...'
export SNAPBACK_REPLICATION_SECRET_ACCESS_KEY='...'
export SNAPBACK_REPLICATION_KEY_FILE='/srv/snapback/replication-key'

snapback start --db /srv/snapback/app.sqlite3
```

The complete environment surface is:

| Variable | Meaning |
| --- | --- |
| `SNAPBACK_REPLICATION_TARGET` | Required to enable the lane. Accepts `file:///absolute/or/resolved/path` or `s3://bucket/prefix`. |
| `SNAPBACK_REPLICATION_KEY_FILE` | Required when enabled. Owner-only file containing exactly 32 raw bytes; encrypts every keyring snapshot. |
| `SNAPBACK_REPLICATION_ENDPOINT` | Optional S3-compatible endpoint override. Setting it selects path-style requests, as needed by MinIO. |
| `SNAPBACK_REPLICATION_REGION` | Optional S3 region override. |
| `SNAPBACK_REPLICATION_ACCESS_KEY_ID` | Optional S3 access-key id. |
| `SNAPBACK_REPLICATION_SECRET_ACCESS_KEY` | Optional S3 secret access key. |
| `SNAPBACK_REPLICATION_SESSION_TOKEN` | Optional temporary S3 session token. |
| `SNAPBACK_REPLICATION_PREFIX` | Optional prefix override; otherwise the path from the S3 target is used. |
| `SNAPBACK_REPLICATION_INTERVAL_MS` | Positive async capture interval in milliseconds; defaults to 250 when absent or invalid. |

The key file is not recoverable from the bucket. Back it up in custody separate
from the replicated instance and test clean-machine access to it: losing it
makes the encrypted keyring snapshots unrecoverable, and a database restored
without its governing keyring is deliberately refused.

Keyring snapshots are client-side XChaCha20-Poly1305 encrypted on both target
kinds. Segment posture is weaker in this experimental lane: S3 reports
`segmentEncryption: "provider"`, while a file target reports `"none"`.
`status.weakerPosture` states the concrete single-custody consequence. Do not
infer append/head credential separation, store-enforced immutability, or
stale-writer harmlessness from successful upload.

## Read the restorable frontier and lag

```sh
snapback replicate status --db /srv/snapback/app.sqlite3
```

With replication disabled, this still returns a
`snapback.replication-status.v1` JSON object with `enabled: false`. An enabled
status reports:

| Field | Read it as |
| --- | --- |
| `replicatedPosition` | The database position committed by the authoritative remote head. |
| `keyringCoverage` | The greatest head-committed position with a governing encrypted keyring snapshot. |
| `frontier` | The **restorable frontier**: the lesser of `replicatedPosition` and `keyringCoverage`. |
| `observedLag.positions` | Local LTX transaction positions ahead of the remote head at observation time. |
| `observedLag.sourceVersions` | Local Snapback source versions ahead of the remote head at observation time. |
| `degraded` / `error` / `errorDetail` | Whether the lane has stalled or halted, and the stable `SNAPBACK_REPLICATION_*` reason. |
| `segmentEncryption` / `weakerPosture` | The actual segment confidentiality and custody claim, including its downgrade. |

The frontier, not `replicatedPosition` alone, is the disaster-recovery
boundary. A segment that has reached the target is not restorable until the
head also commits keyring coverage for it. RPO language must therefore use the
observed frontier lag; `degraded: true` is an availability/durability incident,
not permission to keep claiming the old bound.

## Force one offline checkpoint

Stop the server first, then run the checkpoint against the same file-backed
database and environment:

```sh
snapback replicate checkpoint --db /srv/snapback/app.sqlite3
```

The command takes the instance lock, captures outstanding WAL, publishes
durable keyring coverage, verifies the remote state, performs the final SQLite
checkpoint, and prints the resulting replication status. It refuses when the
database is missing or replication is disabled.

This landed command is the self-hosted G2 operation. Its status output is not
LLP 0188's complete hosted `MigrationCheckpointV1` proof envelope, and it does
not qualify the unbuilt G3 substitution.

## Restore only within the frontier

Restore into a new, absent directory. Omitting `--position` chooses the current
restorable frontier; an explicit position is an LTX transaction id and must be
positive and no greater than that frontier:

```sh
snapback replicate restore --output /srv/restores/2026-08-10
# or: snapback replicate restore --output /srv/restores/2026-08-10 --position 417
```

The command verifies the remote lineage and LTX chain, selects and decrypts
the keyring snapshot governing that position, runs SQLite integrity checks,
and writes:

```text
/srv/restores/2026-08-10/
  database.sqlite3
  database.sqlite3.auth-keyring.json
  restore-declaration.json
```

Its JSON result deliberately says `servable: false` and prints a
`restoreDeclarationId`. The restored image is quarantined until the existing
LLP 0057 declared-restore path performs bulk session revocation:

```sh
snapback start \
  --db /srv/restores/2026-08-10/database.sqlite3 \
  --restored-from-backup <restoreDeclarationId>
```

Do not copy or reuse the source database's
`<db>.replication.json` sidecar. Restore and fork outputs must not inherit the
source replication incarnation; this experimental implementation refuses a
missing/foreign/divergent attach rather than silently minting succession.

## Run the G2 crash-and-restore drill

`scripts/g2-replication-drill` is the qualification path for the landed local
slice. It uses a real MinIO server, sustained Snapback writes, a clean
convergence boundary, a deliberate ahead-of-head `SIGKILL`, clean-directory
restore, integrity and exact-keyring pairing, ahead-of-head resume, and a
foreign-incarnation refusal. It never self-skips.

Provide an already-built current binary plus MinIO and SQLite when running the
drill from a prepared checkout:

```sh
SNAPBACK_G2_BIN=/absolute/path/to/snapback \
LTX_MINIO_BIN=/absolute/path/to/minio \
SQLITE3_BIN=/usr/bin/sqlite3 \
scripts/g2-replication-drill
```

The script also requires `curl` with `--aws-sigv4` and Ruby. Its retained
receipt is
`scripts/g2-receipts/20260809-self-hosted-async-minio-sustained.md`. That
receipt qualifies only MinIO, self-hosted single custody, one incarnation, and
one generation. It explicitly does not qualify succession, hosted epoch
handover, per-credential immutability, or another provider.

## Anti-patterns

- **Do not call the raw database position restorable.** Keyring coverage can
  hold the frontier behind it.
- **Do not keep the only encryption key beside the replicated database.** A
  clean-machine restore then loses both copies in one failure.
- **Do not serve the restore directory directly.** Start with the emitted
  restore declaration so bulk revocation runs before bind.
- **Do not copy the replication sidecar into a restore or fork.** Incarnation
  fencing treats it as foreign or divergent state.
- **Do not promote G2 into a hosted or capability-manifest claim.** The hosted
  custody, succession, retention, checkpoint-proof, and G3 work remains open.
