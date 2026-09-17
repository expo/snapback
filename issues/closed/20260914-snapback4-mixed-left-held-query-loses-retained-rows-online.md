# Snapback 4: a mixed left/held query loses retained rows online

**Priority:** P3
**Status:** Closed (2026-09-17)
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
[LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md#proposed-composition-of-retained-and-authoritative-reads)
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

## 2026-09-17 plan rewrite

The linked plan was rewritten and commissioned. It drops per-value provenance
and the server sidecar: the binder proves which returned-record fields are
independent, the device reports `complete`/`unknown`/`retained` per field
from scoped copies of the flags it already keeps, and the client answers each
field from the host that would have answered it as its own query — the
recipe above, performed in one observation and one publication, with
`fresh: false`. The server is unchanged. Shapes the binder cannot prove keep
today's whole-query fallback and the separate-query recipe. This ticket
stays open until both client arms pass the documented acceptance.


## 2026-09-17 implementation follow-up — lane MQ

The binder, device coverage frames and client composition are implemented in the working tree for lead integration. The retention suite passes on wasm and process devices with exact ids and bodies: online 25 retained left rows plus 26 held rows, offline 25 plus 25, with history kept through watch reruns and reconnect. Composed reads are incomplete, `fresh: false`, without `since` or continuation. Delayed original-query replies are tested across rejoin, a held-room write, close, sign-out and transport loss. Offline reopen passes through persisted wasm memory and SQLite. Ineligible shapes keep whole-query routing. Broader M3 interleavings and actual IndexedDB reopen remain unqualified by this lane. This ticket stays open for the lead's outside-sandbox verification; nothing is published.

## 2026-09-17 resolution

Closed. A binder-proven query — cursor-free, not `held`, at most one read per
returned field, no reading `require` — now composes: the device reports
coverage per field, the client asks the server the original query, observes
the device again, and publishes one read with `fresh: false` and no `since`.
`both()` online is the 25 exact delivered left rows beside the server's 26
held rows through the wasm and process clients, for queries and for watches
across reconnect; offline and after a fresh-realm IndexedDB reopen in real
Chromium it is 25 + 25. Shapes without a plan keep the whole-query fallback
and the separate-query recipe, as the README sync paragraph and the sync card
now say. Three blind review rounds by two families are under
`llp/reviews/3000.001-retained-read-composition*.md`; the plan, what was built
and what was reverted are in
[LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md#proposed-composition-of-retained-and-authoritative-reads).
Left open for the author: whether `fresh: false` without `since` is the right
card for a composed read. Found on the way and ticketed separately: a
program-only backend generation resets a device's rows and so loses left
history
([ticket](../20260917-snapback4-program-only-generation-drops-retained-history.md)).
