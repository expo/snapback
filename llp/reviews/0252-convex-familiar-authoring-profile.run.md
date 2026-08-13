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
