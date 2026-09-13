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
  `hermes/` from the repository root before deploying, or re-verify an already
  staged carrier without downloading it again:

  ```sh
  node scripts/stage-linux-hermes-release.mjs
  node scripts/stage-linux-hermes-release.mjs --check
  ```

  The 2026-08-03 vector qualification could not use that download path: no
  release asset matched vendored Ibex commit `2afa439b` and Hermes commit
  `e639a7bad8bfca844d982afa54fac786c65a8856`. The retained fallback was built
  from that exact vendored source on an independent x86_64 Linux host. Its
  tarball SHA-256 is
  `75d7202611cbe4d912f21f83f10384852331d9c043512c1076724cfab0b8751a`;
  the embedded provenance pins patch-stack digest
  `sha256-9a846368e13304659cb6e0d4be78853bad6415de01f68a4191f7cd9b3af2c7d7`.
  `issues/shelved/20260803-linux-hermes-release-carrier-gap.md` tracks restoring the
  ordinary published-artifact path.

  On 2026-08-07, the `hermes-artifacts` workflow publishes on every Ibex
  `main` push, with name-keyed cache assets rebuilt only when absent. The
  current vendored identity `e639a7bad8bf-9a846368e133` has a published,
  checksum- and attestation-verified Linux x64 asset whose SHA-256 is
  `fed145eaf0fcd1f7e80a4fa8f3701c46b47c2f06c0b63d3e8f6ad0a6254286a5`.

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
     --build-arg SNAPBACK_BUILD_GIT_COMMIT="$(git rev-parse HEAD)" \
     --build-arg SNAPBACK_BUILD_GIT_DIRTY=0 \
     --remote-only --ha=false --yes
   ```

   Secrets on the app: `SNAPBACK_ADMIN_TOKEN` (operator-minted) plus the
   Tigris credentials staged by `fly storage create`.

   If the ordinary Fly source builder cannot complete the release profile,
   build the exact clean source on an independent Linux host, stage the
   ignored release closure under `drill/prebuilt/`, and create
   `prebuilt/SHA256SUMS` plus `prebuilt/source-revision`. The alternate carrier
   verifies every staged byte and the clean revision before assembling the
   runtime image. The maintained stager automates the Hermes-library half of
   that handoff: `node scripts/stage-linux-hermes-release.mjs --prebuilt-lib`
   copies the verified bundle's `lib/` tree into `drill/prebuilt/lib/`, prints
   ready-to-append `sha256  lib/<name>` lines, and records every library digest
   in `hermes/staging-receipt.json`.

   The independent Linux host still contributes the three Rust binaries
   (`snapback`, `snapback-lib-tests`, and `drill-stream-source`), their remaining
   `SHA256SUMS` lines, and `source-revision` from `git rev-parse HEAD` in the
   exact clean checkout. That Rust half is not yet automated by this command.
   Once both halves are staged:

   ```sh
   fly deploy . \
     --config demos/competitive-checkpoint/acceptance/drill/fly.prebuilt.toml \
     --build-arg SNAPBACK_BUILD_GIT_COMMIT="$(cat demos/competitive-checkpoint/acceptance/drill/prebuilt/source-revision)" \
     --build-arg SNAPBACK_BUILD_GIT_DIRTY=0 \
     --remote-only --ha=false --yes
   ```

   The 2026-08-03 qualification used product source
   `8ce5f357a2282eee389e5b7b826d3a568776da0c`, deployed image manifest
   `sha256:2bff764a3325bddddea8303104ccf31f3af5ef8adaa4a26ecb7558de5451c154`,
   server SHA-256
   `19725af21f4e517af0b8ffb69d7eae988a6551875d0cd7fbb5955b54900c1cfc`,
   lib-test SHA-256
   `e9001d523bf823ef799c2190f4438efb764dfdd017eb8b5628013d7ca042ae6b`,
   and runtime `libhermesvm.so` SHA-256
   `d1bde2b2912ff3b71a30328813b0b2477ef03c08657dc18fd309854615f35d5d`.
   The carrier commits may be newer than the product revision; the source file,
   image label, checksums, and qualification receipt bind the bytes that matter.

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

6. LLP 0132 exact-vector scale qualification: the image also contains the
   release-mode library-test instrument. Invoke only the ignored D=1,536 ×
   43,690 acceptance by its exact name, bind the code revision and concrete
   machine identity, and copy its emitted JSON receipt back into the committed
   conformance corpus:

   ```sh
   fly ssh console -a snapback-drill -C \
     "env SNAPBACK_VECTOR_QUALIFICATION_REVISION=<commit> SNAPBACK_VECTOR_QUALIFICATION_MACHINE=single-instance-container-vm.v1:fly.io/sjc/<machine-id> SNAPBACK_VECTOR_QUALIFICATION_RECEIPT_OUT=/tmp/vector-search-v1.scale.json /app/bin/snapback-lib-tests --ignored --exact vector::acceptance::realistic_scale_d1536_filled_partition_emits_budget_receipt --nocapture"
   fly ssh console -a snapback-drill -C \
     "cat /tmp/vector-search-v1.scale.json"
   ```

   This qualifies the same local SQLite exact-scan adapter inside the Linux
   single-instance container/VM. It does not make the served target advertise
   a hosted vector capability: the receipt records the served local profile,
   container adapter, exact machine shape, and the unchanged hosted/ANN/live
   nonclaims. Size the one machine from the retained peak-RSS evidence and
   record any temporary resize; do not infer a memory claim from this runbook.

   The retained 2026-08-03 receipt is
   `tests/acceptance/vector-search-single-instance-container-vm-scale.v1.json`.
   Machine `849764f2e7dd58` was temporarily resized from its normal
   shared-cpu-1x / 512 MiB shape to two shared CPUs / 4,096 MiB, then restored
   immediately after the run. The exact filled-partition test passed in
   419.73 seconds: build 258,462 ms, update 5,156 ms, query 4,953 ms, peak RSS
   1,931,902,976 bytes, and database 1,491,980,288 bytes. The receipt retains
   the local-target profile, concrete remote carrier, and ANN/hosted/Postgres/
   live-vector nonclaims separately.

The checkpoint protocol receipts were produced 2026-07-25; protocol amendment
v0.7 pins their provisioned identities, tool versions, and instrument digests.
The LLP 0132 scale receipt is the separately dated 2026-08-03 qualification
described above and does not amend or reopen the shelved timed comparison.

## Control-plane observation runbook (2026-07-26)

The target is registered with the packaged control plane behind the concrete
Fly Machines driver (`packages/snapback-cli/adapters/fly-machines-vm-driver.mjs`):
credential custody is the macOS keychain item `snapback-fly-drill`/`drill`
(operator-staged, never in the repository), the account fingerprint binds the
real org slug (`fly-org-charlie-cheever`), and the witness

```sh
node demos/competitive-checkpoint/tests/acceptance/control-plane-remote.mjs
```

runs live doctor/inspect read-back, the fail-closed negatives (wrong-account
mismatch, missing credential, tampered driver bytes), production-posture
control logs with a verified `remoteProviderAttestation`, and a platform
stop/start interruption observed through the adapter. Receipt:
`demos/competitive-checkpoint/acceptance/results/control-plane-remote.v0.json`.
Lifecycle operations are deliberately unimplemented in this driver slice and
fail closed (`issues/shelved/20260726-0072-fly-adapter-remaining-surface.md`).

Known incident (2026-07-26): the origin's Let's Encrypt certificate lapsed
into the 5-per-168h duplicate-certificate rate limit (retry after 2026-07-27
00:40 UTC), so the served origin fails TLS and the adapter honestly reports
`degraded` while the machine is `started`. Cert-persistence across machine
replacement is a recorded adapter GAP in the same ticket.

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
