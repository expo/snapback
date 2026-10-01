# WB round 1 — re-audit of the conversions

The base is round 0, `33b412a54b` (parent `91a111cd85`). Read the original
prompt/report and Astra's complete review. The two questions for each conversion
are whether its former deadline encoded a product guarantee, and whether its
new completion predicate actually observes the condition its assertion names.

Scope: **205 changed test/infrastructure files**, within round 0's census of
353 JS/TS/TSX sources and 584 original explicit timeout options. The affected
execution closure was 235 files; it is not the count of edited files. This
round's execution scope is the three edited test files, not that entire closure.

[conversion-index.json](conversion-index.json) binds every edited round-0 file
to its content and records removed assertions and races.
[semantic-removals.tsv](semantic-removals.tsv) indexes the deleted time, delay,
race and assertion lines. [reviewed-semantic-hunks.txt](reviewed-semantic-hunks.txt)
retains 98 selected hunks with their replacement/context. These aid the code
review, not an automated proof of equivalence. Also inspected the generic
helper replacements and their calling predicates, changed fixture setup, and
the remaining product-timing checks in the final files. The complete site
inventory remains [round 0's census](../audit-after.tsv) and
[timeout list](../BUDGET-SITES.md).

| Conversion family | Actual condition / surviving timing proof | Disposition |
|---|---|---|
| `presence-refresh` first answer | Interval measured after answer settlement; no refresh at 299 ms and a real query at 300–301 ms, followed by the actual published answer | Fixed. Round 0 had only a lower bound plus eventual completion. Fixture completion uses the independent real `withHangGuard`, including while Date and timers are frozen. |
| `presence-live`, online/native/web | Real server supplies 5000 ms; all watches schedule that interval; no early mark; the actual mark and composed answer turn after advancing only to 5001 ms. Subsequent refresh and departure each get one 5000 ms step | Additional instance found and fixed. The former 8000/6500/20000 ms waits and 6000 ms observation had lost the interval obligation. Only presence scheduler timers are controlled; real HTTP, watchdogs, devices and server grace remain. A raw server query establishes Bob's arrival/departure before the client interval advances. |
| Other presence readiness, refused/failed/overtaken answers, composed reads | Actual watch/answer identity, link and query-entry predicates; held successor preserves the failed answer for inspection. Floor/clamp and negative windows remain; the corrected interval cases above cover both client implementations and all three real-device tiers | No further lost bound found. These answer/fence checks need fixture completion, not a host deadline. |
| `http-bounds` paused output | Reset latency arrival window; bytes prove response entry; recorded `/q/ping` completion with `/sync.n = 0`; after releasing socket require `/sync.n = 1` | Fixed. Socket flags remain client-state checks only. The unchanged server writer timeout cannot satisfy the new unfinished-response assertion. |
| `http-bounds` eight held polls | Response/body settlement count before and after health/schema/query work, then committed sequence/table wakeup | Tightened error accounting: rejected bodies now increment completion too. Previously `.catch` could leave a failed poll counted as held. Actual response bodies remain unfinished through the probe; polling duration is not used as success evidence. |
| `live-propagation-fallback` / propagation | Actual current whole-server answer, source/order/classification/replica-fence assertions, plus held sync flag; semantic cutoff crossed only through the dev clock | Unchanged. No timer advances make fallback complete. Round-0 delayed/withheld publication controls and Astra's independent controls remain applicable; no claim to have rerun those controls this round. |
| One-shot bounds/model/review | Actual query result while transport/authority/device gates remain held; production lifetime still 30000 ms, four rounds; explicitly fire the registered production deadline after entry | Model host-time ceiling was incidental, with the lifetime proved separately by the controlled deadline cases. Expected refusal code and late-answer fencing remain. |
| `client-seams` zero wait | Caller returns with positive product timers held and acknowledgement still held; pending result checked | No proxy substitution: asynchronous admission completes without spending a positive wait timer. Fractional/default four-second timing checks remain. |
| App close/logout, effectful cancellation, replacement, local signout, online terminal writes | Await actual caller promises with expected state/refusal; gates release afterward or during cleanup | Held fake bodies have no independent release timer. Increasing the fixture guard cannot release them. Persistence/authority barriers that must block close are still asserted separately. |
| Retention, withdrawal, expiry and typing | One-second episode boundaries, controlled timer advances, retained identities, nextExpiry and explicit no-publication windows | Unchanged semantic boundaries. State polls wait for setup/answers; they do not advance the semantic clocks. |
| Per-row scheduling, work, retry, subscription pressure | Eight starts per turn/eight active, 1000 logical reads, 25 ms retry, retry rounds, retained answers and one-second withdrawal | Counts and semantic timers remain. No queue/start/sample bound became eventual work. |
| `server-clock-browser` | Controlled `server-clock-regressions` still requires withdrawal within 16.7 ms and publication on a 1 ms recovered-floor crossing without delivering a wall timer | Host callback lateness is a measurement; the actual deadline/clock-correction semantics have explicit controlled checks. Browser answers/withdrawals remain observed. |
| `server-clock-wire` | Offset compared at request observation or bracketed by the request sequence; generation/store/authority checks remain | Removes comparison of old timestamps to completion of later unrelated work. No expiry, refresh or retry interval is being accepted by these brackets. |
| Ephemeral, transport, keepalive, admission, worker shutdown/backoff | 500 ms ephemeral delivery, silence detection/heartbeat survival, 15 s admission timeout, shutdown spread and restart-backoff floors, Retry-After checks | Explicit acceptance bounds remain; surrounding fixture guards alone changed. |
| Delivery, outbox, adoption, residency, search, session models | Actual observed head count, persisted write/read, loaded schema marker, answer identity, page oracle or terminal state | Positive sleeps became those states; row/seed/history/page counts remain. Model logical progress bound remains 100 clock steps; search keeps 300 seeds and session models 5000 sequences per tier. |
| Worker/provider/route/proxy lifecycle | Actual handler-entry, finished worker, recorded diagnostics or closed response; supplied short *negative* timeout controls remain | Readiness guards do not stand in for provider outcome or drain completion. The named failure/cleanup assertions remain. |
| Child/browser/Swift startup, aggregate test options and shared witness fixtures | Readiness events, complete promise or whole fixture with unchanged content assertions | Incidental scheduling budgets. Darwin-only and credentialed manual qualifiers remain unexecuted here; no claim beyond the Linux scope. |

The original audit's general claim that the presence interval remained intact
was too broad. This amendment replaces that claim for the presence rows and
corrects the slow-reader claim. No additional changes to product code, timing
policy, samples, seeds, skips, or suite concurrency were made.

## Governing context (`llp-orient`)

Scope: the three client test files, their wait helper, the presence scheduler,
and server response completion records. The checkout's skill symlink is empty;
used the existing `llp-orient` SKILL.md in the local enginefix lane read-only.

- [LLP 3000, publication suite under contention](../../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention), in `current`: state/ownership evidence and independent guards; timing semantics must survive conversion.
- [LLP 3000.018 §3.2–3.3](../../../../llp/3000.018-a-live-query-follows-presence.rfc.md#3-design), Implemented, archived from `current`: the settled reply supplies the interval; background failure/overtaking/closure rules remain. The presence guide card confirms the current five-second surface.
- [LLP 3000.019 §3.7](../../../../llp/3000.019-what-the-builder-still-wrote.rfc.md#37-p11-the-server-knows-its-own-p95), in `current`: completed HTTP response writes/failed transport count; reset excludes requests accepted before its new window.

No new design decision or production documentation is needed. Update this
report and append the journal; preserve earlier reports as history. Hand-off:
none. Limits: the real HTTP blocked-response assertion can correctly fail if
host suspension outlasts the actual server timeout; it must not count that as a
held response. These checks are not a wall-clock performance qualification.
