# Snapback × Zero local-sync bakeoff

This program implements the six application contracts in
[LLP 0138](../../llp/0138-zero-replicache-bakeoff.plan.md) with provider-native
Snapback and Zero arms. Field Notebook also has a separate Replicache control.

Zero and Replicache are deliberately not treated as one product:

- Zero 1.8.0 is the current query-driven relational sync layer. It retains
  cached reads while offline and refuses writes once disconnected.
- Replicache 15.3.0 is the archived predecessor used only to measure its
  durable offline mutation and rebase model.

The frozen protocol lives in `protocol/`. Application code lives under
`apps/<app>/<provider>/`; provider-specific code must remain visible.
LLP 0155's successor-evidence baseline and standards-real browser carrier
harness live under `stage0/`.

## Commands

```sh
bun install --frozen-lockfile
bun run protocol:verify
bun run stage0:verify
bun run stage0:browser
bun test
```

Each application adds provider-specific acceptance commands as it lands. A
PASS requires all declared non-skipped checks, authoritative evidence, and
successful owned cleanup. Unsupported behavior is a GAP, never a fabricated
pass.

Local Zero runs against PostgreSQL 17 with logical replication. No Rocicorp
account, Zero API key, or Replicache license key is required.

## Evidence boundary

The program compares observable sync-layer behavior, authoring experience, and
measured local performance. It does not score unrelated complete-backend
services, and local results do not imply Cloud Zero or hosted Snapback claims.
