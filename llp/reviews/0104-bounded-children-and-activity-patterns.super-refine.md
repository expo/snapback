# LLP 0104 super-refine run journal

## Round 1 — 2026-07-27

- Authorization: Charlie Cheever explicitly requested
  `/llp-super-refine` with Fable 5 input for substantive backend-bakeoff work
  in this thread.
- Topology: independent single-document round; two fresh, mutually blind
  reviewers receive the same structurally isolated capsule.
- Target: `llp/0104-bounded-children-and-activity-patterns.spec.md`
- Target SHA-256:
  `22e8cb22bb3ba0a3afca3939805ed66d05c457119b2fdbd60f4c4a3a561751a5`
- Capsule SHA-256:
  `a148115ddd1ab630d02975cb23203f16cf96107ad2cc0d4391152d0e5670626b`
  (3,094 files).
- Instruction SHA-256:
  `51d1c9d777d26e9cfa197feffac847e5ebb89da785fe66e926eaeadc77a94ee5`.
- Structural exclusion: every target-specific review artifact, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the public tracked repository at the ticket checkpoint
  and the complete unredacted target; no ignored files, credentials, prior
  reviews, or unrelated working-tree edits.
- Claude reviewer: fresh Claude Code 2.1.220 session,
  `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Round budget: 3. Launch cap: 6 attempts per family. Growth budget: 20% net
  over the entering revision.
- Claude attempt 1 stopped with provider HTTP 429 after 1,910 ms because the
  account reached its monthly spend limit. No review was delivered. Per LLP
  0005 it is recorded as unavailable and does not count toward convergence.
- Round status: stopped for the Fable family; the Codex review may complete
  and inform revision, but the loop cannot converge until a fresh specified
  Fable reviewer is available.
- Codex attempt 1 completed in fresh thread
  `019fa620-93be-74a1-bc59-68f9c4c6c582` with
  `VERDICT: NOT READY`; its review is preserved verbatim in
  `0104-bounded-children-and-activity-patterns.codex.md`.
- Claude retry completed on the approved M4 Mac mini fleet lane in session
  `62d6b66a-2708-4237-b156-66460ce3d479` with `VERDICT: NOT READY`; its review
  is preserved verbatim in the Fable-family artifact.

## Round 2 — 2026-07-27

- Topology: independent delta round; two fresh, mutually blind reviewers
  receive the same structurally isolated capsule.
- Target: `llp/0104-bounded-children-and-activity-patterns.spec.md`
- Target SHA-256:
  `cd2afe4fc61320a1f8df6e335c4a8866d20fb725ccf76fb26c9d76d95a2baa4d`.
- Capsule SHA-256:
  `edd205f69e081c9094209337a99f9500f63454ae4c45583d19330f0a17cc1481`
  (3,094 files; relative-path/content inventory hash).
- Instruction SHA-256:
  `172db757f8a00b334f9dd6a12ef9c139acd6688e62c7aea5e5a0e35cc1629d19`.
- Structural exclusion: every target-specific review artifact, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the public tracked repository at the ticket checkpoint,
  the complete unredacted target, and delta instructions; no ignored files,
  credentials, prior reviews, or unrelated working-tree edits.
- Reconciliation: point-only relationship-guarded primary effects, inherited
  settlement identity/replay, public-read coverage, exact type/gate/live rules,
  delegated provenance, result-contract dependency, quantitative ceiling, and
  committed product/comparator/codegen prerequisites.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Claude reviewer completed in fresh remote session
  `a31f4775-ea16-47e8-84cc-daa370413564` with `VERDICT: NOT READY`; its
  review is preserved verbatim in the Fable-family artifact.
- Codex reviewer completed against the same immutable capsule with
  `VERDICT: NOT READY`; its review is preserved verbatim in the Codex
  artifact.
- Round status: completed; author reconciliation required before round 3.

## Round 3 — 2026-07-27

- Topology: final independent delta round; two fresh, mutually blind reviewers
  receive the same structurally isolated capsule.
- Target SHA-256:
  `a6d7fbb38611ab7e555b55848bc88e126e16e4655008497907a902f40d211136`.
- LLP 0101 dependency SHA-256:
  `bd1bb9aaaa4f9c9015039d09a716add5ea86dbc442d0954ff49b11931e9fb3ac`.
- Capsule SHA-256:
  `59e2c65a8e33f963c2048bfb66e07558b1d14a313e4f770a2ae808b5d32d7cf7`
  (3,095 files).
- Instruction SHA-256:
  `5b20a61c32ad26cf32099bd7b52d3b106342f7944bb8429188e1bfb94c613191`.
- Reconciliation: protected relation registry and stamping, current-bound
  encrypted cursor, exact authority provenance, total effect formulas,
  projection/uniqueness refusal, and complete first-publication evidence.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Claude reviewer completed in fresh remote session
  `12b57214-0475-4fbf-b5a9-64318969ba82` with `VERDICT: NOT READY`; its review
  is preserved verbatim in the Fable-family artifact.
- Codex reviewer completed in a fresh local CLI session with
  `VERDICT: NOT READY`; its review is preserved verbatim in the Codex artifact.
- Round status: completed at the three-round budget; convergence is not
  claimed. The implementation landing must retain Review/unadvertised status
  while reconciling every final relation-lifecycle, noninterference, cursor,
  result-correlation, provenance, quantitative-effect, and settlement-evidence
  concern in a complete disposition ledger.
