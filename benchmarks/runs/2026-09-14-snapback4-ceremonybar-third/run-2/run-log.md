start=1789384937
1789384937 milestone=start documentation
1789384937 loop=1 attribution=agent-error command=date wrote a timestamp outside current directory; resolution=all subsequent task files restricted to current directory
1789384937 lookup source=package README node_modules/snapback4/README.md
1789385034 lookup source=package guide language, bounds, jobs; package README sections programs, search, effects, wire
1789385034 lookup source=why E_STRUCTURAL_FANOUT
1789385034 milestone=green schema first check no problems
1789385034 lookup source=generated-types snapback/generated/api.ts
1789385034 milestone=start HTTP seed and acceptance implementation
1789385205 milestone=green seed and initial five query values and authority refusals
1789385205 loop=2 attribution=agent-error command=npm run acceptance failed TypeError start is not a function; resolution=renamed runPeriod parameter that shadowed server start function; rerun fresh copy
1789385249 lookup source=model knowledge Node HTTP transport, process ownership, assertions, seed input generation; no application answer calculation in client
1789385249 milestone=green deterministic digest emission, restart idempotency, following-period emission and worker claim/settle
1789385249 milestone=start actual schedule-boundary proof and live-change assertions
schema-shape={"workTables":["digestPeriods"],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}
Schema choices: profiles store explicit active status; posts use logical keys and typed targets; likes and follows are public social facts; likeCounts maintains counts per post. chats, members, messages and acknowledgements enforce current membership. Receipt states are reduced over current recipients, with read acknowledgements monotone. Insights sums originals and their incoming interactions and computes UTC day buckets from the supplied clock. Trending sorts the bounded recent-original page by maintained likes, time, then key. Search uses chat-scoped word indexes and returns backend-created groups. Digest scans current memberships and messages as system and excludes only message-specific reads and authors.
digestPeriods is conservatively listed as a work table because only digest writes and reads it. It is a durable period/principal idempotency record, never a numeric accumulator; its insertion and the real effect emission share the chunk transaction. No per-principal counter tables or maintains exist. The only world-readable counter is likeCounts: it summarizes public likes on public posts and supports public trending. Seed operations profile, post, follow, createChat and addMember create ordinary domain facts and are independently useful application operations, not auxiliary calculation operations. All pages use ordinary finite limits within unchanged package ceilings; this small-seed app does not claim unbounded-scale exactness.
1789385323 milestone=green actual scheduled boundary 1789385280000; live ranking, search, receipts, current membership and zero-count digest probes all passed
1789385323 milestone=green npm run acceptance exit 0; persistent fresh copy .acceptance/run-NxAcao; owned server children closed in finally
1789385323 milestone=green final-report.md and schema-shape record complete; all four proofs passed
green=1789385323
