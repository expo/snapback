# Qualify and install a default Expo local-first carrier

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Systems:** Expo, React Native, Client storage, Retained facts, Offline outbox,
Local evaluation
**Date:** 2026-08-16
**Governing:** LLP 0166 D9, LLP 0270
**Related:** LLP 0043, LLP 0090, LLP 0190, LLP 0209, LLP 0218;
`issues/20260815-local-first-defaults-audit.md`

## Problem

Expo has a useful but deliberately non-claiming file carrier. Applications
must call `registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto })`
before client construction (`guide/clients/react-expo.md`). The adapter in
`packages/snapback-client/rqs-store-expo.mjs` declares
`powerLossDurable: false` because its file projection lacks the required sync
and atomic-replacement boundary. The default resolver consequently reports
`{ implementation: 'file', durable: false, reason:
'native-files-no-power-loss-cut' }`
(`packages/snapback-client/rqs-store-default.mjs`).

That carrier can restore retained query facts after an ordinary relaunch, but
it cannot satisfy the stronger local-first seams:

- `packages/snapback-client/index.mjs` refuses offline queue custody unless
  `store.durability().durable === true`. For ordinary `queue: "auto"`, the
  non-required store lookup returns `null`, so the client preserves the
  original network failure and Expo's default-on provider drain never makes
  first-party mutation settlement work. Required paths such as explicit
  `queue: true` instead raise `SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED`;
  and
- `guide/sync/offline-and-retention.md` explicitly refuses
  `evaluateLocalResultTransform(...)` on the current non-durable Expo
  carrier.

The Expo guide's broad “offline queue works” wording is therefore stronger
than the implementation gate; qualification must follow the code's honest
ceiling, not the prose claim.

## What default means

`SnapbackExpoProvider` should install a first-party, OS-appropriate store
without an application registration call. That store must either:

1. prove the atomic commit, power-loss, lock/ownership, crash-recovery,
   corruption, quota, and multi-context semantics required for
   `durable-fragments-v1`; or
2. use a new native/SQLite carrier that can prove them.

Once qualified, ordinary Expo clients should retain owner-admitted queries,
queue deterministic mutations, run the provider-owned automatic drain, and
admit the supported local evaluator without custom `rqsStore` injection.
Unsupported OS/version rows must report an exact reason and remain
fail-closed; ordinary-relaunch persistence must not be relabeled as durable.

## Consequence classification

**Semantic consequences — not SAFE as a wiring-only flip.** A qualified
default begins durable privacy-bearing storage and offline mutation dispatch
on mobile devices. It changes logout/user-switch deletion obligations,
storage/quota behavior, backup and OS-protection posture, process-death
recovery, background settlement, and which local answers may render. LLP 0270
governs the default; LLP 0166/0043 receipts govern whether the carrier earns
it.

## Acceptance

- Real iOS and Android process-kill/power-interruption tests prove atomic
  store recovery, writer ownership, auth transitions, and outbox settlement.
- Expo constructs the qualified carrier by default and exposes its exact
  `rqsStoreInfo`; no static Metro import or app registration ceremony is
  needed.
- Offline mutation → process death → reconnect settles exactly once with the
  same deterministic intent identity.
- Retained and locally transformed reads obey LLP 0190/0209 admission,
  completeness, expiry, and refusal behavior on both platforms.
- Guide claims are narrowed or promoted to match the receipts in the same
  landing.

## Resolution (code stage)

The code stage landed in the working tree on 2026-08-16 without a capability
claim flip. `@expo/snapback-client` now has the module-neutral one-connection
SQLite carrier: WAL, FULL synchronous commits, EXCLUSIVE lifetime locking,
pragma readback, `BEGIN IMMEDIATE`, non-reentrant serialization, all v3
sections plus predecessor fences, digest validation, outbox/settlement/ACK
custody, and checkpoint-confirmed authority wipes. `@expo/snapback-expo`
owns the guarded `expo-sqlite` load, binding-derived database identity,
global refcounted registry, explicit prop/null precedence, app-client owner
compatibility, and exact fail-closed `rqsStoreInfo` reasons.

Legacy file rows are never adopted. Empty valid v3 predecessors are fenced,
deleted, and confirmed absent before SQLite exposure; pending custody keeps
the legacy writer active; unreadable bytes are preserved behind an exact
memory refusal. The packaged publication manifest remains empty, so ordinary
iOS/Android providers without a legacy registration report
`expo-sqlite-carrier-pending-qualification` and no durable claim activates.

The Node supporting tier exercises statement/boundary faults, two-process
ownership/takeover, every named crash phase, killed/truncated WAL copies,
corruption, quota/FULL rollback, and same-realm coalescing. Its receipt is
under `demos/expo-local-first-carrier/evidence/` and is explicitly
non-promotional. The qualification-only Expo probe/director documents and
drives 100 process or 25 witnessed power cuts per target cell, but no device
receipt was produced in this code-stage environment.

Status remains Open. The remaining tail is separate reviewed real-device iOS
and Android qualification, including true abrupt-power evidence, followed by
receipt-bound publication rows and only then any positive Guide/capability
promotion.

Round-2 correction made the publication cell and evidence closure complete:
OS/API version and architecture join OS/distribution/device class, Expo and
React Native join the material package identities, and each package digest is
over its installed directory artifact. The default supervised Expo environment
now resolves those facts without an application-provided target hook. The
supporting negative control runs a broken store through the same child-worker,
kill, recovery, settlement/ACK, observation, and verdict pipeline and must
produce a failing harness verdict. Same-process file-lock ownership is visible
before post-create chmod, and a failed SQLite close remains registry-owned and
retryable behind the distinct `expo-sqlite-store-close-failed` reason.

---

**Code stage landed 2026-08-16** (design + implementation via the Expo
carrier orchestration; design memo adjudicated in-session): expo-sqlite WAL
carrier (`synchronous=FULL`, EXCLUSIVE single connection, owner-bound
transactions), provider default-install with guarded require + framework
target resolver, fail-closed rqsStoreInfo taxonomy, discard-and-refetch
migration with unconditional predecessor-fence replay and legacy writer-lock
coordination, evidence-bound publication admission (self-asserted rows
rejected), and the falsifiable qualification harness (Node tier PASS 8/8
supporting-only with real SIGKILL cuts and a pipeline-real negative
control; device director for iOS/Android). Four-round dual-family review
converged (codex r4 with executed lock/close probes, grok r2 with fence/race
repros). **The packaged publication manifest is EMPTY: every ordinary cell
resolves `memory/false/expo-sqlite-carrier-pending-qualification` and no
capability claim flipped.** Remaining tail: real-device receipts per target
cell via `demos/expo-local-first-carrier/scripts/qualify.mjs` — process-cut
receipts can run on any simulator-capable Mac; the power-interruption arm
needs physical hardware with a power-cut rig or operator per the README
protocol. Ticket stays Open until receipts land and rows activate.

---

**Simulator/emulator supporting tier executed 2026-08-16/17** (orchestration
session, real virtual devices): iOS simulator (iPhone 17, iOS 26.3.1, arm64e,
Release) and Android emulator (API 36.1, Release) each completed **100 seeded
process-cut cycles, integrity ok on every cycle, all eight post-boot
invariants evaluated per cycle, zero duplicate server executions**, with
receipts source-closed over the landed tree:
`demos/expo-local-first-carrier/evidence/20260817T054654507Z-c02d1e26/` (iOS)
and `…/20260817T052745513Z-f4ae9e48/` (Android), both
`verdict: supporting-pass`, `supportingOnly: true`. Driving the director on
real devices surfaced and fixed harness-environment defects (recorded in
diary 0090): the per-invocation iOS custom-scheme dialog made deep-link
command delivery impossible headless — replaced with a director-served
GET /command polling channel (fixed port 4899, launch nonces); Android
release cleartext policy, workspace-dep mapping for the probe, simulator
launch sequencing, and toolchain env. Dual-family review of the landing
found one MATERIAL (iOS receipt bound a superseded director byte — fixed by
re-running the iOS cell against the final tree; closure now verified for
both receipts). **The packaged publication manifest remains EMPTY — these
receipts are supporting-only and activate nothing.** Remaining for
promotion: real-hardware runs per target cell (process mode on physical
devices, plus the 25-cut power-interruption arm with a battery-cut rig or
operator witness per the README protocol), referencing an eligible LLP 0189
complete battery at their landing.

---

**Real-device process tier executed 2026-08-17** (attended session, Charlie's
iPhone 17 Pro Max, iOS 26.6, Release build, physical hardware): **100/100
seeded process-cut cycles, integrity ok every cycle, 14 mid-transaction
SIGKILL cuts, zero duplicate server executions, per-cycle launch-nonce-bound
pid termination**, receipt source-closed over the landed tree:
`demos/expo-local-first-carrier/evidence/20260817T104803607Z-a698ae9b/`
(`supporting-pass`, `supportingOnly: true` — process mode never promotes).
Real-hardware execution surfaced director gaps, all fixed and re-reviewed
(diary): Xcode 26 devicectl requires pid-based terminate (now launch-json
nonce-bound with --kill), skip-build now installs the exact hashed .app
before cycling (provenance closed), protocol/observations record the actual
per-cycle cut mechanics, devicectl scratch in OS tmp, UDID hashed, battery
reference parsed from its file. Review: codex r1 NOT READY (3 MATERIAL —
skip-build provenance, pid ambiguity, protocol honesty; the first device
receipt was invalidated and the full run re-executed on the fixed director),
r2 READY no findings; grok READY. **Manifest remains EMPTY. Sole remaining
leg for iOS promotion: the attended 25-cut power-interruption arm**
(`--mode power`, interactive terminal, force-restart per cycle + witness id),
referencing an eligible LLP 0189 battery at its landing. Android real-device
legs remain open likewise.
