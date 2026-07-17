# App CLI phase-1 program (LLP 0062) — index

**Status:** Open
**Severity:** P2
**Systems:** Client integration, Tooling, API, Auth, Codegen, Docs
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 (authority for every ticket below), LLP 0012, 0024, 0031, 0043, 0055, 0058, 0061; ibex LLP 0028/0029
**Marker:** program-index, app-cli

Umbrella index for implementing LLP 0062 phase 1 (the generated per-app
CLI and code mode). LLP 0062 is at **Status: Review** (revision
`14f54843…` after the ten-round /llp-super-refine loop, 2026-07-17);
tickets cite the final-revision contracts, and the residue ticket
carries the round-10 review items that feed the amendments.
The RFC decomposes phase 1 into three sub-stages, each independently
useful (stage (a) independently releasable, version-marked
incomplete); the tickets follow that order. Implementation starts
when the author advances the RFC per LLP 0005.

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
  runtime dependency

Ticket-program authoring is complete only when every normative phase-1
deliverable and every carried review item has an explicit owning ticket,
dependency order, and executable completion evidence. A concern mentioned
only in prose here or in a review artifact is not considered tracked.

**Done when:**

- Every ticket above is closed (moved to `closed/` with resolution).
- LLP 0062 is marked Active per LLP 0005 (implementation complete and
  merged), and `./ref-check --verbose` passes with the new `@ref`
  annotations the implementation carries.
