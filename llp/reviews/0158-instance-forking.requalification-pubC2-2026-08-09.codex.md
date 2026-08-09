# Codex-family one-commit delta review — sibling-custody closure at publication C

## Provenance and scope

- **Reviewer family:** Codex
- **Date:** 2026-08-09
- **Prior Codex NOT READY head:**
  `866f5d025645ce20a9149d8ea20032bd2f31c9b0`
- **Candidate C / reviewed HEAD:**
  `04332ab8b73799bd3279b3150dbd8598df275530`
- **Target delta:** `04332ab8b` (`fix(publication): bind sibling custody
  transfers`)
- **Complete intervening range inspected:** `866f5d025..04332ab8b` (8
  commits, 0 merges)
- **Scoped v3 digest:**
  `sha256:42d8fdccbe42ed3699da014f1c3ec68aa8fd05ca99de423310b6a6885190708f`
- **Method:** prior-finding replay, one-commit source/control-flow review,
  complete intervening commit/path census, independent scoped-digest
  reconstruction, exact registry-definition review, checker and sibling-gate
  execution, and independent disposable-repository policy attacks.
- **Independence:** I consulted only my own prior Codex review at the path in
  the dispatch. I did not open or consult any other review. The review-only
  commit in the intervening range was enumerated by commit and path only. This
  session made no repository change and did not push.

## Overall assessment

The blocking custody defect is closed. Candidate C admits all four sibling
chain gates against exact definitions frozen in the claim-semantic checker,
requires every declared frozen-record blob to exist at C, and separately
requires each of the four sibling paths to match its mapped gate trigger. A
shape-valid C policy with the four registrations removed still passes the
generic selection-policy schema, but it now fails
`validateDerivedForkCoverageTransfers`; record-path, regeneration-command,
and mapped-trigger substitutions fail as well.

The closure preserves the intended LLP 0189 D-3/D-4 boundary. The four
sibling records remain visible as typed post-C `requalificationDue` evolution
instead of being re-bound to fork C. The storage publication retains its own
qualification-C transform. The fork anchor, carrier, receipt, evidence,
canonical scope, digest, acceptance, review-history, and ancestry checks are
unchanged. Integrity custody can no longer be removed from the C-bound policy
without the mechanically frozen transfer validator refusing.

The new real-HEAD positive supplies the current-policy half of the old
two-step attack. A change to
`scripts/local-proof-selection-policy.v1.json` classifies
`FAIL_CLOSED_FULL` and selects both `agent-safe-publication` and
`agent-safe-publication-fixtures`; therefore a post-C policy deletion reaches
the positive that validates that HEAD as C and fails before a later sibling
carrier change can inherit a green weakened policy. The four sibling paths
continue to select their owning gates under the real policy.

No blocking or material finding remains in this delta.

## Closure of the prior blocking finding

The implementation adds these exact claim-scoped authorities:

1. `DERIVED_FORK_SIBLING_CUSTODY_GATES` requires
   `local-store-publication`, `local-store-carrier-receipt`,
   `relation-activity-publication`, and
   `sequence-allocation-publication`.
2. `DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS` maps the persistent-store carrier
   and anchor to `local-store-publication`, and maps the relation/activity and
   sequence-allocation carriers to their respective publication gates.
3. `DERIVED_FORK_ADMITTED_COVERAGE_GATES` freezes each gate's complete
   `records`, `recordPaths`, `triggerRules`, regeneration command, and optional
   dependency fields. Canonical equality rejects a prose stub or weakened
   substitute.
4. `admittedCoverageGateAtCommit` additionally proves every declared record
   path resolves to a regular committed blob at qualification C.
5. `assertSiblingChainCustodyTransfers` requires exact equality with the four
   sibling paths, checks mapped trigger coverage, and admits all four gate
   definitions before `validateDerivedForkCoverageTransfers` can return.
6. The validator still reads the exact policy bytes at C and verifies their
   SHA-256 binding before interpreting the registry.

The receipt-only `local-store-carrier-receipt` gate is correctly required as a
chain owner without being falsely mapped as the direct recomputing owner of
the persistent carrier or anchor. The direct mappings remain with
`local-store-publication`.

## Independent attack replay

I cloned C into a disposable local repository and constructed weakened C
commits with Git plumbing, without editing the target worktree. Each mutated
policy still passed `validateSelectionPolicy`, isolating the result to the new
claim-specific checks.

| Attack | Synthetic C | Result |
| --- | --- | --- |
| Delete all four sibling gates and remove them from the drift core | `9bba794322301939f937f5ee0a2f09956d07e5ee` | Refused: persistent-store carrier is not covered by `local-store-publication` |
| Substitute the relation gate's record-path set | `78b0340472a603d432283ccb850f8925bc6d471e` | Refused: relation gate does not retain its exact registered definition |
| Substitute the sequence gate's regeneration command | `7c32db75a5095e78ddacfd13da4b49be5baa9c49` | Refused: sequence gate does not retain its exact registered definition |
| Remove the persistent-store anchor trigger | `6138c1b2cb86685b710f1e78cccdd7ed552b7b55` | Refused: anchor is not covered by `local-store-publication` |

For the all-gates deletion, selecting the policy file itself produced
`FAIL_CLOSED_FULL` and included both agent-safe checker gates. Thus the
real-HEAD positive is not an inert test: the policy change's declared affected
selection reaches it, and the same independent refusal above is its result.

The requested direct attack therefore changed from the prior unexpected
acceptance to a hard refusal.

## One-commit code and test review

The target changes only the implementation ticket, the publication checker,
and its test corpus. The admission helper is shared with the original nine
departing-leaf transfers, so the sibling closure and the earlier wave-transfer
closure now use one exact-definition-and-record-existence predicate. The
sibling check intentionally omits the original transfer rule that a path must
leave the implementation scope: these four paths remain scoped evolution, as
LLP 0189 requires.

The added negatives cover deletion of each required gate and trigger removal
for each mapped sibling path. The new real-HEAD test validates the complete
current policy at the actual C. The fixture copies every sibling gate's record
paths into its synthetic qualification repository, preventing the positive
from succeeding merely because record existence was never exercised. Existing
exact-definition tests continue to cover record, trigger, and regeneration
substitutions for the shared admission predicate; the independent attacks
above exercise those substitutions against sibling gates specifically.

No fork publication-chain validator was relaxed. The only return-value change
in `validateDerivedForkCoverageTransfers` is local: it retains the public
nine-transfer return while requiring sibling custody as a side condition.

## Intervening fleet commit enumeration and review

I enumerated every commit in `866f5d025..04332ab8b` so ancestry presence is
not confused with claim relevance.

1. `f940bc62a` — LLP/issue documentation for the withdrawn 0207 program and
   owner follow-ups. Outside the derived-fork D-4 scope.
2. `96d50a742` — the only other commit that changes the derived-fork scoped
   source tree. It moves asset publication maintenance, GC, and runner
   transaction bodies from `src/local.rs` into the typed
   `src/storage/asset_maintenance.rs` kernel, adds the façade in
   `src/storage.rs`, and refreshes the four sibling carriers plus their
   manifest/conformance digest mirrors. It does not change
   `src/instance_fork.rs`, `src/fork_promotion.rs`, `src/instance_lock.rs`, or
   `src/cli/fork.rs`. The `src/manifest.rs` diff is confined to refreshed
   sibling carrier/source hashes. All three affected publication conformance
   gates pass at final C.
3. `2d6701196` — filesystem issue for the pre-existing asset-store environment
   race. Documentation only and outside scope.
4. `49c2ad3a` — ownership manifest/baseline assignment. Outside the exact
   derived-fork scope.
5. `147f4e2d4` — ownership-ratchet filesystem issue. Documentation only and
   outside scope.
6. `4050dc8da` — retained review artifacts only. Enumerated from commit/path
   metadata; no review body was opened or consulted, per the dispatch.
7. `9d83959b6` — authored-symbol lifecycle facts, generated reference material,
   and publish-tooling enforcement. It does not touch `src`, the derived-fork
   checker, the scoped generated-artifact policy, Cargo/build inputs, or the
   Ibex gitlink, so it is outside this claim's exact D-4 digest.
8. `04332ab8b` — the sibling-custody closure reviewed above. Its checker edit
   is claim-semantic and is included in the recomputed v3 digest.

There are no merge commits in the range. The final tree has no change from the
prior NOT READY head in the four critical fork runtime/lifecycle paths named
above.

## Digest and verification record

- Independent reconstruction over 200 committed scoped entries produced
  `sha256:42d8fdccbe42ed3699da014f1c3ec68aa8fd05ca99de423310b6a6885190708f`.
- Production `implementationDigestAt` produced the same value.
- Qualification-C selection-policy bytes hash to
  `sha256:9221291f95c690d455be3240b342010216b7e1b470cf21aba53104408a3f9075`.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **104 passed, 0
  failed**, including all new custody cases.
- `node scripts/check-agent-safe-publication.mjs`: clean exit;
  `agent_safe_storage_v1:withheld` and
  `agent_safe_derived_deployment_fork_v1:withheld`.
- `node tests/conformance/local-persistent-store-publication-v1.mjs`: passed;
  published, `17 PASS / 0 GAP`, Triage `8/8`, Fleet `8/8`, carrier
  `sha256:827f04914e509bca758b08e6762ad061b0d814f01ceed10933f25f7f113818db`.
- `node tests/conformance/relation-activity-publication-v1.mjs`: passed;
  carrier
  `sha256:4a5084411c2f2c5f03bcdc50757ffe5c4cf94f4816a844b6634b41020df1b8a9`.
- `node tests/conformance/sequence-allocation-publication-v1.mjs`: passed; 10
  qualified cases, carrier
  `sha256:46b0fa02b2b10239028db3b043584d9b05e1fc4070ebc9fe485463616ff88470`.
- `./ref-check --verbose`: 208 LLP documents, 4,810 refs in 11,365 files, 0
  errors, 0 unchecked.
- `git diff --check 866f5d025..04332ab8b`: passed.
- Final target worktree status: clean detached HEAD exactly at candidate C.
  No repository file was modified and no push was performed.

READY
