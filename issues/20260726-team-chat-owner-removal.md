# Team Chat needs an owner-authorized member-removal surface

**Status:** Open
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
