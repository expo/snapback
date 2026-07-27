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
