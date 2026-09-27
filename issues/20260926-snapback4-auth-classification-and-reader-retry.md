# Snapback 4: one authentication classification for every session-ending path; reader-factory retry diagnostics

- **Opened:** 2026-09-26, from Astra's final review of lane AD (0.4.4),
  `~/sb4-intent/reviews/ad-r4.astra.md` on the lane host.
- **Severity:** Low for 0.4.4. The server sends no retryable `E_AUTH` today:
  its only retryable auth-family refusal is `E_RATE_LIMIT` (HTTP 429,
  `auth.rs`), which these paths do not match. Hardening, not a live defect.
- **Area:** `packages/snapback4/src/client.ts`, `local.ts`; `crates/snapback4/src/serve_readers.rs`.

## 1. Classify authentication once

Lane AD made `loadBackend` (`local-backend.ts`) treat only HTTP 401, or
`E_AUTH` without `retryable`, as a failed login, so a retryable 503 on
`/schema` keeps the saved session. Other session-ending paths still end the
session on any current-credential `E_AUTH`, whatever `retryable` says:

- online schema discovery (`obsoleteRefusal()`, `client.ts:191`, `439`);
- session refresh (`client.ts:410`, `local.ts:456`);
- local startup refreshing a session near expiry;
- `refusedSession()` (`local.ts:411`), reached from the probe and change-feed
  handlers.

Astra reproduced each with a fetch double answering HTTP 503
`{denied:{code:"E_AUTH", retryable:true}}`. Use one classifier at every
session-ending boundary, and keep the HTTP status where helpers now see only
the refusal. Add online-schema and near-expiry startup regressions. Keep the
real-auth sign-out cases.

## 2. A missing reader factory keeps its reason and backs off

`QueryReaders` retries a missing detached-reader factory from writer-owned
maintenance (`serve_maintenance.rs`), but each failed attempt becomes `None`
(`serve_readers.rs:66`). Reads then get only "detached reader unavailable;
retry", even when the cause is permanent and actionable. For example, a
database replaced at its path fails the inode check with "stop and reopen
the current path". Retries also run on every `engine_work` call, including
successive chunks, so there is no rate bound under backlog.

Keep the last reader-open refusal, report distinct failures without
flooding, and return its diagnostic while the factory is missing. Limit
attempts to a maintenance interval or a small backoff.

Also cover retries while the fault persists. The recovery test restores the
database before the first maintenance retry, so
`self.source = Some(engine.reader().expect(..))` would survive it. Run
maintenance with the fault still in place, require continued service and a
prompt refusal, then clear the fault and see recovery.
