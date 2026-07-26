# LLP 0072: Fly adapter remaining surface after the first observation driver

**Status:** Open
**Severity:** P2
**Systems:** Deployment, Control plane, TLS, Backup, Migrations
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-26
**Related:** Draft LLP 0072, LLP 0098, LLP 0081 (OQ7 → container-VM migration-executor profile), `packages/snapback-cli/adapters/fly-machines-vm-driver.mjs`, `demos/competitive-checkpoint/acceptance/results/control-plane-remote.v0.json`
**Marker:** 0072-lane, hosted-drill

The first concrete adapter driver landed 2026-07-26 (observation +
provider-event logs with the first `remoteEvidence: true` control-plane
response, live fail-closed negatives, platform interruption/resume). This
ticket is the honest inventory of what still separates the
`single-instance-container-vm.v1` adapter from LLP 0072's acceptance corpus,
bucketed by what each item needs. The LLP 0081 migration-executor profile
(OQ7) is sequenced behind this corpus earning remote evidence.

## Bucket (b) — code exists, needs remote wiring

- **`inspectAdmin` sourcing**: the driver refuses in-protocol; it needs the
  served capability-manifest digest and generation facts from the origin over
  verified TLS (route wiring plus the healed origin below).
- **Standalone backup plan/apply through the control plane**: the CLI path is
  implemented and fixture-proven; the driver owes the lifecycle `backup`
  operation against the Tigris bucket with read-back verification (the
  drill-script witness `backup-to-tigris.sh` already proves the storage side).
- **Active-state re-witness**: the 2026-07-26 receipts classify the started
  machine as `degraded` because the origin's TLS is down (real, structural).
  When the origin heals, re-run `control-plane-remote.mjs` so the `active`
  classification is witnessed too.

## Bucket (c) — code that does not exist yet

- **Lifecycle-train driver operations** (upload, provision, stage, activate,
  rollback, restore, restore-activate) against Fly Machines + registry
  images, driven by `deploy apply`'s existing train.
- **Linux release closure**: `deploy build` producing the target's immutable
  release with the pinned Linux Hermes runtime staged as a manifest fact
  rather than a Dockerfile side-channel.
- **Adapter qualification**: the eleven-claim `snapback.adapter-qualification.v1`
  with real remote attestations; blocked in turn by the two unenforced
  hosted-auth facts (`operatorSurface: disabled`, LLP 0060 D2
  plaintext-refusal) and the unrun LLP 0077 matrix (LLP 0098 partial pass).
- **Remote/external audit sink** beyond the local hash-chained ledger.
- **Cert persistence fix (real incident, 2026-07-26)**: the origin lost its
  Let's Encrypt certificate and burned the 5-per-168h duplicate-certificate
  rate limit (retry recorded for 2026-07-27 00:40 UTC). Caddy's volume-backed
  cert storage evidently did not retain across the 2026-07-25 machine
  replacement, and earlier staging/production ACME iteration consumed the
  budget. The adapter's TLS-renewal evidence must include storage-persistence
  proof across machine replacement, not just issuance success.

## Bucket (a) — infrastructure only

- None outstanding: the drill deployment (app `snapback-drill`, machine
  `849764f2e7dd58`, sjc, Tigris bucket) exists and is the registered target.

## Credential custody

The driver resolves `keychain://snapback-fly-drill/drill` via the macOS
keychain (operator-staged). Receipts and the registry never carry the value.
