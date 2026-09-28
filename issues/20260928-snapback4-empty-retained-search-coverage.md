# Snapback 4: acquired empty departed word search remains incomplete

Status: Open
Date: 2026-09-28
Scope: device word-search coverage, LLP 3000.028 §7.2

Lane OS observed the exact calibration #24 builder on process and wasm devices.
The copied store's `messages` acquire `last 500 by byHistory`, whose full order is
`conversation, ordinal, id`. An explicitly unguarded ordinary per-chat query
searches `messages[conversation = conversation] matching q where not .tombstone
last 20 by .at after c`.

Create an empty group using the builder's original `createGroup`, acquire it,
remove the reader using `removeMember`, apply sync, then query `q: 'osfloor'`.
Both online and offline observations return `data: []`, `complete: false`, zero
query fallback; the device reports `retained: true, unknown: false`. This is honest
uncertainty but fails to certify the acquired empty domain. It is not the new
inferred server plan: per-chat reads never take that alternative and the wasm
coverage evaluator is unchanged.

Reproduction and observations:
`snapback4/experiments/p19-one-query/ordinary-search.mjs`,
`snapback4/reports/20260928-os-ordinary-search/REPORT.md`, stages
`*-floor-departed-empty-*` in its `builder-search.jsonl` and
`u0500/builder-search.jsonl` (compressed when archived).
The initial expected-complete assertion is preserved in `builder-search-round1.jsonl`.
The acquisition/search order mismatch is a relevant observed condition, not a
proof of the entire root cause.

Investigate whether a durably published whole-empty group can certify this word
range regardless of order, preserving the current incomplete answer during
acquisition, failed publication, nonempty partial windows and unavailable ranges.
Do not relax retained authority or recover departed history from the server.

Round 4 of lane OS also pins the all-chat limitation on process and wasm:
after departure, an absent needle exhausts the stored words and the server
answers complete/empty, but the device's unscoped range is `unknown: true`.
The horizon-free control is complete: this limitation belongs to windowed
sources. `history::coverage_state` needs the audience group pinned in the
scanned index prefix; the global words prefix cannot supply it.
`horizon_coverage` consequently records an unknown fact for the windowed
source. The SDK keeps `complete: false`; an empty list or absent continuation
is not a range proof. A future improvement must compose each relevant group's
actual acquired boundary, including partial/empty groups and current/Left
transitions, under the same allowance. It must not simply clear unknown because
`search_state.left` is nonempty. The round-4 report and the `current-only pages
are fresh; windowed retained coverage stays unknown` process/wasm regression
record this explicit limitation, separately from the repaired device-cut loss.
