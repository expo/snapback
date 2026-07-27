# App CLI phase-1 program (LLP 0062) — index

**Status:** Closed
**Resolution:** Closed by c5d67b0a: the explicitly rescoped phase-1 client/app-CLI checkpoint and acceptance journey shipped; advanced work remains in its dedicated tickets.
**Severity:** P2
**Systems:** Client integration, Tooling, API, Auth, Codegen, Docs
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 (authority for every ticket below), LLP 0012, 0024, 0031, 0043, 0055, 0058, 0061; ibex LLP 0028/0029
**Marker:** program-index, app-cli

Umbrella index for the original LLP 0062 generated per-app CLI and code-mode
program. On 2026-07-19 this index was explicitly **rescoped**: the shipped
phase-1 checkpoint is the versioned `@snapback/client` package, the
artifact-as-data `@snapback/app-cli` package, guide coverage, and the executable
discover → pair → scoped principal → mutate → subscribe → verify acceptance
journey. That checkpoint is independently useful and closes the agent-facing
surface outcome without pretending the reviewed RFC's larger wire, custody,
and sandbox design has landed.

Everything listed below that is not part of that checkpoint is deferred to an
advanced phase. The ticket files remain the design/dependency index for that
future work; they are not open blockers for the checkpoint and do not imply a
shipped command. LLP 0062 remains **Review**, with an implementation-checkpoint
note that records this narrower boundary.

Contract prerequisites — land before sub-stage (a) freezes a public
result or artifact contract:

- `20260717-app-cli-review-residue.md` — disposition every round-10
  major/minor into an owning amendment or frozen deliverable
- `20260717-app-cli-shared-result-core.md` — the document half of the
  LLP 0024 shared-core amendment (server parity implementation follows
  in sub-stage (b))
- `20260717-app-cli-mutation-settlement.md` — the LLP 0043 durable
  acknowledgement/state-machine contract that the frozen per-kind
  mapping depends on (server/client implementation follows in (b))

Sub-stage (a) — dev targets, no server changes:

- `20260717-app-cli-client-core-package.md` — lift the app-data client
  core out of `demos/_kit/`
- `20260717-app-cli-envelope-codegen.md` — envelope + app-owned binding
  declarations; engine ambient declarations remain a separate product
- `20260717-app-cli-engine-dev-subcommands.md` — engine package;
  `call`/`introspect`/`types`/`--help` against local artifacts
- `20260717-app-cli-subscribe-semantics.md` — durable live queries
- `20260717-app-cli-principal-selection.md` — anonymous default,
  `--principal`, dev identity

Sub-stage (b) — served envelope, sessions/agent, amendments:

- `20260717-app-cli-envelope-serving-ingestion.md` — `/app-api` routes,
  LLP 0012 + LLP 0031 amendments
- `20260717-app-cli-generation-binding.md` — call-time envelope-identity
  check
- `20260717-app-cli-shared-result-core.md` — server parity half of the
  prerequisite LLP 0024 amendment; Rust-owned semantic core + engine
  wrapper across CLI/HTTP/MCP
- `20260717-app-cli-mutation-settlement.md` — implement the prerequisite
  LLP 0043 acknowledgement lifecycle, replay, and recovery contract
- `20260717-app-cli-attribution-seams.md` — finite non-2xx + live
  attribution
- `20260717-app-cli-session-custody-store.md` — Node session custody;
  `login`/`logout`/`whoami`
- `20260717-app-cli-agent-onboarding.md` — credential profile, `pair`,
  fence bootstrap; LLP 0055 amendment items

Sub-stage (c) — code mode:

- `20260717-app-cli-code-mode-host.md` — broker protocol, script host,
  lifecycle, ceilings
- `20260717-app-cli-audit-lane.md` — value-free leak-resistant stderr
  lane

Cross-cutting:

- `20260717-app-cli-acceptance-fixture.md` — fixture app, goldens,
  parity, non-transmission suite
- `20260717-app-cli-guide-obligations.md` — capability GAP row, guide
  page, route-map rows
- `20260717-app-cli-review-residue.md` — fold the super-refine
  residue into the doc/amendments and frozen deliverables
- `20260717-app-cli-ibex-contract-corrections.md` — file and track the
  required ibex LLP 0028/0029 corrections without making them a phase-1
  runtime dependency (filed 2026-07-23: ENG-25410, ENG-25411; ticket
  resolved, landing deferred)

The advanced-program decomposition remains complete only when every normative
deliverable and carried review item has an explicit owning ticket, dependency
order, and executable completion evidence. A concern mentioned only in prose
here or in a review artifact is not considered tracked.

**Checkpoint done when (satisfied 2026-07-19):**

- `@snapback/client` is the versioned source of the framework-neutral client;
  demo-kit imports remain compatibility re-exports.
- `@snapback/app-cli` discovers inert local artifacts and exports pairing,
  scoped invocation, and live-subscription operations.
- An executable acceptance test proves discover → pair → fenced scoped
  principal → mutate → subscribe → verify and proves bearer non-return.
- `clients.app-cli` and `auth.agent-principals` have guide pages and capability
  witnesses; the CLI page names the deferred boundary.
- The package inventory, guide checker, and `./ref-check --verbose` pass.

**Advanced phase done when:** every deferred ticket is resolved, the required
LLP amendments land, and the author advances LLP 0062 to Active under LLP 0005.
