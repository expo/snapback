# Team Chat needs an owner-authorized member-removal surface

**Status:** Closed
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Team Chat needs an owner-authorized member-removal surface” shows the issue reaches a security, correctness, release, or core product boundary; the defect is blocking or unsafe on a live path now, while the fix requires a few coordinated implementation and test surfaces, with a direct reproduction or current implementation proof.
**Severity:** P1
**Systems:** Team Chat, Memberships, Authorization invalidation, Codegen
**Date:** 2026-07-26
**Governing:** LLP 0056, LLP 0053, LLP 0063 Step 6
**Proposed authority:** LLP 0100 (Draft)

The `team-chat/local-pressure-v0` checkpoint can invite, self-accept,
self-leave, and rejoin through the declared `roomMembers` membership. It
cannot implement the Slack/Discord owner action “remove this member.”

The private roster correctly exposes no application-readable membership row
id. Current id-addressed `ctx.membership.*.remove(...)` therefore is not an
application authoring path, and treating the displayable
`roomParticipants` row as authority would violate LLP 0056.

## Proposed decision

LLP 0100 proposes an explicit `principalAddressedWrites.remove` declaration
and generated `removePrincipal(resource, targetPrincipal)` command. It admits
only a total `target: "other"` remove transition, resolves the target row
inside the host, returns the same `null` for present and absent targets, and
keeps the transition matrix, provenance, `lastHolder`, delegated consent, and
LLP 0053 invalidation as the sole governing mechanisms.

The proposal remains Draft. This issue stays open until the RFC is independently
reviewed, ratified, implemented, and exercised by the Team Chat product
receipts.

**Progress 2026-07-30:** Major 1 decided by Charlie Cheever (in-session):
option (a) — the non-disclosure claim is scoped to the byte-level result
and the authorization-version observable is an accepted disclosure to
authorized callers. The v0.2 revision applies that decision plus all four
Minors and the review's suggestions (LLP 0100 Revised header records the
item-by-item mapping). The remaining gate is ratification under the stated
boundary — LLP 0056 accepted first, or the composed-slice maintainer
ruling — then implementation and the product receipts.

**Progress 2026-07-27:** first independent cross-family review round done —
`llp/reviews/0100-membership-addressed-operations-and-pages.fable.md`
(Claude family; the draft is Codex-authored). Verdict: revise and stay
Draft — one Major (the authorization-version advance distinguishes
present-target removal from the absent-target no-op, an existence observable
the §1 claim does not scope; resolution is an author decision, not a
redesign) plus four Minors. The gate is now the author's Major-1 decision,
the Minor amendments, and ratification (LLP 0056 first, or the composed-slice
ruling), then implementation.

## Acceptance

- an owner removes an active member without obtaining a private roster id;
- a non-owner, cross-room owner, delegated principal without consent, absent
  member, and malformed target all fail with the intended non-disclosing
  outcome;
- removal and full-provenance append commit atomically;
- active protected queries and rooms blank/quarantine before newly forbidden
  delivery can become visible;
- queued and retained state cannot replay after the membership epoch changes;
- last-holder and bootstrap invariants remain unchanged; and
- the Team Chat pressure app exercises owner removal through a complete UI and
  executable target receipt.

**Progress 2026-08-01 (fix-wave Lane β).** The 0137 A2 arm independently
re-found this gap (`issues/20260801-0137-a2-no-admin-revocation-of-another-member.md`)
and proposed the same smallest fix. Triage confirmed the two tickets are one
item and both remain gated on LLP 0100's ratification. An implementation of
the *naive* shape was built and reverted during triage because it violated
two of 0100's decided properties — the opt-in `principalAddressedWrites`
declaration (implicit availability would widen every existing app's write
surface) and present/absent indistinguishability (the obvious host-side
resolution makes the private roster enumerable by probing). Both tickets now
cross-reference; neither should be picked up independently of 0100.

---

**NARROWED 2026-08-01 (LLP 0100 Accepted; M1 core operations LANDED).**
The semantic gap this ticket names is closed: LLP 0100 was Accepted by the
explicit composed-parent ruling (ballot item 2), and the M1 lane landed
`principalAddressedWrites` + generated
`ctx.membership.<decl>.removePrincipal(resource, principal)` end to end —
codegen option validation and typed emission (rbac-authoring.test.mjs),
schema-activation carrier contract (total transition, pending/lastHolder
rules), the host command with the RFC's exact refusal ordering and
present/absent `null` indistinguishability, captured absence with
commit-time invalidation, the expired-but-authorized lastHolder edge, and
the `_snapback.myMemberships` seat-drop receipt at the cut. Acceptance
items 1–6 of this ticket's list are covered by
src/storage.rs `remove_principal_*` tests,
tests/membership_principal_addressed_v0.rs, and
src/local.rs `remove_principal_drops_the_seat_from_my_memberships_at_the_cut`;
the sibling A2 ticket is closed on this evidence.

**Remaining (this ticket stays open, narrowed to product adoption):** the
final acceptance item only — `team-chat/local-pressure-v0` adopts
`principalAddressedWrites.remove` on `roomMembers`, exercises owner
removal through the complete UI, and lands the headless/React/Contract
product receipts (LLP 0100 §Team Chat adoption, implementation-order
step 6). The M2 pages lane and the composed family witness join there.

## Resolution — 2026-08-01

Team Chat now opts `roomMembers` into principal-addressed removal and exposes
the action in both complete product UIs. The headless, React, and Contract
receipts prove active and absent removal, immediate protected-room and
`_snapback.myMemberships` seat loss, history custody loss, stale-cursor
refusal, send denial, no later delivery, and invite/accept/leave regressions.
The pressure row is `implemented-local`; hosted completeness remains outside
this ticket.
