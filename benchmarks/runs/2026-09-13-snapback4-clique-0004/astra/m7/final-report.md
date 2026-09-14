# M7 — Day-2 evolution

Status: **green**. Group polls, changeable idempotent votes with durable offline queueing, and backfilled visible-message counts are implemented. Existing starter data survived the published deployment migration.

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra; effort: medium. Backend: snapback4 0.2.6; native package: snapback4-expo 0.2.1.

start=1789372730
end=1789374034
wall=1304 seconds

- M7 acceptance: pass, 6/6 suite-required assertions. [Suite](suite-m7.json), [coverage](coverage-m7.json). The first passing attempt is retained separately; the final run includes the caption-edit guard.
- M7-only choreography: 2/2 required checks pass. All three live-tally attempts and offline pending/reconnect settlement pass. [Receipts](choreography.jsonl) bind the exact final suite SHA-256.
- Migration comparison: exact equality for all eight persona snapshots, all M6 message fields, public posts/profiles, and 18 accessible asset hashes per persona. [Pre-snapshot manifest](pre-snapshot/manifest.json), [comparison](snapshot-comparison.json). Initial counts are 6 DM / 9 group; [backfill verification](migration-verification.json).
- Previously green suites: M1: pass; M2: pass; M3: pass; M4: pass; M5: pass; M6: pass; M8: pass. [Regression results](regression-results.json). Original suite code was not modified. Setup failures for M6/M8 were retained and corrected without changing product or suite behavior.
- TypeScript check: pass. iOS Hermes export: [bundle](../artifacts/m7-ios/_expo/static/js/ios/entry-6aab987ef3ca43e1f6b71a91962035b8.hbc), 2794166 bytes, SHA-256 7095e4ca67db544231ae9a0a2a457c7d6d8159d5cccb9df7c60d0a9b122ebb4d. No native runtime execution claimed.
- Server cleanup: [exact-PID record](cleanup.json); only this run's recorded lane-owned processes were stopped.

## Migration

The inherited schema carried arrival-sequence, reaction, and digest counters, but no visible-message count. Release 1 was fresh and seeded through the app's three starter seed segments. Releases 2–3 expanded the schema and scheduled a Quarry backfill (15 messages, one chunk). Release 4 made the contribution required and added the automatically rebuilt sum aggregate; explicit `--allow-destructive` acknowledged the compiler's optional-to-required classification after backfill. Release 5 closes the poll edit-caption validation gap. No direct database edits, data imports, or backend source checkout were used. [Procedure](README.md), [release diagnostics](deploy-final.log), [backfill](backend-backfill-root.log).

## Corrections and gaps

Recorded correction loops: 9 agent-error; 0 snapback4-defect; 0 environment; 0 ambiguous. [Details](correction-loops.json). These are explicitly grouped correction loops, not a count of every failed command. The missing Git repository is an environment diagnostic, not an implementation correction. Published CLI `run` refusing deployment stores was handled with a scheduled job rather than bypassed.

- The starter message fixture contains text messages and empty message-media/reaction fields; initial receipts are sent/null. All those fields were compared, without exclusions. Populated media preservation is additionally evidenced by the starter's post/avatar metadata and byte hashes. This does not claim a migration of populated message reactions or read receipts that the mandated starter fixture did not contain.
- The comparison was captured immediately after migration, before regression and browser activity legitimately created messages and advanced receipt marks. The deployment now includes that verification activity; pre/post migration snapshots remain immutable evidence.
- Expiry contributions leave the aggregate on the engine's sweep, documented within one second of row-read expiry. The suite verifies eventual removal under the shortened server window.
- Backfill is at the requested pre-replay starter scale, not the scale-replay database. Native proof is a Hermes export, not simulator behavior.
- A broad process-status diagnostic unintentionally surfaced unrelated process command text; no foreign files were opened or used. Subsequent inspection and cleanup used exact owned PIDs only. A CLI help lookup was also retained alongside the allowed README/guide/why lookups.
- The inherited choreography loader supplies missing JSON-schema validation support; the frozen browser assertions were unchanged.

[Diary](diary.md) and [essay paragraphs](essay-paragraphs.md) were written before final metric tallying. [Evidence hashes](evidence-hashes.json) bind the delivered source and receipts.

end=1789374034
