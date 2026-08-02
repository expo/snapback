# LLP 0149 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-01: "do an /llp-super-refine on
it," where "it" is LLP 0149, the agent-application-consumption Research that
Codex drafted earlier the same day and this session's Fable context extended
with §Second-model assessment. The target is untracked in the working tree at
loop start.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as much
> as, not the same as, "there are no flaws in this."

The target is Draft **Research**, so it recommends rather than decides and may
leave questions open — but every factual claim about the codebase or corpus
must be true, every ownership/boundary assertion must match the referenced
document as it exists today, and nothing open may be smuggled as settled.

**Authorship note.** The document has mixed family authorship: the base
Research is Codex-drafted; §Second-model assessment (A1–A8, OQ13–16) is
Fable-drafted, by the same session that orchestrates this loop. Both round-1
reviewers were told this and instructed to review all sections with equal
skepticism. The orchestrating session does not count itself as an independent
reviewer of the section it wrote; its checks appear only as the author
self-verification pass below.

Loop mechanics as in the 0116–0147 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli `codex exec`,
read-only sandbox, `model_reasoning_effort=xhigh`), mutually blind on 0149
artifacts, SHA-pinned targets and instruction capsules, verify-then-fix
passes between rounds, delta-scoped later rounds. The loop cannot advance the
target beyond Draft; adjudication is the author's.

## Round 1 — 2026-08-01

Instruction capsule SHA-256 (shared by both families):
`906c85005b80ec976da4a90f8e4856051eedc58498a6242b4c0543020c05708c`

Target SHA-256 (v0.1, 725 lines):
`870ae34e02fe477f327c2e46c219cc85ad5ab904c00808dc27d0bdba1513cbe2`

Repo revision at review start: `main` `67628399`; the target untracked.

### Author self-verification (concurrent with round 1)

Run against the tree before either family reported. Findings, to be checked
against the round-1 reviews and applied with them:

- **(MATERIAL) F4/Slice 4 omit that the consuming agent cannot reach dry-run
  today.** `function.explain` serves `mutationDryRun` on the host-ops plane
  under dev-user authority (`src/host_ops.rs:1686-1701`), and LLP 0055 pins
  `dryRun: false` for agent principals in v1 ("v1 has no scoped-token dry-run
  surface," `llp/0055:1322-1324`); LLP 0062 names "Agent-principal dry-run"
  as explicitly-out-of-v1 future work. A consumption research document whose
  subject is the app principal should name agent-reachable dry-run as a
  prerequisite for Slice 4 rather than presenting the preview foundation as
  available.
- **(MATERIAL, Fable's own section) A4 cites the wrong authority.** LLP 0053
  owns read-authorization *invalidation* (epochs, obligations, leases,
  fences), not a per-field write-authority model. The honest derivation basis
  for "may non-operator principals write this field" is the function
  manifest's per-function write summaries (LLP 0012, hardened by LLP 0146
  D1's declared/captured conformance) joined with per-function auth
  requirements. The Related-header addition of LLP 0053 rode on this citation
  and should be re-justified or dropped.
- **(DETAIL) "Commit version" naming.** The shipped identities are the
  settlement receipt's committed `snapshotVersion` (`llp/0133:152, 415`) and
  the `version: u64` storage commit version on live replace/delta frames
  (`llp/0093:213-214`). F9 and A2 are true in substance and should cite the
  exact carriers — which strengthens A2's precondition proposal.
- **(DETAIL) F6's ceiling enumeration.** LLP 0055's grant model today
  carries TTL, live-token caps, and throttles; per-grant call-count,
  concurrency, and spend ceilings are new surface the compiler would need
  0055 to grow. "Extend LLP 0055's grant model" covers this, but the text
  should not read as if the enumerated ceilings already exist.

Verified true during the same pass: the LLP 0024 catalog-entry field list
(`llp/0024:447-462`), the two-MCP-surface structure and candidate-tool rule
(`llp/0024:67-71, 447`), LLP 0062 §Future work naming the journal/`resolve`,
transcripts/replay, `changed-since`, token broker, and agent-principal
dry-run, LLP 0061's intent aliases (`llp/0061:366`), LLP 0093's
billing-visible demand posture (`llp/0093:31, 120`), and LLP 0146's D1/D3/D7
labels and deferral list.

**Blindness note.** Both families' artifacts record the exclusion. The Codex
transcript (14,822 lines) was searched afterwards: all eight `llp/reviews/`
occurrences are the capsule's own prohibition, the reviewer's stated intent
to exclude, the repo llp-review skill text it loaded, and incidental
mentions inside LLP 0055/0062/0146 body text. Blindness held.

### Round 1 results

**Both families NOT READY — with an instructive asymmetry.** Fable returned
two MATERIAL and five DETAIL and called the margin narrow; Codex returned
six BLOCKING, one MATERIAL, one DETAIL and called the margin wide. Both
verified the base Research's overlap survey, future-work attributions, and
sequencing as essentially sound; the defect mass sat in the Fable-authored
§Second-model assessment. Both families looked hardest at their own
family's sections, as the capsule instructed, and each found real defects
there: Fable's two MATERIALs were against its own family's A4 and
Concurrence; Codex's BLOCKING-5 was against its own family's authority
table.

**Convergent, blind (three independent routes to A4):** the author pass,
Fable finding 1, and Codex BLOCKING-3 all found A4's trust-labeling
derivation cites LLP 0053 for a per-field write-authority model that does
not exist — 0053 owns read-authorization invalidation. Codex added the
sharpest consequence: an unenforced `operator-only` label would *weaken*
prompt-injection defenses by communicating unsupported trust. Also
convergent: the F5 journal diagram's misdrawn transitions (Fable 3 / Codex
8), and the effective-view/refusal identity question (Fable's A5 open
question / Codex MATERIAL-7).

**Codex-only, all confirmed against the tree:**

- **BLOCKING-1 (A7):** "retry with the same key becomes app-declared-safe"
  turned an unverifiable app promise into retry authorization, contradicting
  F5's own trustworthy-mechanism bar — and contradicting LLP 0147's explicit
  adjudication that an `idempotent` retry class is "deliberately absent
  rather than reserved-and-unused" because a declared retry input must first
  name its authoritative source, request identity, and carrier
  (`llp/0147:677-695`, verified).
- **BLOCKING-2 (A6):** "replay against the current generation in acceptance"
  conflated LLP 0062's hermetic frame playback with live re-execution of
  recorded operations — which could repeat durable or external effects in
  CI, and is what LLP 0146 declined.
- **BLOCKING-4 (A1):** a single provenance grade cannot represent the
  declared-and-observed-with-different-values state that false-declaration
  detection requires, and D1's observation is read/write sets only.
- **BLOCKING-5 (base authority table):** "typed in both success and refusal
  paths" overstates LLP 0144 — enumerability is deliberately absent from the
  protocol surface (`llp/0144:199-204`), client consumption is untyped
  reach-through (`llp/0144:381-386`), the guide channel is not shipped
  (`llp/0144:592-597`). All anchors verified.
- **BLOCKING-6 (A2):** "version/digest identities … (LLP 0093 names them)"
  presented OQ13's open digest question as existing machinery; 0093 names
  only the storage commit version (`llp/0093:213-214`).
- **MATERIAL-7 (A5):** "disagreement is a server defect" ignored legitimate
  staleness (grant expiry/revocation, manifest activation between view and
  call); needs the matched/stale/invariant-violated trichotomy.

**Fable-only, confirmed:** the Concurrence's "carries most of the static
descriptor" (the spec'd entry carries the identity/schema/authority core and
none of the refusal/retry/effect/guide facts; the implemented catalog is
thinner still — `outputSchema` always `'unknown'`, `dryRunSupported`
hardcoded `false`, `packages/snapback-cli/mcp-control.mjs:135-144`);
the narrower evidence-basis statement; Related-header orphans (0094/0095/
0134 uncited in body); the `plan_operation` forward reference; the undefined
"comparison set." Fable also contributed the ready-made F1 witness (static
`dryRunSupported: false` vs served `mutationDryRun`) and the LLP 0144
reserved-slot anchor for the earliest-retry note, both adopted.

**Author-pass finding neither family charged:** the consuming agent cannot
reach dry-run at all today (host-ops plane, dev-user authority,
`dryRun: false` for agents per LLP 0055) — Fable verified F4's foundation
claim in code without noting the plane gap. Applied as a MATERIAL alongside
the reviewer findings.

**Orchestrator note on a reviewer framing:** Codex's overall assessment says
"six blocking issues remain in the second-model additions," but its own
BLOCKING-5 is against the base document's authority table, drafted by the
Codex family. The miscount changes nothing material; recorded for symmetry
with the capsule's family-loyalty instruction.

### Round-1 dispositions

All findings from both families applied in **v0.2** (836 lines, +15.3%,
inside the ~20% growth budget), SHA-256
`ffd053bb98b6a45c76b003f1833c193370f069fa3594956e9a87cb0cd147b8c2`.
Substantively:

- **A7 inverted its operative clause**: the declared key is reconciliation
  metadata presented by `resolve` to a human or app-specific reconciler;
  `outcome-unknown` stays terminal for every action; LLP 0147's
  declared-input bar is cited as the governing precedent.
- **A6 split into two named mechanisms** — hermetic exemplar playback
  (recorded frames, no effects) and live exemplar acceptance (seeded
  isolated state, queries/mutations only, actions as declared-effects
  preview or test double) — with "replay recorded operations against live
  state" explicitly disclaimed.
- **A4 rewritten as a gated direction**: correct authorities (imperative
  `ctx.auth` write authorization per `llp/0011:259`, declarative write rules
  a draft shape per `llp/0011:181-196`), untrusted-floor-only labeling, no
  positive label before an enforced write policy or value-provenance design,
  differentiation brag and "comparison set" dropped. LLP 0053 removed from
  Related; LLP 0011 added.
- **A1 remodeled as independent evidence records** with the disagreement
  state representable and observation scoped to D1's read/write captures.
- **A2 narrowed to the identities that exist** (`version: u64` per
  `llp/0093:213-214`; receipt `snapshotVersion` per LLP 0133) with the
  digest question pointed back at OQ13.
- **A5 given the identity-bound receipt and the three-outcome model**; new
  OQ17 records the receipt-classification question.
- **The authority-table row for 0108/0131/0144 corrected** to
  declaration-and-admission-only typing with the three 0144 anchors, and the
  table intro now names the landed/accepted/proposed collapse.
- **F4 and Slice 4's prerequisite named** (agent-unreachable dry-run today);
  **F5's diagram redrawn** (pre-dispatch branch, mutation-only ACK tail,
  terminal unknown) plus a per-kind semantics matrix (Codex's suggestion);
  **F1 gained the identity-binding sentence and the shipped
  static/effective witness**; **R1 gained the field-admission rule**
  (Codex's promotion of the assessment's sharpening); **R2's
  `plan_operation` glossed** as projecting today's preview; **F6's ceiling
  enumeration made honest** about which ceilings exist; 0094/0095 earned in
  F8, 0134 earned in Slice 0, LLP 0058 suggestion taken via Related; the
  assessment confidence block recalibrated (A4/A6/A7 moved to **Gated**);
  What-not-to-build's retry bullet tightened from "declared" to
  "contract-backed" idempotent effects (orchestrator consistency edit,
  flagged for round-2 scrutiny).

**Residue carried, not applied:** none. Every round-1 finding was applied;
no finding was refuted.

## Round 2 — 2026-08-01

Instruction capsule SHA-256 (shared, family-conditioned blindness clause —
each family may read its own round-1 artifact only, and not this journal):
`54542119545b3f4c51bb3c8927d8e9013b3efcd460ad917dda298e1231000a65`

Target SHA-256 (v0.2, 836 lines):
`ffd053bb98b6a45c76b003f1833c193370f069fa3594956e9a87cb0cd147b8c2`

Delta-scoped: the capsule enumerates every v0.2 change site, directs
scrutiny at the revision text itself (the recurring cross-loop failure mode:
the previous round's fix introduces the next round's defect), and makes
displacement binding against the ~20% growth budget (v0.2 sits at +15.3%).

**Author pre-verification alongside round 2:** every new v0.2 anchor was
re-verified against the tree before the reviews returned —
`mcp-control.mjs:135-144` (outputSchema `'unknown'`, `dryRunSupported:
false`), `src/host_ops.rs:1686, 1701` (served `mutationDryRun`, dev-user
authority), `llp/0055:1322-1324`, `llp/0011:259` (exact line),
`llp/0011:181-196`, `llp/0147:691-695`, `llp/0144:199-204, 381-386,
103-104`, `llp/0093:213-214`, `llp/0146:451-462` (precedence list at
451-459 plus receipt binding). All held at pre-verification time; see the
moving-anchor note below for what happened to one of them.

### Round 2 results

**Both families NOT READY — Fable "by the narrowest possible margin" (one
MATERIAL, three DETAIL), Codex "by a moderate margin" (five MATERIAL). Both
independently verified every one of their round-1 findings genuinely
resolved.** The round-2 defect mass is, as the capsule predicted, almost
entirely in text the round-1 revision itself introduced or left displaced.

**Fable's MATERIAL — the round-1 fix that recreated the defect class it
fixed.** v0.2's `plan_operation` gloss (added to resolve Fable round-1
finding 6) claimed the server "already owns … a declared-effects report for
actions." No action-effects explain kind is served or even pinned
(`src/host_ops.rs:1711-1720`: the LLP 0024 v0 kinds contain no action
report), and by the document's own F2/OQ3 the effect-declaration grammar it
would report does not exist. The same existing-capability overstatement
class that blocked v0.1, introduced by a round-1 fix — the third loop
running in this repo to observe that exact dynamic.

**Fable's DETAILs:** the A7 anchor `llp/0147:691-695` — **correct when
written, stale by review time**: LLP 0147 is under concurrent revision by
its own super-refine session, and the cited paragraph moved to
`llp/0147:704-711` between the orchestrator's pre-verification and the
round-2 read (both states verified directly by the orchestrator; the
journal records this as a moving-anchor hazard for cross-references into
in-flight Drafts). Plus LLP 0058 added to Related without a body sentence
(recreating the round-1 hygiene class for one entry), and the
evidence-basis qualifier left claiming the ideas "lean on" LLP 0053 after
the A4 rewrite removed the only 0053 citation.

**Codex's five MATERIALs, all confirmed against the tree:**

- **The F1 witness compared authority planes.** The v0.2 witness (adopted
  from Fable's own round-1 suggestion) read static `dryRunSupported: false`
  against the served operator-plane `mutationDryRun` as a static/effective
  disagreement — but for the in-scope consuming agent, static declaration
  and effective unavailability *agree* today (`llp/0055:1322-1325`); the
  disagreement was manufactured by switching principals. Cross-family
  symmetry at its sharpest: one family's suggestion, adopted by the
  orchestrator, corrected by the other family.
- **F6 presented fixed platform guardrails as grant facts.** The grant
  record carries scopes and `expires_at` only (`llp/0055:918-946`,
  immutable in v1); the ten-tokens-per-grant cap is a v1 constant
  (`llp/0055:898-905`) and the throttles govern auth routes
  (`llp/0055:1154-1165`) — none of it requestable, reviewable consent,
  which is the distinction a task-grant compiler exists to honor.
- **A5 collapsed LLP 0144's platform/application boundary.** "Same
  vocabulary" swept app-authored business refusals (`appCode`, raised
  inside permission-gated handlers, I2/I7) into what an effective view
  could predict, though predicting them means executing application logic
  (OQ4); and the earliest-retry note assigned platform budget/rate facts to
  0144's channel, which its I6 explicitly keeps them out of.
- **Slice 2 still carried v0.1's "declared idempotency seam" threshold**
  that the A7 rewrite had just rejected — a displaced-text contradiction
  the round-1 pass missed because it only edited the assessment section's
  copy.
- **A2 settled OQ13's ownership question** ("owned by the existing
  settlement path") three hundred lines before OQ13 asks whether that path
  can own the comparison at all.

### Round-2 dispositions

All nine findings applied in **v0.3** (871 lines, +20.1% over v0.1 — at the
growth guideline after compressing the Revised header and Summary loop
note; Codex's replace-not-append discipline followed), SHA-256
`3e996b3fe761bab4ea91256261912b43db9539ab56ca529a52188de8b68e26a6`.
Substantively:

- The F1 witness inverted into the design lesson the defect actually
  teaches: one boolean cannot say which of runtime support, projection
  availability, target support, or current-authority reachability it
  reports (Codex's own resolution language, adopted).
- F6 now inventories configurable grant facts (scopes, expiry) separately
  from fixed platform guardrails (token cap, auth-route throttles) and from
  proposed ceilings, with the three 0055 anchors.
- A5 renamed to "one **platform**-refusal vocabulary," with the two 0144
  namespaces stated and application refusals explicitly outside the
  effective view's prediction; the smaller note now routes earliest-retry
  facts by namespace owner.
- Slice 2's action bullet replaced: terminal at the generic engine, key
  recorded for reconciliation only, nonterminal class requires a designed,
  enforced owning contract.
- A2: "covers the common case," candidate-not-decided owner, and the
  unrelated-writes staling caveat; `plan_operation` glossed honestly
  (operator-plane today, nothing for actions until a declaration grammar
  exists).
- A7 re-anchored to `llp/0147:704-711` with a moving-anchor note; LLP 0058
  earned in R4 (the effective view projects 0058's invocation-authority
  vocabulary); LLP 0053 dropped from the evidence-basis list.
- Suggestions adopted: volatility/evidence-type added to R1's admission
  rule; A6's test-double contract (identity, isolation witness,
  no-live-provider) and Declined-3 anchor and value-separated wording; F5's
  prose bullets compressed into the sentence the matrix supersedes.
- Declined: Codex's maturity-column table restructure (the intro sentence
  plus the corrected 0144 row carry the distinction at Research altitude;
  a full per-row maturity audit belongs to the owning RFCs Slice 0
  commissions).

**Residue carried:** none refuted; one deferred (maturity column, above).
Concurrent-tree note: by round-2 close the working tree gained
`llp/0150-agent-token-acquisition.rfc.md` from another session — no
numbering collision with 0149.

## Round 3 — 2026-08-01

Instruction capsule SHA-256 (shared; family-conditioned blindness — own
artifact both rounds allowed, other family's and this journal prohibited):
`ce41d5fe689881a322f1f11d83a3a155edea3355d1601de852c7ead6d4a380c3`

Target SHA-256 (v0.3, 871 lines):
`3e996b3fe761bab4ea91256261912b43db9539ab56ca529a52188de8b68e26a6`

Narrow delta round over the ten enumerated v0.3 changes, with the standing
reminder that twice in this loop a fix introduced the next round's defect,
a moving-anchor dispensation for LLP 0147 (under concurrent revision), and
an explicit whole-document convergence instruction: READY means nothing
remains that a further no-new-evidence round would fix.

### Round 3 results

**Split verdict — Fable READY ("by a comfortable margin," zero new
MATERIAL, one optional DETAIL), Codex NOT READY ("by a narrow margin," two
MATERIAL, one DETAIL).** Both families verified every one of their round-2
findings genuinely resolved. Fable's pass was notably thorough in the
negative direction: a document-wide LLP 0055 throttle sweep confirming no
invocation-under-grant throttle exists anywhere (strengthening the F6
split), and a confirmation that the A7 re-anchor was exact in the current
tree despite 0147's concurrent revision.

**Codex's two MATERIALs — the fix-introduces-defect dynamic, third
occurrence, and this time the seed was the other family's suggestion:**

- **A6 conflated LLP 0062's two artifacts.** The v0.3 parenthetical
  "values replayed value-free by default, per 0062's transcript design"
  (adopted from Fable's round-2 precision suggestion) merged the value-free
  *audit lane* (closed allowlist, default; `llp/0062:628-640`) with the
  *transcript* future work (full call/subscription result documents, values
  separate and explicitly authorized, opt-in; `llp/0062:656-664,
  1527-1533`) — and "safe anywhere" claimed confidentiality safety that
  effect-hermeticity does not provide. Codex also surfaced the genuinely
  open semantics question: what replay means when a script branches on a
  redacted value.
- **"The slot 0144 reserves" invented a slot.** LLP 0144's Axis E landed
  slice is E1: declared refusals participate in *no* dispositions
  (`llp/0144:423-429`), with hints and their owner explicitly open in its
  OQ3 (`llp/0144:686-694`, E1 normative until a named amendment). The
  round-1 adoption of Fable's suggestion had phrased an option space as a
  reserved carrier.

**Codex's DETAIL:** 0144's I6 names host auth/capability/protocol denials —
not budget/rate — so A5's grouping needed budget gates labeled as proposed
platform-owned denials rather than I6-covered ones. Confirmed.

**Fable's DETAIL (optional, applied):** the overlap-table anchor
`llp/0144:199-204` clipped the enumerability fact; widened to `201-208`.
Fable's suggestions (complete the four-part 0147 paraphrase with the
compile-time diagnostic; consider section-based pins for 0147) noted, the
first applied.

### Round-3 dispositions

All three Codex findings and the Fable DETAIL applied in **v0.4** (885
lines, +22.1% over v0.1 — past the ~20% guideline by ~15 lines; the excess
is correction text and the Revised-entry convention, accepted as the 0147
loop accepted its own overage), SHA-256
`f7e42d2fec4caca1d0ad914894400f1a9c94a6553841c24700afd4aa6c14c890`.
Substantively: A6 now separates effect-hermeticity from data safety, names
the audit lane and the transcript as different artifacts, keeps fixtures
under transcript custody, and routes the value-redacted class (and
branch-on-redacted-value semantics) to OQ16; the earliest-retry note states
E1 as landed, the carrier as nonexistent, and `appDetails` as untyped; A5
labels budget gates as proposed platform-owned denials; R4's 0058 sentence
gained the verified `llp/0058:1049` anchor (Codex's suggestion, range
checked before citing); A7's paraphrase completed with the compile-time
diagnostic.

## Round 4 — 2026-08-02

Instruction capsule SHA-256 (shared; family-conditioned blindness — own
artifact all rounds allowed, other family's and this journal prohibited):
`123754b033d8787701ef1974fb5eea196f524a455046122443d90db896479eb3`

Target SHA-256 (v0.4, 885 lines):
`f7e42d2fec4caca1d0ad914894400f1a9c94a6553841c24700afd4aa6c14c890`

Final-verification round over the seven enumerated v0.4 changes. Fable
entered the round already READY on v0.3; it re-reviews so that dual-READY,
if reached, is attested on the same version.

### Round 4 results — convergence

**Fable READY ("by a comfortable margin," second consecutive READY). Codex
NOT READY "by a razor-thin margin" — explicitly citation-only,** with the
reviewer's own closing: after the mechanical anchor correction "the
dual-family review can be treated as converged; no additional
no-new-evidence model-review round is warranted."

Both families independently verified all round-3 items resolved, checked
the seven v0.4 changes clean at both altitudes, and — blind to each other —
converged on the **same single residual defect**: the A7 anchor
`llp/0147:704-711` had drifted a second time (LLP 0147's own concurrent
super-refine session revised it again mid-round; the four-requirement
paragraph now sits at `llp/0147:721-726/728`). Both prescribed the same
fix (content/section pinning or landing-time re-anchor) and both stated no
further review round is warranted. Fable additionally offered two wording
completions ("user-authorized"; making OQ16's branch-on-redacted-value
routing literal) designated ride-the-landing-commit.

Notable negative result, from both families: the loop's recurring defect
class — a fix asserting more capability than exists — did not recur in the
v0.4 delta, for the second consecutive round on the Fable side and the
first on the Codex side.

### Round-4 dispositions and loop closure

The three ride-the-landing-commit items applied in **v0.5** (890 lines),
SHA-256
`9efa72052a8e0e9e73185720780fdbad293d4e4f47955cbb266b202e5b8dd8c4`:
the A7 citation re-pinned **by content** (the "An `idempotent` class is
deliberately absent" paragraph, with the current line range dated to this
revision) so 0147's continuing drift cannot invalidate it again;
"user-authorized" restored; OQ16 extended with the branch-on-redacted-value
clause. `ref-check --verbose` clean.

**The loop is declared converged on v0.5**: Fable READY on v0.3 and v0.4;
Codex's v0.4 residue was one stale line number, fixed exactly as its review
prescribed, with its review stating convergence follows mechanically. Four
rounds, eight reviews (four per family), every finding verified against the
tree before application, zero findings refuted, all applied.

**Score by origin, for the record:** round 1 — 9 findings (2 Fable MATERIAL
+ 5 DETAIL; 6 Codex BLOCKING + 1 MATERIAL + 1 DETAIL, of which 5 BLOCKING
against the Fable-authored assessment section and 1 against the
Codex-drafted base), plus 2 author-pass findings (1 neither family charged:
the agent-unreachable dry-run). Round 2 — 9 findings (Fable 1 MATERIAL + 3
DETAIL; Codex 5 MATERIAL). Round 3 — 3 findings (Codex 2 MATERIAL + 1
DETAIL; Fable 1 optional DETAIL). Round 4 — 1 shared DETAIL (the drifted
anchor). The fix-introduces-defect dynamic appeared three times (rounds
1→2 twice via orchestrator fixes, 2→3 once via an adopted cross-family
suggestion) before damping to zero.

**Author adjudication — 2026-08-02.** Charlie Cheever promoted LLP 0149
Draft→Active and directed the loop's artifacts be committed and pushed.
The proposal below is superseded by that decision and kept as the record
of what the loop proposed.

**Proposed next step (the author decides; this loop cannot accept):** LLP
0149 remains **Draft** Research. Its own §Status recommendation stands —
the deliberately small first decision is choosing the existing artifact
authority that will own the consumption descriptor and operation-journal
projection (OQ1/Slice 0). The document is, per both families at the
standing bar, thought through as far as it can be without writing code.
Landing note: the working tree is shared with concurrent sessions (LLP
0147 in revision, LLP 0150 newly created); whoever lands this commit
should re-run `ref-check` and re-verify the dated 0147 line pin at landing
time.
