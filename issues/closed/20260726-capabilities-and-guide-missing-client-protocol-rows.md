# Improvement: the capability index and guide have no rows or pages for the client protocol or non-JS clients

**Status:** Resolved 2026-07-26 · **Kind:** improvement (docs) · **Filed:** 2026-07-26
**Related:** LLP 0093 D5, `issues/20260724-llp-0093-rollout-execution.md`
**Evidence:** `demos/partitime/REPORT.md`, three clean-room client builds

## What

LLP 0093 D5 requires `guide/capabilities.md` to carry rows for the client
protocol document, the Swift client, the non-JS client gap, and the
`poll/hosted` gap. Verified 2026-07-26:

- `guide/capabilities.md` contains **zero** occurrences of swift, kotlin, dart,
  non-js, or protocol.
- `guide/protocol/` does not exist.
- `guide/clients/swift.md` does not exist.

So the entire wire protocol — the thing three implementers built clients
against this month — is invisible from the intent-indexed map that
`CLAUDE.md` tells agents to consult first.

## Why it matters now, more than when 0093 was written

The Partitime matrix put ten frontends on Snapback. **Seven of them had to
speak the raw protocol**, because the JS client can't carry an externally-minted
bearer (`20260726-snapback-client-cannot-carry-an-external-bearer`). Every one
of those authors started by reading `guide/` and finding nothing, then fell back
to `src/live_wire.rs`, the JSON schemas, and the LLPs.

The protocol is no longer an implementation detail behind a client — for a large
class of apps it *is* the integration surface, and it is undocumented in the
place people are told to look.

## Proposed

1. Add `guide/capabilities.md` rows: `clients.protocol`, `clients.swift`,
   `clients.non-js` (GAP), `clients.poll-hosted` (GAP).
2. Add a `guide/protocol/` page covering the route surface, the envelope
   families and their deliberately mixed casing, the version guard, and the
   `authorization_invalidation` lane. `demos/partitime/backends/snapback/CLIENT.md`
   §9.1b is a working ~70-line no-package browser client that can seed it.
3. Add `guide/clients/swift.md`, and decide the status of the Kotlin and Dart
   clients (see `20260726-first-party-clients-lack-the-invalidation-lane`).
4. Cross-link the fixture corpus as the conformance entry point.

## Precedent worth reusing

Every trap the three implementers hit was already written down *somewhere* —
usually an LLP or a Rust source comment. The failure was routing, not knowledge.

## Resolution

The capability index now carries `clients.protocol`, `clients.swift`,
`clients.non-js`, and `clients.poll-hosted`, with honest partial/GAP status for
unpublished Kotlin/Dart clients and unclaimable hosted polling. New guide pages
route authors through the protocol, Swift client, native authentication, and
framework-binding lifecycle contract. The protocol page covers the route and
envelope families, mixed casing, version guards, heartbeat, invalidation lane,
exact auth offers, demand release, and the committed conformance corpus.

`node scripts/check-guide.mjs` passes with all generated guide projections
refreshed.
