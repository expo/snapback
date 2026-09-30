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
