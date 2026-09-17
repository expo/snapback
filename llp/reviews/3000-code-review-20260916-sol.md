# Received independent review — 2026-09-16

Invocation: codex gpt-5.6-sol, xhigh. Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`.
This is the received report with trailing whitespace normalized, not an accepted verdict. Lead adjudication is in the review index. Absolute paths refer to the reviewer workspace.

---

# Independent Snapback 4 code and architecture review

**Reviewer:** Codex / GPT-6 (Sol lane)
**Reviewed commit:** `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (`snapback4` 0.2.26)
**Review date:** 2026-09-16
**Evidence posture:** read-only static review with small source/metadata probes; no product files changed, no remote work, no clones, no expensive suite, and no other reviewers' reports read.

## Result

I found three independently actionable defects and corroborated one compiler defect already represented by an issue at report finalization:

| Severity | Finding | Status against issue/LLP corpus |
|---|---|---|
| **P1** | A stale `/sync` request reconstructs an unbounded membership authority history before applying its requested page limit | **New concrete defect**; the broad retention/acquisition problem is known in LLP 3000.002, and the correctness change that exposed this cost is recorded in the closed interval-inversion ticket |
| **P1** | The local client cannot reduce its fixed 4,000-row sync page, so a legal snapshot above 16 MiB repeatedly returns terminal `E_BOUND` and can never be acquired | **New independent finding, now ticketed** as `issues/20260916-snapback4-snapshot-page-size-recovery.md`; join expansion is a second manifestation with its own ticket |
| **P2** | Two-package npm publication cannot resume after the platform package succeeds and the client package fails | **New independent finding, now ticketed** as `issues/20260916-snapback4-publication-cannot-resume.md`; the identical Snapback 2 failure is known and fixed |
| **P2** | Valid Quarry identifiers can collide or become invalid in generated Rust | **Corroborated existing open issue** `issues/20260916-snapback4-rust-codegen-identifier-collisions.md` |

I found no evidence in the inspected paths of an additional P0 integrity or authorization break beyond the existing issue corpus. The code has substantial recent hardening around activation identity, session authority, device store replacement, prediction rollback, request/response bounds, and worker fencing. The remaining replication-bound failures are serious because they turn supported data shapes and ordinary authenticated catch-up into resource exhaustion or permanent non-acquisition.

## Findings

### S1 — P1 — Membership authority reconstruction is unbounded before stream pagination

**Evidence.** `snapback4/crates/snapback4-core/src/partition.rs:483-544` builds every authorization interval needed by a stream request before selecting the bounded content page:

- `partition.rs:487-499` scans every current membership for every target-audience synced table, passing `usize::MAX` at line 490.
- `partition.rs:500-505` loads the complete transition ledger after the caller's watermark and groups it in memory.
- `partition.rs:506-543` constructs all spans for all groups.
- Only afterward does `stream` apply the caller's limit in `partition.rs:548-576`.

The storage methods are unbounded as well. `snapback4/crates/snapback4-core/src/store.rs:507-515` executes `membership_transitions` with no `LIMIT`, and `memberships_before` runs a window query over all transitions through the watermark. HTTP's `limit.clamp(1, 10_000)` at `snapback4/crates/snapback4/src/serve.rs:1009` does not bound any of this preceding work.

**Trigger / reproduction.** Use a target-audience synced table and a principal that repeatedly joins, leaves, or renews memberships. Retain an old device watermark, or request `/sync` with `from: 0, stream: true`. One authenticated request reads and retains every transition after that watermark, plus every current membership, before returning at most the requested number of content events. Repeating the stale request repeats the whole scan. A normal application that lets users join/leave groups can therefore expose process CPU and heap to one principal's complete membership history; the open unbounded-thread/socket issue amplifies concurrent requests.

**Why the obvious limit is unsafe.** The closed `issues/closed/20260913-snapback4-stream-interval-truncation-inversion.md` documents the earlier disclosure bug: deriving authority from a truncated transition slice can grant private history before a later join. Its resolution deliberately changed the code to read the complete ledger. Simply adding `LIMIT` would recreate that security failure.

**Suggested repair.** Make authority state resumable independently of raw transition history. Viable shapes include a compact per-principal/group checkpoint at the minimum resumable watermark, plus bounded deltas; or a retention floor that forces an old client through an authenticated snapshot/reset. Bound both current membership enumeration and transition reconstruction, and carry an authority continuation that cannot advance the content watermark until the authority frame is complete. Add a regression with many membership transitions and a small content page that asserts bounded rows/bytes/work without granting pre-join history.

**Known vs new.** The precise request path and stale-watermark trigger are new in the issue inventory I checked. LLP 3000.002 lines 47-49 and 74-75 already identify unbounded log retention and the need to bound partition acquisition; lines 93-99 propose a minimum resumable watermark and reset path. This finding supplies a concrete current exploit path and the constraint imposed by the closed security fix.

### S2 — P1 — The fixed client sync page can make a legal partition permanently unacquirable

**Evidence.** The server and client each enforce a bound, but their recovery contracts do not meet:

- The local client hardcodes `PAGE = 4000` at `snapback4/packages/snapback4/src/local.ts:105` and sends that value on every snapshot and stream request at `local.ts:550`. There is no smaller-page retry.
- Snapshot pagination counts rows, not encoded bytes: `snapback4/crates/snapback4-core/src/partition.rs:304-364` fills up to `limit` events and advances its cursor by row.
- The HTTP writer caps encoded JSON at 16 MiB in `snapback4/crates/snapback4/src/serve.rs:489-505`. On overflow, `serve.rs:567-580` discards the response and returns HTTP 200 with non-retryable `E_BOUND`, whose message tells the caller to request a smaller page.
- `local.ts:563-570` records a non-retryable sync refusal as `partitionDenied`; `local.ts:785` then denies local queries. A later sync can clear the denial only after receiving a valid page (`local.ts:603-605`), but every retry asks for the same 4,000-row page.

The repository already contains the server half of an exact reproduction. `snapback4/packages/snapback4/test/http-bounds.test.mjs:200-211` seeds 40 rows with 400,000-byte bodies, proves `/sync` with `limit: 100` returns `E_BOUND`, then proves `limit: 1` succeeds. The shipped local client requests 4,000 for that same initial snapshot and has no route to the working limit.

Join acquisition has the same underlying mismatch. `partition.rs:587` expands joins only after event pagination. `partition.rs:645-680`, especially `group_at` at line 668, materializes the entire historical group and appends every row at the join's sequence; a horizon truncates row count, but a horizonless group has no row or byte bound. The whole result is then subject to the same 16 MiB response ceiling. An open `issues/20260916-snapback4-sync-indivisible-join-progress.md` existed by report finalization and covers that branch.

**Trigger / reproduction.** Run the existing `http-bounds` fixture through `createLocalClient` or the native local client rather than issuing hand-sized `/sync` calls. On a fresh store, the client requests 4,000 rows, receives `E_BOUND`, marks the partition denied, and never advances its snapshot cursor. Reopening repeats the same request. Independently, create a horizonless group with more than 16 MiB of legal row JSON, then grant a device membership: its next stream page expands the entire group and follows the same refusal path.

**Impact.** A schema and data set accepted by writes and the server can be impossible to use with the supported local-first client. The server also materializes the oversized snapshot/join before encoding refuses it, so an authenticated retry loop consumes large CPU and heap without making progress.

**Suggested repair.** Define sync frames by an encoded-byte budget as well as row/event count. For snapshots, stop before the next row would exceed a conservative wire budget and return a cursor that points to the first omitted row. If one legal row can exceed the response ceiling, either refuse it at write/schema admission with a discoverable bound or define chunking for that row. For joins and whole commits, transmit bounded staged fragments under a commit/acquisition token, and publish them atomically on the device only after the last fragment. Until that protocol lands, the client should adaptively reduce a snapshot page after transport `E_BOUND`; that is insufficient for indivisible join/commit expansion but closes the already-tested snapshot wedge.

**Known vs new.** LLP 3000.002 lines 41-49, 74-75, 93-99, and 146-149 explicitly retain server-side snapshot/whole-commit materialization as unfinished research. The closed HTTP-bound ticket also says acquisition must be coordinated rather than merely buffered. The fixed-4,000-page client contradiction and its direct link to the existing 40-row test are new concrete evidence, now tracked by `issues/20260916-snapback4-snapshot-page-size-recovery.md`. The join branch is tracked separately.

### S3 — P2 — Two-package npm publication cannot converge after partial success

**Evidence.** `snapback4/scripts/publish.mjs:74-122` builds, packs, signs, and verifies both tarballs. The external commits are then unconditional and sequential: the platform tarball publishes at lines 127-128, followed by the client tarball at lines 129-130. The metrics/resume record is written only after both at lines 132-134. There is no registry-state query, artifact digest comparison, staged durable receipt, or branch that accepts an identical already-published artifact.

**Trigger / reproduction.** Let `npm publish snapback4-darwin-arm64@V` succeed, then fail the following `npm publish snapback4@V` through a transient network, auth, npm, or process failure. Rerun the script unchanged. npm refuses the first publish because version `V` is immutable; `execFileSync` throws, so the script exits before reaching the missing client package. The qualified pair can no longer be completed by the only publication state machine. Bumping the version works around the incident but leaves an orphan public platform version and abandons the already-qualified version.

**Suggested repair.** Port the convergence protocol already used for Snapback 2: stage both integrity-bound tarballs and their digests durably; record intended package/version/digest pairs before the first external commit; query each exact registry version on retry; accept an existing artifact only if its registry bytes/integrity match the staged artifact; publish only missing artifacts; and finish with a receipt that binds both registry results. Add a failure-injection self-test at each external-commit boundary.

**Known vs new.** No Snapback 4 issue matched this when independently found; the lead subsequently opened `issues/20260916-snapback4-publication-cannot-resume.md`. `issues/closed/20260901-snapback2-two-package-publication-cannot-resume.md:1-16` records the identical failure and its repair, so this is implementation drift rather than a new architecture question. It maps to LLP 3000's publication contract and LLP 3000.007 §20.8's shipped-byte identity requirements.

### S4 — P2 — Generated Rust identifiers are not injective over valid Quarry names

**Evidence.** `snapback4/crates/snapback4-lang/src/emit/rust.rs:16-29` emits table/index constants and modules, lines 32-49 emit structs and fields, and lines 65-117 normalize names. `snake` folds camel-case boundaries and punctuation/underscores, `screaming` uppercases that result, and `pascal` removes underscores. These mappings are not injective: `fooBar` and `foo_bar` both become `foo_bar`, `FOO_BAR`, and `FooBar`. `field_name` protects many keywords only in field/module position; a table named `self` still reaches `pascal` as prohibited `Self`, while `_` can yield an empty type name.

**Trigger / reproduction.** Declare otherwise distinct valid Quarry tables, columns, or indexes such as `fooBar` and `foo_bar`, and add a native module so `snapback4 check` builds generated Rust. Quarry binding accepts distinct source identifiers; generated Rust contains duplicate symbols or invalid type names and fails later in Cargo, away from the source sites.

**Suggested repair.** Either define a reversible escaping scheme for all Rust symbols or reject target-language collisions during binding/codegen validation with one stable diagnostic that cites every colliding Quarry declaration. Validate the complete namespace per emitted Rust scope, including keywords and empty/leading-digit results. Add paired collision cases for tables, fields, indexes, and maintains.

**Known vs new.** Corroborates the open `issues/20260916-snapback4-rust-codegen-identifier-collisions.md`; do not file another ticket.

## Major architecture and direction questions

1. **Replication needs one byte-framed progress protocol.** Snapshot row paging, whole-commit delivery, join expansion, HTTP encoding, and device atomic publication currently have separate notions of a unit. LLP 3000.002 already presents the real choice: staged bounded fragments versus a maximum admitted partition/commit size. The fixed-page wedge shows this decision is now a correctness requirement, not only performance research.

2. **Log retention and authority reconstruction must be designed together.** `_log` and applied-operation records have no compaction lifecycle (LLP 3000.002:47-49). Safe compaction needs a minimum resumable watermark, device/session lease policy, authenticated reset, and an explicit deduplication-result retention contract. Membership authority checkpoints belong to that design; optimizing the current full scan in isolation risks reintroducing pre-join disclosure.

3. **Publication should be a convergent multi-artifact transaction.** Snapback 4's client and platform package are one release contract but two irreversible registry writes. This does not require a new release system: the sibling implementation already demonstrates the needed stage/check/publish-missing/receipt state machine.

4. **Target-language names need a compiler-owned ABI.** TypeScript safely quotes arbitrary properties, while native Rust must map them into several identifier namespaces. LLP 3000.005 should either own a stable reversible mapping or make Rust representability a schema rule. Letting Cargo discover collisions makes native support a late, target-specific partial compiler.

5. **Clarify the trust boundary of service credentials used for route verification.** `snapback4/crates/snapback4/src/serve_route_verify.rs:21-43` authenticates any service token and lets it claim any route named in the request; settlement at lines 68-81 binds only the claiming worker and lease fence, then runs under the route's declared service. `snapback4/crates/snapback4/tests/serve_routes/mod.rs:6-14` intentionally uses a `service:worker` credential for a `service:billing` route, so I do not classify this as a bug. LLP 3000.009 §5.1 should say plainly whether a service token is a deployment-wide trusted worker credential or a least-privilege seat. If seats are intended to isolate providers, the current verifier API cannot enforce that isolation.

6. **Decide whether H0 release activation promises power-loss durability.** `snapback4/crates/snapback4/src/verbs/releases.rs:57-77` fsyncs the pointer file and ledger but does not fsync the containing directory or staged release tree around renames. LLP 3000.000:139-151 explicitly says current tests do not establish a power-loss guarantee. That is an honest present boundary, not a defect under the current statement. Before calling release activation crash durable, either add directory/tree durability and kill/power-loss probes or store an integrity-bound source artifact under the database-owned activation.

## Existing issues not duplicated

I cross-checked the repository issue corpus and did not restate its already open findings about unbounded HTTP threads/socket deadlines, cleartext non-loopback serving, world-readable stores, unauthenticated catalog/change metadata, slow I/O under the engine lock, upload concurrency, asset range/cache/view-once behavior, predictable server IDs, unique-oracle/audience authority, session lifecycle/default store, membership-feed and sync tail performance, Postgres replay binding, maintained-identity adoption, browser ownership without Web Locks, native host memory and continuation identity, stale native artifact selection, or online asset completion after close. The join-progress and Rust-codegen items above are explicitly marked as corroborations where their open tickets now overlap this review.

I also inspected the `local.ts:1080-1095` "admission outcome is unknown" path. A store operation can theoretically commit and then fail to reply, so the submitting call can report failure even though reopen later recovers and sends the durable entry. LLP 3000.007 §20.4 and the open navigation/admission reproduction work already treat pre-admission/browser closure as bounded best-effort. Without a focused host reproduction at this commit, I am not elevating it as a new finding.

## Coverage and limitations

I began with `snapback4/AGENTS.md`, `snapback4/NOT-DOING.md`, the tail of `snapback4/JOURNAL.md`, `rules/RULES.md`, LLP 3000, and the governing/referenced LLPs 2000.000, 3000.000, 3000.001, 3000.002, 3000.004, 3000.005, 3000.007, 3000.008 and 3000.009. I used the `llp-orient` workflow read-only.

Production coverage included:

- detailed review of core partitioning, SQLite store/log operations, activation, identity, assets, actions/effects/jobs, native host bridge, meter, and the main mutation/query entry points; sampled review of the larger interpreter read/write/rule/prefetch modules and Postgres adapter;
- lexer/parser/binder architecture, diagnostics, guide embedding, TypeScript/server/Rust emission, project discovery, generated artifacts, native build, and server typecheck custody; the roughly 12,000-line language implementation was sampled by semantic boundary and risk search rather than read line-for-line;
- HTTP dispatch, authentication, sessions, changes, routes/verifiers, action workers, assets, adoption/watch, lifecycle/signals, CLI verbs, deploy/rollback/serve, signing, binary resolution, and publication;
- Rust device apply/snapshot/store-identity/history/prediction/outbox paths, memory/SQLite/web adapters, call/FFI/native surfaces; and TypeScript local client, browser journal/persistence, online client, React, worker/server/routes, actions/assets, and close/auth flows;
- Expo package TypeScript, Swift module/witness bridge, package metadata and native build entry points;
- test/publish/build/measurement scripts, with targeted inspection of relevant regression tests and the full issue-title/status inventory.

I did not run the complete Rust/Node/browser/Expo/Postgres suites, did not launch a simulator or browser, and did not perform a live npm failure injection. Findings S1 and S3 are code-traced. S2 is code-traced and anchored by an existing deterministic server regression, but I did not add/run the missing local-client composition test. S4 is code-traced and already has an open issue. I did not audit vendored dependencies or third-party cryptographic implementations. Postgres remains experimental and received a boundary-focused review rather than a complete SQL-by-SQL equivalence audit. The large guide, measurement harness, simulator, and test corpus were sampled for contract/evidence and were not reviewed as production runtime line-for-line.

At the end of review, `HEAD` still resolved to the requested commit. The worktree contained LLP edits and untracked issue files created concurrently by the lead review; I did not modify them and used the issue inventory only to avoid duplicate recommendations.
