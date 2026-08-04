# Volatile query offline fails with a raw untyped `fetch failed`

**Date:** 2026-08-04
**Status:** Resolved 2026-08-04
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

## Resolution

The client now emits the new client-side code
`SNAPBACK_QUERY_OFFLINE_UNAVAILABLE` when `query` or initial `liveQuery`
establishment loses transport and LLP 0166 §D4 supplies no authoritative
retained answer. No existing code fit: `SNAPBACK_HTTP_ERROR` requires an HTTP
response, `SNAPBACK_QUERY_HYDRATION_FAILED` is an internal fallback label, and
`SNAPBACK_MICRO_TRANSPORT_FAILED` belongs to the separate Micro surface.

The error is named `SnapbackQueryOfflineUnavailableError`; its diagnostic
names the function, declared retention class, `volatile`/`retainable`
disposition, and the would-be local `{ answerClass: "unknown", freshness:
null, reason }`. Its `cause` is the sanitized original fetch-dispatch failure.
Generated `liveQuery` argument validation now runs at the public call boundary,
before auth discovery, store preparation, or establishment transport. The
retained-authoritative fallback branch is unchanged and returns before the new
wrapper; mutation paths are unchanged. Runtime and declaration exports include
the code and diagnostic/error interfaces.

Regression coverage lives in the existing maintained client files, so the
canonical inventory remains 195 total / 49 client files. Verification:

- focused argument validation passed; focused materialization bridge passed
  4/4, including volatile `query` + `liveQuery`, wrong-args-before-fetch, and
  the existing proof-backed `authoritative`/`retained` relaunch;
- 44/44 non-loopback client files and both strict TypeScript fixtures passed;
- the five loopback files (`app-data`, `assets`, `attribution`,
  `push-registry`, `wire-version`) each failed only with the expected sandbox
  `listen EPERM` on `127.0.0.1`;
- package-test inventory passed 195/195 and `ref-check --verbose` passed with
  168 LLP documents, 3,244 references, 7,186 files, and zero errors/unchecked.

The repository-wide export-type checker still reports the unrelated existing
`@expo/snapback-codegen` declaration omission for
`validateTrustedCompositionActivationV1`; no Codegen surface was changed here.
