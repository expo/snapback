# LLP 0284: Workspace security-gate threat model and specification

**Type:** Spec
**Status:** Accepted
**Systems:** Security/authorization, Build, Verification, Packaging, Rust core
**Author:** Grok 4.6 (xAI) — independent of the LLP 0276 implementer lane; commissioned by LLP 0283 F-2
**Date:** 2026-08-19
**Revised:** 2026-08-25 (narrows the activation and server storage imports to
crate visibility; their compiler witnesses now require `E0603` at the attempted
module mount rather than relying on a later private factory refusal.)
**Revised:** 2026-08-21 (closes the embedded Guide generated-API exception:
`build.rs` emits one versioned length-prefixed binary artifact, committed code
consumes it only with `include_bytes!` and parses inert bytes into lazy public
values, the obsolete shape manifest is retired, and the last allowlist row is
deleted.)
**Revised:** 2026-08-21 (follow-up decoder hardening requires the committed
Guide corpus closure and UTF-8 text, recomputes the established content digest
from decoded records, anchors it to the directly included committed manifest,
and reconciles the retired generated-API producer-drift requirements with the
remaining producer-data trust.)
**Revised:** 2026-08-19 (implemented by the independent F-2 lane: a dedicated
non-workspace syn helper, metadata-derived 47-cell scanner, rustc JSON span
witnesses, canonical compilation-unit ownership, negative-corpus gate, and the
temporary expected-red cadence ruling in §7)
**Revised:** 2026-08-19 (independent adversarial fix round: extends the threat
model with caller-constructible authority discriminators after the newly
observed `MembershipWriter::Admin` escalation; replaces the unsound additive
feature matrix with symbolic caller-feature predicate coverage; closes ordinary
alias/private-re-export/trait, nested-`cfg_attr`, macro/build-generation,
fixture-inventory, rustc-infrastructure, and receiver-obtainability gaps)
**Revised:** 2026-08-19 (final adversarial hardening: expands local private
re-export globs and non-function items, propagates obtainability through an
obtainable seed receiver, joins fixture source references to claimed mounts,
retains both Unix and Windows target predicates, narrows I-16 to its actual
direct-signature check, and records the remaining scanner evasions in §3.7)
**Revised:** 2026-08-19 (surgical final hardening: resolves `crate::`/`super::`
local re-exports, covers raw-handle conversion impls in either trait/self
position, replaces the dead transition-provenance sink spelling, and makes
unresolved privilege-sink registry entries a distinct gate violation)
**Revised:** 2026-08-19 (an attempted snapback-server embedded Guide expansion
proof compiled and executed `build.rs`; the next revision records why
independent review rejected and removed it)
**Revised:** 2026-08-19 (independent review rejected that expansion proof: it
executed the producer with ambient host authority and gate-distinctive inputs;
the executable path is removed, the exact expiring review row is restored and
pinned to Cargo's actual custom-build source digest, and qualified/aliased/local
wrapper `include!` spellings are fail-closed within the limits in §3.7)
**Revised:** 2026-08-19 (second independent fix round: scans generated Rust
includes in module, impl, trait, and foreign item positions, including nested,
conditional, and literal parameter-forwarded forms; narrows I-14 to that
syntactic ratchet; and rejects execution of an untrusted producer as a future
proof design)
**Revised:** 2026-08-20 (residual hardening seeds renamed privilege imports
and discovers public-API macro definitions across the crate module tree; the
remaining cross-crate, trait-substitution, expansion, and I-16 limits are
restated as literal evading programs rather than implied coverage)
**Revised:** 2026-08-20 (records the attempted replacement of the expiring
Guide generated-API review with a committed, syn-shaped, digest-pinned API
artifact; its typed-expression premise is rejected by the next revision)
**Revised:** 2026-08-20 (independent rustc review disproves the typed-expression
closure premise: block expressions may contain non-local inherent impls; the
exact 2026-09-19 generated-API review debt is restored, while raw identifiers
are canonicalized across privilege names, macros, compilation units, and the
committed artifact's forbidden-identifier catalog)
**Revised:** 2026-08-20 (restores exact built-in macro path recognition after
raw normalization widened qualified `include!`, `concat!`, and `env!` paths;
keeps foreign qualified includes fail-closed and keeps `r#pub` distinct from
the visibility keyword)
**Revised:** 2026-08-20 (F-3 fix-forward: R-2 now distinguishes LLP 0285's
audited, identity-only `DatabaseBinding` from opaque privilege candidates;
the negative corpus pins that exact powerless carrier while retaining the
generic return-and-consume heuristic.)
**Revised:** 2026-08-20 (F-3 fix-forward: compile witnesses are retargeted
after LLP 0285 §6 steps 1–4 so privatized claim/clone/join paths reject at the
marked attack while surviving `ServingDatabase` admissions and factories keep
compiling red; the current 102-finding/15-attack record is in the F-1 ticket.)
**Revised:** 2026-08-20 (qualified `std::`/`core::` macro paths no longer
receive built-in semantics from spelling alone; the syn-only ownership checker
cannot prove those roots are unshadowed, so qualified includes fail closed as
unevaluable, with local-module and renamed-import `std` fixtures.)
**Related:** LLP 0283 (F-1, F-2), LLP 0276, LLP 0225, LLP 0189, LLP 0232, LLP 0141, LLP 0041, LLP 0059, LLP 0154, LLP 0009

## Summary

The three workspace security gates landed with LLP 0276
(`scripts/check-security-boundaries.mjs`,
`scripts/check-kernel-raw-sql-api.mjs`,
`scripts/check-cross-crate-path-includes.mjs`) report PASS on
`ede899a20` while three live privilege escalations exist in the tree. They
fail because they encode the implementer's leftover spellings, not a threat
model: six compile-fail fixtures against retired APIs; a text scan of kernel
`pub fn` signatures that misses by-value returns, re-exports, other crates,
and caller-selectable features; a `#[path]` regex that misses raw strings and
does not resolve symlinks.

This document is the independent threat model and the specification the
rewrite must implement. It is not a patch and not an F-1 authorization-model
fix. A rewrite that does not go **RED on `ede899a20` as it stands** is not
this specification. After F-1 closes the three escalations, the same suite
must stay red on any reintroduction.

The 2026-08-19 adversarial fix round found a fourth escalation that did not
exist in this specification's original seed-type model: public
`MembershipWriter` variants let a dependent choose `Admin`, `Seed`, or
`Import`, enter privileged planning, select the sanctioned commit gate, and
stamp authoritative provenance. This revision deliberately **extends** the
specification: caller-constructible data may not select a privileged lane or
authoritative provenance, even when it never yields one of the original seed
types. The first adversarial revision described I-16 as registered-sink taint
analysis. That was an overclaim: the implementation only intersects public-
constructible type names directly present in a fixed registry of sink
signatures. This final revision calls it a direct-signature constructibility
ratchet and records body indirection and sink renaming as explicit limits.

Inspection technique, pinned to this repository's toolchain: **syn-parsed
Rust plus `cargo metadata` plus `rustc --message-format=json` span
assertions.** rustdoc JSON is the conceptually preferred public-API surface,
but it is **not available** on the pinned `rustc 1.97.0` toolchain
(`--output-format json` requires `-Z unstable-options`; `-Z` is nightly-only;
`rust-toolchain.toml` pins `channel = "1.97.0"`). Do not take a nightly
override to obtain rustdoc JSON. If `--output-format json` later stabilizes
on the pinned channel, the scanners may switch to it; the invariants below
do not change.

## 1. Independence and method

This spec was authored by reading the live APIs, manifests, and the three
gate scripts at `ede899a20`, together with LLP 0276 (crate matrix, port
inversion rule, rusqlite confinement), LLP 0225 §2–§3 (dependency direction
and commit boundaries), and LLP 0283 F-1/F-2 (the defects and the rewrite
charge). It does not treat the existing gates' allowlists, fixture names, or
"four audited seams" framing as normative. Where those gates happen to be
right, they are restated from the threat model, not inherited.

Verified against the tree, not against the F-2 brief's paraphrase:

| Claim | Independent check at `ede899a20` |
| --- | --- |
| `LocalDatabase::claim_kernel_commit_authority` is `pub` | `crates/snapback-kernel/src/storage.rs:2158` |
| `KernelCommitAuthority::admit_system_push` is `pub` | `crates/snapback-kernel/src/push.rs:44` |
| `admit_protected_record_erasure` is `pub` | `crates/snapback-kernel/src/proof_checkpoint.rs:769` |
| `admit_pending_effect_creation` (and decision/settlement/refusal) are `pub` | `crates/snapback-kernel/src/storage/pending_effects.rs:210` |
| `snapback-auth` re-exports the whole kernel `storage` module | `crates/snapback-auth/src/lib.rs:9` |
| Closure factories for authorization carriers are `pub` | `crates/snapback-kernel/src/storage.rs:745` (`reservation`, `prepared`) |
| `ServiceAuthorityCommitInterlock` is constructible from an arbitrary callback | `crates/snapback-kernel/src/auth/service_fence.rs:41,98` |
| That interlock is installable | `crates/snapback-kernel/src/storage.rs:2294` |
| `remainder-tests` re-exports `rusqlite` | `crates/snapback-services/src/lib.rs:38` and `crates/snapback-services/Cargo.toml:18` |
| The six fixtures attack retired spellings | `tests/fixtures/security-boundaries/src/bin/*.rs` vs. the APIs above |
| `snapback-conformance` is named in the fixture metadata and absent from fixture deps | `tests/fixtures/security-boundaries/Cargo.toml` vs. `[dependencies]` |
| `snapback-conformance` also does not depend on the kernel in the product graph | `crates/snapback-conformance/Cargo.toml` depends on `snapback-engine` and `snapback-types` only |
| By-value `Connection` return is unmatched by the SQL-api regex | `scripts/check-kernel-raw-sql-api.mjs:33` requires `&` / `,` / `>` / `)` after the type, not `-> Connection` |
| Raw-string `#[path]` is unmatched | `scripts/check-cross-crate-path-includes.mjs:41` |
| rustdoc JSON unavailable on the pin | `rustdoc --output-format json` → needs `-Z`; `-Z` rejected on 1.97.0 |

Additional live facts the F-2 brief does not name and this spec treats as
in-scope:

1. **Wholesale `storage` re-exports above the kernel.** Besides
   `snapback-auth` (`crates/snapback-auth/src/lib.rs:9`),
   `snapback-activation` (`crates/snapback-activation/src/lib.rs:9`),
   `snapback-engine` (`crates/snapback-engine/src/lib.rs:12`), and
   `snapback-server` (`crates/snapback-server/src/lib.rs:14`) all `pub use`
   `snapback_kernel::storage`. A direct
   dependent of any of those four crates names `LocalDatabase` and
   `claim_kernel_commit_authority` without a kernel dependency of its own.
   `snapback-services` and `snapback-sync` correctly use `pub(crate) use`
   for `storage`. The rank-7 façade `snapback` does **not** re-export
   `LocalDatabase` (its `storage` module is a narrow DTO surface in
   `crates/snapback/src/lib.rs:334`).
2. **`remainder-tests` is a feature of the library crate, not of a test
   harness**, and it enables `snapback-kernel/test-support`
   (`crates/snapback-services/Cargo.toml:18`). That feature publishes
   `push::test_support::{authorize_send_in, resolve_audience_in}` taking
   `&Transaction` (`crates/snapback-kernel/src/push.rs:2977`),
   `AuthorizationCommitCarrierFactory::for_test`
   (`storage.rs:746`, which itself calls `claim_kernel_commit_authority`),
   `join_kernel_commit_authority_for_test` (`storage.rs:2182`),
   `attempt_unmediated_app_insert_for_test` (`storage.rs:2544`, return type
   `rusqlite::Result<usize>`), and
   `RecordingServiceAuthorityCommitInterlock::bind`
   (`auth/service_fence.rs:173`) which builds a real
   `ServiceAuthorityCommitInterlock`.
3. **Clone on the privilege-bearing roots and factories**, contradicting
   the non-clonability requirement recorded in LLP 0283 F-1:
   `KernelCommitAuthority` (`storage.rs:537`),
   `AuthorizationCommitCarrierFactory` (`storage.rs:730`),
   `PushStorageAuthority` (`push.rs:30`),
   `ServiceAuthorityTerminalFactory` (`auth/service_fence.rs:36`),
   `ServiceAuthorityCommitInterlock` (`auth/service_fence.rs:63`). The
   take-once registry is a process-wide `BTreeSet` of file identities
   (`storage.rs:562`); cloning the minted value duplicates mint capability
   without re-claiming. `Default` / `Deserialize` are **not** presently
   implemented on `KernelCommitAuthority`; they must still be fixtures so
   adding them is a detectable regression.
4. **The engine already claims the root in a private constructor**
   (`LocalSnapback::from_database` at
   `crates/snapback-engine/src/local/engine.rs:24197`). That is the
   authorized adapter LLP 0276's port-inversion rule describes. The
   kernel method being `pub` is what makes the claim stealable *before*
   engine construction, or on a `LocalDatabase` that never enters the
   engine.
5. **The path-include walk skips symlink dirents.**
   `Dirent.isFile()` is false for a symlink-to-file
   (`scripts/check-cross-crate-path-includes.mjs:19`), so a
   `crates/<pkg>/src/foo.rs` symlink is not scanned at all. The brief's
   "checked lexically" description understates the hole.
6. **The SQL-api allowlist treats a `test-support` function as a
   production seam.** `push.rs:authorize_send_in` on the allowlist is the
   public wrapper at line 2982, gated on `test-support`, not the
   `pub(crate)` owner at line 2831. The current gate cannot see `cfg`.
7. **The R-2 seed heuristic finds two more existing opaque carriers.**
   `LocalDatabase::prepare_promotion_contention_reservation_for_bench`
   returns `PromotionContentionReservation`, which another public
   `LocalDatabase` method consumes; `LocalDatabase::reserve_ask_spend`
   similarly returns `AskSpendReservation`, which
   `LocalDatabase::settle_ask_spend` consumes. Both types have private
   fields. They join I-1's seed list and the compile-fail witness inventory;
   this records scanner-derived closure rather than suppressing it.

## 2. Threat model

### 2.1 Adversaries

The gates constrain **Rust crate boundaries inside this workspace and,
once packages are published, the public API of those packages.** They do
not constrain a hostile edit to `snapback-kernel` itself.

**(a) A workspace crate that is a direct dependent.** Any of the other
twelve workspace members, or a thirteenth member added later, that lists
`snapback-kernel`, `snapback-auth`, `snapback-activation`,
`snapback-engine`, `snapback-server`, or `snapback-services` in its
manifest. This adversary writes ordinary Rust against public items. It
cannot edit the kernel crate. It *can* add or enable Cargo features on
its dependencies, including features the dependency author marked
"for tests". It *cannot* add a direct `rusqlite` dependency unless it is
`snapback-kernel` or `snapback-services`, because
`crates/allowed-dependencies.v1.json` `externalConfinement` plus
`scripts/check-workspace-graph.mjs` forbid it. Therefore a public
re-export of `rusqlite` from an allowed member **is** an escalation: it
bypasses confinement without a `rusqlite` dependency key.

**(b) A future third-party crate depending on published packages.** All
thirteen crates are `publish = false` today (LLP 0276). LLP 0041 still
commits to publishing; LLP 0141 names `snapback::embed` as the sole
supported Rust surface. This adversary depends on whatever is published
(`snapback` at minimum; possibly more). It can also depend on crates.io
`rusqlite` **independently**. Crate privacy cannot stop a third party
that has filesystem access to the canonical SQLite file from opening a
second connection and bypassing the kernel authorizer (authorizers are
per-connection). What crate privacy **can** stop is forging Snapback's
own capability types and stealing the kernel's already-open handle or
mint root through the published API. The gates cover that second
property. Filesystem-and-independent-rusqlite is §2.5 out of scope.

**(c) A well-meaning future contributor who adds a `pub` by accident.**
The same surface as (a), motivated by "it won't compile across the crate
boundary unless this is `pub`" during a carve, a test move, or a
port inversion. This is the dominant failure mode named in LLP 0283's
method lessons. The gates must fail closed on an accidental `pub`,
`#[derive(Clone)]`, `pub use`, or feature-gated re-export without
requiring a human to write a new fixture first.

Non-adversaries, for clarity: a kernel contributor who can land any
`pub` they want inside `crates/snapback-kernel` is out of scope as an
attacker (§2.5). The gates still have to catch the *result* of that edit
when it expands the public privilege surface, because (c) is that
contributor.

### 2.2 Assets

These are the values whose obtainability outside the authorizing adapter
is the escalation.

| Asset | Defining type / location | Why it is an asset |
| --- | --- | --- |
| Writable canonical-store SQLite handle | `rusqlite::Connection`, `rusqlite::Transaction` on the application/auth/schema store | LLP 0225 §3.1 / LLP 0276: only the kernel owns canonical-store transactions. A second writable handle bypasses writer-authority, authorizer, and typed commit operations. |
| Commit-authority root | `snapback_kernel::storage::KernelCommitAuthority` (`storage.rs:538`) | Mint root for every admission carrier. Take-once on `LocalDatabase` is ordering, not authorization (LLP 0283 F-1). |
| Authorization commit carriers | `AuthorizationCommitReservation`, `PreparedAuthorizationCommit`, `AuthorizationCommitCarrierFactory` (`storage.rs:608,682,731`) | Callers who construct these from arbitrary closures install a terminal that always reports success — the retired self-implementable trait, restored as a factory. |
| Service-authority fence | `ServiceAuthorityCommitInterlock`, `ServiceAuthorityTerminalFactory`, `PreparedServiceAuthorityTerminal` (`auth/service_fence.rs`) | Same factory pattern for service-token settlement. |
| Push admission carrier | `PushStorageAuthority` (`push.rs:31`) | `admit_system_push` produces the System fact the engine adapter was written to keep unforgeable (`crates/snapback-engine/src/push.rs:26`). |
| Protected-erasure admission carrier | `ProtectedRecordErasureAuthorityV1`, `ProtectedRecordErasureRequestV1` (`proof_checkpoint.rs:660,759`) | `admit_protected_record_erasure` accepts arbitrary strings and calls private `from_admitted_facts`. |
| Pending-effect commands | `CreatePendingEffectCommand`, `DecidePendingEffectCommand`, `SettlePendingEffectCommand`, `RefusePendingEffectCommand` (`pending_effects.rs:180`) | `LocalDatabase::create_pending_effect` now requires the command; the mint is `KernelCommitAuthority::admit_pending_effect_*`. |
| Privileged authority discriminators | `MembershipWriter` and any future caller-data type accepted by a registered sanctioned/bypass/provenance sink | A dependent can construct a public enum variant such as `Admin` or `Seed`; privileged planning, `MembershipCommitAuthority::sanctioned`, and provenance stamping then trust that caller-selected class even though no I-1 seed type crosses the API. |
| The `rusqlite` crate as a public name | `snapback_services::test_support` (`lib.rs:40`) and any future `pub use rusqlite` | Lets adversary (a) name `Connection::open` / `Transaction` without a confined dependency key. |

The telemetry sibling database (LLP 0154 / LLP 0225 §3.1) is an
**independently governed sidecar**. `snapback-services` is allowed to
depend on `rusqlite` for that sidecar. It is **not** allowed to hand a
caller a `rusqlite::Connection` to the *canonical* store, nor to
re-export the `rusqlite` crate from a library feature.

### 2.3 Trust boundaries

```
adversary crate (a, b, or c)
        |  public Rust API, including feature-gated items
        |  public re-exports
        |  Cargo features the adversary may enable
        v
workspace package graph (cargo metadata resolve)
        |
        +-- snapback-types          rank 0   no privilege assets
        +-- snapback-kernel         rank 1   OWNS the assets; pub(crate) is the fence
        +-- snapback-auth           rank 2   policy; must not re-export the mint root
        +-- snapback-activation     rank 3   composes kernel commits; must not re-export the mint root
        +-- snapback-services       rank 3   rusqlite allowed for sidecar only; must not re-export rusqlite
        +-- snapback-sync           rank 3
        +-- snapback-runtime        rank 3   kernel-free
        +-- snapback-engine         rank 4   THE authorized adapter (LocalSnapback claims the root privately)
        +-- snapback-server / cli   ranks 5–6
        +-- snapback                rank 7   supported façade (LLP 0141); doc(hidden) is not a fence
        +-- snapback-conformance / tools   rank 7 non-product
```

Compiler-enforced inside one crate: `pub(crate)`, private fields, sealed
traits with crate-private `Sealed`. Not compiler-enforced across crates:
anything `pub`, including `#[doc(hidden)] pub`, `#[cfg(feature = "...")]
pub`, and `pub use`.

`#[doc(hidden)]` is explicitly **not** a trust boundary (LLP 0141
already records this for the façade; it is true of every crate).
Scanners must include hidden public items.

Cargo features are **not** a trust boundary. Features are public,
additive, and caller-selected. A gate that inspects only default
features cannot see defect #3.

`cfg(test)` is a trust boundary **for that crate's own unit tests**
(`cargo test -p snapback-kernel` may see `pub(crate)` and `#[cfg(test)]`
items). It is **not** a boundary for dependents: a dependent's
`cfg(test)` does not unlock the kernel's `cfg(test)` items. `feature =
"test-support"` **does** unlock them for dependents, and is therefore in
scope.

### 2.4 What a successful attack looks like

An attack succeeds if a crate outside `snapback-kernel` can, using only
public API of some workspace package (possibly with features the
attacker enables), do any of:

1. Obtain a value of type `rusqlite::Connection` or `rusqlite::Transaction`
   that refers to the canonical store, or name `rusqlite` through a
   workspace package's public API well enough to `Connection::open` the
   canonical path the kernel already opened.
2. Obtain a `KernelCommitAuthority` for a `LocalDatabase` it constructed
   (`LocalDatabase::memory` / `open` are `pub` at `storage.rs:1805,1844`)
   and then mint any admission carrier (`admit_*`) or install a
   caller-built interlock.
3. Construct `AuthorizationCommitReservation`,
   `PreparedAuthorizationCommit`, or `ServiceAuthorityCommitInterlock`
   from caller closures, or `Clone` an obtained root/factory.
4. Compile another crate's `.rs` into itself via `#[path]`, `include!`,
   or a symlink, so `pub(crate)` and private items of the victim crate
   become items of the attacker crate.
5. Construct caller-controlled data whose enum variant, tuple/unit
   constructor, or public fields select a privileged/sanctioned lane or the
   provenance recorded as authoritative, then carry that selection through
   planning and commit without conversion to a kernel-derived unforgeable
   carrier and commit-time revalidation.

### 2.5 Out of scope

- A hostile patch to `crates/snapback-kernel/**` that lands by ordinary
  review failure. The gates must still **detect the resulting public
  surface** (adversary (c)); they cannot prevent the kernel authors from
  compiling their own crate.
- Independent crates.io `rusqlite` used by adversary (b) against a
  filesystem path the process can open. OS file permissions, sandboxing,
  and "do not publish the store path" are separate controls. The
  workspace confinement gate already covers adversary (a) adding
  `rusqlite` as a dependency key.
- Handler-JS / Ibex / hosted-edge execution (LLP 0009, LLP 0060).
  Different adversary, different assets.
- SQL injection inside kernel-owned query builders. In-scope here is
  *who holds the handle*, not whether a typed query is parameterized.
- `pub(crate)` leaks via rustc bugs.
- Supply-chain compromise of `rusqlite` / `libsqlite3`.
- The telemetry sidecar's own connection, so long as it is not
  re-exported and does not attach the canonical store.

## 3. Invariants

Each invariant is written so a machine can decide pass/fail. **CE** =
compiler-enforced once F-1 (and this rewrite) have made the API private
enough that the compile-fail fixtures fail at the attack span. **SC** =
scanner-enforced approximation; the compiler will not refuse the pattern
on its own. Where enforceability is uncertain, the row says so.

The suite is RED on `ede899a20` because I-1, I-2, I-3, I-5, I-6, I-7,
and I-9 fail today.

### 3.1 Capability obtainability (the closure, not the spellings)

**I-1 (CE after F-1; SC always).** From any crate other than
`snapback-kernel`, with any combination of that crate's declared
features plus any features it may enable on its workspace dependencies,
the following seed types are not publicly obtainable:

- `snapback_kernel::storage::KernelCommitAuthority`
- `snapback_kernel::storage::AuthorizationCommitCarrierFactory`
- `snapback_kernel::storage::AuthorizationCommitReservation`
- `snapback_kernel::storage::PreparedAuthorizationCommit`
- `snapback_kernel::auth::service_fence::ServiceAuthorityCommitInterlock`
- `snapback_kernel::auth::service_fence::ServiceAuthorityTerminalFactory`
- `snapback_kernel::auth::service_fence::PreparedServiceAuthorityTerminal`
- `snapback_kernel::push::PushStorageAuthority`
- `snapback_kernel::proof_checkpoint::ProtectedRecordErasureAuthorityV1`
- `snapback_kernel::proof_checkpoint::ProtectedRecordErasureRequestV1`
- `snapback_kernel::storage::pending_effects::{Create,Decide,Settle,Refuse}PendingEffectCommand`
- `snapback_kernel::fork_promotion_bench::PromotionContentionReservation`
- `snapback_kernel::storage::ask_spend::AskSpendReservation`

"Publicly obtainable" is the least fixpoint of:

1. A `pub` function, associated const, or associated function whose return
   type is the seed type (including `Option<T>`, `Result<T, _>`, `Arc<T>`,
   tuples, and boxed trait objects that mention `T`); or a `pub` receiver
   method returning it when the receiver/container is itself obtainable
   without first consuming that same seed. Returning a take-once value from
   the private-state container created by consuming it is not a mint. This is
   why `ManagedAuthorizationReservationScope::take_unused` is not an I-1
   finding: the scope has no independent public constructor and only
   `AuthorizationCommitReservation::install(self)` can create one.
2. A `pub` struct/enum field of type `T`.
3. A `pub` type alias or re-export of `T`.
4. `Default::default()`, `Deserialize`, `From`/`Into`/`TryFrom`,
   `FromIterator`, or a `pub fn new` / `from_*` / `claim_*` /
   `admit_*` / `mint_*` on a publicly constructible type that returns
   `T`.
5. `Clone` / `Copy` of an already-obtainable `T`.
6. A `pub` constructor that takes caller `Fn`/`FnMut`/`FnOnce` /
   `impl Fn...` and returns `T` (the factory pattern).
7. A `pub use` chain that makes any of (1)–(6) nameable through another
   crate (`snapback_auth::storage::LocalDatabase` is the same obtainability
   as `snapback_kernel::storage::LocalDatabase`).

`LocalDatabase::memory`/`open` being `pub` is not itself I-1; those
construct a store. `claim_kernel_commit_authority` being `pub` is I-1.
Today's tree fails I-1 at `storage.rs:2158` plus every `pub use storage`
listed in §1.

**I-2 (CE after F-1; SC always).** No crate other than
`snapback-kernel` can invoke `admit_*` on a `KernelCommitAuthority` it
obtained, because it cannot obtain one (I-1). After F-1, the intended
shape is: admission is co-located with the kernel operation or requires
a kernel-verifiable proof (LLP 0283 F-1 direction). The gates do not
mandate a particular F-1 design; they mandate that the three listed
escalations stop compiling from a direct dependent.

**I-3 (CE after F-1; SC always).** No public constructor of
`AuthorizationCommitReservation`, `PreparedAuthorizationCommit`,
`ServiceAuthorityCommitInterlock`, or `PreparedServiceAuthorityTerminal`
accepts a caller-supplied callback. Kernel-internal `pub(crate)`
factories are allowed. `#[cfg(test)]` factories inside
`snapback-kernel` are allowed. `feature = "test-support"` factories
visible to dependents are **not** allowed on a library crate that
adversary (a) or (b) can depend on.

**I-4 (CE; SC as backstop).** Seed types in I-1 have private fields and
no public constructor. This is already true of
`KernelCommitAuthority`'s fields. It is **not** sufficient, which is
why I-1 exists: private fields plus a public mint is today's defect #1.

### 3.2 Raw SQLite

**I-5 (SC; CE only for the compile-fail fixtures that name `rusqlite`
through a workspace package).** No workspace package other than
`snapback-kernel` publicly names `rusqlite::Connection` or
`rusqlite::Transaction` in a public item, and `snapback-kernel` does not
publicly *egress* those types.

Egress (forbidden, any crate, any feature) — a public item that lets a
dependent *obtain* a handle:

- `pub fn` / method / associated fn returning `Connection` or
  `Transaction` by value, by `&`, by `&mut`, in `Option`/`Result`/tuple
  / `Arc`/`Box`, including through type aliases.
- `pub` struct/enum field of those types (`MaterializedBase.conn` is
  `pub(crate)` today at `branches.rs:374` — keep it that way; the old
  fixture against `pub conn` remains).
- `pub use rusqlite` / `pub use rusqlite::*` / `pub use rusqlite::{Connection, ...}`
  / `pub extern crate rusqlite`.
- `pub type` alias to those types.
- Trait method, associated type, or associated const doing any of the
  above.
- `impl From/Into/TryFrom` / `Deref` / `AsRef` / `AsMut` exposing them.

Ingress (not an escalation by itself; scanned, allowlist-gated): a
public function that *accepts* a caller-supplied `Connection` /
`Transaction`. The remaining tree has only feature-selected test ingress:

- `push::test_support::{authorize_send_in, resolve_audience_in}` taking
  `&Transaction` under `test-support`.

Ingress does not give the caller a handle they did not already have. It
*does* keep raw SQL in the public signature, which forces dependents
that call it to name `rusqlite` (or receive the type through another
leak). After F-1 / test-harness relocation, ingress should exist only as
`pub(crate)` or inside a non-published harness crate that has its own
direct `rusqlite` *dev-dependency*. Until then, ingress items are
**explicit allowlist entries with ticket and expiry**, not silent
exceptions. They are **not** the point of the gate (that was the old
framing).

**I-6 (SC + workspace-graph; CE for the compile-fail fixture).** The
`rusqlite` crate is not a public name of any workspace package's library
API under any feature. `snapback-services/remainder-tests` fails I-6
today. `snapback-services` remaining in
`externalConfinement.allowedMembers` for `rusqlite` is about *depending
on* the crate for the telemetry sidecar, not about re-exporting it.

**I-7 (SC).** I-5 and I-6 are evaluated under §4.4's symbolic caller-feature
predicate coverage, including configurations with default features disabled.

### 3.3 Duplicability

**I-8 (CE after removing the derive; SC always).** None of the I-1 seed
types implements `Clone`, `Copy`, `Default`, or `serde::Deserialize`
unless a dedicated allowlist row says duplicability is safe and names
the owning RFC. Today I-8 fails for Clone on the types in §1 item 3.
`AuthorizationCommitReservation` and `PreparedAuthorizationCommit` do
not implement Clone (they hold `FnOnce`); keep that.

### 3.4 Re-exports and façades

**I-9 (SC; CE for compile-fail mounts through the re-export crates).**
No crate above rank 1 `pub use`s `snapback_kernel::storage` (the module)
or any I-1 seed type. Narrow DTO re-exports (`StorageInfo`,
`RehearsalStatusV1`, job DTOs) are allowed when the re-exported names
are not in the I-1 seed and not `LocalDatabase`.
`#[doc(hidden)]` does not exempt a re-export.

**I-10 (SC).** `snapback` (rank 7 façade) does not re-export I-1 seed
types or `LocalDatabase`. Today this holds for the façade's `storage`
module; the gate must keep it true. `#[doc(hidden)] pub mod local`
re-exporting `snapback_engine::local::*` is in scope: if `LocalSnapback`
gains a public `claim_*` or a public field of an I-1 type, I-1/I-9 fail.

### 3.5 Compilation-unit ownership

**I-11 (SC; rustc will happily compile the result).** Every `.rs` file
that rustc compiles as part of workspace member `C` has a canonical
realpath inside `C`'s crate root (the directory that contains that
member's `Cargo.toml`, realpathed). This includes:

- the file named by `src`, `[[bin]]`, `[[test]]`, `[[example]]`,
  `[[bench]]` in the manifest and by `mod` items;
- every `#[path = "..."]` target, after unescaping the string
  (ordinary, raw, raw-hash);
- every `include!(...)` target that resolves to a `.rs` file;
- any of the above that is a symlink.

`include_str!` / `include_bytes!` of non-Rust data are out of I-11.
`include!(concat!(env!("OUT_DIR"), ...))` is in I-11: `OUT_DIR` must
resolve inside `target/` for that package, not inside another crate's
`crates/<member>/src/` tree.

### 3.6 Inventory honesty

**I-12 (SC, cargo metadata).** The compile-fail fixture package's
*resolved dependency keys* (normal + build + dev, from `cargo metadata`
on the fixture manifest) are exactly the set of workspace library
packages whose public API the suite claims to constrain, derived from
`cargo metadata` on the **product** workspace, not from a
hand-maintained list in `[package.metadata.*]`. Naming a crate in
metadata without depending on it fails I-12. Depending on a crate
without mounting at least one fixture through a public path of that
crate (or an explicit "no privilege surface" waiver that the scanner
has confirmed empty) fails I-12. Each attack's declared source must be the
declared Cargo bin source and its parsed Rust paths must actually reference the
dependency crate named by `mount`; the free-form mount string is not evidence.

**I-13 (SC).** A compile-fail fixture passes only if rustc emits at least one
`compiler-message` error and a primary diagnostic whose span overlaps the
fixture's marked attack expression. A nonzero Cargo exit with no rustc error
record is infrastructure failure (exit 2), not a compile-fail result. An
offline-cache miss, manifest error, or target/build lock may never masquerade
as security evidence. An unrelated error whose message matches a regex is a
**fail**. Successful compilation of a product-attack fixture is a
**fail**.

### 3.7 What is not an invariant (honest limits)

- **The embedded Guide is no longer a generated-Rust exception.** The rejected
  proof history remains instructive: compiling or executing a custom-build
  source under audit cannot bind what an ordinary Cargo build receives, and a
  typed block expression can contain non-local inherent impls. The landed
  boundary eliminates that premise instead of trying to prove it. `build.rs`
  emits one versioned, length-prefixed binary artifact; committed
  `snapback-server::guide` consumes it only through `include_bytes!` and parses
  its opaque file bytes into lazy values. Bytes spelling an `impl`, macro, or
  any other Rust item remain byte-string content and cannot alter the public
  API. The old wrapper/producer shape manifest and
  `embedded-guide-generated-table` allowlist row are retired; the allowlist is
  empty. The gate still never compiles or executes `build.rs` as audit evidence.

  The served-content half of the old producer-drift requirement survives in a
  different mechanism. `crates/snapback-server/src/guide_artifact.rs` is the single committed source
  for the minimum required path set used by both `build.rs` and the decoder.
  Before exposing any record, the committed decoder requires that closure, at
  least one section flat, canonical strictly sorted paths, UTF-8 for every
  Markdown/JSON record, and a valid embedded manifest. It recomputes LLP
  0194's established `contentHash` domain from the decoded whole flat, symbol
  registry, and diagnostics registry; the computed digest, stored 64-byte
  field, embedded manifest `contentHash`, and `contentHash` read directly by
  committed Rust from `guide/guide-manifest.generated.json` must all agree.
  Thus producer retargeting or corruption cannot silently change a hash-bound
  served record while retaining the committed Guide identity.

  This deliberately does **not** restore a custom-build source/target digest
  check. That check justified an expiring generated-Rust API exception; after
  elimination there is no producer-created Rust API and therefore no API shape
  or forbidden-identifier evidence for a producer to forge. Retargeting the
  custom build is not itself a privilege-surface violation. Residual
  producer-data trust remains explicit: the decoder permits extra canonical
  records, does not reconstruct the whole flat from individual page records,
  does not bind section-flat or non-`contentHash` manifest bytes independently,
  and does not validate Markdown meaning or registry semantics. A producer may
  therefore alter an unbound per-page/section/manifest record while preserving
  the anchored core digest; a source change that also legitimately changes the
  committed manifest establishes a new expected identity. Corpus-generation
  and Guide consistency checks, ordinary source review, and the build trust
  boundary remain responsible for those relationships. The decoder provides
  fail-closed minimum closure and anchored core-content integrity, not producer
  authenticity or semantic documentation review.
- **syn cannot fully expand macros.** The scanner now token-scans ordinary
  `macro_rules!` definitions and invocations and rejects ones that can emit
  `pub` while naming a raw handle, seed, or resolved alias. `#[macro_export]`
  remains fail-closed in the privilege-owning crates. In a public item-expanding
  context, `include!(concat!(env!("OUT_DIR"), ...))` is separately fail-closed
  as `generated-api` in module, impl, trait, and foreign-item positions,
  including public inline modules and active/symbolic `cfg` or `cfg_attr`
  forms. Bare `include!`/`concat!`/`env!` spellings are the only spellings the
  compilation-unit checker evaluates with built-in semantics. It cannot prove
  from syn syntax whether a `std` or `core` path resolves to the prelude crate:
  `mod std { ... }` and `use hostile_macros as std;` can shadow that name.
  Therefore every qualified include path, including an actual
  `std::include!` or `core::include!`, is recognized by its `include` leaf but
  is deliberately unevaluable and a violation. The privilege-surface scanner
  also recognizes direct imported aliases, module-local `macro_rules!`
  wrappers whose token streams name include spellings, and parameterized macro
  invocations that receive a literal recognized include identifier plus a
  literal evaluable `OUT_DIR` expression. The Guide has no Rust-source
  `OUT_DIR` include; its `include_bytes!` data artifact is not macro-expanded as
  Rust, so a planted bare `include!`, `std::include!`, imported alias, or
  wrapper form remains a violation. An unevaluable
  recognized include also fails. Residual limit: cross-module/re-exported
  wrappers whose invocation does not carry the include identifier, and a
  procedural or declarative macro that synthesizes the include spelling or
  every sensitive identifier without a recognized literal token path, are not
  expansion-visible to syn. The checker therefore does not claim that every
  possible Rust macro spelling or item position of an `OUT_DIR` include is
  covered; rustdoc JSON or an expansion-capable stable compiler interface is
  the graduation path.
- **Macro recognition crosses source modules but remains literal-token-based.**
  The scanner now inventories `macro_rules!` definitions across the crate before
  scanning invocations. The concrete split probe—`pub` only in a private
  module's `make!` definition and `rusqlite::Connection` only in a public
  module's `make!(name, rusqlite::Connection)` invocation—is a finding.
  Unknown invocations carrying literal `pub` and a literal sensitive name are
  findings too, closing the demonstrated `paste!(pub fn ... ->
  rusqlite::Connection)` form. It still does not expand macros. This exact
  identifier-synthesizing invocation is missed because no literal token equals
  `rusqlite` or `Connection`:

  ```rust
  paste::paste! {
      pub fn leak() -> [<rusq lite>]::[<Connec tion>] { todo!() }
  }
  ```

  An external declarative/procedural macro invoked as
  `external_emit::privilege_api!();` can likewise emit a public sensitive API
  while placing neither `pub` nor the sensitive name in scanner-visible
  invocation tokens.
- **Renamed imports are not a cross-crate symbol graph.** Renamed raw-SQL and
  privilege-seed imports now initialize the in-crate alias fixpoint, so this
  concrete workspace source is a finding:

  ```rust
  use snapback_kernel::storage::KernelCommitAuthority as Root;
  pub use Root as Facade;
  pub fn leak() -> Root { todo!() }
  ```

  Each crate is still scanned independently. There is no metadata-derived
  symbol graph relating an opaque exported name to its defining type. For
  example, if a dependency outside the scanned workspace exports the seed only
  as `Root`, a workspace façade containing only `pub use opaque_bridge::Root as
  Facade;` produces no finding. Within the workspace, a two-hop
  `pub use bridge::Root as Facade;` is not independently attributed at the
  second hop, although the first-hop bridge is rejected where it spells or
  imports `KernelCommitAuthority`. This remains an explicit implementation
  deviation from §4.1's original cross-crate-resolution requirement.
- **Trait/impl egress coverage still has structural gaps.** Raw handles and
  privilege seeds directly named in either the trait or self position are now
  scanned, including `impl From<Wrapper> for rusqlite::Connection`. The
  following exact shapes remain missed:

  ```rust
  pub trait Project { type Output; fn project(self) -> Self::Output; }
  pub struct Wrapper<T>(pub T);
  impl<T> Project for Wrapper<T> {
      type Output = T;
      fn project(self) -> T { self.0 }
  }
  // A dependent substitutes Wrapper<rusqlite::Connection>.
  ```

  ```rust
  mod hidden {
      pub trait GivesHandle { fn handle(&self) -> rusqlite::Connection; }
  }
  pub fn leak() -> Box<dyn hidden::GivesHandle> { todo!() }
  ```

  ```rust
  mod hidden {
      pub trait GivesHandle { fn handle(&self) -> rusqlite::Connection; }
  }
  pub trait PublicHandle: hidden::GivesHandle {}
  ```

  These require type substitution and private-path trait-contract resolution,
  neither of which the current syn ratchet performs.
- **I-16 is direct-signature matching, not taint analysis.** The scanner does
  not inspect bodies. This exact shape produces no caller-discriminant finding
  (assuming the fixed registry spellings resolve elsewhere in the corpus):

  ```rust
  pub enum UserWriter { User, Admin }
  struct Wrapped { writer: UserWriter }
  fn helper(writer: UserWriter) -> UserWriter { writer }
  fn sanctioned(_wrapped: &Wrapped) {}
  pub fn execute_membership(writer: UserWriter) {
      let writer = match writer {
          UserWriter::Admin => helper(UserWriter::Admin),
          other => helper(other),
      };
      sanctioned(&Wrapped { writer });
  }
  ```

  Renaming the real sink to `renamed_sanctioned` also evades matching when an
  unrelated function named `sanctioned` elsewhere satisfies the global
  registry-observed check. The gate therefore cannot claim body-flow,
  helper-indirection, private-field, or per-sink renaming coverage.
- **Type-level opacity via `impl Trait` in public return position** that
  names no seed type but *is* a seed type is theoretically a hole
  (`pub fn foo() -> impl Clone`). syn sees `impl Clone`, not the hidden
  type. rustdoc JSON would still hide it. **Uncertain.** Mitigation:
  forbid `pub fn` in `snapback-kernel` from returning `impl Trait` that
  is not explicitly allowlisted; cheap syntactic rule, possibly
  over-broad. State it as I-15 (SC, conservative).
- **Sealed traits with a public `Sealed`.**
  `SenderProofAuthorityOperations: sender_authority_sealed::Sealed`
  (`storage/auth_sender.rs:235`) is already sealed in a private module;
  the old `fake-sender-proof-store` fixture is the witness. Keep it.
  A future `pub trait Sealed` would be a scanner hit (public trait
  named `Sealed` in a public module).

**I-14 (SC, syntactic ratchet only).** The checker reports
`#[macro_export]` in `snapback-kernel` or `snapback-services`, recognized
ordinary macro token streams that name both public API and raw-handle/seed
tokens, and the literal generated-Rust include shapes enumerated in §3.7 when
they occur in the public contexts the scanner walks. Every observed
`generated-api` finding requires its own exact, expiring review row. The
current allowlist is empty. This remains a syntactic ratchet, not general macro
expansion.

**I-15 (SC, conservative).** No `pub` function in `snapback-kernel`
returns `impl Trait` unless allowlisted. This may have false positives;
it exists because I-1 is blind there.

### 3.8 Authority discriminators

**I-16 (SC, direct-signature ratchet only).** Public enum variants (including
unit and tuple variants), public unit/tuple-struct constructors, and public-
field struct literals enter a public-constructibility set. The scanner
intersects that set with type names written directly in the signatures of a
fixed privilege-sink-name registry containing privileged planning,
`MembershipCommitAuthority::sanctioned`, membership bypass gates, and
provenance stamping. A direct intersection is a finding when the parameter
selects or stamps authority. `record_membership_transition`'s `MembershipWriter`
input qualifies; its `ChangeOp` input only labels the already-derived journal
operation and is not an authority discriminator.
Every registered sink name must also resolve to at least one real item in the
scanned corpus; otherwise the gate emits a distinct
`sink-registry-unresolved` violation. A dead spelling cannot count as coverage.

This does **not** implement the broader semantic property that caller-
constructible data never selects a privileged lane or authoritative
provenance. That remains the F-1 product objective: a kernel verifier derives
an unforgeable private-field carrier and commit accepts/revalidates that
carrier (resource, role eligibility, writer class, and provenance binding).
The scanner presently ratchets the direct `MembershipWriter` signatures; it
does not prove the objective, and §3.7 records concrete evasions.

## 4. Gate specification

Keep the three local-proof gate ids (`security-boundaries`,
`kernel-raw-sql-api`, `cross-crate-path-includes`) so
`scripts/local-proof-selection-policy.v1.json` and
`scripts/verify-local-proof` do not churn. Change what they inspect.
Stdout may say `privilege-surface` as a human alias for
`kernel-raw-sql-api`.

Common contracts for all three:

- Exit `0` only on full pass. Exit `1` on any violation. Exit `2` on
  tool/infrastructure failure (cargo metadata failed, rustc missing,
  fixture package missing). Do not report infrastructure failure as a
  clean product pass.
- Diagnostics prefixed with a stable code:
  `SNAPBACK_SECURITY_BOUNDARY`, `SNAPBACK_PRIVILEGE_SURFACE`,
  `SNAPBACK_CROSS_CRATE_PATH_INCLUDE`.
- No hand-maintained crate inventory. Workspace members come from
  `cargo metadata --format-version 1 --manifest-path <repo>/Cargo.toml`
  (`workspace_members` ⨝ `packages`). Compare against
  `crates/allowed-dependencies.v1.json` for *membership* only; that
  artifact is LLP 0276's matrix, not this spec's privilege list.
- The privilege scanner says in its own stdout that it is a ratchet, not a
  proof, and points to §3.7. A finding count does not imply completeness.
- `#[doc(hidden)]` is visible. `#[cfg(feature = ...)]` is visible in
  the symbolic caller-feature cell. `#[cfg(test)]` items are **not** visible to
  dependents and are out of the scanner's "public to dependents"
  view; they remain in-crate.

### 4.1 `kernel-raw-sql-api` — privilege-surface scanner

**Inspect.** Every library target of every workspace member, for each
exact/symbolic feature interpretation in §4.4. Parsed with `syn` (`full` + `visit`)
on the crate's module tree starting from each lib `src_path` in cargo
metadata, following `mod` / `#[path]` with the same resolution I-11
uses. Do not regex `pub fn`. Do not scan only `crates/snapback-kernel`.

Within its implemented syntactic scope, resolve names inside a crate with that
crate's `use` map. Treat
`rusqlite::Connection`, `::rusqlite::Connection`, and `Connection`
after `use rusqlite::{Connection, ...}` as the same type. Follow
renamed imports (`use rusqlite::Connection as Handle`) and in-crate `type`
aliases to a fixpoint. Resolve public re-exports through private modules and
re-export aliases/chains, including named functions, structs, enums, unions,
traits, aliases, consts/statics, matching impls, and globs; a private module
does not hide an item that the crate root publicly re-exports. Trait generic
arguments and ordinary concrete trait-impl methods are included even though an
impl method is not spelled `pub`.

The original requirement to follow `pub use` across crates with a metadata-
derived symbol graph is **not implemented**. Renamed seed imports are resolved
inside the crate that spells the canonical seed, but opaque names are not
carried into dependent crates. The absent symbol graph remains a specification
deviation and concrete residual in §3.7; neither this document nor gate output
credits the current scanner with that coverage.

**Technique.** syn AST + cargo metadata. Not rustdoc JSON on this pin
(§Summary). A small host binary (for example
`crates/snapback-tools/src/bin/privilege-surface.rs`, or a
`scripts/privilege-surface/` crate that is *not* a workspace member if
membership would perturb the matrix) is acceptable; a Node driver that
shells out to that binary is acceptable. Node `String.match` of source
text is not.

**Must catch.**

| Failure | Example |
| --- | --- |
| Public egress of `Connection`/`Transaction` (I-5) | `pub fn leak() -> rusqlite::Connection` (the planted by-value return the current regex misses) |
| Public field | `pub conn: Connection` on a public struct |
| Type alias | `pub type Db = rusqlite::Connection` plus any public use of `Db` |
| Trait method / associated type / associated const | `pub trait T { fn conn(&self) -> &Connection; }` |
| Re-export of the crate or its types (I-6) | `pub use rusqlite;` under any feature, including `remainder-tests` |
| I-1 obtainability | `pub fn claim_kernel_commit_authority(&mut self) -> Option<KernelCommitAuthority>` |
| Factory pattern (I-3) | `pub fn reservation(&self, bind: impl FnOnce(...) -> ..., ...)` |
| Clone/Default/Deserialize on I-1 types (I-8) | `#[derive(Clone)] pub struct KernelCommitAuthority` |
| Wholesale module re-export (I-9) | `pub use snapback_kernel::storage;` in auth/activation/engine/server |
| Feature-gated versions of all of the above (I-7) | `remainder-tests`, `test-support`, `benchmark-support`, `telemetry-phase1-proof` |
| `#[macro_export]` (I-14), public `impl Trait` returns (I-15) | as stated |
| Renamed imports / private-module re-exports / trait forms | `use rusqlite::Connection as Handle`; `mod hidden { pub fn leak() -> KernelCommitAuthority } pub use hidden::leak`; `impl AsRef<rusqlite::Connection> for PublicWrapper` |
| Rooted/parent local re-exports and reverse conversion impls | `pub use crate::hidden::leak`; `pub use super::leak`; `impl From<Wrapper> for rusqlite::Connection` |
| Direct-signature caller discriminators (I-16) | caller-constructible `MembershipWriter` is named directly by fixed-name privileged-plan, sanctioned, bypass, and provenance sink signatures |
| Dead privilege-sink registry entries (I-16) | every registered sink spelling resolves to a scanned Rust item or fails as `sink-registry-unresolved` |
| Macro/build-generated API approximations (I-14) | ordinary `macro_rules!` tokens emitting a public seed API; recognized direct, qualified, imported-alias, hardcoded-wrapper, and literal parameter-forwarded `OUT_DIR` Rust includes in module/impl/trait/foreign item positions without an exact review row; the Guide's `include_bytes!` artifact is inert data and creates no generated-API finding |

On `ede899a20` this gate **must print violations and exit 1**, including
at least:

- `crates/snapback-kernel/src/storage.rs` `claim_kernel_commit_authority`
- `crates/snapback-kernel/src/storage.rs` `AuthorizationCommitCarrierFactory::{reservation,prepared}`
- `crates/snapback-kernel/src/auth/service_fence.rs` `service_authority_commit_interlock`
- `crates/snapback-kernel/src/storage.rs` `install_service_authority_commit_interlock`
- `#[derive(Clone)]` on `KernelCommitAuthority` and the other I-8 types
- `crates/snapback-auth/src/lib.rs:9` (and activation/engine/server) `pub use` of `storage`
- `crates/snapback-services/src/lib.rs:40` `pub use rusqlite` under `--features remainder-tests`
- `crates/snapback-kernel/src/push.rs` `test_support::authorize_send_in` taking `Transaction` under `--features test-support`
- `MembershipWriter` plus the registered privileged-plan, sanctioned-commit,
  bypass, and provenance signatures that name it directly

**Allowlist.** Committed file `crates/privilege-surface-allowlist.v1.json`.
Each row:

```json
{
  "id": "fork-read-view-new",
  "crate": "snapback-kernel",
  "item": "snapback_kernel::instance_fork::ForkReadView::new",
  "kind": "sql-ingress",
  "features": ["default"],
  "reason": "read-only inspection over a connection SQLite itself reports as read-only",
  "ticket": "issues/YYYYMMDD-fork-read-view-raw-sql-ingress.md",
  "expiresAt": "YYYY-MM-DD"
}
```

Discipline:

- Kinds are a closed enum: `sql-ingress`, `sql-egress` (forbidden to
  use except during a time-bounded F-1 repair), `seed-obtain`,
  `seed-clone`, `reexport`, `macro-export`, `macro-generated-api`,
  `generated-api`, `caller-discriminant`, `impl-trait-return`.
- **`sql-egress`, `seed-obtain`, and `reexport` rows for the three live
  defects in LLP 0283 F-1 are forbidden.** An allowlist file that
  contains `claim_kernel_commit_authority`, `pub use rusqlite`, or the
  public closure factories is a gate failure, not a blessed exception.
  F-1 must delete the items, not allowlist them.
- Every allowlist id must be **observed** on this revision (the item
  still exists and still matches `kind`). Stale ids fail.
- Every `generated-api` row must name the exact `source` and syn-canonical
  `expression`, plus `producer` and `producerSha256`. The producer must be the
  row's crate `custom-build` target from current `cargo metadata`, and its bytes
  must match the digest. This pins an expiring review; it does not prove
  generated output.
- Expired `expiresAt` fails. Date is calendar, timezone `America/Los_Angeles`.
- No glob ids (`storage::*` is invalid).
- Widening the I-1 seed type list is an amendment to **this LLP**.
  Narrowing because a type was deleted is operational if the scanner
  observes the type is gone.

The four current `check-kernel-raw-sql-api.mjs` allowlist entries are
**not** carried over automatically. Re-justify `ForkReadView::new` and
`configure_connection_wal_lifetime` as `sql-ingress` with tickets, or
make them `pub(crate)` as part of F-1. Do not re-justify
`push.rs:authorize_send_in` as a production seam.

**Output / exit.**

```
SNAPBACK_PRIVILEGE_SURFACE: N violation(s)
  crates/snapback-kernel/src/storage.rs:2158: seed-obtain KernelCommitAuthority via LocalDatabase::claim_kernel_commit_authority [default]
  crates/snapback-services/src/lib.rs:41: reexport rusqlite [remainder-tests]
  ...
```

Every run first prints `privilege-surface: this scanner is a ratchet, not a
proof; residual evasions are documented in LLP 0284 §3.7`. Exit 1 if
`N > 0`. Exit 0 additionally prints
`privilege-surface: ok (<allowlisted count> allowlisted item(s); <cell count> feature cells)`.

### 4.2 `security-boundaries` — compile-fail witnesses with span assertions

**Inspect.** A fixture package at
`tests/fixtures/security-boundaries/` (path may stay), compiled with
`cargo check --message-format=json --offline` once the lockfile is
present, `CARGO_TARGET_DIR` set to
`<repo>/target/security-boundary-fixtures`.

**Inventory (I-12).**

1. Product workspace members with a `lib` target := `cargo metadata`
   on `<repo>/Cargo.toml` → `workspace_members`.
2. Fixture resolved deps := `cargo metadata` on
   `tests/fixtures/security-boundaries/Cargo.toml` → the fixture
   package's `dependencies` **keys** (normal), names only, excluding
   crates.io-only deps such as `serde` if any.
3. Fail if the two sets differ, except a documented exclusion for
   workspace members that have **no lib target** (bins-only) or that the
   privilege scanner has certified as having an empty privilege surface
   *and* no `pub use` of a rank-1..7 privilege crate. Conformance today
   has a lib that only re-exports `wire_fixtures`; it still must be a
   **real dependency** of the fixture package if the suite claims to
   cover "all 13 carved crates", *or* the suite must stop claiming that
   and instead claim "every workspace lib that the scanner says has
   privilege surface or re-exports one." The second is the honest claim.
   **Do not keep a metadata list that is a superset of the dependency
   keys.**
4. Join every attack to its Cargo bin target, declared source, dependency
   package, and parsed source references. The source must be the bin's actual
   `src_path` and must name the crate key for its declared mount. Swapping the
   `snapback-sync` witness's bin/source for a kernel witness while retaining
   `"mount": "snapback-sync"` must fail inventory validation.

**Technique.** rustc JSON diagnostics + syn on the fixture source to
locate the attack expression.

Fixture contract:

- Each product-attack fixture is a `[[bin]]` (or `[[test]]` that is
  never run) with a single `// @attack` comment. The following
  expression or statement is the attack. syn parses the file; the
  byte range of that expression is `A`.
- The gate runs `cargo check --message-format=json --bin <name>` with
  the feature set the fixture's manifest `required-features` (and the
  gate's matrix cell) request.
- From JSON lines with `"reason":"compiler-message"` and
  `message.level == "error"`, keep spans with `is_primary == true`.
  A span **hits** if `realpath(span.file_name) == realpath(fixture.rs)`
  and `[span.byte_start, span.byte_end)` overlaps `A`.
- Pass only if (compilation failed) AND (at least one primary span
  hits) AND (if the fixture declares `expected-code`, at least one
  hitting message has that `message.code.code`, e.g. `"E0624"`).
- Before classifying any nonzero Cargo result as a compile failure, require at
  least one JSON `compiler-message` whose level is `error`. Zero rustc error
  messages is infrastructure failure (exit 2) with Cargo's stderr retained.
- `expected-message` regex is optional and **never sufficient**.
- If compilation succeeds: fail with
  `SNAPBACK_SECURITY_BOUNDARY: <name>: attack compiled under features [<...>]`.
- If compilation fails with no hitting span: fail with
  `SNAPBACK_SECURITY_BOUNDARY: <name>: no primary span overlapped @attack (unrelated diagnostic would have satisfied a message regex)`.
- Dump at most the three nearest error messages to stderr for
  debugging; do not pass on them.

**Must catch (product fixtures, §6).** All three live escalations
(today: attack compiles → gate RED). All listed evasions that are
compile-time properties. Mounts through kernel **and** through
`snapback_auth::storage`, `snapback_engine::storage`,
`snapback_activation::storage`, `snapback_server::storage`. A feature
cell that enables `snapback-services/remainder-tests` for the rusqlite
re-export.

Inventory comparison is bidirectional: mounts absent from dependency keys,
privilege-bearing dependency keys absent from mounts, and privilege-bearing
scanner crates absent from either side all fail. The activation and server
storage-mount witnesses now prove that their crate-private aliases reject at
the mount. `snapback-sync` therefore has
an explicit compiler witness through
`LocalEphemeralBackend::reserve_authorization_commit`; merely depending on it
is not coverage.

**Allowlist.** None at the fixture level. A fixture that should compile
is not a product-attack fixture; it belongs in §6.4 harness tests.

**Output / exit.** One line per fixture:

```
[security-boundary] RED claim-kernel-commit-authority: attack compiled under features []
[security-boundary] PASS forge-erasure-authority: E0624 at src/bin/forge_erasure_authority.rs:4:13
```

Process exit 1 if any product-attack fixture is RED. On `ede899a20`,
exit 1 is required.

### 4.3 `cross-crate-path-includes` — compilation-unit ownership

**Inspect.** Every workspace member from cargo metadata. For each
member, every `.rs` file rustc could compile: manifest targets
(`src_path` of lib/bin/test/example/bench) plus the module tree syn
sees from those roots, **including symlink dirents**. Do not use
`Dirent.isFile()` as the only filter.

**Technique.** syn (attributes + `include!` macros) + `fs.realpathSync`
/ `fs.realpath`. String regex is not sufficient.

Resolution:

1. Crate root `R` = realpath of the directory containing the member
   `Cargo.toml`.
2. For a source file `S`, if `lstat(S)` is a symlink or regular file,
   `S* = realpath(S)`. If `S*` is outside `R`, violation
   (`symlink-source`).
3. For `#[path = L]` on any `mod` item (`syn::LitStr.value()` so raw
   strings, raw-hash strings, and escapes unescape), `T = resolve(dirname(S), L)`,
   `T* = realpath(T)` if `T` exists, else the lexical `T` is still
   checked with `path.relative(R, T)` after normalizing `..`. If `T*`
   (or lexical `T`) is outside `R`, violation (`path-escape`).
4. Same for `#[cfg_attr(..., path = L)]` at arbitrary nesting depth — recurse
   through `cfg_attr(..., cfg_attr(..., path = L))` and **ignore every cfg**.
   A disabled cfg that would escape is still a violation (fail closed).
5. For bare built-in `include!(E)` (after raw-identifier normalization) where
   `E` is a string literal or bare built-in
   `concat!(env!("OUT_DIR"), ...)`, that can be evaluated with
   `OUT_DIR` substituted by a fake absolute dir under
   `<target>/<pkg>/`, resolve and apply the same outside-`R` test.
   Unevaluable `include!` forms fail closed (`include-unevaluable`). Every
   qualified path whose leaf is `include` remains conservatively recognized,
   including `std::include!` and `core::include!`, but is unevaluable rather
   than receiving built-in semantics because syn does not resolve whether the
   root is the prelude crate or a shadowing local name.
6. Directory symlinks encountered while walking: follow, then apply
   the outside-`R` test to every yielded file.

**Must catch.**

- `#[path = r"../../snapback-kernel/src/lib.rs"]`
- `#[path = r#"../../snapback-kernel/src/lib.rs"#]`
- `#[cfg_attr(any(), path = r"../../snapback-kernel/src/lib.rs")]`
- `#[cfg_attr(all(), cfg_attr(all(), path = "../../snapback-kernel/src/lib.rs"))]`
- `src/leak.rs` symlink to `../snapback-kernel/src/storage.rs`
- `#[path = "leak.rs"]` where `leak.rs` is that symlink (lexical
  target inside the crate, canonical target outside)
- `include!("../../snapback-kernel/src/lib.rs")`

**Allowlist.** None. Generated `include!(concat!(env!("OUT_DIR"), ...))`
is allowed only when the resolved path is inside that package's
`target` dir (or `OUT_DIR`). Today's in-tree `include!` at
`crates/snapback-server/src/guide.rs:18` is this form.

**Output / exit.**

```
SNAPBACK_CROSS_CRATE_PATH_INCLUDE: N cross-crate compilation-unit escape(s)
  crates/snapback-auth/src/lib.rs:12 path-escape -> crates/snapback-kernel/src/lib.rs
  crates/snapback-auth/src/leak.rs:1 symlink-source -> crates/snapback-kernel/src/storage.rs
```

Exit 1 if `N > 0`.

### 4.4 Caller-feature predicate coverage

The original 47-cell additive matrix was unsound. Every individual feature
cell silently included defaults, so a satisfiable public item such as
`#[cfg(all(feature = "remainder-tests", not(feature = "services-owner")))]`
was absent from default, default-plus-feature, and all-features. Adversary
§2.1 can select `default-features = false`, so additive cells cannot be the
coverage argument.

The privilege scanner now runs two AST interpretations per workspace library,
with feature names still derived from `cargo metadata` rather than a literal:

| Cell | Interpretation | Why |
| --- | --- | --- |
| `C/default` | Exact local closure of the package's declared `default` feature | Labels ordinary production findings precisely and preserves exact allowlist matching. |
| `C/caller-features` | Every `cfg(feature = "...")` atom is symbolic/unknown; `cfg(test)` remains false | Conservatively retains every caller-feature-gated item, including positive/negative conjunctions reachable only with defaults disabled, without a `2^|F|` enumeration. |

An item seen in both cells is reported as `default`; one seen only in the
symbolic interpretation is reported as `caller-features`. The symbolic cell
may retain an unsatisfiable feature formula; that conservative false-positive
risk is accepted over a false negative until the helper grows a Boolean SAT
check. It does not assume Cargo feature additivity is a security boundary.

Target predicates are also conservative rather than host-bound: bare `unix`
and `windows` atoms evaluate to unknown in both cells, so public APIs behind
either polarity (including `#[cfg(not(unix))]`) remain in the scan. As with
symbolic feature atoms, contradictory target formulas may be retained.

Compile-fail fixtures do **not** run the full cartesian product. Each
fixture declares `features: [...]` in a sidecar
`tests/fixtures/security-boundaries/attacks.toml` (or equivalent). The
gate runs each fixture once per listed feature set. Required sets:

- `[]` (defaults) for every I-1 / I-8 / I-9 attack
- `["snapback-services/remainder-tests"]` for defect #3
- `["snapback-kernel/test-support"]` for `for_test` / `Transaction`
  ingress / `RecordingServiceAuthorityCommitInterlock::bind`

Scanner (`kernel-raw-sql-api`) runs the exact-plus-symbolic pair for each
library (26 cells in the 13-member product graph at this revision).

Path-includes is feature-independent (attributes exist in source
regardless of cfg); it runs once. It still parses `cfg_attr` as
specified in §4.3.

## 5. Anti-regression clause (no return to "six spellings")

The compile-fail list is a **witness**, not the coverage measure.

**R-1 (syntactic scanner ratchet).** Within the implemented syntactic scope in
§4.1 and the explicit limits in §3.7, adding a new public item that directly
expands the I-1 obtainability fixpoint, the I-5 egress set, the I-6 re-export
set, I-8/I-9/I-14/I-15, or I-16's direct-signature intersection fails
`kernel-raw-sql-api` with no fixture update required. This is materially wider
than the six remembered spellings in the 0276 gates; it is not a claim that
the scanner computes the complete semantic API closure.

**R-2 (new seed types).** A new public type that is (i) constructed only
with private fields, (ii) returned by a public method on
`KernelCommitAuthority` or `LocalDatabase`, and (iii) accepted by a
public `LocalDatabase` method, is a seed-type **heuristic hit**. The one
audited exception is `DatabaseBinding`: LLP 0285 §§1 and 5.1 define it as a
powerless database-identity token, its field and constructor are private, its
only methods are crate-private identity comparisons/test construction, and
every public `LocalDatabase` acceptance site requires a mutable receiver and
rechecks exact database identity. The scanner therefore classifies that exact
type as routing rather than privilege; a paired corpus control requires an
otherwise identical opaque return-and-consume carrier to remain a finding. The
scanner fails until the type is added to the I-1 list in this LLP *and*
a product-attack fixture is added, or the methods are made `pub(crate)`.
This heuristic is incomplete (a privilege type that never touches
`KernelCommitAuthority` by name can slip); R-1 still covers returns that
directly name an existing seed type or a resolved in-crate seed alias.

**R-3 (fixtures track the witness set, not the spelling set).**
`tests/fixtures/security-boundaries/attacks.toml` maps
`attack-id → { mount, features, expected-code?, seed-type? }`. The gate
fails if:

- an I-1 seed type is publicly obtainable and no fixture has
  `seed-type = that type` (except seed types the scanner reports as
  *not* obtainable — then a fixture is optional);
- a fixture's `@attack` no longer refers to an expression rustc can
  see (deleted file, empty bin);
- a fixture that used to fail at `@attack` now fails only elsewhere
  (stale spelling: the old API vanished and the fixture's unused import
  is the only error).

**R-4 (F-1 landing rule).** The F-1 change that closes the three live
defects must flip the corresponding product-attack fixtures from
"compiles → RED" to "primary span hit → PASS" in the **same landing**
as the API change. A landing that deletes `claim_kernel_commit_authority`
without the fixture still compiling an equivalent obtainability path
will go red on R-1 if a replacement `pub fn` remains, and red on R-3 if
the fixture's `@attack` stops pointing at a real expression.

**R-5 (who may edit the gates).** A landing whose primary content is a
privilege-bearing API change in `crates/snapback-kernel`,
`crates/snapback-auth`, or `crates/snapback-services` may update
*fixtures* and *allowlist tickets*. It may not relax scanner rules or
delete attack ids. Relaxations of this spec are amendments to LLP 0284,
not drive-by gate edits. This is the F-2 methodological rule ("do not
let a lane write the gate that constrains it") made operational for
future work.

## 6. Required negative fixtures

Paths are relative to `tests/fixtures/security-boundaries/` unless noted.
Every product-attack bin contains exactly one `// @attack`. Span
assertion: §4.2. `expected-code` values after F-1 are likely `E0624`
(private), `E0599` (no such method/item), `E0432`/`E0433` (unresolved
import), `E0277` (trait not implemented), `E0451` (private field);
implementors must record the code the actual F-1 shape produces. **On
`ede899a20`, rows marked TODAY=compiles must make the gate RED.**

### 6.1 Live escalations (must RED today)

The `TODAY` column below remains the historical `ede899a20` acceptance cut.
After the reachability half landed at `dc5d59efd`, direct claim, clone, and
test join/bind attacks reject at their marked expressions. Admission, pending-
effect, closure-factory, promotion, and membership witnesses now enter through
the explicit `ServingDatabase` owner surface; they still compile and therefore
remain honest RED evidence for the unimplemented forgery/confinement halves.
The current exact expected-red inventory is maintained in
`issues/20260819-security-gates-expected-red-until-f1.md`.

| id | Attack | Mount crate | Features | TODAY | After F-1 (expected) | Span |
| --- | --- | --- | --- | --- | --- | --- |
| `claim-kernel-commit-authority` | `LocalDatabase::memory()?.claim_kernel_commit_authority()` | `snapback-kernel` | default | compiles | error at `claim_kernel_commit_authority` | the claim call |
| `claim-via-auth-reexport` | same via `snapback_auth::storage::LocalDatabase` | `snapback-auth` | default | compiles | unresolved `storage` or private claim | the claim call |
| `claim-via-engine-reexport` | same via `snapback_engine::storage::LocalDatabase` | `snapback-engine` | default | compiles | same | the claim call |
| `claim-via-activation-reexport` | same via attempted `snapback_activation::storage` mount | `snapback-activation` | default | compiles | `E0603` at the crate-private alias | the storage mount |
| `claim-via-server-reexport` | same via attempted `snapback_server::storage` mount | `snapback-server` | default | compiles | `E0603` at the crate-private alias | the storage mount |
| `admit-system-push` | claim, then `authority.admit_system_push()` | `snapback-kernel` | default | compiles | fails at claim or at `admit_system_push` | the `admit_system_push` call (if claim is the only failure, the `@attack` is the claim; do not hide admit behind a compiling claim) |
| `admit-protected-record-erasure` | claim, then `admit_protected_record_erasure(...)` with arbitrary strings | `snapback-kernel` | default | compiles | error at admit or claim | the admit call |
| `admit-pending-effect-creation` | claim, then `admit_pending_effect_creation(...)` and `db.create_pending_effect(cmd)` | `snapback-kernel` | default | compiles | error at admit or create | the admit call |
| `clone-kernel-commit-authority` | obtain authority (or `fn assert_clone<T: Clone>(_: &T) {}` on a `KernelCommitAuthority` value / on the type via a helper) | `snapback-kernel` | default | compiles (`#[derive(Clone)]`) | `E0277` at the `Clone` obligation | the `Clone` use |
| `auth-commit-reservation-factory` | claim, `authorization_commit_carriers().reservation(\|_, _\| ..., \|\| {})` | `snapback-kernel` | default | compiles | error at `reservation` or claim | the `reservation` call |
| `auth-commit-prepared-factory` | claim, `.prepared(\|_\| Ok(()), \|\| {}, \|\| {})` | `snapback-kernel` | default | compiles | error at `prepared` or claim | the `prepared` call |
| `service-interlock-factory` | claim, `service_authority_commit_interlock(\|_, _\| Ok(factory.prepared(\|\| Ok(()), \|\| {}, \|\| {})))` then `db.install_service_authority_commit_interlock(...)` | `snapback-kernel` | default | compiles | error at factory or install | the `service_authority_commit_interlock` call |
| `services-rusqlite-reexport` | `use snapback_services::test_support::rusqlite::Connection; let _ = Connection::open_in_memory();` | `snapback-services` | `remainder-tests` | compiles | `E0432`/`E0433` at the `use` | the `use` or `Connection::open_in_memory` |
| `services-rusqlite-reexport-default` | same import **without** enabling `remainder-tests` | `snapback-services` | default | should already fail to resolve | stay failing at the `use` | the `use` |
| `forge-membership-writer-admin` | construct `MembershipWriter::Admin`, call `plan_privileged_membership_insert`, then `commit_membership_plan` | `snapback-kernel` | default | compiles | error at construction or the first unforgeable-carrier boundary | the variant construction; the remainder of the bin proves plan and commit also type-check today |
| `reserve-authorization-via-sync` | obtain `AuthorizationCommitReservation` through `LocalEphemeralBackend::reserve_authorization_commit` | `snapback-sync` | default | compiles | error at the reservation call | the call; provides I-12's compiler mount for the privilege-bearing sync dependency |

The `services-rusqlite-reexport-default` row is a control: default features must not leak `rusqlite`
either. TODAY it should PASS (import unresolved). If it compiles, that
is a fourth live defect.

### 6.2 Known evasions as product or corpus tests

| id | Attack | Where | TODAY old gate | New gate |
| --- | --- | --- | --- | --- |
| `by-value-connection-return` | synthetic crate with `pub fn leak() -> rusqlite::Connection` | `tests/fixtures/privilege-surface/by_value_connection/` (scanner corpus, not the product tree) | MISS | scanner RED on corpus; product tree scanned every run |
| `raw-identifier-privilege-return` | `pub fn leak() -> r#rusqlite::r#Connection` and `pub fn seed() -> r#KernelCommitAuthority` | same corpus dir | MISS | identifiers canonicalize before matching; scanner RED and committed-artifact forbidden catalog sees the raw SQL and seed names |
| `connection-type-alias` | `pub type Handle = rusqlite::Connection; pub fn leak() -> Handle` | same corpus dir | MISS | scanner RED |
| `connection-struct-field` | `pub struct Wrap { pub conn: rusqlite::Connection }` | corpus | MISS (not a `pub fn`) | scanner RED |
| `connection-trait-method` | `pub trait T { fn conn(&self) -> rusqlite::Connection; }` | corpus | MISS | scanner RED |
| `connection-associated-const` | `pub struct W; impl W { pub const X: Option<fn() -> rusqlite::Connection> = None; }` if rustc accepts; skip if the type is not representable — prefer `pub static LEAK: ...` only if legal. Honest fallback: associated type `type Conn = rusqlite::Connection` on a public trait | corpus | MISS | scanner RED |
| `connection-renamed-import` | `use rusqlite::Connection as Handle; pub fn leak() -> Handle` | corpus | MISS | scanner resolves the exposed alias name and goes RED |
| `private-module-reexport` | named function and public-field struct re-exports plus `mod hidden { pub fn leak() -> Connection } pub use hidden::*;` | corpus | MISS | scanner resolves local private-module functions, non-function items, matching impls, and globs and goes RED |
| `connection-as-ref` | public wrapper implements `AsRef<rusqlite::Connection>` with an inherited-visibility impl method | corpus | MISS | trait generic argument and method are RED |
| `no-default-feature-predicate` | `cfg(all(feature = "remainder-tests", not(feature = "services-owner"))) pub use rusqlite` | corpus | MISS | symbolic `caller-features` RED |
| `caller-membership-discriminator` | public enum with `Admin` unit variant appears directly in registered privileged-plan and sanctioned signatures | corpus | MISS | I-16 direct-signature check RED without adding the enum name to the seed list |
| `obtainable-seed-receiver-chain` | `Db -> KernelCommitAuthority -> ServiceAuthorityTerminalFactory -> PreparedServiceAuthorityTerminal` | corpus | final carrier missed | every receiver edge is RED once its receiver is independently obtainable; findings use `default` when that path exists |
| `non-unix-public-api` | `#[cfg(not(unix))] pub fn leak() -> rusqlite::Connection` | corpus | MISS on Unix host | target-symbolic scanner RED |
| `mount-source-mismatch` | replace the `snapback-sync` attack bin/source with the kernel-claim bin/source but retain `mount: snapback-sync` | harness inventory mutation | PASS | I-12 RED because the source does not reference `snapback_sync` |
| `ordinary-macro-generated-api` | internal `macro_rules!` emits `pub fn leak() -> KernelCommitAuthority` | corpus | MISS | `macro-generated-api` RED |
| `out-dir-generated-api` | bare `include!`, `std::include!`, direct imported alias, module-local hardcoded wrapper, and literal parameter-forwarding wrapper over `concat!(env!("OUT_DIR"), ...)`; direct includes appear at module, impl, trait, foreign, nested-inline-module, `cfg`, and `cfg_attr` positions | corpus | MISS | each recognized position/spelling is a `generated-api` RED absent its own exact review row; the Guide committed-artifact proof suppresses none of them |
| `raw-identifier-out-dir-generated-api` | `r#include!(...)` and `std::r#include!(concat!(env!("OUT_DIR"), "/hostile.rs"))` | corpus | MISS | raw macro names canonicalize to `include`; both are `generated-api` RED |
| `qualified-custom-env-include` | `include!(concat!(evil::env!("OUT_DIR"), "/probe.rs"))` where the custom macro emits an external root | path-include corpus | forged synthetic `OUT_DIR` PASS | `evil::env!` is not a bare or `std`/`core` built-in path, so the include is unevaluable and RED |
| `shadowed-std-include` | `mod std { ... }` or `use hostile_macros as std;`, followed by `std::include!(concat!(env!("OUT_DIR"), "/forged-safe-path.rs"))` where the local macro emits an external include | path-include corpus | forged synthetic `OUT_DIR` PASS | every qualified include is unevaluable and RED; the checker makes no syntax-only claim that `std` is the prelude crate |
| `raw-pub-private-macro-item` | a macro emits private `const r#pub: Option<KernelCommitAuthority>` | privilege corpus | false-positive `macro-generated-api` RED | `r#pub` remains an identifier rather than the visibility keyword; fixture stays clean |
| `guide-artifact-integrity` (reconciles former `generated-producer-drift`) | a structurally valid artifact omits required Guide records, carries invalid Markdown UTF-8, or stores a content hash that disagrees with its decoded hash-bound records | committed decoder unit tests; security harness for the public committed decoder | partial/unbound artifact PASS before the follow-up | decoder error before lazy public values are exposed; required paths come from the producer/decoder shared committed source, and the digest is also anchored to the directly included committed manifest. Generated-Rust item/identifier mutation and producer-target pinning are retired because producer bytes are inert data, not API; the remaining data-trust limits are §3.7's explicit residual |
| `unobtainable-seed-container` | private-state scope returns a seed but is created only by consuming that same seed; unit-constructible control returns it too | corpus | false positive on both | scope clean; constructible control RED |
| `named-but-not-depended-on` | fixture metadata lists `snapback-conformance` but `[dependencies]` omits it (reproduce today's `Cargo.toml`) | harness test over a temp copy of the fixture manifest | old gate PASS | I-12 RED |
| `unrelated-error-satisfies-regex` | `@attack` is `let _ = 1u32;`; a second, unmarked statement is `let _: () = snapback_kernel::storage::AuthorizationCommitInterlock;` (or any expression whose error text contains a former expected regex). The attack expression must not be in any primary span | `src/bin/unrelated_error_satisfies_regex.rs` in the **harness** suite, not the product-attack suite | old gate PASS if regex is `AuthorizationCommitInterlock` | product-attack runner must report this bin as RED (no span on `@attack`). Harness asserts the runner returned non-zero for this id |
| `path-raw-string` | `#[path = r"../../snapback-kernel/src/lib.rs"] mod stolen;` | `tests/fixtures/path-includes/raw-string/` | MISS | path-include RED |
| `path-raw-hash-string` | `#[path = r#"../../snapback-kernel/src/lib.rs"#] mod stolen;` | same | MISS | RED |
| `path-cfg-attr` | `#[cfg_attr(all(), path = r"../../snapback-kernel/src/lib.rs")]` | same | MISS | RED |
| `path-nested-cfg-attr` | two nested `cfg_attr` layers around the escaping `path` | same | MISS | RED |
| `symlink-source` | `src/stolen.rs` → kernel `storage.rs`; `mod stolen;` | `tests/fixtures/path-includes/symlink-source/` | SKIPPED (`isFile()` false) | RED `symlink-source` |
| `symlink-path-target` | `#[path = "local.rs"]` where `local.rs` is a symlink to another crate | `tests/fixtures/path-includes/symlink-target/` | MISS (lexical inside) | RED |
| `include-escape` | `include!("../../snapback-kernel/src/lib.rs");` | `tests/fixtures/path-includes/include/` | MISS (not `#[path]`) | RED |
| `raw-identifier-include-escape` | `r#include!("../../victim/src/lib.rs");` | `tests/fixtures/path-includes/raw-include/` | MISS | RED `include-escape` |

Corpus and path-include fixtures are **synthetic trees** under
`tests/fixtures/`, not mutations of `crates/`. Harness tests live in
`tests/security_gates_v1.mjs` (or `scripts/tests/` once that inventory
exists) and call the exported audit functions with `--root` pointing at
the synthetic tree, matching `tests/workspace_graph_v1.mjs`.

### 6.3 Retired-spelling witnesses (keep; they are not coverage)

These are the current six bins, rewritten to satisfy `@attack` + span
assertions. They must continue to fail at the attack expression.

| id | Attack (keep the expression) | Mount | expected (today) |
| --- | --- | --- | --- |
| `forge-erasure-authority` | `ProtectedRecordErasureAuthorityV1::from_admitted_facts(...)` | kernel | private associated fn (`E0624`) at that call |
| `forge-push-system` | `PushStorageAuthority::System` | kernel | no variant `System` (`E0599`) at that path |
| `fake-authorization-interlock` | `impl snapback_kernel::storage::AuthorizationCommitInterlock for FakeInterlock {}` | kernel | cannot find trait at the impl |
| `fake-sender-proof-store` | `impl SenderProofAuthorityOperations for FakeSenderProofStore {}` | kernel | `Sealed` not implemented / trait not in scope, **at the impl** |
| `raw-pending-effect-transition` | `database.create_pending_effect(request: CreatePendingEffect)` | kernel | type mismatch, at the call |
| `obtain-writable-sql-handle` | `base.conn` on `MaterializedBase` | kernel | private field (`E0451`) at the field access |

If F-1 removes a type entirely, keep the fixture until R-3 flags it
stale, then replace the `@attack` with the new obtainability path or
drop the id *only if* R-1 still covers the seed type.

Additional product-attack fixtures that are already refused today and
must stay refused:

| id | Attack | Why |
| --- | --- | --- |
| `default-kernel-commit-authority` | `KernelCommitAuthority::default()` | I-8; `E0599` today |
| `deserialize-kernel-commit-authority` | `let _: KernelCommitAuthority = serde_json::from_str("{}")?` (fixture may depend on `serde_json`) | I-8 |
| `construct-push-storage-authority` | struct literal / private fields | I-4 |
| `kernel-test-support-for-test-factory` | `AuthorizationCommitCarrierFactory::for_test()` | `test-support` cell; TODAY compiles; must RED after test-support stops being a dependent-visible mint |
| `kernel-test-support-join-authority` | `join_kernel_commit_authority_for_test` | same |
| `recording-interlock-bind` | `RecordingServiceAuthorityCommitInterlock::default().bind(&authority)` | `test-support` cell; TODAY compiles |
| `obtain-promotion-contention-reservation` | call `prepare_promotion_contention_reservation_for_bench` with a claimed root | R-2 seed heuristic; TODAY compiles |
| `obtain-ask-spend-reservation` | call `reserve_ask_spend` from a direct dependent | R-2 seed heuristic; TODAY compiles |

### 6.4 Harness integrity (the gate testing itself)

`tests/security_gates_v1.mjs` (name flexible; must join the scripts/tests
inventory LLP 0276 added) must contain at least:

1. `unrelated-error-satisfies-regex` as specified in §6.2 — asserts the
   **new** runner does not PASS it.
2. `named-but-not-depended-on` — asserts I-12 fails.
3. Scanner corpus for `by-value-connection-return` and friends —
   asserts `kernel-raw-sql-api` fails on the synthetic crate and
   **does not** depend on that crate being in the product workspace.
4. Path-include synthetic trees — asserts the path gate fails on raw
   string, symlink-source, symlink-target, include.
5. A negative control: a crate whose `#[path]` stays inside its root
   (ordinary `#[path = "foo.rs"]`) PASSES the path gate.
6. Alias, private-module re-export, and `AsRef`/`AsMut` trait-form probes.
7. A default-features-disabled negative predicate probe, reported in the
   symbolic `caller-features` cell.
8. A public enum discriminator named directly in registered privilege-sink
   signatures, plus the direct-dependent `MembershipWriter::Admin` product
   witness; removing a registered sink item produces the distinct
   `sink-registry-unresolved` violation. This is not body-flow coverage.
9. Nested `cfg_attr` path escape beyond one level.
10. Ordinary-macro and public `OUT_DIR`-include probes covering bare,
    path-qualified, raw bare/qualified, imported-alias, module-local
    hardcoded-wrapper, and literal parameter-forwarded spellings at module,
    impl, trait, foreign,
    nested-inline-module, `cfg`, and `cfg_attr` positions. Path-ownership probes
    shadow `std` with both a local module and a renamed import and require the
    qualified include to fail as unevaluable. The Guide-specific replacement
    is a zero-finding assertion over public committed `guide.rs`, a planted
    `KernelCommitAuthority` return proving that scoped assertion detects a seed
    leak, and decoder regressions for partial closure, invalid text UTF-8, and
    stored/decoded digest disagreement. The former exact generated-API review,
    generated artifact forbidden-identifier/gate-detection mutations, and
    Cargo custom-build retargeting are no longer normative fixtures: the first
    two cannot add Rust API through `include_bytes!`, while the data-integrity
    consequence of the third is handled—and bounded—by §3.7's committed
    decoder mechanism and residual trust statement.
11. A fake nonzero Cargo result with no rustc `compiler-message`, asserted as
    `GateInfrastructureError`, plus an assertion that the unrelated-error
    control really emitted its intended diagnostic.
12. Bidirectional inventory: a privilege-bearing dependency such as
    `snapback-sync` with its attack mount removed must fail.
13. Receiver/container obtainability: a private-state take-once scope is not a
    seed mint, while an independently constructible receiver remains RED.
14. Private-module named type and glob re-exports, an obtainable seed-receiver
    chain, and a `#[cfg(not(unix))]` API.
15. Fixture source-to-mount linkage: swapping the sync witness source for a
    kernel-only source while retaining `mount: snapback-sync` fails.

## 7. Cost and cadence

Estimates, not measurements. Measure in the rewrite landing and record
the numbers in the gate's stdout.

| Work | Cold wall-clock (order of magnitude) | Warm / incremental | Cadence |
| --- | --- | --- | --- |
| `cargo metadata` (product + fixture) | 1–3 s | 1–3 s | every invocation |
| Privilege-surface syn scan, exact-plus-symbolic caller-feature cells (13 libraries × 2; largest files `storage.rs` / `local/engine.rs` / `server.rs`) | 10–40 s | 5–15 s | **every landing** (`alwaysGates`, remains in `local-proof-selection-policy.v1.json`) |
| Cross-crate path-include syn + realpath | 2–8 s | 2–5 s | **every landing** (`alwaysGates`) |
| Compile-fail suite (~20 product bins, shared `CARGO_TARGET_DIR`, first bin pays kernel+deps check) | 3–10 min cold | 20–90 s incremental | **affected + scheduled complete battery**, not an unconditional always-gate |

**Landing vs battery (LLP 0189 D-1/D-2).**

- **Every ordinary landing:** privilege-surface scanner + path-include
  scanner. These are the gates that go RED on `ede899a20` without
  waiting for rustc to compile an attack, and that implement R-1 (new
  `pub` is a landing veto).
- **Affected selection:** compile-fail suite runs when the landing
  touches `crates/**`, `tests/fixtures/security-boundaries/**`,
  `tests/fixtures/privilege-surface/**`,
  `tests/fixtures/path-includes/**`, or the three gate scripts. Path
  matchers belong in `scripts/local-proof-selection-policy.v1.json`
  (move `security-boundaries` out of `alwaysGates` into that affected
  rule). A privilege-API landing that skipped compile-fail would still
  face the scanner.
- **Scheduled complete battery (LLP 0189 D-1, six-hour local-proof
  backstop):** all three, including the full compile-fail matrix.
- **Publication / F-3 qualification:** all three green *after* F-1, on
  the exact published commit. LLP 0283 forbids publication while F-1
  is open; this spec forbids publication while these gates are green
  against a tree that still has the three defects (they must be red
  until F-1, green after).

Do not keep the current arrangement (`security-boundaries` in
`alwaysGates` compiling six whole-stack bins on every landing) *and*
expand the fixture count; that fails LLP 0189 D-2. The scanner is the
always-on net; the compiler witnesses are affected-and-battery.

Parallelism: compile-fail bins may run sequentially in one
`CARGO_TARGET_DIR` (better incremental reuse) or with `-j` across
bins sharing the dir. Do not use `N` separate target dirs.

`--offline` after the first metadata/fetch in CI. Fixture package
remains `[workspace]` so it is not a fourteenth product member.

**Temporary F-1 integration ruling (accepted 2026-08-19).** The rewrite lands
while its findings are known real and F-1 remains open, so the three product
gate ids are complete-battery-only and absent from `alwaysGates` and ordinary
affected path selection. The green `security-gate-fixtures` negative corpus is
always-on. `issues/20260819-security-gates-expected-red-until-f1.md` records the
exact expected findings instead of an allowlist. F-1's landing moves the three
product ids into `alwaysGates` and closes that ticket with green outputs. This
temporary accepted amendment is the orchestrator's repository-integration
ruling, not an implementation deviation from the accepted spec.

### 7.1 Implementation record (2026-08-19)

The syn dependency lives in `scripts/security-gates-rust/`, a dedicated
`[workspace]` host-tool crate outside the product workspace. The Node drivers
remain the canonical gate entry points and obtain every member, target,
dependency key, and feature name from `cargo metadata`. This shape was chosen
so parser dependencies cannot change the 13 product crates or their feature
unification.

Measured warm on the adversarially revised implementation worktree: privilege
scan, 26 exact-plus-symbolic feature cells, approximately 11 seconds;
compilation-unit ownership, 420 product Rust files, approximately 6.5 seconds;
33 compile-fail attacks sharing one target, approximately 22 seconds; eleven
negative-corpus harness cases, approximately 1.4 seconds.
Each gate prints its own measured elapsed time, so scheduled evidence does not
depend on these prose snapshots.

The embedded Guide's `generated-api` review row was briefly removed on
2026-08-19 for an executable proof, then restored after independent review
showed the producer could forge that proof under ambient host authority. The
gate stopped compiling or executing any build script. At that point the
restored row was scoped to the direct `snapback_server::guide` include finding
and the SHA-256 of the `custom-build` source derived from `cargo metadata`;
changing either was RED. It was an expiring human review, not
generated-output inspection.

On 2026-08-20 a non-executable replacement briefly removed that restored row.
The Guide API became a committed artifact consumed directly by ordinary builds,
and a committed manifest pinned and syn-checked the artifact, include,
forbidden-identifier catalog, and Cargo-selected producer without executing the
producer. Independent rustc review then disproved its final premise: a typed
block expression can contain a non-local inherent impl and therefore add public
associated items while preserving the expected result type. The row was
restored over the exact three expression includes, and the ticket reopened.
The committed wrapper checks remain valuable drift evidence but are no longer
described as generated-output assurance.

On 2026-08-21 the Guide took the elimination path. The three generated Rust
expression files and their committed wrapper were replaced by one binary
artifact containing a fixed magic/version, a 64-byte content hash, and sorted
length-prefixed path/content records. Committed code includes it with
`include_bytes!` and parses it once through `LazyLock`. The follow-up decoder
rejects invalid magic/version, truncated or trailing framing, invalid hash/path
encoding, non-canonical or unsorted paths, the absence of any committed
minimum-corpus path or section flat, invalid Markdown/JSON UTF-8, invalid
embedded-manifest JSON/identity, and disagreement among the decoded core
records' digest, stored hash, embedded manifest, and directly included
committed manifest. Those specified rejection paths return `Err`; access
through the embedded lazy static converts the error to a panic with the stable
`malformed embedded Guide artifact` prefix. This is not a claim that the
decoder recognizes every semantically malformed Guide: extra canonical files,
Markdown meaning, page-to-flat equality, section-flat equality, and manifest
relationships other than `contentHash` remain outside its validation (§3.7).
An item-bearing payload test keeps an `impl` block inert. The façade's obsolete,
unconsumed duplicate Guide Rust generator was deleted too; it re-exports the
server module. Because no producer byte is parsed as Rust, the wrapper shape
manifest no longer proves a live boundary and was deleted rather than
repurposed. The final `embedded-guide-generated-table` row was deleted, leaving
zero privilege-surface allowlist entries.

## 8. Acceptance

The rewrite implements this spec when:

1. On `ede899a20` (or any descendant that has not landed F-1),
   `kernel-raw-sql-api` and `security-boundaries` exit 1, and their
   output names at least the three live defects in §1. Path-includes
   may stay green on the product tree if no escape exists; its
   synthetic fixtures in §6.2 must still RED.
2. After F-1, the same commands exit 0 on the product tree, and every
   §6.1 fixture fails at `@attack` rather than compiling.
3. Each §6.2 evasion fails the gate it is aimed at, in a harness test
   that is itself a local-proof gate.
4. I-12 holds: fixture dependency keys come from cargo metadata and
   match the claimed inventory.
5. No allowlist row names the three live F-1 defects.
6. R-1 is demonstrated in the rewrite's own tests by planting
   `pub fn leak() -> rusqlite::Connection` in a synthetic kernel-like
   crate and observing scanner RED without adding a product fixture.
7. I-16's direct-signature check is demonstrated synthetically. Separately, a
   direct-dependent compiler fixture constructs `MembershipWriter::Admin`,
   plans a privileged insert, and commits it; that product behavior stays RED
   until the discriminator becomes kernel-derived, unforgeable, and
   revalidated at commit. The scanner is not credited with following that body
   flow.
8. Caller-feature coverage catches a satisfiable `not(default-feature)` leak;
   no security claim depends on the former 47 additive cells.

F-1 is a separate change (LLP 0283). This spec does not choose among
F-1 designs. It chooses what "closed" means so the next gate cannot
again report PASS on an open mint root.
