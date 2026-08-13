# LLP 0252 — three-family super-refine run journal

## Authorization, bounds, and topology

- **Invoked:** 2026-08-12 by Charlie Cheever, the named human author, for
  `llp/0252-convex-familiar-authoring-profile.rfc.md` via `/llp-super-refine`.
- **Authorized variation:** the author explicitly added Grok 4.6 at xhigh as a
  third reviewing family beside the Claude and GPT families, and — by an
  explicit mid-invocation instruction — directed that the reviewing agents be
  treated as **co-authors on direction**: each round-1 review carries a
  mandatory direction assessment over the RFC's option space, and the author
  asked to be told whether the direction chosen by the document survives that
  examination ("we can take this in a variety of directions; let's make sure
  we choose the right one"). A fundamental-redesign consensus stops the loop
  for the author's ruling per LLP 0010 §2; this journal records dissent
  verbatim rather than smoothing it.
- **Families and runtimes:** Claude family — a fresh Claude Fable 5 agent
  (not the orchestrating session); GPT family — Codex CLI `gpt-5.6-sol` at
  reasoning effort xhigh; Grok family — Grok CLI 1.0.3 `grok-4.6` at
  reasoning effort xhigh. All three verified available before round 1; an
  unavailable specified reviewer stops the loop.
- **Role separation:** the orchestrating Claude session is the reviser and
  never reviews; the Claude-family review comes from a fresh agent that did
  not write any revision. Codex is a named co-author of the entering draft
  (`Author: Charlie Cheever / Codex`); its round reviews come from fresh Codex
  sessions that did not write the revision under review, the same
  fresh-instance separation used in the LLP 0250/0251 run.
- **Topology:** one single-target cluster, three families in lockstep on one
  shared capsule per round.
- **Bounds:** three rounds (skill default), six reviewer launches per family
  including voids, and approximately 20% net growth over the entering Review
  revision (40,369 bytes → ceiling ≈ 48.4 KB).
- **Status authority:** the target entered as Draft. The authorized
  `Draft → Review` transition was applied before round 1 and is this loop's
  only status transition. This run never sets Accepted or beyond; convergence
  produces a recommendation for the author.
- **Revision identity:** the target is untracked at entry, so revisions are
  bound by full SHA-256 rather than commit hash. The pre-transition Draft
  hash was not captured before the status edit; the entering-Draft bytes
  differed from r1 only by the two `Draft`→`Review` status lines. R1
  (entering Review) SHA-256:
  `01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6`,
  40,369 bytes.

## Disclosure and blindness

The human author explicitly selected OpenAI Codex (gpt-5.6-sol) and xAI Grok
(grok-4.6) as external reviewers, which authorizes sending the unredacted
target and repository review context to those services; the Claude-family
review stays within the Anthropic session. **Outbound inventory per round:**
the public tracked repository exported at the recorded base commit, the
complete unredacted target revision, and `REVIEW_INSTRUCTIONS.md`. Excluded
structurally: all `llp/reviews/0252*` artifacts, this run journal,
orchestrator notes, `.git` metadata, `.llp/` working notes,
`.agent-local-secrets.md` and every gitignored or untracked file other than
the target, credentials, runtime state, and unrelated working-tree changes.

All three reviewers execute on the shared machine where the parent checkout
remains technically readable, so capsule-only reading is additionally
instruction-enforced and self-attested; that residual is disclosed here. Web
and network access are instructed off for all three families. Reviews are
mutually blind by construction: all three launch concurrently against the
same capsule, which contains no review of this target, and artifacts are
written only outside the capsule.

## Round 1 — 2026-08-12

- **Revision r1:** SHA-256
  `01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6`
  (40,369 bytes), Status: Review.
- **Capsule base:** repository export at origin/main
  `d87d8d9a9cb0f35208c889784991ce40b2fcfe27` plus r1 target overlay;
  11,034 files, ~244 MiB; zero `llp/reviews/0252*` files present.
- **Capsule inventory SHA-256:**
  `478e66c671be06b2f0c1e89c66d22785ce6708b31b64193d1c734667eb5c1263`.
- **Instruction SHA-256 (`REVIEW_INSTRUCTIONS.md`):**
  `b8ab949dbb24d1a865631bc2a7ed0d7f7130b99bd54dec1f7864b2eefb7662cc`.
- **Lens:** standard readiness review plus the author-directed co-author
  direction assessment (Part A of the instructions), identical for all three
  families.
- **Launches:** Claude family — fresh general-purpose Fable agent, launch 1;
  GPT family — `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh
  -s read-only` in the capsule, launch 1 **failed pre-model** (capsule is not
  a git repository; codex requires `--skip-git-repo-check`), launch 2 running
  with that flag; Grok family — `grok -p -m grok-4.6 --reasoning-effort xhigh
  --disable-web-search --permission-mode auto` in the capsule, launch 1. All
  launched concurrently after this record was persisted.
- **Grok launch outcome:** FAILED — `402 Payment Required: Grok Build usage
  balance exhausted` after 12 model calls (~918k tokens, mostly cached reads)
  while reading the governing corpus; no verdict produced; recorded verbatim
  in the grok family artifact and never counted. Grok launches: 1 of 6. A
  local credential search found no alternate xAI auth path; restoring balance
  is an author action. Per LLP 0010 §2 the loop stops for the author's ruling
  once the two in-flight family reviews land: rerun grok after top-up,
  authorize dual-family continuation, or stop.
- **GPT outcome:** received and written verbatim to the codex artifact on
  receipt. **NOT READY** (5 MATERIAL, 3 DETAIL) bound to r1. Direction
  retained without dissent, with a staged narrowing proposal: server-first
  experiment with a go/no-go gate before client aliases, separate treatment
  arms for client aliases and the live-by-default policy, preregistered
  decision-eligibility rules, mechanical profile-selection enforcement, and
  same-landing amendments to LLP 0127/0130/0238. Self-attested capsule-only.
  GPT launches: 2 of 6 (1 void).
- **Claude outcome:** received and written verbatim to the claude artifact on
  receipt. **READY** (0 MATERIAL, 11 DETAIL, all altitude-dispositioned)
  bound to r1. Direction retained; the reviewer explicitly considered a
  server-only dissent and rejected it (a half-applied treatment muddies the
  readout), and flagged a portfolio caveat that the operations deficit, not
  syntax, drives the worst recorded verdicts. Self-attested capsule-only.
  Claude launches: 1 of 6.

### Round 1 result

No dual/tri-READY on r1: Claude READY, GPT NOT READY (5 MATERIAL), Grok
failed launch (payment). The two landed reviews agree on direction — keep the
parallel-profile experiment; both independently demand component-level
attribution (ablation arms / preregistered sub-attribution), preregistered
decision-eligibility rules, mechanical profile-selection enforcement, and
earlier amendments to LLP 0127/0130/0238; they diverge on altitude (codex
rates five of these MATERIAL; Claude rates the overlapping set DETAIL under
the altitude rule).

**Loop state: STOPPED for the author** — Grok, an author-specified family,
is unavailable (`402` Grok Build balance exhausted; no local alternate
credential). No revision is applied while stopped, so r1 remains the sole
reviewed revision and no unreviewed revision exists. Author options:
(a) restore Grok Build balance → rerun Grok round 1 against the same r1
capsule, then revise on all three families' input; (b) authorize dual-family
continuation without Grok; (c) end the loop, leaving r1 in Review with the
recorded verdicts.

### Author rulings — 2026-08-12

1. The author first chose (a) and topped up; the balance probe (CLI
   authenticated as the author's own account) still returned `402 Grok Build
   usage balance exhausted` on every attempt, so the credit did not reach the
   wallet the CLI draws from. Probes are not review launches; Grok launches
   remain 1 of 6.
2. The author then ruled **"skip grok for now"** — dual-family continuation
   (Claude + GPT) is authorized; Grok stays recorded as
   authorized-but-unavailable and may be re-added by a later author
   instruction.

## Revision r2 — 2026-08-12 (reviser: the orchestrating Claude session)

- **r2 SHA-256:**
  `001ed2dca02e9eb36fc096f84a6c5adffcd7bd14e49e18f8c03f082f9bd47cd8`
  (48,812 bytes). Net growth over the entering revision is +20.9%, slightly
  above the ~20% guideline after trimming; the overage is accepted and
  disclosed rather than cutting substance the round-1 reviews demanded.
- **Synthesis:** applies all five GPT MATERIAL concerns and the Claude ledger
  (C1–C11) plus its direction-serving changes (a)–(e). The one cross-family
  design fork — GPT's serial staging vs Claude's full treatment — is resolved
  with a preregistered `snapback-familiar-server-v1` ablation lane, component
  sub-attribution, preregistered disposition-eligibility rules, and
  first-class mid-period component withdrawal; the declined staging
  alternative is recorded in the document with its reasoning. Author credit
  gains Claude per the author's co-author instruction; Grok is not credited
  (no contribution received).

## Round 2 — 2026-08-12 (delta round)

- **Revision:** r2 as above. Topology: same single-target cluster, now two
  families (Claude, GPT) per the author's ruling.
- **Capsule:** APFS clone of the round-1 capsule (same base
  `d87d8d9a9cb0f35208c889784991ce40b2fcfe27`) with the r2 target overlaid and
  round-2 instructions replacing round-1's; zero `llp/reviews/0252*` files.
  A fresh export of current main was deliberately not used: main now carries
  the landed round-1 review artifacts, and re-exporting would have put them
  inside the capsule and broken blindness.
- **Capsule inventory SHA-256:**
  `62197614b6afb32a05665f6ad12aed4e5656a8694fa084dc899b0ad0840901e2`.
- **Instruction SHA-256:**
  `ebfa37e6402f9c6577f77fc8f67231003e3b2b82ae865cb613c6f6d976401a72`.
- **Lens:** delta round (r1→r2 delta enumerated in the instructions;
  IN-DELTA vs PRE-EXISTING classification required) plus a bounded
  implementer probe over the D2/D4 contracts; direction re-litigation only
  on MATERIAL defective-decision grounds.
- **Launches:** Claude family — fresh general-purpose Fable agent, launch 2;
  GPT family — same codex invocation as round 1, launch 3 (1 void). Launched
  concurrently after this record was persisted.
- **Claude outcome:** received and appended verbatim to the claude artifact
  on receipt (transport HTML-entity escapes decoded and byte-verified on
  disk). **READY** (0 MATERIAL; 11 DETAIL — 7 IN-DELTA, 4 PRE-EXISTING; all
  altitude-dispositioned) bound to r2. The implementer probe found no
  material underdetermination; the reviewer additionally verified the
  document's citations against the corpus and reports all check out except
  the "root invariants" leg of the polling-rule citation (its C3).
  Self-attested capsule-only. Claude launches: 2 of 6.
- **GPT outcome:** received and appended verbatim to the codex artifact on
  receipt. **NOT READY** (7 MATERIAL — 5 IN-DELTA, 2 PRE-EXISTING; 3 DETAIL)
  bound to r2, with one disclosed pre-instruction deviation (a generic local
  skill file read by its harness before the capsule instructions; no target
  review content; counted with disclosure). The MATERIAL set demands closed
  contracts: a per-kind required/optional/forbidden key matrix including
  actions (its #1), adapter dispositions for every existing canonical
  function fact — `refusals`, `trackedRefusals`, `sequences`, plan/action
  forms (#2, PRE-EXISTING), a total `useQuery` state-projection mapping
  (#3), a closed `useMutation` callable contract including the
  `queue: "never"` vs LLP 0218 `queue: false` lowering (#4, PRE-EXISTING),
  a `normalizedContractId` closure over all behavior-bearing fields (#5),
  benchmark-cohort semantics for mid-period component withdrawal under
  LLP 0197 (#6), and the freeze backstop present in Rollout/Acceptance (#7;
  Claude's C1 found the same placement gap as DETAIL). GPT launches: 3 of 6.

### Round 2 result

**No convergence.** Claude READY on r2; GPT NOT READY with MATERIAL concerns
including two in PRE-EXISTING text, so the delta-convergence rule does not
close the loop. Two formal bounds are now live:

1. **Sustained asymmetry** (LLP 0010 §2 terminal trigger): Claude READY on
   two consecutive revisions (r1, r2); GPT NOT READY on both. The substance
   overlaps heavily — Claude's implementer probe surfaced the same D2/D4
   underdeterminations (its C5/C7/C9/C11) and dispositioned them DETAIL
   under the altitude rule; GPT rates the same surface MATERIAL, i.e. the
   families disagree on altitude, not on the facts.
2. **Growth budget:** r2 already stands at +20.9% vs the ~20% guideline;
   revising to close GPT's MATERIAL set is estimated at roughly +3–4 KB more
   (~+30% total), so continuing requires an explicit author growth
   authorization.

One round remains in the three-round budget. **Loop stopped for the author's
ruling** with the escalation options enumerated to the author: (a) authorize
a final round-3 revision + delta round with an explicit growth allowance;
(b) close now, stay `Review`, with the asymmetry recorded and any convergence
claim scoped accordingly; (c) revert to `Draft`.

### Author ruling — 2026-08-12

The author chose **(a): final round 3 with growth authorized to roughly +30%
over the entering revision.** The reviser closes the complete GPT MATERIAL
set and both families' DETAIL ledgers in r3; round 3 is the final round of
the budget regardless of outcome.

## Revision r3 — 2026-08-12 (reviser: the orchestrating Claude session)

- **r3 SHA-256:**
  `afaff1bc43d7040bd34b81d5b90d42b0e1b345eed79776b2a663342e8c5be312`
  (53,541 bytes; +32.6% net over the entering revision, within the author's
  roughly-+30% authorization and disclosed exactly).
- **Closures:** GPT #1 → per-kind key matrix with the v1 action row pinned
  (no `ctx.db`, no reach keys, isolated Node form unsupported with routed
  refusal); #2 → Phase 0 generated per-field disposition table with a
  fail-closed completeness gate, refusal/tracked-refusal vocabulary pinned
  direct, `sequences`/plan alternates pinned unsupported; #3 → total
  normative `useQuery` state-projection table on LLP 0247's state-vs-error
  line, canonical error carrier, revocation edge pinned; #4 → closed
  `useMutation` contract on canonical `queue: false` (LLP 0218) with
  generation/typecheck rejection of queue-capable refs; #5 →
  behavior-complete `normalizedContractId` with named-exclusion rule and
  separately-named narrower witnesses; #6 → withdrawal creates a new
  configuration version, no cross-version pooling (LLP 0197), calendar
  unchanged; #7 → backstop as Phase 3 item 4 + Acceptance 9. GPT DETAILs
  8–10 and Claude C1–C11 all applied (C3 root-invariants leg dropped, C4
  ER-3 1a/1b naming in Phase 2.5, C6 normative-enumeration rule, C8
  mandatory `useQueryState`, C10 round definition, C2 per-gate
  insufficient-evidence rule).

## Round 3 — 2026-08-12 (final delta round)

- **Revision:** r3 as above. Topology unchanged (two families, lockstep, one
  capsule).
- **Capsule:** clone of the round-2 capsule (base
  `d87d8d9a9cb0f35208c889784991ce40b2fcfe27`) with the r3 target overlaid;
  zero `llp/reviews/0252*` files. Inventory SHA-256:
  `12639a4fb639b17e052b51f42aa67b58a5bb7119685214fe6adeb8291bab6b1b`.
- **Instruction SHA-256:**
  `b5adb87feca5f6254ea04c5abe902ea051038a36f675e052e15307b87780c89c`.
- **Lens:** final delta round (r2→r3 delta enumerated; IN-DELTA vs
  PRE-EXISTING required) plus the same bounded D2/D4 implementer probe.
- **Launches:** Claude family — fresh general-purpose Fable agent, launch 3;
  GPT family — same codex invocation, launch 4 (1 void). Launched
  concurrently after this record was persisted.
- **GPT outcome:** appended verbatim to the codex artifact on receipt.
  **NOT READY** (2 MATERIAL, both IN-DELTA; 3 DETAIL, all IN-DELTA; zero
  PRE-EXISTING MATERIAL) bound to r3.
- **Claude outcome:** appended verbatim to the claude artifact on receipt
  (transport HTML-entity escapes decoded; an initial heredoc-delimiter slip
  appended two stray shell lines to the artifact, removed immediately — the
  review body itself was never altered). **NOT READY** (1 MATERIAL,
  IN-DELTA; 10 DETAIL — 9 IN-DELTA, 1 PRE-EXISTING; zero PRE-EXISTING
  MATERIAL) bound to r3. The reviewer disclosed harness-injected repository
  status metadata in its context; it read no file outside the capsule.

### Round 3 result — loop converged (delta rule), final revision unreviewed

**Delta-rule convergence achieved on r3:** neither family reports any
MATERIAL concern in pre-existing text. Every remaining MATERIAL is IN-DELTA
— and both families independently converged on the same defect the r3
revision itself introduced: the `useMutation` gate referenced a
per-operation "declared queue policy" that does not exist in the canonical
model (LLP 0218's `queue: false` is a dispatch-time option; the Claude
reviewer verified the shipped guide/schemas/codegen carry no such field).
The GPT reviewer's second MATERIAL (conditional/skip consumption undecided)
was rated DETAIL by the Claude reviewer.

The round budget (3) is exhausted, so per LLP 0010 §2 the remaining in-delta
fixes take the terminal path: **applied as final revision r4, labeled
unreviewed.**

## Revision r4 — 2026-08-12 (final, UNREVIEWED)

- **r4 SHA-256:**
  `cdc724825c32fe24c488fc443c96581bfdcdb7ef76a9966f8039dfe9692ab001`
  (55,161 bytes; +36.6% net over the entering revision — the growth beyond
  the authorized ~+30% is exactly the review-demanded in-delta fixes, and is
  disclosed here rather than achieved by cutting reviewed content).
- **Fixes applied:** `useMutation` pinned as LLP 0218's dispatch-time
  settled-only convenience (the design both reviewers indicated as
  canonical-model-consistent); the phantom queue fact struck from the
  Terminology closure and the D4 ref-fact list, with a rule that any future
  per-operation queue policy (an LLP 0218/0108 amendment) would enter the
  hash; D5 routing retargeted to application-declared offline requirements;
  skip sentinel pinned `same-shape` (zero demand, projects `undefined`);
  `normalizedSchemaId` named and frozen at Phase 0; Phase 3 backstop ordered
  before the clock start; "no non-Withdraw gate" wording; matrix
  accepted-key reconciliation; action `effects` unified to
  declared-when-used with effect-free actions legal; familiar action `ctx`
  pinned to the ref-based canonical composition seam; D1 admission-check
  exemption sentence; withdrawal rounds excluded from the new
  configuration's three-round trigger; profile-fact handling named in
  Phase 0 item 6; post-throw semantics and the `delivery: "read"`
  consumption route named as Phase 2 owned work.
- **Two r4 pins are new decisions awaiting author ratification** (made along
  the line the reviews indicated but themselves unreviewed): the skip
  sentinel admitted as `same-shape`, and the familiar action composition
  seam spelled over familiar-branded refs.
- Validation at r4: `./ref-check` 0 errors; `node scripts/check-guide.mjs`
  ok.

## Final report

- **Rounds run:** 3 (the budget), plus one failed Grok launch. Launches:
  Claude 3/6, GPT 4/6 (1 void), Grok 1/6 (failed, payment).
- **Verdict binding:** the final verdicts bind to **r3**
  (`afaff1bc43d7040bd34b81d5b90d42b0e1b345eed79776b2a663342e8c5be312`):
  Claude NOT READY (sole MATERIAL = the in-delta queue-policy defect, fixed
  in r4), GPT NOT READY (both MATERIALs in-delta, fixed in r4). **A later
  unreviewed revision exists: r4** as above. Claude's r1 and r2 READY
  verdicts bind to those earlier hashes.
- **Convergence claim, scoped:** the loop converged under the LLP 0010 §2
  delta rule at round 3 — zero pre-existing MATERIAL across both reviewing
  families — with the enumerated in-delta fixes applied in unreviewed r4.
  The Grok family never reviewed any revision (authorized, unavailable:
  Grok Build balance exhausted; author ruled "skip grok for now").
  Tri-family convergence was therefore not achieved and is not claimed.
- **Direction:** both reviewing families independently retained the RFC's
  direction in round 1 with zero DIRECTION-DISSENT across all rounds; the
  round-1 staging-vs-bundling fork was resolved by the ablation-lane design
  and recorded in the document's Alternatives.
- **Proposed next step:** the document stays in `Review`. The author may
  (a) accept r4 as-is, ratifying the two flagged r4 pins; (b) commission a
  short author-authorized delta round over the r3→r4 delta to convert the
  unreviewed label into reviewed verdicts; or (c) rule on the pins
  individually. Acceptance remains the author's act alone; this loop
  recommends and does not apply it.

## Post-loop addendum — Grok independent review of r4 and revision r5

- **Grok review received (2026-08-12, recorded 2026-08-13):** the author ran
  Grok 4.6 interactively (Grok Build TUI) against landed r4 and relayed the
  result. This is an **independent Grok-family review, not a loop round**:
  the loop had closed, and the session was not capsule-blind — it read the
  existing 0252 artifacts after its corpus checks, as its own provenance
  discloses. Preserved in the grok artifact by that session. **NOT READY**
  (2 MATERIAL, 5 DETAIL) bound to r4
  `cdc724825c32fe24c488fc443c96581bfdcdb7ef76a9966f8039dfe9692ab001`;
  direction retained, no dissent. It does not alter the loop's launch
  counts or its r3-bound verdicts.
- **Orchestrator verification:** both MATERIALs were re-verified against the
  shipped code before incorporation. `packages/snapback-harness/
  ctx-bootstrap.js` defines `action.runMutation` only ("Queries are reads
  and actions must enter through runMutation") — r4's
  `ctx.runQuery(api.x.y, …)` pin invented a host op, the same phantom-fact
  class r3 caught. `guide/backend/queries.md` confirms `withIndex` is a
  name-only setter, so the D2 example's Convex range callback — present
  since the initial draft and missed by both loop families across three
  rounds — would be silently ignored by the shipped builder, dropping the
  owner filter. The skip pin's `same-shape`-vs-imported-sentinel
  contradiction is real (Convex spells the string `"skip"`).

### Revision r5 — 2026-08-13 (reviser: the orchestrating Claude session; UNREVIEWED)

- **r5 SHA-256:**
  `0ec9e231c652d55bf06cb16b6f7eb53e042673509043ad029f40d77514bea46f`
  (56,862 bytes). `./ref-check` 0 errors.
- **Applied (grok's recommended pins):** familiar action seam =
  `ctx.runMutation(api.x.y, args)` only, lowering onto the existing
  `action.runMutation` host op; `ctx.runQuery` unsupported in v1 with a
  stable routed refusal, any future query host op explicitly outside 0252;
  skip second argument closed as `Args | "skip" | typeof skip`, the string
  as familiar-only sugar over the one canonical sentinel; callback
  `withIndex` admitted as adapter sugar lowering to the canonical
  name-setter + chained filters, refuse-on-unlowerable, adversarial no-drop
  test gated in Phase 1; `useAction` closed to
  `(args) => Promise<Result>`, call-time only, canonical error carrier;
  the mutation-routing diagnostic re-triggered on real facts (always-on
  JSDoc + the offline refusal's route) with the phantom "application
  offline requirements" fact struck; the `delivery: "read"` →
  `client.read` route stated in the document; OQ1 notes the
  deletable-entrypoint withdrawal argument.
- **Verdict binding after r5:** loop verdicts bind r3; Grok's independent
  NOT READY binds r4; **r5 is unreviewed by any family.** The two r4 pins
  previously flagged for ratification are superseded by grok's review and
  the r5 pins; the r5 pins themselves (runMutation-only seam, skip closed
  set, callback-withIndex admission) await author ratification or a short
  delta review of r4→r5 — for which all three families are now available,
  since Grok works interactively even while the CLI wallet 402s.
