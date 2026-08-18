# LLP 0079: Serverpod course corrections — execution plan

**Type:** Plan
**Status:** Implemented
**Systems:** Developer experience, Dev loop, MCP, Storage, Schema, Sync, Wire protocol
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Revised:** 2026-08-03 (Status Draft → Implemented, accepted 2026-08-03 by the author — decision sitting #2, "accept all that verify", `issues/20260803-author-decision-sitting-2.md`. Verified against the status board: all seven SC items landed 2026-07-23, including SC-1b's same-day ENG-25388 registry follow-up and Charlie's SC-3 LLP 0037 ratification; the two §Open questions were settled by the landings themselves — SC-1a took the inspect-extension path with no LLP 0024 change, and SC-1b packaged as `snapback mcp-control` inside the CLI.) 2026-07-23 (round-2 cross-family review revisions — Fable READY / Codex NOT READY; fixes applied after the round, unreviewed: work-item count corrected to seven with an explicit R→SC mapping; SC-1a's diagnostics fork made explicit — extend `snapback_inspect`/`app.inspect` vs a new LLP 0024-owned operation — with LLP 0024 added as conditional owner; SC-2b's first surface pinned to the SC-2a-migrated Contract demo (not "Vite/React first") with a minimum interactive/machine-readable verb slice in acceptance; SC-5's `FieldType` pin corrected for the data-bearing `Id` variant and the guard tagged plan-added; SC-1b now requires the packaging/catalog decisions recorded in LLP 0042 before landing). Same day, round-1 cross-family review revisions: SC-2 split into SC-2a/SC-2b with the LLP 0030 MVP plugin named as unbuilt prerequisite scope; SC-1a/SC-1b deferral-vs-acceptance inconsistency closed with a non-deferrable diagnostics minimum; SC-1b's tool-set scope pinned to LLP 0042's eight-tool slice, not LLP 0024's full table; SC-5 rebuilt as a semantic pin plus a narrow dependency guard; SC-3 item 3 reframed against what LLP 0008/0012 already state; SC-4 candidates tagged plan-added with a real-Postgres criterion; summary arithmetic and Related header corrected — see `llp/reviews/0079-serverpod-course-corrections.{fable,codex}.md` round 1)
**Related:** LLP 0078, LLP 0000, LLP 0003, LLP 0007, LLP 0008, LLP 0010, LLP 0012, LLP 0024, LLP 0030, LLP 0037, LLP 0041, LLP 0042, LLP 0046

## Summary

[LLP 0078](./0078-serverpod-lessons.research.md) (the Serverpod research pass
and same-day repo audit) produced seven recommendations. One needs no action:
R7 validates the auth program as-is, and its cross-validation record lives in
LLP 0078 F2b itself — no LLP 0057–0060 amendment is made. (Separately, audit
finding A2 validated the DSL/serialization posture with nothing to change;
that was an audit result, not one of the seven recommendations.) The remaining
six recommendations divide into seven concrete work items across four tracks:
R1→SC-2a/SC-2b, R2→SC-3 item 2, R3→SC-1a/SC-1b, R4→SC-4, R5→SC-3 item 1 plus
SC-5, R6→SC-3 item 3. (SC-5's enforcement mechanism and SC-1a's non-deferrable
diagnostics minimum are plan-added execution decisions beyond what LLP 0078's
recommendations literally state; they are tagged as such in place.)
This plan is the ticket list for those items: each has an owner document, a
size, dependencies, and acceptance criteria an agent can check. Work items are
numbered `SC-n` (Serverpod correction); statuses are tracked in the table
below and updated in place as items land.

This plan deliberately does **not** restate the research or the audit
evidence. LLP 0078 is the source for *why*; this document is only *what, in
which order, and how we know it's done*.

## Status board

| Item | Title | Owner doc(s) | Size | Status |
| --- | --- | --- | --- | --- |
| SC-1a | MCP verb-scope amendment | LLP 0042 (+ LLP 0024 if a new operation is added) | S (docs) | Landed 2026-07-23 (inspect-extension path; no LLP 0024 change needed) |
| SC-1b | Control-plane MCP server build | LLP 0042 | L (code) | Landed 2026-07-23 (`snapback mcp-control`; ENG-25388 registry follow-up resolved same day) |
| SC-2a | LLP 0030 MVP managed-dev Vite plugin | LLP 0030 | L (code) | Landed 2026-07-23 (`@snapback/vite`; todo Contract demo migrated) |
| SC-2b | Dev-loop client-arm wiring | LLP 0041, LLP 0030 | M (code) | Landed 2026-07-23 (`snapback dev --client` + verb slice; Exact seam defined in LLP 0041) |
| SC-3 | Doc-batch: constraints made standing | LLP 0037, LLP 0041/0003, LLP 0008/0012 | S (docs) | Landed 2026-07-23 (LLP 0037 amendment ratified by Charlie 2026-07-23) |
| SC-4 | Embedded-Postgres option in LLP 0046 | LLP 0046, LLP 0007 | S (docs) | Landed 2026-07-23 |
| SC-5 | Name-keying guard: semantic pin + dependency check | LLP 0037 | S–M (code) | Landed 2026-07-23 (`crates/snapback/tests/name_keying_guard.rs`) |

## Work items

### SC-1a. Amend LLP 0042's verb scope (from LLP 0078 R3)

LLP 0042's selected first slice covers lifecycle and schema/function load but
omits the agent verbs a competitor ships today. Amend the Draft RFC to add:

- **Log/diagnostics reading** — a read-only projection of server diagnostics
  and recent invocation logs through the MCP surface, consistent with the
  machine-readable diagnostics LLP 0010 already requires. The amendment's
  first decision is *where this lands*: either as an extension of the
  already-selected `snapback_inspect`/`app.inspect` (whose pinned result
  envelope already includes recent diagnostics per LLP 0024), or as a new
  operation — and LLP 0024 owns control-plane tool names and operation-id
  mappings, so a new operation means an LLP 0024 table amendment (tool name,
  operation id, arguments, result shape, authority) that LLP 0042 then
  adopts, not a 0042-local invention. **This capability is not deferrable**,
  because SC-1b's acceptance loop depends on it; the amendment may scope it
  down to a minimum surface (a bounded recent-invocations ring buffer — a
  plan-added execution decision; see open question 1) but must specify at
  least that minimum.
- **Acceptance-suite execution** — un-omit `snapback_acceptance_run`
  (`acceptance.run`), which LLP 0024's pinned MCP table already carries but
  LLP 0042's eight-tool slice leaves out. May be explicitly deferred with a
  named reason; if deferred, SC-1b's acceptance excludes it.
- **Client-surface driving/screenshots** — named explicitly as an
  **Exact-side seam**, not a Snapback tool: record the boundary and what
  Snapback must expose for the Exact side to implement it, so the gap is a
  documented seam rather than silence. This item is documentation only and
  never enters SC-1b's callable-tool acceptance.

**Acceptance:** LLP 0042 revision lands with the three additions handled as
specified above (diagnostics specified at least to its minimum; acceptance
execution specified or deferred with a named reason; the Exact seam
documented); `ref-check` passes.

### SC-1b. Build the LLP 0042 control-plane MCP server (from LLP 0078 R3, A4)

The largest competitive gap LLP 0078 surfaced: none of LLP 0042 is
implemented — the only MCP server in the repo is the read-only guide
projection (`crates/snapback/src/guide_mcp.rs`). Build the control-plane server per the
amended RFC, reusing the CLI's existing process-lifecycle logic
(`--ready-file` spawn, `HostReadyDescriptor` consumption, nonce-verified
stop) rather than proxying HTTP, as the RFC already specifies.

Scope precisely: the buildable tool set is **LLP 0042's selected slice**
(eight of LLP 0024's twelve pinned MCP tools) **plus whatever SC-1a specifies
as non-deferred**. The remaining LLP 0024 table entries
(`snapback_reload_schema`, `snapback_reload_functions`, `snapback_explain`,
and `snapback_acceptance_run` if deferred) may be exposed only if they return
the structured `SNAPBACK_HOST_OP_UNIMPLEMENTED` diagnostic, per the RFC. The
Exact-side driving seam (SC-1a bullet 3) is out of callable scope by
construction.

Two LLP 0042 open questions land on this item's executor on day one and are
implementation-owned decisions: packaging (inside the `snapback` CLI vs a
separate `@snapback/mcp` package — including whether the guide server's
stdio transport in `crates/snapback/src/guide_mcp.rs` is the substrate or the control-plane
server is separate) and static-vs-served app-data catalogs. The discretion
is intentional, but not silent: whichever way each is decided, the decision
must be recorded in LLP 0042 as a dated amendment before this item lands.
`snapback_stop` target resolution in multi-root workspaces must follow
whatever the amended RFC says. Note also that SC-1a's diagnostics minimum
includes its **server-side surface** (the bounded ring buffer and the
operation that exposes it — no existing host-op fully covers it), not just
the MCP projection; this item's L size includes that work.

**Depends on:** SC-1a (build against the amended scope, not the stale one).
**Coordination:** touches the same CLI process-lifecycle code as SC-2a/SC-2b
(`packages/snapback-cli/index.mjs`); check for in-flight work on the other
track before landing (this repo runs concurrent sessions).

**Acceptance:** the in-scope tool set defined above is callable by a real MCP
client against a local server; out-of-slice LLP 0024 tools, if present,
return `SNAPBACK_HOST_OP_UNIMPLEMENTED`; the generated app-data catalog
exposes query tools by default and mutation tools only with an explicit
authority tuple; an acceptance test drives the full loop (start → load
schema/functions → run function → read diagnostics → stop) through MCP
alone, where "read diagnostics" exercises at least SC-1a's non-deferrable
minimum surface; the packaging and catalog-delivery decisions are recorded
in LLP 0042; the test runs in the local proof
(`scripts/verify-local-proof`).

### SC-2a. Build the LLP 0030 MVP managed-dev Vite plugin (from LLP 0078 R1)

The `@snapback/vite` plugin **does not exist yet** — there is no Vite plugin
package under `packages/` (`packages/snapback-contract/build-preset.mjs` is
an existing build/dev-proxy preset with Vite dev diagnostics and
proxy-config plugins, but not the LLP 0030 managed-lifecycle plugin) — and
LLP 0030 §Status names the MVP plugin as the immediate next step, with
codegen/watch wiring explicitly gated behind it. That prerequisite is this item, sized
honestly at L: the plugin carries a security-sensitive lifecycle and proxy
surface whose decisions LLP 0030 has already settled and which must not be
re-derived casually.

Scope is LLP 0030's own MVP: readiness handshake (consume the
`HostReadyDescriptor` ready-file the host already ships), mode-aware
lifecycle (LLP 0030's full mode set, with destructive reset/seed allowed by
default only for a plugin-spawned managed child), the `/__snapback`
app-route proxy with an explicit allowlist (admin and system routes
unreachable), structured diagnostics, and migration of one existing
Contract demo off manual proxy config.

**Acceptance:** LLP 0030's validation requirements for the MVP hold — one
command starts Vite and attaches to or spawns the correct backend; the proxy
allowlist demonstrably excludes the reserved system/admin surfaces
(following LLP 0030's validation list *as it stands*, noting that the
ungated root `/admin/*` aliases were retired per LLP 0031/LLP 0032 S1 and
that 0030's allowlist-vs-reserved-prefix timing question is still open —
the tests should target routes the server actually serves); one Contract
demo runs migrated end-to-end; the demo's diary records the build
experience per repo policy.

### SC-2b. Wire the client arm into the dev-loop watch process (from LLP 0078 R1, A3)

`snapback dev` already watches, regenerates, and hot-pushes into the running
server with honest load states. The delta to the full-stack bar is
orchestration breadth: one command that also runs a client surface in the
same watch process. Scope per LLP 0041's existing seam: the CLI owns
watch/codegen orchestration; the SC-2a plugin owns the frontend dev-server
integration — this item wires them together (LLP 0030 implementation-plan
step 9, which 0030 gates behind the SC-2a lifecycle/proxy work) and surfaces
the loop's verbs both interactively and machine-readably.

The first client surface is **the Contract demo SC-2a migrated**, served
through the SC-2a plugin — decided here by sequencing, and consistent with
the Contract-first principle (LLP 0000): the arm is Contract-on-Vite, not
React-first. Generic React serving through the same plugin comes later, per
LLP 0030. The same LLP 0041 revision must also define the Exact-side seam
for a native Contract/Exact client arm, even though its implementation is
not part of this item.

The loop's verbs, minimally: **status/inspect**, **force
regenerate-and-reload**, and **restart backend**. Each must be invocable
interactively (keystroke or equivalent in the running watch process) and
observable/invocable through a machine-readable channel; anything beyond
that minimum may be deferred with a named reason. Reassess the M size once
this verb slice is confirmed at execution time.

**Depends on:** SC-2a.
**Coordination:** same CLI-lifecycle code as SC-1b; see SC-1b's note.

**Acceptance:** from one command, an edit to `schema.mjs` or `functions.mjs`
is observable in the running SC-2a-migrated Contract demo surface without
restarting either process; the `generated-but-not-loaded` and
`generation-failed` states are surfaced to both the human and a
machine-readable channel; the minimum verb slice (status, force
regenerate-and-reload, restart) is exercised by a test through the
machine-readable channel and demonstrated interactively; LLP 0041's
acceptance section is updated to include the client-arm criterion and the
Exact-side seam definition.

### SC-3. Doc batch: make three validated constraints standing rules (from LLP 0078 R2, R5, R6)

Three properties the audit found true-but-emergent (or normative-but-
under-argued) become stated constraints in their owner documents. One batch
item because each is a small, independent doc amendment — but note the owner
documents differ in status (LLP 0037 is Accepted; the others are Draft), so
each amendment carries its own review obligation:

1. **LLP 0037 (schema source of truth):** no Snapback-owned persisted or
   wire encoding may depend on declaration order surviving edits —
   enum-like values, fields, columns, and variant tags stay name-keyed;
   any future by-index encoding is an explicit decision with a named
   reason. LLP 0037 states nothing like this today; this is a new
   constraint in an Accepted Decision document and follows its
   ratification path. (Enforcement is SC-5.)
2. **LLP 0041 (with a pointer from LLP 0003):** the dev-loop hot-push is
   artifact load, not data migration. If hot-apply ever grows into
   data-bearing schema migration of a running system, each applied
   migration must be a versioned commit the sync and
   read-set-validation machinery sees — never a side-channel mutation —
   and it stays a dev-target affordance until a production migration
   story is separately accepted.
3. **LLP 0008 and LLP 0012:** the additive-wire discipline is *already*
   normative in both documents (LLP 0008 §Decision DK-3 pins `live_delta`
   as strictly additive beside `live_replace`; LLP 0012 requires future
   transport lanes to be additive). The amendment here is narrower than a
   new rule: (a) attach a dated rationale note citing LLP 0078 F2a/F2e as
   external evidence — a competitor's deprecated first design and
   breaking-change tax — for why the existing rules must not be relaxed
   under delivery pressure; and (b) add the one normative sentence that is
   genuinely missing: an explicit app-facing prohibition on exposing
   connection lifecycle (LLP 0008 handles reconnect internally but states
   no constraint), elevating the DK-10 adapter-owned-live-push ledger
   decision (LLP 0000, 2026-07-02) into LLP 0008's text.

**Acceptance:** all three amendments landed with dated revision notes
citing LLP 0078; the LLP 0037 amendment is explicitly ratified (not just
status-boarded here); `ref-check` passes.

### SC-4. Add the embedded-Postgres option to LLP 0046 (from LLP 0078 R4, A5)

LLP 0046 leaves the dev-time Postgres story as "Docker, connect-to-URL, or
both?". Amend the open question to evaluate a third option: an embedded or
child-process Postgres as the graduation-path test harness, so agents can
validate the portable-abstraction contract against real Postgres with no
Docker dependency. The amendment should carry the tradeoffs Serverpod's own
docs concede for this shape (test serialization limits, DB access coupled to
a live process).

Candidate mechanisms to evaluate — **plan-added elaboration, not from the
Serverpod evidence**, which validated only the child-process shape: a
vendored `initdb`/`pg_ctl` child process, an embedded-Postgres crate, and
PGlite-class wasm builds. The amendment must not decide among them — the
decision belongs to LLP 0046 when the storage trait seam it depends on
exists — and must require each candidate's evaluation to state whether it
exercises **actual PostgreSQL server semantics** relevant to LLP 0007's
conformance contract (a wasm build in particular may not count as "real
Postgres" for graduation-path validation).

**Acceptance:** LLP 0046's open question lists the embedded option with
tradeoffs and candidates (tagged as above); no decision is claimed;
`ref-check` passes.

### SC-5. Guard for the name-keying invariant (from LLP 0078 R5, A1)

The A1 audit result should not regress silently. The guard mechanism below
is **plan-added enforcement**: LLP 0078 R5 recommends only recording the
constraint; turning it into a test is this plan's own execution decision.
The SC-3 item-1 constraint covers *all* Snapback-owned persisted and wire
encodings, so a syntactic scan alone cannot enforce it; the guard is
two-part:

1. **Semantic pin (the load-bearing half):** a regression test (a Rust test
   under `tests/`, running via `cargo test` in the local proof) that pins
   the exact name-keyed JSON of representative Snapback-owned enum-like
   values: at least one unit `FieldType` variant (serialized as the scalar
   variant name, e.g. `"String"`), the data-bearing `FieldType::Id` form
   (serialized as a name-keyed object, `{"Id":{"table":"…"}}` — the *key*
   is the variant name, not an index), and every `live_wire` op-kind
   (lowercase variant names on the wire). A switch to ordinal encoding then
   fails regardless of mechanism — even one that updates both sides of the
   existing drift gate. This complements, not replaces, the artifact-schema
   drift gate (`crates/snapback/tests/artifact_schemas_v0.rs`,
   `dk7_committed_schemas_match_rust_types`).
2. **Dependency/attribute guard (the tripwire):** fail if `serde_repr`
   appears among `Cargo.toml`'s direct dependencies or as a derive/attribute
   in `crates/snapback/src/`, unless allowlisted by an `@ref` comment adjacent to the use
   naming the deciding document. Key the check on serialization derives,
   not bare `#[repr(...)]` — benign FFI `repr(C)`/`repr(transparent)` types
   exist in `crates/snapback/src/` and must not trip it.

**Covered scope, stated honestly:** the guard covers Rust-owned encodings
(the storage rows, wire enums, and manifest types the Rust core serializes)
plus whatever the artifact-schema gates already pin for generated JS/JSON
artifacts. Client-side wire decoders and hand-written SQL encodings are out
of scope and the LLP 0037 amendment should say so.

**Acceptance:** both parts run in the local proof and CI; introducing a
`serde_repr` derive without an allowlist entry fails part 2; switching a
pinned representative enum to ordinal encoding fails part 1; the guard's
mechanism and covered scope are noted in LLP 0037 alongside the SC-3
constraint.

## Sequencing

SC-3 and SC-4 are independent, docs-only, and can land immediately in one
or two commits. SC-5 is a small code change that should land with or right
after SC-3 (the rule and its enforcement together). SC-1a is a docs
amendment that unblocks SC-1b, one of the two large build items and the
plan's priority. SC-2a is the other large build item, independent of the
SC-1 track, and unblocks SC-2b. SC-1b and SC-2a/SC-2b touch the same CLI
process-lifecycle code (`packages/snapback-cli/index.mjs`); whichever track
starts second checks for in-flight work on the first.

Nothing in this plan is accepted by this document. SC-1a/SC-3/SC-4
amendments follow the normal review cadence of their owner documents; the
SC-3 LLP 0037 amendment in particular modifies an **Accepted** Decision
document and requires that document's ratification, not merely a status
update here. This plan's own status is advanced by the author (Draft →
Review → Accepted, then Implemented only when **all** SC items have landed —
partial progress lives in the status board, not the document status), per
the corpus's standard proposal statuses.

## Watch items (from LLP 0078, no action now)

LLP 0078's open questions 1–3 — the Serverpod 4-stable sync-engine
follow-up read, the invocation-isolation comparison, and the
15-minutes-to-deployed benchmark — are deliberately not work items. They are
recorded here so they survive LLP 0078 going quiet: revisit when Serverpod 4
stable ships or when LLP 0062's Cloudflare packaging is productized.

## Open questions

1. Is SC-1a's non-deferrable diagnostics minimum — a bounded
   recent-invocations ring buffer — the right first slice, or does it need
   a general diagnostics-retention design first? And does it land as an
   `app.inspect` extension or a new LLP 0024-pinned operation (SC-1a's
   first decision)? The amendment decides both; the retention design may
   still be deferred with a named reason. (Owner: LLP 0042 amendment,
   SC-1a, plus LLP 0024 if a new operation.)
2. SC-1b packaging: inside the `snapback` CLI (possibly sharing the guide
   server's stdio substrate in `crates/snapback/src/guide_mcp.rs`) or a separate
   `@snapback/mcp` package? Inherited from LLP 0042's open questions;
   implementation-owned unless the SC-1a amendment settles it.
