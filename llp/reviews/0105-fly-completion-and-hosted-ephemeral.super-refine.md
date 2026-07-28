# LLP 0105 super-refine run journal

## Round 1 — 2026-07-27

- Authorization: Charlie Cheever explicitly requested `/llp-super-refine`
  with Fable 5 input for substantive backend-bakeoff work in this thread.
- Topology: independent single-document round; two fresh, mutually blind
  reviewers receive the same structurally isolated capsule.
- Target: `llp/0105-fly-completion-and-hosted-ephemeral.plan.md`
- Target SHA-256:
  `5b106fe0dcbdee00b3727d1442d8033ca3f214a3a8b74009f2f92445c01fe31d`.
- Capsule SHA-256:
  `07aa9f210dd98c5ba7803ab963cf21270abdeffb54fcf9f93d4cb6aa035cd06e`
  (3,094 files; relative-path/content inventory hash).
- Instruction SHA-256:
  `9f68f158fd2807c25e5bddec20be40953470728bff2102502109d9d828dff8ce`.
- Structural exclusion: every target-specific review artifact, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the public tracked repository at the ticket checkpoint,
  the complete unredacted target, and review instructions; no ignored files,
  credentials, prior reviews, or unrelated working-tree edits.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Round budget: 3. Launch cap: 6 attempts per family. Growth budget: 20% net
  over the entering revision.
- Claude reviewer completed in fresh remote session
  `4b7e6733-4fca-4608-b6d8-4e5581116c48` with `VERDICT: NOT READY`; its
  review is preserved verbatim in the Fable-family artifact.
- Codex reviewer completed against the same immutable capsule with
  `VERDICT: NOT READY`; its review is preserved verbatim in the Codex
  artifact.
- Round status: completed; author reconciliation required before round 2.

## Round 2 — 2026-07-27

- Topology: independent delta round; two fresh, mutually blind reviewers
  receive the same structurally isolated capsule.
- Target SHA-256:
  `0f7821dc7919abf69441d59efdce93a6f5b913b525a48676d0a710f8ae7fcf5a`.
- Capsule SHA-256:
  `fc466535fd68c2ccd57b6da2b02c2f6cb2dc0eb4d981a6981842ec0e5a6c9337`
  (3,094 files).
- Instruction SHA-256:
  `6477ff4e3c091e39585f6aa255969e18828c3f05e8ef6daac36218e5ee620f35`.
- Reconciliation: complete Fly binding; expiring machine admission; opaque
  authority wire; exact lifecycle v2; downtime restore; TLS replacement
  classes; online admission; role custody; raw evidence; packed OCI journey;
  spend authority and closed cleanup.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Claude reviewer completed in fresh remote session
  `10d9c1e3-0529-4ad0-b33d-e64e282f8229` with `VERDICT: NOT READY`; its review
  is preserved verbatim in the Fable-family artifact.
- Codex reviewer completed in a fresh local CLI session with
  `VERDICT: NOT READY`; its review is preserved verbatim in the Codex artifact.
- Round status: completed; author reconciliation in the closed hosted-v2
  section fixes vocabulary, carriers, supervisor/head authority, wire rollout,
  spend/cleanup, TLS transition, and comparator sequencing before round 3.

## Round 3 — 2026-07-27

- Topology: final independent delta round; two fresh, mutually blind reviewers
  receive the same structurally isolated capsule.
- Target SHA-256:
  `60bf43edb12c99a784a48f6fbd6f3b6130316107dafcc585d3a82d38ea82b03f`.
- Capsule SHA-256:
  `f9d60997ef75683ce968867c6909dbf695eefe7663a24ff866310c2ff2d97c14`
  (3,096 files; relative-path/content inventory hash).
- Instruction SHA-256:
  `9f65e59a46c426975af9b30cb631d53b12e62d09acc7ece6d802f90dba2fab0c`.
- Structural exclusion: all target-specific review artifacts, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the public tracked repository at the ticket checkpoint,
  the complete unredacted target, and the same-landing comparator command,
  schema, test, CLI integration, and guide page. No ignored files,
  credentials, secrets, prior reviews, or unrelated working-tree changes are
  included.
- Reconciliation target: exact v1/additive-v2 operations and effect journal;
  packaged always-on supervisor and single-writer head; four-way wire rollout;
  durable spend/cleanup ledger; same-origin TLS handoff; comparator prerequisite.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Claude reviewer completed in fresh remote session
  `f91b00c2-897b-4219-a5b4-9907309cc604` with `VERDICT: READY`; its review is
  preserved verbatim in the Fable-family artifact.
- Codex reviewer completed in a fresh local CLI session with
  `VERDICT: NOT READY`; its review is preserved verbatim in the Codex artifact.
- Round status: completed at the three-round protocol maximum. The final
  author reconciliation closes the routed-health, supervisor recovery,
  bootstrap/spend, recipient key custody, Contract carrier, staging, migration
  identity, byte-path, and replay-floor findings. That reconciliation has not
  received another independent review, so the plan remains Review and hosted
  capability evidence remains unavailable until the full executable gate
  passes.
