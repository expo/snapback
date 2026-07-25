# LLP 0077 sender-constrained browser auth — hardening program (index)

**Status:** Open
**Severity:** P1
**Systems:** Auth, Browser client, HTTP, WebSocket, Hosted runtime, Control plane, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 (authority for every ticket below; the 13-item defect ledger and open-questions are the single source of truth), LLP 0057/0058/0059/0060 (amended/composed), llp/reviews/0077-sender-constrained-browser-auth.{fable,codex}.md
**Marker:** program-index, llp-0077, sender-auth, super-refine-residue

**Progress (2026-07-24):** the full 0077 implementation — stranded as
uncommitted work on a ~130-commit-stale base in the primary checkout — was
re-landed on main (adapted to the landed LLP 0076 surface) with a defect-fix
pass. Ledger defects 1–8 and 11–13 are fixed with negative tests; the
per-item witnesses live in LLP 0077's annotated ledger. Closed tickets:
nonce-integrity, grace-lookup, replay-retention, issuance-binding,
client-nonce-serialization, structural-exclusion, admission-order. Later the
same day grant-binding and sender-replay-epoch closed too: defects 2 and 10
are fully fixed (decision-1 floor via `HostedAdmission.senderReplayEpochFloor`
with straddle witnesses; decision-6 issuance-epoch grant member with a
served invalidation test). Defect 9 also closed
the same day (the decision-2 bounded revoked-family tombstone: terminal
durableDelete at the sender gate, proof-id consumption without nonce
rotation, anti-oracle preserved, and client custody deletion — Rust unit,
served, and client witnesses), and the decision-5 WebSocket in-band
successor-nonce release landed as the final commissioned item: the first
server frame on a sender-proof-gated upgrade carries the successor
(`sender_nonce` frame, equal to the unreadable 101 header value), the
client's per-custody flight releases on that frame after committing it into
custody, and the bounded-challenge resync is retained as the decision's
failure-path semantics for open-without-frame timeout, error, cancel, and
reconnect (an open-without-frame stall releases the flight without killing
a healthy socket). All thirteen ledger rows and every commissioned decision
are implemented; this index stays open solely for the capability gate — no
positive claim exists without the full matrix plus the LLP 0072 hosted-auth
drill against a served origin. No ticket permits a
positive capability claim until the whole matrix plus the LLP 0072
hosted-auth drill receipt passes against a served origin.

Update 2026-07-25: the first served-origin drill (the LLP 0075 Fly.io
`single-instance-container-vm.v1` target) produced the hosted-auth
REFUSAL witness, not a pass —
`demos/competitive-checkpoint/acceptance/results/hosted-auth-refusal.v0.json`
records `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` (exit 1, on-machine) and
why the sender-auth matrix cannot honestly run there (sessions refuse
`SNAPBACK_AUTH_TRANSPORT_INSECURE` on a plaintext non-loopback bind, no
override, by design; the drill runs dev auth). The capability gate stays
open, exactly as this index requires: no `hostedAuthCapable` claim exists.

Update 2026-07-25 (hosted-edge adapter): the gate's first blocker is
resolved in code. LLP 0098 pins the
`loopback-terminated-single-instance.v1` adapter and lands its verification
core, so `--auth-deployment hosted` now **admits** against a signed,
deployment-bound attestation instead of refusing unconditionally. Witnessed
end to end on a real server process: hosted serves on a loopback bind and
publishes the attested five-positive tuple through `/inspect`, while a
non-loopback bind refuses `SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID`, a tampered
envelope refuses `SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED`, a replayed
older epoch refuses `SNAPBACK_AUTH_HOSTED_ADMISSION_ROLLED_BACK` across a
restart, and a local target still publishes the all-negative tuple. No fence
was weakened: the D1 sessions plaintext refusal is untouched, and the hosted
profile requires loopback rather than exempting itself.

Served-origin run (2026-07-25): the adapter was deployed to the Fly target in
the real topology and hosted admission **passed** on
`https://snapback-drill.fly.dev` — receipt
`demos/competitive-checkpoint/acceptance/results/hosted-edge-admission.v0.json`.
The run surfaced two defects that now gate the claim independently of this
program: `/_snapback/*` answers 503 rather than the fixed 404 the attested
`operatorSurface: "disabled"` requires, and plaintext redirects rather than
refusing credential-bearing paths — both attested-but-unenforced facts (LLP
0098 §8.1). The 0077 matrix itself did **not** run there: the deployment's
active auth mode is `dev`, and sessions needs a `--startup-artifacts` carrier
plus a two-boot staging transition the deployment does not yet stage.

**New ledger defect (2026-07-25, D-1): sender admission is skipped for an
absent carrier, so an unauthenticated caller reaches the JSON parser.** On a
sender-constrained route, `POST /query/listNotes` with no `Authorization`, no
`DPoP`, and a malformed body answers `400 SNAPBACK_REQUEST_JSON_INVALID`; the
same request with a well-formed body answers `401 SNAPBACK_AUTH_REQUIRED`.
When the bearer is `Absent` and `credential_resolution !=
RequiredSessionBearer`, `admit_hosted_sender_request` returns `Ok(None)` and
admission is skipped entirely, so the refusal comes from the function-authority
gate *after* body parse. This contradicts §HTTP binding ("an unproven sender
must never cause body ingestion") and §Nonce protocol (the absent-carrier
refusal is "enforced at the route middleware before sender admission is
reached"). Bounded by the body limit, so it is an ordering/attack-surface
defect, not an unbounded one. Found by the served-origin matrix; left
deliberately RED in the instrument rather than worked around, and not fixed in
the adapter lane because the admission ordering deserves its own change.

This does **not** close the capability gate. `hostedAuthCapable` still
requires the LLP 0077 matrix and the LLP 0072 hosted-auth drill to pass
against a **real served public origin** under that attestation, which needs
the in-container TLS terminator the profile requires. Until then the honest
status is: the adapter exists and its refusals are proven; the served-origin
matrix has not run.

Umbrella index for the work surfaced by the 9-round /llp-super-refine on LLP
0077 (Fable READY at round 9; Codex NOT READY throughout — the spec is
internally sound and honest, but its 13-item ledger records real code defects
that gate every positive capability). LLP 0077 stays **Draft**; none of the
tickets below is a shipped capability, and the ledger in the Spec remains
authoritative — each ticket **references** its ledger item rather than copying
it, and closing a ticket means updating the Spec's ledger/checkpoint, not just
landing code.

Two prerequisites gate everything else and are author decisions, not code
(both RESOLVED 2026-07-23 — LLP 0077 §Author decisions; the ratchet ticket is
Resolved, the client-contract ticket is Resolved including the landed
AuthCustodyV3 closed schema and the LLP 0059 BoundGrantAuthorityV2 amendment,
and defects 2 and 10 are unblocked):

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
