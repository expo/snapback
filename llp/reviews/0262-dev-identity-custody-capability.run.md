# LLP 0262 super-refine run journal

**Target:** `llp/0262-dev-identity-custody-capability.rfc.md`
**Invocation:** author (Charlie Cheever), 2026-08-15: three families — claude
(strongest available; drop after its first READY per author instruction),
grok-4.6 @ xhigh reasoning, gpt-5.6-sol @ xhigh reasoning. Round budget:
default 3. Reviser: orchestrating session (Claude Fable 5 — also the
document's drafting co-author; every claude-family review is a fresh blind
agent, never this session). Growth budget ~20% net over the entering
revision.
**Authorization:** document authority and external repository-disclosure
authority both from the author's direct invocation naming the external
models. Capsule outbound inventory: complete tracked tree at the Review
commit (source, LLPs, guide, demos, issues, committed logs/reports), minus
`llp/reviews/0262*`. No untracked or gitignored files
(`.agent-local-secrets.md` is untracked and therefore not in any capsule).
**Status transition applied:** Draft → Review at loop start (`fa81cd856`) —
the one authorized transition. Convergence produces a recommendation only.

## Round 1

- Round: 1 of 3. Topology: single target, three independent families,
  mutually blind.
- Capsule base: `git archive fa81cd856`, structurally excluding
  `llp/reviews/0262*` (verified zero matches post-export). One clone per
  reviewer (`capsule-r1-{claude,grok,codex}`).
- Target revision hash (sha256):
  `7f1ca7cf4d4aef28407df4591c9baac93b7deea041a8bd5f6e652a5cc265d7ab`
- Capsule hash (tar of pristine capsule-r1, sha256, first 16):
  `39f3385a0932fc02`
- Instruction file: `review-prompt-r1.md` (identical bytes to all three
  reviewers; recorded in the scratchpad run directory; sha256 recorded at
  launch in this journal's launch note).
- Reviewers/runtimes: claude = fresh blind general-purpose Fable agent
  (in-harness, capsule cwd); grok = `grok -m grok-4.6 --reasoning-effort
  xhigh --output-format plain --disable-web-search --permission-mode auto
  --max-turns 200` (wallet probe passed pre-launch); codex = `codex exec
  --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=xhigh
  -s read-only`.
- Blindness: structural (capsule excludes all 0262 review artifacts and this
  journal; journal is not landed until after round-1 receipt).
- Launch note (2026-08-15, post-record): instruction sha256 first-16
  `965e8344aca27f39`; codex pid 78686, grok pid 78701 (detached,
  start_new_session), claude = blind background agent on its capsule clone.
  Grok wallet probe returned WALLET-OK pre-launch.

### Round 1 receipt + revision r2

- Receipts 2026-08-15: claude NOT READY (3 MATERIAL), codex NOT READY
  (5 MATERIAL), grok NOT READY (2 MATERIAL) — all verbatim in the family
  artifacts. Cross-family consensus: D2 serve-time browser injection
  (defective premise + deputy exposure), D3 admin-read over-promotion;
  codex added the console-bootstrap break, the WS in-band gap, and the
  topology-matrix mismatch.
- Revision r2 (reviser: orchestrating session): browser path redesigned to
  relay-side stamping (bearer never in served content), socket path gated
  via connection-grant witness at /connection/open, D3 narrowed to
  token/console credential + console-approval carve-out + LLP 0017
  amendment pointer, topology-honest claim scoping with the named deputy
  residual, DB-sibling anchor, single refusal code, prefix registration,
  D4 truth table, D5 timing fixes, D6 corrected chokepoints/counts.
- r2 sha256 recorded below by the landing commit; growth vs entering
  revision (11,917 bytes) within budget.
- Next: round 2 = delta round, all three families (claude has not yet
  returned READY, so it remains per the author rule).

## Round 2 (delta round)

- Round: 2 of 3. Topology unchanged; all three families (claude has not yet
  returned READY).
- Target revision r2 (sha256 first-16): `22ba760d2d28b9ce` (landed
  `e9b9bd9cf`). Capsule: pristine capsule-r1 clone + r2 overlay (never
  re-exported from main; review artifacts structurally excluded, verified
  zero matches); capsule tar sha256 first-16 `13b29623e5262d06`; one clone
  per reviewer.
- Instructions: `review-prompt-r2.md`, enumerated 13-item delta with
  IN-DELTA/PRE-EXISTING + MATERIAL/implementation-phase duty; sha256
  recorded at launch below.

### Round 2 receipt + revision r3

- Receipts 2026-08-15: claude NOT READY (1 MATERIAL in-delta: anchor),
  codex NOT READY (4 MATERIAL in-delta + 1 MATERIAL PRE-EXISTING:
  refusal-path disclosure), grok NOT READY (2 MATERIAL in-delta) — verbatim
  in the family artifacts. The pre-existing MATERIAL blocks delta
  convergence at r2. Cross-family consensus: anchor triad, claim-exchange
  carve-out.
- Revision r3 (reviser: orchestrating session): anchor ladder (db sibling →
  ready-file sibling → TTY mint) + ready-descriptor advertisement;
  credential-bootstrap carve-out extended to claim-exchange with the
  bootstrap-vs-inspection rule + redemption witness; Expo topology split
  (native gated rendezvous leg incl. USB Android / web bearer-free /
  refused rows); generic network refusal with local-only path remediation;
  relay overwrite + restart re-read; clean-shutdown removal; D4
  fronted+unset = full prod semantics.
- Round 3 of 3 (final in budget) = delta round, all three families (claude
  has not yet returned READY).
