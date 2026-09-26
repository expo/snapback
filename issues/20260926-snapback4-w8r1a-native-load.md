# Snapback 4: W8R1a's native tier times out under heavy host load

- **Opened:** 2026-09-26, from the 0.4.2 publication (attempt 3, first dry run).
- **Area:** `packages/snapback4/test/client-seams.test.mjs:811`, `W8R1a native
  server-run observations retain nothing during a replacing fetch`.
- **Severity:** Low. It is a test that is timing-sensitive under load, unless
  it hides a race.

## What happened

The M5's load average reached 78–126 on 18 CPUs, from other sessions' cargo
and Xcode builds. The native tier's last wait timed out after 10 s: the wait
for every watch to become `loading` after the client goes offline and syncs.
The online and web tiers passed in under a second. The same source passed in
0.4 s in the fence-fix qualification. Ten isolated runs at load 18–19 passed in
0.26–1.07 s (`reports/20260925-publication-0.4.2/attempt-3-w8r1a-isolation.log`).
The retried dry run passed.

## Question

Should a 0.3 s transition take more than 10 s at four times oversubscription?
If a timer that load delays gates the native offline transition, the product
has a latency cliff. Measure the native tier's offline-to-`loading` latency
under a synthetic CPU hog before calling this test-only.
