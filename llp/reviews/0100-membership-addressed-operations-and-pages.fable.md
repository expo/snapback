# Review: LLP 0100 — Membership-addressed operations and pages (Fable, round 1 of the author-directed super-refine loop)

**Reviewer family:** Fable (Claude)
**Provider / runtime:** claude-code session (Claude Fable 5)
**Date:** 2026-08-01
**Redacted:** No — full local repository access; `.agent-local-secrets.md` was
not read.
**Method:** Full round-1 review for the author-directed super-refine loop
Charlie authorized 2026-08-01. This session did not author LLP 0100 (the
draft names Charlie Cheever / Codex; it was drafted by a July session). A
prior informal cross-family fable review existed at this path (2026-07-27,
commit b63789c6); per the loop commission this round-1 artifact replaces it —
only its provenance header was read, to establish that fact, before this
fresh review (the prior body remains available in git history). No codex
artifact for this loop was read (mutual blindness). Verification-driven:
every load-bearing code and parent-doc claim below was checked against the
current tree (origin/main at `367e8c57`, post-0.1.8, post-fix-wave,
post-wave-1 acceptances), and the sweep tickets named by the commission were
read as the evidence bar.
**Target:** `llp/0100-membership-addressed-operations-and-pages.rfc.md` (v0.2, 542 lines)
**Target SHA-256:** `4ba87d1dad15c956b0311adec57befe517e83c03c445ba4a458cdda70228b43b` (verified byte-identical on the branch base used for this review)

## Overall assessment

The two surfaces this RFC designs are in strong shape. The v0.2 revision
genuinely absorbed the July round: the Major-1 disclosure boundary is now a
*decided, scoped, argued* claim rather than an implicit one (§1), the no-op
branch's commit semantics are exact (§3), and the acceptance section pins the
disclosure to a falsifiable observable. The disclosure calculus — refuse
before target lookup; totality so per-role refusal cannot leak hidden roles;
identical `null` both branches; epoch-advance asymmetry accepted as the one
authorized-caller observable, with the probe-spam amplifier named as the
reason not to advance on the no-op — is the best-reasoned part of the
document, and the fix-wave triage's build-and-revert of the naive shape
(`issues/20260801-0137-a2-no-admin-revocation-of-another-member.md`)
independently confirmed that both of its load-bearing contract decisions
(opt-in declaration; present/absent indistinguishability) are exactly the
ones a naive implementation gets wrong.

What keeps this round at NOT READY is not the quality of what is designed
but the coverage of what the commissioning evidence now demands. The 0137
sweep hit this RFC's territory three independent times, and two of the five
ticketed cases — membership-gated **search visibility** and membership
**seedability/reset** — are not answered, not even by an explicit scope-out.
A "deliberately narrow" scope was the right call on 2026-07-26; on
2026-08-01, with the sweep evidence in hand and triage routing tickets to
this RFC's ratification as the gate, narrowness has to be a *decision* the
document makes about the whole membership-composition family, not an
artifact of when it was written. Separately, the tree has moved under §1:
`_snapback.myMemberships` landed on main (2026-08-01, `67da515f`, with an
LLP 0056 dated amendment), so §1's status-quo enumeration is now stale.

## Verification record (claims checked against the current tree)

- `sbpc1` envelope exists (`src/rqs.rs:288`); the 1,024-byte wire max and
  30-day age verified (`RELATIONAL_CURSOR_MAX_WIRE_BYTES`,
  `RESUME_TOKEN_MAX_AGE_MS`, src/rqs.rs:36,58,61). Uniform refusal and
  mint-failure codes exist (`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` /
  `..._MINT_UNAVAILABLE`, src/local.rs). The cursor body carries exactly
  app/binding/boundary/issued-at (§5's "opaque body" claim ✓).
- Parent helper `defineOwnedKeysetPages` / `owned-keyset-pages.v1` exists
  (packages/snapback-codegen/standard-patterns.mjs:401,457).
- The existing binding digest (`standard_pattern_cursor_binding`,
  src/local.rs:21370–21415) covers app, helper/profile, table, index, order,
  limit, shared filter *shapes*, auth fingerprint, and the caller's per-user
  permission-scope epoch — and does **not** today bind normalized non-cursor
  argument values, the global `{incarnation, epoch}` pair, the data-version
  stream, or artifact identity (see concern 4).
- LLP 0056 is still `Review` ✓ (§Status claim holds); its §Agents passage
  reads verbatim "every seat, downgrade, and kick the delegate performs
  stays attributable" (llp/0056:1353–1354) — the Minor-1 citation resolution
  holds. The 2026-08-01 dated amendment adds `_snapback.myMemberships` and
  explicitly leaves this RFC's two surfaces to this RFC.
- LLP 0065 states membership-based patterns are future profiles requiring
  their own semantics and negative acceptance (llp/0065:196–198) ✓.
- Transition grammar fields (`op`/`by`/`target`/`from`/`to`/`fields`),
  the `MembershipWriter` carrier (src/storage.rs:11824), true-unique index
  support (`IndexManifest.unique`), and the seed refusal the a3 ticket cites
  (`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`, src/seed_identity.rs)
  all verified. `principalAddressedWrites` has no implementation on main ✓
  (Draft posture consistent; the triage's naive build was reverted unlanded).
- Search visibility is exactly `public-read | owner` today
  (`SearchVisibilityV1`, src/search/types.rs:41–44) — the a3 search ticket's
  factual basis holds.

## Strengths

- **§1's scoped disclosure is a real decision, correctly argued.** The
  byte-level claim, the epoch-advance observable, the audience restriction
  (only callers the matrix already authorizes to remove every role), and the
  rejected alternative (advancing on no-op = absent-target probe spam becomes
  a global cursor-invalidation amplifier) are all stated. This is the shape a
  decided Major should take.
- **§2's totality requirement is load-bearing and sound.** Per-role removal
  asymmetry would be a hidden-role oracle; totality closes it. The
  `lastHolder` restriction composes correctly: since every admitted caller
  role must be the protected role, an authorized caller is itself a holder,
  so removing the target cannot empty the protected set and the commit-stage
  check can never fire as an oracle on this surface (argument verified;
  recording the one-line proof in §2 would help future readers — detail 8).
- **§3's no-op branch is exact** — captured absence dependency, companion
  writes on both branches, no transition record, no epoch advance — and the
  well-formed-but-nonexistent-principal paragraph closes the user-directory
  probe before anyone asks.
- **§4/§5 keep authority executable, not metadata.** Predicate re-execution
  per page, empty-first-page for non-members, the byte-identical
  nonexistent-room vs unjoined-room negative, no-reposition uniform cursor
  refusal, and full-page-must-carry-continuation are the right invariants,
  and the acceptance section pins each of them falsifiably.
- **Honesty about what the host cannot enforce** (§6 adapter custody as a
  receipt-enforced convention; §5's conservative invalidation cost accepted
  with the rationale cross-tied to OQ3) is exactly the register LLP 0005
  asks for.
- **The decided-vs-open boundary is clean**: four open questions, each
  genuinely open, none load-bearing for v1 soundness.

## Concerns

**1. MATERIAL — sweep case "search visibility cannot express membership" is
unanswered (not designed, not scoped out).**
`issues/20260801-0137-a3-search-visibility-cannot-express-membership.md`
shows the Linear-shaped fact (org-wide member-visible search) is
inexpressible: `SearchVisibilityV1` admits only `public-read | owner`. This
is the same family as §4 — a declaration-bound membership predicate as
executable visibility, partition keyed by `membership:{declaration,
resource}` instead of `owner:{subject}` — and the RFC's own design
vocabulary maps onto it almost mechanically (visibility partition, per-query
seat resolution in the same transaction as the posting recheck, revocation
zeroes the next search). The RFC says nothing about it. Resolution: either
absorb it as a third extension (a §4-sibling for
`visibility: { kind: 'membership', membership, resource }` on search
indexes, with its own negatives), or make an explicit routed scope-out
naming the owning document (LLP 0073's frame is the natural home for the
search-side carrier) and the reason the composition is safe to defer. Under
this round's commissioning bar, silence is the one option that isn't
available.

**2. MATERIAL — sweep case "membership not seedable / reset cannot retire
authority" is unanswered, and §1's own words point at it.**
`issues/20260801-0137-a3-membership-not-seedable-cleanup-cannot-retire-authority.md`:
the versioned seed refuses membership rows, unnamed tables aren't reset
targets, so a receipted reset restores app data while every runtime seat
survives — reset cannot retire authority. §1 says the id-addressed methods
"remain trusted migration/import mechanisms" — the versioned seed is
*exactly* such a trusted context, and it is refused. A membership fixture
row is a principal-addressed membership write by a trusted context; this is
squarely the RFC's family. Resolution: design the declaration-checked
trusted-import/reset lane (fixture rows admitted only when they satisfy the
declared roles; named membership tables become reset targets; reset deletes
runtime seats — the ticket's witness list is nearly an acceptance section
already), or scope it out explicitly with a named owner (an LLP 0109 × 0056
composition) and reconcile §1's "trusted migration/import" sentence with the
fact that the one receipted trusted-import lane refuses memberships.

**3. Should-fix — §1's status-quo baseline is stale under `_snapback.myMemberships`.**
Main now serves a reserved, declaration-owned self-projection live query
(2026-08-01, `67da515f`; LLP 0056 dated amendment; closes the a2
roster-mirror ticket). §1's "Declarative `memberOf` / `hasRole` predicates
remain the only query-side membership surface" is no longer true, and
`ctx.permissions` is no longer the only non-predicate surface returning
membership-derived facts (the projection returns the caller's *own* seats).
This does not weaken the design — the projection discloses strictly less
than anything §1 protects, and the 0056 amendment explicitly defers this
RFC's two surfaces to this RFC — but §1 is the RFC's normative posture
section and must describe the real baseline. It also *helps*: the §1
disclosure argument ("tells such a caller nothing their own display roster
… do not already imply") can now cite a host-owned observable instead of a
hypothetical app roster. Resolution: v0.3 baseline refresh (a paragraph).

**4. Should-fix — §5's "matching the existing standard-pattern cursor
custody contract" overstates the existing binding.**
The current binding digest does not include normalized non-cursor argument
*values* (only filter shapes with symbolic `Arg` references), the global
authorization pair, the data-version stream, or exact artifact identity —
all of which §5's list claims for this profile "matching the existing …
contract". Implementation order step 4 already concedes the generalization
("Generalize the existing standard-pattern cursor binding for normalized
non-cursor arguments and the membership profile"), so the design intends
the stronger binding; §5 should say plainly which members are inherited and
which are new. This matters because the new members are load-bearing here
in a way they are not for the owner profile: the owner partition rides the
auth fingerprint, but the membership partition rides the **concrete
resource-id argument value** — without binding it, a cursor minted for room
A verifies for room B. Resolution: rewrite the §5 lead-in as "extending the
existing custody contract with …" and enumerate the delta; add an
acceptance line that a cursor with the resource value unbound cannot
verify across resources.

**5. Should-fix — the companion-write idempotence obligation deserves the
same guide-obligation treatment §5 gave the page-key idiom.**
§3 states companion application writes commit on *both* branches and "must
be written to be correct in both". That is a real app-correctness trap: a
companion write that decrements a member count or appends a "removed" feed
event corrupts product state on the absent-target no-op. §5's page-key
idiom was elevated to a named guide obligation (LLP 0061) in v0.2; this is
the §3 equivalent and should be named one too, with an acceptance row
(no-op branch leaves companion product state consistent).

**6. Should-fix — position §4 against LLP 0110's bounded-children profile.**
The keyset ticket itself calls the org board list "the LLP 0110/0131
bounded-children/board-list shape". `bounded_children_v1` is a shipped,
resource-partitioned, protected page surface; a reader landing on §4 needs
one paragraph on why it does not already serve the case (live-oriented,
parent-visibility-shaped, not a callable keyset continuation with cursor
custody) and how the two compose. LLP 0110 should join Related.

**7. Detail — composition note with the now-Accepted LLP 0131.**
The generated first/next functions (and any function containing
`removePrincipal`) will carry `FunctionArgsContractV1` descriptors and the
app-wide `args_contract_v1` requirement once the wave-1 args-contract lane
lands; `resourceArg` (id) and the optional cursor argument are directly
expressible, so §7's "exact first/next argument and result schemas" now
comes largely for free from the v2 descriptor lane. One sentence in §7
prevents a future reader from re-deciding this.

**8. Detail — record the lastHolder totality proof and its edge.** The
§2 argument is sound (verified above); write down the one-liner ("an
admitted caller is itself a protected holder, so the protected set cannot
empty"), and add an acceptance schedule for the expired-but-authorized
caller edge LLP 0056 documents.

**9. Detail — acceptance could add a `myMemberships` product line.** The
removed member's `_snapback.myMemberships` subscription must drop the seat
at the same authorization cut that blanks the room — 0056's machinery, but
it is now the natural third witness beside room-blank and cursor-refusal.

**10. Detail — OQ1 (removePrincipal vs removeOther).** The draft's argument
(the argument is the public address; `other` is host-derived policy) is
convincing; recommend the author simply decide it this round.

## Five-tickets coverage check (the commissioning bar)

| Ticket | Covered by this RFC? |
| --- | --- |
| `20260801-0137-a2-no-admin-revocation-of-another-member.md` | **Yes** — §§1–3 are precisely its fix, and triage's build-and-revert validated the two contract decisions the RFC adds over the naive shape. |
| `20260726-team-chat-owner-removal.md` | **Yes** — same surface; the ticket's acceptance list is a subset of §Acceptance. |
| `20260801-0137-a3-keyset-pages-owner-partition-only.md` | **Yes** — §§4–5 are its named fix shape (resource partition + seat-bound, epoch-bound cursor); concern 4 must land for the resource-value binding to actually hold. |
| `20260726-team-chat-room-pagination.md` | **Yes** — §§4–6 + acceptance cover its list; the page-key idiom and compound boundary are handled (guide obligation + OQ4). |
| `20260801-0137-a3-search-visibility-cannot-express-membership.md` | **No** — concern 1. Neither designed nor scoped out. |
| `20260801-0137-a3-membership-not-seedable-cleanup-cannot-retire-authority.md` | **No** — concern 2. Neither designed nor scoped out, and §1's own "trusted migration/import" wording names the missing lane. |

(The commission also named the a2 semijoin ticket: it is RESOLVED on main
outside this RFC — `_snapback.myMemberships`, correctly cross-referenced by
the 0056 amendment as not-0100's — which is coherent, but produces
concern 3's baseline staleness.)

## Open questions for the loop

1. Does the author want 0100 to become the family document for
   membership-composed read/visibility surfaces (absorbing search
   visibility, and possibly the seed lane), or to stay two-surface with
   explicit routed scope-outs? Either can be READY; the current silence
   cannot.
2. If search visibility is absorbed: does its partition consume the same
   conservative global-epoch invalidation (OQ3's posture) or the search
   generation machinery's own recheck-at-presentation? Worth deciding
   together with OQ3.
3. Whether ratification still requires LLP 0056 `Accepted` first: 0056 has
   now been through sixteen review rounds plus a landed dated amendment
   while sitting in `Review`; the composed-slice maintainer ruling the RFC
   already sketches may be the realistic path, and the RFC could say which
   it expects.

## Verdict

**NOT READY** — for this round's stated bar, not for design quality. The two
designed surfaces meet Charlie's READY formulation on their own terms
("thought through as much as we can without writing code"); the triage
build-and-revert is close to empirical confirmation. But the commissioning
evidence makes the membership-composition *family* the unit of review, and
two of the five ticketed cases are unanswered even at the scope-decision
level (concerns 1–2), while §1's normative baseline has drifted under a
landed main change (concern 3) and §5 misstates the custody baseline it
extends (concern 4).

## Recommended next step

Author revision to v0.3 in this loop: decide absorb-vs-route for search
visibility and the seed/reset lane (concerns 1–2 — routing with named
owners is acceptable; silence is not), refresh §1 against
`_snapback.myMemberships`, restate §5 as an explicit delta over the
existing binding with the cross-resource acceptance negative, and fold the
should-fix/detail items opportunistically. Then round 2 (delta review, both
families). The ratification path (LLP 0056 boundary) can be decided in
parallel per open question 3.
