# LLP 0077 sender-constrained browser auth — hardening program (index)

**Status:** Open
**Severity:** P1
**Systems:** Auth, Browser client, HTTP, WebSocket, Hosted runtime, Control plane, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 (authority for every ticket below; the 13-item defect ledger and open-questions are the single source of truth), LLP 0057/0058/0059/0060 (amended/composed), llp/reviews/0077-sender-constrained-browser-auth.{fable,codex}.md
**Marker:** program-index, llp-0077, sender-auth, super-refine-residue

Umbrella index for the work surfaced by the 9-round /llp-super-refine on LLP
0077 (Fable READY at round 9; Codex NOT READY throughout — the spec is
internally sound and honest, but its 13-item ledger records real code defects
that gate every positive capability). LLP 0077 stays **Draft**; none of the
tickets below is a shipped capability, and the ledger in the Spec remains
authoritative — each ticket **references** its ledger item rather than copying
it, and closing a ticket means updating the Spec's ledger/checkpoint, not just
landing code.

Two prerequisites gate everything else and are author decisions, not code:

- `20260723-llp0077-rollback-ratchet.md` — the non-rollbackable ratchet source
  for raw-backup-rollback non-resurrection (a stated security requirement with
  no pinned mechanism; load-bearing).
- `20260723-llp0077-client-contract.md` — close `AuthCustodyV3`,
  `BoundGrantAuthorityV2` (+ the LLP 0059 amendment), the final logout-recovery
  mechanism, the cover-nonce choice, the downgrade defense, and the WebSocket
  successor-nonce state machine. Until these close, a second *client* is not
  buildable and several defect tickets below cannot fully land.

Implementation-defect tickets (each: fix + a negative test; each closes one or
two ledger items):

- `20260723-llp0077-nonce-integrity.md` — defects 1, 13
- `20260723-llp0077-grant-binding.md` — defect 2 (depends on the grant shape in
  the client-contract decision)
- `20260723-llp0077-grace-lookup.md` — defect 3
- `20260723-llp0077-replay-retention.md` — defect 4
- `20260723-llp0077-client-nonce-serialization.md` — defects 5, 7 (coupled;
  neither may be marked done alone)
- `20260723-llp0077-issuance-binding.md` — defects 6, 11 (jti half)
- `20260723-llp0077-structural-exclusion.md` — defect 8
- `20260723-llp0077-sender-replay-epoch.md` — defect 10 (depends on the ratchet
  decision above)
- `20260723-llp0077-admission-order.md` — defect 12, and defect 11 (client-URI
  half)

Sequencing notes: the two decisions land first (they change the contract the
defects implement); defect 10 depends on the ratchet decision; the grant-binding
defect depends on the `BoundGrantAuthorityV2` shape; defects 5↔7 are a single
work item split across two ledger rows. No ticket permits a positive
`hostedAuthCapable`/sender-constraint capability claim until the whole matrix
plus the LLP 0072 hosted-auth drill receipt passes against a served origin.
