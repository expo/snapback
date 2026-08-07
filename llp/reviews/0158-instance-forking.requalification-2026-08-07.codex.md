# Independent implementation review: derived-fork requalification candidate

## Provenance and reviewed claim

- **Family:** codex
- **Date:** 2026-08-07
- **Qualification C:** `336a605bc808a340c71407c148af450789f420ad`
- **Scoped implementation digest:** `sha256:c42666589ceea579e7ac6a635e3a4ef9b4f888a54b329c552929fff71c81ecf0`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Declared scope:** `src/`; `.gitmodules`; `Cargo.lock`; `Cargo.toml`; `build.rs`; the `vendor/ibex` gitlink; `scripts/check-agent-safe-publication.mjs`; and `scripts/generated-artifact-policy.mjs`
- **Claim reviewed:** the narrow contributor-source local derived-deployment-fork capability on exactly `macos/aarch64` and `linux/x86_64`: fail-closed `deny-all-v1`, finite TTL, non-promotable lineage, host-mediated isolation, and no process-containment, npm/public-package, hosted/remote, or merge-back claim.
- **Independence:** I formed this review from the dispatched tree. I read the committed 2026-08-06 review history only as the requested historical baseline and did not seek, read, or reference any concurrent requalification review.

I independently recomputed the declared digest at C and obtained the exact dispatched value. The runtime delta is generally strong, and the fork library tests remain green, but the new D-3/D-4 custody implementation has two fail-open scope defects. I also found a conflicting-first-writer race at the app-root identity call site of the new atomic JSON helper. Those three findings block the claim.

## Findings

### 1. Critical — a v3 publication receipt chooses its own scope; the checker never requires the reviewed derived-fork scope

LLP 0189 D-3/D-4 requires the claim record to carry the semantically classified scope, requires the named author to accept that classification, and treats a later scope edit as an in-scope change. The implementation declares the intended derived-fork scope at `scripts/check-agent-safe-publication.mjs:64-79`, but the publication path does not bind a v3 receipt to that declaration:

- `validateReceiptShape` checks only that `receipt.implementationScope` is a nonempty, sorted, portable scope (`:997-1025`; the permissive validator is at `:467-497`).
- `implementationScopeForReceipt` returns that receipt-supplied scope unchanged (`:1049-1052`). The qualification digest, C-to-P drift check, claim snapshot, working-tree check, and author-evidence validation all then use it (`:1981-1986`, `:2045-2098`, `:2200-2205`).
- `validateDerivedForkCoverageTransfers` validates the hard-coded intended scope separately (`:616-628`), but never compares it with the receipt scope.
- The exact-key contract for derived-fork author acceptance has no `implementationScope` or scope digest (`:1877-1893`). Its implementation-tree digest cryptographically commits to an opaque scope preimage, but the record does not say which classification the named author accepted, contrary to D-4's explicit requirement.

Concrete demonstration, using the checker exported at C without changing the tree:

```text
scope = {"schemaVersion":"snapback.agent-safe-implementation-scope.v1","roots":[],"files":["scripts/check-agent-safe-publication.mjs"]}
implementationDigestAt(C, scope)
= sha256:2e14fad65d24450a472cab5ec8b9cf556921109be708201a4301f7360d398d23
```

That scope passes `validateImplementationScope`. A freshly constructed v3 receipt, carrier, review history, and author-acceptance record can consistently bind this alternate digest, and `validatePublicationRecord` will use the one-file scope. Every runtime byte under `src/`, the Ibex gitlink, Cargo/build inputs, and the generated-artifact policy then becomes out-of-scope by construction. The fixture builder illustrates the permissiveness too: its synthetic derived record selects an arbitrary `src` + `vendor/ibex` scope rather than the declared production constant (`tests/agent_safe_publication_checker_v1.mjs:610-615`, `:716-729`).

This is a direct mechanism for moving semantics-defining files out of the claim scope. The nine-file transfer assertion does not constrain it because that assertion is evaluated against the separate constant, not the receipt.

**Required resolution:** for this capability, require canonical deep equality between the receipt scope and `DERIVED_FORK_IMPLEMENTATION_SCOPE` before using the receipt anywhere. Add the exact scope (or a separately domain-separated digest of its canonical bytes) to the named-author acceptance contract and compare it with the receipt. Add publication-record negatives that delete `src`, `vendor/ibex`, each explicit file, or substitute an otherwise valid nonempty scope; each must refuse before accepting reviews or evidence. Any future scope edit must therefore rotate C/reviews/author acceptance as LLP 0189 requires.

### 2. High — the in-digest transfer checker has an out-of-scope, unpinned semantics-affecting input

The checker is inside the declared digest, but `validateDerivedForkCoverageTransfers` reads `scripts/local-proof-selection-policy.v1.json` from the current working tree (`scripts/check-agent-safe-publication.mjs:616-627`). That policy decides whether each of the nine departing files has a registered replacement gate, including its record paths, trigger coverage, and regeneration command. The policy file is neither in `DERIVED_FORK_IMPLEMENTATION_SCOPE` nor content-pinned in the receipt or author acceptance.

This violates LLP 0189 D-4's input-closure rule for semantics-affecting inputs of an in-digest checker. A later change to the policy is classified out of scope by `evaluateClaimSnapshot`, while the publication checker immediately trusts the changed policy. The structural check does not establish the stated gate-quality bar: `assertCoverageTransfers` requires only nonempty `records`, `recordPaths`, and `regenerateCommand`, plus a path match (`:561-610`). I supplied all four gate names with `records: ["not a frozen value"]`, `regenerateCommand: "true"`, and matching `recordPaths`; the function returned all `9` transfers as valid.

At this C, I manually inspected and ran the transferred gates that this environment supports. The current registrations are substantive: the publication fixture suite recomputes checker behavior, the CI test checks workflows/toolchain pins, the local inventory checks the proof graph and versioned-seed carriers, and bundle metrology recomputes frozen bundle measurements. That current quality does not close future custody: the unpinned policy can redefine what the in-scope checker considers coverage without invalidating the claim. Separate scheduled drift handling is not a substitute for D-4's categorical input closure.

**Required resolution:** include `scripts/local-proof-selection-policy.v1.json` in the derived-fork v3 scope, or pin its exact canonical content digest in the claim record and read the C-bound bytes. Add a post-C policy-tamper fixture proving that deleting a transferred gate, changing its record/trigger mapping, or replacing its regeneration command invalidates the claim. It would also be prudent for the transfer validator to recognize the exact admitted gate definitions rather than treating arbitrary nonempty prose and commands as proof of a frozen-record gate.

### 3. High — atomic JSON replacement is byte-atomic, but first app-root identity publication is still last-writer-wins

The filesystem durability repair itself is sound on the two claimed filesystems: `replace_bytes_sync` creates a unique same-directory temporary with `create_new`, writes and `sync_all`s it, renames it over the final path, and fsyncs the parent directory (`src/instance_fork.rs:1404-1440`). Same-directory rename gives atomic name visibility on the claimed macOS/Linux targets. The prior `write_json_sync` used `File::create`, so no caller actually inherited create-exclusive behavior from the old helper; existing overwrite call sites therefore did not lose such a guarantee.

One call site nevertheless needs a stronger logical operation than replacement. `ensure_expected_app` reads the app-root identity, and on `NotFound` unconditionally calls `write_json_sync`, then returns its own opaque expectation (`src/instance_fork.rs:192-239`). Two first writers for different app IDs can both observe `NotFound`, publish separate complete temporaries, rename in either order, and both return success. The new 32-writer test covers only the same app ID (`:5160-5194`), so last-writer-wins happens to look idempotent.

A deterministic refutation path is to reuse the existing pre-rename test hook with a two-party barrier: invoke `ensure_expected_app(root, "app-a")` and `ensure_expected_app(root, "app-b")`, hold both immediately before rename, then release both. Both calls return an `ExpectedForkAppV1`; only the last identity remains. The later root-wide creation-admission lock cannot serialize this because the CLI calls `ensure_expected_app` before `admit_creation` (`src/cli.rs:3462-3485`). A concrete harmful interleaving is:

1. A and B both read `NotFound`.
2. B installs identity B, obtains the admission lock, passes the one-time mint revalidation at `src/instance_fork.rs:2287-2319`, and starts publication.
3. A replaces the identity with A while B still owns admission, then waits for admission.
4. B completes its fork publication; A subsequently validates A and can publish too.

B's later runtime-registry attachment revalidates against the now-A root and can fail at `src/cli.rs:3743-3748` after its detached server has already launched, leaving a fork/server that the final A identity cannot select normally. This is an ordinary competing-create race inside the cooperating local boundary, not malicious same-user file tampering. It cuts across the claimed app binding and exact reap/drop lifecycle.

**Required resolution:** give immutable app-root identity a first-writer-wins compare-and-publish primitive. One portable approach on the claimed targets is a synced same-directory temporary followed by an atomic no-replace installation (for example a same-filesystem hard link), then read/compare the winner on `AlreadyExists`, remove the temporary, and fsync the directory. A lock-and-recheck design is also acceptable if its crash behavior is explicit. Add deterministic same-ID and conflicting-ID first-writer tests; conflicting writers must yield exactly one accepted identity and the loser must mint or launch nothing.

### 4. Informational — the remaining atomic-publication argument and regression tests are convincing

Outside Finding 3's immutable-identity requirement, I found no call site that depended on create-exclusive semantics. The helper now prevents readers from seeing truncated JSON, uses unique temporary names, cleans an unpublished temporary on failure, and reports directory-sync failure instead of claiming durability. The pre-rename hook test proves that the final path is absent while the complete synced temporary is visible (`src/instance_fork.rs:5126-5157`), and the 32-way identical-identity test proves the intended idempotent case. Both tests passed here. The complete `instance_fork::tests::` prefix also passed: 50 passed, 0 failed.

### 5. Informational — the descriptor failure was a test artifact; the production sweep remains directly proven

The production `configure_detached_child` path is unchanged: it snapshots a descriptor ceiling and, in child `pre_exec`, marks every non-stdio descriptor through that ceiling `FD_CLOEXEC` before `setsid` (`src/cli.rs:3383-3433`). The new isolated unit test atomically opens an `O_CLOEXEC` flock lease, deliberately duplicates it to descriptor 198, invokes the real production configurator on `/bin/sleep`, and proves after exec that the child no longer owns the lock (`src/cli.rs:9983-10051`). It passed here.

The live integration replacement is also a valid refutation of the old fixture: opening the lease with `O_CLOEXEC` removes the process-wide `pipe()`-then-`F_SETFD` window, and `dup2` occurs only in the spawned CLI child's `pre_exec`; a nonblocking flock probe tests retention of the same open-file description. I agree with the conclusion “old failure was a test artifact; production sweep is correct” for the claimed CLI path. I found no production regression in this delta.

### 6. Informational — review-prose and AgentSafe declaration hardening do not weaken custody

The prose-history change is additive and fail-closed: it enumerates the legacy round heads, requires new rounds to declare `frozen-per-round`, and binds each round to the SHA-256 and length of the exact review prefix. Legacy current-artifact digest checks remain in force. I found no route for a new unbound round or retrospective prose rewrite.

The declaration checker now inventories every `AgentSafe*` definition across four committed schemas, canonicalizes schema shape while excluding only descriptions, and requires exact TypeScript enum/object membership, required properties, and closed-object shape. `node scripts/check-agent-safe-publication.mjs --codegen-declarations-only` reported `ok (33 definitions, 4 schemas)`, and the 76-test publication-checker suite passed. These changes strengthen custody; they do not compensate for Findings 1-2.

### 7. Informational — runtime spot-checks found no other regression in the narrow claim surface

I compared the scoped delta from `ad0ad5874` through C and spot-checked the surviving LLP 0158 invariants. The 50 passing fork-library tests include finite maximum lifetime and renewal, deny-all coverage for classified and unknown egress families, disabled manual cron/provider paths, non-promotable minted identity, parent credential/cursor refusal, resource-admission boundaries, exact diff custody and work limits, evidence-bound registry/drop/reap behavior, expiry refusal, and publication/renewal crash matrices. The descriptor unit passed separately. The unrelated post-baseline auth-stream-reset carrier and local-store publication updates do not widen the fork claim. I found no new npm, hosted/remote, process-containment, or merge-back assertion.

## Execution record and supplied-evidence reliance

- Recomputed C's canonical v3 digest: exact match, `sha256:c42666589ceea579e7ac6a635e3a4ef9b4f888a54b329c552929fff71c81ecf0`.
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --lib instance_fork::tests:: -- --nocapture`: 50 passed, 0 failed.
- Focused detached-descriptor unit: 1 passed, 0 failed.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 76 passed, 0 failed.
- Full publication checker at the withdrawn tree state: clean exit; both agent-safe records correctly reported `withheld`.
- Codegen declaration check: 33 definitions across 4 schemas, passed.
- CI workflow fixture: passed, 9 workflows and 44 immutable action pins.
- Local-proof inventory: 3 passed, 0 failed.
- Client-bundle metrology failed closed before measurement because this shell is Node `v25.9.0`/zlib `1.2.12`, while the frozen method requires Node `v24.18.0`/zlib `1.3.1-e00f703`. I treat that as an environment mismatch and not as green evidence.
- The focused live descriptor integration could not reach readiness. An independent loopback probe failed with `EPERM: operation not permitted 127.0.0.1`, confirming that this review sandbox cannot bind loopback. I therefore do not treat the integration attempt as a candidate failure or success.
- As the dispatch permits, the platform-execution portion of this verdict relies on the supervisor-supplied live release-profile suites on exact C for `macos/aarch64` and `linux/x86_64`, plus the exact-C row-13 bench. That reliance cannot cure the static publication-custody or first-writer findings above.
- The repository worktree remained clean. I modified no repository file.

VERDICT: NOT READY — blocking findings 1, 2, and 3.
