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
