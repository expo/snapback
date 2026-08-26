## Decision

**Landing A cannot close the reported defect.** A per-connection SQLite authorizer can enforce a policy only on statements prepared through that connection. It cannot establish file-wide authority.

The branch can still be accepted as **inert, handle-local infrastructure**—which is Landing A’s stated claim—but only if its specification and tests say that plainly. It must not be treated as evidence that same-file second handles or raw processes are refused.

Before Landing C can claim a “durable forgery cut,” the design must choose one of two boundaries:

1. **Repository/trusted-native boundary:** all supported writable connections go through one closed gateway; cooperating processes use the existing instance lock; arbitrary raw same-user file access remains explicitly out of scope.
2. **Hostile raw-file-writer boundary:** move authority outside SQLite—OS/service isolation or an externally protected cryptographic root. That is deployment and migration work, not Landing A.

Accordingly, the current A→C sequence is incomplete unless resource custody/gateway work from LLP 0311 is made a prerequisite or atomic part of C.

## Q1 — The defect is intrinsic

`GuardedConnection::from_initialized` validates schema once and then installs the callback on its owned connection ([protected_tx.rs:79](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/authority_transition/core/evidence/protected_tx.rs:79)). Each effect starts `BEGIN IMMEDIATE`, compares only the durable guard blobs, and then reads the credential relation ([evidence.rs:90](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/authority_transition/core/evidence.rs:90), [evidence.rs:171](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/authority_transition/core/evidence.rs:171)). Nothing re-establishes that `_auth_password_credentials` is still the relation validated during construction.

| Case | Intrinsic result | Reachable here today |
|---|---|---|
| Another connection in the same process | **Yes, bypasses the authorizer.** It may omit or replace its callback and modify schema/data. Rust privacy can prevent well-behaved code from obtaining such a handle, but it cannot make a SQLite callback file-global. | **Yes.** A checked-in test opens two `LocalDatabase` handles to one file successfully; only the second authority-graph claim is denied ([storage/tests.rs:201](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/tests.rs:201)). Production also has read-only WAL connections ([connections.rs:587](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/connections.rs:587)), a registered secondary writer for vector quarantine ([connections.rs:623](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/connections.rs:623)), a private read-write invalidation connection ([auth_invalidation.rs:129](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/auth_invalidation.rs:129)), and direct branch-runtime opens ([fork_promotion.rs:1392](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/fork_promotion.rs:1392)). Those production routes are trusted and mostly typed/fixed, but second handles unquestionably exist. |
| Another process on the same machine | **Yes, if it has filesystem write authority.** A per-connection authorizer cannot affect it. Different-UID permissions, a sandbox, container, or storage service can exclude it; SQLite cannot. | **A cooperating Snapback server is excluded; an arbitrary same-user SQLite process is not.** CLI serving acquires `DatabaseInstanceLock` before opening and retains it through shutdown ([cli.rs:8539](/Users/ccheever/lanes/revA4/crates/snapback-cli/src/cli.rs:8539), [cli.rs:9488](/Users/ccheever/lanes/revA4/crates/snapback-cli/src/cli.rs:9488)). The lock is a sidecar `flock`/`LockFileEx`, however, not mandatory access control ([instance_lock.rs:36](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/instance_lock.rs:36), [instance_lock.rs:1208](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/instance_lock.rs:1208)). A raw process can ignore it. |
| A connection opened by other workspace code | **Same as the first case.** Its safety depends entirely on whether it used the common gateway. | **Yes.** The dependency policy currently permits `rusqlite` in `snapback`, `snapback-harness`, `snapback-kernel`, and `snapback-services` ([allowed-dependencies.v1.json:20](/Users/ccheever/lanes/revA4/crates/allowed-dependencies.v1.json:20)). The lower-level `LocalSnapback::open` path directly reaches `LocalDatabase::open` ([engine.rs:7916](/Users/ccheever/lanes/revA4/crates/snapback-engine/src/local/engine.rs:7916)); unlike the composed CLI lifecycle, that method does not itself acquire the cross-process instance lock. The supported embed documentation characterizes native-linked code as trusted, self-hosted code ([embed.rs:23](/Users/ccheever/lanes/revA4/crates/snapback-cli/src/embed.rs:23)). |

Two current tests are especially revealing:

- The named “cross-connection” test actually uses two distinct in-memory databases, so it proves only that scope on guarded A does not arm guarded B—not same-file protection ([tests.rs:164](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/authority_transition/core/evidence/tests.rs:164)).
- Another test opens a hostile raw connection to the same file and successfully rewrites the resource guard ([tests.rs:562](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/authority_transition/core/evidence/tests.rs:562)). Refusal occurs only because that particular guarded value changed.

So the authorizer is useful, but only after a custody rule has made every relevant writer pass through it.

## Q2 — The repository’s existing answer

There is no hidden SQLite mechanism that solves this. The repository already uses a layered, cooperative custody model:

1. **Deployment ownership:** one Rust server process owns the SQLite database ([LLP 0003:43](/Users/ccheever/lanes/revA4/llp/0003-local-code-hosting-and-storage-core.rfc.md:43)).
2. **One serialized write boundary, with intentional read-only WAL handles:** literal single-connection custody is not the product design ([LLP 0003:129](/Users/ccheever/lanes/revA4/llp/0003-local-code-hosting-and-storage-core.rfc.md:129)).
3. **Cross-process cooperative exclusion:** the server and offline tools use `DatabaseInstanceLock`; backup is explicitly offline under that lock ([cli.rs:3192](/Users/ccheever/lanes/revA4/crates/snapback-cli/src/cli.rs:3192)).
4. **In-process authority-graph uniqueness:** a process registry keys file databases by canonical device/inode and permits one live commit-authority claim ([storage.rs:1133](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage.rs:1133), [storage.rs:3731](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage.rs:3731)).
5. **Registered writable-connection discipline:** secondary writers are supposed to use the registered factory, which reconstructs `WriterAuthorityV1` and installs its authorizer ([connections.rs:377](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/connections.rs:377)).

The accepted documentation already states the exact boundary: `registered-connection-defensive-app-rows-v1` covers Snapback-constructed connections, **not OS/file containment**, and does not stop a same-user process or evasive native code ([LLP 0165:399](/Users/ccheever/lanes/revA4/llp/0165-proof-domains-and-checkpoints.spec.md:399), [LLP 0165:436](/Users/ccheever/lanes/revA4/llp/0165-proof-domains-and-checkpoints.spec.md:436)). LLP 0284 likewise declares independent `rusqlite` plus filesystem access out of scope ([LLP 0284:270](/Users/ccheever/lanes/revA4/llp/0284-workspace-security-gate-threat-model.spec.md:270), [LLP 0284:389](/Users/ccheever/lanes/revA4/llp/0284-workspace-security-gate-threat-model.spec.md:389)).

Also, `WriterAuthorityV1` is not secretly protecting auth state: its fallback deliberately permits system tables, including `_auth_*`, on registered handles ([write_authority.rs:780](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/write_authority.rs:780), [write_authority.rs:857](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/write_authority.rs:857)).

The new substrate should therefore **inherit, not reinvent**:

- `DatabaseInstanceLock` for cooperative process ownership;
- the device/inode registry pattern for an in-process resource coordinator;
- `open_registered_system_writer_v1` as the beginning of a closed connection gateway;
- the existing composite `WriterAuthorityV1` policy;
- the honest registered-connection threat boundary.

LLP 0311 already specifies this direction: per-use durable guard, one resource coordinator, a cross-process lease, and a closed connection gateway ([LLP 0311:220](/Users/ccheever/lanes/revA4/llp/0311-authorization-interlock-resource-binding.rfc.md:220), [LLP 0311:447](/Users/ccheever/lanes/revA4/llp/0311-authorization-interlock-resource-binding.rfc.md:447), [LLP 0311:495](/Users/ccheever/lanes/revA4/llp/0311-authorization-interlock-resource-binding.rfc.md:495)). But it is still Draft/design-only and explicitly requires further specification before implementation ([LLP 0311:660](/Users/ccheever/lanes/revA4/llp/0311-authorization-interlock-resource-binding.rfc.md:660)).

## Q3 — Options and costs

| Option | Protects | Does not protect | Required cost |
|---|---|---|---|
| **Exclusive file custody** | All writers if custody is genuinely mandatory. A practical variant is one writable gateway plus read-only secondary handles. | The current sidecar lock does not stop arbitrary same-user SQLite or raw file I/O. Rust visibility does not stop deliberately hostile same-process native code. | Privatize and inventory every writable open; route all maintenance and secondary writers through one gateway; reuse the process registry and instance lock. To cover hostile same-user processes, run under a separate OS identity/container/service with exclusive filesystem authority. Literal “no second handle” breaks the WAL reader pool and current secondary writers. Offline backup already fits; live external tooling and tests using parallel writable handles must become owner-mediated or offline. |
| **Effect-time relation identity from an unforgeable root** | Can detect that the credential relation is no longer the one authenticated by the root. A MAC/commitment can additionally detect row modification. | A root stored only in the same SQLite file is forgeable by the raw writer. Checking name, SQL text, shape, root page, or the present resource-guard blobs is not an unforgeable root. Identity-only checks do not detect direct `UPDATE` of the original credential table. | An external key/anchor or service, restart-stable identity, key rotation, backup/restore handling, anti-rollback policy, and migration of every legitimate credential writer. A same-process hostile-native threat generally defeats a process-memory key too. |
| **Schema-shape enforcement on every effect** | Refuses the reported rename-and-view attack and other schema substitution visible through kind/shape/trigger checks. Because validation occurs after `BEGIN IMMEDIATE`, another SQLite writer cannot race a schema commit into that transaction. | Direct row tampering, or replacing the table with a new exact-shaped table containing attacker rows. It is validation, not custody. | Re-run at least a targeted `main.sqlite_schema` kind/identity check and exact `table_xinfo` before proof verification. The current full validator scans `database_list`, `table_list`, both schema catalogs, and three table shapes ([registry.rs:42](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/authority_transition/core/registry.rs:42)); doing all of that per effect adds several prepares and an O(schema-object-count) scan. Benchmark before choosing full versus targeted validation. |
| **Documented registered-connection boundary** | Protects against accidental/missed writes by trusted repository code routed through the gateway. This matches the existing self-hosted native trust posture. | Malicious native code with the path, a raw same-user process, old binaries, or external SQLite tooling. | State the limit in LLP 0313 and every receipt/claim; inventory and mechanically close supported writer paths; keep arbitrary file writers explicitly out of scope. The current “cross-connection” test and Landing C claim must be renamed/scoped so they cannot be read as file-level protection. |

I separately executed the reported view shape in in-memory SQLite. The replacement object reported `type=view`, and its columns reported `notnull=0, pk=0`; the current validator expects `user_id` at primary-key position 1 and the digest/generation columns `NOT NULL` ([registry.rs:131](/Users/ccheever/lanes/revA4/crates/snapback-kernel/src/storage/authority_transition/core/registry.rs:131)). Therefore effect-time reuse of that validator would catch this exact attack. It would not solve the intrinsic defect.

## Q4 — Actionable landing ruling

Landing A’s table claims only “additive/inert infrastructure” and expressly makes no F-1 closure claim ([LLP 0313:288](/Users/ccheever/lanes/revA4/llp/0313-authority-creation-chokepoint.spec.md:288), [LLP 0313:304](/Users/ccheever/lanes/revA4/llp/0313-authority-creation-chokepoint.spec.md:304)). Therefore:

- **Do not attempt to close file custody in Landing A.**
- **Do not accept Landing A as proving same-file cross-connection refusal.**
- Landing A may close only after “cross-connection authorization” in its runtime acceptance is defined as *one guarded handle’s scope does not arm another guarded handle*, matching what its test actually executes ([LLP 0313:382](/Users/ccheever/lanes/revA4/llp/0313-authority-creation-chokepoint.spec.md:382)).
- If refusing the reported rename/view mutation is desired as defense in depth, add effect-time table-kind/shape validation, but record that it is not raw-writer protection.
- Before Landing C’s “durable forgery cut” claim ([LLP 0313:306](/Users/ccheever/lanes/revA4/llp/0313-authority-creation-chokepoint.spec.md:306)), complete or atomically incorporate LLP 0311’s resource coordinator, writable gateway, open-path inventory, migration, and cooperative process-lock work.
- If hostile raw same-user file access is in scope, even LLP 0311’s advisory lease is insufficient; the deployment must add an OS/service boundary. LLP 0311 says this directly ([LLP 0311:512](/Users/ccheever/lanes/revA4/llp/0311-authorization-interlock-resource-binding.rfc.md:512)).

**Bottom line:** the current architecture works as a connection-local enforcement component inside an existing custody boundary. It cannot itself be that custody boundary. Landing A can remain an inert substrate; the reported defect must be closed—or explicitly excluded—before Landing C makes a durable authorization claim.

Analysis was performed at `bdc5e6a671a0c16c60f13bbfe2d71789c3b04baa`. The worktree remains unchanged.