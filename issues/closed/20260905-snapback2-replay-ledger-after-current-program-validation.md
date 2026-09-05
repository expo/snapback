# P1 Snapback 2: removing an operation prevents retrying its committed intent

**Status:** Closed
**Priority:** P1
**Systems:** owner mutation dispatch, replay decoding and intent ledger
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §7 (exactly-once replay), §8 (successors preserve outbox)

## Problem

Owner dispatch looks up the current operation before consulting the intent
ledger. A recorded committed response therefore cannot be retrieved after the
operation is removed. Trace decoding also occurs against the current schema
before the ledger, creating an analogous dependency on surviving tables and
indexes.

Sites:
- `snapback2/crates/snapback2/src/writer.rs:851–878`.
- `snapback2/crates/snapback2/src/writer_replay.rs:111` — decode before ledger.

## Real-owner reproduction

1. In a checked scratch project, author:

   ```q
   mutation echo(value: text <=20):
     return value
   ```

   Save as `snapback/review.q` and wait for `review.echo` in the manifest.
2. Create a guest session through `POST /api/auth/guest`; keep its token and grant.
3. Send this replay request with the bearer:

   ```js
   {
     op: "review.echo", args: {value: "once"},
     replay: {
       grant: grant.id, offset: 0, count: 1,
       intent: grant.id + ":0", trace: {points: [], verdicts: []}
     }
   }
   ```

4. Repeat the identical request; both responses are the same committed terminal.
5. Remove `review.q`, wait for the hot successor to remove the operation,
   then resend the same request.

Observed: HTTP 404 `E_OP_UNKNOWN: unknown operation review.echo`, despite the
stored committed terminal. Operation removal was reproduced; trace-schema
rotation is the analogous path identified by code inspection.

If the original response was lost, this can leave a committed write queued.
The client stops the FIFO on this non-offline-family refusal.

## Resolution and acceptance

Authenticate first, parse and fingerprint the stable replay bytes, then
consult the stored terminal before validating against the current program
or decoding trace values through its schema. Retain current validation for
unsettled requests.

Verify byte-identical committed and rejected retries across operation removal,
kind changes and traced-schema changes. Keep live-session authorization and
different-bytes `E_OFFLINE_INTENT_REUSE` checks intact.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.

## Resolution — 2026-09-05

Mutation dispatch authenticates the live session, fingerprints the stable
replay envelope, and consults the intent ledger before current operation,
kind, or schema-dependent trace validation. New intents still undergo all
current validation. Different bytes still refuse E_OFFLINE_INTENT_REUSE.

The 11 passing replay owner tests include committed and rejected terminals
across operation removal, kind changes, trace key/index/table changes, and
fresh, foreign, or dead sessions.

The complete package run passed 364 tests with one existing skipped
process-control placeholder; no package tests failed. The implementation,
regressions, and guide/LLP updates ship together with this ticket closure.
