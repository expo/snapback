# Improvement: first-party clients don't implement the lane that carries all the rows

**Status:** Resolved 2026-07-26 · **Kind:** improvement (roadmap) · **Filed:** 2026-07-26
**Evidence:** `demos/partitime/REPORT.md` §6, `demos/partitime/native/swiftui/NOTES.md`,
`clients/kotlin/NOTES.md`, `clients/dart/NOTES.md`

## What

Auth-scoped live queries deliver rows **only** inside `authorization_invalidation`
frames — never `live_replace`/`live_delta`. `clients/swift/SnapbackClient` had
**one line** for that kind. A client built faithfully from the docs renders one
correct snapshot and then goes silent forever, with no error.

This is not a spec defect (those are filed separately, e.g.
`20260726-0093-p4-authorization-invalidation-state-machine-gap`). This ticket is
the **implementation gap in the shipped clients**.

## Why it matters

Three independent implementers built clients during the Partitime matrix
(Swift extended, Kotlin and Dart clean-room). All three had to add the same
list. The SwiftUI author's timings, in blocking order:

| # | addition | cost |
| --- | --- | --- |
| 1 | `authorization_invalidation` dispatch | ~45 min |
| 2 | version guard on that lane | ~10 min |
| 3 | iOS platform in `Package.swift` | ~2 min |
| 4 | external-bearer auth + protocol offer headers | ~30 min |
| 5 | `authorizationNamespace` on subscribe | ~15 min |
| 6 | jittered retry for `SNAPBACK_AUTH_RESERVATION_STALE` | ~20 min |
| 7 | the acknowledge POST | ~20 min |

**Under three hours total**, and item 1 is most of the value. Their summary:
*"Snapback's docs are better than either competitor's and its client is worse
than both. CLIENT.md warned me about every trap I hit; none were implemented in
the first-party Swift client. That gap is a day's work, not an architecture
problem."*

## Proposed

1. Land items 1–7 in `clients/swift/SnapbackClient`. Working implementations of
   all of them now exist in `clients/kotlin` and `clients/dart` and can be
   ported rather than re-derived.
2. Decide whether `clients/kotlin` and `clients/dart` become supported artifacts
   or stay reference implementations. They currently pass the corpus (10/10 and
   17/17) plus live acceptance in both dev and sessions mode, and each has a
   first-consumer assessment from a real app (Compose, Flutter).
3. Add a conformance fixture that pairs a `live_replace` with a later
   `authorization_invalidation` for the same subscription, so a client that
   handles only the replace kinds **fails the corpus** instead of passing it.

Item 3 is the durable fix: today a client can pass every fixture and still
receive no data from a real server.

## Resolution

The maintained Swift client now implements the complete session-auth live
path: exact offers, body-auth omission, stable authorization namespaces,
version-guarded `authorization_invalidation` snapshots, quarantine-before-
apply, apply-before-ACK ordering, duplicate re-ACK, foreign-obligation refusal,
and bounded jittered retry only for HTTP 409
`SNAPBACK_AUTH_RESERVATION_STALE`. `Package.swift` now declares iOS 16 and
macOS 13.

The format-v2 conformance harness replays explicit subscription populations
and multi-step fixtures. It passes the regenerated corpus, including
replace-to-delta `_id` continuity and invalidation apply-then-ACK/redelivery.
Kotlin and Dart remain explicitly reference-only; they are not published or
claimed as maintained first-party artifacts.
