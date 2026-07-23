# LLP 0079: Serverpod course corrections — execution plan

**Type:** Plan
**Status:** Draft
**Systems:** Developer experience, Dev loop, MCP, Storage, Schema, Sync, Wire protocol
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Related:** LLP 0078, LLP 0003, LLP 0007, LLP 0008, LLP 0009, LLP 0012, LLP 0024, LLP 0030, LLP 0037, LLP 0041, LLP 0042, LLP 0046, LLP 0061

## Summary

[LLP 0078](./0078-serverpod-lessons.research.md) (the Serverpod research pass
and same-day repo audit) produced seven recommendations. Two need no action —
the auth program (R7) and the DSL/serialization posture are validated as-is —
and the rest divide into five concrete work items. This plan is the ticket
list for those items: each has an owner document, a size, dependencies, and
acceptance criteria an agent can check. Work items are numbered `SC-n`
(Serverpod correction); statuses are tracked in the table below and updated
in place as items land.

This plan deliberately does **not** restate the research or the audit
evidence. LLP 0078 is the source for *why*; this document is only *what, in
which order, and how we know it's done*.

## Status board

| Item | Title | Owner doc(s) | Size | Status |
| --- | --- | --- | --- | --- |
| SC-1a | MCP verb-scope amendment | LLP 0042 | S (docs) | Open |
| SC-1b | Control-plane MCP server build | LLP 0042 | L (code) | Open — after SC-1a |
| SC-2 | Dev-loop client arm | LLP 0041, LLP 0030 | M (code) | Open |
| SC-3 | Doc-batch: constraints made standing | LLP 0037, LLP 0041/0003, LLP 0008/0012 | S (docs) | Open |
| SC-4 | Embedded-Postgres option in LLP 0046 | LLP 0046, LLP 0007 | S (docs) | Open |
| SC-5 | Name-keying CI guard | LLP 0037 | S (code) | Open |

## Work items

### SC-1a. Amend LLP 0042's verb scope (from LLP 0078 R3)

LLP 0042's tool list covers lifecycle and schema/function load but omits the
agent verbs a competitor ships today. Amend the Draft RFC to add:

- **Log/diagnostics reading** — a read-only projection of server diagnostics
  and recent invocation logs through the MCP surface, consistent with the
  machine-readable diagnostics LLP 0010 already requires.
- **Acceptance-suite execution** — a verb to run an app's acceptance suite
  and return structured results, so the close-the-loop step is reachable
  without shelling out.
- **Client-surface driving/screenshots** — named explicitly as an
  **Exact-side seam**, not a Snapback tool: record the boundary and what
  Snapback must expose for the Exact side to implement it, so the gap is a
  documented seam rather than silence.

**Acceptance:** LLP 0042 revision lands with the three additions, each
either specified or explicitly deferred with a named reason; `ref-check`
passes.

### SC-1b. Build the LLP 0042 control-plane MCP server (from LLP 0078 R3, A4)

The largest competitive gap LLP 0078 surfaced: none of LLP 0042 is
implemented — the only MCP server in the repo is the read-only guide
projection (`src/guide_mcp.rs`). Build the control-plane server per the
amended RFC, reusing the CLI's existing process-lifecycle logic
(`--ready-file` spawn, `HostReadyDescriptor` consumption, nonce-verified
stop) rather than proxying HTTP, as the RFC already specifies.

**Depends on:** SC-1a (build against the amended scope, not the stale one).

**Acceptance:** the pinned LLP 0024 tool set plus the SC-1a additions are
callable by a real MCP client against a local server; the generated
app-data catalog exposes query tools by default and mutation tools only
with an explicit authority tuple; an acceptance test drives the full
loop (start → load schema/functions → run function → read diagnostics →
stop) through MCP alone.

### SC-2. Put a client arm in the dev-loop watch process (from LLP 0078 R1, A3)

`snapback dev` already watches, regenerates, and hot-pushes into the running
server with honest load states. The delta to the full-stack bar is
orchestration breadth: one command that also runs a client surface in the
same watch process. Scope per LLP 0041's existing seam: the CLI owns
watch/codegen orchestration; the `@snapback/vite` plugin (LLP 0030) owns the
frontend dev-server integration — this item wires them together and surfaces
the loop's verbs both interactively and machine-readably.

**Acceptance:** from one command, an edit to `schema.mjs` or `functions.mjs`
is observable in a running client surface without restarting either process;
the `generated-but-not-loaded` and `generation-failed` states are surfaced
to both the human and a machine-readable channel; LLP 0041's acceptance
section is updated to include the client-arm criterion.

### SC-3. Doc batch: make three validated constraints standing rules (from LLP 0078 R2, R5, R6)

Three properties the audit found true-but-emergent become stated
constraints in their owner documents. One batch item because each is a
small, independent doc amendment:

1. **LLP 0037 (schema source of truth):** no Snapback-owned persisted or
   wire encoding may depend on declaration order surviving edits —
   enum-like values, fields, columns, and variant tags stay name-keyed;
   any future by-index encoding is an explicit decision with a named
   reason. (Enforcement is SC-5.)
2. **LLP 0041 (with a pointer from LLP 0003):** the dev-loop hot-push is
   artifact load, not data migration. If hot-apply ever grows into
   data-bearing schema migration of a running system, each applied
   migration must be a versioned commit the sync and
   read-set-validation machinery sees — never a side-channel mutation —
   and it stays a dev-target affordance until a production migration
   story is separately accepted.
3. **LLP 0008 and LLP 0012:** record the additive-wire discipline and the
   no-connection-lifecycle-exposure rule as load-bearing constraints,
   citing LLP 0078 F2a/F2e as external evidence (a competitor's deprecated
   first design and breaking-change tax) for why they must not be relaxed
   under delivery pressure.

**Acceptance:** all three amendments landed with dated revision notes
citing LLP 0078; `ref-check` passes.

### SC-4. Add the embedded-Postgres option to LLP 0046 (from LLP 0078 R4, A5)

LLP 0046 leaves the dev-time Postgres story as "Docker, connect-to-URL, or
both?". Amend the open question to evaluate a third option: an embedded or
child-process Postgres as the graduation-path test harness, so agents can
validate the portable-abstraction contract against real Postgres with no
Docker dependency. The amendment should carry the tradeoffs Serverpod's own
docs concede for this shape (test serialization limits, DB access coupled to
a live process) and name the candidate mechanisms to evaluate (vendored
`initdb`/`pg_ctl` child process, an embedded-Postgres crate, PGlite-class
wasm builds) without deciding among them — the decision belongs to LLP 0046
when the storage trait seam it depends on exists.

**Acceptance:** LLP 0046's open question lists the embedded option with
tradeoffs and candidates; no decision is claimed; `ref-check` passes.

### SC-5. CI guard for the name-keying invariant (from LLP 0078 R5, A1)

The A1 audit result should not regress silently. Add a cheap CI-enforced
guard for the SC-3 item-1 constraint: a test (or `ref-check`-style script
check) that fails if by-index serialization is introduced into
Snapback-owned types — at minimum, assert `serde_repr` /
`#[repr(...)]`-with-serialize patterns are absent from `src/` unless
allowlisted with an `@ref` to the deciding document, and keep the existing
schema-manifest snapshot test as the shape-drift gate.

**Acceptance:** the guard runs in the local proof and CI; introducing a
`serde_repr` derive without an allowlist entry fails it; the guard's
mechanism is noted in LLP 0037 alongside the SC-3 constraint.

## Sequencing

SC-3 and SC-4 are independent, docs-only, and can land immediately in one
or two commits. SC-5 is a small code change that should land with or right
after SC-3 (the rule and its enforcement together). SC-1a is a docs
amendment that unblocks SC-1b, the one large build item and the plan's
priority. SC-2 is independent of the SC-1 track and sized medium; it
touches LLP 0030's plugin surface, so coordinate with any in-flight work
there.

Nothing in this plan is accepted by this document; SC-1a/SC-3/SC-4
amendments follow the normal review cadence of their owner documents, and
this plan's own status advances per LLP 0032's rules when items land.

## Open questions

1. Should SC-1b's log-reading verb wait for a general diagnostics-retention
   design, or is a bounded recent-invocations ring buffer enough for the
   first slice? (Owner: LLP 0042 amendment, SC-1a.)
2. Does SC-2 target the Vite/React arm first (existing plugin seam) or a
   Contract/Exact surface first (the first-class client per LLP 0000)?
   The Serverpod bar is met by either; the Contract-first principle argues
   for at least defining the Exact-side seam in the same revision.
