# LLP 0107 super-refine run journal

## Round 1 — 2026-07-28

- Authorization: Charlie Cheever explicitly requested `/llp-super-refine`
  with Fable 5 input for substantive backend-bakeoff work in this thread.
- Authorized transition: LLP 0107 moved from `Draft` to `Review` before this
  round. This loop will not move it to `Accepted` or beyond.
- Topology: independent single-target round. LLP 0012, 0034, 0053, 0064,
  0090, 0092, 0101, and 0102 are dependency context. Two fresh, mutually blind
  reviewers receive the same structurally isolated capsule.
- Target:
  `llp/0107-generated-query-group-bundle-adoption.spec.md`
- Target SHA-256:
  `ee28cbcf285f1e0d6c12370fd2da529e07e50fda1a995d58c2706b0c7d1604e7`.
- Capsule SHA-256:
  `15abe0c229ab47f0e16a472a929f33fb40e5337193db33d52ffe5140d486589b`
  (2,787 files; sorted relative-path/content-digest inventory hash).
- Transport archive SHA-256:
  `f77bb4a130bdc39e30316830b0e0a598c763db80d266b5cea2909194daeee360`.
- Instruction SHA-256:
  `b14396a7c79d37792fd49e87ce40d924773af142f0b365ad2965e65030a31b21`.
- Structural exclusion: all `llp/reviews`, this journal, Git metadata,
  orchestrator notes, ignored dependencies, build products, and runtime state
  are absent from the capsule.
- Outbound inventory: the public tracked repository at revision `92e793e7`
  plus the complete unredacted LLP 0107 target overlay. It includes the public
  governing LLPs and tracked client, React, codegen, guide, and bakeoff
  sources. It excludes every unrelated uncommitted change, `.env*`, local
  secrets, credentials, private-key formats, retained hosted runtime state,
  review artifacts, and the ignored vendored Ibex runtime.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Round budget: 3. Launch cap: 6 attempts per family. Growth budget: 20% net
  over the entering revision.
- Round status: recorded before launch.
- Round status: completed.
- Claude session: `4cad8d2c-5cdf-4230-a1f0-6308055cd88f`;
  23 turns, 2820582 ms API duration, $19.445794.
- Codex session: `019fa767-217c-75c0-aac8-73a1453464a4`.
- Artifacts:
  `llp/reviews/0107-generated-query-group-bundle-adoption.fable.md` and
  `llp/reviews/0107-generated-query-group-bundle-adoption.codex.md`.
- Both reviewers returned `VERDICT: NOT READY`. Shared material findings:
  the generated profile must inherit the 32-child bundle bound; use the
  closed register response including nullable resume and authorization
  projection; pin cross-package identity bytes and collision-free names;
  reconcile LLP 0102 parameterization, lazy child adoption, and capability
  ownership; name a real capability-only fallback signal; fence development
  identity and authority across preparation/adoption; and specify cleanup for
  every failed or abandoned ownership transition.
- Family-specific useful findings: Fable isolated the missing attach-deadline
  transition and the absent LLP 0059 owner citation; Codex isolated mixed
  `Query`/`LiveQuery` admission, commit version zero, and rollback after
  malformed post-registration responses.
- Reconciliation disposition: all shared findings and the family-specific
  ownership/cleanup findings are accepted for the round-2 revision. The
  implementation-state observations remain evidence work rather than changes
  to the architecture. LLP 0107 remains `Review`.

## Round 2 — 2026-07-28

- Authorization: the original Charlie Cheever invocation authorizes this
  second round, the same two reviewer families, and the same three-round
  budget.
- Topology: independent single-target delta round with an implementer lens.
  Both fresh reviewers receive the same structurally isolated capsule and
  the same enumerated revision delta.
- Target:
  `llp/0107-generated-query-group-bundle-adoption.spec.md`
- Target SHA-256:
  `e25182831dff5609583389823f9f86a01d410bb8ea22cb5c86d1f356f8cf3d1f`.
- Capsule SHA-256:
  `279e351166fb7702a5f201e2e935b080ba96051361fb4d0ab739e6afd38350b5`
  (429 files; sorted relative-path/content-digest inventory hash).
- Transport archive SHA-256:
  `b9f8f44ee47b412edad5467b7c4dbdcad32af972f1779ac18faef7073ae05994`.
- Instruction SHA-256:
  `c44d2fa25db7ed40779e0b8fd7552fe61463f830323d789a9e6c1aa08d85c405`.
- Structural exclusion: every `llp/reviews` artifact, this journal, Git
  metadata, orchestrator notes, ignored dependencies, build products, runtime
  state, secrets, credentials, and private-key formats are absent.
- Outbound inventory: the complete unredacted LLP 0107 target; its public
  governing LLPs; the current code, schemas, manifests, tests, guide pages,
  and Signal Desk sources needed to judge codegen, client, React, bundle,
  routes, authorization, capability, and real-adapter evidence. No unrelated
  demo, issue, diary, hosted state, environment file, local secret, credential,
  or review artifact is present.
- Claude reviewer: fresh Claude Code 2.1.220 session on the approved M4 Mac
  mini fleet lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI 0.145.0 session,
  `gpt-5.6-sol`, reasoning effort `ultra`, read-only sandbox.
- Round budget: 3. This is launch 2 of at most 6 per family.
- Round status: recorded before launch.
- Round status: completed.
- Claude session: `b289b8bd-15d1-46d7-9b9e-bfa547a1a97b`;
  28 turns, 2,332,481 ms API duration, $19.28668275.
- Codex session: `019fa7ab-c297-7e00-a998-178e7f22c0a3`.
- Artifacts:
  `llp/reviews/0107-generated-query-group-bundle-adoption.fable.md` and
  `llp/reviews/0107-generated-query-group-bundle-adoption.codex.md`.
- Both reviewers returned `VERDICT: NOT READY` and
  `PRE-EXISTING MATERIAL: NO`.
- Shared material findings: the prepared capability must be opaque to the
  application-data barrier; an expired deadline is recovery rather than
  malformed input and registered rows require positive server attach proof;
  route parameters remain strings under LLP 0092; and exact duplicate
  canonical children must refuse before positional registration.
- Family-specific useful findings: Fable isolated the lazy unadopted-frame
  race and the missing LLP 0092 request-field amendment. Codex isolated
  automatic abandoned-owner cleanup, fail-closed auth-scope classification,
  development-identity forwarding, and the need to pin public
  fallback/recovery variants.
- Reconciliation disposition: all material findings and these bounded detail
  findings are accepted. LLP 0107 now keeps rows, registrations, receipts,
  namespaces, projections, and connection ownership private; makes
  server-confirmed attach the publication gate; adds unadopted-delta
  superseding recovery; preserves string route parameters; refuses exact
  duplicate children; binds protocol/namespaces into LLP 0092; forwards dev
  identity; and bounds abandonment at the attach deadline. LLP 0107 remains
  `Review`.

## Round 3 — 2026-07-28

- Authorization: the original Charlie Cheever invocation authorizes this
  terminal third round, the same two reviewer families, and the same
  three-round budget.
- Topology: independent single-target delta round with an adversarial
  implementer lens. Both fresh reviewers receive the same structurally
  isolated capsule and the same enumerated revision delta.
- Target:
  `llp/0107-generated-query-group-bundle-adoption.spec.md`
- Target SHA-256:
  `a1cdc64d3fcdf34c4e308527b86cd2d7c7523e2b2d55a75525393ad839866b6d`.
- Capsule SHA-256:
  `334a932fa474e10e30ded51a4b135fb302a08e40e00d5cd41a2a85fddf220144`
  (429 files; sorted relative-path/content-digest inventory hash).
- Transport archive SHA-256:
  `5d83fb713a214fa8f9605d012d7ff969dece42330fed4ce9cba2c4f99e31dfc6`.
- Instruction SHA-256:
  `706ebc4f4f32f53a9ced62813c5e7dd50a870f93f1b4dad866f6867de540fa8b`.
- Structural exclusion: every `llp/reviews` artifact, this journal, Git
  metadata, orchestrator notes, ignored dependencies, build products, runtime
  state, secrets, credentials, and private-key formats are absent.
- Outbound inventory: the complete unredacted LLP 0107 target; its public
  governing LLPs; the current code, schemas, manifests, tests, guide pages,
  and Signal Desk sources needed to judge codegen, client, React, bundle,
  routes, authorization, capability, server attach, and real-adapter evidence.
  No unrelated demo, issue, diary, hosted state, environment file, local
  secret, credential, or review artifact is present.
- Claude reviewer: fresh Claude Code session on the approved M4 Mac mini fleet
  lane, `claude-fable-5`, effort `max`.
- OpenAI reviewer: fresh Codex CLI session, `gpt-5.6-sol`, reasoning effort
  `ultra`, read-only sandbox.
- Round budget: 3. This is launch 3 of at most 6 per family and the terminal
  budgeted round.
- Round status: recorded before launch.
- Round status: completed.
- Claude session: `7c755301-3207-4d38-a61a-007c01118f55`;
  29 turns, 2,483,803 ms API duration, $20.50812.
- Codex session: `019fa7ce-e087-7953-81ea-467ce4fa70cd`.
- Artifacts:
  `llp/reviews/0107-generated-query-group-bundle-adoption.fable.md` and
  `llp/reviews/0107-generated-query-group-bundle-adoption.codex.md`.
- Fable returned `VERDICT: READY` and `PRE-EXISTING MATERIAL: NO`. Codex
  returned `VERDICT: NOT READY` and `PRE-EXISTING MATERIAL: NO`, with two
  in-delta material findings: the client could not preserve pre-I/O identity
  while duplicating numeric/boolean route decoding, and the namespace
  predicate needed to remain exactly `authorityIndependent`.
- Reconciliation disposition: the second concern was corrected in LLP 0092's
  authority-classification amendment. The first concern is resolved by
  restricting V1 generated register groups to `$param` mappings whose target
  args are strings, while keeping numeric/boolean parameter routes on the
  ordinary LLP 0092 read-bundle surface. Fable's provider-custody detail was
  also accepted: transferred owner state is not reachable through public
  provider properties. The remaining Fable/Codex details are either pinned
  clarifications, implementation evidence, or pre-existing follow-up rather
  than new readiness blockers.
- Terminal review state: the authorized three-round budget is exhausted.
  LLP 0107 remains `Review`; this loop does not move it to `Accepted`.

## Post-round terminal revision (unreviewed) — 2026-07-28

- Reviewed target SHA-256:
  `a1cdc64d3fcdf34c4e308527b86cd2d7c7523e2b2d55a75525393ad839866b6d`.
- Post-round target SHA-256:
  `a5ef736263b8faecd3a0d42b06f338bb3e7c4cc6f69e0ada04f3d6b2cdc78671`.
- The post-round revision records `registerGroupEligible:true` only for
  all-LiveQuery routes whose `$param` targets are string-typed, pins the
  corresponding pre-I/O client behavior, keeps numeric/boolean routes
  bundle-readable, makes provider custody mechanically opaque, names the
  successful `101` upgrade as V1 attach confirmation, and sharpens
  empty-namespace, pre-adoption-frame, group-provenance, and terminal-disposal
  details.
- These bounded changes implement the terminal Codex material resolution and
  useful Fable details but have not received another independent review.
  Another round requires new author authorization because the budget is
  exhausted.
