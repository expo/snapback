# Diary 0109 — Clique full run: explicit vs familiar (all milestones)

Full-scope Clique (social-messenger) run, both Snapback authoring profiles, all
milestones, published Snapback 0.1.24, model `gpt-5.6-sol` @ xhigh, instrument
`0.3.2-m8`. Two lanes plus two M7 fresh sessions. Build record:
`benchmarks/runs/2026-08-22-clique-full-familiar-vs-explicit/record.md`.

## Shape of the work

Both profiles reached **web authoring-green** for M1–M6 and M8, plus the
167,157-action scale replay and M7 day-2 evolution as a fresh session. That is
not full product parity: Familiar recorded `scheduleDriven: false`, and the
grader that owns the autonomous-digest obligation was not run. Explicit
continuous wall was 17,679s; Familiar 12,336s. Both replay pipelines reconciled
exactly (counts + all named O5 fixtures, zero diff). This is calibration-grade
(N=1).

## What felt good

- **Realtime was the strong axis for both lanes.** The two-client choreography
  (live profile edits, follows, messages, reactions, read state, typing)
  needed almost no cache/invalidation code in either profile. Explicit's
  ephemeral typing (connection-owned, purpose-built) scored B3=92; familiar's
  live-query hooks scored B3=65 (its typing needed a durable row + client
  expiry instead). Both lanes repeat the same point: realtime is an outcome of
  data dependencies, not a separate socket layer — the Convex-shaped deal
  Snapback is aiming for.
- **Legibility of the protocol** (explicit): a reviewer can open `schema.mjs` /
  `functions.mjs` and see tables, indexes, auth posture, effects, failure
  vocabulary, cron, ephemeral channel, and the push/replay seam. B1=78.
- **Application-code feel** (familiar): typed tables + ordinary query/mutation
  functions consumed through hooks. B1=88 — the highest single-dimension score
  in the run.
- **Custom-client API** (both): generated references usable outside React; a
  third-party surface authenticates, issues scoped tokens, lists/paginates/
  sends/polls without inventing REST. Felt closer to tRPC than to Convex's
  function URLs.
- **Fail-closed sessions/evolution.** A careless restart on a changed sessions
  carrier failed closed (not corrupt/reset) and successor activation evolved
  the store in place; familiar called this a stronger local safety story than
  many prototype backends.

## What fought us

- **Offline writes are hand-owned in both profiles.** Neither the explicit web
  client (missing settlement-ledger coverage) nor the familiar client (browser
  outbox + local snapshot) got ordered, durable, convergent offline writes from
  the platform. B4: explicit 36, familiar 35 — the lowest shared dimension.
  Explicit could not honestly claim restart durability; familiar's likes/
  reactions did not share its durable queue path.
- **Media/storage custody was not integrated.** Secure upload, byte custody,
  view-once revocation, tombstone denial were application work in both lanes.
  B5: explicit 48, familiar 35.
- **The scale replay exposed bounded-contract edges.** Both adapters retained
  too many durable mutation IDs, the 0.1.24 sessions acknowledgement route did
  not provide a usable escape, and whole-table audits reached the documented
  implicit query ceiling. Current `main` now owns these through the offline
  settlement and bounded-query Guide paths; the adapters eventually completed
  167k actions with settlement and keyset paging.
- **Familiar profile boundary cut a production milestone.** The Familiar Guide
  explicitly excludes cron and tells you to migrate to the explicit profile;
  this task pinned familiar and forbade that escape. So M8's scheduled digest
  recorded `scheduleDriven: false`. That makes the grader-owned product
  obligation absent/ungraded, not green; LLP 0295 OQ2 owns the profile seam.
- **Familiar served-guide/codegen dialect mismatch.** The 0.1.24 Guide said
  live point-value returns while its codegen refused that contract. This
  pre-fix observation is now routed to the closed Familiar dialect ticket.
- **Tooling/handoff gaps (mine, not the model's).** `lane-setup.mjs` assumes a
  starter log per milestone (M4–M8 have none); the exported M7 handoff was not
  relocatable (relative fixture paths). Both filed; both cost the M7 / setup
  sessions a loop each.

## Comparison to alternatives (from the lanes' own essays)

- **Convex:** closest shape to both profiles. Explicit: "authored as checked
  protocol rather than arbitrary server code"; familiar: "the productive inner
  loop — declare, author, consume via live hooks — is Convex's strongest
  idea." Convex currently feels more uniform at the edges; Snapback surfaces
  deployment identity, session custody, declared read/write sets earlier.
- **Supabase/Postgres:** would have made aggregates and pagination natural
  (both lanes ended up hand-keyset-paginating invariant audits), but realtime
  composition + RLS alignment would cost more.
- **Firebase:** fast auth+sync but denormalization pressure; its mature mobile
  offline would have beaten both lanes' hand-owned queues.
- **Hand-rolled Postgres+Express:** maximum control, but the whole
  synchronization service (sessions, idempotency, fan-out, offline semantics)
  becomes bespoke. Clique's breadth is exactly the case for a backend platform.

## Score snapshot (per-dimension; B8 = M7; no weighted total per the
applicability rule)

| Dim | explicit | familiar |
|---|---:|---:|
| B1 schema | 78 | 88 |
| B2 auth | 67 | 78 |
| B3 realtime | 92 | 65 |
| B4 offline | 36 | 35 |
| B5 media | 48 | 35 |
| B6 search | 58 | 42 |
| B7 push/actions | 78 | 32 |
| B8 day-2 (M7) | 82 | 94 |
| B9 DX | 74 | 62 |
| B10 diagnostics | 79 | 74 |
| B11 operations | 60 | 67 |
| Holistic | 70 | 67 |

## Reading

Explicit edges familiar on realtime, offline, media, search, push, DX,
diagnostics; familiar edges explicit on schema feel, auth, day-2 evolution,
and operations. Holistic lands at 70 vs 67. The profile trade is real: explicit
is the complete-but-more-ceremonial surface; familiar is the nicer core loop
that could not complete the scheduled-digest obligation without crossing its
own profile boundary. Until Familiar grows the advanced-primitive seam without
a profile migration, Explicit remains the completing profile for this app.

## Current-main reconciliation — 2026-08-23

This diary describes the published 0.1.24 experience. Current `main` has since
added the sessions acknowledgement path and first-read dialect guidance, while
query and mutation-ID ceilings are explicitly documented as bounded contracts.
The run remains useful history, but those observations are not fresh defect
claims.
