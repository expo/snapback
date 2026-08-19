# LLP 0202: Agentic surface audit, 2026-08-08

**Type:** Research
**Status:** Active
**Systems:** Agent experience, Developer experience, CLI, HTTP API, MCP,
Client integration, Auth, Deployment, Acceptance and verification, Guide,
Diagnostics, Packaging, Tooling
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-08
**Revised:** 2026-08-08 (LLP 0203 extracts the prescriptive posture — the
principles, additions, removals, and enforcement program — from these
findings; this document stays the descriptive audit record)
**Related:** LLP 0010, LLP 0019, LLP 0024, LLP 0033, LLP 0042, LLP 0055,
LLP 0061, LLP 0146, LLP 0150, LLP 0184, LLP 0187, LLP 0189, LLP 0193,
LLP 0194, LLP 0195, LLP 0196, LLP 0203

## Summary

A cross-surface audit of every way an agent interacts with Snapback, run as
the generalization of the admin-console program (LLP 0184) to the whole
surface. Nine parallel read-only auditors covered the CLI (all three
binaries), the HTTP API, both MCP servers, the client SDK arms, the guide and
docs surface, the repo development tooling, the auth/provisioning path,
deploy + verify, and a cross-cutting sweep of open tickets and recent diaries
for friction that never got absorbed. All findings are static-analysis,
evidence-pinned to `file:line`, and were checked against open `issues/` so
already-tracked items are marked. Roughly 107 findings; four rate P0.

**Verdict.** The core is genuinely agent-first: the host-ops envelope, the
typed route registry, the drift-gated diagnostic-status table, the
content-addressed `/app-api` discovery pair, and the fully non-interactive
tooling all hold under adversarial reading. The failures cluster at the edges
and seams:

1. **Discovery metadata that exists but was never filled in.** The control
   catalog's `intents`/`guide` columns are structurally present and CI-gated
   for parity, but hollow — so the intent-search ritual LLP 0184 prescribes
   returns zero rows for its own worked examples.
2. **Post-landing drift against LLP 0184's own parity rules.** Within days of
   the program completing, two projections started lying (a refusal that
   denies a shipped CLI verb exists; a catalog row that hides a shipped CLI
   projection) because the rules that would catch them are audited by hand,
   not enforced by the generator.
3. **The out-of-checkout surface.** Unlicensed npm packages with loopback-only
   doc links, the two most-installed packages excluded from the README-funnel
   gate, a Swift arm that cannot be consumed outside the repo.
4. **Errors-as-docs at real scale.** The measured `SNAPBACK_*` population is
   ~2,418 distinct codes in production sources with ~12% documented — 5–10×
   the sizing LLP 0193's Phase 1 assumed, which materially changes that
   plan's fan-out.
5. **The hosted arm.** The Cloudflare gateway answers unrouted app-data
   routes with the SPA's `index.html` and HTTP 200, and no page states the
   aggregate truth that no target offers an end-to-end deploy of a user's own
   app today.

This document is a dated audit record: it records findings and routes them to
tickets; it proposes no designs. Design-bearing corrections (the catalog
rule-4 generator gate, the LLP 0193 sizing correction) belong as dated
amendments to their owning documents, landed with the fixes per LLP 0189.

## Method

Each auditor received the same criteria, distilled from LLP 0184 (the
cross-surface completeness contract), LLP 0019 (the original readiness
survey), LLP 0146 (authoring affordances), and LLP 0187 (routing over
coverage):

- **Discoverable** — reachable from standard entry points (`--help`,
  `guide/index.md`, `/llms.txt`, MCP listings, package READMEs); no
  human-only path where the docs claim otherwise.
- **Non-interactively operable** — no TTY requirements; every prompt has a
  flag/env twin; long-running work has structured readiness and stop
  semantics.
- **Structured results** — versioned machine-readable envelopes with
  committed schemas; stable `SNAPBACK_*` codes; meaningful exit codes;
  failures carry a next step.
- **Parity** — the same operation projected consistently across CLI, HTTP,
  and MCP; inventories mechanically bound to implementations.
- **Errors as docs** — a refusal names the violated rule and either the fix
  or a resolving guide anchor (LLP 0186 W3's bar).

Static reading only; no binaries were run. Findings independently
rediscovered by two or three auditors (the `host.restart` refusal drift, the
hollow catalog intents, the funnel exclusions) carry correspondingly higher
confidence. The eleven diary friction points reported below were each
re-verified against the current guide and source rather than taken from the
diaries on faith. The admin console UI itself was out of scope (LLP 0184's
program covered it; its residue tickets remain accurate).

## Scoreboard

| Surface | Verdict | P0 | P1 | P2 |
| --- | --- | ---: | ---: | ---: |
| HTTP API | Registry and envelopes excellent; hosted gateway lies with 200s; no route→schema artifact | 2 | 7 | 6 |
| CLI (three binaries) | Packaged help registry is a model; native failures are prose with exit 1 | 0 | 8 | 7 |
| MCP servers | Parity CI-gated; every funnel advertises only the read-only server | 0 | 7 | 9 |
| Client SDKs | Types complete, no silent failures; unlicensed on npm; codes undocumented | 1 | 7 | 6 |
| Deploy + verify | Receipts identity-bound; no end-to-end target; vacuous-green `verify` | 1 | 5 | 9 |
| Auth / provisioning | Zero-human local bootstrap works; catalog drift hides shipped verbs | 0 | 2 | 6 |
| Guide / docs | Zero orphan pages, honest GAPs; 12% of codes documented | 0 | 3 | 6 |
| Repo dev tooling | Fully non-interactive; swallowed failures; no entry-point index | 0 | 3 | 12 |
| Records (issues/diaries) | 7 duplicate open/closed tickets (fixed with this landing); 11 unabsorbed diary frictions | — | — | — |

## The four P0s

1. **Hosted gateway serves `index.html` with HTTP 200 for unrouted app-data
   routes.** `cloudflare/src/gateway.js:258` falls through to an
   unconditional assets fetch, so `POST /auth/exchange`,
   `/ephemeral/publish`, asset byte lanes, push-token registration,
   `/app-api/current`, and `/client-mutations/acknowledge` — all present
   locally — return `200 text/html` on hosted. Ticket:
   `issues/20260808-hosted-gateway-spa-200-for-app-data-routes.md`.
2. **No end-to-end deploy path for a user's own app on any target, stated
   nowhere.** Each surface stops short honestly in its own corner
   (`deploy build` deliberately activation-ineligible, `hosted lifecycle`
   refusing on the carrier gap, `cloudflare/deploy.sh` hardcoded to two
   in-repo demos), but no page or GAP row states the aggregate. Ticket:
   `issues/20260808-deploy-posture-truth-page.md`.
3. **Every published package is unlicensed on npm.** LLP 0033 ratified MIT
   on 2026-07-01; no root `LICENSE`, no `license`/`repository`/`homepage`
   field exists in any of the 13 publishable manifests. Ticket:
   `issues/20260808-npm-license-and-package-metadata.md`.
4. **No agent path to an app-data credential** — the LLP 0055 creation half
   (registration, initial `sbac_` issuance) is unbuilt; only
   harness-provisioning or human-mediated pairing exists. Already tracked:
   the capability-index GAP row (`guide/capabilities.md:77`) and the Wave 4
   identity program (`issues/20260808-wave4-identity-program.md`, LLP 0150).
   The only new action is linking the boundary from the headless-client
   entry points so agents stop hunting for a route that does not exist
   (folded into `issues/20260808-guide-docs-hygiene-batch.md`).

## Findings by theme

Themes are ordered by recommended execution priority. Each maps to one filed
ticket carrying the full evidence; this section keeps only the shape.

### 1. The control catalog's discovery layer is hollow

90 of 114 rows have empty `intents` (all 41 `native` rows; 0 of 45
MCP-projected rows have any), 77 lack a `guide` anchor, 44 have a placeholder
title equal to the operation id, and 36 of 38 `apiOnly` operations have no
invocation recipe. `snapback controls list --intent "slow network"` — LLP
0184's own worked example — matches zero rows. The generator enforces rules
3/5/6/7/8 but has no rule-4 check, and the packaged verbs (`verify`,
`deploy`, `hosted`, `accept`) have no catalog rows at all while
`acceptance.run` sits in the catalog marked unbuilt. Ticket:
`issues/20260808-control-catalog-discovery-metadata.md`.

### 2. Post-0184 projection drift

The `host.restart` HTTP refusal (`crates/snapback/src/host_ops.rs:1968`) says the shipped
`snapback restart` CLI does not exist; the catalog records `auth.mintSession`
as `apiOnly` though `snapback session mint` shipped 2026-08-05 (the
generator's `CLI_PROJECTIONS` map was never updated). Both are exactly the
drift class LLP 0184 warned about; the fix includes the test that prevents
the class. Ticket:
`issues/20260808-post-0184-projection-drift.md`.

### 3. `mcp-control` is invisible from every funnel

`/llms.txt`, the native CLI's `after_help`, both package READMEs, all five
scaffolded template `AGENTS.md` files, and the capability index name only the
read-only guide server — never `mcp-control` or `snapback agent setup`. The
guide MCP's own `instructions` steer agents at its two largest resources
(the flat projection has grown to ~1.8 MB, 2.5× since its oversize ticket)
instead of the capability index. Ticket:
`issues/20260808-mcp-control-funnel-invisible.md`.

### 4. Errors-as-docs at real scale

~2,418 distinct `SNAPBACK_*` codes in production sources; 296 documented in
the guide; no code→doc lookup path (`snapback guide <CODE>` dead-ends into
the capability index). The `next[]` carrier exists in the host-ops envelope
but is populated on exactly one path repo-wide and never on failure. Client
arms raise 138 undocumented codes plus uncoded bare throws on documented
subpaths; codegen has 20 uncoded throws; thrown mutation errors are typed
`unknown`; the Swift arm's client-originated errors carry no codes at all.
Verify receipts can carry raw Node codes (`ENOENT`) in `diagnostic.code`.
Admin/auth refusals name the requirement but not the acquisition path.
LLP 0193's "200–500 codes" Phase 1 sizing must be corrected before its lanes
are cut. Tickets:
`issues/20260808-diagnostics-code-registry-and-lookup.md`,
`issues/20260808-uncoded-throws-and-untyped-client-errors.md`,
`issues/20260808-refusals-lack-acquisition-path.md`.

### 5. The npm / out-of-checkout surface

Beyond the license P0: `snapback-client` and `snapback-react` — the two
packages an author installs first — are the two excluded from the LLP 0187
T4 funnel gate and lack the out-of-checkout documentation block; every README
doc link is a loopback URL, dead on npmjs.com; `@expo/snapback-sidecar`
claims publishability but is in no inventory, capability row, or guide page;
the runtime packages ship no README; the generated API reference stamps
`0.1.0`, a version absent from the published closure. The Swift arm cannot be
consumed or tested outside a checkout while its capability row implies it
can. Tickets: `issues/20260808-npm-license-and-package-metadata.md`,
`issues/20260808-swift-arm-not-consumable.md`.

### 6. `snapback verify` trust gaps

Bare `snapback verify` with no `--config` substitutes a zero-profile default
and reports `ok: true` with zero acceptance evidence — in scaffolded apps
whose convention config sits undiscovered beside it. The committed receipt
schema validates nothing anywhere; there is no profile timeout; the runtime
stage cannot be satisfied by a Cloudflare-targeted app; three of five
`recommendedNext.command` values are prose; the CLI help declares the wrong
receipt identity. Ticket: `issues/20260808-verify-trust-gaps.md`.

### 7. Native CLI machine-mode gaps

Native failures are prose on stderr with exit 1 (`--json` is not
failure-safe; the app CLI's frozen 11-code exit taxonomy exists to be
adopted); `snapback guide --json` is silently ignored on the search and
channel-listing paths; `--help --json` returns the ~33 native verbs as an
opaque text blob; no `--version` on any of the three CLIs; bare `snapback`
starts a foreground server; `snapback admin` spawns a browser and prints no
URL; `snapback-app`'s help is five lines with most flags undocumented;
CLI-only families emit ad-hoc JSON with no `schemaVersion`. Ticket:
`issues/20260808-native-cli-machine-mode.md`.

### 8. HTTP seams beyond the P0

Local unknown routes return a bodyless 404 with no diagnostic (the hosted
gateway does better); on a hosted-serving instance the entire discovery
surface is a bare 404 by design while `guide/index.md` promises the served
guide unconditionally; the gateway-paths parity fixture is one-directional
and frozen at an audited commit by its own admission; no artifact joins a
route to its request/response schemas; the error envelope has no version
field; the root landing page omits `/llms.txt`, `/app-api/current`, and the
control catalog from its links. Tickets:
`issues/20260808-hosted-gateway-spa-200-for-app-data-routes.md`,
`issues/20260808-http-route-schema-join-and-envelope-versioning.md`.

### 9. MCP tool quality

`snapback_asset_export_cut` is annotated `readOnlyHint: true` while writing a
manifest and every referenced blob to the host filesystem (harnesses
auto-approve read-only tools); no tool declares `outputSchema` despite every
call returning `structuredContent`; two path segments bypass the hardened
encoder; arguments are never validated against the declared schema before
dispatch; 108 of 111 guide resources share a path-echo description; neither
server offers guide search; every resource operation spawns a fresh native
child with no caching. Ticket: `issues/20260808-mcp-tool-quality-batch.md`.

### 10. Repo tooling and record hygiene

`sync-agent-skills` prints "Synced" and exits 0 after refusing to link — and
the hooks only react to non-zero exits; nothing verifies `core.hooksPath` is
armed; `--help` on the main shell entry points either errors without usage or
silently starts a multi-minute build; no `scripts/README.md` distinguishes
the ~17 real entry points from 72 gate internals; the 130-gate proof reports
no position/total and cannot re-run one gate. Seven tickets existed in both
`issues/` and `issues/closed/` with contradictory statuses (fixed in this
landing: stale open copies removed, two mis-headed closed copies corrected).
Eleven diary friction points were verified unabsorbed, including two flagged
across multiple runs. Tickets:
`issues/20260808-repo-tooling-agent-entrypoints.md`,
`issues/20260808-guide-gap-diary-friction-absorption.md`,
`issues/20260808-guide-docs-hygiene-batch.md`.

## What is already strong

Recorded so later audits do not re-litigate, and so fixes do not regress it:

- **Non-interactive throughout.** Zero TTY-requiring paths across scripts,
  hooks, and CLIs; every prompt has a non-interactive twin whose refusal
  hands the agent the literal token to use.
- **The host-ops envelope** (`schemaVersion`, `requestId`, `ok`,
  `diagnostics[]`, `next[]`) with unknown operations returning candidate
  lists; one shape across CLI, HTTP, and MCP.
- **The typed route registry** with seven policy axes and startup-panic
  validation; `guide/surface-map.md` mechanically checked against it; the
  code→HTTP-status table exhaustive and drift-gated.
- **`GET /app-api/current`** — content-addressed, credential-free API
  discovery with per-operation `argsSchema`.
- **Structural MCP parity**: the catalog generator imports the live tool
  list and CI-fails on drift; secret-bearing rows cannot be promoted to MCP
  tools without an authored pin; identity handshakes refuse mixed-build
  reads.
- **Secret hygiene at the config seam**: no `--value` spelling exists;
  stdin/fd carriers only; redacting `Debug` impls; scoped auto-minted read
  leases.
- **Vacuous-pass protection** in the demo harness and starter acceptance —
  which is why theme 6's bare-verify hole stands out as the outlier.
- **Honest gap disclosure**: capability GAP rows with owners and hard-error
  expiry; `mediated`/`unavailable`/`internal` operability typing; zero
  hallucinated codes in the guide; 4/4 passing cold-agent retrieval evals.
- **The 847-symbol generated API reference** with budgeted exact lookup —
  the machinery theme 4 reuses for diagnostics.

## Ticket index

Filed with this document, all dated 2026-08-08:

| Ticket | Theme | Severity |
| --- | --- | --- |
| `control-catalog-discovery-metadata` | 1 | P1 |
| `post-0184-projection-drift` | 2 | P1 |
| `mcp-control-funnel-invisible` | 3 | P1 |
| `diagnostics-code-registry-and-lookup` | 4 | P1 |
| `uncoded-throws-and-untyped-client-errors` | 4 | P1 |
| `refusals-lack-acquisition-path` | 4 | P1 |
| `npm-license-and-package-metadata` | 5 | P0 |
| `swift-arm-not-consumable` | 5 | P1 |
| `verify-trust-gaps` | 6 | P1 |
| `native-cli-machine-mode` | 7 | P1 |
| `hosted-gateway-spa-200-for-app-data-routes` | 8 | P0 |
| `deploy-posture-truth-page` | 8 | P0 |
| `http-route-schema-join-and-envelope-versioning` | 8 | P1 |
| `mcp-tool-quality-batch` | 9 | P1 |
| `repo-tooling-agent-entrypoints` | 10 | P2 |
| `guide-gap-diary-friction-absorption` | 10 | P1 |
| `guide-docs-hygiene-batch` | 10 | P2 |

Findings already tracked elsewhere were left with their owners, notably: the
agent-credential program (LLP 0150 / Wave 4), the codegen-declaration drift
gate, the guide flat-projection oversize, the freshness-warning saturation
(whose measured numbers have improved and should be refreshed), the
supervisor `CI=1` Metro-watch default, and the LLP 0184 storage-row and
scenario-helper residues.
