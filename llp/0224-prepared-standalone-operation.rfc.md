# LLP 0224: Prepared standalone operation and the application-readiness receipt

**Type:** RFC
**Status:** Accepted
**Systems:** Server lifecycle, Host operations, Packaged dev loop, CLI, Deployment
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-21 (LLP 0223 D0.1/W1 follow-through: the closed
`snapback.application-ready.v1` receipt now also binds the lifecycle-issued
AppBinding, exact client origins, and qualified native binary versus CLI
wrapper identity; HostReady remains host-only and Expo/Vite surfaces are
projections, not competing authorities; the same-v1 closed extension is an
explicit fail-closed tool-upgrade boundary rather than additive compatibility)
**Revised:** 2026-08-10 (Phase 1 landed; dated OQ5 and OQ2 resolutions
recorded, author-confirmed in-session — native-binary `wait`; receipt
gating variant (a). Projection tier author-reviewed: conservative
authenticated fail-closed posture retained for Phase 1, revisit after
harness experience. See §Dated amendment: Phase 1 landing and OQ
resolutions)
**Revised:** 2026-08-10 (Review → Accepted — accepted to begin Phase 1 implementation only (author direction in-session, 2026-08-10); verdicts bind revision (c), the (d) tail is unreviewed and disclosed; the projection-tier OQ and OQ2/OQ5 remain open author questions — Phase 1 builds the conservative authenticated fail-closed posture)
**Revised:** 2026-08-10 (d — UNREVIEWED delta-convergence revision: both
round-2 reviews found pre-existing text clean with in-delta-only
MATERIALs; this revision fixes them — readiness evaluated against a
closed expected activation target; supported-capability authority is the
executing runtime's target-profile registry; start plan constructed
deterministically inside native `start` from the verified release;
standalone successor activation stays behind LLP 0058's explicit
`--activate-startup-successor` opt-in with the narrow scope amendment in
Phase 2; 0058 predicate-binding amendment moved to Phase 1. Post-dates
the round-2 reviews in
`llp/reviews/0224-prepared-standalone-operation.rfc.{gpt-5,claude}.md`)
**Revised:** 2026-08-10 (c — round-1 super-refine: activation-eligibility
honesty + start-plan qualification step; v1-carrier-from-release story;
receipt authority unified on server-owned `OperationalReadinessV1` with
lifecycle and `wait` cross-check; LLP 0058 invariant corrected; pilot
labeled calibration-only. Per GPT-5.6-sol M1–M5 and Claude M1–M3,
`llp/reviews/0224-prepared-standalone-operation.rfc.{gpt-5,claude}.md`)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; sub-orchestrated loop)
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Related:** LLP 0030 (managed dev — ready-file handshake this layers on),
LLP 0041 (packaged developer loop — `runDev` owner), LLP 0024 (agent
operating surface — "one core, thin projections"), LLP 0058 (sessions
settlement facts the operational predicate binds), LLP 0010 (bootstrap
diagnostic codes and runtime-readiness receipts), LLP 0109 (closed
`StartupArtifacts` v1; V2 deferred), LLP 0123 (readiness ≠ presence),
LLP 0103 (hosted lifecycle state machine precedent), LLP 0114 (React
façade boundary), LLP 0167 (network profiles perturb observation, never
settlement), LLP 0189 (landing/verification cadence the phases follow),
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`
(B11 row), `~/clique-runs/p2-pilot/snapback-lane/scores.md` §B11 and
`~/clique-runs/p2-pilot/snapback-lane/clique/tools/scale-run.mjs` (retry
loop), `~/clique-runs/p2-pilot/convex-lane/scores.md` §B11 (`--once`
lifetime coupling), `guide/capabilities.md` (operating.server-lifecycle,
operating.packaged-dev-loop rows)

## Summary

The Clique P2 pilot (calibration evidence only, not claim-eligible — the
run record's own label) scored Snapback B11 (operations and maturity) at
74, above Convex's 52 and just under Supabase's 75, with two concrete
lifecycle gaps recorded in the lane evidence. First, standalone
`snapback start` **refused a capability the dev supervisor grants**,
forcing the scale lane onto supervisor-managed instances even though it
wanted a plain long-lived server process. Second, the supervisor **reports
ready before the application deployment finishes provisioning**: the ready
file is by design a host handshake published after listener bind and
instance-lock recording (LLP 0030; `schemas/host-ready.schema.json`),
while `runDev` performs `loadGenerated` *afterwards*
(`packages/snapback-cli/index.mjs`, managed-loop body), so the pilot's
scale driver saw `ready === true`, issued its first authority-bearing
call, failed, and had to wrap it in a 20-attempt retry loop
(`scale-run.mjs`; the driver's comment blames "the sessions deployment",
but LLP 0058 forces sessions activation before listener bind and the loop
swallowed the failed response — the demonstrated gap is post-bind
package-level provisioning settlement, not necessarily auth). The Convex
lane hit the mirror-image failure — `convex dev --once` exiting killed
the backend, lifetime coupled to the dev CLI process
(`convex-lane/scores.md` §B11) — the trap Snapback must not reproduce
under a different flag.

The capability index already tells this story structurally:
`operating.server-lifecycle` is shipped and `operating.packaged-dev-loop`
is partial, but nothing sanctions launching and *trusting* an application
instance without the dev supervisor. This RFC defines that story: a
**prepared standalone mode** (source → verified, content-addressed release
→ native start) as the destination, with an **application-readiness
receipt** — ready semantics that include session settlement — as the first
landing, delivered on the existing supervisor path where it immediately
kills the pilot's retry-loop race.

## Options considered

From the design consultation, compressed:

- **A. Prepared standalone mode.** `snapback deploy build` already produces
  an immutable, content-addressed, integrity-verified release closure; add
  a native consumer, `snapback start --release <digest-dir>`. Real
  single-service lifecycle with no watcher and no client arm; capability
  admission derives from the same release manifests instead of a
  supervisor grant. Cost: the largest option — today's release is *not
  yet activation-eligible* (`ReleaseVerification.activationEligible` is
  fixed `false`), so native startup must consume declared startup
  obligations (routes, API envelope, requested initialization), not just
  today's schema/functions carrier.
- **B. Headless dev-supervisor profile** (`snapback dev --headless
  --stay-alive`, publish readiness after `generated-and-loaded`). Smallest
  change; most code exists. **Rejected as the story**: it leaves the exact
  B11 complaint intact — the backend still cannot exist without the dev
  CLI — and reproduces Convex's backend-lifetime coupling, the failure the
  pilot's own Convex lane documented (`--once` silently killing the
  deployment). Restart policy, dev error exposure, and successor automation
  would all remain welded to a development tool.
- **C. Source-aware native `start`** (Rust discovers sources and runs
  codegen). One obvious command, but it duplicates or embeds the packaged
  JS build system inside the native runtime, violating LLP 0024's "one
  core, thin projections" rule and making native startup depend on
  source-tooling availability. Rejected.
- **D. Readiness-only patch** (a settled receipt / `snapback wait --level
  application`). Fast, compatible, directly eliminates the retry loop —
  but by itself provides no sanctioned non-supervisor lifecycle. Correct
  as the first slice, not as the answer.

## Decision

**Destination: Option A. First landing: Option D on the existing
supervisor path.** The canonical non-supervisor flow becomes:

```text
source → verified/content-addressed application release → native start
```

```sh
snapback deploy build snapback --target-profile local-dev-sqlite-ibex
snapback start --release .snapback/releases/<digest> \
  --db .snapback/app.sqlite3 \
  --ready-file .snapback/host-ready.json \
  --application-ready-file .snapback/app-ready.json
```

`snapback dev` remains the authoring/watch supervisor. `dev --no-watch` is
**not** reinterpreted: its declared lifecycle is "long-running unless
--no-watch", exiting 0 on a successful one-shot load (command registry,
`packages/snapback-cli/index.mjs`), and turning that into a
production-like service would make an already ambiguous flag worse. A convenience
`snapback serve <backend-dir>` may build the local release and hand off to
the standalone path, but it is sugar over A, not a third lifecycle.

## Design detail

### Layered readiness, not one overloaded boolean

- **`HostReadyDescriptor` is unchanged and host-only**: process owns the
  database, listener bound, startup nonce/lock recorded, runtime
  prerequisites passed. Its schema, timing, and security posture stay
  exactly as LLP 0030 and `schemas/host-ready.schema.json` specify — an
  out-of-band, owner-only trusted file, no bearer bytes though it may
  locate authority sidecars. Existing consumers keep working; old
  `--ready-file` timing is never silently changed.
- **One authority: the server-owned `OperationalReadinessV1` fact**,
  surfaced through `app.inspect`/host-ops (the authenticated tier;
  `wait` reuses the ready-file-located admin handoff it already has and
  fails closed — the fact is not added to the public surface). The
  server core evaluates the operational predicate **against a closed
  expected activation target** — release/generation identity plus the
  complete declared-obligation digest, supplied by the launcher
  (`runDev` in Phase 1, native `start` in Phase 2) — so it can
  distinguish an undeclared obligation from an omitted one; the result
  states readiness for that exact target and names unsatisfied
  obligations. The predicate: the target release/generation is active;
  required capabilities were admitted; declared schema/functions/routes
  obligations are active; auth is settled per LLP 0058's invariant
  (`active == desired`, `requestedDeployment == null`, `modeState ==
  settled`, availability `available`), sessions mode additionally
  requiring a positive `sessionActivationReady`. LLP 0058 already forces
  sessions activation, coordinators, and workers before listener bind;
  this fact additionally covers the later package-level provisioning
  (`loadGenerated`) that produced the pilot race.
- **The `snapback.application-ready.v1` receipt is a projection of that
  fact**, never an independent derivation. In Phase 1, `runDev` triggers
  provisioning, reads `OperationalReadinessV1` from the server, and
  atomically publishes the file bound to the returned nonce and digests —
  never manufacturing readiness from its own promise completions. In
  Phase 2 the native start writes the same format from the same
  evaluator. Publication follows the LLP 0030 ready-file discipline: the
  Phase-1 JS publisher replicates atomic rename and owner-only mode; the
  full server-side discipline (pinned parent, alias/inode checks)
  applies when the server publishes it natively in Phase 2.
- **Receipt lifecycle:** every launch, watch reload, restart, and
  dev-fresh reset removes the application-ready file *before* work
  begins, republishing only on settlement — absence is the honest
  intermediate state, even within a single process whose `startupNonce`
  has not changed.
- The receipt binds `startupNonce`, the host-descriptor digest, the
  mode-discriminated application identity (generated-deployment identity
  in dev; release/start-plan identity in standalone), target profile,
  artifact hashes, auth state, capability-manifest digest, active
  network-profile name, and `settledAtMs`. It carries no bearer or sidecar authority. Readiness
  evaluation uses the undelayed control plane and merely *records* the
  active network profile (LLP 0167: profiles perturb observation, never
  state or settlement).
- **`snapback wait --ready-file <host> --level host|application`**
  locates the receipt at a deterministic sibling of the host ready file
  unless `--application-ready-file` overrides it, validates the host
  descriptor plus live nonce, and at application level requires the live
  `OperationalReadinessV1` evaluation to be positive for the receipt's
  bound target — digest comparison alone detects neither a same-process
  reload in progress nor a predicate that has since gone false. Scripts
  and harnesses stop writing bespoke retry loops.
- This is **one-time launch settlement, not continuous health**. The
  predicate gates launch obligations only — active generation, capability
  admission, auth/sessions settlement, explicitly requested initialization
  — never cron idleness, connected clients, or empty background queues
  (LLP 0123: presence and identity are not behavioral readiness; LLP 0103:
  lifecycle completion is a state transition with component results).
  Later health flows through `/health` and inspection — the dev event
  stream is the supervisor-specific projection — never the receipt.

### Prepared-release capability story

Today's release is an integrity-verified, content-addressed closure that
is explicitly *not* activation-qualified, and its required-vs-supported
validation (`SNAPBACK_DEPLOY_CAPABILITY_MISMATCH` against the
target-profile capability manifest) derives requirements from schema and
functions only. **Start-plan preparation is the explicit qualification
step**: it resolves the release's applicable blocking gaps and derives
required capabilities from *every* declared startup obligation — routes,
API envelope, requested initialization. The **support authority is the
executing runtime's server-owned target-profile registry**, not the
release's self-assertion: the release declares its requirements and
intended target profile, and native `start` compares them against its
own supported set, recording the admission decision in
`OperationalReadinessV1`; no supervisor-only grant path and no blanket
"dev alignment" authority appear in standalone mode. The closed,
versioned `snapback.start-plan.v1` is **constructed deterministically
inside native `start` from the verified release** — no third artifact,
preserving the two-command flow — with its digest bound into readiness;
"unknown plan version" means the release declares an obligation-schema
version newer than the binary understands. Native `start` refuses that,
a release integrity failure, an unknown target profile, an unresolved
activation gap, or an unsupported obligation, each with a structured
diagnostic rather than partial decoding. **Successor activation stays
fail-closed per LLP 0058**: `start --release` never implies activation
authority — it refuses a differing settled sessions deployment unless
the explicit `--activate-startup-successor` operator opt-in is supplied;
extending that flag's scope from managed-dev-only to prepared standalone
is a named narrow LLP 0058 amendment in Phase 2.

The carrier story keeps LLP 0058's semantics fail-closed and LLP 0109
untouched: native `start --release` derives the unchanged
`StartupArtifacts` v1 pair from the release's schema/functions manifests
— a byte-deterministic derivation, so one release yields one carrier
identity across starts — satisfying LLP 0058's every-settled-start
`--startup-artifacts` requirement; routes and API
envelope (and any requested seed, pending OQ2) are *post-bind*
obligations executed from the release through the same host-ops core
`loadGenerated` uses, before the receipt publishes — never pre-bind,
never smuggled into v1 as unknown fields. LLP 0109 §3.1.1 specifies a
`StartupArtifactsV2` carrier; its implementation remains deferred and
this RFC does not reopen it. LLP 0010 runtime qualification and the
`SNAPBACK_IBEX_RUNTIME_*` receipt discipline remain prerequisites exactly
as for every served binary; application-settlement failures get their own
`SNAPBACK_*` operational codes instead of being mislabeled as bootstrap
failures. Caveat recorded honestly: the pilot retained neither the exact
standalone refusal code nor the first failed authority response (the retry
loop swallowed both), so Phase 2 begins by reproducing the refusal; if the
refused capability was deliberately dev-only or security-sensitive,
standalone requires an explicit operator profile rather than a blanket
grant.

## Phases

- **Phase 1 — application-readiness receipt (Option D, immediate).**
  Add `OperationalReadinessV1` to `app.inspect`/host-ops results
  (`crates/snapback/src/host_ops.rs`) as the one core fact (LLP 0024); after its existing
  `loadGenerated` succeeds, `runDev` reads that fact and projects it as
  `snapback.application-ready.v1` (removal-before-work per the lifecycle
  above); add `snapback wait --level host|application`; export
  `schemas/application-ready.schema.json` and the core fact's schema via
  `crates/snapback/src/schema_export.rs`. Narrow amendments to LLPs 0030 (receipt file
  alongside the ready file), 0024 (new core fact), and 0058 (binding the
  operational predicate to its existing settlement facts) land with this
  phase, since it changes their surfaces. **Proof:** process tests for no-early-receipt (receipt absent
  between host-ready and settlement), stale nonce, settled restart,
  stale-after-reload within one process, and supervisor reattach over an
  existing server; the generated acceptance harness converted to
  `wait --level application` with its retry loop deleted; the Clique
  scale launcher converted the same way as a demonstration rerun (an
  external artifact, not a repo-gated check).
- **Phase 2 — prepared standalone start (Option A core).** Reproduce and
  classify the pilot's standalone capability refusal; add
  `snapback.start-plan.v1` and native `start --release` +
  `--application-ready-file` in `crates/snapback/src/cli.rs`, consuming and revalidating
  the release capability manifest; extract shared startup-obligation
  planning/evaluation so dev and standalone consume one implementation,
  without routing dev through release construction or changing
  `StartupArtifacts` v1; land the named narrow LLP 0058 amendment
  extending `--activate-startup-successor` scope to prepared standalone.
  **Proof:** fresh-session, hard-kill/restart-over-existing-database,
  unsupported-capability refusal, release-tamper refusal,
  unknown-plan-version refusal, non-function-obligation admission,
  differing-successor refusal without the explicit flag, and explicit
  successor-activation process tests against a `deploy build` release;
  the scale lane rerun standalone with zero retries.
- **Phase 3 — convenience and surface truth.** `snapback serve` (build +
  hand off), typed exports in `index.d.mts`, guide updates
  (authoring-loop, host-ops, acceptance pages), capability rows updated
  to sanction the standalone lifecycle, and the LLP 0041 amendment (the
  0058 amendments having landed with Phases 1 and 2). **Proof:**
  `node scripts/check-guide.mjs` green over the updated rows; ref-check
  clean.

Per LLP 0189, each phase lands promptly after review and verifies against
the landed commit; no phase gates on a quiet `main`.

## Open questions

1. What exactly did standalone `start` refuse in the pilot? The lane
   evidence records the refusal but not the code. Phase 2's first task is
   the reproduction; the answer decides grant-by-release-manifest vs an
   explicit operator profile.
2. Do complete start plans surface hard post-bind obligations (versioned
   seed installation, migrations)? If so, are they readiness-gating
   obligations or separate operator steps? Readiness must not quietly
   redefine LLP 0109 migration policy. *Resolved 2026-08-10 — variant
   (a); see §Dated amendment: Phase 1 landing and OQ resolutions.*
3. Release-build latency for local scale runs: is a cached
   content-addressed build enough, or does the standalone path need an
   incremental fast lane before harnesses adopt it as their default?
4. If real standalone usage turns out to demand hot reload or automatic
   successor repair, the wanted product is a deployment supervisor, not a
   standalone server — that outcome would reopen Option B as an explicit,
   separately named profile rather than a reinterpretation of `dev`.
5. Where does `snapback wait` live — the native binary (standalone
   environments have no JS toolchain; it is a thin read/validate over
   server-owned facts), the package CLI, or native with package
   delegation? Phase 1 needs the answer before landing the command.
   *Resolved 2026-08-10 — the native binary; see §Dated amendment:
   Phase 1 landing and OQ resolutions.*

## Dated amendment: Phase 1 landing and OQ resolutions (2026-08-10)

**OQ5 resolution (author-confirmed 2026-08-10, in-session).** `snapback
wait` lives in the **native binary**. Both super-refine review families
independently recommended native — standalone environments have no JS
toolchain, and the command is a thin read/validate over server-owned
facts — and the author approved adopting the convergent recommendation.
Implemented as the CLI-only operation `host.wait` in `crates/snapback/src/cli.rs`; the
package CLI reaches it through its existing native-delegation
fallthrough, with no package delegation layer.

**OQ2 resolution (author-confirmed 2026-08-10, in-session): variant
(a).** A *declared idempotent seed* gates the receipt: a seed obligation
in the expected activation target must declare `idempotent: true`
(`SNAPBACK_APP_READINESS_SEED_NOT_IDEMPOTENT` refuses otherwise), and
readiness requires the installed versioned-seed identity to match the
declared `seedVersion`/`seedDigest`. A target declaring an *unresolved
migration requirement* is refused at declaration time
(`SNAPBACK_APP_READINESS_MIGRATION_UNRESOLVED`) rather than surfacing as
a not-ready state: readiness never quietly redefines LLP 0109 migration
policy — the migration must be resolved through its own operator flow
before the target may be declared.

**Projection tier (author-reviewed 2026-08-10).** The conservative
authenticated fail-closed posture is **retained** for Phase 1 — the fact
stays on `app.inspect`/host-ops' admin tier and `wait` uses the
ready-file-located admin handoff, failing closed without it. Revisit
after harness experience.

### Dated amendment: D0.1 lifecycle identity extension (2026-08-21)

LLP 0223's D0.1 ruling extends the Phase-1 application receipt rather than
minting another ready file. `ApplicationReadyReceiptV1` now requires three
additional closed facts:

- `binding`: the bearer-free `snapback.app-binding.v1` issued by the
  lifecycle owner for the exact generated application and admitted origin;
- `clientOrigins`: the normalized exact origin set actually admitted by the
  running Rust server — declared origins union ambient
  `SNAPBACK_DEV_AUTH_ORIGINS` union provider-owned aliases such as Expo's three
  Metro loopback spellings; and
- `runtimeIdentity`: the digest-bound, handler-VM-qualified native binary
  identity and the package/version identity of the CLI wrapper that launched
  it.

Attach still validates `HostReadyDescriptor` and its live startup nonce first.
It then admits the listener only when the owner-only application receipt binds
that descriptor digest, nonce, application deployment/obligation digest,
settled auth facts, active artifacts, target profile, capability-manifest
digest, server-consumed origin set, binding identity/origin, qualified binary,
and wrapper. The comparison is against a fresh live `OperationalReadinessV1`
before receipt removal or any listener mutation. A missing/stale receipt or
wrong fixed binding is a typed refusal and never authorizes adoption, cleanup,
or termination of the listener. An expired binding on an otherwise identical
live cut requests binding/receipt reissue; expiry alone does not make the child
foreign. Receipt removal-before-work and atomic owner-only publication remain
unchanged. `.snapback/expo-supervisor.json`, the Expo `connectCarrier` fact,
and Vite's same-origin virtual binding are projections of these receipt facts;
they do not become attach authorities.

**Compatibility ruling.** This amendment deliberately extends the existing
closed `snapback.application-ready.v1` carrier with must-understand fields
instead of claiming additive compatibility. Pre-amendment readers reject the
new receipt, and amended readers reject the old receipt. That fail-closed
same-v1 boundary is accepted for the current no-stability-dependents phase: a
live development owner must be restarted/reissued as part of the coordinated
CLI/runtime upgrade. A future independently deployable reader/writer boundary
must mint a new format version or negotiate it rather than repeating this move.

**Phase 1 checkpoint (2026-08-10).** Landed: the Rust-owned carriers
`ExpectedActivationTargetV1` / `OperationalReadinessV1` /
`ApplicationReadyReceiptV1` (`crates/snapback/src/operational_readiness.rs`; committed
schemas
`schemas/{expected-activation-target,operational-readiness,application-ready}.schema.json`);
the served authenticated op `app.readiness.v1` (declare-and-evaluate
under `input`, read-only without) with the `app.inspect`
`data.operationalReadiness` splice; process-local declared-target
authority on `AppState` (fresh processes start undeclared and fail
closed); `snapback wait --ready-file <p> --level host|application` with
the deterministic `<ready-file>.application-ready` sibling and
`--application-ready-file` override; the `runDev` projection with
removal-before-work at spawn/reload/restart/dev-fresh/close and
publication only from the returned fact; and the five scaffolded
acceptance harnesses converted to `wait --level application` with their
readiness retry loops deleted and first-query success asserted
un-retried. Narrow companion amendments landed in LLPs 0030 (receipt
sibling), 0024 (core fact + operations), and 0058 (predicate binding).
The Clique scale-launcher rerun remains an external demonstration
artifact, not a repo-gated check (LLP 0189).
