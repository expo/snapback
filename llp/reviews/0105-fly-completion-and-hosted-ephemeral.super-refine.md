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

## Post-bakeoff delta loop, round 1 — 2026-07-28

- Authorization: Charlie Cheever explicitly requested `/llp-super-refine`
  with Fable 5 input for substantive backend-bakeoff improvements in this
  thread.
- Topology: lockstep coupled review of LLP 0104 and LLP 0105; two fresh,
  mutually blind reviewers receive the same structurally isolated capsule.
- Target SHA-256 vector:
  - LLP 0104:
    `e250ec981ab40e253aa015ec3e93b2feb3960d0ef62a9f91003c9d64a41eaee6`
  - LLP 0105:
    `861dfe6a98ba232b0ecab943e06c509b8cd9a96feb4f44db6ae0a2a54b2d887b`
- Target-vector SHA-256:
  `a33f006d3784c7a1466696a90d73e297260314e0bada023236d61482e79365cd`.
- Capsule SHA-256:
  `1bb93b1ff4838d8fe2eb8902d489a4170a67e2bc33ef35490168b85634e6633b`
  (14 context/target files; relative-path/content inventory hash).
- Instruction SHA-256:
  `b0ae0014c12ad5e3df3a948e27656e2b0a0682af6901c1c2eb0c65195147ed0b`.
- Structural exclusion: all target-specific review artifacts, both run
  journals, orchestrator notes, ignored files, credentials, and unrelated
  working-tree changes are absent from the capsule.
- Outbound inventory: complete unredacted LLP 0104 and LLP 0105 target bytes;
  context-only LLPs 0000, 0041, and 0099; the public CLI package manifest, Fly
  driver, hosted packer, hosted supervisor entry point, Rust deployment and
  manifest definitions, bakeoff comparison, first-rerun correction ticket,
  capability index, and identical review instructions.
- Claude reviewer: fresh Claude Code session, `claude-fable-5`, effort `max`,
  read-only tools, restricted to the capsule.
- OpenAI reviewer: fresh GPT-family subagent, restricted by instruction to the
  identical capsule and denied all prior-review context.
- Delta-loop budget: 3 rounds. Launch cap: 6 attempts per family. Growth
  budget: 20% net over the entering coupled target bytes.
- Claude reviewer completed in fresh session
  `c522c768-3844-4fca-9fbc-253fdccd3189` with `VERDICT: NOT READY`; its review
  is preserved verbatim in the Fable-family artifact.
- OpenAI reviewer completed in fresh subagent
  `/root/super_refine_gpt_delta` with `VERDICT: NOT READY`; its review is
  preserved verbatim in the Codex-family artifact.
- Round status: completed; author reconciliation must close candidate
  qualification/publication, served-row applicability, registry promotion,
  legacy TLS consistency/custody/recovery, CLI authority, migration decisions,
  and cleanup disposition before round 2.

## Post-bakeoff delta loop, round 2 — 2026-07-28

- Topology: lockstep coupled review expanded to the governing LLP 0041 and LLP
  0099 amendments plus LLP 0104 and LLP 0105; two fresh, mutually blind
  reviewers receive one structurally isolated capsule.
- Target SHA-256 vector:
  - LLP 0041:
    `191dac0c51287f387f924b2366e954b0c42de15d7b525ab892d10e1efda1c0b7`
  - LLP 0099:
    `fa5054f2fda1090feab2db39518931b1929858cbcf8408e733d118274c3d9cf7`
  - LLP 0104:
    `8d87fb70b2b6c01df20c101497fb515df37c85718d2ff30846c6c27e83366f19`
  - LLP 0105:
    `1ab7d800259eb3165d0c719f45494afd21e00bbbbe1674ef539ae985e02ac2c1`
- Target-vector SHA-256:
  `41b1992927f596ce169ab5ca45432c1a03012637bce865eae9a4a7c039d87d7b`.
- Capsule SHA-256:
  `436a4c126895025718a26e11e0395388233a78c07b86e66d7ca2b21a0f68786e`
  (22 context/target files; relative-path/content inventory hash).
- Instruction SHA-256:
  `d43a3c0b73e8abd4118eeb02e0b6c9aff58b30a09a7827eac998fc56277d008d`.
- Structural exclusion: all prior reviews, run journals, orchestrator notes,
  ignored files, credentials, and unrelated changes are absent.
- Outbound inventory: complete unredacted target bytes for LLPs 0041, 0099,
  0104, and 0105; context-only LLPs 0000, 0058, 0072, 0081, and 0094; the
  publisher, public CLI manifest/Fly driver/hosted packer, supervisor
  manifest/core/service/onboarding, Rust deployment/manifest definitions,
  comparison, correction ticket, capability index, and identical instructions.
- Claude reviewer: fresh `claude-fable-5`, effort `max`, read-only tools,
  restricted to the capsule.
- OpenAI reviewer: fresh GPT-family subagent restricted to the identical
  capsule and denied all prior-review context.
- Claude reviewer completed in fresh session
  `d21da6a6-5d2b-4212-ba63-5472b89b2efd` with `VERDICT: NOT READY`; it
  self-reported reading all four complete target files but not the capsule's
  context files because its read-only tool exposed no directory inventory.
  Its review is preserved verbatim in the Fable-family artifact.
- OpenAI reviewer completed in fresh subagent
  `/root/super_refine_gpt_delta_r2` with `VERDICT: NOT READY`; its review is
  preserved verbatim in the Codex-family artifact.
- Round status: completed; final reconciliation must close qualification
  transport/consumption, local publication authority, migration
  backup/admission/deadline semantics, operator root/scopes, capability-only
  revocation, and current-default npm preflight before round 3.

## Post-bakeoff delta loop, round 3 — 2026-07-28

- Topology: final lockstep review of LLPs 0041, 0058, 0094, 0099, 0104, and
  0105; two fresh, mutually blind reviewers receive one structurally isolated
  capsule.
- Target SHA-256 vector:
  - LLP 0041:
    `6f2c65b62aa254e025bd59c830a75bb397eef275f5da759cce15eab23055bcfc`
  - LLP 0058:
    `46fee422ceca3c5e4a938a34ab045a7bd2b9b7d672ccd621ce31b406efe5c38e`
  - LLP 0094:
    `73085254d7078639e894241ff8b17c4568cde15f3b20a70e90357e225b719b27`
  - LLP 0099:
    `f7017f61d68f2b6f001f4210e1af261ce2a9db316800cdb17fffda4b2dc35227`
  - LLP 0104:
    `dbe29aed9cab6c18c507d1d518ae0f59911d91c6f9ae0a097202daaf823c5e0e`
  - LLP 0105:
    `8fc1df9a3c0be1bba4d32197b57651a26718d582a0211548b5cd39553d536874`
- Target-vector SHA-256:
  `de1ae53be9eea058e1c0edac95cfcef9074354c244b60af6821bdf66080ed816`.
- Capsule SHA-256:
  `6bd369e9b91c82bd411cc48c913e493e2f23b5651acb38754383846aa8eef904`
  (24 context/target files; relative-path/content inventory hash).
- Instruction SHA-256:
  `35c89e6b9da1ac61666c520ab42660c6df40088d6400a83383e8c4d5696e9651`.
- Structural exclusion: all prior reviews, run journals, orchestrator notes,
  ignored files, credentials, and unrelated changes are absent.
- Outbound inventory: complete target bytes for the six LLPs; context-only
  LLPs 0000, 0072, and 0081; publisher, CLI, Fly driver, hosted packer,
  supervisor manifest/core/service/onboarding, Rust invocation/server/
  deployment/manifest, comparison, correction ticket, capability index, and
  identical instructions.
- Claude reviewer: fresh `claude-fable-5`, effort `max`, read-only tools,
  restricted to the capsule.
- OpenAI reviewer: fresh GPT-family subagent restricted to the identical
  capsule and denied all prior-review context.
- Claude reviewer completed in fresh session
  `11758b15-b7c0-4d98-834e-c9915aaef7fb` with `VERDICT: READY`; its review is
  preserved verbatim in the Fable-family artifact.
- OpenAI reviewer completed in fresh subagent
  `/root/super_refine_gpt_delta_r3` with `VERDICT: NOT READY`; its review is
  preserved verbatim in the Codex-family artifact.
- Round status: terminal non-convergence at the three-round delta-loop budget.
  The verdicts bind to target-vector SHA-256
  `de1ae53be9eea058e1c0edac95cfcef9074354c244b60af6821bdf66080ed816`;
  no later target revision exists.
- Protocol correction: LLP 0058 was already Accepted and therefore ineligible
  as a super-refine target. Its proposed qualification amendment must move to
  a new Draft/Review addendum before any authorized extension. This procedural
  defect is part of the author escalation, not silently waived.

## Terminal author escalation — 2026-07-28

The loop does not claim convergence. Proposed status disposition is:

- LLP 0041 remains Draft;
- LLP 0058 remains Accepted, but the unratified qualification amendment is not
  treated as an Accepted decision and should move to a new addendum;
- LLP 0094 and LLP 0099 remain Draft;
- LLP 0104 and LLP 0105 remain Review; and
- `ephemeralHostedAdapter`, `container-vm-migration-executor.v1`,
  `bounded_children_v1`, and `write_activity_v1` remain false/GAP.

Every final-round disposition is enumerated:

1. **GPT MATERIAL / IN-DELTA — pre-CAS qualification data isolation.**
   Unresolved. Author decision required between an isolated qualification
   database/restore identity and a production-data compatibility protocol.
2. **GPT MATERIAL / IN-DELTA — complete bounded-use wire/order/retention.**
   Unresolved. A Draft/Review addendum must close `QualificationUseV1`, live
   frame/reopen replay, pre-auth versus post-auth consumption, GC, and the
   exact diagnostic/status precedence matrix.
3. **GPT MATERIAL / IN-DELTA — reboot-spanning migration deadline.**
   Unresolved. A supervisor-signed boot-independent deadline or conservative
   uncertainty exhaustion must replace process-monotonic reconstruction and
   pin admission expiry plus post-publication cutoff behavior.
4. **GPT MATERIAL / IN-DELTA — enforceable provisional publication cut.**
   Unresolved. Claim families need self-expiry/finalization and monotone epochs
   rechecked at mutation commit, HTTP/frame publication, retained rerun,
   ephemeral send, and migration admission/terminal cuts.
5. **GPT MATERIAL / IN-DELTA — closed operator/root lifecycle.**
   Unresolved. Exact request variants/scopes for issuance, renewal, device
   administration, upload, root rotation/recovery, unsealing, overlap, and
   lost-response replay require a governing decision.
6. **GPT MATERIAL / PRE-EXISTING — auth-invalidation HTTP status conflict.**
   Unresolved. LLP 0058 says 503 while LLP 0094 says 400; one status/retry
   authority and cross-transport corpus must be selected in an eligible
   addendum.
7. **GPT DETAIL / IN-DELTA — hosted-ephemeral wire matrix.**
   Required in the same addendum/landing; not safe to omit despite DETAIL
   altitude because LLP 0105 promises the carrier.
8. **GPT DETAIL / IN-DELTA — capability table entries.**
   Required in the addendum/landing for the two LLP 0104 ids and publication
   predicates/maturity.
9. **GPT DETAIL / PRE-EXISTING — 0058 maturity prose drift.**
   Maintenance disposition: reconcile against the code-owned registry when
   the addendum lands.
10. **Fable DETAIL / IN-DELTA — ledger-lineage timing.**
    The safe implementation is forced: embed the candidate-ledger digest and
    validate the supervisor-supplied post-promotion ledger by
    `previousLedgerSha256`. Must be made explicit in any revised target.
11. **Fable DETAIL / IN-DELTA — `release.upload` registry row.**
    Folded into unresolved item 5; the byte-stream sub-request and deploy
    mutation need distinct exact scopes.
12. **Fable DETAIL / IN-DELTA — qualification-use/error enumeration.**
    Folded into unresolved item 2.
13. **Fable DETAIL / IN-DELTA — migration 5-second accounting and drift.**
    The batch allowance versus scheduling margin and checkpoint-only versus
    admission invalidation require exact wording with item 3.
14. **Fable DETAIL / PRE-EXISTING — superseded vocabulary.**
    Deferred consolidation remains acceptable only after the governing
    decisions converge.
15. **Fable DETAIL / PRE-EXISTING — LLP 0099 Related hygiene.**
    Add LLP 0105 when the next eligible revision is authorized.

Recommended next step: the author explicitly authorizes one corrective round
beyond the default budget; the reviser creates a new Draft addendum replacing
the ineligible LLP 0058 amendment, resolves items 1–6 plus every folded detail,
and runs two fresh mutually blind reviews on the new target vector. Until then,
the implementation may continue only on independently reviewed foundations
that cannot publish these claims; no remote promotion or sensitive
qualification/root operation is authorized by this journal.

## Author-authorized corrective round — 2026-07-28

The author then authorized exactly that corrective round and LLP 0108. The
complete frozen vector, provenance, two verbatim `NOT READY` reviews, terminal
disposition ledger, and post-round status are recorded under
`reviews/0108-qualification-and-publication-authority.{super-refine,fable,codex}.md`.
LLP 0105 remains Review; no hosted capability claim advanced.
