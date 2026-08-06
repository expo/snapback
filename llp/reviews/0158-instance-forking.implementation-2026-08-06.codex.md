# Independent implementation/security review: local derived-instance forks

## Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Redacted:** no
- **Method:** Fresh clean-context session; read-only worktree pinned at commit `7c2a27e0e90cf1d19b57825a187cb3be041ab92f`; mutually blind. I did not seek out or read another review. I verified claims against code and tests, inspected the dual-platform lifecycle receipts, and used a temporary database outside the worktree to check SQLite `writable_schema` behavior. I did not run Rust tests because the read-only `scripts/ibex-doctor` reported `vendor/ibex` uninitialized and the required bootstrap would mutate worktree state.

## Overall assessment

**Overall verdict: NOT READY for publication of the narrow local `operating.instance-forks` claim.**

The landed surface has strong, concrete safety work: consistent-copy publication, broad credential scrubbing/minting, real runtime DenyAll including Hermes, finite TTL/renewal, exact evidence-bound cleanup, fork-private asset custody with bidirectional GC tests, a pre-bind cold-start coverage cut, and useful fail-closed receipt checks. Those are credible foundations.

Publication is blocked by four implementation issues. Most seriously, lifecycle commands do not bind a registry selection back to the invoking app root, so an explicit shared `--fork-root` permits cross-app inspect/diff/renew/drop/reap selection—even for same-`appId` apps—contrary to LLP 0158 OQ9. The new completeness class also relies on a connection-local authorizer that admits schema-table/PRAGMA escape routes and does not control second writers. Finally, the diff receipts lack the canonical digest and stream-qualified boundaries needed to bind a review, and the advertised resource limits are not concurrency-atomic or actual bounds on net-diff work.

## Strengths

- **Publication and custody fail closed around unknown state.** The custody audit enumerates every `_snapback_*`/`_auth_*` table, refuses an unknown table, and refuses occupied incompatible subsystems before mint (`src/instance_fork.rs:650-686`). Scrub-and-mint rotates stream/signing authority, scrubs operation, session, grant, bearer, and promotion state in one transaction, and publishes non-promotable lineage only as quarantine is removed (`src/instance_fork.rs:1039-1231`).

- **Credential separation is broad and directly tested.** Fresh owner-only admin, auth, resume, and operation-detail sidecars are minted (`src/instance_fork.rs:1115-1150`), and the negative corpus checks absent parent sessions/agent credentials/grants, distinct sidecars/streams, rejected parent resume/search cursors, and invalid parent asset URLs (`src/instance_fork.rs:4268-4459`). The live CLI test also attempts each admin bearer against the opposite server and confirms fork writes remain absent from the parent (`tests/instance_fork_cli_v1.rs:977-1024`).

- **DenyAll reaches real handler VMs and fails future families closed.** Unknown host operations map to `unclassified_host_operation`, while local database/runtime ops remain admitted (`src/instance_fork.rs:1621-1649`). The Hermes test actually invokes `ctx.fetch` and `ctx.fetchStream`, requires the typed fork denial, checks the two durable payload-free markers, and verifies the parent never grows the marker table (`tests/instance_fork_vm_egress_v1.rs:103-164`). Provider, cron, jobs, telemetry, push-receipt, and asset egress have separate direct negatives rather than relying only on worker-disable flags (`src/instance_fork.rs:4462-4638`; `src/cli.rs:7861-7900`).

- **Asset custody evidence is unusually strong.** Metadata-named blobs are copied into the fork-private tree only after store/digest classification and content/length verification (`src/instance_fork.rs:3423-3526`). The live test proves parent URLs fail in the fork, copied/fork-uploaded assets serve from fork-private paths, fork GC cannot remove parent blobs, parent GC cannot remove fork blobs, and both drop and reap remove the exact fork tree (`tests/instance_fork_cli_v1.rs:1187-1363`).

- **TTL and cleanup are substantive, not metadata-only.** Boot refuses expired lineage; the serving process re-reads renewal state and exits at the live deadline (`src/instance_fork.rs:1265-1285`; `src/cli.rs:2767-2813`; `src/cli.rs:7913-7933`). Renewal refuses resurrection/shortening, caps total lifetime from creation, and crash-recovers three carriers through sentinel/intent state (`src/instance_fork.rs:2370-2548`). Cleanup rebinds registry, receipt, lineage, path, and ready evidence and serializes per-fork destructive operations with `flock` on the two supported release platforms (`src/instance_fork.rs:2079-2302`).

- **The new cold-start surface is conservative on its implemented dimensions.** The complete owner-only schema/function carrier is installed before launch; inherited admin environment authority is cleared; writer coverage arms before listener bind; mismatched/missing dual carriers refuse; partial layouts and retention gaps downgrade rather than upgrade (`src/cli.rs:3414-3514`; `src/cli.rs:7337-7371`; `src/cli.rs:7461-7490`; `src/instance_fork.rs:2812-2892`). The settled-Sessions app-id lookup correctly prefers the capability-aware schema slot over the poisoned legacy slot (`src/cli.rs:2816-2838`).

- **Parent behavior is intentionally kept dormant.** The writer authorizer is not installed without an active manifest, so ordinary databases retain their existing statement path (`src/storage/write_authority.rs:308-323`). The VM test contrasts the same fetch on the parent and proves it never receives the fork denial or marker table (`tests/instance_fork_vm_egress_v1.rs:141-164`).

## Concerns

### 1. Critical — lifecycle selection is not scoped to `(appId, instance identity)` or the recorded app root

LLP 0158 requires every multi-instance lookup/admin operation to be scoped by `(appId, instance identity)` (or an exactly resolving equivalent), says same `appId` is never sufficient, and specifically requires cross-selection/mutation negatives before publication (`llp/0158-instance-forking.rfc.md:1569-1597`). The implementation records `app_root` in each ready registry entry (`src/instance_fork.rs:1889-1923`) but never validates it in `managed_target`; that function accepts only `fork_root` and `fork_id` and binds local fork evidence, not the invoking app (`src/instance_fork.rs:2079-2225`).

The CLI permits an arbitrary explicit `--fork-root` independent of `app_root` (`src/cli.rs:2721-2727`). List/inspect/diff/drop/renew/reap then select every or one entry from that root and report the entry's own app id without comparing the canonical invoking app root; `list` even chooses the first entry's app id for a potentially mixed root (`src/cli.rs:3695-3753`; `src/cli.rs:3757-3866`; `src/cli.rs:3868-3947`). Therefore two worktrees/apps sharing an explicit root can inspect, diff, renew, stop, or delete each other's fork by id. This is an accidental cross-selection hazard within the cooperating local threat model, not merely the out-of-scope malicious-same-user case.

The live parent/fork mutation and cross-bearer test is valuable but does not exercise two same-`appId` app roots sharing a registry root (`tests/instance_fork_cli_v1.rs:894-1051`).

**Resolution:** require a canonical expected app root (and expected logical app id) in every registry bind; compare it with a mandatory receipt-bound/registry-bound app-root identity before inspect, diff, renew, stop, drop, reap, recover, and list projection; refuse legacy/missing or mixed-root ambiguity. Add a same-`appId`, two-app-root, shared-fork-root matrix proving schema/function loads, mutations, credentials, every lifecycle command, and cleanup cannot cross-select. Keep fork id/stream/endpoint as the distinct instance identity—do not use app id alone.

### 2. High — `authorizer-backed-app-rows-v1` is bypassable below the tested DML/DDL surface

The authorizer derives protected tables by name and allows every action except protected-table DML and a selected ordinary-DDL list (`src/storage/write_authority.rs:626-664`). It does not deny `PRAGMA writable_schema`, `ATTACH`/`DETACH`, or mutation of `sqlite_schema`; the connection configuration enables foreign keys, a busy timeout, and WAL, but not SQLite defensive mode (`src/storage.rs:7260-7270`). A protected table and its auto-index can consequently be renamed in `sqlite_schema`; after schema reload, the same B-tree is writable through a name absent from the manifest's `covered_tables` (`src/storage/write_authority.rs:338-345`; `src/storage/write_authority.rs:626-664`).

The enforcement is also connection-local. A production system-only vector path already opens a second write-capable connection without the authorizer, showing that the writer enum does not structurally prevent raw writable handles (`src/storage.rs:10725-10744`). The oracle rejects unjournaled raw changes and stale borrowed post-images, but a second connection that writes both the app row and a matching journal entry satisfies the implemented cross-check (`src/instance_fork.rs:2984-3046`; `src/instance_fork.rs:3126-3191`). Existing bypass tests cover direct DML, triggers, `ALTER TABLE`, unjournaled raw writes, and stale borrowed post-images—not schema aliasing or a matching-journal second writer (`src/storage.rs:26944-27050`; `src/instance_fork.rs:5781-5831`).

**Resolution:** deny unsupported authorizer actions by default while armed, enable/verify defensive mode, reject writable-schema and attach/detach operations, control every writable connection through one registry/lock, and add the full adversarial corpus (schema alias, ATTACH, temp triggers/views, DDL, savepoints, second connection, matching journal forgery, direct WAL/file mutation). Downgrade the completeness spelling until those tests pass.

### 3. High — diff artifacts cannot bind an exact review and the older surface misleadingly implies attribution

The governing contract requires stream-qualified base/head identities, operation/principal attribution on the attributed surface, and a digest over the canonical emitted diff (`llp/0162-agent-safe-storage-profile.rfc.md:1192-1235`). `ForkDiffReceiptV1` has none of those fields; its `operation` is merely row-level insert/update/delete (`src/instance_fork.rs:746-769`; `src/instance_fork.rs:2748-2809`). `ForkNetDiffReceiptV2` honestly says `attribution: "absent-v1"` and names its substrate/domains, but it also lacks a data-stream boundary and receipt/diff digest (`src/instance_fork.rs:832-849`; `src/instance_fork.rs:3196-3220`). The base-file SHA-256 does not bind the emitted head, rows, omissions, or completeness (`src/instance_fork.rs:2939-2957`).

This prevents reviewers from retaining or approving an exact receipt as required by LLP 0185 Phase 4 and makes the guide's “attributed receipt” terminology imply evidence the schema does not carry (`llp/0185-instance-forking-productization.plan.md:418-430`; `guide/operating/instance-forks.md:315-320`).

**Resolution:** version both wire artifacts with explicit base/head stream-qualified identities and a canonical, domain-separated digest over all receipt facts. Add `attribution: "absent-v1"` to the journal sequence or stop naming it attributed; add real operation/principal joins only when LLP 0163 is actually wired.

### 4. High — resource admission is racy and net-diff “max rows” is not a bound on diff work

Creation reads registry count and total bytes, returns a usage observation, and only afterward publishes the fork; no root-wide admission reservation is held across that sequence (`src/instance_fork.rs:2591-2651`; `src/cli.rs:3371-3409`). Two concurrent creates with `--max-forks 1` can both observe zero and publish; the same check/use race exists for total bytes. The concurrency test proves three default-limit creates can coexist and bind distinct ports, but never races at a count/byte boundary (`tests/instance_fork_cli_v1.rs:1480-1566`).

For net diff, `max_rows` is checked only after the entire retained journal has been inserted into in-memory sets/maps and every base/head application table has been fully materialized into `BTreeMap`s (`src/instance_fork.rs:2984-3046`; `src/instance_fork.rs:3049-3114`; `src/instance_fork.rs:3224-3297`). A huge journal that folds to no net rows or a huge unchanged database can consume unbounded time/memory and still be under the final row count. The executable resource test covers only the older attributed journal count (`tests/instance_fork_cli_v1.rs:1897-1950`).

**Resolution:** add a root-wide atomic admission/reservation lock covering count/byte observation through registry intent/publication and test simultaneous boundary requests. For net diff, stream/merge rows in canonical order and enforce journal-row, scanned-row, byte, time, and output limits before materialization; prove oversized unchanged and revert-heavy inputs refuse deterministically without residue or process exhaustion.

### 5. Medium — the governing publication gates are not yet internally current

LLP 0185 Phase 6 requires LLP 0163/0164/0165 to complete their review/acceptance loop before publication (`llp/0185-instance-forking-productization.plan.md:463-481`); all three headers remain Draft (`llp/0163-operation-identity-and-commit-envelope.spec.md:1-4`; `llp/0164-fork-and-promotion.spec.md:1-4`; `llp/0165-proof-domains-and-checkpoints.spec.md:1-4`). LLP 0162 still says the Linux row-13 run remains outstanding and points to the unqualified receipt, while this commit has landed both platform-qualified receipts (`llp/0162-agent-safe-storage-profile.rfc.md:1857-1882`; `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json:1-82`; `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json:1-82`). The capability index correctly remains a GAP/target `none`, so there is no premature public claim yet (`guide/capabilities.md:90`).

**Resolution:** after the implementation blockers close, reconcile the spec/row-13 text, complete the required acceptance decisions, and run Phase 6 item 5's corpus/guide/package/release checks before changing the guide target.

## Suggestions

- Retain the current explicit local threat-model wording; it accurately distinguishes DataIsolated and HostEgressMediated from OS ProcessContained (`llp/0158-instance-forking.rfc.md:792-823`).
- Preserve the dual-carrier coverage refusal and partial-layout downgrade. Those are good fail-closed patterns even after the completeness class is narrowed or repaired (`src/instance_fork.rs:2812-2892`; `tests/instance_fork_cli_v1.rs:1969-2030`).
- Add a fork-only regression suite that runs the same parent operation before and after derived changes. The existing dormant-authorizer and VM-parent contrasts are good seeds (`src/storage/write_authority.rs:308-323`; `tests/instance_fork_vm_egress_v1.rs:141-164`).
- Add an explicit machine-readable `containmentTier` to status/receipts so `deny-all-v1` cannot be mistaken for an OS sandbox; the guide already explains the distinction (`guide/operating/instance-forks.md:323-337`).

## Open questions

1. Is a shared explicit `--fork-root` intended for multiple app roots/worktrees? The CLI supports it and the guide emphasizes fork-per-worktree/parallel suites, so the safe answer must be encoded rather than assumed (`src/cli.rs:2721-2727`; `guide/capabilities.md:90`).
2. Is the new completeness class intended to cover trusted Snapback-generated writes only, or all physical writes to the file during the interval? The current receipt name suggests the latter while the explanatory text narrows to one process-owned connection (`llp/0165-proof-domains-and-checkpoints.spec.md:374-391`).
3. Are macOS aarch64 and Linux x86_64 the complete supported release-platform set for the initial narrow claim? The receipts prove only those named environments (`tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json:1-82`; `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json:1-82`).

## Recommended next step

Keep `operating.instance-forks` at target `none`. First bind every lifecycle command to the recorded canonical app root plus fork instance identity; then repair or downgrade the SQLite completeness class, make diff receipts stream-qualified and digest-bound, and make count/byte/diff-work limits real under concurrency and large inputs. Add the adversarial matrices named above, run the target release suites on both supported platforms, reconcile LLP 0162/0163/0164/0165, and commission a fresh mutually blind implementation/security review before publication.
