# Snapback 4: a mixed left/held query loses retained rows online

**Priority:** P3
**Status:** Open
**Date:** 2026-09-14
**Scope:** Snapback 4 query-wide retention and fallback
**Related:** LLP 3000.007 §18.2; catch-up GPT re-check N3 at `056335ebf3f27976227f8cee655219e0b875c70a`

A query returning both a left group's retained rows and an unknown held-group
read cannot be answered whole by either host. With a 25-row acquisition horizon
and 26 messages in each group, after leaving `left`, the device returns
`{left: [25 rows], held: [25 rows]}` with `complete: false`, `unknown: true`,
`retained: false`. Online, the client falls back for the whole query and shows
the server's `{left: [], held: [26 rows]}`. Offline, the 25 retained left rows
reappear with the device's 25 held rows. Watches make the same transition.

Keep the left-group read in its own query. Its retained answer then stays on
the device online and offline, while the separate held query can fall back.
The README sync paragraph and sync card document this limit. The Rust device
`r2_n3_mixed_returned_history_uses_whole_server_or_device_answer` regression runs
on both stores; the client retention suite pins query/watch behavior on wasm
and process devices, including reconnect.

Preserving both parts of one returned value would need provenance from each
read site through the result, plus a defined composition of the retained device
components and authoritative server components. Such a design must cover
derived values, joins, aggregates, completeness, cursors, dependencies, expiry,
and consistent updates across the two observations. Query-wide flags alone
cannot say which result parts can be replaced safely. No provenance mechanism
is commissioned by lane R2; track this limit until a concrete application
requires that design.

## 2026-09-16 planning follow-up

At the author's request, after updating main to `18c8f5daf`,
[LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md#proposed-composition-of-retained-and-authoritative-reads)
now contains a proposed design and staged acceptance plan. It tracks
per-value data, absence and control provenance, then limits the first
composition slice to compiler-proven independent, cursor-free components.
The desired online example keeps the 25 delivered left rows alongside
26 current held rows, with incomplete coverage and an explicit conservative
freshness contract. Joins, mixed aggregates and dependent branches are not
fixed by merging returned rows.

The existing whole-query fallback and separate-query recipe remain the
implemented contract. Planning is now commissioned; no implementation,
contract acceptance, fresh reproduction or independently built application's
need for general composition is claimed. The ticket stays open until the
actual wasm/process queries and watches satisfy the documented acceptance,
including reconnect and lifecycle races.
