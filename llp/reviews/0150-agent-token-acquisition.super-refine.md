# LLP 0150 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-01: walk through the open
questions together, incorporate the answers, "and then after that do an
/llp-super-refine on it." The target is the agent token acquisition RFC
authored earlier the same day, untracked in the working tree at loop start.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as
> much as, not the same as, "there are no flaws in this."

The target is a Draft RFC, so it may leave decisions open — but every open
item must be named as open rather than smuggled past the reader as settled,
and every factual claim about the codebase or the corpus must be true.

Two open questions are **commissioned debates** by the author's explicit
instruction from the walkthrough: OQ2 (credential-kind coexistence) and OQ7
(approval-link vs pairing-code consolidation). Reviewers argue each to a
recommendation; READY does not require them closed.

Loop mechanics as in the 0116–0147 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli `codex exec`,
read-only sandbox), mutually blind on 0150 artifacts, SHA-pinned targets and
instruction capsules, verify-then-fix passes between rounds, delta-scoped
later rounds in which each family sees only its own prior artifact. The loop
cannot advance the target beyond Draft; adjudication is the author's.
Charlie's standing asymmetric-stop rule applies: one family READY on two
consecutive revisions while the other is NOT READY on both stops the loop
for escalation rather than further iteration.

**Author self-verification** runs alongside each round: reviewer findings
are checked against the tree before they are applied, and the author's own
pre-verification pass runs concurrently with the reviews.

## Round 1 — 2026-08-01

Instruction capsule SHA-256 (shared by both families):
`59a56d9ebbca47bca2ec9fae5b36d8f85915ba378b8553709c315fa94002b142`

Target SHA-256 (v0.1, 389 lines — the post-author-decisions revision):
`e83032382335b7901c52210e8b574c7efdf714ac977a3d8c4a9ed69c637fcaa8`

Repo revision at review start: `main` `67628399`; the target untracked.

**Author pre-verification findings** (recorded during the round, to be
applied with round-1 dispositions; the pinned target is not edited
mid-review):

- **A1.** §3 names `SNAPBACK_AUTH_SCOPE_INSUFFICIENT`, which exists nowhere
  in the tree. LLP 0055's registered code for an out-of-scope invocation is
  `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`. A minted code name is exactly the
  defect class the 0147 loop caught (its fabricated
  `SNAPBACK_CAPABILITY_UNAVAILABLE`).
- **A2.** §3 cites "LLP 0149 F2" for the preflight facts; 0149's
  effective-actionability finding is **F1** ("Static discoverability is not
  effective actionability"); F2 is the schema-insufficiency finding.
- **A3.** §1 claims LLP 0077 has "paid and **measured**" the
  proof-for-token exchange shape. 0077 implements the exchange
  (`sbs2_`/`sct2_` issuance); no performance measurement is in evidence.
  Overclaim; soften to "implements."

**Blindness note.** Both families were instructed not to read `llp/reviews/`
artifacts concerning LLP 0150. The Codex transcript (10,380 lines) was
searched afterwards: the only occurrences of that path are the capsule's own
prohibition (line 39), unrelated skill-description text, and the root LLP's
pointer to the 0000 review. The Fable subagent recorded its exclusion and
consulted-source list in its artifact. Blindness held.

### Round 1 results

**Both families NOT READY.** Fable returned 2 BLOCKING, 8 MATERIAL, 7
DETAIL. Codex returned 7 BLOCKING (one of them a collective
factual-claims finding), 5 MATERIAL, and a DETAIL cluster. Every
citation from both families that the orchestrator spot-verified checked
out against the tree (0055's `auth.agents.mode` default and registration
model, the re-credentialing/rotation split, the hosted wholesale refusal,
`SNAPBACK_AUTH_GRANT_SCOPE_DENIED` in `src/diagnostic.rs:233` and
`src/auth/invocation.rs:1549`, the delete-disposition revocation cost,
0149's ceilings-not-expressible passage, 0077's §Credential classes
browser-family scoping, 0055's online-only service principals, the
pairing-code `minted_by_user_id` binding, and the approval CAS in
`src/storage/auth_grants.rs:392`).

**Convergent findings, blind.** Independently, both families found:

- **First-contact approval has no 0055 principal and bypasses
  registration policy** (Fable B2 ≈ Codex BLOCKING-1): grants target
  `actor_user_id`, principal creation is gated by `auth.agents.mode`
  (default `disabled`), and v0.1 never said what approval creates, who
  owns it, or how the knobs compose — the default-`open` cold start was
  unreachable as written.
- **The standing-delegation subject is self-asserted and therefore
  spoofable** (Fable B1 ≈ Codex BLOCKING-standing): "keys enrolled from
  this machine" had no verifiable enrollment predicate; any remote key
  could claim the provenance and receive silent tier-0 grants. Codex
  additionally showed the internal contradiction that delegations could
  make ordinary writes silent against invariant 3's "writes are one
  click."
- **The userless request cannot appear in a personal inbox** (Fable M2 ≈
  Codex BLOCKING-3): v0.1 made the inbox the trust-anchored path while
  requests name no user — either a broadcast consent-fatigue queue or an
  unroutable record; either way the claimed preservation of 0055's
  inversion guarantee failed.
- **The supersede transaction was under-specified** (Fable M3 ≈ Codex
  BLOCKING-5): sibling-escalation races, revocation racing approval
  (resurrection), expiry composition (a tier-1 increment silently
  extending tier-2 authority), ceremony tier of the union, cap
  accounting, and the delete-disposition destruction cost of mid-task
  supersession.
- The fabricated `SNAPBACK_AUTH_SCOPE_INSUFFICIENT` (= author A1), the
  0149 F2-vs-F1 miscitation (= author A2), the rotation/re-credentialing
  conflation, and the ceilings-not-grant-expressible dependency.

**Family-unique findings, both confirmed by the orchestrator:**

- **Codex only:** the token optimization as written ("verify a token
  rather than a signature") removes proof-of-possession — a token
  without a per-use proof is a bearer regardless of any thumbprint field;
  0077 requires a proof on every protected request and its §Credential
  classes explicitly scopes v2 to browser session families, so the agent
  profile is a commissioned extension, not existing machinery. Also: the
  `deleteTable('events')` escalation example exceeds the `{fn, kind}`
  grant grammar and, being an argument value, violates the document's own
  static-facts-only descriptor rule; the boundary table filed 0149 F6's
  task compiler under "what already exists"; the 0053 24-hour-lease
  inheritance row was wrong for online-only service principals; `sbat_`
  alone was treated as act-as-user authority in dev auto-approve where
  0055 requires `AdminWrite` + `ImpersonationCapability`; the consent
  digest "exactly captures" claim ignored the new displayed facts; 0045's
  Draft/unbuilt status made the notification dependency an overclaim; and
  the document had no acceptance section.
- **Fable only:** supersession launders delegation-minted scopes out of
  the delegation's revocation set unless lineage is recorded (M4); the
  key-custody discipline cited to 0077 does not exist there for files —
  custody for CLI/daemon agents is new surface (M6); hosted-target
  posture unstated against 0055's wholesale refusal (M7); "per source" is
  undefined for unknown keys where keypairs are free (M8); tier-0 mint
  proliferation walks into 0055's 50-grant caps (D5); delta-only
  escalation rendering invites salami-slicing (D6).

**Commissioned debates.** Both families, blind, converged: **OQ2 —
exclusive** (Codex sharpened it: coexist-per-kind is "an accidental
topology rather than a security model" — it fails the two-workstation
case; separate agents are the truthful model for separate custody
domains), and **OQ7 — keep both flows on shared substrate** (both
proposed the same consolidation: one request record, one approval
transaction, an initiation discriminator; both observed that an
inbox-minted user-bound seed *is* pairing semantics under another UI).

### Round-1 dispositions

All findings from both families applied in **v0.2** (618 lines, +58.9%
over v0.1's 389 — far past the ~20% guideline; accepted deliberately
because round 1 demanded five new normative subsections: what approval
creates, inbox routing, the supersede transaction rules, the delegation
subject model, and the acceptance sketch. The round-2 capsule makes
displacement binding: any proposed addition must state what it replaces).
Substantively:

- **First contact** (§2): the policy knob **is** `auth.agents.mode` — no
  second knob; approval atomically creates principal + identity row +
  key-bound credential + grant as a named fourth registration path
  (`approvalLink`); the approver becomes owner **and** effective user;
  provenance recorded as unverified self-declaration; the author's
  default-`open` posture recast as the agent-first-app template posture
  with 0055's platform default untouched.
- **Delegations** (§4): subject = owner-accreted key list (explicit
  admission acts, never self-asserted provenance); v1 delegations are
  **query-tier only** (writes are never silent — resolving Codex's
  ladder contradiction); the painless case restated honestly as one
  click per new key, zero per subsequent request; reuse-coalescing
  answers the cap interaction; lineage recorded and revocation propagates
  through supersede chains.
- **Inbox** (§2): unbound requests are invisible until their capability
  is presented (explicit import act); escalations route to the
  predecessor's issuer; no broadcast queue; unverified-metadata rendering
  made normative.
- **PoP** (§1): proof on every use; the key-bound token reduces lookup,
  never signature verification; proof-of-possession before request
  creation (challenge nonce); poll releases terminal outcomes only under
  proof; the agent sender-profile recast as a commissioned 0077
  extension with its decision list (algorithms, encodings, claims, replay
  namespace, cross-process custody); custody floor for CLI/daemon agents
  owned in this RFC; rotation-vs-recovery split pinned with the
  stolen-key honesty note.
- **Escalation** (§3): `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`; descriptors
  only from the pre-handler static refusal, never data-dependent denials;
  grammar honesty at `{fn, kind}` altitude with full-authority rendering;
  the seven supersede-transaction rules (predecessor-live CAS /
  no-resurrection, single lineage, min-expiry unless full re-consent at
  union tier, union-tier ratchet, net cap accounting, idempotent retry,
  delegation lineage); destruction cost named with successor-handover as
  future work; "one legible record per pair" corrected to "one legible
  lineage per chain."
- **Corrections**: boundary table renamed and fixed (0149 compiler
  proposed-not-built; 0077 browser-scoped; 0053 row corrected to
  online-only service principals); invariant 1 narrowed to durable
  authority secrets with the ceremony-capability acknowledgement;
  invariant 3 gains "only reads may become silent"; dev auto-approve
  requires `AdminWrite` + `ImpersonationCapability` with pinned effective
  user and audit; hosted routes inherit 0055's wholesale refusal; §6
  narrowed to a read-only projection with federated consent assertion
  pushed to a future RFC; consent digest versioned (v2) with
  revalidation in the mint transaction; §7 consolidates eight named
  amendments; §8 adds the adversarial acceptance sketch; Related gains
  0045/0057/0072/0098; F2→F1; "measured" dropped; "stays"→"retained in
  this draft"; per-source caps keyed honestly with the global
  unauthenticated ceiling backstop.

Target SHA-256 (v0.2, 618 lines):
`daf4a58509e6a45788a2985bee74eb8944f8b3f3dacd58c35134419864ac2343`

## Round 2 — 2026-08-02 (launched 2026-08-01 late evening)

Instruction capsule SHA-256 (shared, family-conditioned blindness clause —
each family may read its own round-1 artifact only; displacement binding;
scrutiny directed at v0.2's new normative surface):
`ee86cdd86e452012e464f4349039029e1c597ff67df5f23352027370a8c2fb7b`

Target SHA-256 (v0.2, 618 lines):
`daf4a58509e6a45788a2985bee74eb8944f8b3f3dacd58c35134419864ac2343`

**Blindness note.** The Codex transcript (6,059 lines) contains the Fable
artifact path only in the capsule's family-conditioned clause and the
reviewer's own exclusion statement. The Fable subagent recorded reading
exactly its own round-1 artifact. Blindness held.

### Round 2 results

**Both families NOT READY — and, as in the 0147 loop, essentially every
new finding is in surface v0.2 itself introduced.** Both families
verified all of their round-1 findings resolved (Codex marking several
"partially resolved" where the fix spawned a successor defect). Fable
returned 3 MATERIAL + 4 DETAIL; Codex returned 2 BLOCKING + 8 MATERIAL.
Both families' new-finding citations were orchestrator-verified: the
`{"reason":"missing_scope"}`-only payload at `src/auth/invocation.rs:1547`
(v0.2's "already carries the missing scope" was false), 0055's
`invitedBy`-gated creation invitations at `llp/0055:605-610`, 0055's
open-mode Sybil honesty at `llp/0055:617-622`, and 0077's
target-contract-vs-shipped-code warning at `llp/0077:530-536`.

**Convergent (blind):** the delegation admission-tier seam (Fable N4 =
half of Codex's delegation MATERIAL — "widening" vs tier-1 key
admission); the Expo overlay reopening userless routing at account level
(Fable N7 ≈ Codex M-overlay); digest v2 completeness (Codex M-digest;
Fable had marked the round-1 digest finding resolved — Codex's
field-level check was the sharper read).

**Fable-only, confirmed:** N1 — the `revoke-self` port made a *public
key* the family-destruction credential (0055's construction was safe
only because the preimage was secret) and `revoke-self` was missing from
the proof-on-every-use enumeration; N2 — the supersede expiry exception
was vacuous (every escalation approval already satisfies both of its
conditions, so the clamp never bound); N3 — nothing pinned the approver
to the predecessor's effective user, making escalation approval a
cross-user revocation primitive and silently converting autonomous
grants to delegated ones; N5 — challenge issuance was the one unpriced
route in the flood analysis; N6 — dev auto-approval of *delegated*
requests is new 0055 surface (`auth.mintAgentGrant` covers autonomous
only).

**Codex-only, confirmed:** B1 — v0.2's `invited` bullet let a pairing
code stand in for a creation invitation, bypassing
`auth.agents.invitedBy`, and the creation transaction never revalidated
mode in-commit; B2 — self-rotation could strand an approved successor
(request under key A, rotate to B, approve: A cannot poll, B is not the
requesting key, the predecessor is already destroyed); M — the 0600
custody floor contradicted 0077's non-exportable condition while the
authority table said "implemented and drilled"; M — first-use journaling
had no transaction/idempotency spec; M — §7 claimed exhaustiveness while
omitting five deltas, and the "no new revocation semantics" non-goal
contradicted the supersede/lineage rules; M — the `open`-mode flood
analysis bounded storage but not starvation, and "prices request
minting" overstated a negligible Sybil cost; M — the headless bullet
understated pairing's authenticated-consent requirement.

**Commissioned debates:** both families **confirm** round 1 — OQ2
exclusive (both note v0.2's new CAS/rotation surface makes coexistence
*less* attractive), OQ7 keep both on shared machinery (Codex adds the
qualification that became B1: sharing the approval transaction must not
let pairing codes become creation invitations).

### Round-2 dispositions

All findings from both families applied in **v0.3** (745 lines; growth
now +91% over v0.1, of which ~45 lines are the convention's Revised
entries; the round-3 capsule keeps displacement binding). Substantively:
`revoke-self` proof-bound with the bare-thumbprint-authorizes-nothing
rule; rotation terminally invalidates pending requests and the supersede
CAS binds the exact requesting generation/thumbprint **and** the
approver to the predecessor's effective user, with autonomous
predecessors excluded from §3; the expiry clamp made unconditional
(extension = renewal); `invited` mode consumes only live creation
invitations under `invitedBy` with same-commit mode/invitation
revalidation; the custody paragraph and 0077 authority row recast as a
deliberately weaker extractable-key profile; digest v2's canonical field
set pinned (app/deployment identity, manifest + tier-policy generations,
initiation discriminator, principal/generation/thumbprint, effective
user, scopes, expiry, tier + override, unknowns, predecessor + union,
delegation admission) with same-commit recompute-and-compare; the
delegation record contract pinned (granting user distinct from agent
owner; subject entries are credential ids, stable across rotation,
dropped by re-credentialing; template-widening tier 2 vs explicit
tier-1 admission, justified; mint-time effective-tier re-evaluation);
journal transactions pinned (`(grantId, eventKind)` key, mint-row
in-transaction fail-closed, first-use compare-and-insert with the
invocation receipt, outbox idempotent on the journal key); the headless
bullet states pairing's authenticated CLI/TUI consent surface; the
overlay projects only the mapped host user's inbox ("never an
authorization input" narrowed to "never a grant-mint or consent
input"); §7 reorganized by owner (0055 ×7, 0077, 0146, 0045, 0031) with
the revocation-semantics admission and the non-goal corrected; §8 gains
the mode-race, rotation-race, approver-mismatch, capability-import,
revoke-self-proof, and journal-idempotency rows; the `open` starvation
residual named and accepted with the separate-budgets argument; OQ3
restated as the selected hybrid contract with its residual decisions.

Target SHA-256 (v0.3, 745 lines):
`9226e013f50372b6376f422795481d79ea5d08e9dd00ebd174dc38fde36b6d83`

## Round 3 — 2026-08-02

Instruction capsule SHA-256 (shared, family-conditioned blindness clause;
delta-scoped to the round-2 corrections; author recommendation requested):
`888597e6e9ea93d9699df72247a68aa060f7f046c1fcac88d5b9de6e04cf9fbb`

Target SHA-256 (v0.3, 745 lines):
`9226e013f50372b6376f422795481d79ea5d08e9dd00ebd174dc38fde36b6d83`

**Blindness note.** Fable read exactly its own artifact and recorded its
exclusions. Codex disclosed a partial breach: a repository-wide search for
invocation-receipt text surfaced three lines of this journal (restating
v0.3's journal correction, a fact already present in its own round-2
artifact); it did not open or further use the file. Assessed low-impact
and recorded in the Codex artifact's round-3 provenance header.

### Round 3 results

**Split verdict — Fable READY (1 MATERIAL + 6 DETAIL), Codex NOT READY
(1 BLOCKING + 4 MATERIAL + 2 DETAIL) — and the headline defect is the
same finding at two severities**, found blind, exactly the 0147 round-3/5
pattern. Both families verified all their round-2 findings resolved
(Codex marking several "partial" where a residue remained; its
"unresolved" row — the absolute secret-transit wording — was a round-2
resolution-table note this orchestrator had missed, fairly charged).

**The convergent defect (Fable F1 = Codex BLOCKING):** v0.3's `invited`
lane stated invitation consumption at two incompatible moments (the mode
bullet: consumed at request mint; the revalidation paragraph: consumed at
approval), left the `invited` pending budget unnamed — making the
starvation paragraph's "separate budgets" claim unverifiable — and (Codex
only) contradicted 0055's ownership rules: v0.3 made the approver owner
always, where 0055 pins inviter-as-owner for user invitations, unowned
for operator verbs **and for bare `open` registration** (`llp/0055:274-280`,
orchestrator-verified). Fable rated the consumption/budget half MATERIAL;
Codex charged the whole as BLOCKING. Both resolutions agreed on the
shape: a reservation state machine.

**Codex-only, confirmed:** the first-use journal rule could not share a
transaction with **actions**, which run outside the transactional
snapshot path and commit effects through separate mutations
(`llp/0028:428-434`, `llp/0028:471-475` — orchestrator-verified), so
"same transaction as the invocation receipt" was unimplementable for one
operation kind; digest v2's "delegation admission decision" field did not
bind *which* delegation (two differently-scoped delegations could render
identically); the delegation record's `delegationExpiry`/`maxGrantTTL`
were inert (no tier-0 expiry formula) and subject-removal semantics were
undefined; the account↔host-user mapping was an unowned cross-plane
authorization protocol (`llp/0106:118-120` pins the separate identity
planes; `llp/0031` owns route classification only); numeric security
parameters were implied rather than named open; two absolutes survived
("nothing secret is transmitted" vs the key-bound token; the Related
header still calling 0077 "the custody model").

**Fable-only, confirmed:** the digest-mismatch sentence attributed
mode-change refusal to a digest that did not contain the mode; the
journal key could not express per-scope first-use on union grants;
`createdBy` was unexplained; an autonomous predecessor's escalation
descriptor led to a request that could pend invisibly (no inbox routing);
the coalescing claim overreached ("does not walk into the caps" was only
true for identical requests); the admission-tier rationale covered one of
its two paths.

**Commissioned debates: both families confirm for the third consecutive
round.** OQ2 — exclusive (unanimous, three rounds). OQ7 — keep both on
shared substrate (unanimous, three rounds; Fable notes v0.3's `invited`
correction removed one of its legs — pairing is no longer `invited`'s
mechanism — and the position survives on the structural-guarantee and
carriage-direction legs). The orchestrator treats both debates as
converged; closure is the author's.

### Round-3 dispositions

All findings from both families applied in **v0.4** (853 lines).
Substantively: the `invited` reservation state machine (mint reserves
exactly one live invitation under CAS — which *is* the lane's named
budget, bounded by 0055's ten live invitations per minting user;
approval consumes; denial/expiry releases, so unapproved requests still
clean up to nothing); ownership per mode as an explicit named 0055
displacement (approver-as-owner under `open`, justified against 0055's
unowned-`open` residual by the authenticated approver; inviter-as-owner
with approver=inviter enforcement under `invited`; operator invitations
unowned per 0055); first-use journaling re-keyed per scope and moved to
a **pre-handler first-attempted-use compare-and-insert** (the only
boundary exactly-once for every operation kind, actions included);
digest v2 gains the effective mode, the reserved invitation's
identity/class/creator, and the delegation id + versioned policy digest;
the delegation record completes (tier-0 expiry =
min(requested, maxGrantTTL, delegation remaining, 0055 bounds);
subject-removal revokes the credential's delegation lineage; `createdBy`
pinned audit-only; the ceremony count corrected to "tier 2 once, tier 1
per later credential, zero thereafter"); coalescing made upward (one
template grant per credential per delegation, bounded by construction,
cap failure still typed); autonomous-predecessor escalation requests
refuse at mint; the §6 overlay gated on a 0106-lineage identity-mapping
amendment (§7 item 9a) and nonexistent until it lands; the two
absolutes narrowed; §8 gains the invitation-lifecycle,
autonomous-refusal, and per-scope-journal rows; OQ8 names the numeric
parameters open.

Target SHA-256 (v0.4, 853 lines):
`3ddde9576a2715e80e93c17886545db24e7e312a98ccdca5554f3c8d70f384b3`

**Asymmetric-stop status.** Fable is READY on v0.3; Codex is NOT READY on
v0.3. If round 4 repeats the split (Fable READY on v0.4, Codex NOT
READY), Charlie's standing rule is met on its face (one family READY on
two consecutive revisions, the other NOT READY on both). As in the 0147
loop, the rule targets detail-demand spirals, and this loop's Codex NOT
READYs have each been orchestrator-verified factual defects — but the
rule's letter will be honored: round 4 is announced to both families as
the **final round**, and whatever the verdicts, the loop stops and
reports to the author.

## Round 4 — 2026-08-02 (final round)

Instruction capsule SHA-256 (shared, family-conditioned; announced final;
author recommendation required; search-scoping added to the blindness
clause after Codex's round-3 grep leak):
`d08f7d7944c05074e8672a745f7dd2a7680f77f397271c7bcbbb6682ba0476a2`

Target SHA-256 (v0.4, 853 lines):
`3ddde9576a2715e80e93c17886545db24e7e312a98ccdca5554f3c8d70f384b3`

**Blindness note.** Fable scoped its searches per the tightened capsule
and read only its own artifact. The Codex transcript's 22 matches for
excluded paths are all the target's own Revised-header text, the
capsule, and its own artifact's prior provenance statements — no
excluded-file access this round. Blindness held.

### Round 4 results

**Split verdict again — Fable READY (second consecutive revision; 1
MATERIAL + 6 DETAIL, all clause-level), Codex NOT READY (1 BLOCKING + 3
MATERIAL).** The asymmetric-stop condition is met on its face and the
round was pre-announced final, so the loop concludes here regardless.
Substance, not spiral: for the third time the families converged blind
on one defect — **Fable G1 = Codex M-injection**: the escalation mint
checked only predecessor autonomy, so a foreign grant id (grant ids
transit agent transcripts — the document's own named leak class) could
plant a doomed but victim-visible escalation request in the issuer's
inbox, contradicting the no-unsolicited-contact claim. No authority was
reachable (the approval CAS refuses), but the claim was false as
written.

**Codex's BLOCKING, confirmed against the document's own rules:** v0.4's
upward-coalescing minted the delegation's **full template**, while the
mint-time tier re-evaluation promised raised scopes would not mint
silently — so a template `{q1,q2}` with `q2` raised to tier 2 silently
minted `q2` anyway; and template widening had no legal transition
against immutable grants ("every later covered request returns that
grant"). Fable's G5 had found the widening half; Codex found the
silent-elevation half and charged the pair as the design defect it was.

**Also confirmed:** journal markers were count-capped and "oldest
swept," so an active grant's marker could be evicted and its next use
would journal as "first use" again (Codex M — exactly-once was false
under sweep); the claimed first-round-trip delegation creation had no
protocol surface (no proposal in the request, no lifecycle routes in §7
item 11) and `createdBy`'s only stated divergence path was unreachable
(Codex M + Fable G3/G4, convergent); the `invited` lane's `sbagi_`
invitation is a durable secret transiting the human that invariant 1's
acknowledgement did not cover (Fable G2 + Codex partial on "never exist
at all" vs the durable private key); reservation release did not
enumerate rotation invalidation (Fable G6); the operator-invitation
approver rule was unstated (Fable G7); tier 2's mandatory TTL and the
delegation-lifetime bounds were required by the body but absent from
OQ8 (Codex partial).

**Commissioned debates — final:** OQ2 **exclusive** and OQ7 **keep both
flows on shared substrate**, unanimous across both families in all four
rounds. The loop records them as converged recommendations; closure is
the author's.

**Both families' final author recommendations agree on process:** apply
the named fixes in one pass; no further review round is warranted;
acceptance is then the author's decision. Fable's verdict was READY
gating on G1; Codex's was NOT READY with a minimal fix set — the sets
overlap almost completely, and the union is what v0.5 applies.

### Round-4 dispositions (final pass)

The union of both families' final sets applied in **v0.5** (913 lines):
the escalation mint validates the named predecessor is live, delegated,
and bound to the requesting credential's generation and thumbprint
(foreign/stale/autonomous all refuse non-enumerating; §8 row
generalized); delegation silent minting is a **versioned current-grant
state machine** — templates are versioned and immutable per version,
the per-credential current grant carries the tier-0-eligible
*projection* (raised scopes excluded at mint), and a projection change
atomically revokes-and-replaces in one commit, closing both the
silent-elevation and the widening-dead-end halves; journal dedupe
markers are retained through grant terminality and never evicted for a
live grant, with only the inbox projection sweepable; delegation
creation gains its protocol surface (the tier-2 creation ceremony rides
a grant approval or the inbox page, binds template/expiry/`maxGrantTTL`
into digest v2, is an enumerated admission act, and the lifecycle
operations join §7 item 11's route registrations; `createdBy` reserved,
always = `grantingUser` in v1); invariant 1 narrowed to durable
**bearer** authority secrets, with the never-transiting private key
distinguished and the `sbagi_` invitation acknowledged as the `invited`
lane's carried ceremony secret; reservation release enumerates every
terminal non-approval outcome; the operator-invitation approver rule is
stated; OQ8 gains the tier-2 mandatory TTL and delegation-lifetime
parameters.

Target SHA-256 (v0.5, 913 lines):
`a5f87cae77c05d1a61f6479f4748d5f051b0b330c51843caab4b06fd0c97de26`

## Loop conclusion — 2026-08-02

**Stopped after round 4 by the pre-announced final-round rule, with the
asymmetric-stop condition (Fable READY on v0.3 and v0.4; Codex NOT READY
on both) met and honored.** As in the 0147 loop, the split was not a
detail-demand spiral: every Codex NOT READY rested on
orchestrator-verified defects, and in rounds 3 and 4 the families
converged blind on the same headline finding at different severities.

The target remains **Draft** — this loop cannot advance it, and
adjudication is the author's. Open for the author:

1. **Status.** Both families' final recommendations support advancing
   once the final fixes landed (they are landed — v0.5); Fable's READY
   gated only on G1 (applied), Codex asked for the fix set (applied) and
   explicitly deferred acceptance to the author. The v0.5 disposition
   pass is orchestrator-self-checked, per both families' stated
   process recommendation ("no additional review round is necessary").
2. **OQ2** — converged recommendation: exclusive (one live credential of
   either kind; kind-switch is rotation; separate custody domains =
   separate principals). Author closure pending.
3. **OQ7** — converged recommendation: keep both flows on the shared
   substrate with the initiation discriminator. Author closure pending.
4. **OQ3 / OQ8** — honestly-open registry classifications and numeric
   parameters, pinned at implementation.
5. The §7 named amendments land only with implementation, per the
   document's own discipline; LLP 0055 is in Review and its author
   decisions there interact with items 1–7.

Loop statistics: 4 rounds, 8 reviews (4 per family), all dual-blind
with two disclosed low-impact caveats recorded in the artifacts; ~60
distinct findings raised, every one verified against the tree before
disposition, 0 refuted as factually wrong on verification; versions
v0.1 (389 lines) → v0.5 (913 lines).
