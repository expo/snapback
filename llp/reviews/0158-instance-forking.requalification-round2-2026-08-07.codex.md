# Independent implementation review: derived-fork requalification round 2

## Provenance and disposition

- **Reviewer family:** codex
- **Date:** 2026-08-07
- **Round-1 baseline:** `review-codex.requalification-2026-08-07.md`
- **Qualification candidate C:** `622d61b9f29c18bdab3e4f0b23fa9de085eb3161`
- **Scoped implementation digest:** `sha256:f4c68ebfc0209659da01c91b30b82d2d54004e746e6683530778dc4f5413d612`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Canonical scope:** `src/`; `.gitmodules`; `Cargo.lock`; `Cargo.toml`; `build.rs`; `scripts/check-agent-safe-publication.mjs`; `scripts/generated-artifact-policy.mjs`; `scripts/local-proof-selection-policy.v1.json`; and the `vendor/ibex` gitlink.
- **Reviewed delta:** the complete scoped delta `336a605bc808a340c71407c148af450789f420ad..622d61b9f29c18bdab3e4f0b23fa9de085eb3161`, plus the out-of-scope regression fixtures added for the fixes.
- **Patch provenance:** I verified that `236545215` and `3fbbbed7d` have the same stable patch id, `19f499eb0bcfedaabc5a0cc8a68063a1cf8d1f00`; `ed21704ef` and `622d61b9f` have the same stable patch id, `9cda606046527584b09c98efc11f838bbfce0505`.
- **Independence:** I did not open or consult any concurrent round-2 review.

I independently recomputed the v3 digest at C and obtained the exact dispatched value. All three round-1 blocking findings are closed to the requested bar, and each demonstrated attack now refuses. The scoped-delta scan found one new blocking provenance defect in the v3 named-author-acceptance closure, however: the new-C acceptance is required at the retained 2026-08-06 locator and must falsely retain the 2026-08-06 acceptance line. The candidate is therefore not ready as the requalification C.

## Round-1 finding closure

### 1. CLOSED — an alternate-scope receipt refuses before review or evidence authority

`DERIVED_FORK_IMPLEMENTATION_SCOPE` now includes the transfer policy and remains a closed, sorted scope (`scripts/check-agent-safe-publication.mjs:67-80`). For a v3 derived-fork receipt, `validateReceiptShape` validates the scope and then requires canonical deep equality with that constant (`:1121-1153`). `validatePublicationRecord` invokes that check at `:2165`, before carrier authority, review parsing, evidence semantics, or digest selection. The named-author v3 contract independently requires the acceptance scope to equal both the receipt and the canonical constant (`:1997-2028`).

I reran the production-fixture substitution attack. All ten receipt cases refused with `receipt scope does not equal the canonical derived-fork scope`: deleting `src`, deleting each of the eight explicit files (including the newly scoped transfer policy and the Ibex gitlink), and substituting the otherwise valid one-file checker scope. The deliberately corrupted review/evidence binding in those fixtures never became authoritative. A separate acceptance-scope substitution also refused with `named-author/source/component acceptance drifted`. The targeted run passed 11/11.

This meets the round-1 requirement: a receipt can no longer choose a narrower digest preimage, the author record states and binds the exact classification, and a future scope edit rotates C/review/acceptance.

### 2. CLOSED — prose-only transfer metadata no longer qualifies as a frozen-record gate

The semantics-affecting `scripts/local-proof-selection-policy.v1.json` is now an explicit v3 scope file (`scripts/check-agent-safe-publication.mjs:77`). The in-scope checker carries exact admitted definitions for the four transferred gates (`:82-160`). `assertCoverageTransfers` now requires canonical equality with that authority, tracked regular-blob record paths at `HEAD`, and actual trigger-rule coverage of each departing path (`:677-735`); record prose is no longer accepted as path coverage.

I reconstructed my round-1 attack exactly in spirit: all four gate names were present, every transferred path appeared in `recordPaths` and `triggerRules.files`, but `records` was only `"not a frozen value"` and `regenerateCommand` was `"true"`. The checker refused immediately:

```text
REFUSED: agent-safe-publication: coverage transfer tests/agent_safe_publication_checker_v1.mjs is not covered by registered drift gate agent-safe-publication-fixtures
```

The fixture suite also proved deletion, record/trigger remapping, and command replacement refuse, and that a post-C policy edit invalidates the snapshot as `M:scripts/local-proof-selection-policy.v1.json`. This meets the input-closure and gate-quality bar from round 1.

### 3. CLOSED — conflicting first writers now have one accepted app-root identity

`ensure_expected_app` delegates first publication to `install_app_root_identity_sync` (`src/instance_fork.rs:192-239`). The helper writes and fsyncs a unique same-directory temporary, atomically installs the final name with a no-replace hard link, removes the temporary, and fsyncs the directory (`:1390-1473`). `AlreadyExists` reads and compares the complete winner: the same identity succeeds idempotently; a conflicting identity returns `SNAPBACK_FORK_APP_BINDING_MISMATCH`. A successful return cannot occur for both distinct identities.

I reran the exact two-party pre-install barrier attack with `app-a` and `app-b`. It passed with one accepted identity, one mismatch refusal, `mint_attempts == 1`, `launch_attempts == 1`, one destination directory, and the final identity matching the accepted writer. The full 52-test `instance_fork::tests::` filter also passed, including the deterministic same-ID barrier and the original 32-writer case.

The normal crash residue after a process dies between hard-link installation and temporary unlink is an extra complete same-inode temporary, not a second identity or partial final file; success still requires the directory fsync. I found no regression in the claimed macOS/APFS and Linux/local-filesystem operation.

## New blocking finding

### 4. High — the v3 closure backdates the fresh acceptance and requires replacing its retained historical artifact

The fix changes the accepted shape at the fixed author-evidence locator from v2 to v3 and adds the new C/digest/scope bindings, but it leaves both the locator and the asserted author line frozen to the previous publication:

- `DERIVED_FORK_EVIDENCE` still names `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json` (`scripts/check-agent-safe-publication.mjs:26-40`).
- `validateDerivedForkAuthorAcceptance` now requires `schemaVersion: snapback.derived-fork-author-acceptance.v3`, `qualifiedSourceCommit === C`, the v3 digest and scope, but also requires `authorLine === "Charlie Cheever — accepted 2026-08-06"` (`:1997-2028`).
- Candidate C was created on 2026-08-07. The currently retained file at that locator is the historical v2 acceptance for `ad0ad58748981010204b61eb5002e35b887a5093` and the ambient v2 digest.

Consequently there is no honest artifact that satisfies the checker and the requalification ticket at once. Preserving the historical bytes fails the new v3 contract. Replacing them with a v3 record for C violates the ticket's byte-retention/no-rewrite rule and represents acceptance of an August 7 commit as having happened on August 6. A truthful `accepted 2026-08-07` line is rejected. The synthetic published fixture masks this by constructing its new v3/new-C acceptance with the stale 2026-08-06 line (`tests/agent_safe_publication_checker_v1.mjs:692-718`), and the 90-test suite therefore accepts the impossible provenance.

This is a blocking defect in the new acceptance closure, not a complaint about evidence that has not been collected yet. LLP 0189 D-3/D-4 and the requalification ticket require a **fresh named-author acceptance** binding the new scope, evidence, review heads, C, and digest. The checker must be capable of admitting that truthful fresh record without rewriting the historical acceptance.

**Required resolution:** before selecting the next C, allocate a new dated v3 author-acceptance locator, preserve the 2026-08-06 v2 file byte-for-byte, and make the v3 contract carry a truthful fresh acceptance date/line. Update the synthetic publication fixture and add a negative proving that the historical locator cannot be substituted or rewritten as the new acceptance.

Related but not counted as a second delta-introduced finding: the three platform/bounds locators at `scripts/check-agent-safe-publication.mjs:27-29` are likewise fixed to 2026-08-06, while this requalification requires fresh platform evidence. Candidate commit `622d61b9f` itself files `issues/20260807-lifecycle-bench-overwrites-dated-receipt.md`, records that the fresh run overwrote the dated macOS receipt, discards that overwrite, and says the emitter must mint a new dated path. That pre-existing evidence-emitter defect should be resolved in the same append-only locator pass; otherwise this C also cannot acquire the promised fresh lifecycle evidence without rewriting history.

## Remaining scoped-delta scan

The entire scoped delta contains only:

1. the checker changes reviewed above;
2. the app-root identity helper and tests reviewed above; and
3. a comment-only clarification in `scripts/generated-artifact-policy.mjs` about exact enumeration versus content-addressed leaves.

No Cargo/build input, Ibex gitlink, or other `src/` file changed in the scoped delta. I found no other semantic regression or claim widening. In particular, finite TTL, `deny-all-v1`, non-promotable lineage, host-mediated isolation, and the explicit exclusions for process containment, public packages, hosted/remote targets, and merge-back remain unchanged.

## Execution record

- Recomputed candidate C's canonical v3 digest: exact match, `sha256:f4c68ebfc0209659da01c91b30b82d2d54004e746e6683530778dc4f5413d612`.
- Alternate-scope and author-scope targeted fixtures: 11 passed, 0 failed; every attack refused at the intended boundary.
- Direct prose-only transfer-gate attack: refused at the first transferred leaf.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 90 passed, 0 failed.
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --lib instance_fork::tests:: -- --nocapture`: 52 passed, 0 failed.
- Focused conflicting-ID barrier: 1 passed, 0 failed.
- `cargo test --test instance_fork_cli_v1 --no-run`: compiled successfully. Per dispatch, I did not run loopback-dependent tests.
- `node scripts/check-agent-safe-publication.mjs`: clean exit; both publication records correctly report `withheld`.
- CI workflow fixture: passed, 9 workflows and 44 immutable action pins.
- Local-proof inventory: 3 passed, 0 failed.
- `./ref-check --verbose`: 190 LLP documents, 4,058 refs, 0 errors, 0 unchecked.
- `git diff --check` for the scoped delta: clean.
- `cargo fmt --check` reports existing formatting drift in files such as `src/admin.rs`, `src/cli.rs`, and `src/manifest.rs` that are unchanged by `336a605bc..622d61b9f`; I do not attribute that pre-existing main-tree condition to these fixes.
- The worktree remained clean at detached candidate HEAD. I modified no repository file and did not push.

VERDICT: NOT READY
