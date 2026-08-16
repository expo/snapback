# ctx.db.elevated is reachable from actions/scheduled work via nested mutations, violating the LLP 0231 D7 boundary

**Opened:** 2026-08-15
**Severity:** P1 (authorization-boundary conformance)
**Systems:** Runtime, Authorization
**Found by:** LLP 0234 acceptance review round (codex gpt-5.6-sol finding 2), verified by the orchestrator against origin/main.

## Problem

LLP 0231 D7 (amended 2026-08-15) scopes `ctx.db.elevated` to trusted *named
query/mutation* read calls and states it "cannot serve scheduled, action,
write, masking, egress, or reusable override authority." The landed fence does
not implement that boundary transitively:

- `db.query | db.elevated.query` is refused only when the **current**
  invocation mode is `Action` (`src/runtime.rs` ~3196–3200; same pattern at the
  point-read dispatch sites).
- The invocation mode is derived solely from writability (`src/runtime.rs`
  ~2018–2022), so a nested mutation invoked through `ctx.runMutation`
  (`packages/snapback-harness/ctx-bootstrap.js` ~997) from an action — including
  cron/scheduled actions — executes in `Mutation` mode with cloned auth and
  `InvocationSource::NestedMutation` (`src/local.rs` ~3482).

Net effect: an action or scheduled job can move any elevated read into a named
mutation it invokes, obtaining the Class-R row-visibility bypass on a path D7
explicitly excludes — with no override declaration, approval, expiry, or
ratchet (relevant once LLP 0234 lands).

## Fix shape

Define the elevation fence over **root invocation provenance**, not the
currently executing function kind: any ancestry containing an action, cron,
job, or other no-principal/scheduled source must refuse `ctx.db.elevated.*`
before storage access. Carry root provenance into nested handler contexts.
Add negative tests: a system action/cron calling a mutation that uses each
elevated read form (`get`, `getMany`, `uniqueMany`, `query`) is refused; a
directly invoked caller-backed named query/mutation remains admitted.

## Coordination

- LLP 0234's revision round records this as a D7-boundary dependency; its G0
  acceptance fixtures should include the nested-provenance refusal cases.
- Do not fold into the read-surface composition lane (`lane/visibility-compose-20260815`);
  land after it to avoid `src/runtime.rs` conflicts.

## Resolution (2026-08-15)

Resolved with a host-owned root-provenance fence. Function preparation binds
each invocation ancestry as caller-backed named-read authority or permanently
fenced action/background authority; nested mutation inheritance preserves that
fact, and unbound nested inheritance fails closed. Every elevated dispatcher
(`get`, `getMany`, `uniqueMany`, and `query`) checks the root fact before
descriptor parsing or storage access.

The refusal reuses the existing action DB-denial family,
`SNAPBACK_HANDLER_WRITE_IN_QUERY`, whose shared dispatcher and handler-envelope
classification already preserve a trusted typed action failure. No new
diagnostic code or registry entry was needed.

Runtime witnesses:

- `table_visibility_cron_action_root_refuses_all_nested_elevated_read_forms`
- `table_visibility_caller_backed_action_root_refuses_nested_elevation`
- `table_visibility_direct_caller_query_and_mutation_keep_elevated_reads`
