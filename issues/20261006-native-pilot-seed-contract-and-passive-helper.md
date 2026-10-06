# Native pilot: expose seed body semantics and make passive hooks the default

**Opened:** 2026-10-06, P2A Round 7
**Status:** Open; proposed admission prerequisites, no qualified bytes changed
**Area:** native instrument contract, fixture schema, helper and handoff checks
**Related:** LLP 0201.000 §§3,6,7;
[Phase-2 results](../snapback4/reports/20261005-ni-native-protocol/PHASE-2-RESULTS.md)

Both independent builders emit two distinct run-specific queued bodies that
pass the supplied fixture JSON Schema but fail `fixture_valid`'s exact
`[runId+':first', runId+':second']` equality. The builder-facing contract's
seed paragraph does not state this requirement. It exists in LLP 0201.000's
example and the driver excluded from the builder view. Reproduction and hashes:
[fixture-schema-gap.json](../snapback4/reports/20261005-ni-native-protocol/round7/fixture-schema-gap.json).

State the exact format in the shared contract and provide a shared descriptor
constructor or semantic schema-validation helper. Validate it at handoff,
before custody compilation/device work. Standard JSON Schema alone cannot
express an arbitrary sibling-field equality; a UUID-shaped regex alone is
insufficient. The preflight must reject bodies for a different valid run ID as
well as the two actual builders' formats.

Both builders also fail source-audit passivity. SB4 gates product sends on its
observation persistence chain. Convex's synchronous helper calls can throw into
send/error/navigation paths, and its committed-screen observations retain rows
not rendered in the current list/search. The supplied helper exposes throwing
synchronous native calls, and its hook accepts arbitrary caller-built arrays.
The contract prohibits these behaviors but does not make correct wiring easy.

Provide a nonthrowing observation API whose failures produce sticky diagnostic
failure state without affecting application control flow, storage, retries or
navigation. Provide a rendered-row adapter that reconciles viewability IDs with
the current committed data, drops removed rows, and records independently
accessible body/receipt descendants. Clarify that any observer-specific journal
must not gate product writes. Qualify observer I/O/overflow failure and row
removal/recycling/search-empty cases before distributing the revised helper.

SB4's fresh ordinary Bob SDK client also reports delivery while paginating
history. Clarify the oracle's transport requirement and provide a documented
ordinary read path with delivery reporting disabled; preserve ordinary auth,
pagination, duplicates and authoritative order. Do not weaken read-only oracle
admission merely because a query-shaped SDK call writes implicitly.

These are material authoring-aid changes: cut new candidate bytes, rerun
affected controls and fresh independent Phase-2 authoring/measurement before
requesting Charlie's scored-admission ruling. Do not edit the retained builder
trees or reinterpret the operator-patched diagnostic artifacts as admissible.
