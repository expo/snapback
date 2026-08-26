# LLP 0072: Fly adapter remaining surface after the first observation driver

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 1
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “LLP 0072: Fly adapter remaining surface after the first observation driver” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while delivery is a dependency-heavy, multi-stage program, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Deployment, Control plane, TLS, Backup, Migrations
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-26
**Related:** Draft LLP 0072, LLP 0098, LLP 0081 (OQ7 → container-VM migration-executor profile), `packages/snapback-cli/adapters/fly-machines-vm-driver.mjs`, `demos/competitive-checkpoint/acceptance/results/control-plane-remote.v0.json`
**Marker:** 0072-lane, hosted-drill

**Backend-bakeoff program update (2026-07-27):** this existing ticket owns
comparison item 15; no duplicate hosted-path ticket was filed. Closing it now
also requires one ordinary product receipt proving the complete author journey:
one stable public URL and immutable deployment/release/database identity;
structured build and runtime logs; authenticated inspection; migration
preflight/apply; backup plus executed restore verification; code rollback;
cost/capacity visibility; and exact recovery diagnostics. The receipt must be
produced through the public CLI from an installable package, not by composing
private drill scripts, and must list every unsupported scale/SLA/profile claim.

The first concrete adapter driver landed 2026-07-26 (observation +
provider-event logs with the first `remoteEvidence: true` control-plane
response, live fail-closed negatives, platform interruption/resume). This
ticket is the honest inventory of what still separates the
`single-instance-container-vm.v1` adapter from LLP 0072's acceptance corpus,
bucketed by what each item needs. The LLP 0081 migration-executor profile
(OQ7) is sequenced behind this corpus earning remote evidence.

**LLP 0111 checkpoint (2026-07-28):** the independently packed hosted
supervisor is installed and its real SQLite → immutable mirror → conditional
anchor write/restart recovery proof passes. An isolated destructive-component
drill also created a verified backup of the live application SQLite database,
restored it onto a fresh encrypted volume attached to a zero-service helper
Machine, matched its digest, and passed SQLite integrity over 29 tables. The
helper Machine, helper volume, and backup object were then deleted and
read-back absent; the original production roster was unchanged. See
`demos/signal-desk/hosted-supervisor-installation.v1.json` and the
deliberately non-success
`demos/signal-desk/hosted-product-journey.v1.json`.

This does not close a lifecycle row. The drill used the existing private
backup executable to validate the remote destructive primitive, not the
public packed lifecycle train; restore activation, immutable release,
migration, rollback, served inspection, online admission, relation/activity
remote qualification, and the remote ephemeral corpus are still missing. The
public target currently returns `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED`, so
the product receipt and ticket remain failed/open.

**Runtime-artifact staging landed (2026-07-30):** `deploy build` now
accepts `--runtime-artifact`/`--runtime-platform`/`--runtime-hermes-bundle`,
staging the linux-x64 binary and libhermesvm.so into the immutable closure
as scanned components plus a closed `runtimeArtifact` manifest fact with
ELF-header platform authority at staging and verifyRelease time (salvaged
from the interrupted 2026-07-26 lifecycle run, rebased across the bakeoff
rework; the admission-keypair rotation that rode the original commit was
superseded by hosted-v2-1 and dropped). This is the staging mechanism only:
producing and pinning an actual Linux release-closure receipt through it,
and the adapter-verification half of `control-plane.runtime-artifact`,
remain open below.


## Triage (2026-08-26 leftover sweep)

Still open — this remains the product-receipt owner. LLP 0111 and LLP 0099 being **Accepted** does not close any of this ticket's buckets. `inspectAdmin` still refuses; all `snapback hosted lifecycle` verbs still `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`.

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

## Bakeoff acceptance additions

- `snapback deploy` (or the ratified equivalent) takes a generated app from a
  clean source tree to the registered Fly/Tigris target without hand-editing
  target state.
- Upload, provision, stage, activate, inspect, logs, backup, restore,
  restore-activate, rollback, and destroy/withdraw are resumable through the
  existing lifecycle train and bind remote read-back evidence.
- The Linux/Hermes runtime, app artifacts, web artifacts, migrations, adapter
  qualification, hosted admission, TLS state, audit roots, and cost facts are
  one immutable prepared-release graph.
- TLS/certificate custody survives machine replacement without consuming a new
  production issuance budget.
- A fresh operator can follow the deployment guide from public package
  installation to the green receipt without repository-private knowledge.
- This ticket does not close, and no supported hosted claim is made, until the
  remote receipt above passes and LLP 0072's required ratification/review gate
  is satisfied.

**Target-onboarding progress (2026-07-28):** distinct target-scoped Fly
control/registry credentials, a supervisor-only Ed25519 admission seed, and a
dedicated target outbound mTLS identity are staged for the fresh
`snapback-drill-hosted-v2-20260728` identity. The admission-capable supervisor
image is live and healthy, while the legacy routed Machine retains its exact
old image, services, and cert-only volume. See
`demos/signal-desk/hosted-target-onboarding.v1.json`. This advances
credential custody and the outbound channel only; no lifecycle row passes
until the fresh successor, binding, release, cutover, and complete public CLI
receipt do.

The same staged receipt now includes six distinct Tigris role fingerprints and
live own-prefix/wrong-role probes. The provider refused an attempted
prefix-conditioned `ListBucket` policy, so cleanup inventory is accurately
recorded as bucket-scoped under supervisor-only custody; cleanup object verbs
are delete-only and target-prefix-scoped, while its read/write denials and
cross-prefix target delete were proven. This is retained provider evidence,
not a completed backup,
restore, lifecycle, or cleanup row.

**Signed target-admission progress (2026-07-28):** the local supervisor,
target verifier, packed renewer, and client transport now agree on the closed
dual-signed online envelope. The supervisor mints only after exact complete
Fly roster plus image/volume/region/route/autostop/autostart read-back; the
target installs only a current `HostedAdmissionV2`, derives the opaque `eai1.`
process authority, and binds requests/frames to it. Tamper, stale, replay,
roster-drift, schema-drift, and packed-renewer fixtures pass. This does not
move any item out of bucket (c): the installed supervisor still runs the prior
image and the fresh successor lifecycle/cutover/remote qualification remains
unperformed.

**Public-package authority tranche (2026-07-28):** the installable CLI now
ships a package-owned `snapback hosted` registry, the Fly driver, and exact
`FlyTargetBindingV2`, `HostedControlHeadV2`, and lifecycle request/response
schema mirrors. `plan`, `inspect`, and `logs` are reachable without a source
checkout. Every packaged lifecycle-v2 verb now fails before credential
resolution or provider work with
`SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`; packaging the vocabulary does
not claim a provider effect.

The independently packed supervisor now also carries the closed request/scope
registry and an operator-authority core: Ed25519 request binding, per-device
sequence and revocation checks, certificate-expiry binding, atomic canonical
response replay, credential-response redaction, and the bounded release-upload
state machine. These are checkout-free package proofs, not the external-store
or provider-effect executor. The standing service has not been upgraded and
no remote lifecycle row changes status.

**Carrier/custody correction (2026-07-28):** all seventeen lifecycle
operations, including `releaseLease`, share the same zero-provider-call
refusal. The packaged availability registry is `disabled`, and no provider
nonce is exposed as a public lease id. A separately reviewed per-operation
carrier, opaque lease custody, listener/bootstrap proof, and live transaction
corpus are tracked in
`20260728-hosted-lifecycle-carrier-and-custody-gap.md`. This replaces the
older “until an executor exists” description: an executor alone is
insufficient and must not bypass the carrier/custody gate.
