# 0093 P-0: implement the wire-version negotiation server changes (LLP 0094 §0B)

**Status:** Resolved code-wise 2026-07-27 (B1–B3 on both arms + kit);
awaiting only the shared-deployment redeploy noted below — integrator
decides on closing
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

---

**Resolution (2026-07-27, branch `agent/0094-wirever-20260726`):** B1, B2,
and B3 — this ticket's whole scope, including the 2026-07-25 amendment —
are implemented and verified on both arms in one landing.

- **B1 local** (`src/server.rs` + `src/wire_version.rs`): the closed
  `OpenConnectionRequest` admits `wireVersion` (alias `wire_version`);
  known binds the grant lineage and every open/re-open response of an
  explicitly bound lineage carries the additive `ConnectionGrant`
  `wireVersion` echo; unknown refuses `SNAPBACK_WIRE_VERSION_UNSUPPORTED`
  (400); absent opens a legacy (implicitly v1) lineage with no echo.
  Re-open immutability: a changed known offer under `previousToken`
  refuses `SNAPBACK_WIRE_VERSION_MISMATCH` leaving the grant undisturbed;
  an unknown candidate on re-open refuses `UNSUPPORTED`
  (classification-before-equality, proven by fixture); a confirming v1
  offer on a legacy lineage stays legacy (no echo, no upgrade). The pure
  classification predicate lives in `src/wire_version.rs`
  (handshake.rs-style), including the hypothetical multi-token
  `KnownMismatch` rows only a second supported token can reach.
- **B1 hosted** (`cloudflare/src/coordinator.js`): `kitOpenConnection`
  reads the member (camelCase + snake alias; conflicting duplicates
  refuse `UNSUPPORTED`), persists the binding in a new
  `_snapback_connections.wire_version` column (additive `ensureColumn`
  migration), applies the same matrix on the `previousToken` re-open
  branch, and echoes on explicitly bound lineages.
- **§0C.5 alignment, both arms:** unknown `authInvalidationProtocol`
  refuses `SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED`; absent still
  degrades to legacy (hosted reads the member for exactly this refusal
  while implementing no invalidation surface).
- **§0B.4 socket refusals, both arms** (`stream_live` /
  `acceptKitSocket`, pre-upgrade HTTP refusals after the credential
  gates): bound-version-present accepts and echoes; known-unequal
  refuses `MISMATCH`; unknown candidates refuse `UNSUPPORTED`; absent
  refuses `SNAPBACK_WIRE_VERSION_REQUIRED` (**B3 enabled**). The hosted
  `/live/stream` proof socket is exempt, untouched, and pinned
  offerless-admitted by fixture.
- **B2 kit** (`packages/snapback-client/index.mjs`): offers
  `wireVersion: "snapback.v1"` at open, threads the echo onto the grant
  (`grant.wireVersion`), and implements the §0B.6 pinned fallback —
  trigger exactly `SNAPBACK_REQUEST_JSON_INVALID`, one offerless
  differential re-open per endpoint, process-lifetime verdict cache,
  structured `SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADED` diagnostic
  (recorded on `wireVersionDiagnostics` + `onWireVersionDiagnostic`
  sink / console.warn — never silent), optional `strictWireVersion`
  refusing with `SNAPBACK_CLIENT_WIRE_VERSION_STRICT`, and no verdict on
  a failed differential. `SNAPBACK_WIRE_VERSION_UNSUPPORTED` never
  triggers the fallback (fixture).
- **§0B.7 re-run at B3 enablement:** recorded in LLP 0094 §0B.7, with a
  correction — the prior record's "Rust in-crate socket tests are
  compliant" claim was wrong (ten offerless upgrade constructions, plus
  ten offerless hosted-suite kit upgrades); all brought compliant in the
  same landing.
- **Schemas:** regenerated (`snapback-schemagen`):
  `connection.open.input.schema.json` gains `wireVersion`,
  `connection.grant.schema.json` gains the echo member; todo-v2
  remote-service codegen re-run (wire-schema digests + inputsHash);
  Cloudflare deployment identities regenerated.
- **Acceptance evidence:** `cargo test --lib wire_version` 9/9 (pure
  predicates + registry/HTTP/socket matrices);
  `artifact_schemas_v0` 23/23, `admin_v0` 42/42, `route_policy_v1`
  21/21, `concurrency_v0` 8/8; new hosted suite
  `cloudflare/test/acceptance.wire-version.mjs` 23/23 checks, registered
  in the local-suite manifest (now 23 suites); full
  `node cloudflare/test/local-suite.mjs` green; `@snapback/client`
  package suite incl. new `wire-version.test.mjs` green;
  `node demos/_kit/tests/live-wire-schema.mjs` green;
  `./ref-check --verbose` 0 errors.

**Remaining, deliberately outside this ticket's landing:** the shared
Cloudflare deployment redeploy carrying B1 (the operational step that
turns the hosted echo on there). Until then the kit's offer against that
deployment is silently ignored by the pre-B1 open decoder — byte-identical
to an offerless open, so non-breaking (LLP 0094 §0B.6 hosted caveat);
this is the recorded reading of B2's deployment gate. **B4 is not
implemented** and stays gated on the §0B.7 zero-offerless audit plus its
own dated LLP 0094 amendment.

Code-wise this ticket is fully resolved. Left in `issues/` for the
integrator to close after the redeploy decision.
