# 0093 P-0: implement the wire-version negotiation server changes (LLP 0094 §0B)

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “0093 P-0: implement the wire-version negotiation server changes (LLP 0094 §0B)” shows the issue reaches a security, correctness, release, or core product boundary; the defect is blocking or unsafe on a live path now, while the fix requires a few coordinated implementation and test surfaces, with a direct reproduction or current implementation proof.

**Opened:** 2026-07-25
**Systems:** Wire Protocol, Server, Cloudflare arm, Client SDK
**Spec:** LLP 0094 §0B (contract), §0C.5 (adjacent-field alignment),
§0E (refusal codes)

LLP 0094 pins the negotiation contract; the server/kit changes are staged
and none are implemented yet. This ticket owns stages B1–B3 (B4 requires
its own dated amendment to LLP 0094 when its audit gate is met):

- **B1 — field-admitting servers, both arms.** Local: add the optional
  `wireVersion` member (alias `wire_version`) to the closed
  `OpenConnectionRequest` (`src/server.rs`), implementing the offer
  matrix — known (`"snapback.v1"`) binds, unknown refuses
  `SNAPBACK_WIRE_VERSION_UNSUPPORTED` (400), absent opens a legacy
  (implicitly v1-bound) connection. Hosted: `kitOpenConnection`
  (`cloudflare/src/coordinator.js`) must *read* the field and implement
  the same matrix (its open decoder silently ignores it today — the
  silent-feature-off hazard of LLP 0094 §0C.3). B1 also ships the §0C.5
  alignment: unknown `authInvalidationProtocol` values refuse
  (`SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED`) instead of
  silently degrading (`src/server.rs` open-connection handler,
  exact-match branch); absent keeps degrading to legacy.
- **B2 — kit offer.** `packages/snapback-client/index.mjs` sends
  `wireVersion: "snapback.v1"` at open. Gate: B1 deployed on every
  targeted arm (the shared Cloudflare deployment needs the post-B1
  redeploy first). Implement the §0B.6 legacy-server detection fallback
  (decode-class rejection → one offerless re-open per endpoint, cached,
  surfaced as a structured diagnostic; optional strict mode).
- **B3 — socket-offer refusal, both arms.** Kit stream upgrades offering
  no known wire-version token refuse `SNAPBACK_WIRE_VERSION_REQUIRED`;
  a socket offer unequal to the bound version refuses
  `SNAPBACK_WIRE_VERSION_MISMATCH`. Local `stream_live`
  (`src/server.rs`, `.protocols([LIVE_STREAM_SUBPROTOCOL])` today) and
  hosted `acceptKitSocket` (`cloudflare/src/coordinator.js`, echo-only
  today) change together. Scope excludes the hosted `/live/stream`
  proof socket (LLP 0094 §0B.4 exemption). Re-run and record the
  §0B.7 blast-radius enumeration at enablement.

Acceptance: offer-matrix fixtures on both arms (known/unknown/absent ×
open/socket), refusal-style tests mirroring `src/auth/handshake.rs`,
schema regen for the new `connection.open.input` member, and the JS gate
staying green.

**Amended 2026-07-25 (LLP 0094 v0.2, review round 1):** B1 additionally
ships (a) the `wireVersion` **response echo** as an additive
`ConnectionGrant` member (§0B.3 — the hosted arm's only runtime version
witness), (b) the **present-offer socket refusals**
(`MISMATCH`/`UNSUPPORTED` per the §0B.4 classification matrix; B3 keeps
only the absent-class `REQUIRED` refusal), and (c) **re-open binding
immutability**: a changed offer under `previousToken` refuses
`SNAPBACK_WIRE_VERSION_MISMATCH`; absent on re-open leaves the binding
untouched. Fixtures extend accordingly (changed-offer re-open, unknown
socket token, duplicate tokens, multi-token offer sets, echo presence).
