# Volatile query offline fails with a raw untyped `fetch failed`

**Date:** 2026-08-04
**Status:** Open
**Area:** `@expo/snapback-client` — offline answer classes

## Problem

Hands-on smoke of the landed local-first loop (triage-graph demo,
backend stopped): a fresh client that renders the retained relational
query perfectly (`authoritative` / `retained`, 59 ms) then asks for the
VOLATILE `triageGraph` snapshot-batch query and gets a bare
`TypeError: fetch failed` — `error.code` is undefined. An app author
handling offline can't distinguish "network down, query volatile by
design" from any other transport failure, and nothing points them at
the answer-class model.

LLP 0166 §D4 has the vocabulary for exactly this (`unknown` / `refused`
answer classes; server-only degradation as an ordinary inspectable
outcome). The client should either answer volatile-offline reads with a
classified non-renderable answer (answerClass `unknown`,
`freshness: null`, rows null) or throw a typed
`SNAPBACK_*` offline error naming the volatile-retention reason —
either way, not a raw fetch error.

Contrast: asking with WRONG args offline fails fast with the good typed
`SNAPBACK_ARGUMENT_VALIDATION_FAILED` naming the function — argument
validation correctly precedes transport. The transport-failure leg is
the only untyped path.

## Evidence

Smoke transcript 2026-08-04 (session scratch): retained relaunch
`authoritative/retained` 50 rows in 59 ms; volatile probe fails in 4 ms
with `fetch failed`, no code. Reproduce: boot the triage demo per
`tests/acceptance/triage-graph-move1-v1.mjs`, stop the server, fresh
client, `liveQuery(api.triageGraph, { args: { boardId } })`.
