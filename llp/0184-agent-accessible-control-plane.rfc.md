# LLP 0184: Agent-accessible control plane

**Type:** RFC
**Status:** Implemented
**Systems:** Agent experience, Developer experience, Admin console, CLI, MCP,
Host operations, HTTP API, Guide, Auth, Security, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-26 (managed-MCP reaping correction: MCP now sends the
authenticated self-stop directly for a manager-owned child and observes its
exit by reaping the unforgeable Node child handle; attached servers continue
through native PID/start-time observation). 2026-08-26 (observed-exit follow-up: direct stop and restart bind
the descriptor PID to its pre-stop OS start time and descriptor-matching startup
nonce, then grant success only after signal-0 `ESRCH` or different-start-time
PID reuse proves the original process gone; URL loss remains a separate fact,
and HTTP responder identity remains unattested). 2026-08-26 (lifecycle
receipt-honesty follow-up: validation requires the exact declared administrator
authority and self-stop result without promoting either into responder identity
attestation). 2026-08-26 (lifecycle authority correction: direct stop and
restart use served AdminWrite `host.stop`; its input carries startupNonce but no
PID, the server requests its own shutdown, and the client requires the
descriptor-named pre-stop process identity gone before success; no projection
signals a descriptor-named PID). 2026-08-12
(data-patch token/CAS coupling: the token remains
available across failed commits and is consumed only after a successful CAS,
within the same serialized process-local turn). 2026-08-10 (LLP 0146 OQ6 ruled projection: ControlCatalog's
reserved `remediation` field now points to the shared v1 decoder/carrier and
does not duplicate the global kind registry; see dated amendment). 2026-08-08 (bounded gateway source parity: the compiler now
extracts the named forwarded-path Set, kit regex constants, app-data fallback
prefix list, and exact `path ===` literals from `gateway.js`; unlisted changes
fail CI. Rule 11's catalog join remains system/control-scoped while the fixture
now also covers the app-data plane). 2026-08-08 (post-program catalog hardening: the catalog records
the shipped `snapback restart --ready-file <path>` and `snapback session mint
--email <address>` projections; Rule 4 discovery metadata is compiler-enforced;
all packaged root CLI verbs are inventoried; catalog-derived Guide/CLI recovery
steps populate failed host-operation `next[]`). 2026-08-06 (program completion — see "Delivery record
(2026-08-06)" at the end of this document: Phases 0–5 landed on main by two
coordinated orchestrator sessions; both cold-agent evaluation legs passed
against a packaged npm-installed build; acceptance criteria audited with
evidence pointers; residue = two storage catalog rows deliberately left on
the fail-closed default pending storage-owner classification
(`issues/20260806-llp0184-storage-rows-await-owner-classification.md`), and
the LLP 0146 D7 remediation projection remaining conditional exactly as
§Authority and scope always stated); 2026-08-06 (Phase 2 residue: `ephemeral.cleanup` now has explicit
cutoff, preview/apply bound, startup binding, ordinary removal fan-out, and a
structured receipt through native CLI/MCP projections; `host.restart` is now
native through a concrete-admin-credential-proven `snapback restart` CLI;
`cron.list` exposes the already-retained narrow scheduler facts under LLP
0028/0024 ownership; P1 projection coverage is closed); 2026-08-05 (generation-snapshot reconciliation — the checked catalog recomputes and compares its semantic digest and entries while preserving the schema-validated generation snapshot, because the commit carrying a generated file necessarily postdates the snapshot and cannot self-identify); 2026-08-05 (post-round-5 author-directed closing pass, after a
5-round llp-super-refine loop (14→10→6→6→6 distinct MATERIAL concerns,
converging without a design change) left four items for the author: the
delivery plan's Phase 1 item 3 reworded to match §Design/3a's hand-
maintained-plus-audit posture instead of the disproven mechanical-enforcement
claim it still described; the hosted-adapter manifest re-keyed by
`(method, path, operation)`, not path alone, after a real one-path/
two-operation case (`/_snapback/api/debug/network-profile`'s GET/write
split); a bright-line, checkable test added for the `direct`/`mediated`
boundary ("is the request already fully specified without the human step,
or does a required input have to originate from a human/external party
during the call"); `config.secret.acquire` dropped from v1 (its cited LLP
0036 mechanism didn't exist as described) in favor of confirming completion
via already-owned `config.status`/`config.verify`, with `config.set` pinned
to `cliOnly` — not `native` — until a secret-safe MCP carrier is defined;
and the disclosed `host.restart` MCP/HTTP authority gap resolved as a
scheduled Phase 2 closure (gate the MCP path behind the same admin
credential the HTTP path requires) rather than a permanent, vacuous
invariant restatement — full detail in
`llp/reviews/0184-agent-accessible-control-plane.run.md`)
**Related:** LLP 0000, LLP 0009, LLP 0010, LLP 0017, LLP 0024, LLP 0031,
LLP 0036, LLP 0042, LLP 0044, LLP 0058, LLP 0061, LLP 0094, LLP 0095,
LLP 0146, LLP 0154, LLP 0156, LLP 0158, LLP 0167, LLP 0179

## Summary

Snapback's administrative surface is more agent-accessible than it first
appears, but less agent-*discoverable* and less consistently agent-*operable*
than it should be. The admin console is a thin client over typed HTTP, so it
does not contain browser-only backend powers. However, an agent commonly sees
only the read-only `snapback mcp` guide server, while the separate
`snapback mcp-control` server is easy to miss; several shipped admin actions
have only HTTP or `AdminClient` projections; two published inventories have
already drifted; and some operator operations are labeled merely
`notAuthorFacing`, which does not tell an agent whether they are internal,
dangerous, specialist, or simply undocumented.

This RFC proposes one cross-surface completeness contract:

1. Generate a versioned **`ControlCatalog`** that joins every control-plane
   operation to its intent, status, authority, effects, input/output schemas,
   target availability, projections, guide anchor, and agent-access
   classification. The catalog is a projection of existing owners, never a
   second operation or security authority.
2. Enforce **no accidental click-only controls**. Every console action and
   every registered admin/host operation must be cataloged with what surface
   it has (natively agent-operable, CLI-only, MCP-only, or specialist-API-only)
   and who may invoke it (directly, human-mediated, internal, or
   unavailable) — two independent facts, not one label. An omission requires
   a reason; silence is a build failure.
3. Make the common path genuinely easy: one agent setup command, build-matched
   guide resources in the control MCP server, catalog search/describe commands,
   direct typed tools for common operations, and shared structured envelopes —
   plus typed remediations once LLP 0146 lands a carrier for them.
4. Project the useful shipped-but-hidden operations, and build three missing
   local debugging controls now: bounded direct row patching, forced live
   resync, and targeted administrator deletion of an ephemeral entry. Do not
   add a semantics-bypassing "simulated publish" primitive; a future test
   helper should publish through a real connection and normal authority path.

"Fully agentically accessible" does **not** mean that every internal route or
secret-bearing action becomes autonomously invocable. It means there are no
accidental gaps: an agent can discover every relevant capability, operate it
through an appropriate structured surface, or receive an exact explanation
and resumable handoff when policy deliberately requires a person.

## Authority and scope

This RFC owns the cross-surface inventory, agent-access classifications,
projection-completeness rules, discovery/setup experience, and rollout order.
It also selects the product direction for the four currently missing admin
controls discussed in §Missing controls worth building now.

It does not take semantic authority from neighboring documents:

- LLP 0024 owns host-operation identities, envelopes, authority modes, and
  operation behavior. `data.patch`'s authority disclosure (§A) uses LLP 0024's
  existing `devUser`/`devAdminBypass` tuple; it does not add a mode.
- LLP 0031 owns route registration, credentials, effects, response sensitivity,
  and the centralized authorization gate.
- LLP 0017 owns the console and headless admin contract.
- LLP 0036/0058 own config, secret transport, and secret-read leases.
- LLP 0042 owns MCP tool projection and the app-data/control-plane separation.
- LLP 0044 owns the asset storage pipeline's operations, authority, and
  lifecycle. §P2's asset delete/GC/key-rotation/export/import row catalogs and
  projects LLP 0044's existing surface; it does not add asset semantics.
- LLP 0061 owns the guide corpus, capability index, distribution, and retrieval
  evaluation.
- LLP 0094/0095 own the wire protocol, including the `resync_required` frame
  and connection/subscription generation semantics that §B's forced resync
  triggers rather than reimplements.
- LLP 0146 owns typed remediation semantics and automation safety. Its D7
  remediation carrier and OQ6 (registry shape, cross-projection disclosure)
  are still open at this RFC's Date. §Design/4's remediation-projection
  requirement is written as *conditional on* LLP 0146 landing a carrier, not
  as a resolution of OQ6; see the Acceptance note.
- LLP 0158 owns derived-instance recognition and what it is recognized *for*.
  Today that is network-profile activation only. §A's use of a derived
  instance for `data.patch` bypass eligibility is a proposed new grant this
  RFC asks LLP 0158's owner to make, not an existing one it projects — v1
  ships without it until that amendment lands.
- LLP 0167 owns network-profile semantics and its activation policy.

The catalog records those decisions; it cannot override them. A catalog row
cannot make an unauthorized operation authorized, a hosted refusal available,
or an unimplemented capability real.

This is also deliberately separate from LLP 0179's `AppDescriptor`.
`AppDescriptor` is the portable vocabulary an application consumes. The
`ControlCatalog` is the operator-plane vocabulary used to inspect and manage a
particular Snapback build and instance. They may share schema conventions, but
must never merge namespaces or authority.

## Research snapshot: 2026-08-05

The review covered LLPs 0017, 0024, 0031, 0042, 0061, 0146, 0154, 0156, and
0167; the route and host-operation registries; `crates/snapback/src/cli.rs`; the two MCP
servers; `packages/snapback-admin-client`; the Contract admin console; and the
Guide's index, capability index, surface map, host-ops page, config page, and
feature-area pages.

### What is already good

The architectural invariant in LLP 0017 is sound: the server owns a headless
admin API and the console is one client. Start/stop/restart, inspect, reset,
schema/functions load, generated function execution, telemetry, errors, and
network profiles already have structured non-browser paths. Their policies are
enforced below the projection, so adding a CLI or MCP tool need not create a new
authority path.

Network profiles are the best current example. An agent can already run:

```sh
snapback network-profile get --ready-file .snapback/dev.ready.json
snapback network-profile set optimistic --ready-file .snapback/dev.ready.json
snapback network-profile set demo-slow --ready-file .snapback/dev.ready.json
snapback network-profile set normal --ready-file .snapback/dev.ready.json
```

or use `snapback_network_profile_get` and
`snapback_network_profile_set` through `snapback mcp-control`. Custom profiles
are accepted as the same bounded inline object as the API and console. Every
surface reaches LLP 0167's one activation gate, and a runtime selection is
intentionally cleared on restart. This is the desired implementation shape:
one semantic operation, several thin projections, exact structured results.

The fixed control-plane inventory contains 17 named tools — lifecycle
start/stop/restart; inspect; network-profile get/set; telemetry
stats/events/export; error issue list/detail/transition; reset; schema load;
functions load; function run; and `acceptance.run` — alongside whatever
generated app-data function tools the target app contributes at `tools/list`
time; the 17 is the control-plane count, not the whole response. The last of
the 17 is deliberately exposed-but-unbuilt and returns the server-stamped
`SNAPBACK_HOST_OP_UNIMPLEMENTED` envelope. Assets, table scan, cron, one-off
jobs, cleanup, disconnect, and config operations are absent from that tool
inventory even where another structured projection already ships.

### Where the current surface falls short

| Capability | Shipped programmatic surface | Finding |
| --- | --- | --- |
| Lifecycle, inspect, reset, load, function run | CLI, control MCP, host-ops HTTP | Strong and agent-native. |
| Network profiles | CLI, control MCP, host ops, admin API, console | Strong implementation; weak discovery. The capability GAP and some hosted wording are stale after LLP 0167 v1.2. |
| Telemetry and error issues | CLI/control MCP/host ops/admin API, console | Strong; sensitive detail correctly retains the secret-read lease. |
| Assets | Rich CLI and host operations | Agent-operable from a shell, but absent from MCP despite being in the host-operation registry. |
| Read-only table browsing | Admin API, `AdminClient`, console | Programmatic but click-biased: no direct CLI/control-MCP projection or intent-first agent recipe. |
| Cron tick and run-one | Admin API and `AdminClient` | Shipped but lacks a direct control CLI/MCP projection. |
| One-off job drain/list/show | Admin API and `AdminClient` | Shipped but lacks a direct control CLI/MCP projection. |
| Ephemeral cleanup | Admin API, `AdminClient`, console | Effectively hidden from agents and classified only as `notAuthorFacing`. |
| Connection disconnect | Admin API | Most hidden shipped control: has only a `notAuthorFacing` surface-map row, no CLI/MCP/`AdminClient` projection, and LLP 0017's own status prose still lists it among unshipped gaps though the route and its test have shipped. |
| Config status/plan/verify | Admin API and browser setup; partial `AdminClient` | Non-secret planning and verification should be agent-native. Secret value transit needs a deliberate safer carrier. |
| Config set | Admin API and browser setup | Carries a secret value; must not put it in argv, logs, receipts, or ordinary MCP results. §P3: `operability: direct` — human entry stays outside this catalog (the setup page writes the value itself; no agent handoff row); `surfaceAccess: cliOnly` for v1, pending a defined MCP secret carrier. |
| Config unset | Admin API and browser setup | Carries no value — the handler's own comment records "the transit rule does not apply; the admin write gate does." Ordinary direct-projection absence, not mediation; misclassifying it as mediated would be a defective catalog decision. |
| Direct row edit, forced resync, administrator ephemeral-entry delete, simulated publish | Not implemented | Missing, not merely hidden. A catalog must report that honestly. |

The Guide exposes the structural drift directly:

- `guide/operating/host-ops.md` says there are 28 request spellings and 39
  registry identities, while the shipped network-profile operations make the
  current totals 30 and 41. Hand-maintained prose counts have already failed.
- `guide/index.md` prominently documents the resource-only `snapback mcp` and
  correctly says it has no tools, but does not make the separate shipped
  `snapback mcp-control` setup equally obvious.
- No checked-in, generated MCP configuration registers the control server for
  the common agent clients. In an otherwise capable workspace, an agent can
  therefore conclude that control tools do not exist.
- `guide/capabilities.md` has useful intent keywords for latency, slow network,
  delay, and jitter, but its network-profile GAP still names work that LLP 0167
  v1.2 records as implemented, and there is no dedicated operating page with
  CLI, MCP, API, authority, and restore examples.
- `guide/surface-map.md` mechanically joins routes and host operations to a
  capability, but it does not join console actions, CLI commands, MCP tools,
  `AdminClient` methods, or guide coverage to one another. A route may therefore
  be correctly classified and still be practically undiscoverable.

### Findings

1. **No backend action is inherently browser-only, but some are practically
   click-only.** The distinction matters: the repair is projection and
   discovery, not browser automation.
2. **`notAuthorFacing` is too coarse for operator tooling.** It currently
   includes useful agent operations such as cleanup alongside genuinely
   internal maintenance. Those need different dispositions.
3. **Capability, availability, and projection are separate axes.** A capability
   can exist yet lack an MCP tool; have a tool yet be forbidden on this target;
   or be designed but unbuilt. One boolean cannot represent those facts.
4. **A list of routes is not an ergonomic operating surface.** An agent needs
   intent keywords, exact schemas, effects, examples, target rules, and next
   actions without source archaeology.
5. **Manual parallel inventories will drift.** Counts and projection claims
   should be generated from the same joined facts that CI checks.

## Product contract: what “agent-accessible” means

For any administrative intent, an agent beginning with the normal Snapback
Guide/CLI/MCP entry points must be able to:

1. discover whether Snapback supports the intent without reading implementation
   source;
2. distinguish shipped, target-refused, disabled, and unimplemented states;
3. learn the input schema, output schema, authority, sensitivity, effects,
   preconditions, and destructive/idempotent properties;
4. invoke an eligible operation without clicking through a browser;
5. receive the ordinary subsystem result envelope, diagnostics, and typed
   remediations rather than projection-specific prose; and
6. when human participation is deliberate, initiate the request, show the
   human exactly what is required without exposing a secret, observe status,
   and resume from a bounded continuation.

Round 1 tried to collapse this into one closed `agentAccess` value and failed:
two rounds of review showed that "which surfaces exist" and "who may invoke
it" are genuinely different axes — `mediated`/`internal`/`unavailable`
describe *who may act*, while `native`/`cliOnly`/`api` described *what
exists*, and real operations (a CLI-only operation that is also
human-mediated; an MCP-having operation that is also unbuilt) need one value
from each, not a forced choice from one enum. An operation therefore carries
**two independent closed fields**:

**`surfaceAccess`** — what typed projections exist, checkable purely from
registry/CLI/MCP declarations:

| Value | Contract |
| --- | --- |
| `native` | Has both a typed direct CLI command and a typed control-MCP tool. |
| `cliOnly` | Has a typed direct CLI command, no MCP tool yet. Carries a `mcpDeferralReason`. |
| `mcpOnly` | Has a typed control-MCP tool, no direct CLI command yet. Carries a `cliDeferralReason` naming why (for example exposed-but-unbuilt `acceptance.run`; `host.restart` left this class when Phase 2 shipped its direct CLI composition). |
| `apiOnly` | Has a stable typed HTTP and/or `AdminClient` projection — complete schema, example, credential path, result contract — but no CLI or MCP tool. |
| `none` | No direct/API projection exists or is appropriate; invocation, if any, happens entirely through the `operability` axis below (e.g. a purely browser-mediated secret-entry step). |

Every `surfaceAccess` value except `none` also requires a structured result
contract, intent keywords, and a Guide anchor. A usage-evidence threshold can
promote `apiOnly` → `cliOnly`/`mcpOnly` → `native`, never the reverse — except
that promotion is refused outright, threshold or not, when
`policy.responseSensitivity` is `CredentialSecret` or `policy.effect` is
`ImpersonationCapability`. Two rounds of review kept finding real operations
this way: a route can be shipped and low-traffic today (correctly `apiOnly`)
while its ordinary result is credential material — `GET
/_snapback/api/auth/mailbox`'s dev-mailbox capture is the concrete case, an
operator-only, `AdminWrite`/`CredentialSecret`/`ImpersonationCapability`
route with no CLI/MCP/`AdminClient` projection today. Usage-evidence
promotion must not be able to mint a *typed* MCP tool whose ordinary result
is a secret, which "No secret in convenience channels" (§Security and
ergonomics invariants) already forbids for the tool that would result. A row
this rule blocks stays `apiOnly` regardless of call volume; an authored
override, not a threshold, is the only way past the pin, and only after the
override itself passes the same secret-carrier review as `config.set`.

**`operability`** — who may invoke it, independent of which surfaces exist.
Round 3 review (both families, independently) found this axis was still
conflating three different facts — implementation status, support policy,
and whether *this specific operation's own design* requires a human or
external custodian to participate — with a fourth, genuinely independent
fact, whether a destructive action needs confirmation before an otherwise
agent-executable call runs. The fourth fact already lives in
`approvalPosture` (below); `operability` keeps only the first three, and the
distinction that matters for `mediated` is now stated precisely:

| Value | Contract |
| --- | --- |
| `direct` | Every surface named by `surfaceAccess` can be invoked by an agent, given whatever credential the agent can lawfully hold, subject only to runtime admission. A `confirmFirst`/`humanApprovalRequired` `approvalPosture` may still gate the call — that is a safety property, not a change to who *can* invoke it. |
| `mediated` | The operation's own design — not a policy choice about who is trusted — requires a human or external credential custodian to supply or approve something the agent structurally cannot hold (a secret value entered live, a WebAuthn ceremony, an out-of-band approval). The agent can plan, initiate, poll, and resume through whatever `surfaceAccess` the row has, without ever receiving the protected value. |
| `internal` | Unsupported as an author/operator action regardless of `surfaceAccess`. The catalog names why and which supported operation, if any, replaces it. No console affordance may invoke it. |
| `unavailable` | A known desired capability is not implemented. The catalog reports the owner, status, and design/ticket pointer; no placeholder returns success. `surfaceAccess` is **not** forced to `none` — an exposed-but-unbuilt tool (see `acceptance.run` below) keeps the `surfaceAccess` value true of its actual projection; rule 7 (below) is what stops it from claiming success, not an artificial pairing constraint. |

**The `direct`/`mediated` boundary is a bright-line, checkable test, not a
judgment call per row.** Round 2 review flagged this as still ambiguous
through round 5: an out-of-band human approval could plausibly be coded as
either `direct` with `approvalPosture: humanApprovalRequired`, or `mediated`
— and only one of those carries rule 6's plan/initiate/status/resume and
negative-leak obligations, so the classification has real enforcement
consequences, not just labeling ones. The test: **ask whether the call the
agent makes is already complete without the human step.** If the agent
holds (or could itself lawfully obtain) every input the operation needs, and
the human step is a *confirmation of a call already fully specified* — the
agent could construct and would execute the exact same request whether or
not a human approves it — the row is `direct`, and `approvalPosture` carries
the gate. If the operation's required input includes something that must
originate from a human or external party during the call itself — a value
the agent cannot construct, fabricate, or hold in advance, so the request is
*not yet fully specified* until that party acts — the row is `mediated`.
Secret entry fails the first branch by construction (the agent cannot
construct the secret); an admin clicking "approve" on a fully-formed,
already-agent-specified destructive request passes it (the request doesn't
change based on the click). This is a per-operation classification made once
by whoever authors the catalog row, checkable by asking the one question
above, not a per-invocation runtime choice.

**Config value entry stays a browser-mediated step outside this catalog's
agent-facing surface for v1, not a cataloged `mediated` operation.** Round 4
tried to represent the human-entry handoff as its own catalog row,
`config.secret.acquire`, grounded in an LLP 0036 acquisition mechanism —
round 5 review found that grounding didn't hold: the cited section doesn't
exist in LLP 0036, the tier that would apply (agent-tracked human handoff)
is explicitly not built in 0036 v1, and minting a new status enum
(`pending`/`complete`/`expired`/`cancelled`) for a neighbor-owned subsystem
repeats exactly the mistake this RFC avoids elsewhere (§Design/1's LLP 0146
remediation field, §Authority and scope's LLP 0158 grant) — inventing
semantics an owning document hasn't ratified. Rather than carry a
speculative dependency, v1 drops the row: the shipped browser/operator setup
page already handles human entry end to end (it reads the value and writes
it directly, with no agent in that call chain), an agent's role is limited
to detecting the gap via `config.status`/`config.plan` and directing a human
to the existing setup flow, and confirming completion via
`config.status`/`config.verify` — all three already LLP 0036-owned
operations, requiring no new row. **If LLP 0036's owner later defines an
agent-trackable acquisition tier** (the "L1" shape 0036's own roadmap
gestures at), `config.secret.acquire` becomes addable then, as a projection
of that ratified mechanism rather than a guess at it now.

`config.set` itself carries a value the caller already holds — via
stdin/file descriptor, the only v1 carrier (an OS keyring/secret-manager
reference is LLP 0036 v2+) — and is `operability: direct`: nothing about
completing the call requires a human once the caller has a value in hand,
regardless of how that value was obtained (browser entry today; a
lawfully-acquired credential from some other means later). Its
`surfaceAccess` is **`cliOnly`, not `native`, for v1**: `native` requires a
typed MCP tool, and round 5 review found no safe MCP transport exists for a
secret value — stdin/fd is a CLI-process carrier with no MCP equivalent, and
an already-running MCP server has no file-descriptor-passing mechanism in
its JSON-RPC transport. `config.set`'s `mcpDeferralReason` names this
directly: no MCP secret carrier is defined. Promoting `config.set` to
`native` requires an LLP 0036/security-owner-approved MCP carrier design
(ownership, binding to the exact request, lifetime, cleanup, replay
resistance) before that promotion is legal — the same authored-override
discipline the `CredentialSecret` promotion pin above already establishes
for a materially identical hazard.

This gives every real shape a single, unambiguous pair instead of a forced
choice: the assets family is `(cliOnly, direct)` — a full typed CLI, zero MCP
tools, ordinarily invocable. As of the 2026-08-06 Phase 2 delivery,
`host.restart` is `(native, direct)` — see
§Design/2's note on what that tool's projection actually is. `snapback admin
link` (one-time operator claim links, plan/observe/redeem) is `(cliOnly,
mediated)` — a typed CLI, but human redemption is the operation's whole
point, so it inherits rule 6's plan/initiate/status/resume and negative-leak
obligations regardless of its `surfaceAccess`. `acceptance.run` is
`(mcpOnly, unavailable)` — the shipped, exposed-but-unbuilt tool keeps the
`mcpOnly` that is true of its projection, and its MCP tool's own behavior
(returning `SNAPBACK_HOST_OP_UNIMPLEMENTED`) is what makes "no placeholder
returns success" true of it, not a relabeling into `internal` (which would
be false: `acceptance.run` is a supported, LLP 0024-pinned future operation,
not a deprecated or unsupported one).

Independent of both axes, every row carries `destructive: boolean` and, for
any row where `destructive` is true, an `approvalPosture` field (`open`,
`confirmFirst`, `humanApprovalRequired`) that a client can render regardless
of `surfaceAccess`/`operability`. This is what OQ5's "dangerous operations"
language resolves against: risk narrows how an operation may be invoked, but
changes neither field — a `(native, direct)` row can require `confirmFirst`,
and `humanApprovalRequired` on a `direct` row is a confirmation gate on an
agent-executable call, not a claim that a human performs the call.

`mediated` is a valid `operability` value only when the operation's own
design — not a policy choice — makes the agent structurally unable to hold
the protected material: secret entry, a WebAuthn ceremony, an external
approval, or explicit authority widening. "The UI was implemented first" is
not a reason, and neither is "this action is dangerous" — that belongs in
`approvalPosture`.

## Design

### 1. `ControlCatalogV1`

Generate one stable catalog entry per administrative operation. An entry
contains at least:

```jsonc
{
  "operation": "debug.networkProfileSet",
  "title": "Set network condition profile",
  "intents": ["simulate latency", "slow network", "set jitter"],
  "status": "shipped",
  "surfaceAccess": "native",
  "operability": "direct",
  "availability": {
    "targets": ["local", "derived-hosted"],
    "profiles": ["dev", "demo", "test"],
    "runtimeProbe": "debug.networkProfileGet"
  },
  "policy": {
    "authority": "operator",
    "routePolicy": "AdminWrite",
    "effect": "debug-perturbation",
    "responseSensitivity": "OperatorMetadata"
  },
  "behavior": {
    "readOnly": false,
    "destructive": false,
    "approvalPosture": null,
    "idempotent": true,
    "openWorld": false,
    "persistsAcrossRestart": false
  },
  "inputSchema": { "$ref": "..." },
  "outputSchema": { "$ref": "hostOpsResult.v1" },
  "projections": {
    "cli": "snapback network-profile set",
    "mcp": "snapback_network_profile_set",
    "hostOps": "debug.networkProfileSet",
    "http": "PUT /_snapback/api/debug/network-profile",
    "adminClient": "setNetworkProfile",
    "console": "developer.networkProfile"
  },
  "guide": "operating/network-profiles.md#set-a-profile",
  "authorities": ["llp/0167"],
  "sources": ["crates/snapback/src/host_ops.rs", "crates/snapback/src/cli.rs"]
}
```

The exact JSON representation is generated, not copied from this example. The
schema must also represent credential carriers, budgets, audit behavior, and
approval/handoff shape. The `remediation` field projects the ruled LLP 0146
carrier and shared decoder identity; this catalog schema does not mint its own
remediation-kind enum (see the 2026-08-10 dated amendment).

The catalog has two identities:

- a **build catalog** with `schemaVersion`, `catalogDigest`, and build identity;
  and
- an **instance availability projection** with startup nonce, target/profile,
  enabled capabilities, and the catalog digest it instantiates.

The checked-in build catalog's `buildIdentity` and `generatedAtCommit` are a
schema-validated, informational snapshot of the source state in which the
compiler wrote it. They cannot be required to equal the commit containing the
artifact: adding the generated bytes creates a later commit. CI instead
recomputes and exactly compares the semantic `entries` and `catalogDigest`
while preserving that snapshot. A running instance still binds the exact
compiled catalog by `catalogDigest`; the snapshot is not an invocation-
authority or current-HEAD claim.

This prevents a static tool description from claiming that a particular
running target permits an operation. Consumers refuse to combine mismatched
catalog and instance identities. The instance projection is a snapshot,
though, not a subscription: a profile or capability change within one
startup (network profiles are the working example — set/restore both happen
without a restart) leaves the startup nonce and catalog digest unchanged, so
a previously fetched projection can go stale without becoming
identity-invalid. Discovery availability is therefore advisory; **invocation
admission is the authoritative check** and every direct tool re-validates
target/profile eligibility at call time regardless of what a prior `controls
describe` returned. Clients that need fresher discovery re-fetch the instance
projection or call the operation's `runtimeProbe`.

### 2. Derived ownership, not a second registry

No new file becomes the hand-authored source of every fact. The compiler joins
facts from their existing owners:

- the LLP 0031 route registry supplies path policy, credential resolution,
  invocation authority, effect policy, response sensitivity, and overlays;
- the LLP 0024 operation registry supplies operation identity, request/result
  schema, authority class, and built/unbuilt state;
- CLI and MCP projection declarations supply command/tool names and
  presentation annotations;
- the admin console's declarative `admin-ui/app.contract` supplies a closed,
  machine-readable enumeration of every `action` the console can invoke —
  this is the enumeration rule 2 walks, not label scraping and not a
  voluntary export;
- `packages/snapback-admin-client`'s public method list supplies a closed
  enumeration of every client method — this is the enumeration rule 3 walks;
- the Guide manifest/capability index supplies the teaching anchor and intent
  vocabulary; and
- subsystem declarations supply restrictions not owned by the carrier, such as
  LLP 0167's profile activation rules.

The generated catalog is a checked join. Conflicting facts fail generation;
the compiler never resolves security disagreements by choosing the most
permissive value. An operation with no governing owner is an error, not an
invitation for the catalog to invent semantics.

**Composed projections are declared additively, alongside their owner, not
instead of it.** Round 4 got this wrong in a way both review families
caught: `host_ops.host.restart` **is** a registered identity
(`AdminWrite`/`SystemApi`), and `snapback_restart`'s MCP tool already
declares `operation: 'host.restart'` against it. "There isn't one" was
false, and treating `composedFrom` as a substitute for `projections.hostOps`
would have dropped a registered identity that rule 1 requires a row for —
undermining the exact rule the field was invented to satisfy.

The row's real anomaly at the RFC review snapshot was sharper than round 4's
diagnosis, and worth preserving here rather than smoothing over. The two
projections disagreed: the HTTP/host-ops path refused `host.restart` outright
(`SNAPBACK_HOST_OP_CLI_ONLY`, "a running server cannot start or stop itself
over its own HTTP surface"), while the MCP tool *executed* it by spawning
the co-installed native binary directly — no admin credential gate at all on
that path, only local process/filesystem access plus the startup nonce. The
same operation identity therefore succeeded through one projection and always
refused through another, which was a live counterexample to "No projection
creates authority... return the same result semantics" (§Security and
ergonomics invariants) for `host.start`/`host.stop`/`host.restart`
specifically. This RFC could not declare that invariant true by assertion
while the shipped code contradicted it; instead:

- **`projections.hostOps` and `composedFrom` are both populated** for this
  row — `hostOps: "host.restart"` (the registered identity rule 1 requires)
  and `composedFrom: ["host.stop", "host.start"]` (how the MCP projection is
  actually implemented). Neither field replaces the other.
- **The catalog discloses the effective credential carrier per projection**,
  not one route-derived value copied onto every projection — `policy.
  routePolicy: AdminWrite` describes the HTTP path (which refuses this
  operation entirely); at the snapshot, the MCP path's actual gate (local
  process access, startup nonce, no admin credential) was a separate, named
  fact on the row. The generated row now records the closed CLI and MCP
  credential proofs separately.
- **The gap is closed, not redefined away.** Round 5 review found that
  restating "no projection creates authority" as "no projection widens the
  authority its own gate enforces" is vacuous as a general principle — any
  projection trivially doesn't widen its own gate, so the restatement proves
  nothing on its own. §Security and ergonomics invariants keeps the original
  invariant exactly as written, with **one explicit, scoped, and temporary
  exception** named for `host.start`/`host.stop`/`host.restart`'s MCP
  projection specifically. Phase 2's `host.restart` vertical slice gated the
  MCP path behind the same
  admin-credential proof the HTTP path already requires — process-lifecycle
  operations sitting outside the ordinary credential path "by necessity" was
  a convenience of that implementation, not a property this RFC endorsed
  keeping. Before that slice landed, the exception was named, dated to Phase
  2, and did not apply to any other row. **Implementation record
  (2026-08-06, strengthened 2026-08-26):** that gate is live for MCP and the
  native CLI projection. Direct stop and the restart stop leg both call
  authenticated served `host.stop`; the request contains only the descriptor's
  startup nonce, the served implementation validates that fence and requests
  its own shutdown, and the caller validates the typed operation/result/target
  and exact declared lifecycle authority. Native callers and MCP attached to a
  server it does not own capture the descriptor-matching startup nonce plus OS
  process-table start time, then require signal-0 `ESRCH` or a different
  creation identity after PID reuse. For an MCP-owned child, the descriptor PID
  must match Node's unforgeable child handle and MCP grants success only after
  asynchronously awaiting and reaping that child's `exit`; it does not block
  the parent inside native observation. Configured-URL health loss remains a
  separate fact. No projection signals a descriptor-named PID, and neither a
  ready file nor dev identity becomes signal authority. The
  projection-authority exception is closed; same-UID HTTP responder identity
  remains a separately disclosed local attestation limitation.

`crates/snapback/src/host_ops.rs`'s in-code `CLI_ONLY_HOST_OPS` allowlist and the
`SNAPBACK_HOST_OP_CLI_ONLY` diagnostic text it drives both assert the
opposite division of labor ("the CLI owns them" / "use the snapback CLI")
for `host.restart` while no `snapback restart` CLI command existed at the
RFC snapshot. Phase 0 corrected the diagnostic text; Phase 2 shipped the CLI
command, so CLI ownership and the implementation now agree.

### 3. Completeness and parity rules

Round 1 tried to define the domain as "not `AppData`" and that predicate is
wrong: `RouteClass` has exactly three variants — `AppData`, `SystemStatic`,
`SystemApi` — and "not `AppData`" sweeps in the console shell and served-guide
static routes (`SystemStatic`), which fit none of the six dispositions. The
domain is instead **`RouteClass::SystemApi` routes, plus every `host_ops.*`
identity, plus `app.ensure.provision`'s specific operation identity** —
`app.ensure.legacy`/`.attest`/`.provision` all register on the *same*
`/app/ensure` path, with the operation selected from the request body's
`intent` field at dispatch time, not from the route. Round 3 review caught
that keying the exception by route (as drafted) makes the checker both
require and forbid a row for `/app/ensure` at once — in-domain because
`provision` is present on it, out-of-domain because `legacy`/`.attest` are
too. The domain test for this one path is therefore keyed by the dispatched
**operation identity**, exactly as the policy-based justification always
intended: `app.ensure.provision` is in-domain (`AdminWrite`/`Operator`/
`OperatorMetadata`); `app.ensure.legacy`/`.attest` are not, on the identical
route. `direct_runner.*` (`function.run`'s CLI/MCP/host-op family) is
`SystemApi` already, so it was never actually excluded despite round 1's
prose claiming otherwise — it is simply, correctly, in-domain, and is the
"function run" row already counted among the 17 control tools. `SystemStatic`
routes (the console shell, the served guide, the setup page) and the two
true `AppData` operations on `/app/ensure` — plus
`ephemeral_publish`/`ephemeral_delete`/`ephemeral_subscribe` — are out of
domain, owned respectively by LLP 0017 (console/setup presentation) and LLP
0042's app-data tool catalog / LLP 0179's `AppDescriptor`. A `ControlCatalog`
row for an out-of-domain operation is a domain error, not merely an
omission.

A fourth family has no route or host-op owner at all: CLI-only local
operations such as `snapback fork`, `snapback auth`, `snapback build-identity`,
and the local-only telemetry SQL hatch never bind a server port or register
in either registry. These are catalogued from a **CLI-side declaration** —
a companion manifest keyed by command path (not the `clap` definition
itself, which carries only a name and a doc-comment string; the manifest is
new, hand-authored per command, and is what actually supplies intent
keywords, the guide anchor, and behavior flags) — rather than being joined
from a registry that does not know about them. §Design/2's "no invented
semantics" rule still applies: a CLI-only row's fields come from that
manifest's own declaration, never from compiler guesswork.

A fifth family exists only on the hosted (Cloudflare) target and has no
`RouteClass` to test at all — see the hosted-scope note that follows the
rule list.

CI enforces these rules:

1. Every route/operation inside the domain (`SystemApi` plus the one named
   `app.ensure.provision` operation-identity exception) and every
   `host_ops.*` identity has a catalog row or a closed `internal`
   classification with a reason. A row for an out-of-domain (`SystemStatic`,
   or an `AppData` operation other than the named exception) route or
   operation is also a CI failure, not just a missing one.
2. Every `action` declared in `admin-ui/app.contract` — the console's closed,
   compiler-visible action enumeration, not a voluntary export — resolves to
   a catalog row or carries an explicit `uiLocal` marker with a reason.
   UI-local presentation actions such as changing tabs use that marker; an
   action with neither a row nor a marker fails generation. An action that
   issues an admin call under a presentation-shaped name (`openTable`,
   `pageTo`) is caught because it is enumerated at all, not because of what
   it is named. The same rule covers the two other places the console issues
   admin calls outside `app.contract` — the bootstrap/credential-recovery
   calls in `admin-ui/main.ts` and the standalone `crates/snapback/src/admin/setup.html` page
   — via a second declared call-site manifest with the same
   row-or-`uiLocal`-marker obligation; neither surface is exempt for being
   outside the primary Contract app. **This second manifest is v1's chosen
   posture, hand-maintained rather than mechanically enforced**: nothing
   technically stops a future imperative `AdminClient` call from being added
   to `main.ts`/`setup.html` without a manifest entry, the way the `Contract`
   action enumeration in rule 2's primary path does stop an undeclared
   `app.contract` action. The author's call is to accept this for v1 —
   `app.contract`'s declarative surface, which carries the large majority of
   console mutations, gets real mechanical enforcement; the two hand-written
   pages get a maintained manifest, caught by drift the same way this RFC's
   own repaired inventories are — the existing LLP corpus audit cadence
   (LLP 0016's reconcile checks) rather than a build-time guarantee. A
   negative fixture proves the manifest is checked against its two known
   call sites at generation time; it cannot prove a *third*, not-yet-written
   call site would be caught. Building an AST/import-boundary enforcement for
   these two pages is explicitly deferred, not ruled out, if drift proves
   costly in practice.
3. Every CLI command (including the CLI-only-declared family above), MCP
   tool, and method in `packages/snapback-admin-client`'s public export list
   resolves back to a catalog row or carries the same `uiLocal`-style marker
   for genuinely non-control helpers.
4. Every `native` row has a typed CLI command, typed control-MCP tool,
   structured result, intent keywords, Guide anchor, annotations, and
   acceptance witness.
5. Every `cliOnly` row has a typed CLI command and a `mcpDeferralReason`;
   every `mcpOnly` row has a typed control-MCP tool and a `cliDeferralReason`;
   every `apiOnly` row has a stable typed API/client projection plus a
   complete invocation recipe. All three additionally require the structured
   result, intent keywords, and Guide anchor rule 4 requires of `native`. A
   usage-evidence threshold can promote `apiOnly` toward `cliOnly`/`mcpOnly`
   and either toward `native`; promotion only ever adds a projection —
   **except that the checker refuses any threshold-driven promotion where
   `policy.responseSensitivity` is `CredentialSecret` or `policy.effect` is
   `ImpersonationCapability`** (§Product contract); such a row stays
   `apiOnly` until an explicit authored override passes the same
   secret-carrier review `config.set` requires.
6. Every row where `operability` is `mediated` has plan/initiate/status/resume
   semantics through whatever `surfaceAccess` it holds, and negative tests
   proving the secret or approval artifact does not leak to the agent — this
   applies regardless of `surfaceAccess`, including `cliOnly`/`mcpOnly` rows
   that are also mediated.
7. Every row where `operability` is `internal` or `unavailable` has a reason
   and owner. A console cannot expose an `internal` operation. An
   `unavailable` row's `surfaceAccess` may still describe an exposed-but-
   unbuilt projection (e.g. `acceptance.run`'s shipped, deliberately-unbuilt
   MCP tool); what CI enforces is that no surface on an `unavailable` row can
   return success — every exposed projection must return the pinned
   unavailability diagnostic, checked per projection, not inferred from a
   `surfaceAccess: none` shortcut.
8. Every row where `destructive` is true has a non-null `approvalPosture`,
   independent of `surfaceAccess` and `operability`.
9. Guide inventories, generated tables, and counts come from the catalog. Prose
   does not hand-maintain "28 operations"-style totals.
10. A new console action, route, operation, CLI command, MCP tool, or
    hosted-adapter manifest entry (rule 11, below) that leaves the join
    incomplete fails the local proof.

The checker extends the useful LLP 0061 surface-map join rather than replacing
it — but the two joins have different domains, and `guide/surface-map.md`
cannot become a full generated projection of the catalog alone. LLP 0061's
join is strictly larger: it classifies every route including `AppData` ones
(`ephemeral_publish`, `app/ensure`, the durable live stream), which the
catalog deliberately excludes. The `ControlCatalog` generates only the
control-domain rows of the surface map; the app-data rows stay LLP
0061-authored (or generated from LLP 0042/0179's app-data catalog in a
future amendment), and `guide/surface-map.md`'s existing completeness check
continues to cover both halves independently.

### 3a. The hosted (Cloudflare) leg — a fifth domain, not an omission

Round 3 review surfaced a gap the four legs above do not cover: everything so
far joins the **Rust/local registry**, which the hosted (Cloudflare) target
does not have. LLP 0031 records this directly: "the hosted arm has no
enforceable route registry (the gateway is a hand-routed Worker)." Real
hosted system controls exist — `/_snapback/api/object/evict` among them,
hand-routed in `targets/cloudflare/src/gateway.js` — with no `RouteClass` entry a
compiler can test. As drafted through round 3, the catalog's completeness
claim was true only for the local/derived arm, while the RFC's own Acceptance
criteria and Non-goals never scoped it that narrowly. This RFC's author has
directed that the hosted arm be in v1 scope rather than deferred, so this
section adds the fifth domain leg rather than narrowing the claim.

The gateway declares its own **hosted-adapter manifest** — a checked-in,
hand-authored table (mirroring the CLI-side declaration leg's shape, and the
existing `network-profile-authority.json` precedent for exporting Rust facts
into a neutral JS-consumable artifact) enumerating every hand-routed
system/control **operation** the Worker serves, each carrying the same
required catalog fields a `RouteClass::SystemApi` entry supplies
automatically for the local arm: intent, schema, authority, effect, response
sensitivity, and target scope. Those fields come from the same several
owners §Design/2 names for the local arm — the Guide manifest for intent,
the LLP 0024-equivalent hosted operation description for schema, and so on —
not from one route-registry-shaped source.

**Entries are keyed by method plus path template plus operation identity,
not path alone.** Round 5 review found a path-only key breaks on a real
case: `gateway.js` forwards every HTTP method for
`/_snapback/api/debug/network-profile` to the coordinator, which then
dispatches GET through the admin-read gate and any write method through the
admin-write activation gate — two distinct semantic operations sharing one
path, with different authority, effect, and schema. A path-keyed manifest
row cannot carry both; a `(method, path, operation)`-keyed one can, and the
network-profile case is exactly the worked example the manifest's schema
must accommodate from the start rather than as a special case.

**The manifest remains hand-authored, with bounded mechanical source parity.**
The compiler does not claim to parse arbitrary imperative JavaScript. It
extracts the gateway's deliberately named registration seams —
`FORWARDED_JSON_PATHS`, `KIT_ROUTE`, `KIT_STREAM_ROUTE`,
`APP_DATA_PREFIXES`, and exact `path ===` string literals — and fails when
the checked fixture does not list the extracted values. An unparsable rewrite
of one of those declarations also fails closed. The fixture now records both
the system/control domain joined into `ControlCatalog` and the app-data plane
needed to keep the hosted availability audit complete. General
`path.startsWith(...)` behavior and final catch-all semantics remain
hand-audited and acceptance-tested; this is intentionally a bounded extractor,
not a JavaScript AST or a declarative gateway router.

A hosted-arm row's `availability.targets` records which targets it actually
reaches — many local/derived operations are **target-refused** on the
primary hosted target by design (network profiles' hosted restriction,
`data.patch`'s local/derived-only scope, forced resync's non-hosted scope).
That is a fact `availability.targets` carries, not the `operability:
unavailable` value, which means *not implemented anywhere* — conflating the
two would let a row that works everywhere except the primary hosted target
be miscoded as if it doesn't work at all, tripping rule 7's "no surface can
return success" against a surface that legitimately does. The hosted leg
does not change any existing target refusal; it only ensures a hosted-only
or hosted-and-local operation gets a row instead of falling outside every
domain this RFC tests. Phase 1 (below) adds a hosted-manifest-generation item
alongside the Rust/JS join; Phase 0's "repair truth" pass includes a
first-pass inventory of the gateway's actual hand-routed system paths — LLP
0031's own hosted table is one row short of `gateway.js`'s real path count
(missing the network-profile route) — the same way it repairs the local
host-ops counts.

CI enforces, for this leg specifically:

11. Every `(method, path, operation)` entry in the hosted-adapter manifest
    matches the fixture's system/control inventory and has a catalog row.
    Independently, the fixture must equal the bounded values extracted from
    `FORWARDED_JSON_PATHS`, `KIT_ROUTE`, `KIT_STREAM_ROUTE`,
    `APP_DATA_PREFIXES`, and exact `path ===` literals in current
    `gateway.js`; negative fixtures prove unlisted Set, regex, and exact-path
    changes fail. This guarantee does not cover arbitrary new imperative
    prefix/catch-all forms outside those seams; the LLP 0016 audit and
    Cloudflare acceptance suite remain the backstop for that residual.

### 4. Agent discovery and setup

The intended cold-agent entry is:

```sh
snapback agent setup --print codex
snapback controls list --intent "slow network" --json
snapback controls describe debug.networkProfileSet --json
```

`snapback agent setup` emits a minimal project-scoped configuration for Codex,
Claude, Cursor, or generic MCP clients. An explicit `--install` may make a
bounded config edit only after showing the target file, the requested server,
and the authority consequence in one sentence — registering `mcp-control`
gives the wired-in client standing admin authority over the local instance via
the auto-minted local admin token (LLP 0042), not merely "a server was added."
It returns a receipt and supports an exact uninstall. It never silently grants
hosted authority or copies credentials into configuration.

The existing security split remains available:

- `snapback mcp` stays a least-authority, resource-only Guide server. It reads
  the same embedded guide corpus the Rust binary compiles in.
- `snapback mcp-control` remains the explicit control server, but also
  re-serves the Guide corpus and the control catalog. Because `mcp-control`
  ships as JS inside `@expo/snapback-cli` — a separately versioned npm
  package, not the Rust binary that embeds the guide at compile time —
  round 1 tried to solve "build-matched" by packaging a second, separately
  generated snapshot next to it and comparing commit hashes. That does not
  work: the packaged artifacts are checked-in outputs of a Node script, not
  restamped per Rust build, so their commit deliberately lags the running
  binary's in the ordinary case, and a commit-only comparison can also match
  by coincidence between builds that actually differ (dirty source, distinct
  build profile). **The correct carrier avoids the duplicate copy entirely.**
  `mcp-control` already runs alongside a co-installed native runtime binary —
  `@expo/snapback-runtime-{darwin-arm64,linux-x64,…}` ship as
  `optionalDependencies` of the same package — and that binary already has
  its own build-matched guide surface (`snapback mcp`, reading the
  compile-time-embedded, restamped corpus). `mcp-control` invokes that
  co-installed binary directly for guide content (spawning its stdio guide
  server as a subprocess, or a lighter guide-export subcommand) instead of
  shipping a second copy that could go stale. This makes "build-matched" true
  by construction — there is no independent snapshot left to compare or
  mismatch — for the cold-agent case Phase 5 tests, and it proxies
  `/_snapback/guide` from a running server when one is reachable instead, for
  identical content by a shorter path. If no compatible native binary is
  present for the host platform, `mcp-control` reports guide resources as
  unavailable with a clear diagnostic rather than serving unmatched content —
  "no fake success" applies to documentation, not only to operations. One
  control registration is therefore enough for an operating agent to discover
  both documentation and tools; enabling it remains an intentional choice.

The control MCP server adds a catalog resource and a small search/describe
surface. Direct high-frequency tools remain individually typed so clients can
display accurate read-only/destructive annotations and validate inputs before
invocation. A universal mutation tool is not the primary UX: it would hide
operation-specific risk behind one overpowered annotation.

The CLI may provide `snapback controls invoke` only for catalog rows explicitly
marked `genericInvoke: true`. It reads JSON from stdin or a named file, never a
secret argv value; preserves the operation's exact gate and envelope; and
refuses destructive, authority-widening, human-mediated, internal, unavailable,
or schema-mismatched calls. Common actions still receive named commands.

Every MCP tool and CLI help entry links to the build-matched Guide anchor and
names the catalog digest. Every refusal carries the underlying structured
diagnostic as-is today; wrappers do not replace it with tool-specific prose.
Once LLP 0146 lands a D7 remediation carrier, refusals additionally carry that
projection — this RFC adopts whatever carrier and disclosure rule 0146
settles rather than proposing its own, per §Authority and scope.

### 5. Documentation contract

Add `guide/operating/agent-controls.md` as the intent-first control-plane map
and `guide/operating/network-profiles.md` as the first complete feature page.
The latter includes built-ins, inline JSON, CLI, MCP, environment, admin API,
activation limits, profile observation markers, non-persistence, and the
mandatory restore-to-`normal` step.

The Guide index must present `snapback mcp` and `snapback mcp-control` together:
which is read-only, which can mutate, how to configure each, and why the split
exists. The capability index and surface map derive their projection/status
facts from the catalog while retaining LLP 0061's authored intent language and
witness requirements.

For every `native`, `cliOnly`, or `mcpOnly` operation, the guide contains:

- "I want to…" intents and synonyms;
- the shortest safe CLI example and exact MCP tool name — a `cliOnly` page
  gives its `mcpDeferralReason` instead of an MCP tool name, and a `mcpOnly`
  page gives its `cliDeferralReason` instead of a CLI example;
- input and result examples sourced from verified fixtures;
- target/profile/authority restrictions;
- destructive, persistent, and restart behavior;
- recovery/restore instructions; and
- the distinction between a refusal, target unavailability, and missing
  implementation.

This work immediately corrects the network-profile GAP and hosted-language
drift, the host-operation count/list drift, and the missing control-MCP setup
path.

## Project the shipped long tail

Once the catalog and discovery path exist, add direct native projections in
this order.

### P1: read and diagnose

- **Bounded table scan:** `snapback data scan` and a read-only MCP tool over the
  existing schema-aware admin route, projected as-is: table, limit, and
  offset, matching `DataQuery`'s shipped fields — not a cursor, which the
  route does not have. The projection documents offset paging's known
  limitation under concurrent writes rather than hiding it behind an opaque
  wrapper; a stable/snapshot-bound cursor is a new storage semantic that
  needs an LLP 0031/storage-owner amendment and stays out of this
  pure-projection phase. It enforces row/byte budgets; redacts by response
  policy; and may mint a bounded secret-read lease only from a trusted local
  readiness descriptor. Arbitrary URLs never instruct local credential-file
  reads.
- **Asset list/inspect/retry:** direct MCP projections over existing host
  operations. The already shipped CLI remains the shell path.
- **Config status/plan/verify:** direct non-secret tools. They report missing
  inputs and verification state without ever returning configured values.
- **Cron/job inspection:** list/show plus dry/status projections before
  mutating controls.

### P2: controlled mutations

- **Cron tick/run-one and one-off job drain:** typed CLI/MCP tools with injected
  clock, bounded work, and ordinary receipts.
- **Ephemeral cleanup:** promote from `notAuthorFacing` to a named operator
  maintenance operation with cutoff, dry-run counts, bounded apply, and
  receipt.
- **Connection disconnect:** expose the existing admin-gated route as an
  explicit debug perturbation with target connection, reason, startup nonce,
  and result. It is never presented as application disconnect authority.
- **Config unset:** direct typed CLI/MCP projection of the existing route,
  carrying only an entry identifier; no secret carrier needed because no
  value crosses the wire.
- **Asset delete/GC/key rotation/export/import:** catalog all existing CLI
  paths; add direct MCP tools only with exact destructive annotations,
  preconditions, and approval posture. Tool count alone is not a goal.

### P3: credential and approval handoffs

`config.set` and `config.unset` are both, at Phase 1 backfill, `apiOnly` —
no `snapback config` CLI subcommand exists today, so both are gated HTTP
twins only until this phase lands their projections; the values below are
the post-projection targets, not the Phase 1 starting classification.

`config.unset` carries no secret value — LLP 0036 already specifies its
direct CLI/MCP shape — and is a P2-style controlled mutation: a direct,
`AdminWrite`, `(native, direct)` operation (LLP 0036 specifies a 1:1
`snapback_config_*` MCP mapping alongside the CLI verb, so both projections
land together) taking only the entry identifier, with ordinary
destructive/approval metadata. It does not belong in this phase and is
projected alongside P2, not deferred to P3.

`config.set` genuinely carries a secret value, per §Product contract's
resolution: it is a single, `operability: direct` operation —
`(cliOnly, direct)` for v1, not `(native, direct)`, because no MCP secret
carrier is defined yet. There is no separate `config.secret.acquire` row in
v1; a human entering a value through the existing browser/operator setup
page is not a catalog operation this RFC represents, since the agent is
never in that call chain (§Product contract). An agent's role when a value
is missing is: detect the gap (`config.plan`/`config.status`, already
direct, non-secret tools), point a human at the existing setup flow, and
confirm completion afterward (`config.status`/`config.verify`) — no new
operation needed for that sequence. Promoting `config.set` to `native`
requires a defined, security-owner-approved MCP secret carrier first (not
part of this RFC's v1 scope); adding an agent-trackable acquisition
operation is available if and when LLP 0036's owner ratifies a mechanism for
it.

## Missing controls worth building now

The research distinguished unprojected shipped actions from controls that do
not exist. Three of the missing controls are worth adding in this program
because they close common debugging and acceptance loops. Each needs real
semantics before receiving a console button or agent tool.

### A. Bounded direct row patch — add now

Add an operator `data.patch` operation for an **existing row** in v1. It is not
raw SQL and does not masquerade as an application mutation.

**V1 target rule, stated explicitly rather than left to the open question**:
`devUser` impersonated evaluation is available on any ordinary local
non-production instance; `devAdminBypass` (the "cannot evaluate application
authorization" case) is available only on a local non-production instance or
an LLP 0158 derived instance whose derivation is recognized for this specific
purpose — LLP 0158 today recognizes derived identity "solely for
network-profile activation" (its own text), so patch-bypass eligibility on a
derived instance is a **new** grant this RFC proposes to LLP 0158's owner,
not one that already exists; until that amendment lands, v1 ships
local-non-production-only for both branches and the derived-instance leg is
**target-refused** (carried by `availability.targets`, not the `operability`
field — `data.patch` itself is implemented and works on its permitted
targets, so `operability: unavailable` would misstate it). Hosted-derived is
out of scope for either branch, independent of the "primary hosted/production"
Acceptance refusal, which covers the primary-instance case only.

Required contract:

- target rule as stated above;
- table, stable row identity, closed field patch, expected **per-row**
  version (the row's own version column, not a database-wide counter — a
  concurrent unrelated write elsewhere must not fail an unrelated patch),
  the full authority tuple, and reason;
- a preview that returns the validated before/after diff, affected live-query
  classes, and a short-lived, single-use **apply token** binding target
  identity, startup nonce, catalog/schema identity, table, row identity,
  expected version, the normalized patch, the validated diff, the **actual
  authority tuple as LLP 0024 defines it** — `devUser`'s mode plus its
  impersonated user identity, so two `devUser` previews under different
  impersonated users cannot be substituted at apply time; `devAdminBypass`'s
  mode plus its required reason, which is the whole tuple LLP 0024 defines
  for that mode — and the token's expiry;
- apply requires that exact token; the server validates it, retains exclusive
  ownership while performing the ordinary changeset CAS, and consumes it only
  after that commit succeeds. A failed commit leaves the token available for a
  retry, while serialized ownership prevents two successful applies from
  committing a different patch, version, authority tuple, or target than the
  one previewed;
- normal schema validation, reserved-field protection, ordinary changeset
  commit, journal/version advancement, and live notification;
- the authority tuple is LLP 0024's existing `devUser` (evaluated under the
  application's own authorization, carrying the impersonated identity) or
  `devAdminBypass` (LLP 0024's own explicit local admin bypass with a
  required reason — not "evaluated as if authorized," the opposite: an
  admitted skip, disclosed as such) tuple, projected as-is; this RFC adds no
  new authority mode, and the "operator bypass" language from round 1 is
  retired as a confusing restatement of `devAdminBypass` rather than a
  distinct third thing;
- fail on stale precondition, unknown field, invariant/validator failure,
  missing/expired/mismatched apply token (including a token whose authority
  tuple no longer matches the caller's), or target refusal; and
- structured receipt linking the consumed apply token, catalog digest,
  startup nonce, commit version, the full authority tuple, and reason. The
  receipt names the apply token by a non-authorizing ID/digest, never the
  live token value.

V1 does not insert rows, delete rows, run arbitrary SQL, invoke opaque database
features, or claim to preserve invariants that exist only inside application
handler code. Those can be evaluated separately from evidence.

This implements LLP 0017's existing requirement that direct edits become
ordinary validated changesets with live notification instead of creating a
console-only storage bypass.

### B. Forced live resync — add now

Add `debug.live.forceResync` as a non-production debug perturbation. **V1
targets a single subscription**, fenced by connection id, subscription id
(the same UUIDv7 identity the operator inspect projection already exposes —
no new per-subscription generation is invented; LLP 0095's own
subscription-scoped resync transition requires only `subscription_id`, and
the sessions-artifact `expected_generation` on `LiveSubscription` is a
different thing — an auth-artifact pin, `None` for legacy subscriptions —
that this operation does not reuse or repurpose) plus the startup nonce.
Connection-wide targeting (every subscription on a connection, its own
required-fence shape and concurrent-subscription semantics) is explicitly
deferred, not silently possible — see OQ4 for the narrower question of
whether it should widen later. It records a closed operator/test reason and
explicitly selects the existing resync disposition, including whether
retained data must be cleared.

It emits the normal protocol-owned `resync_required` path and changes no
application data. Target rule matches §A's: local non-production instances
in v1; refused on a primary hosted/production target; refused on a derived
instance too until LLP 0158 grants recognition for this purpose, the same
conditional §A states rather than a bare "derived-only" that would imply the
grant already exists. It is AdminWrite, auditable, and exposed through CLI,
MCP, AdminClient, and console from the same operation. Acceptance proves the
client blanks/degrades and takes a fresh snapshot through the normal
recovery state machine.

This is useful now because it makes a difficult client recovery path directly
testable without corrupting a durable queue or waiting for an incidental
failure.

### C. Administrator ephemeral-entry delete — add now

Add an operator-only delete for a specifically inspected ephemeral entry. It
must be a **different operation and route** from the existing app-data
`/ephemeral/delete`, whose authority is publish-parity and connection-bound.

The operator operation requires collection/room/entry identity, expected
**scope epoch and entry generation together**, reason, and startup nonce. A
room that empties and is recreated within one server startup gets a new
epoch while its entry-version counter restarts at 1, so generation alone is
not fencing-safe — a stale generation observation could otherwise match a
different entry in a reborn room. The server compares both under the room
lock and fails on either mismatch, not generation alone. V1 always operates
as an explicit operator bypass — it does not attempt to evaluate application
authorization the way `data.patch`'s impersonated branch does, since an
ephemeral entry has no durable owner record to evaluate against outside the
live connection that wrote it — and the receipt discloses that plainly rather
than implying an evaluation happened. It uses the store's ordinary
delete/notification mechanics, and fails on a stale epoch or generation.
Target rule matches §A's and §B's: local non-production in v1; refused on a
primary hosted/production target; refused on a derived instance too until
LLP 0158 grants recognition for this purpose. The UI, CLI, MCP, and
AdminClient are projections of that one operation. Acceptance includes a
room-prune/recreate case where the reborn room's entry reuses the old
entry-version number, proving the epoch check — not just the generation
check — is what rejects the stale delete.

This is worth building for stuck-presence repair and deterministic cleanup
tests; conflating it with an app caller deleting its own entry is not.

### D. Simulated publish — do not add as proposed

A privileged operation that writes an arbitrary ephemeral value without a
real connection, grant, caller, heartbeat, TTL lifecycle, and rate policy would
test a world actual clients cannot inhabit. It would also create a second
publish implementation whose success says little about the application path.

The useful replacement is a future scenario-runner step, potentially under LLP
0146 D6, that opens a real test connection, obtains the appropriate dev persona
or grant, publishes through the normal app-data operation, observes the normal
frames, and tears down with a receipt. That higher-level helper has legs; a raw
admin "pretend someone published" endpoint does not. Until that contract is
designed, simulated publish remains `unavailable` with this explanation.

Raw SQL over **application** data remains declined for the same portability
and safety reasons LLP 0017 already records. This does not reach the shipped
local-only, read-only SQL hatch over telemetry visibility views
(`crates/snapback/src/cli.rs`'s bounded `max_rows`/`max_steps`/`max_time_ms`/`max_bytes`
surface) — that operation gets its own catalog row like any other CLI
command; it is not the arbitrary-SQL-over-application-data this section and
§Non-goals decline.

## Delivery plan

### Phase 0 — repair truth and entry points

1. Correct the host-ops inventory and generate its counts — including the
   in-code `SERVED_HOST_OPS`/`CLI_ONLY_HOST_OPS`/`PINNED_UNBUILT_HOST_OPS`
   allowlists in `crates/snapback/src/host_ops.rs`, not only the guide prose; asset and
   network-profile identities belong in that allowlist today and currently
   fall through to `"unrecognized"` in diagnostics. `CLI_ONLY_HOST_OPS` also
   asserted CLI ownership of `host.restart` before a CLI command existed at
   the RFC snapshot — correct both the allowlist comment and the
   `SNAPBACK_HOST_OP_CLI_ONLY` diagnostic text callers actually receive.
   Phase 2 subsequently made that ownership literal by shipping
   `snapback restart` (§Design/2).
2. Correct the network-profile capability/hosted wording and add the
   dedicated page — this resolves LLP 0167's open OQ5 (ship a guide page now
   rather than a GAP row) in the direction 0167's own text leans, and should
   record that resolution back into 0167 rather than only acting on it here.
3. Document `mcp` versus `mcp-control` at the Guide entry and ship
   `snapback agent setup --print` for the major clients.
4. Add intent-retrieval cases for latency, table inspection, cron tick, job
   drain, ephemeral cleanup, connection disconnect, and config verification.
5. First-pass inventory of the Cloudflare gateway's actual hand-routed
   system/control paths (§Design/3a) — no current document enumerates them
   completely, the same gap Phase 0 is already repairing for the local
   host-ops counts.

This phase is useful independently and should land first.

### Phase 1 — catalog and parity gate

1. Define `ControlCatalogV1` and its JSON Schema, including the
   `composedFrom` field (§Design/2) and the hosted-adapter manifest shape
   (§Design/3a).
2. Export/join route, host-operation, CLI, MCP, AdminClient, console, and Guide
   declarations without duplicating their semantic authorities.
3. Author the Cloudflare gateway's hosted-adapter manifest (hand-maintained,
   per §Design/3a), generate catalog rows from it, and
   enforce manifest-entry ↔ catalog-row completeness at generation time with
   a negative fixture (rule 11) — the fifth domain leg, alongside the
   Rust/JS join. The 2026-08-08 correction adds CI extraction for the bounded
   named declarations and exact-path literals; other imperative routing forms
   remain an LLP 0016 audit obligation.
4. Serve the build catalog and instance availability projection with identity;
   add CLI and MCP search/describe resources.
5. Generate the mechanical Guide tables and fail CI on every incomplete join.
6. Backfill every current operation with explicit `surfaceAccess` and `operability` values.

### Phase 2 — project shipped operations

Land P1 read/diagnose tools, then P2 controlled mutations. Each vertical slice
includes the registry/catalog row, CLI/MCP projection required by its
disposition, guide snippet, exact authority tests, and cold-agent witness.

Includes the **`host.restart` vertical slice**: gate the MCP path's stop/
start composition behind the same admin-credential proof the HTTP path
already requires, closing §Design/2's disclosed, temporary "no projection
creates authority" exception. Landing this also removes `host.restart`'s
`cliDeferralReason` as a permanent fixture if a `snapback restart` CLI
command lands alongside it (§Design/2, §Product contract) — either way, the
row's authority story matches its HTTP sibling by the end of this phase.

**Implemented 2026-08-06; authority path strengthened 2026-08-26.** Both the
MCP gate and native CLI composition prove a concrete administrator credential.
Native CLI restart invokes authenticated server-owned `host.stop`; that server
validates the supplied startup nonce against its own boot identity before
requesting its own graceful shutdown. The caller validates the typed success
envelope and declared lifecycle authority, records configured-URL health loss,
and requires the descriptor-named, pre-stop PID/start-time identity observably
gone before launching with the recorded `serverProfile`. MCP restart retains
its authenticated `app.inspect` proof and the same authenticated self-stop
request. For an attached server it delegates to native PID/start-time
observation; for the child MCP itself started, it instead requires the
descriptor PID to match its owned child handle and asynchronously reaps that
child before starting the successor. The three-field stop observation records
`credentialedHostOpResultAccepted`, `configuredUrlStoppedAnswering`, and
`processIdentityVerified`; the last field claims only the
ownership-appropriate, unforgeable process-exit observation. It contains no
PID, `verifiedBy`, or HTTP responder-identity claim. `host.restart` is
`native`, has no `cliDeferralReason`, and returns one request id/envelope in
either projection.

### Phase 3 — build the selected missing controls

Implement `data.patch`, `debug.live.forceResync`, and the distinct operator
ephemeral-entry delete in that order. Amend the semantic owner documents as
needed rather than treating this cross-surface RFC as sufficient authority for
their wire/storage details.

### Phase 4 — mediated secrets and real-client scenarios

Qualify secret-safe config carriers and resumable human handoffs. Then design
the real-connection ephemeral scenario step if acceptance evidence still shows
demand. Do not block the catalog or safe projections on this phase.

### Phase 5 — external cold-agent qualification

Run the evaluation from outside the Snapback source tree against a packaged
build. The agent receives only the normal CLI plus the generated MCP setup; it
must not rely on repository source, remembered commands, or browser clicking.

## Acceptance

The RFC is implemented only when all of the following hold:

- A checker fails when a console `app.contract` action, a bootstrap/setup-page
  admin call, a registry entry or route inside the catalog's domain, a
  CLI-only-declared local operation, a hosted-adapter manifest entry, a CLI
  command, an MCP tool, a public `AdminClient` operation, or a Guide control
  row lacks a coherent catalog join or an explicit `uiLocal`/`internal`
  marker with a reason — and fails when an out-of-domain (`SystemStatic` or
  ordinary `AppData`) route is cataloged at all. The hosted-adapter manifest
  is checked against the current bounded `gateway.js` source literals (rule
  11). Arbitrary new imperative prefix/catch-all forms outside the extracted
  seams remain an audited rather than CI-enforced gap.
- All catalog entries have exactly one `surfaceAccess` value, exactly one
  `operability` value, and a governing authority. `internal`/`unavailable`
  entries have reasons; `native` entries have every required projection and
  witness; `cliOnly`/`mcpOnly` entries have the matching deferral reason.
  Every `destructive: true` entry has a non-null `approvalPosture`,
  independent of both axes. No row with `CredentialSecret` response
  sensitivity or `ImpersonationCapability` effect is promoted to `native`/
  `cliOnly`/`mcpOnly` by usage-evidence threshold alone.
- Counts and projection tables in the Guide are generated. Adding an operation
  cannot leave a stale prose total.
- From a fresh MCP registration, an external agent discovers the network
  profile tools, sets `demo-slow`, observes the documented HTTP profile
  marker (the shipped observation surface; the deferred socket/poll marker
  ticket is not part of this criterion) and delayed behavior, restores
  `normal`, and explains restart persistence correctly without source search
  or browser use.
- From CLI alone and MCP alone, an agent can perform the admitted table-scan
  (offset paging, as shipped), asset-inspection, cron/job, cleanup, and
  connection-disconnect journeys with structured envelopes and exact target
  refusals.
- `data.patch` preview issues a single-use apply token; apply without that
  exact token, or with a mismatched patch/per-row-version/target/authority
  tuple, fails; a normal validated commit follows only on a matching token; a
  stale precondition is rejected; a live query is notified; and LLP 0024's
  actual authority tuple (`devUser` plus impersonated identity, or
  `devAdminBypass` plus its required reason — LLP 0024 defines no operator
  principal for `devAdminBypass`, and this RFC does not invent one) is
  disclosed on the receipt by non-authorizing token ID, never the live token
  value. It is refused on a primary hosted/production target and on a
  derived instance until LLP 0158
  grants that recognition.
- Forced resync (single-subscription, per v1 scope) drives an actual client
  through the protocol's existing resync-required/re-snapshot lifecycle
  without changing durable application data.
- Operator ephemeral deletion is fenced on **both** scope epoch and entry
  generation, not reachable through the app-data delete authority, and
  produces the ordinary subscriber observation; a room-prune/recreate case
  proves a reused entry-version number in a new epoch is still rejected.
- There is no raw simulated-publish backdoor. A later scenario helper, if
  built, proves it used a real connection and normal publish authority.
- Config plan/status/verify can be completed by an agent, while secret values
  are absent from argv, environment echo, MCP results, diagnostics, logs,
  receipts, screenshots, and catalog fixtures. `config.set` writes a value
  the caller already holds via stdin/fd; human entry through the existing
  setup page needs no agent-facing handoff row, and an agent can detect
  completion via `config.status`/`config.verify` afterward.
- Every direct MCP tool has accurate read-only/destructive/idempotent/open-world
  annotations, and every structured refusal preserves the subsystem
  diagnostic; once LLP 0146 D7 lands, refusals additionally carry its typed
  remediation projection (not a prerequisite for this RFC's own Implemented
  status, per §Authority and scope).
- A build/instance catalog identity mismatch fails closed. Discovery
  availability is advisory; invocation admission — a runtime check at call
  time, not inferred from static tool or projection presence — is the
  authoritative check in every direct tool.
- The LLP 0061 cold-agent retrieval eval finds the exact guide section and
  shortest safe command/tool for the representative intents without popular
  wrong guesses being added as unsafe aliases.

## Security and ergonomics invariants

- **No projection creates authority.** CLI, MCP, AdminClient, and console call
  the same gate and return the same result semantics. The former named,
  temporary lifecycle exception is closed: native CLI and MCP restart both
  require a concrete credential at the live host-ops gate. Native CLI uses
  authenticated server-owned `host.stop` and accepts only its exact typed
  operation/target/declared-authority/self-stop result, records configured-URL
  health loss, and grants success only after the ownership-appropriate process
  observation. Native and attached MCP paths require the descriptor-named,
  pre-stop PID/start-time identity observably gone. Manager-owned MCP requires
  the descriptor PID to match its unforgeable child handle and asynchronously
  reaps that exact child. No projection signals a descriptor-named PID
  (§Design/2). This does not claim mutual server or HTTP responder
  authentication: the same-UID trust domain can reproduce the descriptor,
  credential carrier, and responder. `processIdentityVerified` claims only the
  separately observed, ownership-bound process exit.
- **No secret in convenience channels.** Argv, ordinary MCP parameters/results,
  catalog examples, logs, and receipts are not secret carriers.
- **No browser automation as API.** Agents use headless operations; a browser is
  reserved for presentation, secret entry, or real human approval.
- **No hidden target optimism.** Tool presence means "this build knows the
  operation," not "this instance permits it."
- **No generic-invoker escape hatch.** Generic invocation is allowlisted to
  safe catalog entries and cannot reach mediated, destructive, internal, or
  unavailable operations.
- **No app-data/control-plane collapse.** Application calls and operator
  controls retain distinct namespaces, credentials, and audits.
- **No fake success.** Designed-but-unbuilt capabilities return their pinned
  unavailability diagnostic.
- **Ergonomics include cleanup.** Perturbations have an obvious restore path;
  destructive actions have preview/preconditions; long work has receipts;
  refusals say what can safely happen next.

## Non-goals

- Exposing every internal maintenance route as a public tool.
- Weakening admin, secret-read, impersonation, hosted, production, or derived-
  instance gates.
- Merging the resource-only and control MCP authority postures; the control
  server may re-serve read-only resources, but enabling tools remains explicit.
- Replacing named common tools with one opaque universal executor.
- Treating an MCP configuration file as an admin credential.
- Adding arbitrary SQL, arbitrary server-side JavaScript, or arbitrary
  application-policy bypass.
- Making human approval or secret custody disappear.
- Claiming that catalog generation implements a missing operation.
- Building a hosted multi-tenant control plane; LLP 0009 and target-specific
  authorities still govern that work.

## Risks and mitigations

**The catalog becomes a second authority.** Mitigate by generating a closed
join from existing registries, carrying source provenance, refusing conflicts,
and forbidding the catalog compiler from relaxing policy.

**MCP discoverability silently broadens power.** Keep the read-only server,
make control registration explicit, preserve per-operation gates, and show the
requested server/config before installation.

**Tool explosion harms rather than helps.** Give common operations direct
typed tools; make the long tail searchable and typed through the catalog; use
`apiOnly` deliberately; add tools from task evidence, not one per route by reflex.

**Direct editing damages application invariants.** Restrict v1 to existing-row
patches on local non-production instances (derived-instance bypass pending an
LLP 0158 grant, per §A), require preview/CAS/schema validation, commit
normally, disclose bypass, and never imply handler-only invariants were
executed.

**Debug perturbations escape into production.** Reuse the LLP 0167 pattern:
one fail-closed activation chokepoint, explicit target classification,
provenance, visible active state, and stable refusal codes.

**Static tool metadata lies about runtime availability.** Bind catalog and
instance projections by digest/startup nonce and require a runtime admission
check at invocation.

**A human handoff strands the agent.** Require bounded status, expiry,
cancellation, and resume semantics; a browser URL by itself is not a handoff
contract.

## Open questions

1. **Compiler seam.** Should the checked join be built by exporting Rust
   registry facts into a neutral artifact and joining JS projections, or by a
   build-time coordinator that consumes both directly? The deciding criterion
   is one cheap deterministic local-proof path without parsing source text for
   semantic facts.
2. **`apiOnly` graduation evidence.** What repeated-task threshold should require a
   specialist API operation to gain direct CLI and MCP projections? Diaries and
   cold-agent traces should inform this rather than a speculative number.
3. **Direct patch authority — widening, not the v1 default.** §A now fixes
   the v1 default explicitly: `devAdminBypass` is local-non-production-only
   until LLP 0158's owner grants derived-instance recognition for this
   purpose (`devUser` impersonated evaluation is available on any ordinary
   local non-production instance already, with no derived-instance question
   attached to it). Open: once that amendment exists, should `devAdminBypass`
   widen to a derived instance, and what additional evidence or approval
   gates that widening?
4. **Forced-resync targeting — widening, not the v1 default.** §B already
   fixes v1 at single-subscription targeting. Open: does a concrete
   whole-connection acceptance case justify adding connection-wide targeting
   later, and what request/generation shape would it need beyond the
   per-subscription one v1 ships?
5. **Destructive-tool approval mechanism.** Which client-visible approval
   mechanism is portable enough to satisfy `approvalPosture: humanApprovalRequired`
   for destructive direct tools? This no longer bears on `surfaceAccess` or
   `operability` — both are independent of `approvalPosture` (§Product
   contract) — so an unresolved answer here does not block a destructive
   operation from being `native`, `cliOnly`, or `mcpOnly`; it only leaves
   `approvalPosture` provisionally at `confirmFirst` until a stronger
   mechanism is proven.

## Recommended decision

Accept the completeness model and start Phase 0 immediately. The current
network-profile implementation proves Snapback already has the right semantic
architecture; the urgent gap is that an agent should not need source search or
prior memory to find it. Build the catalog/parity gate before adding many more
admin controls, then use it to land the shipped long-tail projections and the
three selected missing debugging operations without creating new click-only or
policy-bypassing paths.

## Delivery record (2026-08-06)

The full delivery plan landed on `main` across 2026-08-05/06, driven by two
coordinated orchestrator sessions (lane ownership recorded in the closed
`issues/20260806-llp0184-lane-coordination.md`).

- **Phase 0** (2026-08-05): truth repairs, network-profile page, `snapback
  agent setup`, intent-retrieval seeds, Cloudflare gateway inventory.
- **Phase 1**: items 1–3+6 at `650121612`; items 4–5 at `0b5c11c64` — served
  `GET /_snapback/api/control-catalog{,/instance,/operations/{operation}}`
  (digest-bound build/instance identities), offline `snapback controls
  list|describe`, `snapback-controls://` MCP resources with the co-installed
  native binary serving build-matched Guide bytes and typed
  unavailable-binary diagnostics, and rule-9 generated Guide tables with
  drift enforcement.
- **Phase 2**: P1+P2 at `fb2756117`/`d1a2765da`; P1 regression coverage at
  `bf2c4a5b5`; residue at `7027c6aea` (honest read-only `cron.list` with
  dated LLP 0024/0028 amendments), `69136b5ac` (`ephemeral.cleanup`
  cutoff/dry-run/bounded-apply/receipt semantics), `251367f3d`
  (credential-proven `snapback restart`; §Design/2's named temporary
  authority exception is closed — strengthened 2026-08-26 so native CLI
  restart and direct stop use authenticated, startup-fenced, server-owned
  shutdown; the caller never signals a descriptor-named PID and uses it only
  for identity-bound existence observation).
- **Phase 3**: §A `data.patch` at `42ce63d93..480ac704d` (single-use
  apply-token binding incl. authority tuple, per-row CAS, ordinary changeset
  + live notification, non-authorizing receipt token id;
  `crates/snapback/tests/data_patch_v1.rs`); §B at `57aa150db`
  (single-subscription forced resync driving a real client through
  `resync_required`/re-snapshot; `demos/_kit/tests/llp0184-force-live-resync.mjs`);
  §C at `d6bb5e69f` (operator ephemeral-entry delete fenced on scope epoch
  AND entry generation under the room lock;
  `operator_delete_rejects_old_epoch_when_reborn_room_reuses_generation_one`
  is the required reborn-room case).
- **Phase 4**: `88c1344d6` (`config.set` stdin/fd carrier, `(cliOnly,
  direct)`, leak-negative witnesses across stdout/stderr/receipts/logs on
  success and failure paths), `cc7507891` (rule-6 `mediatedHandoff`
  plan/initiate/status/resume/protected-artifact fields required by the
  schema for every mediated row, with admin-link and device-approval custody
  witnesses), `817bd19a5` (scenario helper honestly deferred; no simulated
  publish exists).
- **Phase 5**: packaged-build evaluation against the staged npm closure
  (dry-run publish ledger, tarball install into an external app directory,
  `snapback new` scaffold). The first run immediately caught a real
  packaged-build defect — the darwin runtime seal recorded the framework's
  symlinked spelling, which npm installs cannot preserve, so every sealed
  darwin package failed load verification — fixed at `0773b75b4`/`f0de17ff4`
  (seal binds the dyld-resolved `Versions/1/hermesvm` artifact; publisher
  re-verifies each extracted tarball; closed
  `issues/closed/20260806-darwin-runtime-seal-npm-symlink-drift.md`). Two
  cold codex sessions then passed 8/8 operator journeys each: one CLI/HTTP
  (discovery via the served Guide and catalog endpoints, `demo-slow`
  set/observe/restore with the restart-persistence answer sourced from
  docs), one MCP-only from a fresh `agent setup` registration (tool
  annotations honored, dry-run-only on destructive tools, data-patch
  preview with redacted apply token). The strict CLI-alone journey set
  (data scan, assets, cron, jobs, cleanup dry-run, disconnect) returns
  structured envelopes on the packaged binary.

**Classification residue**: `storage.protected-erasure` and
`storage.operation-coverage.activate` remain on the designed fail-closed
default pending storage-owner judgment
(`issues/20260806-llp0184-storage-rows-await-owner-classification.md`); the
`branch.*.v1` family and `operations.explain` received authored
classifications in this record's commit. The LLP 0146 D7 remediation
projection remains conditional on 0146, per §Authority and scope. The
diagnostic-inventory drift the program introduced (28 new `SNAPBACK_*`
codes) was classified at `ec5859b7b`.

2026-08-06: LLP 0146's OQ6-independent served-generation suggestion substrate
and data-only draft kind registry landed; this catalog's `remediation` field
remains `null`/absent until the LLP 0094/0095-owned carrier and registry
question is ruled.

## Dated amendment: discovery completeness and projection repair (2026-08-08)

The Rule 3–5 completeness bar now applies to the catalog compiler itself, not
only to review prose. Every invocable row must carry a non-operation title,
non-empty agent-task intents, and a Guide path or heading that exists in the
checked `guide/` tree. An `apiOnly` row must additionally name a complete Guide
recipe heading or an explicit authored CLI deferral. The worked-example task
phrases “slow network,” “upload,” “reset the database,” and “mint session” are
all retrieval fixtures in the authored discovery backfill.

The packaged wrapper's `PACKAGED_CLI_COMMANDS` registry is a Rule 3 owner too.
Every packaged root verb must have a `cli-only-operations.json` row or an
explicit authored deferral, and the generator rejects either an uncovered verb
or a declaration for a verb the package no longer ships. `acceptance.run`
remains an honestly unbuilt host-op pin; its discovery metadata points to the
actually shipped `snapback verify` done oracle rather than presenting the pin
as an executable command.

Two stale CLI facts are repaired. `host.restart` projects `snapback restart
--ready-file <path>`, and HTTP refusal prose derives that spelling from the
embedded catalog instead of maintaining a second copy. `auth.mintSession`
projects `snapback session mint --email <address>` as `cliOnly`: the session
credential may reach the operator's terminal, while the ordinary MCP result
channel remains explicitly deferred as a secret carrier. Both rows carry
agent-task intents and the host-operations Guide acquisition path.

Failed `hostOpsResult` envelopes now populate the existing `next[]` carrier
mechanically from the same row's Guide anchor and non-null CLI projection. This
is an acquisition-path projection only; it creates no authority and does not
rule LLP 0146 OQ6's separate question about contextual, machine-applicable
remediation objects.

## Dated amendment: ruled remediation projection (2026-08-10)

LLP 0146 OQ6 is now ruled. Every build-catalog row projects the same descriptor:
carrier `diagnostic.details.remediationSet`, schema version
`snapback.remediation-set.v1`, registry version
`snapback.remediation-kinds.v1`, and decoder
`@expo/snapback-client/remediation`. The compiler imports that descriptor from
the shared client decoder module; it does not copy a remediation-kind enum or
derive kinds from a refusal code. Contextual items remain constructed only by
the authorization-aware refusal site and pass through CLI, HTTP, MCP, and
hosted result envelopes unchanged. The build-catalog descriptor is discovery
metadata, not an offer and not invocation authority.
