# DK round 2 — preserve refusal envelopes through every affected path

Date: 2026-10-07. Revision base: `787672f000` (round 1).
Branch: `sb4-intent/dk-dev-clock-and-stale-sessions`.
This report supersedes the round-1 report preserved in that commit. Round-1
[benchmark source](round1/benchmark.py) and [raw measurements](round1/production-scale.json)
remain available. Work stayed in lane DK on eb1000; no other worktree/process
was modified, nothing was published, and nothing was pushed.

## Review dispositions

Read Astra's round-1 READY WITH CHANGES review and evidence, and Grok's round-0
review. Implemented the four requested follow-ups:

1. **Restored foreign token on a device app.** A failed provisional opening now
   passes its terminal E_AUTH into the signed-out facade when no valid previous
   owner will be restored. `app.ready`, `app.auth.why`, and subsequent
   `app.online.query`, `mutate`, and `act` keep the same refusal. The regression
   saves a real token from store A under store B's URL, restores a device app,
   compares the three facade results with the ready/auth refusal, then signs in
   successfully to prove the stale cause is replaced. Never-signed-in online
   and device apps retain the generic sign-in message. Previous-owner recovery
   and retryable failures keep their existing behavior.
2. **Uniform identity-door envelopes.** Logout and narrow still authenticate
   inside their original writer transactions. After an authority refusal, the
   HTTP adapter produces the same diagnostic `Refusal` as data requests.
   Refresh's initial recheck and post-resolution `None` fallback, plus the
   logout-all recheck, preserve the actual envelope instead of wrapping its
   sentence in `RuntimeError::Auth`. Terminal refused bearers receive HTTP 401,
   code `E_AUTH`, family `auth`, `guide: personas`, and no `E_AUTH:` prefix in the
   message. Retryable refusals keep HTTP 503. Live credentials of the wrong kind
   keep their operation-specific explanation; no authority decision is widened.
3. **Local logout everywhere.** An already-dead local session returns its retained
   cause from `logoutAll`, falling back to the existing sign-in instruction only
   when no cause exists. The reason matrix now asserts this for every dev/serve
   message, as well as ordinary query/mutation/action calls.
4. **Startup inspection.** Round 1 already read no application row IDs or images:
   it traverses at most 64 recent commit records and materializes only bounded
   table metadata after checking `octet_length`. That query is unchanged. The
   new real-startup control corrupts an application row image while preserving
   a future commit and proves dev still starts and reports the commit note.
   Round 1 still propagated SQL/commit-decoding errors from the advisory check;
   round 2 prints `clock     store-ahead inspection unavailable: …` and continues
   startup. A second control uses an unreadable commit timestamp and verifies
   this path. Ordinary store/schema admission remains authoritative; the change
   does not repair corrupt application rows or suppress operation failures.

## Privacy, format and clock scope

Detailed explanations still require dev mode and the existing dev-only endpoint
peer/Host/Origin check. Serve and untrusted dev public routes use exactly
`this session is not live; sign in again` for unknown, expired and ended tokens.
No token history, process cache, schema change or new public refusal field is
introduced. Missing records remain explicitly ambiguous; trusted-dev advice is
to sign in and discard saved earlier-store tokens.

The expanded controls cover full/read credentials, unknown, retained-expired,
signed-out and refreshed tokens across query, schema, changes, actions,
refresh, logout, narrow and logout-all. They assert status, code, family, guide,
message and absence of a token or message-code prefix. Public-route trust
controls remain in the same suite. A deterministic test expires the token
between refresh's initial resolution and rotation, exercising the fallback in
both dev/serve and full/read modes. Full rotation prunes its expired row, so its
cause becomes unknown; read rotation retains expiry evidence. Both envelopes
are preserved correctly.

Clock detection remains historical evidence from the newest 64 commits. Older
future commits can be missed even with their rows remaining, and commit evidence
can outlive deleted rows. The tolerance, largest lead, bounded table-name output,
doctor offset, cumulative advance/restart wording and isolated
`dev --fresh --port 4401` recipe remain unchanged. No application image is read
by this check, even when future commits exist.

No startup benchmark was rerun in round 2: the bounded inspection query did not
change. The retained round-1 measurements were 4.918–5.681 ms against published
0.4.14's 5.404–6.565 ms on the 100,001-row fixture; Astra independently confirmed
5.27–6.07 ms against 6.57–6.72 ms. These are prior-round measurements, not a new
performance claim for this commit.

## Validation

- SDK build/declaration generation and typecheck passed. No public type changed.
  The supplied dependency checker printed `deps-ok` when run from `snapback4/`.
- Focused SDK reason suite: **33 passed**, including restored foreign tokens,
  local logout-all preservation, replacement by new sign-in and ordinary
  never-signed-in controls.
- Focused HTTP door suite: **3 passed** (expanded matrix, public trust boundary,
  deterministic refresh fallback).
- Affected HTTP tests: **193 passed, 4 ignored** (existing child-process fixture
  entry points). Auth helper tests: **4 passed**.
- Clock integration: **23 passed**, including both malformed-store startup
  controls. Bounded clock metadata/tolerance unit tests: **2 passed**.
- Replay/dev-refusal integration: **43 passed**.
- Core identity unit tests: **6 passed**; identity/read-session/bound-session
  integrations: **17 passed**.
- SDK reason/session-security/read-only/app-session regression selection:
  **231 passed, 1 skipped**. The existing skipped downgrade test requires a
  separate verified published 0.4.13 binary, which was not supplied for this run.
- App restoration/account-custody regressions (`app.test.mjs`, `app-state.test.mjs`):
  **92 passed**, including prior-owner recovery and concurrent replacement.
- App-session model: **52 passed**, including **5,000 online and 5,000 local**
  seeded three-runtime sequences at normal counts (251.98 seconds total).
- Guide checks: **113 passed**.
- Root `./ref-check --verbose`: **531 LLP documents, 10,540 references,
  zero errors and zero unchecked**.
- `git diff --check`: passed.

No wasm or device-engine source changed; no wasm rebuild or budget adjustment
was needed. The TypeScript local client changed only its existing refusal choice.
This is affected-scope verification, not a complete-repository-battery claim.

Commands from `snapback4/`:

```sh
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
bash ~/sb4-intent/check-sdk-deps.sh
cargo test -p snapback4 --bin snapback4 session_diagnostics_tests
cargo test -p snapback4 --bin snapback4 serve::
cargo test -p snapback4 --bin snapback4 auth::
cargo test -p snapback4 --bin snapback4 dev_clock_store
cargo test -p snapback4 --test clock
cargo test -p snapback4 --test dev_refusals --test replay
cargo test -p snapback4-core --lib identity
cargo test -p snapback4-core --test identity --test read_sessions --test bound_session
cargo test -p snapback4-lang --test guide
node --test --test-concurrency=4 packages/snapback4/test/session-reasons.test.mjs packages/snapback4/test/session-security.test.mjs packages/snapback4/test/read-only*.test.mjs packages/snapback4/test/app-local-session.test.mjs packages/snapback4/test/online-session.test.mjs packages/snapback4/test/app-online-arm.test.mjs packages/snapback4/test/app-online.test.mjs packages/snapback4/test/app-store-replacement.test.mjs
node --test --test-concurrency=2 packages/snapback4/test/app.test.mjs packages/snapback4/test/app-state.test.mjs
node --test packages/snapback4/test/app-session-model.test.mjs
```

Run `./ref-check --verbose` from the repository root.

## Governing documents

Updated LLP 3000.007 §20.2 (uniform identity refusals, restored facade and local
logout-all custody) and §20.12 (advisory inspection failure), including Revised;
the services/jobs guide cards; client/operations documentation; and the
append-only JOURNAL. No engine authority, store format or generated public
contract changed.
