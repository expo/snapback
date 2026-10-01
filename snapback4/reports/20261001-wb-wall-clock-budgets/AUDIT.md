# Wall-clock budget audit

The census covers all 353 JavaScript/TypeScript/TSX sources under
`packages/snapback4/test/`, including helpers, nested fixture tests, embedded
browser/provider source, and the shared `witness/lib.mjs` test fixture used by
this suite. `audit.cjs` records both the starting commit and final source.
`classify.py` produces the site lists; those lists deliberately include clock
data, metrics and test stimuli so they are distinguishable from watchdogs.

- [BUDGET-SITES.md](BUDGET-SITES.md) lists **every original explicit timeout
  option**, by file and starting line, including deliberately retained options.
- [audit-before.tsv](audit-before.tsv) and [audit-after.tsv](audit-after.tsv)
  list every candidate call, loop, option, assertion and embedded-source line,
  its classification and source text. They include all `until`/`turns` calls,
  `Date.now`/`performance.now` uses, timer races and browser waits.
- [audit-sites.json](audit-sites.json) is the same census in structured form.
  Counts are syntax sites, not test cases; nested expressions may have more
  than one row. `clock-data-instrumentation-or-source-text` and
  `data-or-order-assertion` rows are explicitly **not timing budgets**.
- [converted-files.json](converted-files.json) is the affected test closure plus the full-count session model control,
  including tests importing a changed shared fixture. `inventory.py` computes
  it and binds all test inputs in the final source manifest.

## Converted incidental guards

`test/helpers/wait.mjs` supplies a browser-safe state poll and an independent
monotonic watchdog. Success requires the predicate/promise to finish. The
watchdog is `120_000 + 2_000 * max(1, work)` milliseconds: two minutes of
scheduling slack plus two seconds per declared work unit. It reports
`TEST_HANG`, the named transition, units, elapsed time and budget. It also
covers an asynchronous predicate that never returns. A timed-out poll stops
starting new attempts. Timers and the monotonic clock are captured before
Node timer mocking so freezing semantic time cannot disable the guard.

Ordinary test guards count awaited phases (syntactic awaits, a conservative
fixture estimate rather than a measured speed multiplier). Bulk files use
their operation/row/history counts: acquisition 600, column recovery and
timeline delivery 1,020, horizon tests 5,000, per-row work/React 1,000, sync
overflow 1,024, subscription pressure twice 124; search counts setup, up to six
inter-page changes, cleanup, differential histories, overlap writes and seed
batches; one-shot model counts 12 sessions × (18 events + close). Rust
fixture compilation has 300 build work units. Existing full-count SL model
guards remain: two seconds per hosted history, with their existing floors.
No seed, schedule, retry count or sample count is reduced.

The changes cover:

| Kind | Files/sites (complete individual lists in the census) | Replacement |
|---|---|---|
| Test `timeout:` literals and per-case constants | Every incidental option in BUDGET-SITES.md | `hangBudget(work)` |
| Local `until`, `turns`, bounded readiness loops | Every scoped helper and inline/browser loop identified as a progress watchdog | Shared state poll; retain predicate, assertions, diagnostics, React flushes and mocked-clock pumps |
| Child startup / HTTP / subprocess / browser waits | CLI helpers, app-server, routes, worker fixtures, release activation, browser pages, witness acquisition, identity qualifier | State/event readiness with independent work-scaled guard; browser action/navigation/launch guards use the same policy |
| Promise races for positive progress | Close/logout settlement, handler entry, worker completion, one-shot calls, model completion | Guard the actual promise, preserving the competing held work |
| Swift fixture startup/execution | expo-media-storage | Separate guarded phases; Darwin-only skip unchanged |
| Custom CLI/provider limits | witness acquisition `--timeout`, smoke/witness success setup, route provider, identity qualifier | Guard the actual work; malformed-input and intentional timeout cases retained |
| SQLite fixture lock wait | routes fixture diagnostics | Work-scaled busy guard, with actual query/transaction deciding success |
| Implicit browser defaults | Locally created pages and shared `witness/lib.mjs` | Set action/navigation guards at page/context creation; launch and server readiness guarded too |
| Short sleeps used for positive completion | Presence refresh/failed refresh, delivery response ordering, residency recovery, worker presence, offline answer marking, schema refusal, invalid input | Await the named state; hold a successor where needed to inspect the predecessor |
| Host elapsed-time ceilings | one-shot model completion; server-clock browser callback/recovery; HTTP lock-release probes; zero-wait mutation | State/promise/ordering barrier. Keep elapsed diagnostics where useful. Zero-wait mutation runs without advancing semantic timers. |
| Historical timestamp compared to later host time | server-clock wire stamps / issued requests | Request-sequence bracket or timestamp captured at issue; retain offset/identity/authority checks |

`live-propagation-fallback` still pumps only zero-delay mocked transport timers
and real event-loop turns. It does **not** advance expiry, sync or reconnect
semantic timers to make the answer arrive. Its two-unit guard is 124 seconds.
The initial branch cutoff is beyond the case watchdog and the server crosses it
only through the dev clock after the local-answer assertion. This also removes
the inherited one-second startup race. The held-query review uses a controlled
wall reader and crosses its cutoff at the first evaluation boundary.
The one-shot bound tests still assert the 30-second product lifetime and four
rounds, but fire the actual deadline callback only after transport/authority/
device entry; their former 80 ms acceleration was an incidental startup race.
Zero-wait admission holds product timer delivery through the global API while
keeping real Timeout handles and node:timers intact; a caller cannot pass by
waiting for a positive timeout, and the HTTP parser keeps its native timers.
Loaded fixtures also keep parked feeds healthy with heartbeats, wait for complete
worker diagnostic records separately from their start files, and release a
persisted schedule only after its input row exists in a stopped server. The
React-only 1,000-row mock fixes semantic Date time while waiting for actual
rendered answers; its three real-clock device counterparts are unchanged.
The search oracle and unread-range instrumentation use the existing Node
transport so local computation outliving an idle pooled socket does not
introduce a fixture-only transport path. No blanket error retry or oracle
acceptance is added. Search schema adoption waits for the exact new program
marker and the search program, so a watcher's intermediate truncation revision
cannot release the next query. The unread meter case waits for replica acquisition before
testing its query meter, separating bulk setup from product `waitSeconds`.
The page-exit persistence case explicitly holds its first exit response through
the second pagehide. The logout-tombstone case reads the non-idempotent audit
through an independent login family, so revocation of the tested session can
finish at any time. All refusal, persistence, count and answer assertions remain.
The original current-answer, present/absent, refusal, local/server, serverOnly,
and changeCut assertions remain; an explicit assertion also records that sync
is still held when the current server answer is visible.

The witness helper is test infrastructure, outside the requested audit
subdirectory but directly used by its browser tests. Leaving its five-second
startup guard and implicit browser defaults would have left those converted
callers dependent on a short fixed watchdog. No product source was changed.

## Retained legitimate timing / non-budget uses

Every retained candidate is listed in the TSVs. The following table gives the
reason for each family; these bounds were not silently relabeled as hang guards.

| Files / family | Retained values and reason |
|---|---|
| ephemeral-e2e | Five trials, 45 calls spaced 25 ms, first sight ≤500 ms, disappearance ≤life+500 ms, and 4 s life: explicit LLP 3000.017 §4.7 acceptance. The separate 5.5 s sampling loop measures the durable control, which may miss that bound without failing. Durable control numbers are measurements, not a pass/fail speed comparison. |
| ephemeral-adoption, ephemeral-watches | ≤500 ms adoption/notification delivery: the specified ephemeral notification path must beat refresh. |
| presence-live, presence-refresh, presence-local | Presence grace, refresh interval/floor, and negative observation windows. Positive refresh readiness uses a state barrier. Failed-refresh cases hold the next response before inspecting the retained answer. |
| expiry / typing / retention / delivery / per-row families | Semantic deadlines, explicit timer advances, bounded stale-display windows, renewal/debounce and no-retry observation windows. They test expiry/withdrawal/pacing or absence of forbidden work, not startup speed. |
| transport-http | ≤5 s silence/watchdog detection; ≥4.9 s healthy heartbeat survival. Real packet-silence policy. |
| keepalive-retry, keepalive-headers, keepalive-browser | Idle socket retirement (2.5 s observation of the one-second policy), five-second advertised keepalive boundary, held-response survival ≥5.9 s, and intentional stalls crossing that boundary. |
| admit-before-identity | 15 s admission timeout (14.9–16 s tolerance) and controlled browser advances; refusal/cleanup must occur when identity never arrives. |
| client-seams | Default/fractional `waitSeconds` semantic waits, including ≥3.9 s for the four-second local wait. The unrelated one-second real-host ceiling on zero-wait admission was converted. |
| asset-retry, asset-buffered, overload, online-store-order, store-reset-review | Retry-After/backoff floors, exact scheduled timer ranges, provider watchdog injection, and streaming progress beyond a five-second silent-body deadline. These assert product retry/transport policy. |
| server-clock-wire, clock/regression families | Clock offset/estimation tolerances and monotonic/expiry relationships. Historical stamps are checked at issue or against enclosing request time, not against completion of unrelated later work. |
| worker-regressions | Concurrent shutdown grace (TERM spread <1.5 s against a two-second grace) and increasing restart-backoff floor (four failures ≥1.4 s). These retain bounded shutdown/backoff behavior. |
| witness.test | `timeoutMs: 10` deliberately withholds a milestone and asserts the witness timeout. Successful witness scenarios use a hang guard. |
| native-smoke | `timeoutMs: 500` is driven by an injected clock advanced by the fixture; it is not a real-host deadline. |
| identity-recipe proxy lifecycle tests | 5 ms deliberately missing drain/exit controls; completed/synchronous cases' supplied 20 ms bounds do not wait on real work. Normal drain/close/child completion guards, including the four former 50 ms positive waits, are work-scaled. |
| server-e2e embedded provider | `AbortSignal.timeout(150)` deliberately injects a provider lookup timeout and verifies reconciliation/refusal. |
| measure-launch, publication-roundtrip | Numeric timeouts are expected mock/configuration data. Keep them equal to the production command being asserted; the surrounding real subprocess/test watchdog is separate. |
| Cleanup-only timers | Owned-child TERM→KILL escalation in local-e2e, routes and witness helpers bounds resource cleanup; it is not an assertion that a product operation completes in that interval. |
| Model and protocol iteration counts | Seed/sample loops, pagination/redirect bounds, fair model microtask drains, and report-count bounds are work/coverage assertions. They remain intact. |
| Poll sleeps, deliberate delayed replies, heartbeat emitters, one-turn drains | Schedule fixture input or yield between state checks. They do not stop a positive state poll after a fixed number of milliseconds. Negative windows retain their forbidden-publication/retry assertions. |
| `Date.now()` data and `performance.now()` diagnostics | Session expiry inputs, logical/server clocks, timestamps, IDs, latency reports and measured throughput. Retained unless they imposed an incidental pass/fail ceiling described above. |

The two-minute floor is a hang guard, not a promise that arbitrary scheduling
stalls can never exceed it. Product timing acceptance tests remain timing tests.
Linux runs retain Darwin skips; they do not establish Mac-only execution.
