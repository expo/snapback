# Diary 0124: Exact's chat template on Snapback 4, usable before history finishes

**Date:** 2026-11-03

**Subject:** the Exact chat template (Contract UI, exact2 at `ad181418b3`) as the frontend, Snapback 4 at `13f30b2fbc` (0.4.52 plus LLP 3000.001.001 progressive acquisition, unpublished) as the backend; 15,000 seeded messages across ten conversations; a visible, honest sync-progress UI

**Agent:** Codex (gpt-6-astra, xhigh) in two lanes, supervised by Claude

**App:** `ccheever/snapback-chat-exact` (private; the adapter branch `chat/snapback4-progressive` on `ccheever/exact2`)

## What was built

The Exact Snapback4 adapter (`exact2/snapback4`: a Rust sync client over `snapback4-device`, a native
and a wasm device, a TypeScript driver) did not speak `progressive-acquisition-v1`: it has its own sync
round in Rust, so Snapback's TypeScript client gaining the walk did nothing for Exact apps. Lane A
re-pinned the adapter to this revision and ported `local-acquisition.ts` and the runtime's round to
Rust (negotiation via `/schema`'s `device_compatibility.advertised`, `acquire {cursor, hint, skip}`,
one unit plus at most four ordinary drain pages per round, hints from the last eligible read, skips,
staged replacement on an old server, `status().acquisition` and `sync({ until: 'acquired' })`).
Two blind reviewers (Astra 0.88, Grok 0.78) rated it READY; a fix round followed Grok's findings.

Lane B scaffolded the template with `new.mjs`, wrote `snapback/schema.q` from the chat starter
(`sync last 1000 by byConvTime` per conversation, server keeps everything), a dependency-free seeder
through `POST /seed` (deterministic bursts over six months), replaced the file-backed `answer` with
Snapback reads and mutations, and added the progress UI: a banner with counts only (conversations on
this device, message images received; no percentage, per LLP 3000.001.001 §8), a cloud glyph per
conversation that disappears when the device answers its newest page complete, and the open
conversation landing next because it is the hint. Sixteen browser tests pass against a real seeded
server, including "the inbox is usable before history has finished syncing", "the open conversation
lands before the others", paging past the horizon from the server, and offline during acquisition.

## Where Snapback was easy

- The chat starter schema was reused almost verbatim; `check` passed first time. The seed door's
  contract (`{table, row}` upserts with explicit ids and times) was enough to build 15,000 rows with
  realistic timestamps; no fixture clock was needed.
- The device really did answer the hinted conversation complete while `acquired` stayed false, and
  the completion signal came from the device, not from row counts. The §8 guidance ("counts, not
  percentages") translated directly into a banner that never lies.
- Pages beyond the horizon were served by the same `thread(c)` query through the adapter's online
  fallback, with the test proving the row came from the server (it is outside the device's 1,000).

## Where Snapback got in the way (tickets filed)

- **`foregroundHint` rejects `Require` statements**, so the starter's own `thread` query (which begins
  with `require exists memberships[...] else MEMBERSHIP_REQUIRED`) never produces a hint, in Snapback's
  client and in the Rust port alike. The demo dropped the redundant guard (the table's read rule still
  enforces membership; a non-member read returns `data: []`). Ticket
  `issues/20261103-sb4-foreground-hint-skips-require-statements.md`.
- **A maintained count in the inbox projection blocks the early offline inbox read.** With
  `count: messageCounts[.conversationId]` in `inbox()`, the device's per-read admission (§5.2) includes
  the count's dependency on `messages`, so an offline inbox read answers `E_PREDICT` until message
  acquisition finishes. That is correct by the RFC and defeats the starter's "inbox first" intent. The
  demo removed the count from the projection. Ticket
  `issues/20261103-sb4-maintained-count-in-inbox-blocks-early-offline-read.md`.
- **No client knob for the acquisition page budget.** The adapter's fixed 10,000-row request packed
  nine of ten 1,000-row groups into the first page, so nothing visibly "progressed"; the demo first
  used a dev proxy that lowered `limit` on acquire requests, then the fix round added `acquireLimit`
  to the adapter's `Options`. Snapback's own client has no such option either; for a demo or a
  low-memory device that is worth exposing (noted here, no ticket).

## Exact and Contract observations

- Exact TypeScript cannot import npm packages (LLP 3000.034), so the whole feature had to be a Rust
  port inside the adapter, 1,300 lines with tests, done in 17 minutes of Codex time. That is the cost
  of the adapter owning its own round; it buys an offline device identical on web and native.
- The template assumed file persistence and `sent-N` ids; Snapback mints ids, so the demo keeps a
  small alias file for the template's send animation.
- Exact's `verify` runs its tests and its large-text tour concurrently when the app's server is
  external; both call `fresh` and reset the same Snapback store, so `verify` is not clean against an
  external backend (the sequential `test web` suite is).
- Generated scaffold text (AGENTS/CLAUDE blocks) still recommends snapback4 0.4.33; the adapter README
  now says 0.4.52 at this revision and that the retest is pending publication.

## Compared with React + Snapback's own client

Snapback's React client gets progressive acquisition with no app code (`useAcquisition`). Exact
apps pay for the Rust port once, then get the same facts through `status().acquisition`. The
Contract side was pleasant: one `task` that runs a round while `acquired` is false and refreshes
the inbox and the progress resource was the entire sync loop.
