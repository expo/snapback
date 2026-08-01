# LLP 0141 embeddable Rust library review — Codex family


## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `medium` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** fresh CLI runner, read-only sandbox, blind to this RFC's fable
artifact; SHA-pinned target and instruction capsule
**Instruction capsule SHA-256:** `aab53ab2382e01f9f56e270700672c2d7c18c911b1c76754eff1625ece91c52f`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (382 lines, Draft)
**Target SHA-256:** `99c041264c2ae48712c8cfbcc4971e9c02ee0dfa11e8b7b4d6827a50619ed88c`
**Repo revision at review start:** origin/main `11dddced`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

The RFC has the right high-level instinct: keep the listener-bound application opaque, expose controlled registration rather than an Axum router, and treat linked native code as server-trusted rather than sandboxed application code.

It is not yet at the standing READY bar. Several as-built claims are false or overstated, and the proposed APIs do not yet preserve the invariants the RFC says they preserve. In particular:

- D2 has no coherent per-application registry projection and does not prevent route collisions.
- D3’s operation inventory and reserved namespaces are incomplete.
- D3 does not define the dependency, transaction, cancellation, and failure semantics required for protected queries and mutations.
- D5 treats a self-reported capability-manifest row as if it could distinguish a trustworthy stock server from native code capable of altering that report.
- D6 identifies the first Cargo error correctly but substantially understates the remaining crate and native-runtime distribution program.

NOT READY

## 2. Strengths

- The target hash matches the capsule exactly: `99c041264c2ae48712c8cfbcc4971e9c02ee0dfa11e8b7b4d6827a50619ed88c`.
- The central listener-fence diagnosis is correct. [`SnapbackApp`](/Users/ccheever/projects/snapback/src/server.rs:13815) deliberately keeps its router private, and LLP 0060 D1 explicitly names `server::app(state).bind(listener)` as the public embedded network path whose listener and router remain inseparable.
- The existing HTTP parity mechanism is described substantially correctly: `RegisteredRoute` carries metadata with its `MethodRouter`, [`router_from_registrations`](/Users/ccheever/projects/snapback/src/server.rs:13761) applies policy middleware before same-path method merging, and [`route_registry()`](/Users/ccheever/projects/snapback/src/server.rs:13952) projects the built-in registrations. That matches LLP 0031 §Enforcement.
- The RFC correctly distinguishes handler host calls from the HTTP/CLI host-ops core. This is an important correction over conflating the two.
- The protected-query dispatcher really does deny unknown host-call names with `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED` before ordinary dispatch.
- The bare path-only `ibex-runtime` dependency is a real crates.io blocker. Cargo documents that path-only dependencies are not permitted in published crates; a registry version must exist and be declared alongside the local path. [Cargo dependency documentation](https://doc.rust-lang.org/stable/cargo/reference/specifying-dependencies.html?highlight=path)
- D5 correctly states the fundamental trust fact: native Rust linked into the process is above the Hermes boundary and must be treated as server code.
- PocketBase is characterized fairly in its core details. Its current documentation shows `pocketbase.New()`, hook-based route registration, and `go build` producing a statically linked executable. It also shows that a route without `RequireAuth` is public by default. [PocketBase Go overview](https://pocketbase.io/docs/go-overview), [PocketBase routing](https://pocketbase.io/docs/go-routing/)
- The customer-demand question and the unsound-self-classification question are appropriately named as open.

## 3. Findings

### BLOCKING — D2 does not actually preserve router↔registry parity for an embedded application

**RFC:** lines 201–219.

The RFC says custom registrations join the list that `route_registry()` projects and appear in the registry used by LLP 0031’s parity check. The current shapes cannot do that:

- [`route_registry()`](/Users/ccheever/projects/snapback/src/server.rs:13952) is a process-global, argument-free projection of `all_route_registrations()`.
- [`SnapbackApp`](/Users/ccheever/projects/snapback/src/server.rs:13823) retains only `state` and the constructed `Router`; it does not retain its registration metadata.
- `router_from_registrations` consumes the list.

A builder-specific application may have a different route set from every other application in the process. Therefore the registry must become an application/build artifact—such as `BuiltSnapbackApp::route_registry()` or a build receipt—not remain the current global function. Otherwise the custom route either disappears from inspection/parity checks or mutates global state, contradicting build-time composition and allowing multiple embedded apps to interfere.

This is not named as open.

### BLOCKING — D2’s reserved-prefix rule does not prevent shadowing

**RFC:** lines 227–231.

The proposed refused prefixes omit many first-party root routes, including `/`, `/health`, `/inspect`, `/action/*`, `/assets/*`, `/connection/*`, `/ephemeral/*`, `/outbox/*`, `/app/*`, and `/client-mutations/*`. An extension could therefore collide with a built-in exact method/path while satisfying the stated rule.

The invariant must be checked against the complete registration set, including method matching, Axum pattern overlap, implicit HEAD, generated OPTIONS, catch-alls, and future first-party additions. A dedicated extension namespace would reduce future compatibility risk, but even that does not remove the need for structural collision detection.

As written, the rule cannot establish its stated purpose: “so an extension cannot shadow or intercept a first-party route.”

### BLOCKING — D3 reserves only four of the existing first-party operation namespaces

**RFC:** lines 134–139 and 242–253.

The as-built handler-operation inventory is incomplete. `handle_host_call` also dispatches:

- `jobs.enqueue`
- `assets.attach`
- `membership.write`
- `action.metadata`
- `action.externalEffectBegin`
- `action.externalEffectInitiated`
- `action.runMutation`
- the `action.stream*` family

D3 reserves only `db.*`, `runtime.*`, `permissions.*`, and `host.*`. Its proposed collision rule would therefore admit extension names colliding with existing `jobs.*`, `assets.*`, `membership.*`, or `action.*` operations.

This is a direct design defect, not merely missing exposition. Extension operations need an extension-owned namespace that is disjoint by construction, rather than an incomplete denylist of first-party prefixes.

### BLOCKING — D3a lacks the semantics necessary to preserve protected-query and mutation correctness

**RFC:** lines 242–257 and open question 2.

The open question correctly doubts whether an embedder’s determinism/visibility claim can be trusted, but the problem is broader:

- A protected-query operation that reads SQLite or another mutable source must return dependency witnesses compatible with live invalidation. A “deterministic” label alone cannot make such a read visible to the read summary.
- A mutation extension needs explicit transaction semantics. External side effects cannot casually run inside work that may fail, roll back, be retried, or lose settlement.
- An action extension needs cancellation, deadline, abandoned-work, and generation semantics compatible with the existing action host.
- The RFC does not specify argument/result limits, async and thread-affinity requirements, panic containment, diagnostic conversion, secret redaction, or whether extension code receives raw `AppState`/database access.
- A native operation may turn a narrow `ctx.*` name into an arbitrary confused-deputy interface depending on which arguments application JavaScript controls.

Until those are decided, “a handler stays sandboxed and gains a power” is incomplete. The VM remains sandboxed, but the new power may invalidate query correctness or transaction guarantees.

The conservative default suggested in open question 2—deny every extension operation in protected queries—is sounder than third-party self-classification, but it does not settle mutation/action behavior.

### BLOCKING — D6 identifies only the first publication failure, not the distribution gate

**RFC:** lines 313–328.

The bare Snapback path dependency is correctly identified, but the proposed remedy is incomplete:

- `vendor/ibex/Cargo.toml` itself has path-only dependencies on `capsec-semantics`, `ibex-sfe-format`, `ibex-sfe-catalog`, and conditionally `ibex-windows-dll-staging`; those also require registry releases or restructuring.
- The Ibex build expects target-specific Hermes headers, libraries, compilers, provenance artifacts, and checkout-relative layouts. Publishing an `ibex-runtime` crate version does not by itself make those available.
- A macOS framework published somewhere in a dependency’s source cache does not become a portable runtime layout beside the final embedder executable.
- Snapback’s `build.rs` and Ibex’s build script need a designed metadata/artifact handoff; “a release carrying artifacts” does not explain selection or discovery.
- crates.io currently imposes a 10 MB compressed package limit. The prepared framework directory is roughly 76 MB uncompressed and includes a 9.4 MB dynamic framework plus much larger static libraries; platform-package splitting or verified downloading must be evaluated, not assumed. [Cargo publishing documentation](https://doc.rust-lang.org/cargo/reference/publishing.html)
- “`cargo add` builds” and “the resulting executable is one portable file” are separate requirements. D6 currently conflates crate resolution, native linking, runtime loader custody, and portable deployment.

The RFC’s assertion that a versioned Ibex release with two platform artifacts is the needed solution is therefore premature.

### MATERIAL — The acceptance-suite claim is false

**RFC:** lines 22–27.

The public embedded path is real, but “the entire acceptance suite drives [it] in-process” is refuted by the repository. Examples include:

- `tests/acceptance/standard-patterns-v1.mjs`
- `tests/acceptance/require-role-live-revocation.mjs`
- `tests/acceptance/asset-conformance-v1.mjs`
- `tests/conformance/versioned-seed-v1-suite.mjs`
- the shared `demos/_kit/server-process.mjs`

These launch the server binary or `cargo run` as a child process. Several Rust tests do exercise `server::app` directly or bind it in-process, but that is not the entire acceptance suite.

“The test and tooling embedder is already the largest consumer” is plausible but not supported by a stated metric and could not be verified.

### MATERIAL — “Every internal type is nominally public” is false Rust visibility analysis

**RFC:** lines 95–100.

The counts are correct: 48 `pub mod` declarations and five `pub(crate) mod` declarations. A public module does not make every item inside it public, however. `src/server.rs` alone contains hundreds of private structs, enums, functions, and constants.

The accurate claim is that every `pub` item under those public modules is externally addressable, creating a broad accidental surface. The present statement materially overstates the exposed API.

### MATERIAL — `RouteSpec` does not have eleven independent axes

**RFC:** lines 119–123.

It has eleven listed fields, but `policy` is explicitly documented as a source-compatible alias for `path_policy`; validation refuses them when unequal. It is not independent. In addition, `RouteSpec::new` defaults `effect_policy` and `session_overlay`, contradicting D2’s statement that there is “no defaulted or inferred variant” unless the proposed façade deliberately replaces the current constructor.

### MATERIAL — The “host operation registry” attribution and extension contract are underspecified

**RFC:** lines 140–145 and 259–266.

LLP 0024 owns host-op IDs, DTOs, shared envelopes, and transport projections. LLP 0031 owns the enforceable operation-policy registry. `execute_host_op` is a closed match dispatcher, not by itself the registry D3b needs to extend.

A host-op extension would have to join at least:

- dispatch;
- the LLP 0031 `OperationSpec` registry and its independent policy axes;
- profile requirements;
- transport projections and envelope schema;
- guide surface-map checking;
- capability-manifest/runtime inspection.

“Authority requirement and a capability-index row” is insufficient. It also omits existing operations such as versioned seed operations and `function.explain`.

The capability index is authored and CI-joined against routes and host ops; it is not itself generated. `scripts/check-guide.mjs` generates the manifest and flat guide, while checking `guide/capabilities.md`.

### MATERIAL — D4 contradicts its own “no new API” decision

**RFC:** lines 268–284.

The heading and first paragraph say the deploy shape is achievable today and needs no new API. The same section then says external embedders cannot readily construct `AppState`, need a supported constructor, and that this constructor is the actual deliverable and a prerequisite for D2/D3.

The latter is the honest assessment. D4 needs a public lifecycle/construction API covering initialization, bundle loading, readiness, shutdown, database ownership, background tasks, and runtime qualification. A template is not a substitute for that API.

### MATERIAL — D5 overstates what a capability-manifest row can prove

**RFC:** lines 301–309.

Native code in the server address space can alter the manifest implementation, bypass policy, read credentials, corrupt database invariants, crash or deadlock the process, and invoke unsafe/FFI dependencies. A boolean reporting “native extensions present” is useful inventory, but it cannot let a client securely distinguish stock from extended code unless tied to independently verified binary provenance or attestation.

Similarly, “structurally incapable” needs an actual build graph: separate hosted artifacts/features, no registration symbols or plugin loader, artifact identity, and deployment admission that verifies the admitted binary. Configuration plus self-report is not structural separation.

For self-hosted operation, trusting extension code as server code is a valid posture. Calling it “fine and unremarkable” nevertheless understates supply-chain, availability, migration, backup, and compatibility consequences.

### MATERIAL — The LLP 0033 attribution is false

**RFC:** lines 310–311 and 360–361.

LLP 0033 was not “written for a binary.” It is a project-wide Accepted decision that “Snapback is pure MIT,” explicitly covering Project, Packaging, and Deployment. MIT already permits linking and redistribution.

An embedding mode may create new third-party license, notice, SBOM, trademark, and support-policy questions, but it does not reopen the settled Snapback license merely because linking replaces process separation. If the RFC intends a product-strategy reconsideration, it must say why LLP 0033’s ratified revisit triggers have fired.

### MATERIAL — LLP 0099 is not evidence for generic native-extension isolation

**RFC:** lines 362–364.

LLP 0099 is specifically a migration-executor conformance profile inside a single-instance container VM. It does not define isolation for arbitrary application-native extensions, nor does it protect the Snapback process from code linked into that same process.

A one-tenant-per-VM hosting design could change the blast radius between tenants, but the extension would still completely control its tenant’s Snapback process and any credentials, volumes, or control-plane capabilities made available to it. That requires a new hosted-extension threat model; LLP 0099 cannot answer D5 as cited.

### DETAIL — The prior-art section is broadly fair but omits relevant qualifications

**RFC:** lines 369–382.

- PocketBase also supports JavaScript framework extensions, including custom routes and hooks, so “host language == app language” describes the Go mode rather than PocketBase’s whole extension story. [PocketBase extension overview](https://pocketbase.io/docs/use-as-framework/)
- Supabase and Convex lack an in-process application-library story, so the core comparison is fair. Both now have official self-hosting, however: Supabase as a Docker-composed multi-service stack and Convex as a separately deployed backend/dashboard/frontend arrangement. “The server is a service you talk to” is accurate; it should not be read as “hosted-only.” [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting), [Convex self-hosting](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)
- SQLite’s `sqlite3_create_function` is a useful analogy for registration inside an engine, but it also exposes what D3a is missing: connection scoping, determinism flags, direct-only restrictions, lifecycle/destructor behavior, and explicit security warnings for functions exposing application state. [SQLite function registration](https://www.sqlite.org/c3ref/create_function.html)

### DETAIL — Related metadata omits documents cited in the body

The body cites LLP 0099 and LLP 0102, but neither appears in `Related`. Given that both are used to frame open questions, they should either be added or their relevance reconsidered.

## 4. Verification ledger

| Check | Outcome |
|---|---|
| Target SHA-256 | **Confirmed** — exact match. |
| Review revision | **Qualified** — `origin/main` is `11dddced`, as stated. Checked-out `main` is divergent at `5d5c6b71`; the relevant source files compared in this review are identical between those revisions. The target itself is untracked. |
| Target RFC | **Read fully** — 382 lines. |
| `Cargo.toml`, `src/lib.rs`, `src/main.rs` | **Confirmed/qualified** — lib target, four-line main, 48 public modules and five crate-private modules confirmed; “every internal type public” refuted. |
| `src/server.rs` anchors | **Confirmed/qualified** — app/bind/service/private-router/parity claims confirmed; eleven-independent-axes claim refuted; global registry shape contradicts D2’s custom-app claim. |
| Acceptance usage | **Refuted** — both direct/in-process tests and numerous spawned-binary acceptance paths exist. |
| `src/runtime.rs` | **Confirmed/qualified** — protected-query unknown-op denial confirmed; operation inventory in RFC incomplete. |
| `src/host_ops.rs` | **Confirmed/qualified** — distinct host-ops dispatcher confirmed; RFC inventory and “registry” characterization incomplete. |
| `src/admin.rs:827` | **Confirmed** — `AppState::new` requires `SharedSnapback`, `ReadLane`, `EphemeralApi`, and `ServerContext`. |
| `build.rs` | **Confirmed** — emits macOS loader paths and Linux RUNPATH because downstream final binaries need their own link argument. |
| `scripts/bootstrap-ibex-runtime` | **Confirmed** — clean-tree runtime preparation and stable diagnostic program exist. |
| `vendor/ibex/Cargo.toml` and build script | **Refutes completeness of D6** — further path-only crates and extensive native artifact assumptions exist. |
| LLP 0009 | **Confirmed** — no ambient SQLite/filesystem/network/environment/secrets for app code; local, self-hosted, and hosted/multi-tenant threat models are distinct. |
| LLP 0010 | **Confirmed** — native bootstrap and diagnostic-code attribution is faithful. |
| LLP 0024 | **Qualified** — owns host-op IDs/DTOs/projections; does not alone own router/operation-policy parity. |
| LLP 0031 §Enforcement | **Confirmed** — router and descriptive registry must project the same `RegisteredRoute` objects; multiplexed operations have their own registry obligations. |
| LLP 0033 | **Refuted as attributed** — project-wide MIT decision, not binary-specific. |
| LLP 0041 | **Confirmed** — native runtime distribution and npm package closure are central packaging concerns. |
| LLP 0051 | **Qualified** — includes non-JS clients but also server-side IR/WASM/runtime work; it does not propose embedding the server. |
| LLP 0060 D1 | **Confirmed** — quote and listener-fence semantics are faithful. |
| LLP 0064 | **Confirmed** — explicitly states that its native client surfaces do not embed the server. |
| LLP 0099 | **Refuted as general isolation authority** — migration-executor profile only. |
| LLP 0102 | **Confirmed/qualified** — a broad comparative bakeoff and improvement-synthesis program, but not specifically a native-extension demand study. |
| LLP 0122 | **Confirmed** — installed-product coherence and single-binary options are relevant; it is research, not a selected distribution decision. |
| LLP 0139 | **Confirmed/qualified** — focused upload bakeoff, already completed; its usefulness for discovering future native-capability demand is speculative. |
| PocketBase prior art | **Confirmed with qualification** — Go-library story, route API, default-public example, hooks, and static build verified; JavaScript extension mode omitted. |
| Supabase/Convex prior art | **Confirmed with qualification** — no in-process embedding surface found; official self-hosted service deployments exist. |
| SQLite prior art | **Confirmed** — `sqlite3_create_function` is an extension-registration API, but the analogy omits important policy/lifecycle restrictions. |

## 5. Open questions the RFC should add

1. Is the route registry process-global, application-instance-specific, or part of an immutable build receipt once embedders can construct multiple differently extended apps?
2. What exact algorithm rejects duplicate or overlapping method/path patterns, implicit HEAD/OPTIONS collisions, catch-all overlap, and future first-party namespace expansion?
3. Must all custom routes live under a dedicated extension namespace?
4. What handler signature is public, and which parts of `AppState`, request authority, database access, and response construction can it observe?
5. How do native query operations contribute exact dependency witnesses to protected live queries? If they cannot, are they categorically forbidden there?
6. What are the transaction and retry semantics for mutation extensions, especially operations with external effects?
7. What deadline, cancellation, panic, resource-limit, thread-affinity, and abandoned-work rules apply to native operations?
8. How are extension argument/result schemas, maximum sizes, diagnostics, redaction, and compatibility versions declared and enforced?
9. How is extension identity recorded—name only, crate/version, feature set, source digest, binary digest—and what independently verifies it?
10. What build artifact makes hosted deployments structurally unable to contain extension code, and how does deployment admission attest that artifact?
11. What does “single binary” mean on macOS when Hermes is currently a dynamically loaded framework: one executable file, or one relocatable distribution bundle?
12. What is the full publication graph for Snapback, Ibex, Ibex’s internal crates, Hermes headers/libraries/compiler, platform selection, loader layout, and crates.io size constraints?
13. Which extension surfaces are actually in scope for the first release: construction only, route registration, handler capabilities, or host ops? The present RFC decides all four despite having evidence only for construction/test embedding.
14. What third-party license/SBOM/trademark obligations are new, distinct from LLP 0033’s already-settled MIT posture?


## Round 2 — 2026-08-01 (delta-scoped)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `medium` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** delta-scoped round — read own round-1 artifact only; blind to this
RFC's fable artifact; corrected inventories re-verified against the tree,
including Mach-O header inspection of the built binary
**Instruction capsule SHA-256:** `52bd6394736e8ec2f03a586a5a3c84ff64903a087c717c3666e154c5ec4db16e`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (v0.2, 530 lines, Draft)
**Target SHA-256:** `a82d1c6b6bfd737c126e2f96f79abcf3c8c4bad716e9ed1857afbd9d4bcf7dd6`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

v0.2 resolves most round-1 design defects by correcting the architectural model, explicitly demand-gating D2/D3, and naming the semantics that must be settled before implementation.

It does not yet meet the factual-accuracy bar. Three corrected inventories remain inaccurate, and D7 contradicts the Summary about which decisions are proposed for acceptance. Most notably, the handler bridge recognizes 22 operation names, not 21; the constructor inventory omits a relevant public constructor; and the “one file” deploy affordance remains classified as low-cost despite the mandatory macOS Hermes framework.

NOT READY

## 2. Round-1 finding dispositions

| # | Round-1 finding | Disposition | Justification |
|---|---|---|---|
| 1 | D2 lacked an application-scoped registry projection | RESOLVED | D2a now requires an instance-scoped registry/build receipt and explicitly identifies the current global projection as incompatible with multiple extended apps. |
| 2 | D2’s prefix denylist did not prevent shadowing | RESOLVED | D2b replaces enumeration with a dedicated namespace or derivation from the registration set and names structural overlap handling as OQ7. |
| 3 | D3 reserved only four first-party namespaces | RESOLVED-BUT-NEW-DEFECT | Mandatory `ext.*` registration fixes collision safety by construction, but the newly claimed complete 21-operation inventory omits `action.externalEffectInitiated`. |
| 4 | D3a lacked protected-query, transaction, cancellation, and failure semantics | RESOLVED | v0.2 adds mandatory budget/cancellation/panic requirements, names the remaining dependency, transaction, resource, and confused-deputy questions as OQ9–OQ12, and demand-gates implementation. The semantics remain open, but are now honestly open. |
| 5 | D6 understated the distribution gate | RESOLVED-BUT-NEW-DEFECT | D6 now inventories the publication, artifact, loader, and portability program and marks it blocking; however, the revised document still calls the one-file deploy shape low-cost elsewhere. |
| 6 | The entire-acceptance-suite claim was false | RESOLVED | The current-state section now accurately distinguishes in-process Rust tests, direct `LocalSnapback` tests, and spawned-binary JavaScript acceptance suites. |
| 7 | “Every internal type is nominally public” was false | RESOLVED | v0.2 correctly limits the claim to `pub` items inside the 48 public modules and acknowledges private items. |
| 8 | `RouteSpec` did not have eleven independent axes | RESOLVED | The field inventory, alias relationship, identity fields, eight-argument constructor, and two defaults are now accurately described. |
| 9 | Host-operation registry ownership and extension obligations were underspecified | RESOLVED | The RFC now distinguishes dispatch from LLP 0031 policy ownership and enumerates dispatch, policy, profile, transport, guide, and manifest obligations. |
| 10 | D4 contradicted its “no new API” claim | RESOLVED-BUT-NEW-DEFECT | D4 now consistently identifies production-posture construction as the deliverable, but its corrected public-constructor inventory omits `AppState::from_snapback_with_secret_read_operator`. |
| 11 | D5 overstated a capability-manifest row as a trust signal | RESOLVED | v0.2 explicitly withdraws that proposal, limits the row to honest operator inventory, and names artifact attestation as OQ14. |
| 12 | LLP 0033 was falsely characterized as binary-specific | RESOLVED | The license section now correctly treats Snapback as MIT and moves the live issue to inbound Hermes redistribution obligations. |
| 13 | LLP 0099 was misused as native-extension isolation evidence | RESOLVED | The migration-executor argument has been removed; D5 now rests on LLP 0009’s deployment threat-model distinction. |
| 14 | Prior art omitted relevant qualifications | RESOLVED | PocketBase’s JavaScript mode and official Supabase/Convex self-hosting are now acknowledged, and the SQLite analogy notes missing lifecycle and policy restrictions. |
| 15 | Related metadata omitted LLP 0099 and LLP 0102 | RESOLVED | Both now appear in `Related`. |

## 3. New findings

### MATERIAL — The “complete” handler-bridge inventory omits a recognized operation name

The RFC says `handle_host_call` exposes “21 operations” and presents its list as complete (`0141:175–184`). The match dispatcher recognizes 22 distinct operation strings. The missing name is:

- `action.externalEffectInitiated`

At `src/runtime.rs:1819`, it is accepted alongside `action.externalEffectBegin`:

```rust
"action.externalEffectBegin" | "action.externalEffectInitiated" => { ... }
```

There are 21 behavior arms if those two aliases are collapsed, but 22 callable operation names. Because the RFC presents a complete capability-surface inventory—not merely a count of implementation arms—the alias must be recorded or the counting convention explicitly stated.

The mandatory `ext.*` namespace still fixes the collision defect, so this is factual rather than a renewed namespace blocker.

### MATERIAL — The corrected public-constructor inventory is incomplete

The Summary and current-state section name:

- `AppState::from_snapback`
- `AppState::detached`
- `LocalSnapback::open`

They omit the relevant public constructor:

- `AppState::from_snapback_with_secret_read_operator`

That constructor is defined at `src/admin.rs:1399` and is exercised by integration tests. It directly bears on D4 because D4 lists “secret-read operator wiring” among the production-posture work.

The larger D4 conclusion remains valid: this constructor does not assemble the full sessions-auth, configuration, bundle, worker, and readiness lifecycle performed by `cli.rs`. But the as-built inventory must include it and distinguish “a public secret-read construction seam exists” from “the complete production-posture constructor does not exist.”

### MATERIAL — The one-file deploy affordance is still presented as low-cost despite the verified macOS runtime dependency

The motivation table says:

> “Single portable executable containing my app” → “one file, `scp` it, run it” → “Low — the seam exists.”

D6 later says that on macOS “single binary” may mean a relocatable bundle rather than one file and leaves the meaning open in OQ17.

The built executable confirms D6’s qualification: `target/debug/snapback` links:

```text
@rpath/hermesvm.framework/Versions/1/hermesvm
```

Its `LC_RPATH` includes `@loader_path/../Frameworks`. The executable is therefore not presently a self-contained one-file deployment. Baking the application bundle into the executable is low-cost; producing PocketBase’s one-portable-file result is part of the unresolved D6 program. The table conflates those two outcomes.

### MATERIAL — D7 contradicts the Summary about the proposed decision set

The Summary and revision ledger say only D1 and D4 are proposed as decisions today. But:

- D5 contains an explicit bold **Decision**;
- D5 is headed “proposed as constraint”;
- D7 places D1, D4, **and D5** under “Proposed for acceptance now.”

A standing security constraint is normative. The RFC must consistently say either:

- D1, D4, and D5 are proposed for acceptance; or
- only D1/D4 are proposed, while D5 remains an unaccepted constraint proposal.

This is load-bearing because D7 was added specifically to clarify what the author would accept now.

## 4. Verification ledger

| Check | Outcome |
|---|---|
| Target identity | Confirmed: SHA-256 `a82d1c6b6bfd737c126e2f96f79abcf3c8c4bad716e9ed1857afbd9d4bcf7dd6`; 530 lines. |
| Review blindness | Read only `llp/reviews/0141-embeddable-rust-library.codex.md` for LLP 0141. No other LLP 0141 review artifact was read. |
| RFC read | Read all 530 lines. |
| Round-1 artifact | Read all 267 lines and dispositioned all 15 findings. |
| Library/module facts | Confirmed `[lib]`, four-line `main.rs`, 48 `pub mod` declarations, and five `pub(crate) mod` declarations. |
| Embedding/server shape | Confirmed `app`, private `Router`, `Service` implementation, listener-consuming `bind`, `serve`, global `route_registry`, and discarded registration metadata. |
| `RouteSpec` | Confirmed eleven fields; `policy` aliases `path_policy`; method/path/class are identity; constructor takes eight arguments and defaults effect/session overlay. |
| Handler bridge | Inspected the full `handle_host_call` match. Confirmed eight namespaces, 21 behavior arms, and 22 recognized operation names because both external-effect spellings are accepted. |
| Protected-query gate | Confirmed closed allowlist, default denial with `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`, and general unknown-operation refusal. |
| Host operations | Confirmed closed dispatcher and current operation families, including seed operations, `function.explain`, assets, and auth operations. |
| Constructors | Confirmed `AppState::new`, `from_snapback`, `from_snapback_with_secret_read_operator`, `detached`, and `LocalSnapback::open`; inspected production assembly around `cli.rs:2558`. |
| Acceptance usage | Confirmed a minority of Rust integration files use `server::app`/`bind`, a larger group uses `LocalSnapback`, and JavaScript acceptance/conformance suites spawn a server process. |
| Embedded guide | Confirmed `build.rs::emit_embedded_guide` bakes the repository guide into the Snapback build. |
| Cargo dependency graph | Confirmed Snapback’s path-only `ibex-runtime` dependency and Ibex’s four path-only dependency entries, including two uses of `capsec-semantics`. |
| Native artifacts | Confirmed `vendor/ibex/ios/Frameworks` is approximately 74 MiB; a gzip-compressed tar of the whole directory is approximately 23.3 MB. |
| crates.io limit | Rechecked against the official Cargo Book: crates.io currently limits the compressed `.crate` file to 10 MB. [Cargo publishing documentation](https://doc.rust-lang.org/cargo/reference/publishing.html) |
| Loader custody | Confirmed Snapback’s build-script RPATH logic and the existing executable’s dynamic dependency on `hermesvm.framework`. |
| Governing LLPs | Rechecked the relevant portions of LLP 0009, 0031, 0033, 0060, 0099, and 0122. |
| Build/test execution | No build or test suite was run; this round used source, artifact, manifest, binary-header, size, and documentation inspection. |

## 5. Stopping-rule signal

No—the surviving text is not fully clean.

The one-file/low-cost framing at line 74 is a load-bearing claim I did not isolate in round 1, and it conflicts with both the as-built macOS loader arrangement and v0.2’s own D6/OQ17. I could not mechanically prove that sentence is byte-for-byte unchanged because the v0.1 blob was not available; I am classifying it as surviving pre-existing framing, not claiming a verified textual diff.

Apart from that framing and the newly revised inventory/scope defects above, I found no additional load-bearing defect in the surviving text.


## Round 3 — 2026-08-01 (delta-confined)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `medium` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** delta-confined round over the five v0.3 edits; read own rounds 1–2
only; blind to this RFC's fable artifact; Mach-O load-command inspection of the
built binary
**Instruction capsule SHA-256:** `76a3a33245e83206803c6532663a442dcd6dfdb7ce8e1484aedc3ac8e241ac97`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (v0.3, 571 lines, Draft)
**Target SHA-256:** `9853021d1baeb60d83568859251791962b6b2353e49d74b7f3c1138d260edea5`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

v0.3 correctly repairs the handler-operation count, detailed constructor inventory, portable-file cost classification, Mach-O description, and Ibex dependency classification. The underlying technical claims introduced by those edits check out against the tree.

Two editorially small but materially normative inconsistencies remain:

- The Summary still omits the public secret-read constructor from its constructor inventory.
- D7’s heading still says “decide two,” although the RFC now consistently proposes three decisions—D1, D4, and D5—everywhere else.

Because every factual and decision-scope claim must be accurate, v0.3 does not yet clear the stated bar.

NOT READY

## 2. Round-2 finding dispositions

| # | Round-2 finding | Disposition | Justification |
|---|---|---|---|
| 1 | Handler bridge recognizes 22 names, not 21 | RESOLVED | The RFC now accurately states “21 behaviour arms accepting 22 operation names,” includes `action.externalEffectInitiated`, and explains that it aliases `action.externalEffectBegin` in one match arm. The source confirms that convention. |
| 2 | Public-constructor inventory omitted `AppState::from_snapback_with_secret_read_operator` | PARTIALLY RESOLVED | Current State and D4 now include the constructor and correctly distinguish the existing secret-read seam from the missing composed production-posture constructor. However, the Summary at lines 59–62 still presents a three-constructor inventory that omits it. |
| 3 | One-portable-file affordance incorrectly classified as low-cost | RESOLVED | The motivation table now separates bundle baking from one-file portability and assigns the latter to the high-cost D6 program. The explanatory Mach-O claims are accurate. |
| 4 | Summary and D7 disagreed on whether D5 was proposed | PARTIALLY RESOLVED | The Summary, revision ledger, and D7 body now all identify D1/D4/D5. But the D7 heading remains “Scope: decide two, gate the rest,” contradicting that three-decision set. |

## 3. New findings

No wholly new technical or codebase-factual defect was introduced by the five edits. Two incomplete-correction residues remain.

### MATERIAL — The Summary still omits a public constructor

At lines 59–62, the Summary says:

> Public constructors (`AppState::from_snapback`, `AppState::detached`, `LocalSnapback::open`) already exist.

That remains an incomplete inventory because `AppState::from_snapback_with_secret_read_operator` is public at `src/admin.rs:1399`.

The detailed Current State inventory at lines 152–161 and D4 at lines 384–391 are now accurate. They explicitly record all four constructors and correctly state that a public secret-read seam exists while a composed production-posture constructor does not. The Summary should not contradict those corrected sections.

### MATERIAL — D7 still labels a three-decision proposal “decide two”

D7’s heading at line 458 remains:

> Scope: decide two, gate the rest

Its body immediately proposes D1, D4, and D5 for acceptance. The Summary likewise says that D5 is normative and “proposed for acceptance alongside the two it governs.”

The decision set is therefore three, not two. Because D7 exists to define what this Draft proposes now, its heading is load-bearing rather than cosmetic.

## 4. Verification ledger

| Check | Outcome |
|---|---|
| Target identity | Confirmed: 571 lines; SHA-256 `9853021d1baeb60d83568859251791962b6b2353e49d74b7f3c1138d260edea5`. |
| Review blindness | Read only `llp/reviews/0141-embeddable-rust-library.codex.md` for LLP 0141. No other LLP 0141 review artifact was inspected. |
| Prior reviews | Read both Codex rounds in full and dispositioned every round-2 finding. |
| Target RFC | Read all 571 lines. |
| Handler operation names | Confirmed 22 callable names across 21 top-level behavior arms in `handle_host_call`. |
| Alias convention | Confirmed `action.externalEffectBegin` and `action.externalEffectInitiated` share the arm at `src/runtime.rs:1819`. |
| Handler inventory completeness | Confirmed all 22 names listed by the RFC occur in the dispatcher; eight namespaces is correct. |
| Detailed constructor inventory | Confirmed `from_snapback`, `from_snapback_with_secret_read_operator`, `detached`, and `LocalSnapback::open` are public. |
| Secret-read distinction | Confirmed the special constructor returns `(AppState, SecretReadOperator)` and is documented as a trusted embedding variant. The RFC’s detailed D4 distinction is accurate. |
| Summary constructor inventory | Refuted as complete: it still lists only three of the four relevant public constructors. |
| Mach-O dependency | Confirmed `target/debug/snapback` is an arm64 Mach-O executable linked to `@rpath/hermesvm.framework/Versions/1/hermesvm`. |
| Relocatable RPATH | Confirmed an `LC_RPATH` of `@loader_path/../Frameworks`. |
| Absolute checkout RPATHs | Confirmed two absolute entries: `/Users/ccheever/projects/snapback/vendor/ibex/ios/Frameworks` and its `hermes.xcframework/macos-arm64_x86_64` child. |
| Build-script intent | Confirmed `build.rs` deliberately emits the loader-relative path plus discovered checkout-absolute framework paths. |
| Portable-file classification | Confirmed the current executable depends on an external Hermes framework and is not presently a self-contained one-file artifact. The revised D6 classification is correct. |
| Ibex dependency classification | Confirmed `ibex-windows-dll-staging` is an unconditional entry under `[build-dependencies]` at `vendor/ibex/Cargo.toml:260`, not under the preceding Windows dependency table. |
| Ibex path-dependency anchors | Confirmed `capsec-semantics` at lines 36 and 259, `ibex-sfe-format` at 37, `ibex-sfe-catalog` at 38, and `ibex-windows-dll-staging` at 260. |
| Proposed-decision set | Summary, revision ledger, and D7 body now agree on D1/D4/D5. D7’s “decide two” heading remains inconsistent. |
| Build/test execution | No build or test suite was run; verification used source, manifests, the existing binary, and Mach-O load-command inspection. |

## 5. Stopping-rule signal

The round-2 one-file/low-cost finding is settled. The revised table, explanation, D4 boundary, D6, and OQ17 now agree, and the current Mach-O validates their factual premise.

The two remaining defects are confined residues:

- The Summary’s constructor list survived without receiving the correction applied to Current State and D4.
- D7’s “decide two” heading survived without receiving the D1/D4/D5 correction applied to the Summary and D7 body.

Apart from those two residues, I found no additional load-bearing defect in text surviving from v0.2 and no new technical defect introduced by the v0.3 edits.


## Round 4 — 2026-08-01 (delta-confined)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `medium` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** delta-confined round over the three v0.4 edits, with
whole-document consistency sweeps for stale constructor lists, decision
counts, and line ranges; read own rounds 1–3 only; blind to this RFC's
fable artifact and to the super-refine journal
**Instruction capsule SHA-256:** `6968c0b55d0e4a98c68d2af10876dbae3bac6d4ac683c3b7c045bf3bed3479c1`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (v0.4, 580 lines, Draft)
**Target SHA-256:** `e82676d014cb862541e2b97f1c43de547259cb0194affdebbad3953a964ac51a`
**Status:** completed
**Verdict:** READY

## Verbatim review

## 1. Overall assessment

v0.4 resolves both round-3 findings and correctly repairs the `handle_host_call` range. The three edits agree with the source tree and introduce no new defect.

Consistency sweeps found no remaining active instance of the old three-constructor inventory, the old “decide two” count, or the stale `:1273–2130` range. Historical references to the former defects occur only in the `Revised:` ledger and accurately describe prior versions.

READY

## 2. Round-3 finding dispositions

| # | Round-3 finding | Disposition | Justification |
|---|---|---|---|
| 1 | Summary omitted `AppState::from_snapback_with_secret_read_operator` | RESOLVED | The Summary now names all four relevant public construction seams. This agrees with Current State and D4. The added constructor is public at `src/admin.rs:1399`. |
| 2 | D7 called the D1/D4/D5 proposal “decide two” | RESOLVED | D7 now says “decide three.” Its heading, body, Summary, and revision ledger consistently identify D1, D4, and D5 as the proposed decision set. |

## 3. New findings

None.

The three v0.4 edits introduced no `BLOCKING`, `MATERIAL`, or `DETAIL` finding.

## 4. Verification ledger

| Check | Outcome |
|---|---|
| Target identity | Confirmed: 580 lines; SHA-256 `e82676d014cb862541e2b97f1c43de547259cb0194affdebbad3953a964ac51a`. |
| Review blindness | Read only `llp/reviews/0141-embeddable-rust-library.codex.md` concerning LLP 0141. No other LLP 0141 review artifact or super-refine journal was inspected. |
| Prior reviews | Read Codex rounds 1–3 and dispositioned both round-3 findings. |
| Target RFC | Read all 580 lines. |
| Summary constructor list | Confirmed four names: `AppState::from_snapback`, `AppState::from_snapback_with_secret_read_operator`, `AppState::detached`, and `LocalSnapback::open`. |
| Constructor source anchors | Confirmed the three `AppState` functions are public at `src/admin.rs:1392–1408`; `LocalSnapback::open` is public at `src/local.rs:3281`. |
| Constructor consistency sweep | Confirmed Summary, Current State, and D4 all include the same four relevant construction seams. No active three-item version remains. |
| D7 decision count | Confirmed heading says “decide three”; its body names D1, D4, and D5. |
| Decision-set consistency sweep | Confirmed Summary, revision ledger, and D7 body agree on D1/D4/D5. “Decide two” appears only in the v0.4 historical correction record. |
| `handle_host_call` range | Confirmed the function starts at `src/runtime.rs:1273` and closes at line 2124. |
| Range consistency sweep | Confirmed the active citation is `src/runtime.rs:1273–2124`; no stale `:1273–2130` citation remains. |
| Build/test execution | None required; this round used source and document inspection. |
| Repository changes | None. |

## 5. Stopping-rule signal

Settled. Round 3 already found no additional load-bearing defect beyond its two correction residues. Both residues are now resolved, and the third v0.4 edit is factually correct.

In my judgment, LLP 0141 now meets the stated Draft-RFC bar: unresolved implementation questions are explicitly named, the relevant codebase claims checked in this round are true, and the proposed decision scope is internally consistent.
