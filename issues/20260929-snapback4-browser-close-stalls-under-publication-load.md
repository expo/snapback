# Snapback 4: browser close/cleanup stalls during the 0.4.9 publication suite

Status: Open — baseline observation; root cause unconfirmed.
Date: 2026-09-29
Systems: Snapback 4 browser clients and test cleanup

The office M1's publication attempt 2 timed out in several real Chromium
fixtures. The original log is preserved in
[Lane SL's report](../snapback4/reports/20260929-sl-suite-under-load/attempt-2-publication-dry-run.log),
with exact stacks in its adjacent `.summary.json`.

- `typing-expiry.test.mjs`, aged 3000 ms: the successful expiry diagnostic
  precedes the 30 s parent timeout. This does not establish an expiry assertion
  failure; the subsequent `closeClients`/browser/server cleanup needs tracing.
- `web-admission-review.test.mjs`: its first case lasted 176.463 s; the stack
  points to `app.close()` at line 318 when the 180 s parent closed the browser.
- `web-session-authority.test.mjs`: its first case lasted 116.321 s; the stack
  points to peer `app.close()` in cleanup, line 181, when the 120 s parent ended.
- `web-start.test.mjs`: the session-locked logout case lasted 107.462 s.
  The reported line 302 is the `finally` block's peer evaluation after the
  parent closed the browser; it can mask the original stalled evaluation.
  Do not infer the original wait from that cleanup stack alone.

Later `Target page, context or browser has been closed` failures are cascades,
not evidence of distinct product defects. None of these close stalls is proved
fixed by making the admission parent's budget proportional to its scenarios.
The separately reproduced five-second orphan-response timeout is tracked in
[the existing orphan-binding ticket](closed/20260929-snapback4-orphan-binding-response-timeouts.md).
The earlier typing render assertion is tracked in
[the typing-expiry ticket](20260929-snapback4-typing-expiry-intermittent.md).

Next reproduction should instrument app close, raw-client close, active network
waits, device/storage queues and Web Lock release on a Mac under publication
contention. Keep all outcome/authority assertions and preserve the failing
trace; a larger cleanup timeout alone is not a resolution.


## FT investigation — 2026-10-08

Still open. FT is restricted to eb1000, so it makes no Darwin reproduction or
publication-cleanup claim. The four named browser files were exercised with
confined CPU contention and their usual neighbours. No close stall was
reproduced; final exact case counts and timings are in the FT report below.
One deterministic setup failure prevented `web-admission-review` from reaching
its first scenario: its test-only sync hook referred to `syncOnce`, removed by
SN. FT now wraps the current `network.once` at the same attempt boundary,
preserving promise identity, arguments and scheduling. The complete 55-test
file then passed, and repeated focused runs cover the original first scenario
and receipt cases that consume that hook. Typing teardown now resumes its
controlled clock; immutable browser fixtures and FL's process custody also
postdate the ticket. These changes are relevant history, not evidence that all
four original Mac stalls had one resolved cause. Keep this ticket open for an
instrumented Darwin failure.

[FT commands, retained evidence and final counts](../snapback4/reports/20261008-ft-client-flakes/REPORT.md).
