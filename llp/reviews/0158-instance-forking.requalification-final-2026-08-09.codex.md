# Codex-family final delta review — derived-fork requalification

**Date:** 2026-08-09  
**Reviewer:** Codex-family reviewer  
**Candidate C:** `772c00649534d68b2ba63b98699e8ce2b2019057`  
**Prior reviewed head:** round 3 READY at `03f9d147c`  
**Policy-custody pivot:** `dcdcdc4be45f45fed622a90985097ed7b5d9f336`

## Verdict

I found no blocking regression in the final delta. The content-pin alternative now meets the bar stated in round-1 finding 2: post-C working-tree policy changes cannot change the transfer verdict or invalidate the scoped implementation digest, while a receipt pin that does not equal the qualification-C policy bytes is refused. The subsequent 144-commit fleet delta preserves the derived-fork invariants under review.

This review is independent. I consulted only my own prior round-1 through round-3 review artifacts in `/Users/ccheever/projects/requal-reviews/`; I did not consult another concurrent final review.

## Review basis

I confirmed the checked-out Snapback `HEAD` is exactly C. The range `dcdcdc4be..C` contains 144 commits and changes 48 files in the canonical derived-fork implementation scope, with 8,692 insertions and 1,209 deletions. The largest fork-adjacent raw diffs are:

| File | Raw delta | Classification after whitespace/semantic review |
| --- | ---: | --- |
| `src/cli.rs` | +746/-220 | Predominantly the `2844b8f75` repository-wide formatter sweep plus unrelated CLI fleet work; the relevant semantic change is constrained minted-token discovery. |
| `src/instance_fork.rs` | +130/-95 | Predominantly formatting; semantic changes are ordinary-error staging cleanup, one copied custody table, enum field accounting, and request-local mutation-settlement admission. |
| `src/fork_promotion.rs` | +60/-13 | Store-inventory visibility plus damaged-expired-branch reap self-healing. |
| `src/instance_lock.rs` | +32/-1 | Owner-only, descriptor-relative creation of an absent ordinary-startup instance directory. |

The governing constraints I used are LLP 0158's closed runtime plane and publication/lifecycle protocol, LLP 0164's strict fork-class separation and non-promotability, LLP 0165's authorizer-backed host-mediated isolation boundary, LLP 0185's finite managed lifecycle, and LLP 0189 D-3/D-4's claim-scoped and content-pinned qualification model.

## 1. Content-pin custody versus round-1 finding 2

### Recomputed identities

Using `implementationDigestAt` from `scripts/check-agent-safe-publication.mjs` at C, I independently recomputed:

`sha256:53e85a9f1958bcba44ceac12c24e70608b79ae9eeb47871bdd405fc6db796b75`

This exactly matches the expected v3 scoped digest. The exact C bytes of `scripts/local-proof-selection-policy.v1.json` hash to:

`sha256:405464036917695c3007f449d6e9f8272efa04822b0d62fa9b0f55b47b4e9c32`

### Custody analysis

The selection policy is deliberately outside `DERIVED_FORK_IMPLEMENTATION_SCOPE`, but is no longer ambient input:

- A derived-fork v3 receipt has an exact `selectionPolicySha256` field (`scripts/check-agent-safe-publication.mjs:1192-1235`).
- The named-author v3 acceptance has the same exact field and must equal the receipt (`:2100-2133`).
- Transfer validation requires a 40-hex qualification C and a canonical SHA-256 pin, reads the policy with `git show C:path`, hashes those bytes, refuses a mismatch, parses only those C-bound bytes, and evaluates transfers with `recordCommit: C` (`:760-797`).
- Published-record validation invokes that transfer validation using the carrier's qualified source commit and the receipt pin before accepting evidence (`:2261-2321`).
- The in-checker admitted-gate mirror still prevents a shape-valid prose stub from impersonating a canonical frozen-record gate (`:99-103` and the associated gate validation).

### Attack re-attempts

I re-ran the attacks in disposable checker fixtures rather than modifying the Snapback checkout:

1. Replacing the post-C working-tree policy with different valid policy bytes did not change the C-bound transfer result (`9` transfers), did not alter the scoped implementation digest, and did not invalidate the standing claim snapshot.
2. Supplying a receipt pin of `sha256:` followed by 64 `e` characters was refused with the expected qualification-C digest-mismatch diagnostic; the checker reported the actual C digest above.
3. The focused tests for C-bound validation, exact receipt/author pinning, and post-C out-of-scope policy evolution all passed.
4. The complete publication-checker test file passed: 97 tests, 0 failures.

This satisfies the alternative explicitly allowed by round-1 finding 2. Policy semantics are bound by content and source commit even though the selector file is not part of the implementation tree digest.

## 2. Fork-surface fleet delta

### Deny-all and host-mediated isolation

The derived host-op classifier remains exhaustive and fail-closed: an unknown operation maps to `UnclassifiedHostOperation`. The only new locally admitted operation is `mutation.settlement` (`src/instance_fork.rs:2157-2189`). Its implementation is a read-only projection of the current mutation request's client mutation identity and settlement digest; it creates no external effect and is refused for query/action contexts. No new fetch, stream, push, job-enqueue, telemetry, asset-provider, or unclassified initiation path was added.

The copied `_snapback_job_idempotency_tombstones_v1` custody row transfers durable state, not job authority; the fork runtime continues to deny job initiation. New store-export work refuses derived lineage rather than creating an escape. The admin-token discovery change accepts only the mechanically expected token path from a trusted readiness descriptor and reads only an owner-only regular file (`src/cli.rs:6589-6630`); it discovers an already minted fork-local credential and does not widen runtime authority.

The real-VM integration `instance_fork_vm_egress_v1` passed, confirming JavaScript actions still cannot fetch or stream through the actual VM on a fork. This remains host-mediated registered-connection isolation, not a claim of process or OS containment, consistent with LLP 0165.

### Finite TTL and non-promotability

Finite expiry stamping, boot refusal at expiry, renewal ceilings, and the explicitly non-promotable lineage write remain intact. The fleet delta does not introduce a path that clears the TTL or promotes a derived deployment. The 52 focused `instance_fork::tests` and 38 focused `fork_promotion::tests` include the expiry, renewal, strict class, and promotion-refusal matrices and all passed.

### First-writer-wins identity

The round-2 repair remains semantically unchanged. `install_app_root_identity_sync` writes and syncs a unique temporary file, attempts a no-replace hard link, and makes a losing writer compare the already-published complete bytes (`src/instance_fork.rs:1396-1450`). The concurrent same-identity and conflicting-first-writer tests remain present and passed. I found no return to replace/last-writer-wins behavior before mint or launch.

### Atomic evidence and publication

The S0-S5 publication sequence remains ordered: staging sentinel, cloned/scrubbed state, durable mint evidence and private assets, registry intent, atomic directory rename, parent sync, registry finalization, then sentinel removal. Commit `a646bb71a` wraps publication in a result boundary and removes the staging directory on ordinary errors while preserving injected crash cuts (`src/instance_fork.rs:4631-4752`). This closes credential-bearing staging residue without erasing crash-recovery evidence. A new asset-copy failure test exercises that cleanup. It does not turn any partial state into a successful publication.

### Exact reap/drop

The derived-fork registry/path validation and exact drop protocol remain unchanged. The semantic reap change is in managed in-app branch custody: an expired row is selected from canonical custody, transitioned `active -> tearing_down` with an exact one-row check, and only the deterministic `managed_workspace_files` set is removed before `dropped` is recorded (`src/fork_promotion.rs:840-885,925-987`). Failure to reopen or inspect a damaged expired workspace now falls back to a custody-derived non-promotable receipt instead of aborting the entire sweep. The new damaged-plus-healthy test confirms both exact file sets are removed and both custody rows become dropped (`:6161-6195`). This is self-healing within the same bounded deletion authority, not a broadened recursive delete.

### Directory-mode change

The `a646bb71a` directory-mode change applies to ordinary startup when the reserved target instance directory is absent. On Apple/Linux it uses descriptor-relative `mkdirat(..., 0700)`, pins the directory with no-follow semantics, enforces effective-UID ownership and exact `0700`, syncs the parent, and removes only the just-created matching directory if validation fails (`src/instance_lock.rs:554-624`). It is adjacent hardening; it neither bypasses fork staging/rename nor alters fork authority. Its focused owner-only test passed.

## 3. Survival of rounds 1-3 closures

1. **Round-1 finding 1 — receipt-chosen scope:** Still closed. The checker owns the exact canonical scope; derived-fork v3 receipt scope must canonically equal it. The recomputed digest matches C, and the full 97-test checker matrix passed, including noncanonical-scope refusals.
2. **Round-1 finding 2 — ambient selection policy:** Closed by the C-bound content pin described above. Both receipt and current named-author acceptance must bind the exact digest; post-C bytes are irrelevant; a wrong pin refuses.
3. **Round-1 finding 3 — last-writer-wins app identity:** Still closed. The no-replace first-writer protocol and concurrent conflict tests survive the fleet delta.
4. **Round-2 finding 4 — reused/backdated acceptance locator:** Still closed. The v3 dated-locator and freshness rules remain enforced, now with the policy digest added to the exact acceptance shape. All 13 historical evidence-chain files named by the checker are byte-identical between round-3 C `03f9d147c` and final C. The full checker suite's historical-locator, add-only, and fresh-current-acceptance cases passed.

No prior closure depends on ambient `HEAD` policy bytes or on accepting a rewritten historical evidence file.

## Verification record

- Candidate identity: exact C confirmed.
- Scoped v3 digest recomputation: exact expected digest.
- Direct policy attacks: working-tree evolution ignored; bad pin refused.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 97 passed, 0 failed.
- `node scripts/check-agent-safe-publication.mjs`: passed; both capability records remain withheld pending an actual qualification publication.
- `cargo test --lib instance_fork::tests:: -- --nocapture`: 52 passed, 0 failed.
- `cargo test --lib fork_promotion::tests:: -- --nocapture`: 38 passed, 0 failed.
- `cargo test --test instance_fork_vm_egress_v1 -- --nocapture`: 1 passed, 0 failed.
- `cargo test --lib cli::tests::minted_token_discovery -- --nocapture`: 4 passed, 0 failed.
- `cargo test --lib instance_lock::tests::startup_creates_reserved_target_instance_owner_only -- --nocapture`: 1 passed, 0 failed.
- `rustfmt --edition 2024 --check` on `instance_fork.rs`, `fork_promotion.rs`, `cli.rs`, and `instance_lock.rs`: passed.
- Scoped `git diff --check dcdcdc4be..C`: passed.
- `./ref-check --verbose`: 203 LLP documents, 4,060 refs in 10,457 files, 0 errors, 0 unchecked.

The repository-wide `cargo fmt --all --check` is not globally green: it reports formatting drift in other fleet-touched root files and also traverses the pre-existing dirty `vendor/ibex` checkout. The four fork-sensitive Rust files above pass a direct Rust 2024 formatter check, and the scoped textual diff check is clean. I treat the broader formatter result as nonblocking repository hygiene, not a derived-fork claim-invariant failure.

Per the review assignment, I did not duplicate the supervisor's exact-C live suites or benchmark runs. This verdict covers the static delta, checker attacks, and local non-live/focused runtime tests; the supervisor retains custody of those live/platform measurements.

The Snapback worktree began and ended with only the pre-existing `vendor/ibex` submodule modification. I did not modify a Snapback repository file, commit, or push.

READY
