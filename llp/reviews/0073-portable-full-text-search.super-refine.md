# LLP 0073 super-refine run journal

## Round 1 — 2026-07-27

- Authorization: Charlie Cheever explicitly requested `/llp-super-refine` with
  Fable 5 input in this thread.
- Topology: independent single-document round; two fresh, mutually blind
  reviewers receive the same structurally isolated capsule.
- Target: `llp/0073-portable-full-text-search.rfc.md`
- Target SHA-256:
  `91ea2b86e29b16a5cb7ee31a834b56a3027dd3234d2d11dd083a40984083c8f8`
- Capsule SHA-256:
  `b0300273bf962d8cf1d1c450467e7c96f583866d47cc4e19a4cce21b1819e14c`
  (3,092 files).
- Instruction SHA-256:
  `829a93ec8bc4352d9e0d6ebc25ee2bce54ff76f4cc436ab7d335164e7741820e`.
- Structural exclusion: every
  `llp/reviews/0073-portable-full-text-search.*.md` artifact, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the whole public repository capsule at the recorded
  revision plus the complete unredacted target and review instructions; no
  ignored files, local secrets, credentials, prior reviews, or working-tree
  material outside the target are included.
- Claude reviewer: fresh Claude Code 2.1.220 session,
  `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Round budget: 3. Launch cap: 6 attempts per family. Growth budget: 20% net
  over the entering revision.
- Launch record: Codex attempt 1 exited before reading the capsule because the
  structurally isolated `git archive` has no `.git` metadata and the CLI
  required `--skip-git-repo-check`. No review was received; the attempt does
  not count toward convergence.
- Fable attempt 1 completed in session
  `b07c7590-e2e0-485d-9234-fe002899c122` after 873,664 ms with
  `VERDICT: NOT READY`. Its review is preserved verbatim in
  `0073-portable-full-text-search.fable.md`.
- Codex attempt 2 completed in fresh thread
  `019fa5f7-8e1b-7a32-918d-54f570bd3538` with
  `VERDICT: NOT READY`. Its review is preserved verbatim in
  `0073-portable-full-text-search.codex.md`.
- Both families returned NOT READY on the same target revision. The families
  remained mutually blind and independently identified the authorization,
  snapshot/cursor, accelerator, target-sequencing, and normative-surface
  defects. Round 2 is required.

## Round 2 — 2026-07-27

- Topology: independent delta round; two fresh, mutually blind reviewers
  receive the same new structurally isolated capsule.
- Target: `llp/0073-portable-full-text-search.rfc.md`
- Target SHA-256:
  `47533c1bf2270d414032993f8deaf39a4545214af08b66276dac272e8165fb2b`
- Capsule SHA-256:
  `1b1c1f120e040b2c80034839df874473fa9de8ffcdaede8b530543d5aae5b5f5`
  (3,093 files).
- Instruction SHA-256:
  `1e06817ebcc75dd3f91e12c9c5a1254cf8e7031fb86871a5058dcbdae30a9728`.
- Structural exclusion: every target-specific review artifact, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the public tracked repository at the ticket checkpoint,
  the complete unredacted Round 2 target, and delta review instructions; no
  ignored files, credentials, prior reviews, or unrelated working-tree edits.
- Reconciliation: accepted all independently corroborated material findings.
  The revision removes retained snapshots/dependency epochs and native
  acceleration; narrows visibility, sources, Boolean grammar, filters, and
  target claims; pins a complete analyzer, u32 score, work accounting,
  cursor lifecycle, result shape, and evidence matrix.
- Detail-horizon rule: reviewers may raise new detail only when introduced by
  the revision, newly visible after a material fix, or independently
  safety-relevant.
- Growth budget: the revision grew 30.2% by bytes rather than the default 20%.
  The exception is deliberate and recorded before launch: both families
  required normative Unicode-transducer, observation-boundary, cursor,
  work-accounting, and target-staging text that could not honestly be encoded
  as editorial shorthand. The design simultaneously removes broader
  projections, relational visibility, snapshots, native acceleration,
  range filters, and async claims.
- Claude reviewer: fresh Claude Code 2.1.220 session,
  `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Claude attempt 1 completed with `VERDICT: NOT READY`, but the orchestration
  transport truncated the single JSON stdout record before it could be
  preserved verbatim. The visible tail identified one MATERIAL contradiction
  between default-ignorable normalization and the worked analyzer example.
  Because LLP 0005 requires the full review body rather than a reconstruction,
  this attempt is recorded as an infrastructure-invalid delivery and is not
  used for convergence. A fresh, mutually blind attempt on the identical
  capsule follows.
- Claude attempt 2 stopped with provider HTTP 429 after 306,467 ms because the
  account reached its monthly spend limit. No review was delivered. Per LLP
  0005 it is recorded as unavailable and does not count toward convergence.
- Codex attempt 1 completed in fresh thread
  `019fa60f-83c8-7670-af1a-ca34487bb3b0` with
  `VERDICT: NOT READY`; its review is preserved verbatim in
  `0073-portable-full-text-search.codex.md`.
- Round status: stopped — the specified Fable reviewer is unavailable. The
  visible material concern from the invalid Claude delivery and the complete
  Codex review may inform a new revision, but the loop cannot converge until a
  fresh Fable delivery is available.

## Round 3 — 2026-07-27

- Topology: independent final delta round; two fresh, mutually blind reviewers
  receive the same new structurally isolated capsule.
- Target: `llp/0073-portable-full-text-search.rfc.md`
- Target SHA-256:
  `3930bc079cc8d17a69c8b486db1dbefcda54398641c3addf00484756babf3c81`
- Capsule SHA-256:
  `4c561755852a7a3ead7632fcebb1df0cdad9761b10c8475eba46fa2afe704155`
  (3,093 files).
- Instruction SHA-256:
  `26d7ae20655758a859993f7fe52298bab4bf51a0b3a2d0d692dc7a4c9419295e`.
- Structural exclusion: every target-specific review artifact, this journal,
  and orchestrator notes are absent from the capsule.
- Outbound inventory: the public tracked repository at the ticket checkpoint,
  the complete unredacted Round 3 target, and delta instructions; no ignored
  files, credentials, prior reviews, or unrelated working-tree edits.
- Reconciliation: preserved separator intent before normalization; made exact
  ranking fail closed on logical overflow; pinned field observability,
  `owner.v1`, cursor crypto/wire, deterministic highlights, operation carriers,
  semantic migration/current rollback, journal leases, and target identity.
- Detail-horizon rule: reviewers may raise new detail only when introduced by
  the revision, newly visible after a material fix, or independently
  safety-relevant.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Round budget: final round 3 of 3. Launch cap remains 6 attempts per family.
- Round status before launch: pending.
