# Build the Swift retained-facts and local-query read path

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 1
**Confidence:** 5
**Systems:** Swift, Native client, Retained facts, Local evaluation, Storage
**Date:** 2026-08-16
**Governing:** LLP 0190, LLP 0209 §8, LLP 0270
**Related:** LLP 0053, LLP 0064, LLP 0093, LLP 0095, LLP 0155, LLP 0166;
`issues/20260815-local-first-defaults-audit.md`

## Problem

The maintained Swift arm is an in-repository protocol proving client.
`guide/clients/swift.md` claims `poll/local` and `live/local`, but explicitly
does not claim offline `Parity`; those names mean communication with a local
Snapback target, not device-side query execution. The public `query(...)` in
`clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift` is
a server POST.

`StateMachine.seedRetainedRead(...)` and its lease-fencing transitions in
`clients/swift/SnapbackClient/Sources/SnapbackClient/StateMachine.swift` model
important conformance behavior, but the rows live only in process memory.
There is no persistent carrier, cold-start admission/load, materialization
API, local evaluator, or published Swift package surface.

## What default means

The supported Swift client should install a qualified Apple-platform store by
default, persist every owner-admitted query under exact artifact/authority
identity, and let its ordinary observation/query surface publish retained
facts across app restarts. For locally executable query profiles it should run
the owner IR against the admitted local materialization automatically, with
the same `current`/`retained`, completeness, and `unknown` semantics as the JS
arms.

The implementation must consume LLP 0190's D3 admission records and LLP 0209's
IR/agreement corpus. It may not promote the existing fixture-only state
machine into a durability claim or infer authorization from locally stored
bytes. Package distribution and real iOS lifecycle witnesses are part of the
deliverable because the current nested SwiftPM package is not consumable.

## Consequence classification

**Semantic consequences — not SAFE as an additive helper.** Persisting native
query data changes privacy custody, OS protection/backup posture, logout and
lease-expiry erasure, stale rendering, and local/server answer selection.
Local evaluation also carries LLP 0209's divergence and completeness risks.
LLP 0270 and the D3 risk-class receipts must govern rollout.

## Acceptance

- A consumable Swift client restores an owner-admitted public result after
  real process death with the server unreachable and labels it `retained`.
- Protected rows pass lease expiry, revocation, logout, user-switch, callback
  race, corrupt-store, and predecessor-artifact tests on a real Apple carrier.
- Ordinary query observation uses admitted local evaluation without a variant
  API and returns `unknown` when proof or facts are incomplete.
- The server/Swift evaluator conformance corpus is byte- and
  completeness-identical for every claimed query profile.
