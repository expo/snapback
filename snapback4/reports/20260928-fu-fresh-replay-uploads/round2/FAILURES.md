# Round-2 failure ledger

The single full run exited 1: `== 1 failure(s) in 1270 s`. Its only failing category was client tests: 2 failures and 8 timed-out/cancelled tests, all ours. All ten pass in the final affected reruns. No baseline or environmental failure remains from that full run. The unchanged W13 scope passes.

Each test below is listed once per run; runner reprints of the same failure are not counted twice. Expected negative controls are deliberately separated from qualification failures.

| Run | Failed cases | Classification |
| --- | ---: | --- |
| public-before | 24 | baseline; expected negative |
| affected-first | 8 | ours |
| affected-second | 1 | ours |
| matrix | 2 | ours; test harness |
| affected-broad | 1 | ours; test maintenance |
| audit-before | 37 | baseline; expected negative |
| no-mutation-jitter | 2 | ours; expected mutation |
| audit-final-before | 44 | baseline; expected negative |
| grok-client-after | 3 | ours; test harness |
| grok-client-before | 4 | baseline; expected negative |
| grok-recovery-final | 1 | ours; test harness |
| http-final | 1 | environmental; timing |
| no-mutation-jitter-final | 2 | ours; expected mutation |
| spawn-after | 1 | ours; test harness |
| spawn-before | 1 | baseline; expected negative |
| test-sh | 10 | ours; test maintenance |
| spawn-no-guard-final | 1 | ours; expected mutation |

## public-before

Log: `public-before.log.gz`.

- **baseline; expected negative** — public asset rotation preserves ECONNRESET without consuming another view. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public asset rotation preserves invalid without consuming another view. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public asset rotation preserves success without consuming another view. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — online: public ephemeral refusal preserves queued calls and never replays. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — web: public ephemeral refusal preserves queued calls and never replays. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public fresh web schema recover retains startup cause. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public fresh web schema exhaust retains startup cause. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public fresh web schema reset retains startup cause. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public fresh web schema invalid retains startup cause. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth guest: invalid retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth guest: reset retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth guest: unreachable retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth signup: invalid retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth signup: reset retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth signup: unreachable retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth login: invalid retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth login: reset retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth login: unreachable retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth refresh: invalid retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth refresh: reset retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth refresh: unreachable retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth logoutAll: invalid retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth logoutAll: reset retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.
- **baseline; expected negative** — public auth logoutAll: unreachable retains cause with one request. Round-1 SDK rejects 24 new public API guarantees; repaired in round 2.

## affected-first

Log: `affected-first.log.gz`.

- **ours** — rate/capacity refusals preserve online; malformed transport goes offline. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.
- **ours** — argument custody and closed request settle without waiting for fetch. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.
- **ours** — online assets revoke late credential-bound URLs across rotation, sign-out and close. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.
- **ours** — schema startup 503/E_STORE/true: keeps saved session offline. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.
- **ours** — schema startup 503/E_AUTH/true: keeps saved session offline. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.
- **ours** — schema startup 403/E_STORE/false: keeps saved session offline. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.
- **ours** — schema startup 200/E_STORE/true: keeps saved session offline. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.
- **ours** — schema startup 401/E_AUTH/true: forgets refused session. Corrected ephemeral close handling, required refusal fixture fields, schema 401 terminality, and old link/asset replay expectations.

## affected-second

Log: `affected-second.log.gz`.

- **ours** — schema startup 503/E_AUTH/true: keeps saved session connected. Retryable E_AUTH must not sign out the saved client during follow-up sync; terminal E_AUTH remains terminal.

## matrix

Log: `matrix.log.gz`.

- **ours; test harness** — 42 transient: local.ts:829 waitForChange. The moved refusal wait is reached only for a delivered refusal; updated the fault recipe to supply one.
- **ours; test harness** — 42 persistent: local.ts:829 waitForChange. The moved refusal wait is reached only for a delivered refusal; updated the fault recipe to supply one.

## affected-broad

Log: `affected-broad.log.gz`.

- **ours; test maintenance** — a delayed transient conversion cannot publish an obsolete session's asset. Removed the old expectation of a second GET after a successful asset response during rotation; lifecycle tests pass.

## audit-before

Log: `audit-before.log.gz`.

- **baseline; expected negative** — public asset rotation preserves ECONNRESET without consuming another view. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public asset rotation preserves invalid without consuming another view. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public asset rotation preserves success without consuming another view. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — online: public ephemeral refusal preserves queued calls and never replays. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — web: public ephemeral refusal preserves queued calls and never replays. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public fresh web schema recover retains startup cause. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public fresh web schema exhaust retains startup cause. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public fresh web schema reset retains startup cause. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public fresh web schema invalid retains startup cause. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth guest: invalid retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth guest: reset retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth guest: unreachable retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth signup: invalid retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth signup: reset retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth signup: unreachable retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth login: invalid retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth login: reset retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth login: unreachable retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth refresh: invalid retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth refresh: reset retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth refresh: unreachable retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth logoutAll: invalid retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth logoutAll: reset retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public auth logoutAll: unreachable retains cause with one request. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — online: public changes refusal classifies delivered refusals separately. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — web: public changes refusal classifies delivered refusals separately. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — online: public session rotation reset schedules only proven refusal retries. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — online: public session rotation invalid schedules only proven refusal retries. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — web: public session rotation reset schedules only proven refusal retries. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — web: public session rotation invalid schedules only proven refusal retries. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public saved web backend opens connected after exhausted schema overload. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public web asset reset retains cause, rotation=false. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public web asset unreachable retains cause, rotation=false. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public web asset overload retains cause, rotation=true. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public web asset reset retains cause, rotation=true. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public web asset unreachable retains cause, rotation=true. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.
- **baseline; expected negative** — public web asset invalid retains cause, rotation=true. Copied round-1 SDK fails the requested and additional audit regressions; no worktree source changed.

## no-mutation-jitter

Log: `no-mutation-jitter.log.gz`.

- **ours; expected mutation** — online: public mutation overload uses deterministic jitter and Retry-After. Both public mutation tests fail when jitter is removed; mutations exist only in an ignored SDK copy.
- **ours; expected mutation** — web: public mutation overload uses deterministic jitter and Retry-After. Both public mutation tests fail when jitter is removed; mutations exist only in an ignored SDK copy.

## audit-final-before

Log: `audit-final-before.log.gz`.

- **baseline; expected negative** — public asset rotation preserves ECONNRESET without consuming another view. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public asset rotation preserves invalid without consuming another view. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public asset rotation preserves success without consuming another view. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public asset rotation preserves terminal-overload without consuming another view. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — online: public ephemeral refusal preserves queued calls and never replays. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — web: public ephemeral refusal preserves queued calls and never replays. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public fresh web schema recover retains startup cause. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public fresh web schema exhaust retains startup cause. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public fresh web schema reset retains startup cause. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public fresh web schema invalid retains startup cause. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — online: public mutation overload uses deterministic jitter and Retry-After. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — web: public mutation overload uses deterministic jitter and Retry-After. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth guest: invalid retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth guest: reset retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth guest: unreachable retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth signup: invalid retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth signup: reset retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth signup: unreachable retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth login: invalid retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth login: reset retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth login: unreachable retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth refresh: invalid retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth refresh: reset retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth refresh: unreachable retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth logoutAll: invalid retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth logoutAll: reset retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public auth logoutAll: unreachable retains cause with one request. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — online: public changes refusal classifies delivered refusals separately. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — web: public changes refusal classifies delivered refusals separately. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — online: public session rotation reset schedules only proven refusal retries. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — online: public session rotation invalid schedules only proven refusal retries. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — web: public session rotation reset schedules only proven refusal retries. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — web: public session rotation invalid schedules only proven refusal retries. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public saved web backend opens connected after exhausted schema overload. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public web asset reset retains cause, rotation=false. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public web asset unreachable retains cause, rotation=false. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public web asset overload retains cause, rotation=true. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public web asset reset retains cause, rotation=true. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public web asset unreachable retains cause, rotation=true. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public web asset invalid retains cause, rotation=true. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — online: public probe overload recovers an offline link without adopting identity. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — web: public probe overload recovers an offline link without adopting identity. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — web: public sync overload recovers an offline link without adopting identity. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.
- **baseline; expected negative** — public transfers jitter beyond Retry-After and stop within their cumulative budget. Final round-1 SDK control: 44 failed public cases; fixed SDK passes.

## grok-client-after

Log: `grok-client-after.log.gz`.

- **ours; test harness** — online: public probe overload recovers an offline link without adopting identity. Changed probe trigger to the public connectivity event; restored query responses and excluded the unrelated zero-delay startup timer. Final affected selection passes.
- **ours; test harness** — web: public probe overload recovers an offline link without adopting identity. Changed probe trigger to the public connectivity event; restored query responses and excluded the unrelated zero-delay startup timer. Final affected selection passes.
- **ours; test harness** — public transfers jitter beyond Retry-After and stop within their cumulative budget. Changed probe trigger to the public connectivity event; restored query responses and excluded the unrelated zero-delay startup timer. Final affected selection passes.

## grok-client-before

Log: `grok-client-before.log.gz`.

- **baseline; expected negative** — online: public probe overload recovers an offline link without adopting identity. First Grok reproductions, superseded by final round-1 source controls; initial test harness also needed corrections.
- **baseline; expected negative** — web: public probe overload recovers an offline link without adopting identity. First Grok reproductions, superseded by final round-1 source controls; initial test harness also needed corrections.
- **baseline; expected negative** — web: public sync overload recovers an offline link without adopting identity. First Grok reproductions, superseded by final round-1 source controls; initial test harness also needed corrections.
- **baseline; expected negative** — public transfers jitter beyond Retry-After and stop within their cumulative budget. First Grok reproductions, superseded by final round-1 source controls; initial test harness also needed corrections.

## grok-recovery-final

Log: `grok-recovery-final.log.gz`.

- **ours; test harness** — snapback4/packages/snapback4/test/overload.test.mjs. Async cleanup restored removeEventListener too early. Close client before restoring globals; final affected selection passes.

## http-final

Log: `http-final.log.gz`.

- **environmental; timing** — serve::tests::ephemeral_tests::rate_and_input_refusals_are_http_200_failed_under_dev_and_serve. Existing token-bucket test assumes seven HTTP calls fit inside a 50 ms refill window; 96-way concurrent run crossed it. Unchanged test passes alone (0.03 s) and in the four-thread HTTP scope. No isolated baseline reproduction is claimed.

## no-mutation-jitter-final

Log: `no-mutation-jitter-final.log.gz`.

- **ours; expected mutation** — online: public mutation overload uses deterministic jitter and Retry-After. Both public tiers fail with jitter deliberately removed in the disposable copy; fixed SDK passes.
- **ours; expected mutation** — web: public mutation overload uses deterministic jitter and Retry-After. Both public tiers fail with jitter deliberately removed in the disposable copy; fixed SDK passes.

## spawn-after

Log: `spawn-after.log.gz`.

- **ours; test harness** — serve::tests::overload_tests::failed_thread_spawn_refuses_unfinished_upload_and_releases_permit. Use http_with_limits, matching the real server. Unbounded fixture had no refusal socket handle. Final test passes.

## spawn-before

Log: `spawn-before.log.gz`.

- **baseline; expected negative** — serve::tests::overload_tests::failed_thread_spawn_refuses_unfinished_upload_and_releases_permit. Old closure drops an unfinished request on failed spawn. Initial receiver fixture later changed to http_with_limits so the fixed refusal has its socket handle.

## test-sh

Log: `test-sh.log.gz`.

- **ours; test maintenance** — every delivery await is explicitly classified. Full runner loaded the census before late Grok source/manifest edits completed. Final matching sources/manifests pass the entire 315-case matrix.
- **ours; test maintenance** — packages/snapback4/test/overload.test.mjs. Full runner loaded the old async cleanup hook. Close-before-global-restore correction passes all 429 final affected cases, including this file.
- **ours; test maintenance** — online upload stops before retry when sign-out occurs during backoff. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.
- **ours; test maintenance** — online upload stops before retry when rotation occurs during backoff. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.
- **ours; test maintenance** — web upload stops before retry when sign-out occurs during backoff. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.
- **ours; test maintenance** — web upload stops before retry when rotation occurs during backoff. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.
- **ours; test maintenance** — online upload continues backoff after a completed transport refresh failure. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.
- **ours; test maintenance** — online upload continues backoff after a completed admission refresh failure. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.
- **ours; test maintenance** — web upload continues backoff after a completed transport refresh failure. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.
- **ours; test maintenance** — web upload continues backoff after a completed admission refresh failure. Legacy timer mocks intercepted 250 ms, before upload jitter. Pin randomness and intercept 281.25 ms; all 46 upload-lifetime tests now pass.

## spawn-no-guard-final

Log: `spawn-no-guard-final.log.gz`.

- **ours; expected mutation** — serve::tests::overload_tests::failed_thread_spawn_refuses_unfinished_upload_and_releases_permit. Final real HTTP test with only PendingRequest refusal disabled returns HTTP 500 after waiting on the unfinished body. Fixed guard passes.

## Setup failures

All setup failures were **ours**; none is product evidence:

- Two documentation-edit commands used repository-root paths from the Snapback 4 working directory and raised FileNotFoundError before editing; rerun from the root.
- The negative-control script initially imported TypeScript from package-local node_modules; corrected to workspace package resolution after ERR_MODULE_NOT_FOUND.
- The isolated Rust negative copy omitted app and benchmark files needed by include_str; copied/linked those fixtures, then ran the actual negative test. The initial compile failure is retained in `spawn-no-guard-setup.log.gz`.
- Exploratory reads named nonexistent source files or were truncated; replaced by focused reads of the located files.

The only environmental test failure was the existing real-time HTTP rate-test assumption under the default highly parallel run. Its exact name and evidence are above. No isolated baseline reproduction is claimed.
