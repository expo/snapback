# LLP 0224: Prepared standalone operation and the application-readiness receipt

**Type:** RFC
**Status:** Draft
**Systems:** Server lifecycle, Host operations, Packaged dev loop, CLI, Deployment
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
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
settlement), `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`
(B11 row), `~/clique-runs/p2-pilot/snapback-lane/scores.md` §B11 and
`~/clique-runs/p2-pilot/snapback-lane/clique/tools/scale-run.mjs` (retry
loop), `guide/capabilities.md` (operating.server-lifecycle,
operating.packaged-dev-loop rows)

## Summary

The Clique P2 pilot scored Snapback B11 (operations and maturity) at 74 —
above Convex's 52, but with two concrete lifecycle gaps recorded in the lane
evidence. First, standalone `snapback start` **refused a capability the dev
supervisor grants**, forcing the scale lane onto supervisor-managed
instances even though it wanted a plain long-lived server process. Second,
the supervisor **reports ready before sessions settle**: the ready file is
by design a host handshake published after listener bind and instance-lock
recording (LLP 0030; `schemas/host-ready.schema.json`), while `runDev`
performs `loadGenerated` *afterwards* (`packages/snapback-cli/index.mjs`,
managed-loop body), so the pilot's scale driver saw `ready === true`,
issued its first authority-bearing call, failed, and had to wrap it in a
20-attempt retry loop (`scale-run.mjs`, "The supervisor reports ready
before the sessions deployment fully settles"). The Convex lane hit the
mirror-image failure — `convex dev --once` exiting killed the backend,
because backend lifetime is coupled to the dev CLI process — which is the
trap Snapback must not reproduce under a different flag.

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
  an immutable, capability-validated release; add a native consumer,
  `snapback start --release <digest-dir>`. Real single-service lifecycle
  with no watcher and no client arm; capability admission derives from the
  same release manifests instead of a supervisor grant. Cost: the largest
  option — native startup must consume declared startup obligations
  (routes, API envelope), not just today's schema/functions carrier.
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
**not** reinterpreted: today it loads once and closes its managed server
(`runCliDev` no-watch branch), and turning that into a production-like
service would make an already ambiguous flag worse. A convenience
`snapback serve <backend-dir>` may build the local release and hand off to
the standalone path, but it is sugar over A, not a third lifecycle.

## Design detail

### Layered readiness, not one overloaded boolean

- **`HostReadyDescriptor` is unchanged and host-only**: process owns the
  database, listener bound, startup nonce/lock recorded, runtime
  prerequisites passed. Its schema, timing, and security posture
  (out-of-band file, no bearer authority) stay exactly as LLP 0030 and
  `schemas/host-ready.schema.json` specify — existing consumers keep
  working, and old `--ready-file` timing is never silently changed.
- **New `snapback.application-ready.v1` receipt**, written to
  `--application-ready-file` only when the server-owned operational
  predicate is true: the exact requested release/generation is active;
  required capabilities were admitted; schema/functions/routes are active;
  auth has `requested == active` with `modeState == settled`; sessions
  mode has a positive `sessionActivationReady`. LLP 0058 already forces
  sessions activation, coordinators, and workers before listener bind;
  this receipt additionally covers the later package-level provisioning
  (`loadGenerated`) that produced the pilot race.
- The receipt binds `startupNonce`, the host-descriptor digest,
  release/deployment identity, target profile, artifact hashes, auth
  state, capability-manifest digest, active network-profile name, and
  `settledAtMs`. It carries no bearer or sidecar authority. Readiness
  evaluation uses the undelayed control plane and merely *records* the
  active network profile (LLP 0167: profiles perturb observation, never
  state or settlement).
- **`snapback wait --ready-file <host> --level host|application`**
  validates the receipt(s) plus the live nonce, so application scripts and
  harnesses stop writing bespoke retry loops.
- This is **one-time launch settlement, not continuous health**. The
  predicate gates launch obligations only — active generation, capability
  admission, auth/sessions settlement, explicitly requested initialization
  — never cron idleness, connected clients, or empty background queues
  (LLP 0123: presence and identity are not behavioral readiness; LLP 0103:
  lifecycle completion is a state transition with component results). A
  receipt goes stale after a dev reload; it is digest-bound, and later
  health flows through the dev event stream.

### Prepared-release capability story

Standalone capability admission reuses `buildRelease`'s existing
required-vs-supported validation (`SNAPBACK_DEPLOY_CAPABILITY_MISMATCH`
against the target-profile capability manifest) — no supervisor-only grant
path is invented, and no blanket "dev alignment" authority appears in
standalone mode. A closed, versioned `snapback.start-plan.v1` references
the immutable release and names its startup obligations; older binaries
refuse an unknown plan version with a structured diagnostic rather than
partially decoding it. The closed `StartupArtifacts` v1 stays untouched —
LLP 0109 deferred V2, and routes/seed data must not be smuggled into v1 as
unknown fields. LLP 0010 runtime qualification and the
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
  `runDev` publishes `snapback.application-ready.v1` after its existing
  `loadGenerated` succeeds; add `snapback wait --level host|application`;
  export `schemas/application-ready.schema.json` via `src/schema_export.rs`;
  surface the same fact as `OperationalReadinessV1` in
  `app.inspect`/host-ops results (`src/host_ops.rs`) so CLI/HTTP/future
  MCP projections share one core fact (LLP 0024). **Proof:** process tests
  for no-early-receipt (receipt absent between host-ready and settlement),
  stale nonce, and settled restart; the Clique scale launcher and the
  generated acceptance harness converted to `wait --level application`
  with their retry loops deleted.
- **Phase 2 — prepared standalone start (Option A core).** Reproduce and
  classify the pilot's standalone capability refusal; add
  `snapback.start-plan.v1` and native `start --release` +
  `--application-ready-file` in `src/cli.rs`, consuming and revalidating
  the release capability manifest; factor release/start-plan construction
  out of `runDev`. **Proof:** fresh-session, hard-kill/restart-over-
  existing-database, unsupported-capability refusal, and explicit
  successor-activation process tests against a `deploy build` release;
  the scale lane rerun standalone with zero retries.
- **Phase 3 — convenience and surface truth.** `snapback serve` (build +
  hand off), typed exports in `index.d.mts`, guide updates
  (authoring-loop, host-ops, acceptance pages), capability rows moved off
  their B11 caveats, and amendments to LLPs 0030/0041/0024 plus a narrow
  0058 amendment binding the operational predicate to its existing
  settlement facts. **Proof:** `node scripts/check-guide.mjs` green over
  the updated rows; ref-check clean.

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
   redefine LLP 0109 migration policy.
3. Release-build latency for local scale runs: is a cached
   content-addressed build enough, or does the standalone path need an
   incremental fast lane before harnesses adopt it as their default?
4. If real standalone usage turns out to demand hot reload or automatic
   successor repair, the wanted product is a deployment supervisor, not a
   standalone server — that outcome would reopen Option B as an explicit,
   separately named profile rather than a reinterpretation of `dev`.
