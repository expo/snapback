# LLP 0152 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-02: "do 2 rounds of
/llp-super-refine on 0152 and 0153. These are mostly research so just
refining the conclusions is probably the important thing to do." The round
cap is therefore **two**, set by the author, and both rounds' capsules carry
an author-directed conclusions-first priority. The target is untracked in
the working tree at loop start; the base Research is Codex-drafted
(header: Charlie Cheever / Codex); the orchestrating session (Fable) did not
author it and runs the loop only.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence."

The target is Draft **Research**: it recommends rather than decides and may
leave questions open — but every claim about the LLP corpus must be true
against the corpus as it exists today, and nothing open may be smuggled as
settled. External vendor claims are citation-backed survey material;
reviewers were told to treat them as unverifiable-here except for bounded
web spot-checks, and to spend their effort on the conclusions and on corpus
accuracy.

Loop mechanics as in the 0116–0149 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli 0.146.0
`codex exec`, read-only sandbox, `model_reasoning_effort=xhigh`), mutually
blind on 0152/0153 artifacts in round 1 and family-conditioned in round 2
(own artifact allowed), SHA-pinned targets and instruction capsules,
verify-then-fix passes between rounds. The loop cannot advance the target
beyond Draft; adjudication is the author's.

**Concurrent-corpus hazard, noted at loop start:** LLP 0151 — the document
0152 exists to inform — was revised to v0.3 the same day by its own
super-refine session (Option D convergence, SMS tier-1 kept, dated
amendments). The orchestrator's pre-verification found 0151 v0.3 had
already absorbed several of 0152's challenges before round 1 returned.

## Round 1 — 2026-08-02

Capsules: `capsule-0152-r1.md` (shared by both families; author-directed
conclusions-first priority; blindness on all 0152/0153 review artifacts and
journals).

Target SHA-256 (v0.1, 967 lines):
`b2c6547021095d3f4172722aa88bc2ca05e4b098d4513d20ea430ad20d4aa74e`

Repo revision at review start: `main` `67628399`; the target untracked.

### Orchestrator pre-verification (concurrent with round 1)

Checked before either family reported: LLP 0151 v0.3 makes recovery codes
**tier-1 infrastructure** (`llp/0151:423-430`), TOTP **tier 2**
(`llp/0151:667`), Microsoft Entra ID the first named tier-2 preset
(`llp/0151:663`), and prefers email codes over links (`llp/0151:226-228`) —
all contradicting 0152's Summary challenge and §Implications items 1–4 as
drafted. Verified true: LLP 0011's opt-in cross-provider linking rule
(`llp/0011:240-241`) and no-cascade-delete rule (`llp/0011:249`).

### Round 1 results

**Both families NOT READY — Fable "by a narrow margin" (1 BLOCKING, 2
MATERIAL, 5 DETAIL), Codex "by a moderate margin" (5 BLOCKING, 6 MATERIAL,
2 DETAIL).** Blindness audited and held for both (the Codex transcript's
only `llp/reviews/` traces are the capsule prohibition, skill text, stated
intent, and a directory listing).

**Convergent, blind (three independent routes, counting the orchestrator
pass):** the headline MFA conclusion misdescribes LLP 0151 v0.3 (Fable F1 =
Codex 1 = orchestrator pre-verification); the SMS implication charges 0151
with content it already contains (Fable F3 = Codex 3); Microsoft already
placed (Fable F2 ⊂ Codex 4); email-code preference already held (Fable F4 ⊂
Codex 4); guest "abandon" wording contradicts 0151's freeze/quarantine
(Fable F8 = Codex 9); Related-header hygiene, only 0151 earned (Fable F5 =
Codex 13); evidence-tag method not followed literally (Fable suggestion =
Codex 12).

**Fable-only, confirmed:** the missing 0152/0153 scope delineation (F6); the
Convex matrix/prose SMS-codes inconsistency (F7); OQ2 quietly reopening the
broker shape 0151's loop had closed. Fable also web-verified three
load-bearing vendor claims (WorkOS magic-link deprecation, Supabase
passkeys, Clerk account linking — all held).

**Codex-only, all confirmed against the tree or the document's own matrix:**

- **"Nearly every serious competitor provides [TOTP + recovery codes]" is
  contradicted by the document's own market matrix** — exactly five of
  thirteen products document both (Clerk, Auth0, Descope, Better Auth,
  Keycloak); orchestrator recount confirmed (finding 2).
- **The shared-credential production escape hatch** ("unless the deployment
  explicitly declares and accepts that posture") is unsafe by the document's
  own later argument and conflicts with 0151's Option D + pre-pinned
  conditional broker contract (finding 6).
- **The evaluation gates omit inherited requirements**: 0151's bounded
  authorization transaction and sender-constrained completion-code
  redemption, LLP 0060's hosted-admission posture, LLP 0077's issuance
  binding (finding 8).
- **"Client arms" conflates deployment arms (LLP 0093), client surfaces
  (LLP 0064), and negotiated auth profiles (LLP 0096)** (finding 7).
- **`aal1` in the config sketch implies a NIST assurance claim email-code
  auth cannot make** (finding 10); **ease rankings outrun the stated
  evidence quality**, with the Cognito "reliable" endorsement contradicting
  the document's own anecdote rule (finding 11).
- Codex also ran four primary-source spot checks (WorkOS, Stytch, NIST,
  Supabase — all held).

### Round-1 dispositions

All 21 distinct findings applied in **v0.2** (1085 lines, +12.2%, inside the
~20% budget), SHA-256
`a54aa24d8d537498d79da30c5fabacadb6fe904d7fcf685f20ab411e57ce5214`.
Substantively:

- **Summary rewritten**: the MFA challenge re-based on 0151 v0.3 (recovery
  codes tier-1 infrastructure, TOTP tier-2 — both confirmed by the market);
  the surviving challenge narrowed to the truth: 0151's factor-composition
  model "has no owner yet" and no assurance projection exists; the
  competitor claim replaced with the exact five-of-thirteen count; a
  BYOP/LLP 0153 seam bullet added; "shortest path" qualified as a
  documentation-derived hypothesis; the assurance bullet moved to neutral
  vocabulary with NIST non-equivalence stated.
- **§Implications wholly rewritten with confirms-vs-requests labels** and a
  pinned 0151 v0.3 baseline plus re-verification trigger; items 1, 3, 6, 8
  became confirmations; the real asks (composition-model owner, scanner
  semantics, passkey lifecycle scope, runtime credential-ownership
  exposure, journey declaration) stated as exact requests.
- **Production shared credentials refused outright** — only 0151's complete
  pre-pinned conditional broker contract could ever except, not a posture
  flag.
- **Gates 11 and 12 added** (inherited session-issuance and
  hosted-admission gates citing 0151/0077/0060); gate 6 split arms vs
  surfaces (0064/0096); gate 10 cites 0061.
- Guest collision rewritten to `switch_existing`/freeze/quarantine + merge
  contract; `aal1` → `single-factor`; "never email alone across provider
  installations" with LLP 0039's email-as-provider-scoped-subject note;
  Cognito "reliable" removed; Convex prose aligned; method statement now
  describes the actual prose-and-links convention; matrix recovery-count
  footnote added; Related pruned/earned (0001 dropped; 0053, 0061 added;
  every entry now body-cited); OQ1/OQ2/OQ6 corrected and OQ11–16 added
  (production-profile owner, shared credentials, declaration authority,
  0152/0153 boundary ratification, gate sequencing, WhatsApp OTP).

**Residue carried:** Codex's separate-recovery-column suggestion applied as
a matrix footnote with exact counts rather than a full column restructure
(the counts, not the layout, carried the finding); no finding refuted.

## Round 2 — 2026-08-02

Capsule: `capsule-0152-r2.md` (family-conditioned blindness — own round-1
artifact allowed, other family's and all journals prohibited; enumerates all
16 v0.2 change sites; directs scrutiny at the revision text itself; final
round per the author's two-round cap).

Target SHA-256 (v0.2, 1085 lines):
`a54aa24d8d537498d79da30c5fabacadb6fe904d7fcf685f20ab411e57ce5214`

(Results recorded below when the round completes.)

### Round 2 results

**Split verdict — Fable READY ("with comfortable margin," zero
BLOCKING/MATERIAL, two DETAIL), Codex NOT READY ("by a moderate margin," 1
BLOCKING, 2 MATERIAL, 1 DETAIL).** Both families verified the round-1
resolutions substantively (Fable: all eight of its findings plus all five
suggestions; Codex: 11 of its 13, with finding 2 not genuinely closed and
finding 8 partial). Both independently confirmed the corpus baseline still
held mid-round (LLP 0151 still v0.3; repo head advanced `67628399` →
`4f7890eb` with only LLP 0150's landing in between). Blindness held for
both (Codex transcript audit: capsule text, own permitted round-1 artifact,
and a `git status` listing only).

**The fix-introduces-defect dynamic, confirmed occurrence:** the round-1
repair of "nearly every serious competitor" replaced an unsupported
universal with a **false precise count**. The orchestrator's five-of-thirteen
figure was derived from the document's own matrix cells — and two of those
cells were wrong: Codex's primary-source audit found Stytch's *consumer*
TOTP creation returns `recovery_codes` (not B2B-only, as the matrix said)
and Appwrite documents single-use recovery codes with a recovery-code
challenge factor (the matrix said factors only). The orchestrator
re-verified both URLs before application; the count is **seven** of
thirteen. An internal-consistency check (Fable round 2 verified the count
against the matrix and passed it) cannot catch a matrix cell that is itself
wrong — only the primary-source recheck did.

**Codex's other findings, verified and applied:** gate 12 compressed LLP
0060's three admission levels (static deployment capability vs
`hostedAuthCapable` vs live admission with attestation/health/operator-
surface/direct-bearer/mixed-version requirements) into one four-item list;
gate 11 omitted 0077's per-request/connection-open sender proofs; the Best
ideas 7 fix from round 1 (added to cite LLP 0053) had assigned
session-authority transitions to 0053 when 0053 explicitly assigns them to
LLP 0039 — the same misrouting class the 0153 loop's round 1 caught in that
document, now caught in a fix here; OQ15 called proposed fixtures "existing
machinery."

**Fable's DETAILs:** four overlong lines at v0.2 edit sites; a suggested
maturity clause on gates 11–12 ("inherited, mandatory" without naming the
sources' Draft/Accepted status).

### Round-2 dispositions and loop closure

All six findings applied in **v0.3** (1109 lines, +14.7% over v0.1, inside
the ~20% budget), SHA-256
`8e180d90589f5bf3a6332eb056f761ff4316279a62ffe635a9ba54075b8a8edd`:
the count corrected to seven everywhere it appears (Summary, matrix
footnote with both source links and an explicit "recovery-code package"
definition, Stytch and Appwrite matrix cells, Appwrite prose); gate 12
expanded to 0060's complete admission conjunction in 0060's own vocabulary
with the floor marked non-exhaustive; gate 11 gains per-request proofs and
both gates now name their sources' maturity (Fable's F10); the session
bullet in Best ideas 7 split into LLP 0039 authority transitions vs LLP
0053 authorization versions; OQ15 reworded existing-vs-proposed; the four
lines re-wrapped.

**The loop closes here at the author's two-round cap.** Both families
stated no third round is genuinely required: Fable's verdict is READY with
ride-the-commit residue only; Codex's NOT READY was conditioned on exactly
the four findings above being applied and source-verified in the landing
commit, which this v0.3 does (both new vendor claims re-verified by the
orchestrator against the cited URLs before application). The remaining
residue is empirical (OQ10's bakeoff) or author-gated (OQ11–14).

**Score by origin:** round 1 — 21 distinct findings (Fable 1 BLOCKING + 2
MATERIAL + 5 DETAIL; Codex 5 BLOCKING + 6 MATERIAL + 2 DETAIL; heavy
convergence on the stale-0151 cluster, which the orchestrator's
pre-verification had independently found). Round 2 — 6 findings (Codex 1
BLOCKING + 2 MATERIAL + 1 DETAIL; Fable 2 DETAIL). Zero findings refuted
across the loop; one round-1 suggestion (separate recovery column) applied
as an audited footnote rather than a table restructure, twice-noted.

**Concurrent-tree note:** at loop close `ref-check` reports 4 errors, all
in `src/{lib,cli,embed}.rs` referencing LLP 0141 anchors — another
session's in-flight work on 0141; nothing in this loop's files.

**Proposed next step (the author decides; this loop cannot accept):** LLP
0152 remains **Draft** Research at v0.3. It is fit to serve as review
evidence in LLP 0151's loop, subject to its own §Method re-verify trigger
if 0151's Revised header moves. The author decisions it queues are OQ11–14
(production-profile owner, shared-credential posture, declaration
authority, and the 0152/0153 boundary ratification).
