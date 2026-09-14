# Ceremony backend final report

Built a Quarry backend with all five shapes and a headless Node HTTP client using only the installed `snapback4@0.2.9`. `npm run seed` only installs domain data through application mutations. `npm run acceptance` creates an isolated persistent project copy, owns and closes its server processes, and retains diagnostic evidence.

All four requested proofs passed. Check reports no problems or notes. Acceptance verified exact insights, UTC buckets, trending and search; authorization refusals; receipt progression and monotonicity; membership removal; live likes and messages; message-specific unread changes; and zero-count digest emission. A service-token worker claimed and settled actual effects without deduplication. Duplicate-period suppression survived a backend restart. An actual scheduled boundary fired at **2026-09-14 06:44:00 UTC**.

## Wall clock

- Start: 2026-09-14 06:38:15 UTC.
- Documentation and initial schema: 109 seconds to first compiler feedback.
- Schema corrections and seed/client implementation: 158 more seconds; clean check at 06:42:42 UTC.
- Acceptance: 80 seconds, from 06:42:43 to 06:44:03 UTC, including scheduler wait and server cleanup.
- Total through this report: 382 seconds.

## Correction loops

1. **agent-error** — `npx snapback4 check` refused the chat-admin rule because its two-column index was missing. Added `byKeyAdmin`.
2. **agent-error** — completeness review of `npx snapback4 check` found `N_NEVER_COMPLETE` for the mixed membership read rule. Declared the membership roster directory public, making scans uniform. Messages and acknowledgement facts still require current membership.

No package defect or documentation-gap correction was observed.

## Schema choices and candid gaps

`likeCounts` is a maintained per-post count, publicly readable because its source social facts are public. No per-principal counter tables exist. `digestPeriods` is conservatively reported as a work table: it is a durable idempotency marker read by later digest runs. No auxiliary operations exist; additional mutations create ordinary domain facts.

The roster directory is intentionally public; this app does not promise membership privacy. Reads aggregate bounded pages suited to the complete small seed (100 memberships, 1,000 posts/messages per scanned group); this is not a large-dataset pagination design. No UI, external notification provider, or production deployment was requested. The worker's emitted effect is performed by recording observation and settling its result. Independent runner probes have not been run by this agent.

Evidence: `.acceptance/run-UMjNWI/evidence.log`, `effects.jsonl`, `server.log`, and `success.json`. All owned servers are stopped.
