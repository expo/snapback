# single-instance-container-vm.v1 remote drill (Fly.io, sjc)

The first remote drill target for the LLP 0075 checkpoint protocol
(amendment v0.6 pinned the provider tuple; the amendment recording first
provisioning pins the concrete identities). It produces the
`single-instance-container-vm.v1` receipt LLP 0076 decision 7 requires for
LLP 0074 gate 2, including the durable-row secret scans.

## Shape

- **One Fly Machine** (app `snapback-drill`, region `sjc`) runs the Linux
  `snapback` server on `0.0.0.0:8080` behind Fly's TLS-terminating edge, plus
  the deterministic drill stream source on machine loopback
  (`stream-source.rs`, never exposed through the edge).
- **One Tigris bucket** (`snapback-drill-backups`) is the pinned
  S3-compatible backup object store; `backup-to-tigris.sh` witnesses an
  application-consistent SQLite backup upload with byte-exact read-back.
- The Linux Hermes runtime is the prebuilt **patched** bundle
  `hermes-linux-x64-<hermes-commit-12>-<patch-digest-12>.tar.gz` published by
  `vendor/ibex`'s `hermes-artifacts` workflow for the exact pinned submodule
  commit, checksum-verified in the Dockerfile. Stage it (untracked) under
  `hermes/` before deploying:

  ```sh
  gh release download "hermes-<identity>" --repo ccheever/ibex \
    --pattern 'hermes-linux-x64-*' --dir hermes/
  ```

## Honest posture (recorded in every receipt)

- The machine bind is plaintext non-loopback behind the platform edge, so the
  server runs `SNAPBACK_PROFILE=test` with `--allow-insecure-dev-auth` and the
  fixture's client-asserted dev identities. The prod profile refuses this
  exact configuration (`src/admin.rs validate_plaintext_auth_transport`) —
  that refusal is part of the shipped fence, and this drill never claims a
  production or hosted-auth posture.
- The served instance manifest truthfully reports its own target profile; the
  `single-instance-container-vm.v1` name is the control-plane adapter/drill
  identity (LLP 0072/0075), recorded alongside the served identity, never in
  place of it.
- `--auth-deployment hosted` refuses on this target
  (`SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`): no concrete adapter owns the
  LLP 0060 hosted-edge attestation yet. The hosted-auth drill leg therefore
  produces a refusal witness, not a capability claim.

## Runbook

1. Deploy (from the repository root; `FLY_API_TOKEN` from
   `.agent-local-secrets.md`):

   ```sh
   fly deploy . \
     --config demos/competitive-checkpoint/acceptance/drill/fly.toml \
     --dockerfile demos/competitive-checkpoint/acceptance/drill/Dockerfile \
     --remote-only --ha=false --yes
   ```

   Secrets on the app: `SNAPBACK_ADMIN_TOKEN` (operator-minted) plus the
   Tigris credentials staged by `fly storage create`.

2. Run the remote instrument (seven checks, twin of `local-streaming.mjs`):

   ```sh
   SNAPBACK_DRILL_ORIGIN=https://snapback-drill.fly.dev \
   SNAPBACK_DRILL_ADMIN_TOKEN=... \
   SNAPBACK_DRILL_FLY_APP=snapback-drill \
   SNAPBACK_DRILL_MACHINE_ID=... \
   SNAPBACK_DRILL_REGION=sjc \
   node demos/competitive-checkpoint/tests/acceptance/remote-streaming.mjs
   ```

   Receipt: `demos/competitive-checkpoint/acceptance/results/remote-streaming.v0.json`.

3. Durable-row secret scan (dump ON the machine, scan locally):

   ```sh
   fly ssh console -a snapback-drill -C \
     "sqlite3 -json /data/drill.sqlite3 'SELECT * FROM _snapback_stream_attempts'" > /tmp/attempts.json
   # likewise for the app messages/conversations tables, then:
   SNAPBACK_DRILL_SCAN_SECRET_ADMIN_TOKEN=... \
   node demos/competitive-checkpoint/tests/acceptance/scan-durable-rows.mjs \
     --attempts /tmp/attempts.json --messages /tmp/messages.json \
     --conversations /tmp/conversations.json \
     --out demos/competitive-checkpoint/acceptance/results/durable-row-scan.v0.json
   ```

4. Backup-store witness: `fly ssh console -a snapback-drill -C /app/bin/backup-to-tigris.sh`.
   Its emitted fact object is retained as
   `demos/competitive-checkpoint/acceptance/results/tigris-backup.v0.json`.

5. Hosted-auth refusal witness (a refusal, never a capability claim): run the
   deployed binary on the machine with `--auth-deployment hosted` and record
   the coded pre-bind refusal plus exit code in
   `demos/competitive-checkpoint/acceptance/results/hosted-auth-refusal.v0.json`.
   The same receipt records why the LLP 0077 sender-auth matrix cannot
   honestly run on this target (sessions refuse
   `SNAPBACK_AUTH_TRANSPORT_INSECURE` on a plaintext non-loopback bind, with
   no override, by design).

All receipts were produced 2026-07-25; protocol amendment v0.7 pins the
provisioned identities, tool versions, and instrument digests.

## Teardown

`fly apps destroy snapback-drill` and `fly storage destroy snapback-drill-backups`
(plus the auto-created `fly-builder-*` app in the org, a platform artifact of
`--remote-only` builds).

Resource inventory addition (LLP 0098 author decision D4, 2026-07-25): one
persistent volume `vol_r6815pkd59o1x614` (name `caddy_storage`, 1 GB,
encrypted, sjc) for Caddy's certificate storage. Attaching it replaced the
machine: `819701c927ee68` (v0.7 pin) was retired by the platform and the
app's single machine is now `849764f2e7dd58`. `fly apps destroy snapback-drill` removes attached volumes with the
app; if tearing down piecemeal, `fly volumes destroy vol_r6815pkd59o1x614`.
