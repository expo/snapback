# LLP 0203: Agent-native surface principles and consolidation

**Type:** RFC
**Status:** Draft
**Systems:** Agent experience, Developer experience, CLI, HTTP API, MCP,
Client integration, Auth, Deployment, Acceptance and verification, Guide,
Diagnostics, Packaging, Tooling, Governance
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-08
**Revised:** 2026-08-08 (the repo-tooling lane removed the unreferenced
`scripts/vector-search-reference.mjs`; the remaining consolidation list is
unchanged)
**Related:** LLP 0010, LLP 0019, LLP 0024, LLP 0033, LLP 0042, LLP 0055,
LLP 0061, LLP 0146, LLP 0150, LLP 0184, LLP 0186, LLP 0187, LLP 0189,
LLP 0193, LLP 0194, LLP 0195, LLP 0196, LLP 0198, LLP 0202

## Summary

LLP 0202 audited every way an agent interacts with Snapback and found the
core sound but the edges rotting in patterned ways. This RFC extracts the
pattern and proposes the corrective posture: **eight principles, each with a
mechanical enforcement**, plus a short list of things to add, a short list of
things to strip away, and the binding that makes future work answer to them.

The organizing observation: every serious defect in the audit is an instance
of one of three failure modes, and none of the three is fixed by fixing
instances.

1. **Transcription rot.** Wherever a fact about the surface is written down
   by hand in a second place — a refusal message naming a CLI verb, a
   generator's projection map, a README's template count, a version stamp —
   it drifted, sometimes within 48 hours of the authority changing. The
   admin-console program (LLP 0184) wrote completeness rules; the rules that
   got generator checks held, and the rules that stayed prose (rule 4's
   intent keywords and guide anchors) were 79% unmet at audit time with two
   fresh lies on top.
2. **Hollow affordances.** Carriers that exist but are not filled — the
   `next[]` array populated on one path repo-wide, `intents: []` on 90 of
   114 catalog rows, an exported receipt schema that validates nothing —
   are worse than absent, because consumers learn to ignore the affordance
   and the pressure to fill it disappears.
3. **Silent divergence at the seams.** Between targets (hosted answering
   unrouted app-data with `200 text/html`), between projection and
   implementation (the funnel advertising only the weakest MCP server),
   and between record and reality (tickets open and closed simultaneously,
   a guide page reviewed after the fact it contradicts). Each seam had a
   locally honest story; the aggregate was a lie no one owned.

The principles below are stated so that each is checkable. A principle
whose enforcement column is empty is a wish, and the audit demonstrates
what happens to wishes.

## Principles

Each principle: statement, the audit evidence it answers, the enforcement
that makes it stick, and the tickets that implement it. Enforcement is the
point — prose adherence is explicitly not claimed.

### P1. Generated or gated, never transcribed

Every fact that appears on more than one surface — an operation's CLI
spelling, a projection table, a template inventory, a package version, a
route's schema — is either generated from its single owning source or
covered by a CI check that compares the copies. A completeness rule that is
not a generator check does not exist.

- *Evidence:* `host.restart`'s refusal denying a shipped verb; the stale
  `CLI_PROJECTIONS` map hiding `snapback session mint`; "three templates
  ship" versus five; `0.1.0` stamps versus a `0.1.15` closure; the
  gateway-paths fixture frozen at an audited commit by its own admission.
- *Enforcement:* rule-4 gates in the catalog generator (non-empty intents,
  non-null guide anchors, title ≠ id); a test binding every refusal string
  that names a command to the catalog's `projections.cli`; the funnel test
  extended to every non-private package; gateway constants parsed from
  source rather than hand-audited; help `output:` strings bound to exported
  schema-version constants.
- *Tickets:* `20260808-control-catalog-discovery-metadata`,
  `20260808-post-0184-projection-drift`, `20260808-verify-trust-gaps` (item
  5), `20260808-hosted-gateway-spa-200-for-app-data-routes` (item 4),
  `20260808-guide-docs-hygiene-batch` (item 1).

### P2. Every failure names the next move

A refusal is a routing event, not a verdict. Every `ok: false` envelope and
every thrown diagnostic carries at least one of: the exact command to run,
the input to change, or a guide anchor that resolves. "Names the violated
rule and either the fix or a resolving anchor" (LLP 0186 W3) is the bar;
this principle adds: *the carrier is populated mechanically from the
catalog*, so coverage is a join, not a writing project.

- *Evidence:* `next[]` populated on exactly one path; admin/impersonation/
  scope/transport refusals naming the requirement but never the acquisition
  path; `controls describe <unknown>` bailing with no pointer to the search
  verb.
- *Enforcement:* a test that every failure-constructed host-ops envelope
  for a cataloged operation carries the operation's guide anchor and CLI
  spelling in `next[]`; the LLP 0146 OQ6 carrier ruling adopted once, then
  gated.
- *Tickets:* `20260808-refusals-lack-acquisition-path`,
  `20260808-native-cli-machine-mode` (item 8).

### P3. Green means evidence

No command, gate, or script may report success while having proven nothing,
and partial completion is never reported as completion. Where a legitimate
zero-evidence state exists, it gets a machine-distinct label
(`passed-without-acceptance`, `PARTIAL`), never the same green as proof.

- *Evidence:* bare `snapback verify` returning `ok: true` with zero
  profiles while the convention config sits undiscovered beside it;
  `sync-agent-skills` printing "Synced" and exiting 0 after refusing to
  link — on the one tool the hooks run automatically.
- *Enforcement:* the vacuous-pass guards that already exist in the demo
  harness and starter acceptance are the template; extend the same refusal
  to `verify`'s zero-profile path and to any script that can partially
  succeed. Add a repo convention line to LLP 0010: *a new tool that can
  succeed without evidence must justify why in review*.
- *Tickets:* `20260808-verify-trust-gaps` (item 1),
  `20260808-repo-tooling-agent-entrypoints` (items 1, 6).

### P4. Same shape on every target; absences are declared

An operation either works on a target, fails there with a structured
diagnostic, or is declared absent in a place an agent reads *before*
invoking. A route that exists locally never becomes an HTML 200 on hosted;
a discovery surface disabled by design is listed in the target's
non-claims. Aggregate absences — "no target hosts a user app end to end
today" — get an owning posture page, because a truth distributed across
four honest corners is a lie in aggregate.

- *Evidence:* the hosted SPA-200 P0; the hosted discovery blackout absent
  from the Cloudflare non-claims; the deploy posture stated nowhere; the
  local bodyless 404.
- *Enforcement:* the app-data prefix guard in the gateway; the route
  parity fixture made bidirectional and source-parsed; a posture page per
  hosting target whose stopping-point claims carry ticket links (so the
  page goes stale loudly when a ticket closes).
- *Tickets:* `20260808-hosted-gateway-spa-200-for-app-data-routes`,
  `20260808-deploy-posture-truth-page`.

### P5. The first hop funnels to the strongest surface

The first thing an agent reads in any context — the npm page, `/llms.txt`,
a scaffolded `AGENTS.md`, bare `--help`, the MCP server's `instructions` —
names the most capable applicable tool, not the most convenient one to
document. Concretely: every funnel names the control plane
(`mcp-control` / `snapback agent setup`), and no funnel's only doc link is
a loopback URL.

- *Evidence:* every funnel advertising only the read-only guide server —
  the exact gap LLP 0184 opened with, still open at audit; unlicensed
  packages with dead loopback links as their only routing; the guide MCP
  steering agents into a 1.8 MB flat projection instead of the 50 KB
  capability index.
- *Enforcement:* the funnel test asserts the control-plane block and the
  license field on every non-private package; a scaffold test asserts the
  template `AGENTS.md` names both servers.
- *Tickets:* `20260808-mcp-control-funnel-invisible`,
  `20260808-npm-license-and-package-metadata`.

### P6. Vocabulary is API surface

Agents discover by search, so intent keywords, aliases, and competitor
vocabulary (LLP 0187's routing thesis) are part of the operation's
interface, maintained with the same discipline as its schema. An operation
an agent cannot find by describing what it wants does not, for agentic
purposes, exist.

- *Evidence:* zero-row results for LLP 0184's own worked intent examples;
  "dead-letter"/"DLQ" absent from the jobs page while the feature exists;
  three bakeoff arms hand-rolling `defineRelationalQuery` because grep
  vocabulary missed.
- *Enforcement:* the rule-4 generator gate (P1) makes empty intents a build
  failure; the cold-agent retrieval evals (`guide/eval-runs/`) become the
  regression harness — each newly absorbed friction adds an eval case, on
  the LLP 0189 scheduled cadence rather than per-landing.
- *Tickets:* `20260808-control-catalog-discovery-metadata`,
  `20260808-guide-gap-diary-friction-absorption` (items 5, 7).

### P7. Machine mode is total, and there is one result grammar

`--json` is failure-safe everywhere; exit codes come from one frozen
taxonomy; every emitted JSON shape carries a `schemaVersion` and has a
committed schema. The repo already owns the right pieces — the host-ops
envelope, the app CLI's 11-code exit taxonomy, the LLP 0037 schema
discipline — so this principle is consolidation, not invention: adopt the
existing grammar everywhere, and stop minting ad-hoc shapes.

- *Evidence:* native failures as prose with exit 1; `snapback guide --json`
  silently ignored on two of three branches; `store`/`auth`/`identity`
  families emitting unversioned ad-hoc JSON; error envelope with no version
  field; verify receipts carrying raw `ENOENT`.
- *Enforcement:* a schema-inventory gate — any `println!` / `console.log`
  of a JSON object from a CLI path must round-trip a committed schema
  (extend the existing artifact-schema key-set gates); code-prefix gate
  `^SNAPBACK_[A-Z0-9_]+$` on every `diagnostic.code` sink.
- *Tickets:* `20260808-native-cli-machine-mode`,
  `20260808-http-route-schema-join-and-envelope-versioning`,
  `20260808-verify-trust-gaps` (item 2),
  `20260808-uncoded-throws-and-untyped-client-errors`.

### P8. The record is part of the product

Tickets, diaries, GAP rows, and review pins are read by agents as ground
truth and must meet the same drift bar as code. One location per ticket;
status headers that match location; GAP rows with ticket links and
staggered review dates; freshness pins that cover everything a page
asserts (including `examples:`); diary frictions absorbed or ticketed
within the landing that records them (LLP 0061 §5 restated as an exit
criterion, not an aspiration).

- *Evidence:* seven tickets open and closed simultaneously; eleven
  verified-unabsorbed diary frictions, two flagged across multiple runs;
  the 11-row GAP expiry cliff; the template-count claim invisible to the
  freshness gate because it lives in `examples:`.
- *Enforcement:* a trivial inventory check that no filename exists in both
  `issues/` and `issues/closed/`; `checkCapabilityIndex` requiring an
  issues link; `checkFreshness` extended to `examples:`; the diary
  convention amended so a "candidate guide gap" line without a ticket
  reference fails the diary's own landing check.
- *Tickets:* `20260808-guide-docs-hygiene-batch`,
  `20260808-guide-gap-diary-friction-absorption` (fixed in the 0202
  landing: the seven duplicates).

## Things to add

Beyond the per-ticket fixes, four additions change the system's shape:

1. **The diagnostics registry as a first-class generated artifact.** The
   single highest-leverage addition. ~2,418 codes make hand-written docs
   arithmetically impossible; the 847-symbol reference proves the
   generate-and-serve machinery works. Generate the code registry from
   source, serve it beside the guide, and put `snapback guide <CODE>`
   exact-lookup in front of markdown search. Everything in P2 and P6 keys
   off this substrate. (LLP 0193 remains the owner of message *quality*
   grading; its population estimate must be corrected first.)
2. **A route→schema join artifact** (`schemas/http.routes.v1.json`)
   generated from `route_registry()`, closing the gap between the LLP 0194
   symbol reference (TypeScript surface) and the wire surface. With it, the
   committed request/response schemas stop being orphans and the HTTP API
   becomes machine-enumerable end to end.
3. **A cold-agent funnel eval battery.** The four passing retrieval evals
   generalize: one eval per funnel context (npm-only, fresh scaffold,
   running server, in-repo) asserting the agent reaches the control plane,
   the capability index, and the diagnostics registry from that context's
   first hop. Scheduled per LLP 0189 (reds become fix-forward tickets), not
   a landing gate.
4. **`snapback agent setup` as the canonical onboarding verb.** One command
   that configures the harness (all major harnesses, not four), prints the
   funnel, and verifies the result. Every funnel document points at it;
   it is the thing the first hop funnels *to* (P5).

## Things to strip away

Removal is a feature. Each of these currently costs agent attention or
trains wrong behavior:

1. **Bare `snapback` starting a foreground server.** A compatibility relic
   (`crates/snapback/src/cli.rs:727-729`) that hangs pty-attached agents. Bare invocation
   prints help; serving requires `snapback start`.
2. **The flat guide projection as a recommended entry point.** At ~1.8 MB
   and growing 2.5× past its own oversize ticket, it defeats its
   one-request premise. Demote it from the MCP `instructions` and the
   funnel; keep it as an explicitly labeled bulk export or split it.
3. **Ad-hoc JSON result shapes.** The `store`/`auth backup`/`fork` family
   shapes fold into `hostOpsResult` (the migrate family already did);
   no new bespoke envelope without an LLP 0037 schema.
4. **Placeholder catalog metadata.** `title === operation`, `intents: []`,
   and unexplained `guide: null` become build failures rather than
   permanent residents (P1).
5. **Dead and orphaned artifacts.** The unreferenced
   `scripts/vector-search-reference.mjs` was removed on 2026-08-08; remaining:
   the unrouted `docs/` strays (move under `llp/` or tombstone), and duplicate
   `_meta` catalog payloads in MCP `tools/list`.
6. **The publishable-but-uninventoried package state.**
   `@expo/snapback-sidecar` and `snapback-harness` either become real
   (inventory row, README, capability row) or `private: true`. A manifest
   is a claim; unclaimed claims are stripped.

## Binding

- **New surface work binds to P1–P8 at review time.** The llp-review /
  super-refine checklists for surface-touching changes gain one question:
  *which principle's enforcement covers the new facts this change writes
  down twice?* An answer of "none" is a design smell to resolve before
  landing.
- **Execution rides the existing tickets.** This RFC adds no new tracker;
  the LLP 0202 ticket index is the work queue. The four additions above are
  the only new commitments, and each lands inside an existing ticket's
  scope except the eval battery, which needs a small commissioning ticket
  when accepted.
- **Verification follows LLP 0189.** Enforcement gates land with their
  fixes and run in the affected-scope proof; the funnel eval battery runs
  on the scheduled cadence. No gate introduced under this RFC may require a
  complete proof at an exact commit.
- **Amendments on landing.** The rule-4 enforcement decision amends LLP
  0184; the exit-taxonomy adoption amends LLP 0024; the population
  correction amends LLP 0193; the diary exit-criterion amends LLP 0061 §5.
  Each amendment lands with its implementing change, per this repo's
  docs-with-code rule.

## Open questions (author)

1. **OQ1 — Is `snapback agent setup` the canonical onboarding verb**, with
   every funnel pointing at it (P5, addition 4)? Alternative: keep funnels
   pointing at the guide and treat setup as one option among several.
2. **OQ2 — Native/packaged CLI catalog unification.** Should the packaged
   verbs get catalog rows (as ticketed) as a stepping stone toward one
   merged command inventory, or is a permanent two-registry state (Rust
   enums + `PACKAGED_CLI_COMMANDS`) acceptable with a parity gate?
3. **OQ3 — How much of P7 lands in the Rust binary now** versus riding the
   LLP 0225 core-modularization boundary (0225 superseded LLP 0199 as the
   governing ownership record on 2026-08-10)? Adopting the exit taxonomy is
   cheap; envelope-izing every native failure path may be better done
   behind the new module seams.
4. **OQ4 — Flat projection disposition** (strip item 2): demote-and-keep,
   split by area, or delete in favor of the served per-page corpus plus
   the manifest?
5. **OQ5 — Does the funnel eval battery live in `guide/eval-runs/`**
   (extending the existing convention) or as a benchmarks rung (LLP 0197
   adjacency), given it produces claim-shaped evidence?

## Non-goals

Runtime AI (AI features inside shipped apps) stays out of scope, per LLP
0019's two-agents distinction. The agent-credential creation surface stays
owned by LLP 0055/0150 and the Wave 4 identity program; this RFC only
requires (P4) that its absence stay loudly declared at the points of use.
This RFC also does not reopen ratified posture decisions — fail-closed prod
gates, mediated-operation typing, the LLP 0060 hosted operator-surface
opacity — it requires only that their consequences be visible before an
agent walks into them.
