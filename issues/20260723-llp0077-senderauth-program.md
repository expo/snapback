# LLP 0077 sender-constrained browser auth — hardening program (index)

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 1
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “LLP 0077 sender-constrained browser auth — hardening program (index)” shows the issue reaches a security, correctness, release, or core product boundary; the defect is blocking or unsafe on a live path now, while delivery is a dependency-heavy, multi-stage program, with a direct reproduction or current implementation proof.
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

**Update 2026-07-27 (headline): the served-origin LLP 0077 matrix RAN for the
first time and found a new served-origin defect, D-2, now fixed.** A bound-key
re-exchange answered `500 INTERNAL_AUTH_STATE` on client-controllable input;
the one-live-family-per-thumbprint rule is now normative in LLP 0077 §Issuance
and enforced in the exchange transaction with Rust + wire witnesses. Decision
4's versioned `sbs2_`/`sct2_` prefixes were confirmed reserved-unissued and
annotated as such (`issues/closed/20260725-sender-constrained-classes-unwired.md`
resolved; v2 minting is follow-on `issues/20260727-llp0077-v2-prefix-minting.md`).
Full detail in the "served-origin matrix ran" section below; the exact
remaining distance to `hostedAuthCapable` is restated there.

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

**D-1 root cause established 2026-07-25 — it is NOT a reorder.** The obvious
reading ("move the absent-carrier refusal ahead of the body poll") is wrong, and
the code says why. The bailout is:

```rust
PresentedSessionBearer::Absent
    if effective.credential_resolution != CredentialResolution::RequiredSessionBearer =>
        { /* charge on /connection/open */ return Ok(None); }
```

`admit_hosted_sender_request` already refuses an absent carrier with 401
`SNAPBACK_AUTH_REQUIRED` *before* any body poll — but only on routes whose
**route-level** policy is `RequiredSessionBearer`. `/query/listNotes` is not
one: it is generated owner CRUD whose authentication requirement lives in the
**function** (`authUserId`), not in the route policy. So at middleware time the
origin genuinely does not know a credential was required, defers, and the body
is parsed before the function's own authority check refuses.

Deleting the guard is not available: it is exactly what admits legitimate
anonymous traffic, and `hosted_anonymous_connection_open_consumes_shared_source_admission`
passes *because* of it. Verified — that test still passes on the current tree.

The real fix is to hoist the function-level authentication requirement into
route policy so the middleware can see it (derive per-function credential
resolution from the function manifest at publication time, so a function
requiring `authUserId` yields a `RequiredSessionBearer` route). That is a design
change across the codegen/route-policy seam and deserves its own reviewed
change; it is not a safe in-place reorder, and it was deliberately NOT attempted
as a rushed edit inside the adapter lane.

**D-1 FIXED 2026-07-25 (the route-policy hoist above, landed).** The hosted
middleware now derives the invocation route's credential requirement from the
published function manifest before the absent-carrier bailout: on
`/query/{name}`, `/query/{name}/authorized-lease`, `/mutation/{name}`, and
`/action/{name}`, an absent Authorization refuses `SNAPBACK_AUTH_REQUIRED`
before any body poll unless the named function is statically declared `public`
or `optional-user` in the post-commit manifest snapshot the write lane
publishes (`ReadLane::published_function_auth_requirement`, consumed by
`admit_hosted_sender_request`). Two deliberate narrowings, both survey-backed:
the signal is the closed `authRequirement` — NOT `authUserId` use, which
optional-user functions (todo, graffiti, partiful-matrix) read legitimately and
which would have broken their anonymous access; and the ambiguous case fails
closed — an unknown function name, which no caller can ever invoke
successfully, refuses identically to an `authenticated` one, so the pre-body
refusal is not a function-existence oracle. Path canonicalization already
rejects `%`-encoding/backslash/doubled-slash/dot segments ahead of the
decision, closing the encoded-name bypass. The `/connection/open` special
cases and the anonymous-route bailout are untouched:
`hosted_anonymous_connection_open_consumes_shared_source_admission` still
passes, and the new witness set (`hosted_absent_carrier_*`,
`hosted_malformed_carrier_on_authenticated_function_challenges_before_body_poll`)
proves the panic-on-poll poisoned body is never polled on refusals while
`public`/`optional-user` functions keep admitting anonymous callers.

**Original report (2026-07-25, D-1): sender admission is skipped for an
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

**Matrix executed 2026-07-25 (41/42, gate stays open on merit).** With
sessions staged under hosted admission, the full LLP 0077 matrix
(`hosted-sender-matrix.mjs`: issuance, protected requests, nonce protocol +
anti-oracle, replay, grant matrix over both carriers, WebSocket `sender_nonce`
release, ten refusal axes) ran against a hosted origin and scored **41/42**.
The single red is defect D-1 above, left deliberately failing. Receipt:
`demos/competitive-checkpoint/acceptance/results/hosted-sender-matrix.v0.json`.
The run was against a local hosted origin; the served-origin rerun is blocked
by the Let's Encrypt duplicate-certificate limit (no-volume cert loss on
redeploy, LLP 0098 §8.1/§8.3) and cannot change the verdict, because D-1 is a
real defect. `hostedAuthCapable` is NOT claimed. *(Superseded later the same
day: with D-1 fixed, the identical composition reruns at **42/42** — receipt
`hosted-sender-matrix.v0.rerun-20260725.json`; the gate now waits only on the
served-origin rerun.)*

### The served-origin matrix ran 2026-07-27 — and found D-2 (now fixed)

The Let's Encrypt window cleared (retry-after 2026-07-27 ~01:06 UTC); the D4
volume (`vol_r6815pkd59o1x614`) retained the certificate across the machine
wake, and the D-1-fixed binary was redeployed to `snapback-drill.fly.dev`. The
LLP 0077 matrix ran for the **first time against the real served public
origin**, in the new `served-terminator` composition (the deployed Caddy is the
trusted terminator, replacing `X-Forwarded-For`; effective-source rows assert
composed spoof-immunity; the origin-confusion probe binds to the loopback
upstream). Login codes were recovered over `fly ssh console -C` from the durable
challenge digest + keyring (LLP 0057 capture-mailbox recovery), identical to the
local `operator-digest` source.

**The served run was not a rubber stamp of the local 42/42 — it surfaced D-2.**
On a served (any real) exchange sequence, a second `/auth/exchange` carrying a
valid issuance proof over an **already-bound** custody key (fresh challenge,
correct code) answered `500 INTERNAL_AUTH_STATE`: the issuance transaction hit
the sender-nonce table's `(admission_epoch, jwk_thumbprint)` primary key and
surfaced the constraint as a state-invariant failure, on client-controllable
input. This is the same defect class as the §8.2 effective-source finding — a
path exercised only by a real sequence, not by the per-check unit tests.

**D-2 FIXED 2026-07-27.** The one-live-family-per-thumbprint rule is now
normative in LLP 0077 §Issuance and enforced in the exchange transaction: it
pre-checks the live nonce cell and refuses with the folded
`SNAPBACK_AUTH_SENDER_PROOF_INVALID` **before** any session/identity/challenge/
nonce write, consuming only the proof's `jti` (the correct code is not charged
an attempt; the challenge stays live for a retry under a fresh key). The
pre-check and the family install serialize on the same immediate write
transaction, so a concurrent same-key exchange is refused deterministically
rather than racing the primary key. An expired incumbent nonce cell does not
count. Witnesses: Rust
`planned_issuance_refuses_a_second_family_for_a_live_thumbprint` (asserts the
coded outcome, that only the proof id is consumed and the incumbent family is
untouched, and that the same thumbprint re-issues once the nonce lifetime
elapses) and wire check `issuance/a-second-exchange-with-a-bound-key-refuses-coded`.
The full matrix (now 43 checks) scores **43/43** against the local hosted
origin in `instrument-terminator` composition. The served run's receipt is
`demos/competitive-checkpoint/acceptance/results/hosted-sender-matrix.v0.served-20260727.json`.

### Exact remaining distance to `hostedAuthCapable` (2026-07-27)

The defect count is zero again after D-2, and the matrix has now run against a
real served origin. What the capability claim still needs, and this index still
does **not** claim `hostedAuthCapable`:

1. ~~**A clean served-origin 43/43 on the D-2-fixed binary.**~~ **Reached
   2026-07-27.** The served run that *found* D-2 ran on the pre-fix binary;
   after the fix landed the origin was redeployed (image
   `deployment-01KYH0R5TN`, fresh chain), and the served matrix scored
   **43/43** against `https://snapback-drill.fly.dev` in `served-terminator`
   composition with operator-DB bucket observation over `fly ssh` — receipt
   `demos/competitive-checkpoint/acceptance/results/hosted-sender-matrix.v0.served-20260727.json`
   (`ok: true`, `passed: 43`). Adapting the served composition surfaced and
   fixed two *instrument* correctness bugs (not origin defects): the
   connect-origin refusal axis and the issuance origin-confusion probe both had
   to bind their wrong-origin htu to the loopback upstream, because on a served
   run the connect origin IS the attested publicOrigin — otherwise a "wrong
   origin" proof is valid, passes admission, and rotates the live nonce. The
   serving window has since expired (expected withdrawal; no renewal loop yet,
   LLP 0098 OQ1), which does not affect the captured green receipt.
2. **The LLP 0072 hosted-auth drill legs that need public HTTPS.** The
   `snapback.hosted-auth-drill-receipt.v1` production path
   (`packages/snapback-cli/deployment-control.mjs`) additionally requires a
   registered `trusted-single-tenant-app-complete.v1` target with a
   content-addressed `remoteProviderAttestation`; codegen does not emit that
   target profile today (LLP 0072 §Implemented target and plan slice), so the
   drill receipt cannot be minted from the drill target as it stands. That is
   the next tranche, tracked in the LLP 0072 program, not this index.

Everything else the gate named is in place: the adapter attests and verifies,
sessions runs under hosted admission, renewal composes with withdrawal, the
operator surface is enforced, effective source is enforced, and the sender
matrix passes end to end against a served origin. **No one should claim
`hostedAuthCapable` until item 2 lands and the served 43/43 is confirmed on the
fixed binary**, and this program index does not claim it.

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
