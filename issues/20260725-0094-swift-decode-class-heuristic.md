# Swift client: decode-class detection is over-broad against LLP 0094 §0B.6's pin

**Opened:** 2026-07-25 (LLP 0094 review round 1, Fable concern 3)
**Systems:** Client SDK (Swift), Wire Protocol

LLP 0094 §0B.6 (v0.2) pins legacy-server detection to the exact signal:
`SNAPBACK_REQUEST_JSON_INVALID` (HTTP 400) plus the
disappears-when-the-offer-member-is-removed differential, with an
explicit MUST-NOT list (`SNAPBACK_WIRE_VERSION_UNSUPPORTED`, unrelated
open-time 400s such as the hosted `SNAPBACK_CONNECTION_ID_INVALID`).

The P-2 Swift client currently treats *any* HTTP 400/422 except
`SNAPBACK_WIRE_VERSION_UNSUPPORTED` as decode-class
(`clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift`,
the `decodeClass` guard around lines 108–110 at `137dee8c`), so an
unrelated open-time 400 triggers a spurious offerless re-open.

Fix: key the detection on `diagnostic.code == "SNAPBACK_REQUEST_JSON_INVALID"`
(plus the existing differential re-open), keep the once-per-endpoint
cache and the structured downgrade diagnostic, and add a regression
against the fixture corpus once P-1 ships a negative fixture for a
non-decode open-time 400.
