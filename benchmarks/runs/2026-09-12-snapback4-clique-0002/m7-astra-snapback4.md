# M7 — Day-2 evolution

status=green
start=1789233309
end=1789234256.953
wall=947.953 seconds

Snapback 4 is exactly pinned to 0.0.2. Work was performed alone in this lane; no other lane, Snapback source checkout, prior diary, or prior essay was inspected. The fresh backend used m7/instance and all three starter segments through scripts/seed.mjs.

Group polls now support validated questions and 2–4 options, member-only changeable set-state voting, live tallies, durable offline votes, and message receipts/deletion/expiry. Chat settings display the server-time message count after expiry cleanup.

## Results

- Acceptance: 5/5 checks passed via npm run acceptance -- --milestone m7. [Suite](../evidence/m7-suite-1789234073001.json); [coverage](coverage-manifest.json). Every suite-required M7 assertion is covered.
- Sole selected choreography segment m7: 2/2 passed; green=true; nonGreenCause=null. [Receipt](choreography-1789234073068.jsonl); [output](choreography-release.txt). The copied inherited harness's M7 logic matches the authoritative instrument; its disclosed prior media/path adaptations were retained.
- Previously green suites M1, M2, M3, M4, M5, M6, M8: all pass on the final run. [Results](regression-results.json). Initial M6 push failure and its standalone retry remain in regression-first-attempts; it was a presence-lease setup collision, not a product repair. Inherited expiry/search/native limitations remain.
- Backfill: starter DM=6, group=9. [Proof](backfill-proof.json). Empty conversations, new text/polls, edits, repeated tombstones, and expiry counts are tested.
- Snapshot: eight persona files and SHA-256 manifest before schema edits; 15 unique messages, 39 persona message objects. Exact post-migration M6 field equality passed before browser use. Final state preserves every field except 10 legitimate monotonic receipt advances from test readers. [Pre snapshot](pre-snapshot/manifest.json), [exact comparison](snapshot-comparison.json), [final comparison](final-snapshot-comparison.json). Starter reactions were zero, so their preservation assertion is necessarily vacuous for that fixture. Media is struck-by-environment.
- Count and vote state survived backend restart. [Proof](restart-proof.json). TypeScript passed; iOS Hermes export succeeded at artifacts/m7-ios. No simulator claim.

## Migration facts

The pre-M7 schema had social analytics counts but no conversation message-count structure. The package classified optional message columns as Narrowing (constraints), with additive columns/tables and aggregate rebuilds. It announced a successful rebuild while the newly introduced direct message aggregates remained empty for old rows. A no-op touch did not repair this. The explicit paged, idempotent migration now inserts a contribution for each visible message; Snapback maintains visibleMessageCounts from those contributions. New message, poll, delete, and purge paths update contributions atomically. The inherited M6 fields are unchanged. [Backend adoption log](backend.log), [diagnostic](count-diagnostic.txt), [migration](backfill.mjs).

## Correction loops and gaps

- **agent-error**: Snapshot initially required complete=true despite inherited shaped-history completeness behavior; verified all fixture IDs and paged next instead. Evidence: m7/snapshot.mjs.
- **agent-error**: Initial count probe used g-weekend rather than fixture g-starter; corrected identity. Evidence: m7/backfill-proof.json.
- **snapback4-defect**: Hot adoption announced aggregate rebuild but existing groups remained empty. Evidence: m7/count-diagnostic.txt.
- **snapback4-defect**: Semantic no-op touch did not repair new aggregates; explicit contribution backfill replaced that attempt. Evidence: m7/backfill-touch-proof.txt.
- **agent-error**: Quarry compilation required a typed messageId index and an inline bounded page for iteration. Evidence: m7/schema-check-3.txt.
- **agent-error**: Unknown mutation argument returns denied, not state=failed; suite assertion corrected. Evidence: m7/acceptance-attempt1.txt.
- **agent-error**: Repeated deletion needed an existence guard for an already-removed count contribution. Evidence: m7/acceptance-attempt1.txt.
- **agent-error**: Sequential regression setup reached M6 before Bob presence lease expired; isolated retry passed, final runner waits for expiry. Evidence: m7/regression-first-attempts/regression-m6.txt.
- **agent-error**: Two guessed kit filenames were absent; rg located PollCompose and PollDisplay. Evidence: ui/src/PollDisplay.tsx.

- Authoritative count reads refuse histories exceeding 1,000 stored rows and remain subject to the package's mutation ceilings. Larger/scale migration performance is not claimed; this phase used the required starter state.
- The inherited universal expiry-refusal gap in history/raw sync remains; the new count operation applies expiry itself.
- Temporal count verification used a disclosed dev seed change to expiresAt after a real send, rather than waiting a production TTL.
- Exact immediate snapshot equality and later monotonic receipt progression are reported separately; final receipts are not falsely claimed byte-identical.
- No production deployment, hidden-grader result, or native offline runtime proof is claimed.

All session server PIDs were recorded. Final shutdown targeted only 50775, 50754, and 82454; the earlier backend 56364/56300 was stopped for the durability check. [Shutdown](shutdown.json), [verified stopped](shutdown-verification.json).

Diary and closing-essay paragraphs were written before this metric tally. Token accounting is left to the harness.

end=1789234256.953
