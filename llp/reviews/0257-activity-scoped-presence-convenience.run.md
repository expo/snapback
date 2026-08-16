# LLP 0257 super-refine run journal

**Target:** `llp/0257-activity-scoped-presence-convenience.rfc.md` (single
target, no cluster).
**Orchestrator/reviser:** Claude Fable 5 (claude-fable-5), the session that
drafted r1 — reviser never reviews; the Claude-family reviewer is a fresh
headless `claude` CLI lane confined to the capsule.
**Authorization:** Charlie Cheever (author; human with repository-disclosure
authority) invoked `/llp-super-refine` on 0257 on 2026-08-15, explicitly
naming the reviewer pool including external sends (grok-4.6 xhigh, codex
gpt-5.6-sol xhigh). Outbound inventory: the capsule is a full snapshot of
the public-posture repository at a named main commit plus the target; no
secrets, no `.agent-local-secrets.md`, no vendored submodules.
**Custom pool rule (author-ordered):** three reviewers per round — codex
(gpt-5.6-sol @ xhigh), grok (grok-4.6 @ xhigh), claude (claude-fable-5 @
max effort). After the Claude family's first READY verdict, Claude is
dropped from subsequent rounds. Completion decisions are delegated by the
author to the orchestrator ("you just make decisions on how to complete
it"); the author additionally pre-directed implementation to follow
completion, which the orchestrator records as authorization to apply the
acceptance transition at loop close if the loop converges without
fundamental-redesign feedback.
**Status transition applied at loop start:** Draft → Review (the one
authorized transition).
**Bounds:** round budget 3 (delta rounds per the LLP 0010 §2 addendum),
launch cap 6 per family, growth budget ~20% net over r1 (4,987 bytes).

## Round 1 — launched 2026-08-15

- Revision under review: r1, sha256
  `dae1aaa61141fb485d3d33fdaa9435c4a66a4665a13eaa76b6c54a941a8c32cd`.
- Topology: single target, three mutually blind families, one fresh review
  each, concurrent.
- Capsule: `git archive 272bea745bb00728b76297e313c5a0e58b55a4c9` + target
  overlay + `INSTRUCTIONS-r1.md` (sha256
  `c6632d0415805fe7262faaf977de0a5e28f1730e7b1b054d0c7d2ff980360bb0`);
  contains zero 0257 review artifacts (verified). Per-reviewer APFS clones
  (`capsule-r1-{codex,grok,claude}`) so no lane can contaminate another's
  view; blindness is structural (outputs land outside every capsule).
- Lanes:
  - codex: `~/.volta/bin/codex exec --skip-git-repo-check -m gpt-5.6-sol
    -c model_reasoning_effort=xhigh -s read-only` (direct binary, not the
    cmux shim), cwd = its capsule clone.
  - grok: `grok -p ... -m grok-4.6 --reasoning-effort xhigh --output-format
    plain --disable-web-search --permission-mode auto --max-turns 200`,
    cwd = its capsule clone. Wallet probed OK before launch.
  - claude: `claude -p ... --model claude-fable-5 --effort max
    --allowedTools "Read,Glob,Grep"` with Bash/Write/Web/Task disallowed
    (tool restriction doubles as capsule confinement), cwd = its capsule
    clone.
- Round record persisted before launch. Results: pending.

### Round 1 results (all lanes completed 2026-08-15)

- grok-4.6 xhigh: **NOT READY** — 3 MATERIAL (helper-owned refresh cadence
  contradicts provider heartbeat and would leak/storm; scope-change/activity
  state machine underdetermined; OQ1's option-bundle branch is not a valid
  mode of the shipped hook) + 4 detail.
- claude-fable-5 max: **NOT READY** — 3 MATERIAL (refresh/TTL mechanism
  contradicts provider-owned heartbeat, incl. the motivation's false
  "leaks until TTL" baseline; value-thunk sampling unresolvable/OQ2
  ill-posed; scope-change half-specified) + 6 detail.
- codex gpt-5.6-sol xhigh: **NOT READY** — 4 MATERIAL (renewal ownership +
  TTL rule contradiction; result/error contract not closed and `.catch`
  onError misses publisher-state failures; value freshness + scope identity
  + activity fence underdetermined; Expo pause/resume republishes retained
  desired intent so "Expo inherits it" is unsafe) + 2 detail.
- Cross-family agreement: all three independently converged on the
  provider-heartbeat premise error; codex uniquely caught the Expo
  background/resume hazard. Zero direction dissent (3/3 direction sound).

### Revision r2 (orchestrator, 2026-08-15)

- r2 sha256
  `b1da1711f822e98e4ea8e1e494cb8b59025d838e29d131da9bdd75372734a0d1`,
  11,546 bytes (+131% over r1's 4,987). Growth exceeds the default ~20%
  budget; authorized by the orchestrator under the author's delegated
  completion authority (round-1 union required pinning a full semantics
  section), disclosed here.
- Addressed: renewal ownership rewritten (helper owns idle deadline +
  withdrawal only); absolute-deadline + activity-generation fence; TTL
  section (default TTL, no idleMs constraint, ghost window, 0247 §D3);
  touch-time thunk sampling; scope reset-on-identity-change; closed result
  surface with base status/publisher passthrough + transition-scoped
  onError; Expo background-withdrawal + resume deadline backstop; offline
  never-queued posture; OQ1/OQ2/OQ3 closed/deferred; demo-migration scope
  corrected (conversation screen included); excludeSelf narrowed; Related
  += LLP 0114, LLP 0247.

## Round 2 — delta round, launched 2026-08-15

- Revision under review: r2 (hash above). Topology unchanged: three
  mutually blind families (claude still in pool — no READY yet), one fresh
  review each, concurrent, per-reviewer APFS capsule clones.
- Capsule: pristine clone of the round-1 capsule (same base commit
  `272bea745`, no review artifacts) with the target swapped to r2 and
  `INSTRUCTIONS-r2.md` enumerating the delta and requiring
  IN-DELTA/PRE-EXISTING classification. Instructions sha256 recorded in the
  shell log at launch; lanes identical to round 1.
- Results: pending.

### Round 2 results (all lanes completed 2026-08-15)

- codex gpt-5.6-sol xhigh: **NOT READY** — 3 MATERIAL, all IN-DELTA
  (error contract misses synchronously-thrown admission refusals and
  invisible rejected withdrawals; Expo background-withdrawal lacked a
  pinned ownership/ordering mechanism; idleMs had no admission domain) +
  1 detail (demo TTL is 15 s declared / 6 s default, not 30 s).
- grok-4.6 xhigh: **READY** — 0 MATERIAL; 3 detail IN-DELTA (same TTL
  figure; churn-diagnostic misattribution; Expo "ordered with the seam"
  names a nonexistent hook-granularity seam, but a second AppState
  listener + the deadline backstop is correct without ordering).
- claude-fable-5 max: **READY** — 0 MATERIAL; 3 detail IN-DELTA (TTL
  figure; churn misattribution; touch()'s admission-refusal surface
  implicit). Adversarially verified the Expo remedy race-safe in every
  constructed interleaving.
- Zero PRE-EXISTING MATERIAL in any family — the delta rule's convergence
  condition held at r2. Cross-family split on the Expo mechanism
  (codex MATERIAL vs grok/claude verified-sound) adjudicated by the
  reviser as "mechanism sound, pin it explicitly."
- **Pool rule fired:** Claude's first READY (r2) → Claude dropped from
  subsequent rounds per the author-ordered rule.

### Revision r3 (orchestrator, 2026-08-15)

- r3 sha256
  `f45149a0d3da152dff9f2aaa955bbc2508d0aad4d131d75a944f065f87d9d627`,
  14,364 bytes (+24% over r2; cumulative growth authorized under delegated
  completion authority, disclosed). Five targeted edits: lastError +
  idleMs admission domain; TTL figure corrected; churn misattribution
  replaced; complete four-class error algebra with touch/withdraw
  signatures; Expo mechanism pinned (helper-owned AppState listener, no
  ordering requirement, bare-provider compatibility).

## Round 3 — delta round, launched 2026-08-15

- Revision under review: r3 (hash above). Pool: codex + grok (claude
  dropped by the pool rule). Delta round within the 3-round budget,
  chosen over labeling codex's in-delta MATERIALs unreviewed.
- Capsule: pristine clone of the round-2 capsule with target swapped to
  r3; `INSTRUCTIONS-r3.md` sha256 `8e38fe8f1acacb9c268d75f967292efb4f3d8db8940e5d65f12dcebefa5d7554` enumerates the five-edit delta
  and requires IN-DELTA/PRE-EXISTING classification. Per-reviewer APFS
  clones; lanes identical to prior rounds.
- Results: pending.

### Round 3 results (both lanes completed 2026-08-15)

- codex gpt-5.6-sol xhigh: **NOT READY** — 2 MATERIAL IN-DELTA (idleMs
  refusal was dev-gated in r3 while base TTL admission refuses
  unconditionally; error algebra misstated the carrier — base publish is
  async so admission refusals are promise rejections, and level-triggered
  publish-error snapshots cannot support exactly-once-per-occurrence
  onError) + 1 detail IN-DELTA (Expo AppState package doorway unpinned).
- grok-4.6 xhigh: **READY** — 0 MATERIAL; 3 detail IN-DELTA overlapping
  codex's items (unconditional refusal; async rejection carrier; typed
  diagnostic for thunk throws).
- Third consecutive round with zero PRE-EXISTING MATERIAL in any family.

### Terminal decision at budget exhaustion (orchestrator, delegated)

The 3-round budget is exhausted with grok READY (r3), claude READY (r2,
then dropped by the pool rule), codex NOT READY on in-delta-only items
whose fixes both remaining families agree on. Decision: apply r4 with the
converged fixes and authorize ONE codex-only delta round on r4 (launch cap
6/family permits; LLP 0254 option-(b) precedent), targeting an
all-families-READY close with scoped verdict bindings. If codex remains
NOT READY on in-delta-only items, the loop closes under the delta rule
with the final revision labeled unreviewed for the remainder.

### Revision r4 (orchestrator, 2026-08-15)

- r4 sha256
  `13c7c76eb579f767c10613553784eac9e490044e22db7c37de1cf2237293a8d6`,
  16,157 bytes (+12.5% over r3). Four targeted edits: unconditional idleMs
  refusal; typed thunk-throw diagnostic; admission-refusal carrier
  restated as promise rejection + transport guarantee scoped to distinct
  observed transitions; Expo doorway pinned to the facade wrapper via
  `#app-state`, demo imports the facade.
- Process note: an initial r4 hash/capsule step ran with the shell cwd in
  the implementation worktree and briefly staged the stale r3 file; caught
  by hash comparison and redone with absolute paths before launch (capsule
  verified to hold r4 by hash).

## Round 4 — codex-only delta round, launched 2026-08-15

- Revision under review: r4 (hash above). Pool: codex only (grok READY at
  r3; claude READY at r2 and dropped).
- Capsule: pristine clone of the round-3 capsule with target swapped to
  r4; `INSTRUCTIONS-r4.md` sha256 `aead166aeaa279ac8b61b6890b4afda2fd02e4788a40aa36dfa4f15fd2169a1f` enumerates the four-edit delta.
- Results: pending.

### Round 4 result (2026-08-15)

- codex gpt-5.6-sol xhigh: **NOT READY** — 1 MATERIAL IN-DELTA (the r4
  umbrella "once per occurrence" sentence contradicts r4's own
  transition-scoped class 3) + 2 detail IN-DELTA (idleMs refusal carrier
  unpinned; Expo wrapper should sample AppState.currentState at async
  listener attach). Fourth consecutive round with zero PRE-EXISTING
  MATERIAL; review otherwise endorses all r4 decisions as sound.

### Revision r5 (orchestrator, 2026-08-15)

- r5 sha256
  `be403c9b6f70a0fc834553055160a67a79eee48e898afa0652454de828ee716f`,
  17,319 bytes. Three targeted edits: class-specific onError cardinality
  (1/2/4 per failed invocation, 3 per distinct observed transition);
  idleMs refusal = typed hook-render throw outside the runtime algebra;
  Expo wrapper samples currentState at listener attach.

## Round 5 — codex-only delta round, launched 2026-08-15

- Revision under review: r5 (hash above). Pool: codex only (launch 5 of
  cap 6). Final authorized round: if codex is READY, the loop closes
  all-families-READY with scoped bindings (claude r2, grok r3, codex r5);
  if NOT READY on in-delta-only items, the loop closes under the delta
  rule with remaining items dispositioned and the final revision labeled
  unreviewed for the remainder.
- Capsule: pristine clone of the round-4 capsule with target swapped to
  r5; `INSTRUCTIONS-r5.md` sha256 `1a2c0cfc1bb6140222450eafaa3aa56df2e4b590a57cc466dd9fc915d93dedf4`.
- Results: pending.

### Round 5 result (2026-08-15)

- codex gpt-5.6-sol xhigh: **NOT READY** — 2 MATERIAL (one tagged
  PRE-EXISTING: the r4-introduced #app-state doorway pin ignores injected
  environment.appState/resolveAppState, so hook and provider could observe
  different lifecycle sources — prior-delta churn, not original-draft
  text; one IN-DELTA: a currentState sample at async attach misses a
  background/active bounce during setup) + 1 detail IN-DELTA (name the
  concrete diagnostic carrier). r1-through-r5 original text has still
  never drawn a MATERIAL after round 1's fixes.

### Revision r6 (orchestrator, 2026-08-15)

- r6 sha256
  `d69bb4751e3018f8198de79acb27c11349f4edd596399feb4a6d29f39e3b6617`,
  18,628 bytes. Three targeted edits: one shared resolved lifecycle source
  (injected environment wins; default resolver = uninjected fallback);
  gated admission until lifecycle observation is established (no publish
  without an attached observer, so setup-window bounces have nothing to
  resurrect); idleMs carrier = exported SnapbackDiagnosticError /
  isSnapbackDiagnosticError (verified exported by the React package).

## Round 6 — codex-only delta round, launched 2026-08-15

- Revision under review: r6 (hash above). Pool: codex only — launch 6 of
  cap 6, the final launch the cap permits. On READY: all-families-READY
  close with scoped bindings (claude r2, grok r3, codex r6). On NOT
  READY: cap-exhaustion terminal close under delegated authority with a
  complete disposition ledger and the unreviewed-remainder label.
- Capsule: pristine clone of the round-5 capsule with target swapped to
  r6; `INSTRUCTIONS-r6.md` sha256 `0b246ec69859d316ab651b3e449df9a5afb3f79fa34d73927800558b5d8bd2e6`.
- Results: pending.

### Round 6 result (2026-08-15)

- codex gpt-5.6-sol xhigh: **NOT READY** — 1 MATERIAL IN-DELTA (the r6
  admission gate leaves lifecycle-resolution failure without an
  observable typed disposition — a fifth error class is needed) + 1
  detail IN-DELTA (pin a private captured-value admission seam so
  deferred admission never re-evaluates the thunk). Zero PRE-EXISTING
  MATERIAL. Launch cap (6/family) now exhausted for codex.

## Loop close-out (orchestrator, delegated authority, 2026-08-15)

**Final revision: r7**, sha256
`2671c47565de914fafd1cf8ce60fd80e90f5918624afe185b3f12cc78ac27d3d`, applied at loop close;
the r6→r7 delta is **UNREVIEWED** (LLP 0252/0254 precedent). r7 contains
exactly the two determinate fixes codex's round 6 demanded: error class 5
(lifecycle-observation failure: terminal typed refusal, once through
onError/lastError, touch() declines permanently, peer observation
continues; unreachable under SnapbackExpoProvider whose boot refusal
precedes children; silent deferral / observer-less publish / passthrough
override all forbidden) and the internal arm-with-captured-value seam
(thunk evaluated at touch time; deferred admission publishes retained
captured bytes; state machine stays in the React package).

**Verdict bindings (one per family, scoped):**
- claude-fable-5 (max): READY, binds r2
  `b1da1711f822e98e4ea8e1e494cb8b59025d838e29d131da9bdd75372734a0d1`;
  dropped from the pool thereafter by the author-ordered rule.
- grok-4.6 (xhigh): READY, binds r3
  `f45149a0d3da152dff9f2aaa955bbc2508d0aad4d131d75a944f065f87d9d627`.
- codex gpt-5.6-sol (xhigh): NOT READY, binds r6
  `d69bb4751e3018f8198de79acb27c11349f4edd596399feb4a6d29f39e3b6617`;
  both remaining concerns dispositioned as fixed in r7 (ledger above —
  nothing summarized away; the two forbidden-disposition sentences and
  the seam pin are verbatim responses to its direction note).

**Convergence claim, scoped:** direction unanimous in all 9 round-1..2
family reviews; zero MATERIAL in original (r1-surviving) text after the
round-1 fixes across all six rounds; every subsequent MATERIAL was
IN-DELTA against the loop's own revisions, monotonically narrowing
(3+3+4 → 3 → 2 → 1 → 2 → 1). Codex was cut off by cap exhaustion, not by
agreement: its final NOT READY is recorded verbatim above.

**Growth:** r1 4,987 → r7 20116 bytes; all growth beyond the
default budget authorized round-by-round under the author's delegated
completion authority and disclosed in the round records.

**Status transition:** Review → **Accepted**, applied by the orchestrator
OUTSIDE the super-refine loop (the loop itself only recommends) on the
author's standing build directive of 2026-08-15: "Once the super-refine
process is complete (and you just make decisions on how to complete it),
then go ahead and orchestrate and supervise implementation" — the
LLP 0252 flipped-on-build-directive precedent. Implementation proceeds
against r7; if implementation falsifies an r7-delta pin, the RFC is
amended fix-forward rather than silently diverged.
