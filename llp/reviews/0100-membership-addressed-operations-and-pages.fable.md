**Reviewer family:** Claude
**Provider / runtime:** claude-code session (Claude Fable 5)
**Date:** 2026-07-27
**Redacted:** No — full local repository access; `.agent-local-secrets.md` was
not read.
**Method:** Interactive fresh-session review; this session did not author
LLP 0100 (the draft names Charlie Cheever / Codex, so this is the
cross-family leg of the LLP 0005 loop). Verification-driven where the draft
makes claims about its parents: the transition grammar, caller-class
doctrine, and writer-carrier claims were checked against LLP 0056 (§Writes:
a declared transition policy), and the cursor-custody claims against
LLP 0065's profile/custody contract as restated in the draft and in the
`owned-keyset-pages.v1` acceptance surface. Review of the committed draft at
`316fa347` (Revised 2026-07-26), first review round.

# Review: LLP 0100 — Membership-addressed operations and pages

## Overall assessment

This is a strong, unusually disciplined RFC. Both extensions are genuinely
narrow: the removal surface adds an addressing mode without adding a read, and
the pages surface adds a membership predicate to an existing custody contract
without minting new crypto or new delivery state. The two design moves that
carry the most weight — the **totality rule** for principal-addressed removal
(§2) and the **binding-digest extension** over the existing `sbpc1` envelope
(§5) — are both correct responses to real oracles, and the draft consistently
prefers stating a conservative cost (global epoch invalidation, OQ3) over
hiding one. I found one concern I consider Major — an authorization-epoch
side-channel that undermines the §1 no-existence-bit claim as literally
stated — plus a handful of Minors. Nothing here is a wrong direction; the
Major is a scoping/decision gap, not a flaw in the mechanism.

## Strengths

- **The totality rule (§2) is the right closure.** Requiring `from` omitted on
  any other-principal removal transition eliminates the partial-coverage
  role oracle cleanly (removal succeeding for `member` but refusing for
  `owner` would read back a hidden role). The companion `lastHolder`
  restriction — every admitted `by` role must itself be the protected role —
  is a subtle and correct move: it makes the commit-stage `lastHolder` check
  unreachable as an oracle because an eligible caller's own row always
  survives the removal. I probed this for holes (pending-role callers,
  caller-and-target both protected, concurrent self-leave) and the §3
  capture/linearization story covers each.
- **Host-side target resolution (§3) preserves the 0056 posture exactly.**
  The app supplies only `(resource, principal)`; row id, role, caller class,
  and writer authority stay host-derived, and the refusal ordering (role
  denial before self-check before target lookup) means an unauthorized caller
  never triggers a membership probe. This composes with LLP 0056's
  caller-class doctrine (self wins; userless authorities match no class)
  without amending it.
- **Cursor custody reuse (§5) is the honest choice.** Extending the binding
  digest (declaration stable id, role set, resource argument, authority
  fingerprint, global authorization pair, artifact identity) rather than
  minting a new envelope keeps one custody contract to audit, and the
  byte-identical `SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` for every refusal
  class keeps the cursor surface oracle-free. The full-page-must-carry-a-
  continuation rule with `CURSOR_MINT_UNAVAILABLE` fail-closed is carried
  over intact.
- **The ratification boundary (§Status) is exemplary.** Naming the parent's
  own `Review` status and refusing to let a child acceptance silently ratify
  a parent slice is exactly the discipline LLP 0005 asks for; the suggested
  maintainer statement is precise about what it authorizes.
- **The acceptance section is executable.** Nearly every claim in the design
  has a named negative (generation refusals, cross-* cursor refusals,
  removal-between-pages invalidation, rejoin-does-not-revive). This is a spec
  a conformance suite can be written from.

## Concerns

### Major 1 — the authorization-version advance is an existence oracle the §1 claim does not scope

§1 claims the successful `removePrincipal` result "is always `null`, whether
it removed an existing row or proved the target pair absent" and that the
byte-level public result is the claim. But §5 states every committed
membership write is LLP 0056 event 1 and advances the authorization version,
and §3's no-op branch commits no membership write. So the two outcomes differ
in a durable, caller-observable way that is neither bytes nor timing: after a
present-target removal, the global authorization pair advances and every
epoch-bound cursor (including the caller's own, from this profile or from
`owned-keyset-pages.v1`, which binds the same pair) invalidates; after an
absent-target no-op, previously minted cursors keep verifying. An authorized
caller can therefore distinguish "was a member" from "was not" with one
cursor presentation — a membership-existence bit the private-roster posture
says this surface never returns.

I do not think this makes the design wrong — an authorized total-remover
arguably learns nothing they could not learn by watching their own display
roster — but the RFC currently claims more than the mechanism delivers.
**What would resolve it:** an explicit author decision, recorded in §1/§3,
choosing one of: (a) scope the non-disclosure claim to the byte-level result
and name the authorization-epoch observable as an accepted disclosure to
authorized callers (my recommendation; cheapest and honest); (b) make the
absent-target no-op also advance the authorization version so the outcomes
are observationally equivalent, and accept the extra global cursor
invalidation cost (consistent with OQ3's conservatism, but it turns probe
spam into an invalidation amplifier); or (c) something narrower once
LLP 0053 subject narrowing graduates. Whichever is chosen, §3 step 7 should
also state exactly what the no-op branch commits (companion application
writes? provenance record of the attempted-remove? currently ambiguous).

### Minor 1 — "authority-creating" classification for a revoking operation is asserted, not cited

§3 declares the command "an authority-creating membership operation for
delegated-agent consent purposes" requiring `authorityCreating: true` plus
explicit consented grant. Removal is authority-*revoking*; if LLP 0056
§Agents defines the consent class to cover all matrix-mutating operations,
cite that section; if it does not, this RFC is silently extending the
parent's consent taxonomy, which its own child-not-amendment rule forbids.
Resolution: one citation or one sentence of explicit extension with the
parent-slice ratification called out.

### Minor 2 — the nonexistent-principal path should be stated, not implied

A well-formed `Principal` that names no user at all falls into the
absent-pair no-op and returns the same `null`. That is the right behavior
(it prevents the removal surface from becoming a user-directory existence
probe), but the draft only implies it via "malformed principal fails argument
validation." One sentence in §3 making nonexistent-but-well-formed explicit
would close the reading that argument validation might consult the user
table.

### Minor 3 — the single-column cursor field pushes a schema idiom the guide must own

`[resourceField, cursorField]` exact-unique means chat-shaped tables must
synthesize a per-resource unique `pageKey` rather than paging on
`(createdAt, id)`. The acceptance section quietly assumes this ("unique
generated page keys"). That is an acceptable v1 boundary (inherited from
`owned-keyset-pages.v1`), but it is exactly the kind of authoring friction
LLP 0061 wants absorbed: the guide page for this helper should document the
page-key idiom the day the helper lands, and a compound-boundary follow-on
deserves a line in Open questions.

### Minor 4 — adapter custody of accumulated page rows is receipt-enforced only

§6 obligates product adapters to clear accumulated page rows at the
authorization cut, and the product receipt checks it. Worth one sentence
acknowledging this is a convention on application custody the host cannot
enforce — the same honesty the draft applies to timing indistinguishability
in §1.

## Suggestions

- §2: state explicitly that `principalAddressedWrites.remove` composes with a
  declaration that also has *non*-total remove transitions (e.g. a partial
  self-serve remove) — activation requires at least one total other-remove
  transition, but the text could be read as constraining all remove
  transitions.
- §5: the binding digest list is excellent; consider also naming what is
  deliberately *excluded* (the boundary row values beyond the strict filter)
  the way the first/next paragraph does, so the digest is closed in both
  directions.
- Acceptance §pages: add the probe-shaped negative — a non-member's first
  page for a *nonexistent* room and for an *existing* room they are not in
  must be byte-identical.

## Open questions (responses)

1. `removePrincipal` is the better name for exactly the reason the draft
   gives; `removeOther` names the policy fact, not the argument.
2. Agree v1 should not admit principal-addressed role change; the totality
   analysis for `setRole` is materially harder (target role is an input, so
   totality alone does not close the oracle).
3. Yes with (a) from Major 1: conservative global invalidation is fine to
   accept, but the same conservatism is what makes the Major 1 side-channel
   legible — decide both together.

## Recommended next step

Revise and stay `Draft`: resolve Major 1 (an author decision, not a
redesign), land the four Minors as text amendments, then the document is
ready for the author to move to `Review`/acceptance under the stated
ratification boundary (LLP 0056 first, or the composed-slice ruling). No
second same-family round needed; a Codex-family re-read after the Major 1
amendment would be cheap and worthwhile since that family authored the
draft.

---

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

## Round 2 — delta review of v0.3 (Fable, 2026-08-01)

**Reviewer family:** Fable (Claude) · claude-code session (Claude Fable 5) ·
same reviewer session lineage as the Round 1 section above; the codex
artifact remains unread (mutual blindness).
**Redacted:** No — full local repository access; `.agent-local-secrets.md`
not read.
**Method:** Delta review per the loop commission: verify each Round 1
concern's recorded disposition against the v0.3 text and the current tree
(origin/main at `ee66e20f`), check the changed text for fresh defects, and
spot-verify every new tree citation.
**Target:** `llp/0100-membership-addressed-operations-and-pages.rfc.md` (v0.3, 837 lines)
**Target SHA-256:** `5261cce83b62a478f25b076205733fac12bd6971b6fce3c37ec1fbd255520dfd` (verified)

### Per-concern disposition check (Round 1 concerns 1–10)

1. **MATERIAL, search visibility — RESOLVED by routing (§8a).** Named owner
   (LLP 0073 dated amendment), pinned interface
   (`{ kind: 'membership', declaration, resourceField, roles }`), and
   falsifiable obligations: one-snapshot seat resolution + posting recheck,
   outsider result byte-identical to nonexistent-resource, revocation
   zeroes the next search, the search continuation gains §5's
   authorization binding, mandatory member/outsider/revoked cases. The
   fail-closed status-quo claim verified: `SearchVisibilityV1` is closed to
   `public-read | owner` (src/search/types.rs:41–44) and re-enforced at
   authoring (define.mjs:607–608), so nothing partial can ship — the
   deferral-safety argument holds. The routing is pinned tightly enough to
   hold its owner. (Supporting precedent the RFC could optionally cite:
   asset sharing already carries a `membership` kind —
   `ASSET_SHARING_KINDS`, define.mjs:129 — so the variant name has in-tree
   family precedent.)
2. **MATERIAL, seed/reset — RESOLVED by routing (§8b).** Named owner
   (LLP 0109 dated amendment composed with LLP 0056), pinned interface:
   admission only through the existing `MembershipWriter::Seed` carrier
   (verified: src/storage.rs:11842, with `::Import` at 11843, both in the
   closed enumeration and unreachable from the receipted lane today),
   full declaration validation, membership tables as reset targets, atomic
   receipted reset with LLP 0056 event-1 consequences, the ticket's own
   runtime-seat-retired witness. `validate_versioned_seed_request` cite
   verified (src/storage.rs:1062). §1's trusted-migration/import sentence
   is honestly reconciled ("currently names only the unreceipted
   id-addressed methods"). Resolved.
3. **Should-fix, §1 baseline — RESOLVED; the recorded partial rejection is
   correct and I concede it.** The baseline refresh is accurate
   (`MY_MEMBERSHIPS_LIVE_FUNCTION`, src/local.rs:2863; landed `67da515f`;
   LLP 0056 dated amendment cross-referenced both ways). The author
   rejected my suggestion to cite the projection inside the §1 disclosure
   argument, with evidence: the projection returns only the **caller's
   own** seats, so it says nothing about a removal *target* and cannot
   substitute for the display-roster premise that argument rests on. The
   evidence holds — my Round 1 suggestion conflated "host-owned membership
   observable" with "observable about the target"; the rejection is right.
4. **Should-fix, §5 custody baseline — RESOLVED, and better than asked.**
   §5 now states the inherited-vs-new delta explicitly, names the current
   binding truthfully (verified again: `standard_pattern_cursor_binding`
   still exactly at src/local.rs:21370; filter *shapes* with symbolic
   `Arg`s; per-user permission-scope epoch; custody-not-digest for
   instance binding; profile registry refusing non-owned helpers inside
   `standard_pattern_keyset_facts`, src/local.rs:21325–21331), defines
   pair identity as the boundary-filter exclusion (which the current code
   does implement), and adds the implementation bridge naming a real seam
   for every new member — all five spot-verified: LLP 0131's
   `validate_function_args` ingress (landed; src/args_contract.rs, called
   from src/local.rs), the durable `AuthorizationVersion`
   (src/storage.rs:272; the local.rs:11035–11038 comment distinguishing it
   from the legacy resync map reads verbatim as cited),
   `strict_current_data_version_stream` (src/seed_identity.rs:517), and
   artifact identity. The component-wise binding-mutation acceptance
   schedule includes the cross-resource resource-value negative I asked
   for, correctly framed as the row an omitting implementation fails.
5. **Should-fix, companion-write idempotence — RESOLVED** (§3 names it a
   guide obligation with LLP 0061 standing; §Acceptance carries the
   branch-insensitivity row).
6. **Should-fix, LLP 0110 positioning — RESOLVED** (§4's
   compose-not-compete paragraph is accurate — bounded children is
   live-oriented and parent-visibility-shaped, this helper is a callable
   continuation — and LLP 0110 joined Related).
7. **Detail, LLP 0131 composition — RESOLVED** (§7 sentence; now literal
   tree fact since the args-contract lane landed).
8. **Detail, lastHolder proof + expiry edge — RESOLVED** (§2 records the
   proof and extends it through 0056's expired-but-authorized edge; the
   swept-non-final-holder branch correctly lands in §3 step 3's refusal;
   §Acceptance schedules both).
9. **Detail, myMemberships receipt line — RESOLVED** (product receipt
   item 4: seat-drop at the same authorization cut).
10. **Detail, OQ1 — RESOLVED** (decided: `removePrincipal`, with the
    address-vs-policy rationale recorded).

Codex-attributed items I could observe without reading that artifact (via
the Revised header): the callable-only `Query` emission decision (§4) is
verified against the tree — `defineOwnedKeysetPages` does build its pair
through `defineLiveQuery` with `defaultLive: false`
(standard-patterns.mjs:392), so the stated delta is real and the
subscription-impossibility claim is type-correct (`Query` kind is
online-only); and the composed family witness (§Acceptance) is a genuine
strengthening — one declaration, one authorization timeline, honest
fail-closed placeholder rows for the two routed surfaces until their
owners land.

### Fresh-defect check on the changed text

Three detail-level nits; nothing blocking:

- **§5 artifact-identity rationale slightly understates its own
  conservatism.** "A cursor cannot survive an artifact swap that changes
  plan meaning" — binding artifact identity invalidates on *any* artifact
  change, meaning-preserving regenerations included (the LLP 0131 identity
  rotation itself was exactly such a whole-app hash rotation with zero
  behavior change). The mechanism is right and OQ3 already owns the
  conservatism posture; suggest the sentence say "any artifact change,
  meaning-changing or not" so the cost is stated as accepted rather than
  minimized.
- **§5 cite precision:** `validate_function_args` lives in
  src/args_contract.rs (its call sites are in src/local.rs); the cite
  reads as if the function is in local.rs. Cosmetic.
- **§8a optional precedent:** the `membership` sharing kind already exists
  in the asset lane (define.mjs:129), worth one clause as in-tree
  precedent for the visibility-variant vocabulary.

### Verdict

**READY.** All ten Round 1 concerns are resolved as recorded — the two
MATERIAL family gaps by routing with named owners and interfaces pinned
tightly enough to hold them (falsifiable obligations, verified fail-closed
status quo, join points in the composed witness), the custody delta by an
accurate restatement whose every new-member seam exists in the tree today,
and the one recorded partial rejection of my Round 1 suggestion is
supported by evidence I verified and accept. The fresh v0.3 text
introduces no defect above detail level. This meets the standing READY
bar: the design is thought through as far as it can be without writing
the code, and what it deliberately does not design is now a decision with
owners rather than silence.

### Recommended next step

Author applies the three detail nits at will (none gates), then proceeds
to the ratification boundary the RFC itself states: LLP 0056 acceptance
first, or the explicit composed-slice maintainer ruling (the RFC's Status
section already drafts it). Implementation order steps 2–5 are ready to
schedule once ratified; the composed family witness should land with the
Team Chat adoption in step 6.
