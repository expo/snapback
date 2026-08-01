# LLP 0141 embeddable Rust library review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; mutually blind — no `llp/reviews/` artifact concerning LLP 0141 read,
blind to this RFC's codex artifact. SHA-pinned target and instruction capsule.
**Instruction capsule SHA-256:** `aab53ab2382e01f9f56e270700672c2d7c18c911b1c76754eff1625ece91c52f`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (382 lines, Draft)
**Target SHA-256:** `99c041264c2ae48712c8cfbcc4971e9c02ee0dfa11e8b7b4d6827a50619ed88c`
**Repo revision at review start:** origin/main `11dddced`
**Tool uses:** 55
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## Overall assessment

**Verdict: NOT READY**

This is a strong Draft RFC. Its central architectural argument — keep the router private, expose policy-carrying registration instead — is sound, correctly grounded in LLP 0060 §D1 and LLP 0031 §Enforcement, and nearly every file:line anchor it cites is exact. The distribution analysis (D6) is accurate. The self-hosted/hosted split in D5 matches LLP 0009's threat-model tiers faithfully.

It is not ready because one load-bearing as-built claim is factually wrong and a design decision is built directly on top of the error: the RFC's inventory of the handler capability bridge lists 10 of the ~22 operations `handle_host_call` actually dispatches, and D3a's namespace-reservation rule ("`db.*`, `runtime.*`, `permissions.*`, and `host.*` remain first-party") consequently leaves four real first-party namespaces (`jobs.*`, `assets.*`, `membership.*`, `action.*`) open to third-party collision. Several other material gaps — the incomplete reserved-path list that is itself the kind of second literal list ENG-24594 exists to prevent, the omission of the already-public `AppState::from_snapback`/`LocalSnapback::open` constructors from the D4 gap analysis, the unimplementable-as-stated capability-index claim for external embedders, and the absence of any execution-budget/panic-containment analysis for native ops — are the kind of thing "thought through as much as we can without running code" should have caught. One revision round should clear all of them.

## Strengths

- **File:line anchors are almost uniformly exact.** I verified every one: `src/server.rs:6989` (`RouteSpec`), `:7372` (`RegisteredRoute`, `pub(crate)`), `:13761` (`router_from_registrations`), `:13823` (`SnapbackApp`), `:13940` (`pub fn app`), `:13952` (`route_registry`), `src/runtime.rs:1273` (`handle_host_call`), `src/host_ops.rs:927` (`execute_host_op`), `src/admin.rs:827` (`AppState::new`), `Cargo.toml:27` (`ibex-runtime = { path = "vendor/ibex" }`). All correct to the line.
- **Quotes are faithful.** The router-privacy doc comment ("prevents the former accidental composition where a context derived from one listener was served on another"), the LLP 0060 §D1 phrases ("the public embedded network path", "never from a caller-supplied boolean", unknown/detached posture "fails closed for sessions"), the default-deny comment in `runtime.rs` ("Every other current/future host operation is a denied mutable non-database input until the registry explicitly classifies it"), and the "no second route-literal list" comment on `app()` are all verbatim or near-verbatim matches.
- **The two-seam distinction (handler bridge vs host-op registry) is real and correctly drawn**, including the self-correction note. `execute_host_op` dispatches exactly the operator-facing ops listed; the handler bridge is a different surface with different callers. The action-mode facts (actions deny `db.*`, action host validates ops separately) verify against `runtime.rs`.
- **The central argument is sound.** Given LLP 0060 D1 (posture from the bound socket, router and listener inseparable) and LLP 0031 §Enforcement ("The registered-route collection is the **only** source used to construct `app()`"), exposing the `Router` would demonstrably reopen both closed holes. Registration-with-mandatory-policy is the right shape, and the RFC is honest that the added ceremony is the point.
- **D6 is accurate.** crates.io does reject bare path dependencies; `build.rs`'s LC_RPATH rationale (ENG-22664, Cargo not propagating a dependency's `rustc-link-arg`) matches the file's own comments; `SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING` exists in both LLP 0010 §Bootstrap diagnostic codes and `scripts/bootstrap-ibex-runtime`. I also checked `emit_build_identity` for a hidden git-required publish blocker — it degrades gracefully (`if let Some(git_dir)`), so the RFC's blocker list is not missing that one.
- **Prior art is fair.** The PocketBase characterization (`OnServe().BindFunc`, unauthenticated-by-default custom routes, host-language coherence) is corroborated by the vendored PocketBase artifacts under `demos/pocketbase-snapback-bakeoff/`; the SQLite `sqlite3_create_function` analogy for D3a is apt.
- **The open questions it does have are good ones** — OQ2 (can a third party supply a *sound* classification) is exactly the right doubt about D3a, and its proposed fail-closed fallback is correct.

## Findings

**BLOCKING-1 — The handler-bridge op inventory is wrong, and D3a's namespace rule inherits the error.**
§Current state, "Handler capability bridge" bullet, and §D3a. The RFC presents this as the dispatch list: "`db.query`, `db.get`, `db.insert`, `db.patch`, `db.delete`, `runtime.log`, `runtime.now`, `runtime.id`, `permissions.requireRole`, and the action egress seam." The actual match in `handle_host_call` (src/runtime.rs:1318–2122) has 22 arms; the RFC omits `jobs.enqueue`, `assets.attach`, `membership.write`, `action.metadata`, `action.externalEffectBegin`/`Initiated`, `action.runMutation`, and the five `action.stream*` ops. These are not fringe: `ctx.jobs.enqueue` (LLP 0070) and `ctx.assets.attach` (LLP 0044) are documented ctx surfaces landed recently. D3a then proposes: extension ops carry a distinguishing prefix "so `db.*`, `runtime.*`, `permissions.*`, and `host.*` remain first-party" — leaving `jobs.*`, `assets.*`, `membership.*`, and `action.*` unreserved. Under the rule as written, a third party could register `assets.evil` or `action.streamOpen2` inside first-party namespaces. The design decision must be rebuilt on the real inventory (and, given that two of the missing namespaces appeared within the last month, should reserve by mechanism — e.g., a mandatory `ext.` prefix — rather than by enumerating today's first-party prefixes).

**MATERIAL-1 — "the entire acceptance suite drives in-process" is false as stated.**
§Summary finding 1. Of 57 integration test files under `tests/`, 11 reference `server::app`/`.bind()` at all; 34 drive `LocalSnapback` directly — a library surface that never touches the HTTP path — and the `tests/acceptance/*.mjs` suites drive a spawned served binary over the network, not in-process. The sentence also conflates two surfaces: what tests drive in-process is `app(state)` as a `tower::Service`, while `.bind(listener).serve()` is by definition the network path (a handful of tests do run it against a loopback listener in-process, e.g. `tests/admin_v0.rs:432`). The underlying point — the seam is real and load-bearing — survives, but the claim as written is checkably overstated in a section whose stated purpose is "so later revisions can tell design from description."

**MATERIAL-2 — The reserved-path denylist is incomplete and is structurally the drift pattern the RFC elsewhere condemns.**
§D2 constraints. The listed reservations (`/_snapback/*`, `/auth/*`, `/live/*`, `/query/*`, `/mutation/*`, "the admin surface") omit real first-party namespaces I enumerated from the registration builders: `/action/*`, `/app/*` (`/app/ensure`, `/app/bundle`), `/assets/*`, `/connection/*`, `/client-mutations/*`, `/ephemeral/*`, `/health`, `/inspect`, and `/`. Worse, a hand-maintained reserved-prefix list is precisely "a second route-literal list that can drift outside policy" — the exact hazard the RFC quotes approvingly from `app()`'s doc comment. The reservation should be derived from `all_route_registrations()` (or inverted: extensions confined to a dedicated prefix), and the RFC should say so.

**MATERIAL-3 — D2 ignores registry-validation and session-overlay obligations, and its "no defaulted variant" claim contradicts the constructor it would reuse.**
§D2. `RouteSpec::new` (src/server.rs:7003–7031) takes 8 arguments and *defaults* `effect_policy` to `None` and `session_overlay` to `NONE`; `RegisteredRoute::new` runs `spec.assert_valid()`. So "there is no defaulted or inferred variant" is false for two axes as-built. More substantively, LLP 0031 §Enforcement imposes obligations D2 never mentions: `AppAuth` "has no sessions meaning by itself"; a dev-only-authority route "must carry an overlay" for sessions; registry validation rejects Public entries with sensitive response types absent a typed projection. An embedder-facing registration API must state what happens to an embedder route in sessions mode and which axis combinations validation refuses. Silence here smuggles a settled-looking surface past a genuinely open design question.

**MATERIAL-4 — D4's gap analysis omits the embedding constructors that already exist.**
§D4 cites only `AppState::new` (src/admin.rs:827, "machinery an embedder cannot easily reproduce"). But `AppState::from_snapback(LocalSnapback, ServerContext)` (src/admin.rs:1392), `AppState::detached` (:1408), and `LocalSnapback::open(path)` (src/local.rs:3281) are public today and are what 34 test files actually use. The real gap is narrower than stated: a *production-posture* constructor (sessions auth provider, secret-read operator wiring, bundle/config lifecycle — the `cli.rs:2558` assembly), not a constructor per se. The "Current state" section should record the existing constructors; D4's deliverable should be scoped as "production-grade construction," which changes its size estimate.

**MATERIAL-5 — The capability-index requirement in D3 is not implementable as stated for external embedders.**
§D3: "Both slots must appear in `guide/capabilities.md` generation, or the capability index silently stops describing the running server." The served guide is embedded at *Snapback's* build time by `build.rs::emit_embedded_guide` from this repository's `guide/` tree. An external embedder registering ops in their own `main.rs` cannot add rows to that baked snapshot. Making the capability index honest for extended servers requires a runtime-composed index (or a manifest-row mechanism like the one D5 proposes for the native-extension flag) — a real design problem the RFC states as a one-line requirement without noticing it cannot be met by the existing mechanism.

**MATERIAL-6 — D5/D3a omit execution budgets, cancellation, and panic containment for native ops.**
§D5 correctly says linked Rust sits "above the sandbox, with no interposition possible," but analyzes only *authority*. LLP 0009's revision history is emphatic that enforcement is per-engine and per-invocation-class, and that "native host work can only be abandoned after a bounded grace rather than forcibly killed." A third-party native op invoked from a query/mutation runs on host threads holding host locks with no watchdog; a hang or panic is a whole-server availability event (and D3a ops can trivially retain state across invocations, eroding LLP 0009's "runtime state does not leak between invocations" goal for data flowing through them). D3a's registration requirements (name, classification, invocation mode) need a fourth and fifth entry — budget/cancellation semantics and an error/panic contract — or D5 needs to say explicitly why self-hosted trust makes these out of scope.

**MATERIAL-7 — A typed subtree-mount alternative is never considered.**
§D2 argues against "an untyped mounting hook" (correctly), but the only alternatives weighed are raw router exposure vs per-route registration. A third option exists: a *policy-carrying subtree mount* — one registry row declaring a policy envelope for everything under a reserved extension prefix, enforced by the same middleware at the mount boundary. It preserves router↔registry parity (the registry honestly says "everything under `/ext/` carries policy P") while recovering most of the PocketBase ergonomics the RFC concedes are lost. It may still lose (per-route `ResponseSensitivity` cannot be declared), but for a document whose core claim is "we kept the ergonomics without the hole," the strongest competing design should be named and rejected, not absent.

**DETAIL-1 — "eleven independent axes" overstates independence.** §Current state. `RouteSpec` has eleven fields, but the struct's own doc comment says `policy` "is retained as a source compatible spelling of `path_policy`; constructors set both and the router refuses registrations where they differ" — so at most ten are independent, and LLP 0031's own taxonomy names seven policy axes (method/path/class are identity, not policy).

**DETAIL-2 — "every internal type in `server.rs` … is nominally public" is contradicted three paragraphs later** by the RFC's own (correct) observation that `RegisteredRoute` is `pub(crate)`; `router_from_registrations` and `all_route_registrations` are likewise not exposed. "Every `pub` item in 48 public modules" is the accurate claim.

**DETAIL-3 — Related header omits LLP 0099 and LLP 0102**, both cited in the body (OQ5, OQ1). The capsule's citation list includes them; the document's own metadata does not.

**DETAIL-4 — The LLP 0033 framing points the wrong direction.** §D5: "an embeddable library invites linking that a binary distribution does not." Snapback is MIT (LLP 0033, Accepted) — outbound linking imposes nothing on anyone. The live license question for D6 is *inbound/redistribution*: shipping prebuilt Hermes artifacts inside a published crate. OQ4 keeps the question open, which is right, but the sentence motivating it misidentifies the concern.

**DETAIL-5 — "LLP 0051 / LLP 0064 cover non-JS *clients*" is imprecise.** LLP 0064's first surface is React Native/Expo — a JS client — and LLP 0051 is the language-neutral data tier (mutation IR, recordable ctx, WASM handler artifacts), broader than "clients." The load-bearing half of the sentence ("not an embeddable server; adjacent and non-overlapping") is correct.

**DETAIL-6 — `route_registry()` is a static free function.** §D2 says embedder registrations "join the same registration list that `route_registry()` projects," but as built it projects `all_route_registrations()` unconditionally; per-instance registrations require an instance-scoped registry projection, and LLP 0031's method-parity sweep runs against the static list. The design implies this shape change without recording it.

## Verification ledger

| Claim | Method | Outcome |
| --- | --- | --- |
| Target SHA-256 = `99c04126…` | `shasum -a 256` | Confirmed |
| `src/main.rs` is four lines | Read file | Confirmed (4 lines) |
| `Cargo.toml` `[lib] name = "snapback"`; `:27` path dep on `vendor/ibex` | Read file | Confirmed, line-exact |
| `src/lib.rs`: 48 `pub mod`, five `pub(crate)` | grep -c | Confirmed (48 / 5); no `#[doc(hidden)]` in lib.rs |
| `server.rs` "44k lines" | wc -l | Confirmed (44,343) |
| `pub fn app` at `server.rs:13940`; `SnapbackApp` at `:13823`; doc comment at `:13815`; `route_registry` at `:13952`; `router_from_registrations` at `:13761`; `RouteSpec` at `:6989`; `RegisteredRoute` `pub(crate)` at `:7372` | grep -n + read | All confirmed, line-exact |
| `SnapbackApp` implements `tower::Service&lt;Request&lt;Body&gt;&gt;`; `bind` → `BoundSnapbackApp` with `serve`/`serve_with_graceful_shutdown` | Read server.rs 13800–13930; `use tower_service::Service` at :109 | Confirmed |
| Router-privacy quote "prevents the former accidental composition…" | Read doc comment | Confirmed verbatim |
| Per-registration `enforce_registered_route_policy` layered before same-path merge; registry projected from same registrations | Read `router_from_registrations` (13761–13800), `app()`, `route_registry()` | Confirmed |
| "no second route-literal list" comment | Read `app()` doc comment | Confirmed verbatim |
| `RouteSpec` field list (11 fields) | Read struct at 6989 | Confirmed fields; "independent" refuted for `policy` (doc comment: duplicate of `path_policy`) |
| `handle_host_call` at `runtime.rs:1273`; default-deny gate at ~1276 with quoted comment; `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED` | Read 1240–1400 | Location and quote confirmed; RFC's op enumeration **refuted** — 12 dispatched ops omitted (see BLOCKING-1; full arm list extracted at 1318–2122) |
| Unknown ops error in all modes | Read match tail (`SNAPBACK_HANDLER_HOST_CALL_UNKNOWN`) | Confirmed |
| Actions deny db calls; action host validates ops | Read `action_db_denied`, `validate_host_call` sites | Confirmed |
| `execute_host_op` at `host_ops.rs:927`; op names (`app.inspect`, `app.reset`, `schema.load`, `functions.load`, `function.run`, `asset.*`, `auth.mintSession`) | grep + read | Confirmed |
| `AppState::new` at `admin.rs:827` taking `SharedSnapback`, `ReadLane`, `EphemeralApi` (+`ServerContext`) | Read 810–870 | Confirmed; but public `from_snapback`/`detached`/`LocalSnapback::open` also exist (MATERIAL-4) |
| "entire acceptance suite drives in-process" | grep across `tests/` (57 files; 11 use `server::app`/bind; 34 use `LocalSnapback`; `.mjs` acceptance drives spawned binaries) | Refuted as stated |
| LLP 0060 §D1: "public embedded network path", "never from a caller-supplied boolean", detached/Unknown fails closed for sessions | Read 0060 lines 213–267 | Confirmed, verbatim |
| LLP 0031 §Enforcement: registered collection sole router source; `route_registry()` read-only projection; ENG-24594 | Read 0031 lines 162–241 + code comments | Confirmed |
| LLP 0009 §Summary: capability-limited runtime, no ambient SQLite/fs/network/env/secrets, explicit host APIs; hosted multi-tenant as separate threat model | Read 0009 Summary + Threat Model | Confirmed |
| LLP 0010 §Bootstrap diagnostic codes; `SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING` in 0010 and bootstrap script | grep | Confirmed |
| LLP 0024 HTTP operation registry; `guide/capabilities.md` host-ops rows citing llp/0024 | grep both files | Confirmed |
| LLP 0033 = MIT license decision, Accepted | Read header/summary | Confirmed; RFC's "written for a binary"/linking framing is a stretch (DETAIL-4) |
| LLP 0041 npm closure; LLP 0122 installed-product coherence; LLP 0099 container-VM executor profile; LLP 0102/0139 bakeoff programs | Read headers | Confirmed (0099 is specifically the *migration*-executor profile; OQ5's extrapolation is fair as a question) |
| LLP 0051/0064 scope | Read headers/summaries | Broadly confirmed; "non-JS clients" imprecise (DETAIL-5) |
| `build.rs` LC_RPATH / ENG-22664 / no link-arg propagation | Read build.rs 1–40 | Confirmed (file's own comments match) |
| crates.io rejects bare path deps | Prior knowledge of cargo publish semantics | Plausible/standard, not independently executed |
| PocketBase `OnServe().BindFunc`, unauthenticated-by-default routes | Corroborated via vendored PB artifacts in `demos/pocketbase-snapback-bakeoff/` + prior knowledge | Plausible, corroborated; not verified against upstream docs |
| Reserved-prefix completeness | Enumerated path literals from registration builders in server.rs/admin.rs | RFC list refuted as incomplete (MATERIAL-2) |

Not read: anything under `llp/reviews/` concerning 0141 (per blindness constraint).

## Open questions the RFC should add

1. **What are the execution-budget, cancellation, and panic-containment obligations of a registered native op?** LLP 0009's per-class enforcement story does not cover them, and "self-hosted trust" answers the authority question but not the availability one. (MATERIAL-6)
2. **How does the capability index describe an extended server?** The served guide is baked from this repository at Snapback's build time; extension ops registered in an embedder's binary cannot appear in it. Runtime-composed index, manifest rows, or an honest "index describes the stock surface only" disclaimer — which? (MATERIAL-5)
3. **What is the sessions-mode contract for embedder-registered routes?** Which axis combinations does registry validation refuse, and is a `SessionModeOverlay` statement mandatory? (MATERIAL-3)
4. **Should extension routes and extension ops be confined to dedicated namespaces** (path prefix and op prefix allowlists) rather than guarded by enumerated denylists that must chase the first-party surface? The last month added `jobs.*` and `assets.*` to the handler bridge; any enumeration in this RFC is already one release stale. (BLOCKING-1, MATERIAL-2)
5. **What stability/semver policy does `snapback::embed` carry relative to the wire protocol** (LLP 0093 fixtures, `wire_version`)? D1 says the boundary must be "written down" but does not say what the promise is, or how a 0.x crate version relates to protocol versioning.


## Round 2 — 2026-08-01 (delta-scoped)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** delta-scoped round — read own round-1 artifact only; blind to this
RFC's codex artifact; read-only; corrected inventories re-verified against the
tree rather than assumed
**Instruction capsule SHA-256:** `3769922210c609b86611e0f4e8849204f54ac1b1261ce214a356233e6636c0dd`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (v0.2, 530 lines, Draft)
**Target SHA-256:** `a82d1c6b6bfd737c126e2f96f79abcf3c8c4bad716e9ed1857afbd9d4bcf7dd6`
**Tool uses:** 26
**Status:** completed
**Verdict:** READY

## Verbatim review

## Overall assessment

**Verdict: READY**

v0.2 is a substantially stronger document than v0.1, and — more importantly for this round — its corrections are *actually correct*, not merely responsive. I re-verified every corrected inventory against the working tree rather than trusting the revision: the 21-arm handler-bridge dispatch list is right (with one alias-spelling residue noted below), the ten previously-missed route prefixes are now the complete complement of the first draft's six against the real registration builders (including `/outbox/*`, which my own round-1 enumeration missed), the `RouteSpec` field/default/builder analysis matches the struct and constructor exactly, the constructor inventory and its line anchors are exact, and the distribution facts (path-dep graph inside `vendor/ibex/Cargo.toml`, the 74 MB framework directory, the baked-guide mechanism) all check out. The structural responses go beyond patching: D2b/D3a replace enumerated denylists with reservation-by-mechanism and correctly diagnose why the enumeration failed; D2a names the registry-scoping shape change as a real invariant change rather than an additive API; D3a's items 4–5 absorb the availability/panic axis with accurate LLP 0009 grounding; the capability-manifest trust signal is withdrawn for the right reason; and D7's rescoping (decide D1/D4, demand-gate D2/D3, mark D6 blocking-unscheduled) makes the evidence-to-decision ratio honest.

All thirteen of my round-1 findings are resolved, none partially. The three new findings this round are DETAIL-grade factual burrs with no design consequence — and notably, two of them are instances of the exact stale-enumeration failure mode the RFC itself now argues makes mechanism-over-enumeration the right design, so they reinforce rather than undermine its conclusions. Under the stated bar — thought through as far as possible without running code, with every open item named as open (17 OQs, each attached to the decision it gates) — this Draft clears.

## Round-1 finding dispositions

| Round-1 finding | Disposition | Justification |
| --- | --- | --- |
| BLOCKING-1 — handler-bridge inventory wrong; D3a namespace rule inherits it | **RESOLVED** | v0.2 lists the full dispatch (verified: 21 arms, eight namespaces, `src/runtime.rs:1273`) and D3a now mandates a disjoint-by-construction `ext.` prefix instead of enumerating first-party prefixes. One alias-name residue → new DETAIL-1. |
| MATERIAL-1 — "entire acceptance suite drives in-process" false | **RESOLVED** | Rewritten as minority `server::app`/`.bind()`, larger group `LocalSnapback`, spawned `.mjs` acceptance. Re-verified: 11 vs 34 of 46 `tests/*.rs`, spawn in acceptance harness. Summary finding 1 now says "Rust integration tests." |
| MATERIAL-2 — reserved-path denylist incomplete and itself the drift pattern | **RESOLVED** | D2b reserves by mechanism (dedicated prefix or derivation from `all_route_registrations()`), names the second-literal-list hazard explicitly, and the corrected missed-prefix list is complete against the tree — it includes `/outbox/*`, which my own round-1 sweep missed. |
| MATERIAL-3 — defaulted axes contradiction; sessions/validation obligations unstated | **RESOLVED** | D2c concedes the two defaulted axes (verified: `EffectPolicy::None`, `SessionModeOverlay::NONE` in `RouteSpec::new`, `src/server.rs:7027–7030`), states the LLP 0031 obligations, and names the sessions-mode contract as OQ8 — open item properly named open. |
| MATERIAL-4 — D4 omits existing public constructors | **RESOLVED** | Current state records `from_snapback` (:1392), `detached` (:1408), `LocalSnapback::open` (local.rs:3281) — all re-verified line-exact — and D4 is narrowed to production-posture construction anchored at `cli.rs:2558` (verified: the `AppState::new_with_secret_read_operator` assembly). One further constructor still unrecorded → new DETAIL-3. |
| MATERIAL-5 — capability-index requirement unimplementable | **RESOLVED** | Current state records the baked guide (`build.rs::emit_embedded_guide`, verified at build.rs:102), D3 withdraws the one-line requirement and names the three honest alternatives as OQ13. |
| MATERIAL-6 — no budget/cancellation/panic analysis for native ops | **RESOLVED** | D3a items 4–5 are mandatory registration requirements; the authority-vs-availability distinction is drawn; both LLP 0009 quotes relied on ("bounded grace rather than forcibly killed", "Runtime state does not leak between invocations") re-verified verbatim at llp/0009 lines 39 and 67. OQ11 carries the semantics. |
| MATERIAL-7 — subtree-mount alternative absent | **RESOLVED** | Adjudicated: rejected as primary because `ResponseSensitivity`/`EffectPolicy` are per-operation and an envelope collapses to the most permissive member; retained as fallback; OQ6 keeps promotion open. The rejection reasoning is sound. |
| DETAIL-1 — "eleven independent axes" overstated | **RESOLVED** | v0.2 says "not eleven independent axes," cites the `policy`/`path_policy` doc comment (verified at :6985–6987) and the identity-vs-policy split. |
| DETAIL-2 — "every internal type nominally public" self-contradicted | **RESOLVED** | Replaced with the accurate claim ("every `pub` item inside 48 public modules"); re-verified 48 `pub mod` / 5 `pub(crate)` / 0 `doc(hidden)` in src/lib.rs. |
| DETAIL-3 — Related header missing 0099/0102 | **RESOLVED** | Both present, plus 0044 and 0070 for the newly-cited namespaces. |
| DETAIL-4 — LLP 0033 framing backwards | **RESOLVED** | D5 "License direction corrected": outbound linking imposes nothing; live question is inbound Hermes redistribution (OQ15). |
| DETAIL-5 — "non-JS clients" imprecise | **RESOLVED** | Prior art now: 0051 = language-neutral data tier, 0064 = client surfaces including JS ones. |
| DETAIL-6 — `route_registry()` static/process-global shape change unrecorded | **RESOLVED** | D2a records it as "a real shape change to a load-bearing invariant," proposes instance-scoped projection/build receipt, and notes LLP 0031's sweep must be taught which registry it checks. Re-verified: `route_registry()` argument-free over `all_route_registrations()` (:13952), `SnapbackApp` retains only `state` + `router` (:13823). |

All five of my round-1 "open questions the RFC should add" now exist as OQ11, OQ13, OQ8, the D2b/D3a mechanism plus OQ5, and OQ16 respectively.

## New findings

**DETAIL-1 — "The complete inventory is 21 operations" omits one accepted operation name.** §Current state, handler-bridge bullet. The dispatcher has 21 match arms, but the arm at `src/runtime.rs:1819` is `"action.externalEffectBegin" | "action.externalEffectInitiated"` — two accepted op-name strings (the code comment: the trusted harness closes "begin→initiated without an unknown-op refusal"). So the bridge accepts 22 operation names across 21 behaviors, and a list billed as "complete" omits `action.externalEffectInitiated`. No design consequence — D3a reserves by `ext.` prefix precisely so nothing hangs on this enumeration — but a sentence claiming completeness in a section claiming full re-verification should count the alias or say "21 arms."

**DETAIL-2 — "conditionally ibex-windows-dll-staging" is not conditional.** §Current state, distribution bullet. `vendor/ibex/Cargo.toml:260` declares `ibex-windows-dll-staging = { path = "crates/windows-dll-staging" }` as a plain entry in the `[build-dependencies]` section (which opens at :250) — no `target.'cfg(…)'` gate at the manifest level. If anything this strengthens D6 (the crate must be published unconditionally), so the direction of the claim is unaffected; the adverb is wrong.

**DETAIL-3 — The corrected constructor inventory still misses one public embedding constructor, and it weakens one clause of D4's gap list.** §Current state / §D4. `AppState::from_snapback_with_secret_read_operator(LocalSnapback, ServerContext) -> (Self, SecretReadOperator)` is public at `src/admin.rs:1399`, doc-commented *"Trusted embedding variant that retains the non-network minting seam."* D4 lists "secret-read operator wiring" among what is missing; the wiring seam already has a public constructor. The composed production-posture constructor (sessions auth provider + config/bundle lifecycle + the `cli.rs:2558` assembly) is genuinely absent, so D4's conclusion and sizing stand — but a Current-state section that says "every claim below was re-verified" should record this constructor alongside the other three.

Nothing MATERIAL or BLOCKING. I looked specifically for defects in the newly-added text (D2a's interference claim, the subtree-mount rejection rationale, D3b's host-op-extension scope including the `OperationSpec` registry, the manifest-row withdrawal argument, D6's expanded program, OQ7's axum-specific hazards) and found the reasoning and the underlying facts sound.

## Verification ledger

| Claim | Method | Outcome |
| --- | --- | --- |
| Target = 530 lines, SHA-256 `a82d1c6b…` | `shasum -a 256`, `wc -l` | Confirmed |
| Handler-bridge dispatch: arms and names in `handle_host_call` | Extracted all arm patterns, `src/runtime.rs:1273–2124` | 21 arms confirmed; all 21 listed names present; **one extra accepted name** `action.externalEffectInitiated` in the Begin arm (:1819) → DETAIL-1 |
| Eight namespaces (db, runtime, permissions, host, jobs, assets, membership, action) | Same extraction | Confirmed |
| `:1276` protected-query closed allowlist; `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED` default-deny comment; `SNAPBACK_HANDLER_HOST_CALL_UNKNOWN` tail | Read 1273–1330, grep (:2119) | Confirmed |
| `RouteSpec` at :6989, 11 fields as listed; doc comment at :6985–6987 (`policy` = source-compatible spelling); `new` takes 8 args, defaults `EffectPolicy::None` + `SessionModeOverlay::NONE`; `with_effect`/`with_session_overlay` (:7046) | Read struct + impl | Confirmed, line-exact |
| `RegisteredRoute` `pub(crate)` :7372; `router_from_registrations` :13761; `SnapbackApp` :13823 retaining only `state`+`router`; router-privacy doc comment :13815; `app` :13940; "no second route-literal list" comment :13935; `route_registry()` :13952 argument-free over `all_route_registrations()` | grep -n + read | All confirmed, line-exact |
| Reserved-prefix complement: first-party top-level prefixes from `core_route_registrations` + `system_route_registrations` + `admin_route_registrations` | Extracted every path literal from all three builders | Full set = `/`, `/health`, `/inspect`, `/auth`, `/query`, `/mutation`, `/action`, `/app`, `/assets`, `/client-mutations`, `/connection`, `/live`, `/outbox`, `/ephemeral`, `/_snapback` — v0.2's "missed" list is exactly the complement of the first draft's six; **complete** (includes `/outbox`, absent from my round-1 finding) |
| Test-embedding claim (minority app/bind, larger group LocalSnapback, spawned acceptance) | grep -l counts over `tests/` | Confirmed: 46 `.rs` files, 11 reference `server::app`/`.bind(`, 34 use `LocalSnapback`; `.mjs` acceptance spawns served binaries |
| Constructors: `AppState::new` :827, `from_snapback` :1392, `detached` :1408, `LocalSnapback::open` local.rs:3281 | grep -n + read | Confirmed, line-exact; **also found public `from_snapback_with_secret_read_operator` :1399** → DETAIL-3 |
| `cli.rs` production assembly "around :2558" | Read 2550–2570 | Confirmed (`AppState::new_with_secret_read_operator` call at :2558) |
| `src/lib.rs`: 48 `pub mod`, 5 `pub(crate) mod`, 0 `#[doc(hidden)]`; server.rs "hundreds of private items" | grep -c | Confirmed (48/5/0; 338 top-level items in server.rs) |
| `execute_host_op` at host_ops.rs:927 | grep -n | Confirmed (tree moved to 5d5c6b71 since round 1; anchor still exact) |
| `build.rs::emit_embedded_guide` bakes `guide/` at build time | grep build.rs (:27, :102) | Confirmed |
| `Cargo.toml:27` bare path dep on `vendor/ibex` | grep -n | Confirmed, line-exact |
| `vendor/ibex` path-only deps: capsec-semantics (:36), ibex-sfe-format (:37), ibex-sfe-catalog (:38), ibex-windows-dll-staging (:260) | grep + read context | Confirmed present; windows-dll-staging is an **unconditional** `[build-dependencies]` entry → DETAIL-2 |
| `vendor/ibex/ios/Frameworks` = 74 MB | `du -sk` = 75,960 KB ≈ 74.2 MiB | Confirmed |
| LLP 0009: "native host work can only be abandoned after a bounded grace rather than forcibly killed" (:39); "Runtime state does not leak between invocations" (:67) | grep + read context | Confirmed verbatim |
| LLP 0031 `OperationSpec` registry exists (D3b claim) | grep llp/0031 (:265) + `src/server.rs` | Confirmed |
| Related header includes 0044, 0070, 0099, 0102 | Read header | Confirmed |
| crates.io 10 MB package limit; PocketBase JS extension mode (jsvm) | Prior knowledge | Standard/known; not independently executed this round |

Not read: any `llp/reviews/` artifact concerning LLP 0141 other than my own round-1 file (blindness preserved). The RFC is untracked in git, so v0.1 could not be re-derived from history; first-draft claims ("listed ten," "listed six prefixes") were checked against the v0.1 quotes preserved in my round-1 artifact and are consistent.

## Stopping-rule signal

The pre-existing text that survived unchanged from v0.1 is, in my judgement, **clean**. I made a second pass over the surviving material — the motivation table and its three-affordance framing, the embedder-profile taxonomy (now evidence-tagged but substantively unchanged), the router-privacy and LLP 0060/0031 invariant analysis, the D5 self-hosted/hosted trust split, the D6 LC_RPATH/ENG-22664 facts, and the prior-art section — and found nothing load-bearing that is wrong or unsupported; every anchor and quote in it re-verified or had been verified line-exact in round 1 against a tree that has not invalidated them. The three residues found this round are all in *revised* text, are DETAIL-grade, and none has a design consequence. Combined with all thirteen round-1 findings resolving cleanly on independent re-verification, this document has stopped yielding material findings under adversarial re-reading.

READY


## Round 3 — 2026-08-01 (delta-confined)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** delta-confined round over the five v0.3 edits; read own rounds 1–2
only; blind to this RFC's codex artifact and to the super-refine journal;
read-only; Mach-O load-command inspection of both built binaries
**Instruction capsule SHA-256:** `a20d0d4a076f478eedcbdf9aa2ff893577a5318ed50ef09464b3f17d56a2634a`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (v0.3, 571 lines, Draft)
**Target SHA-256:** `9853021d1baeb60d83568859251791962b6b2353e49d74b7f3c1138d260edea5`
**Tool uses:** 23
**Status:** completed
**Verdict:** READY

## Verbatim review

## Overall assessment

**Verdict: READY**

This was a narrow, delta-confined round, and the five v0.3 edits do exactly what they claim, verifiably. I re-verified each one against the working tree at `5d5c6b71` (every load-bearing source file unmodified since round 2) rather than trusting the revision note — including the two claims that required new evidence classes this round. The Mach-O claims are true against both built binaries: `otool -L` shows `target/debug/snapback` and `target/release/snapback` each linking `@rpath/hermesvm.framework/Versions/1/hermesvm`, and `otool -l` shows both carrying the `@loader_path/../Frameworks` entry plus absolute `LC_RPATH` entries into a developer checkout (the debug binary into `/Users/ccheever/projects/snapback/vendor/ibex/ios/Frameworks[...]`, the release binary into a `.claude/worktrees/fastpath-018` checkout — which incidentally *demonstrates* the non-portability the split table row now prices as high-cost). The 21-arm/22-name convention is exactly right under the correct counting: the main dispatcher has 21 behaviour arms (the `runtime.now`/`runtime.id` appearances at `:1285`/`:1292` are denial arms inside the protected-profile pre-gate, not dispatch arms), the shared arm at `:1819` accepts both `externalEffect` names, and the RFC's enumerated list contains exactly 22 distinct names across exactly the eight namespaces the tree yields. The constructor edit, the unconditional `[build-dependencies]` correction with its four line anchors, and the D1/D4/D5 consistency sweep all check out line-exact.

All three of my round-2 findings are resolved, correctly and without collateral damage. One new DETAIL-grade burr (a six-line overshoot on a cited line range) has no design consequence. The document clears the stated bar.

## Round-2 finding dispositions

| Round-2 finding | Disposition | Justification |
| --- | --- | --- |
| DETAIL-1 — "complete inventory is 21 operations" omitted the aliased 22nd name | **RESOLVED** | Now stated as "21 behaviour arms accepting 22 operation names, across eight namespaces," with the shared arm cited at `:1819` and `action.externalEffectInitiated` present in the enumeration. Re-verified: 22 distinct quoted op names in `src/runtime.rs:1273–2124`, 21 dispatch arms, alias arm at `:1819` exact. The text even converts the residue into a second argument for reservation-by-mechanism ("twice over"), which is fair. |
| DETAIL-2 — "conditionally ibex-windows-dll-staging" wrongly conditional | **RESOLVED** | Now "an *unconditional* `[build-dependencies]` entry, not a target-gated one, so it must be published too." Re-verified: plain `[build-dependencies]` section opens at `vendor/ibex/Cargo.toml:251`; entry at `:260` with no `target.'cfg(…)'` gate anywhere; the added anchors (`capsec-semantics` `:36` and `:259`, `ibex-sfe-format` `:37`, `ibex-sfe-catalog` `:38`) are all line-exact. |
| DETAIL-3 — constructor inventory missed public `from_snapback_with_secret_read_operator` | **RESOLVED** | Current state now lists four constructors including `from_snapback_with_secret_read_operator` (`src/admin.rs:1399`, doc comment quoted verbatim — re-verified line-exact), and D4 now draws precisely the distinction I asked for: the secret-read seam is public; the *composed production-posture* constructor is what is missing. The "are what the test suite uses" clause holds — `tests/auth_bypass_v1.rs` and `tests/admin_secret_read_v0.rs` use the secret-read variant; 14 test files use the other three. |

## New findings

**DETAIL-1 — The handler-bridge range citation overshoots the function by six lines.** §Current state, handler-bridge bullet, cites `handle_host_call` as `src/runtime.rs:1273–2130`. The function spans `1273–2124` (the unknown-op tail at `:2118–2122`, closing braces at `:2123–2124`; `:2130` is inside the doc comment of the unrelated `take_terminal_denial`). Every load-bearing anchor in the bullet (`:1273`, `:1276`, `:1819`) is exact and the range fully contains the dispatcher, so nothing hangs on this; it may even predate v0.3. Flagged only because the document's own standard elsewhere is line-exactness.

Nothing MATERIAL or BLOCKING. I looked specifically for defects the five edits could have introduced: whether the split table rows still sum to the original claim (they do, and the low/high pricing matches D4/D6's division of labour); whether the new Mach-O paragraph's facts hold on a real binary (they do, on two); whether "eight namespaces" survived the name-count correction (it did); whether the Summary's three-constructor illustrative list contradicts the current-state four (it does not claim completeness); and whether any stray "D1 and D4" phrasing survived the consistency edit (a full-document sweep finds none — lines 22, 48–51, and 463 all agree on D1/D4/D5).

## Verification ledger

| Claim | Method | Outcome |
| --- | --- | --- |
| Target = 571 lines, SHA-256 `9853021d…`; tree at `5d5c6b71`; `src/runtime.rs`, `src/admin.rs`, `src/local.rs`, `vendor/ibex/Cargo.toml`, `build.rs`, `Cargo.toml` unmodified vs HEAD | `shasum -a 256`, `wc -l`, `git status --porcelain` | Confirmed |
| Binary links `@rpath/hermesvm.framework/Versions/1/hermesvm` | `otool -L` on `target/debug/snapback` and `target/release/snapback` | Confirmed, both binaries, install name verbatim |
| Binary carries `@loader_path/../Frameworks` + absolute checkout `LC_RPATH` entries | `otool -l \| grep -A2 LC_RPATH` on both binaries | Confirmed: debug = 1 relative + 2 absolute (main checkout); release = 1 relative + 3 absolute (worktree checkout) |
| `build.rs` is the emitter and explains why | Read `build.rs` (`:4–13` comment, `emit_macos_rpath` `:219–226`, `@loader_path/../Frameworks` at `:81`) | Confirmed; ENG-22664/no-link-arg-propagation comment matches |
| 21 behaviour arms / 22 operation names / 8 namespaces; alias arm at `:1819` | Extracted all quoted op names in `:1273–2124` (22 distinct); enumerated main-dispatch arms ≥`:1320` plus pre-gate structure read at `:1273–1330` | Confirmed exactly; `:1285`/`:1292` are pre-gate denial arms, correctly excluded from the arm count |
| RFC's 22-name enumeration matches the tree's name set | Set comparison | Confirmed — identical sets |
| `handle_host_call` cited as `:1273–2130` | Read `:2115–2132` | Function ends `:2124` → new DETAIL-1 |
| `from_snapback` `:1392`, `from_snapback_with_secret_read_operator` `:1399` with verbatim doc comment, `detached` `:1408`, `LocalSnapback::open` `local.rs:3281` | Read `admin.rs:1385–1415`, `local.rs:3278–3284` | All confirmed, line-exact |
| Four constructors "are what the test suite uses" | grep across `tests/` | Confirmed (2 files use the secret-read variant; 14 use the others) |
| `ibex-windows-dll-staging` unconditional; section/anchor lines | Read `vendor/ibex/Cargo.toml:248–262`; grep all `[` section headers | Confirmed: `[build-dependencies]` `:251`, entry `:260`, no target-gated build-deps section, single declaration |
| `capsec-semantics` `:36`/`:259`, `ibex-sfe-format` `:37`, `ibex-sfe-catalog` `:38` | sed | Confirmed, line-exact |
| Decision set consistent as D1/D4/D5 everywhere | grep full document | Confirmed (Summary `:48–51`, D7 `:463`, header `:22`, `:36`) |
| Split table rows + D4/D6 division ("bundle-baking half" vs "one-portable-file half") cross-reference cleanly | Read §Motivation, §D4, §D6, OQ17 | Confirmed, internally consistent |
| v0.3 Revised entry accurately describes the five edits | Compared against verified deltas | Confirmed |

Not read: `llp/reviews/0141-embeddable-rust-library.codex.md`, the super-refine journal, or any other artifact concerning LLP 0141 besides my own (blindness preserved). The RFC is untracked, so v0.2 text is unrecoverable from history; deltas were judged against the v0.2 claims preserved in my own round-2 artifact.

## Stopping-rule signal

The text surviving unchanged from v0.2 is **settled**. I judged it clean in round 2 after a deliberate second pass, and nothing verified this round contradicts any of it — the constructor, dispatch, manifest, and registry anchors I re-touched all still hold line-exact against an unchanged tree. The five v0.3 edits were delta-confined, did what the Revised entry says, and introduced one DETAIL-grade anchor burr with no design consequence. Three rounds have now produced a strictly decreasing defect series: 1 BLOCKING + 7 MATERIAL + 6 DETAIL → 3 DETAIL → 1 DETAIL, with every correction independently re-verifying as correct. This document has stopped yielding findings that matter under adversarial re-reading; further rounds would be polishing anchors, not testing design.

READY


## Round 4 — 2026-08-01 (delta-confined)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** delta-confined round over the three v0.4 edits, with whole-document
sweeps for stale constructor lists, decision counts, and range citations; read
own rounds 1–3 only; blind to this RFC's codex artifact and to the super-refine
journal; read-only
**Instruction capsule SHA-256:** `3a753e9f726b44dbb5da5a159d9a2774626775f898cf6201146087ca50f76d76`
**Target:** `llp/0141-embeddable-rust-library.rfc.md` (v0.4, 580 lines, Draft)
**Target SHA-256:** `e82676d014cb862541e2b97f1c43de547259cb0194affdebbad3953a964ac51a`
**Tool uses:** 11
**Status:** completed
**Verdict:** READY

## Verbatim review

## Overall assessment

**Verdict: READY**

This was the narrowest round yet — three mechanical edits — and all three landed exactly as described, verified against an unchanged tree at `5d5c6b71` (`src/runtime.rs`, `src/admin.rs`, `src/local.rs`, `src/server.rs`, `src/cli.rs` all clean against HEAD; target is 580 lines, SHA-256 `e82676d0…` matching the capsule pin). The Summary now names the same four public constructors as §Current state and D4, in the same order with the same spellings, and carries the "composed production-posture construction path" phrasing that makes the three locations tell one story. D7's heading now reads "decide three, gate the rest," and a full-document sweep of every decision-set statement — header v0.2/v0.4 entries, Summary ("only D1, D4, and D5 are proposed as decisions today… alongside the two it governs"), D7's body bullets, and the Consequences section — finds them unanimous on D1/D4/D5 with no "decide two" or two-decision residue anywhere. The `handle_host_call` citation now reads `src/runtime.rs:1273–2124`, which is line-exact: the unknown-op arm sits at `:2118–2122` and the closing braces land at `:2123–2124`, with `take_terminal_denial`'s doc comment beginning after; the string `2130` no longer appears in the document, and `:211` is the only range citation of the function.

I also pressure-tested the one place the Summary edit could have introduced a new defect: whether "Four public constructors already exist" now overclaims, given that `AppState::new` (`src/admin.rs:827`) is also `pub`. It does not. The sentence asserts the existence of four named constructors — literally true — and does not claim exhaustiveness; §Current state explicitly names `AppState::new` as public in the preceding sentence and scopes the four as "what the test suite uses." This is the same non-exhaustive-list reasoning I applied to the three-name illustrative list in round 3, and the v0.4 edit's whole purpose was to make the Summary's list agree with the settled Current-state inventory, which it now does. (I also confirmed `new_with_secret_read_operator` at `:838` is `pub(crate)`, so it correctly stays out of the public-constructor inventory.)

The v0.4 `Revised:` entry records all three edits accurately and nothing more; the nine-line growth from v0.3 (571 → 580) is fully accounted for by the eight-line ledger entry plus the Summary list expansion.

## Round-3 finding dispositions

| Round-3 finding | Disposition | Justification |
| --- | --- | --- |
| DETAIL-1 — `handle_host_call` range citation overshoots by six lines (`:1273–2130` vs actual close at `:2124`) | **RESOLVED** | Citation at the handler-bridge bullet now reads `src/runtime.rs:1273–2124`. Re-verified against the unmodified file: dispatch tail `SNAPBACK_HANDLER_HOST_CALL_UNKNOWN` at `:2119`, function closes `:2124`. No other occurrence of the old range survives anywhere in the document. |

## New findings

None. I looked specifically for the failure modes a mechanical sweep can leave behind — a second location still carrying the old constructor list (none: the only constructor enumerations are the Summary and §Current state, now identical, plus D4's consistent narrower reference), a surviving stale decision count (none, across header, Summary, D7 heading, D7 body, and Consequences), a second stale range citation (none; `2130` absent), and collateral damage to the adjacent settled text (the 21-arm/22-name/eight-namespace bullet and its `:1273`/`:1276`/`:1819` anchors are untouched and still line-exact). Nothing at any severity.

## Verification ledger

| Claim | Method | Outcome |
| --- | --- | --- |
| Target = 580 lines, SHA-256 `e82676d0…` | `shasum -a 256`, `wc -l` | Confirmed, matches capsule pin |
| Tree at `5d5c6b71`; `src/runtime.rs`, `src/admin.rs`, `src/local.rs`, `src/server.rs`, `src/cli.rs` unmodified | `git status --porcelain`, `git rev-parse` | Confirmed clean |
| Edit 1: Summary lists four constructors (`from_snapback`, `from_snapback_with_secret_read_operator`, `detached`, `LocalSnapback::open`) + "composed production-posture" phrasing | Read Summary `:63–71`, compared against §Current state `:160–170` and D4 `:393` | Confirmed; lists identical, phrasing consistent across all three sites |
| Summary's "four" does not overclaim against the tree | `grep` constructor definitions in `src/admin.rs` | Confirmed: `from_snapback` `:1392`, `from_snapback_with_secret_read_operator` `:1399`, `detached` `:1408` all `pub`; `AppState::new` `:827` also `pub` but named separately in §Current state; `new_with_secret_read_operator` `:838` is `pub(crate)`; sentence asserts existence, not exhaustiveness |
| Edit 2: D7 heading = "decide three, gate the rest"; decision set unanimous | Read `:467–481`; full-document grep for `decide`, `D1`/`D4`/`D5`, "proposed" | Confirmed: heading `:467`, body `:472–474`, Summary `:56–59`, header `:22`/`:36`/`:42`, Consequences `:485–498` all agree; no "decide two" residue |
| Edit 3: range citation = `:1273–2124`; function actually closes at `:2124` | Read `src/runtime.rs:2115–2132`; grep document for `2130`/`2124`/`1273` | Confirmed: unknown-op arm `:2118–2122`, close `:2124`; `:211` is the sole range citation; `2130` absent |
| Adjacent settled text undamaged (21 arms / 22 names / 8 namespaces, alias arm `:1819`) | Read handler-bridge bullet `:211–215` | Confirmed unchanged from v0.3-verified text |
| v0.4 Revised entry describes exactly the three edits | Read `:38–45`, compared against verified deltas; line-count delta 571→580 reconciled (8-line ledger entry + Summary expansion) | Confirmed |

Not read: `llp/reviews/0141-embeddable-rust-library.codex.md`, the super-refine journal, or any other artifact concerning LLP 0141 besides my own (blindness preserved; the target's own `Revised:` header summarizes the other family's round-3 verdict, which is the author's ledger, not the artifact). The RFC remains untracked in git, so v0.3 text was reconstructed from the claims preserved in my own round-3 artifact.

## Stopping-rule signal

Settled — and the round-3 signal still holds, now on stronger evidence rather than assumption. The defect series across four rounds is 1 BLOCKING + 7 MATERIAL + 6 DETAIL → 3 DETAIL → 1 DETAIL → 0, with every correction at every round independently re-verifying as correct against the tree. This round's three edits were purely mechanical, landed exactly, left no stale duplicate anywhere in the document, and disturbed nothing adjacent. There is no remaining finding of mine at any severity. Under the stated bar — thought through as far as possible without running code, every open item named as open (the 17 OQs stand), every as-built claim true — this Draft clears, and further review rounds would test nothing.

READY
