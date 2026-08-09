# Codex-family delta review — derived-fork publication C sibling-chain decoupling

## Provenance and scope

- **Reviewer family:** Codex
- **Date:** 2026-08-09
- **Prior Codex closing head:** READY at
  `7b590a169b75839847c4755bbf0d4e7ae053cadd`
- **Publication C / reviewed HEAD:**
  `866f5d025645ce20a9149d8ea20032bd2f31c9b0`
- **Target delta:** `866f5d025` (`fix(publication): decouple fork from
  sibling carriers`)
- **Complete ancestry range inspected:** `7b590a169..866f5d025` (32 commits,
  including 6 merges)
- **Scoped v3 digest:**
  `sha256:98aa92d6651e405fda750d84bd510c4db6fcccd29213b13bb0436607a39a06d0`
- **Method:** prior-chain review, commit/path census, source and control-flow
  review, independent digest reconstruction, checker and sibling-gate
  execution, direct carrier-tamper probes, and a disposable-repository
  coverage-removal attack.
- **Independence:** I read only the five prior Codex requalification artifacts
  named by the dispatch. I did not open or consult the other-family review.
  This session made no repository change and did not push.

## Overall assessment

The narrow code split itself is correctly placed. The storage publication
record still receives the exact qualification-C local-store transform check;
the derived-fork record alone stops borrowing that transform. The four sibling
paths are made visible as typed `requalificationDue` evolution, and the fork's
own anchor, carrier, receipt, evidence, canonical scope, qualification-C
digest, named-author acceptance, review-history, and ancestry checks are not
relaxed. The full checker suite and all three sibling conformance suites pass.

One blocking custody defect remains. The implementation says integrity moves
to four registered LLP 0175 gates, but the fork checker does not mechanically
admit or preserve any of those four registrations. Its C-bound policy validator
still checks only the earlier nine wave-leaf transfers. A policy that removes
all four newly named sibling gates remains valid and is accepted by
`validateDerivedForkCoverageTransfers`; after that removal, relation and
sequence carrier changes no longer select their owning drift gates. Because
post-C policy evolution is intentionally outside the fork scope and sibling
carrier evolution intentionally leaves the fork published with
`requalificationDue`, this creates the requested route for a tampered sibling
carrier to persist under a published fork claim without its transferred gate
running.

## Blocking finding

### High — the four sibling-gate custody transfers are prose-only, so coverage can vanish

The target commit adds `DERIVED_FORK_SIBLING_CHAIN_PATHS` and passes it to the
two snapshot/digest evaluations only for
`agent_safe_derived_deployment_fork_v1`. It also replaces the unconditional
local-store transform call with `validatePublishedResultCustody`, which calls
that transform only for `agent_safe_storage_v1`. Those are the intended D-4
state and storage boundaries.

The claimed replacement custody is not closed, however:

1. `DERIVED_FORK_ADMITTED_COVERAGE_GATES` contains only the four pre-existing
   wave-transfer gate definitions: `agent-safe-publication-fixtures`,
   `ci-workflow-fixtures`, `client-bundle-metrology`, and
   `local-proof-inventory`.
2. `DERIVED_FORK_COVERAGE_TRANSFERS` contains only the prior nine departed
   leaves. None of the four sibling-chain paths or newly named gate ids is
   represented.
3. `validateDerivedForkCoverageTransfers` reads the selection policy at C and
   calls `assertCoverageTransfers` only for those nine old transfers. It never
   requires `local-store-publication`, `local-store-carrier-receipt`,
   `relation-activity-publication`, or `sequence-allocation-publication` to
   exist, retain their exact record/trigger/regeneration definitions, or cover
   the four sibling paths.
4. The selection policy is deliberately outside
   `DERIVED_FORK_IMPLEMENTATION_SCOPE`; its old transfer meaning is content-
   pinned at C. The earlier checker suite explicitly proves that a different
   post-C policy is ignored by the standing fork claim. That is safe for the
   nine mechanically admitted gates, but not for these four unadmitted ones.

I re-attempted the attack in two stages.

First, against the actual policy, selection is correct:

| Changed path | Current selected drift custody |
| --- | --- |
| `src/local-persistent-store-publication.anchor.v1.json` | `guide`, `local-store-publication` |
| `src/local-persistent-store-publication.v1.json` | `guide`, `local-store-publication` |
| `src/local-relation-activity-publication.v1.json` | `guide`, `relation-activity-publication` |
| `src/local-sequence-allocation-publication.v1.json` | `guide`, `sequence-allocation-publication` |

Direct structural tampering of the relation and sequence carriers was refused
by their current gates. The complete checker suite's new local-store probe also
proved that a carrier-only structural edit selects and fails
`local-store-publication`. Thus the current records are green and the current
registrations work.

Second, I cloned C into a disposable repository and removed the four sibling
entries from `driftProneGates` and `driftFailClosedCoreGates`, without changing
the target repository. The resulting policy passed `validateSelectionPolicy`.
Calling `validateDerivedForkCoverageTransfers` with that commit and the exact
SHA-256 of its weakened policy returned all 9 old transfers successfully; the
weakened qualification commit was
`a8abf380d5f50674ad03e26eaa82558199fcd8e2`. In the same valid weakened
selection context, each sibling path selected only the unrelated `guide` drift
gate; the relation and sequence publication gates were absent.

This is not merely a hypothetical future-C issue. Starting from a correctly
published current C, a later coherent policy edit can remove or weaken these
four registrations without changing the fork snapshot, because policy
evolution is out of scope and the checker continues to validate C's policy.
A subsequent relation/sequence carrier tamper is then accepted by the new
derived-fork rule as visible `requalificationDue`, while the current selector
does not run the carrier's transferred gate. The due warning makes the source
change visible, but it does not supply the integrity custody LLP 0189 D-4 says
must never vanish.

Required resolution:

- Add an exact, in-checker admitted-custody definition for all four sibling
  gates, including record paths, carrier/anchor triggers, and regeneration
  commands.
- Validate the custody rows that are authoritative for the publication being
  checked. A post-C deletion, weakening, or trigger removal must not remain an
  irrelevant policy edit; it must either refuse or name an exact replacement
  gate in the same change.
- Add negatives for each of the four paths covering gate deletion, trigger
  removal/remapping, record substitution, and regeneration-command
  substitution, including the two-step sequence “post-C policy weakening,
  then carrier tamper.”
- Preserve the current D-4 state boundary: legitimate carrier regeneration may
  remain typed `requalificationDue`, but only while its mechanically validated
  current custody gate exists.

## Storage-record path and fork-chain bindings

The storage-record path is behaviorally unchanged. Before this delta,
`runChecker` called `validateLocalStorePublicationTransform(root,
result.commit)` for each published result. After this delta it calls
`validatePublishedResultCustody`; for a published `agent_safe_storage_v1`
result that function calls the same transform with the same `result.commit`.
The transform code itself is byte-identical. Its positive digest-only transform
fixture and both carrier/anchor extra-edit negatives passed in the 101-test
suite.

The derived-fork chain remains fail-closed at the same points:

- canonical anchor/carrier/receipt parsing and exact shapes;
- anchor-to-carrier and carrier-to-receipt digests;
- exact candidate facts, components, v3 digest version, and canonical scope;
- qualification-C selection-policy pin for the original nine transfers;
- every evidence byte digest;
- C ancestry;
- unconditional qualification-C implementation digest equality;
- platform, bounds, review-history, and named-author semantics.

`validatePublishedEvidenceSemantics` remains unconditional after snapshot and
digest evaluation. The target patch does not edit any of those validators.
The 101-test suite reran the noncanonical-scope, evidence tamper, historical
rewrite, review-chain, acceptance, wrong/nonexistent/sibling ancestry,
receipt-rotation, mode/type, gitlink, and withheld-authority negatives; all
passed.

## Fleet commit enumeration and review

The range contains 32 commits. I enumerated all of them so ancestry presence is
not confused with claim relevance.

### Scoped non-merge fleet commits

1. `5f7e262aa9` — route parity, server/schema error envelopes (`build.rs`,
   server/admin/schema-export sources). No fork runtime or chain change.
2. `8e369eaed6` — native CLI machine mode (`src/cli.rs`, `src/main.rs`). No
   change survives in `src/cli/fork.rs`; the fork command is byte-identical to
   the prior reviewed head.
3. `682441b93f` — control catalog, host-op, and auth refusal acquisition paths.
   No derived host-operation classifier or fork isolation change.
4. `a827683d24` — diagnostics registry and exact-code lookup. It evolves the
   fleet selection policy only for diagnostics; it does not alter the four
   current sibling registrations.
5. `591e7af32b` — MCP-control funnel changes in CLI/guide/server code. No fork
   lifecycle or publication-chain change.
6. `8489bdf1c0` — CLI/schema integration repairs. No fork-specific semantic
   delta.
7. `256e7404d5` — CLI review fixes plus `generation_activation`, `lib`, and
   `local` maintenance. The only fork-adjacent net CLI line is import ordering;
   no fork behavior changes.
8. `b4aa0c498d` — restores an LLP 0199 `@ref` after module ordering; comment
   only.
9. `fdb0d9b04c` — regenerates all four sibling carrier/anchor files after the
   god-file split and updates their manifest/test digest mirrors. This is the
   motivating structural regeneration; no behavior source changes in the
   commit. The three requested conformance suites are green at final C.
10. `d9f3d40468` — extracts the jobs/cron storage kernel façade and regenerates
    the same four carriers. The moved jobs bodies do not touch instance-fork
    egress, TTL, non-promotability, identity, publication ordering, or exact
    reap/drop authority. Final carrier source hashes and mirrors agree under
    all three conformance gates.

### Merge commits

- `6314d0b1b1` — reintegrates the LLP 0199 god-file split.
- `f2a6682804` — absorbs contract-types leaf and embedding visibility work.
- `ac6a07ca39` — absorbs the realtime boundary.
- `27cd852e44` — absorbs the already-reviewed derived-fork review artifacts.
- `f6c87d299b` — reintegrates the `cli.rs` split.
- `5d08a7a4cb` — absorbs the upstream carrier fix-forward.

I inspected the combined critical-path diffs for all six. None has a combined
diff in `src/instance_fork.rs`, `src/fork_promotion.rs`, `src/instance_lock.rs`,
`src/cli/fork.rs`, the fork publication checker, or the sibling conformance
gates. The final tree is exactly unchanged from `7b590a169` for the four fork
runtime/lifecycle paths. `src/manifest.rs` has no added/removed AgentSafe or
derived-fork definition in the range; its relevant changes are the regenerated
sibling mirrors and jobs/types work.

### Out-of-scope/support commits

The remaining commits are `1cebcc51e2`, `35fc38e21b`, `2b12652c03`,
`b76b72dd90`, `fce72f0819`, `8a82fc9275`, `fff7652231`, `5674a60266`,
`d9f44dec55`, `c1177e8dca`, `340eaba743`, `510689ec14`, `daffecfb9b`,
`7e1b2dd79a`, and `5df8206928`. They contain repository tooling, package/guide
metadata, generated projections, acceptance-path repair, retained reviews,
issue/LLP documentation, and Cloudflare deployment-identity refreshes. None
changes the derived-fork v3 implementation scope or the target checker logic.

The target commit `866f5d025` is reviewed separately above and is the only
commit in the range that edits `scripts/check-agent-safe-publication.mjs`.

## Digest and verification record

- Independent v3 reconstruction over 199 committed entries produced
  `sha256:98aa92d6651e405fda750d84bd510c4db6fcccd29213b13bb0436607a39a06d0`.
- Production `implementationDigestAt` produced the same value.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **101 passed, 0
  failed**.
- `node scripts/check-agent-safe-publication.mjs`: clean exit;
  `agent_safe_storage_v1:withheld` and
  `agent_safe_derived_deployment_fork_v1:withheld`.
- `node tests/conformance/local-persistent-store-publication-v1.mjs`: passed;
  published, `17 PASS / 0 GAP`, Triage `8/8`, Fleet `8/8`, carrier
  `sha256:12948f3b8d7af14ff271026b369484a0bc5c377cb0cec1e950b7bc4ef676e7c5`.
- `node tests/conformance/relation-activity-publication-v1.mjs`: passed;
  carrier
  `sha256:18ff723a6d443615e55396f01dfa86e3d35f4f9024127013a0d8afcbd50de77e`.
- `node tests/conformance/sequence-allocation-publication-v1.mjs`: passed;
  10 qualified cases, carrier
  `sha256:3beb4f1fe134c79f043d6aa3e8e4b1f33a20be8811645c553a2a0ca17e8ac315`.
- Direct disposable structural-tamper probes for relation and sequence: both
  gates refused with nonzero status. The checker suite's corresponding
  local-store tamper probe also refused.
- Weakened-policy attack: `validateSelectionPolicy` passed, while
  `validateDerivedForkCoverageTransfers` unexpectedly accepted all 9 old
  transfers after all four sibling registrations were removed.
- `git diff --check 7b590a169..866f5d025`: passed.
- `./ref-check --verbose`: 207 LLP documents, 4,802 refs in 11,354 files, 0
  errors, 0 unchecked.
- Final target worktree status: clean detached HEAD. No repository file was
  modified and no push was performed.

NOT READY
