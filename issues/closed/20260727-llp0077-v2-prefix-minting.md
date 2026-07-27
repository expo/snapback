# LLP 0077 decision 4, first layer: mint the versioned `sbs2_`/`sct2_` spellings

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “LLP 0077 decision 4, first layer: mint the versioned `sbs2_`/`sct2_` spellings” shows the issue reaches a security, correctness, release, or core product boundary; the defect is blocking or unsafe on a live path now, while the implementation is localized and has concrete acceptance witnesses, with a direct reproduction or current implementation proof.
**Severity:** P2
**Systems:** Auth, Browser client, WebSocket
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-27
**Related:** LLP 0077 §Author decisions (decision 4), LLP 0060 D6;
`issues/closed/20260725-sender-constrained-classes-unwired.md`;
`src/auth/crypto.rs` (`SenderSession`, `SenderConnectionToken`,
`parse_any_version`)
**Marker:** auth, llp-0077, downgrade-defense

LLP 0077 decision 4 commissions a two-layer downgrade defense, and only one
layer exists. The commissioned first layer: "v2 sender-bound session/grant
tokens and carriers adopt a structurally distinct, legacy-rejecting syntax
(versioned prefix; v2 verifiers require it, v1 verifiers cannot accept it)."
Today the production exchange mints sender-bound sessions with the v1 `sbs_`
spelling (witnessed live on the drill origin, 2026-07-27), and sender-bound
grants ride `sct_` connection tokens. The sender constraint itself is not at
risk — it is enforced through the durable family binding, and a sender-bound
session presented as a bare bearer refuses on every carrier (the 43-check
matrix pins this). What is missing is the *structural rollback defense*: a
pre-sender v1 **server** presented an `sbs_` sender-bound token cannot know
about the binding table and would honor it as a plain bearer. Only the
versioned prefix closes that, which is why decision 4 rejects sole reliance
on LLP 0060 D6.

Scope of the fix (one reviewed change, not a drive-by):

- The v2 exchange mints `sbs2_` (promote `SessionBearer::generate_sender_v2`
  out of `#[cfg(test)]`), and refresh/rotation successors of a sender-bound
  family stay `sbs2_` ("every successor remains bound to the same
  thumbprint").
- Sender-bound connection-open mints `sct2_` grants; the grant verifier
  requires the v2 spelling on sender-bound lanes.
- Sender-proof verification refuses the `sbs_` spelling for sender-bound
  families once minting is v2 (the "v2 verifiers require it" half), with the
  migration story for live pre-change sessions stated (deletion-and-
  re-exchange, LLP 0077's existing rule).
- The browser client treats tokens opaquely and needs no change beyond
  fixture updates; the matrix gains prefix assertions on issuance and
  connection-open.
- The v1-family activation/rollback matrix documented alongside (decision 4
  requires it).

Until this lands, the annotations in `src/auth/crypto.rs` record the classes
as reserved-unissued, and LLP 0077's decision-4 checkpoint carries the same
caveat.

## Resolved 2026-07-27

All five scope items landed as one reviewed change:

- **Minting:** `SessionBearer::generate_sender_v2` is production
  (`#[cfg(test)]` removed); `bind_sender_issuance` re-mints the issuance
  candidate as `sbs2_` before premark/commit, so the projected digest, the
  durable row, and the returned credential all carry the versioned spelling.
- **Successors:** both refresh paths (`plan_refresh` and direct `refresh`)
  select the successor spelling from the durable family binding
  (`presented_token_has_sender_family_binding`, callable on any profile —
  reports unbound when the sender preflight never ran), so sender-bound
  families stay `sbs2_` across rotation.
- **Grants:** sender-bound connection-open and grant rotation mint `sct2_`;
  the sender grant lane structurally refuses a non-`sct2_` token
  (`SNAPBACK_CONNECTION_TOKEN_INVALID`).
- **Verifier half:** `admit_sender_constrained_request` refuses a proof
  presented over the legacy `sbs_` spelling of a live bound family
  (`SNAPBACK_AUTH_SENDER_PROOF_INVALID`, nonce state untouched); the
  proofless path still answers a challenge so the decision-3 anti-oracle
  posture is preserved, and the revoked-family tombstone path deliberately
  keeps accepting the v1 spelling so stranded pre-change logout clients
  converge. Migration for live pre-change families is
  deletion-and-re-exchange (never attachment). Presented-bearer surfaces
  (`resolve_session`, logout, family alarm, connection-open, throttle
  family lookup, class gates) accept both spellings; the constraint rides
  the binding, not the parse.
- **Docs and matrix:** the v1-family activation/rollback matrix landed in
  LLP 0077 §Credential classes; `hosted-sender-matrix.mjs` asserts the
  `sbs2_`/`sct2_` prefixes at issuance and connection-open; the Rust router
  test asserts them on exchange, refresh, and open. The browser client
  needed no change (tokens are opaque to it), as predicted.

New/updated tests: `v1_spelling_over_a_live_bound_family_refuses_at_proof_time`
(sender_proof), prefix assertions in
`hosted_sender_issuance_session_and_refresh_compose_through_the_router`,
sender fixtures migrated to v2 minting where they model live bound families.
