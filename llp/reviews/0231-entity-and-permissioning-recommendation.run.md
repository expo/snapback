# LLP 0230 + 0231 — super-refine run journal

**Targets (lockstep cluster):**
- `llp/0231-entity-and-permissioning-recommendation.rfc.md` — **primary**
- `llp/0230-data-layer-authorization-prior-art.research.md`

**Invoked:** 2026-08-11 by the author (Charlie Cheever), "push just the two new
LLPs now then do an /llp-super-refine".
**Orchestrator/reviser:** Claude Opus 5 (this session).
**Round budget:** 3 per document (skill default) · **Launch cap:** 6 per family
per target.

## Topology

**One lockstep cluster, not two independent loops.** 0231 cites 0230 throughout
and 0230's §Summary defers the recommendation to 0231; they share `Systems:` and
were written in one pass. Reviewing them separately would let a reviewer accept
a claim in one that the other contradicts.

Per the skill's cluster rule, reviewers see both documents, each review is
preserved verbatim **once** in the primary target's artifact
(`0231-*.<family>.md`), and every review carries **per-target verdict sections**
plus a set-level verdict.

## Authorization and disclosure

- **Document authority:** the author invoked the loop directly on these targets.
  The `Author:` line on both reads "Charlie Cheever / Claude (Opus 5)", matching
  the invoking user.
- **Status transition applied before launch:** `Draft → Review` on both — the one
  transition this skill is authorized to make.
- **Pre-transition hashes:**
  - 0230 `sha256 5503bfb6ad3f0a291a6aeee431bde9f1c71aea2d73ac16534dfbb758a9b9c681`
  - 0231 `sha256 9c6a4d34686d16aed7d0b54ffa658a4ad9d69179ee691ec3c07662570f6235fa`
- **Post-transition hashes — the round-1 entering revision:**
  - 0230 `sha256 2b910b243d1f6ba73deecdc57c58ec299702a5f5a6301e3635dc56e836ea64a8`
  - 0231 `sha256 1ce122fb4448f46b4c2afd5c787672d632c551396ac6b9eff07ed8d57f0b4c64`
- **Outbound disclosure:** each capsule instructs the reviewer to read both
  targets in full plus, at its discretion, the LLPs and source files they cite —
  LLP 0011, 0053, 0056, 0170, 0172, 0173, `demos/*/snapback/functions.mjs`,
  `packages/snapback-codegen/define.mjs`, and `diaries/0031`, `diaries/0074`. No
  credentials or secrets are in scope. Destinations: **Anthropic** (claude
  family, fresh subagent in this local checkout) and **OpenAI** (gpt-5 family,
  local `codex exec`, sandbox read-only, in this same checkout).

## ⚠ Blindness is instruction-based, not structural

Both reviewers run inside this same repository checkout with filesystem read
access. There is no `git archive` export excluding `llp/reviews/023*`. Each is
explicitly instructed not to read `llp/reviews/0230-*`, `llp/reviews/0231-*`, or
this journal. That is **self-attested instruction-based blindness** (LLP 0010
§2), disclosed here per the invariant.

Neither reviewing session authored these documents: the claude reviewer is a
fresh subagent with no prior context, and `codex exec` is a fresh process. The
orchestrator wrote both targets and therefore **does not review** — it only
revises between rounds, per the reviser-never-reviews-its-own-edit invariant.

## Prior-context disclosure specific to this run

The orchestrator gathered the evidence in 0231 §Evidence itself (the card-game
finding, the query counts, the counter-evidence census). A reviewer that
re-derives those counts and disagrees should be believed over the document;
they are single-source and unreplicated. This is flagged in both capsules as a
priority check rather than left for the reviewer to notice.

## Round 1

- **Entering revision:** hashes above.
- **Entering status:** Review (transition applied pre-launch).
- **Reviewers:** claude family = fresh Opus 5 subagent, no prior context;
  gpt-5 family = local `codex exec -m gpt-5.6-sol` at `xhigh` reasoning effort,
  sandbox read-only.
- **Lens:** none declared (standard review).
- **Known asymmetry:** the gpt-5 family was unavailable for every earlier refine
  attempt this session (codex was unauthenticated until 2026-08-11). This is the
  first genuine dual-family round in this session.

Round record persisted; launching.

### Round 1 — results

**gpt-5 family: delivered.** Verdicts NOT READY / NOT READY / NOT READY, bound
to the round-1 entering revision. Body preserved verbatim in
`0231-entity-and-permissioning-recommendation.gpt-5.md`. Seven MATERIAL
findings, including recounts that contradict 0231 §Evidence.

**claude family: launch failed.** The subagent went idle three times without
producing a review and did not respond to two direct requests for its output.
No partial text was received, so there is nothing to record verbatim. Per the
skill's invariant, a failed response is recorded as failed and **never counted**;
nothing is fabricated or reconstructed.

**Round 1 therefore did not converge and is not a completed dual-family round.**
One family reviewed; the other did not run. Launch 2 of 6 for the claude family
follows, against the **same** entering revision so both verdicts bind to one
hash vector.

**Orchestrator note on the gpt-5 findings.** Before relaunching, the
orchestrator independently re-derived the disputed census rather than accepting
either its own original numbers or the reviewer's. Result: the reviewer is
correct. `demos/*/snapback/functions.mjs` at this revision has 96 `define*Query`
call sites (0231 said "~90"), 9 textual `membership:` properties, and 31 raw
`authUserId()` occurrences — of which **13 are comparison form** (`eq('userId',
authUserId())`, a read filter) and **9 are write payloads** (`hostId:
authUserId()`, stamping an owner on insert). 0231's "3–4×" ratio conflated the
two categories. The corrected comparison is roughly 13 read-filter uses against
10 membership-gated queries.

This correction is recorded here rather than applied to the target, because
revision is pending the author's decision on whether to revise now or read the
review first.

### Round 1 — terminal state

**Claude-family launch 2 also failed.** The relaunched subagent idled twice
without producing a review and did not answer a direct request. Six subagent
launches in this session have now failed the same way, across three different
task types, which indicates an environment-level delivery failure rather than
anything about the prompt. No partial text was received from either launch.

**Terminal condition reached: a specified reviewer family is unavailable.** The
skill's invariant is that this *stops the loop* and never substitutes silently.
The orchestrator wrote both targets and is therefore barred from reviewing them
itself, so no in-session substitution is legitimate. This escalates to the
author.

**Round 1 final state — single family, no convergence:**

| family | outcome |
| --- | --- |
| gpt-5 | delivered; NOT READY on 0231, 0230, and the set |
| claude | unavailable; 2 launches, no output, nothing recorded |

The single verdict set binds to revision
`0231 sha256 1ce122fb…` / `0230 sha256 2b910b24…`. **No dual-READY convergence
was reached and none is claimed.**

### Orchestrator verification of the delivered review

Two of its findings were re-derived independently rather than accepted:

1. **The census correction holds.** 96 `define*Query` call sites; 31 raw
   `authUserId()` of which 13 are comparison form (read filters) and 9 are write
   payloads. 0231's "3–4×" conflated read scoping with write-side owner
   stamping. Corrected comparison ≈ 13 read filters against 10 membership-gated
   queries.
2. **The pointing-room refutation holds, and it is the material one.**
   `demos/pointing-room/snapback/functions.mjs:69` reads
   `value: round.revealed || vote.userId === ctx.auth.userId ? vote.value : null`.
   That boundary is field-level (the row is always returned; only `value` is
   masked), disjunctive, and cross-table. No row predicate can express it, so
   D3 cannot accept this query and D2 would force it to declare `public()` —
   leaving the handler as the real boundary, which is the situation 0231 exists
   to end. 0231 cites this demo as supporting evidence; it is a counter-example
   to the proposed mechanism.

### Recommendation to the author

0231 needs a **redesign of D3**, not an editing pass. Field-level masking is
common (hidden votes, hidden hands, redacted columns), so the expressiveness cap
fails on ordinary workloads rather than exotic ones. Pointing-room should become
the worked test case any replacement mechanism must satisfy before the RFC
advances.

Proposed next step for the author to choose: **revert both documents to `Draft`**
(the errors are in evidence and in a core mechanism, so `Review` overstates
their maturity), or leave at `Review` with the findings recorded and revise in
place. This skill does not apply either transition without the author.

## Author response and re-invocation (2026-08-10, new session)

The author re-invoked `/llp-super-refine` with explicit scoping: **0231 gets the
full loop, and "reviewers should feel free to speak up if they think we need to
make a big adjustment to our plans"; 0230 gets exactly one round**, as a sanity
check of the research ("seeing if there's anything we missed"). This is read as
authorization to (a) continue the loop, (b) revise both targets against the
round-1 findings including the D3 redesign the round-1 review recommended, and
(c) close 0230's participation after one completed dual-family round regardless
of verdict, with findings applied or dispositioned rather than iterated.

**Orchestrator/reviser for this continuation:** Claude (Fable 5), a fresh
session. It did not author the original documents but is the reviser of the
round-2 revision, and therefore does not review, per the
reviser-never-reviews-its-own-edit invariant.

**Budget for this continuation:** 0231 — up to 3 further rounds (rounds 2–4
overall), launch cap 6 per family; 0230 — exactly 1 round (round 2 overall),
author-scoped.

## Round 2

- **Round-1 revision applied** (2026-08-10/11, this session), addressing all
  seven round-1 MATERIAL findings and the DETAIL findings:
  - 0231: census corrected (96 call sites / 102 generated ops; 10
    membership-gated; 12 source-level read filters across 8 demos) and its
    conclusions narrowed; recommendation restructured to a table-locus hybrid
    (mandatory table default + per-query refinements + governed override),
    absorbing A1 and moving the per-query-only shape to alternatives; D3
    rebuilt as a plan-class model (R/M/J) with pointing-room as the worked
    counter-example and acceptance gate; D4 weakened to no-false-negative with
    conservative wakes; D6 added (shared read/write locus and IR); authority
    claims corrected (0172 phase status, 0011 §462 context + explicit fallback
    supersession, manifest mechanism-vs-obligation, 0173 proposed-not-built);
    sirens S1/S2/S4 sharpened per the detail findings.
  - 0230: summary overclaim corrected ("does not scope returned rows" →
    scoping exists but is not mandatory); InstantDB added to the structural
    mismatch (engages lifetime by brute force); Zero's deprecated table-scoped
    RLS facts added; Blockaid's runtime shape made precise; zookie claim
    reduced to a hypothesis; trailing status lines fixed to Review.
- **Growth-budget disclosure:** 0231 is 503 lines against a 352-line entering
  revision (~43% net growth), exceeding the ~20% guideline. The growth is the
  author-invited redesign (plan-class model, D6, corrected-census honesty),
  not appeasement padding; disclosed here and in the final report rather than
  trimmed at the cost of the round-1 findings.
- **Round-2 entering revision:**
  - 0230 `sha256 f74b0723d06c2158dc9dce52d2292f89c356b1e46f035482b1b829588400c296`
  - 0231 `sha256 6330152a1935f35a8ac64b913cce07e93d059338c868478dc2754d3f879b1978`
- **Topology:** unchanged — one lockstep cluster, 0231 primary; reviews land
  verbatim in the per-family artifacts with per-target + set verdicts.
- **Reviewers:** claude family = fresh general-purpose subagent (no prior
  context; note: prior session recorded 6 consecutive subagent delivery
  failures — retrying in this fresh session); gpt-5 family = local
  `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox
  read-only --ignore-user-config`.
- **Lens:** none declared (standard full review; not a delta round — the
  claude family has never seen any revision, and the round-1 revision is
  substantial).
- **Blindness:** instruction-based, self-attested, as in round 1 — both
  reviewers run in this checkout and are instructed not to read
  `llp/reviews/0230-*`, `llp/reviews/0231-*`, or this journal, and to confirm
  compliance in their first line. Round-1 findings are NOT disclosed to either
  round-2 reviewer.
- **Author guidance relayed in both capsules:** 0230 = sanity-check the
  research, look for anything missed; 0231 = big-adjustment feedback is
  explicitly invited.

Round record persisted; launching.

### Round 2 — results

**Both families delivered.** First completed dual-family round of the loop.

| family | 0231 | 0230 | SET |
| --- | --- | --- | --- |
| gpt-5 | NOT READY | NOT READY | NOT READY |
| claude | NOT READY | NOT READY | NOT READY |

Verdicts bind to `0231 sha256 6330152a…` / `0230 sha256 f74b0723…`. Bodies
preserved verbatim in the two family artifacts. The claude-family delivery
failure mode of round 1 did not recur.

**Cross-family agreement (independent, mutually blind):** both families flagged
(a) Hasura as a material survey omission in 0230, and (b) class M
(field masking) as the weakest commitment — claude via missing prior art and
masking side channels, gpt-5 via missing noninterference/field-default/
re-masking semantics. gpt-5 additionally found the round-1 revision's "class J"
self-contradictory with D1 (a declared handler waiver of an unbypassable
policy); claude additionally found a third shipped declared-visibility
mechanism (the `visibility` union) that the census taxonomy had missed.

**Orchestrator verification of load-bearing claims (re-derived, not accepted):**

1. `SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED` verified at
   `packages/snapback-codegen/define.mjs` (~line 845): search indexes refuse
   generation without explicit visibility; union kinds
   `public-read | owner | membership` confirmed.
2. Owned-CRUD kit verified: `defineOwnedCrud` emits `list`/`get` query
   operations (with a `visibility` option) invisible to a `define*Query`
   census — the denominator gap is real.
3. Visibility-carrying call sites re-counted: **10** with a textual
   `visibility` key (catalog-lens 1, competitive-checkpoint 1,
   fleet-observatory-move1 2, signal-desk 3, triage-graph 3); the claude
   review's 11th (`listConversationCards`) carries `authScopeField` + owner
   filter, not a `visibility` key. The revision uses 10 and notes the
   `authScopeField` site.
4. gpt-5's exact 76/102 "neither of the first two mechanisms" figure is
   consistent with the orchestrator's counts; combined with the 10 visibility
   sites → ~66/102 carry none of the three.

### 0230 — terminal state (author-scoped single round)

0230's participation ends here per the author's instruction ("one round …
just sanity checking the research"). **Its recorded verdicts are NOT READY
from both families**, bound to `sha256 f74b0723…`; no convergence is claimed.
Disposition: all round-2 findings touching 0230 were applied in a post-round
revision (`sha256 c6f7b864…`, 412 lines) — summary precision, Hasura /
Supabase Realtime / OPA-filtering / Oso sections, the field/column-enforcement
gap section, Noria narrowing, Meta hedge, Zanzibar confidence split, Firebase
count footnote, confidence lowered to medium — with every reviewer-reported
characterization labeled as such in the text. **That revision is unreviewed**,
and the document says so in its Status section. Sanity-check answer for the
author: yes, the research had real gaps; the survey now records them and their
fixes, pending a fresh reading pass.

### Round 2 — revision of 0231 (round-2 revision)

All five gpt-5 MATERIAL findings and both 0231-touching claude MATERIAL
findings addressed; new revision
`0231 sha256 161bab9158489422b05d046029aa0511340935f65c7fb95e408b7575816538f7`
(633 lines). Headline changes: shipped visibility union added to the census
(now "three scoping paths") and to "What already exists" as the strongest
precedent; **class J withdrawn** — `ctx.db` is policy-composed on every access
path, with declared `fieldBoundary:` residuals until a class-M sibling spec
ships; **class-M safety envelope pinned** (noninterference, fail-closed field
addition, obligation-backed re-masking) with the grammar deferred to that
sibling spec; D4 split policy-fact vs policy-program changes (the latter bound
to LLP 0053 activation); override governance minimums moved into D1; S1
restated to target unrestricted runtime evaluation, not Rego/CEL per se.

**⚠ Growth budget exhausted.** 0231 entered the loop at 352 lines and now
stands at 633 (+80% net), far past the ~20% guideline (already disclosed at
+43% after round 1). Cause: two rounds of review-mandated redesign under the
author's explicit big-adjustment invitation, not appeasement padding.
Consequence adopted for round 3: it runs as a **delta round**; if any family
reports a MATERIAL concern (in-delta or pre-existing), the loop **escalates to
the author** instead of revising further, since further growth without an
author ruling would make the bound meaningless.

## Round 3 — 0231 only, delta round

- **Topology change:** the lockstep cluster dissolves; 0230 exited at round 2.
  Round-3 reviewers review **0231 only** (verdict on 0231 only, no set
  verdict) and may read 0230 as context, knowing its latest revision is
  post-review and unreviewed (its Status section discloses this).
- **Entering revision:** `0231 sha256 161bab91…` (round-2 revision above);
  context 0230 at `sha256 c6f7b864…`.
- **Lens:** delta round per LLP 0010 §2 addendum. The capsule enumerates the
  round-2 delta; every concern must be classified IN-DELTA vs PRE-EXISTING.
  Convergence if no family reports MATERIAL in pre-existing text and in-delta
  MATERIAL is absent; any MATERIAL finding escalates to the author (growth
  budget exhausted, above).
- **Reviewers:** fresh per family, same runtimes as round 2 (claude =
  fresh general-purpose subagent; gpt-5 = `codex exec --ignore-user-config
  -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only`).
  Launch counts: claude 3/6, gpt-5 3/6 — within cap.
- **Blindness:** unchanged (instruction-based, self-attested; no family
  artifacts, no journal; round-1/round-2 findings not disclosed beyond what
  the documents' own revision-history sections state).

Round record persisted; launching round 3.

### Round 3 — results

Both families delivered delta-round reviews bound to `0231 sha256 161bab91…`.

| family | 0231 | PRE-EXISTING MATERIAL | IN-DELTA MATERIAL |
| --- | --- | --- | --- |
| gpt-5 | NOT READY | none | 2 (override governance ungoverned; field-addition fence skips unmasked tables) |
| claude | NOT READY | none | 1 (no-scoping roster missing campfire + chirp; 21 of 102, not 14) |

**Neither family found MATERIAL defects in pre-existing text** — the round-2
redesign (table locus, class R/M, class-J withdrawal, safety envelope, D6)
survived both blind reviews; the claude reviewer explicitly judged the
deferral decisions non-defective. The claude census re-derivation (block-level
parser) reproduced every number except the roster omission it reported.

**Orchestrator verification:** campfire (4 queries) and chirp (3) confirmed
zero-auth-mechanism by grep; the 21-of-102 correction holds.

**Deviation from the recorded round-3 consequence, with reasons.** The round-2
record said any MATERIAL finding would escalate rather than revise. That
consequence anticipated growth-inducing appeasement; what round 3 actually
produced is the delta-convergence case LLP 0010 §2 provides for — zero
pre-existing MATERIAL across families, and in-delta fixes that *narrow* the
design (overrides now fail closed until governed; the field fence widens
refusal; the roster fix strengthens the counter-evidence). The skill's own
rule gives remaining in-delta fixes one more delta round within the round
budget (round 4 = round 3-of-3 for this invocation). Escalating to the author
for permission to make the document stricter would spend the author's
attention on a decision the skill already answers. The growth-budget overrun
itself still goes to the author in the final report.

### Round 3 — revision of 0231 (round-3 revision)

All three IN-DELTA MATERIAL findings and all six DETAIL findings applied; new
revision `0231 sha256
09c2a3426acbf200c7e2143fe78383d346a523c9b9bb75ec87a85e37ade254db` (680 lines;
growth-budget overrun now +93% over loop entry, author-facing disclosure
standing). Headline: overrides fail generation until the governance sibling
lands; field-addition fence extended to every table; roster corrected to
seven demos / 21 of 102; refinement = conjunction; projection honesty;
fieldBoundary noninterference candor; card-game gate restated as generation
failure.

## Round 4 — 0231 only, final delta round of this invocation

- **Entering revision:** `0231 sha256 09c2a342…`. Round 3 of 3 for this
  invocation; launch counts claude 4/6, gpt-5 4/6.
- **Lens:** delta round; capsule enumerates the round-3 delta (the fix list
  above). Convergence = both families READY, or both families report no
  MATERIAL concern anywhere (pre-existing or in-delta). Any other outcome
  exhausts the round budget and escalates to the author with the full
  disposition ledger.
- **Reviewers, blindness, runtimes:** unchanged from round 3.

Round record persisted; launching round 4.

### Round 4 — results: DUAL-READY CONVERGENCE

| family | 0231 | MATERIAL findings |
| --- | --- | --- |
| gpt-5 | **READY** | none |
| claude | **READY** | none |

Both verdicts bind to the same revision:
`0231 sha256 09c2a3426acbf200c7e2143fe78383d346a523c9b9bb75ec87a85e37ade254db`.
Both reviewers were fresh, mutually blind, and confirmed blindness compliance;
the claude reviewer additionally re-derived the full census and re-verified
every load-bearing citation against sources; the gpt-5 reviewer re-derived the
census independently as well. **The loop converges: dual-READY on one
revision, per LLP 0010 §2.**

## Terminal state and disposition ledger

**0231 — CONVERGED, dual-READY at `sha256 09c2a342…` (680 lines).** No later
revisions exist; the converged bytes are exactly what both READY verdicts
bind to. This skill applies no transition beyond the `Draft → Review` made at
loop start; **`Accepted` is the author's to apply.**

**0230 — single author-scoped sanity round completed at round 2.** Recorded
verdicts NOT READY / NOT READY bound to `sha256 f74b0723…`; findings applied
in a post-round revision (`sha256 c6f7b864…`) that is **unreviewed** and
labeled as such in the document. No convergence claimed.

**Open DETAIL dispositions (round 4, both altitude-dispositioned as
implementation-phase / editorial; none blocks READY):** a punch list for the
author to fold in at or before Accept —

1. (claude/gpt-5, census) "plus one `authScopeField` site" → three such sites
   (todo `listTodos`, competitive-checkpoint `listMessages` +
   `listConversationCards`, one overlapping `authUserId()`); effective-policy
   counting makes the none-of-three figure 65 rather than "roughly 66"
   (signal-desk's search query inherits index visibility). Conclusion
   unchanged.
2. (claude, pre-existing) "machine-applicable remediations" describing the
   0172 warning is the wrong adjective — the emitted remediations are
   `machineApplicable: false, requiresApproval: true`.
3. (claude, pre-existing) One candor sentence: an *undeclared* masking ternary
   passes generation undetected during the `fieldBoundary:` interim (JS is
   opaque); the declared-boundary disclosure already present covers declared
   ones only.
4. (claude, in-delta) State when the field-addition fence activates (with
   D2's second phase vs with the class-M sibling).
5. (claude, pre-existing) Qualify the override acceptance bullet
   "(post-governance)" for self-consistency with D1's fail-closed posture.
6. (claude, pre-existing) Related-header hygiene: add 0035, 0070, 0073, 0080,
   0085, 0187; drop uncited 0039, 0082, 0100.
7. (gpt-5, in-delta) The override-governance sibling should distinguish
   LLP 0070's `system` / `revalidatePrincipal` / `capturedGrant` authority
   modes rather than treating all scheduled execution as one waiver class.

**Growth-budget disclosure (standing, for the author):** 0231 entered the loop
at 352 lines and converged at 680 (+93% net), far past the ~20% guideline.
The growth is two rounds of review-mandated redesign plus one round of
fail-closed narrowing, executed under the author's explicit big-adjustment
invitation; each round's delta is enumerated in the revision history. The
overrun is disclosed rather than trimmed because every addition traces to a
MATERIAL finding.

**Proposed next step:** author reads the converged 0231 (and the round-4
punch list above), applies the punch list if desired, and rules on
`Accepted`. Commissioned siblings this RFC now depends on, in priority order:
(1) override governance (blocking D2 phase 2; must handle no-principal
authority modes), (2) the class-M field-masking spec (grounded in the
field/column prior-art reading 0230 now scopes), (3) write/egress semantics
(D6/OQ4). 0230's post-round additions await a fresh reading pass before its
next status move.
