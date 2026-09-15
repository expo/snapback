# snapback4 navigation-model tests: fixture server refuses connections under full-suite load

- **Status:** open
- **Date:** 2026-09-15
- **Area:** `snapback4/packages/snapback4/test/navigation-model.test.mjs`
- **Severity:** P3 (flaky test; no product defect found)

## Observation

During `bash snapback4/scripts/test.sh` on a heavily loaded shared host (load average about 22), a different navigation-model test fails each time with `TypeError: fetch failed` / `ECONNREFUSED 127.0.0.1:<port>` after about 5 s. Three integration runs on 2026-09-15 each failed one test this way:
- wave 5 `1688940ff`: `ordinary flush waits for the exit request before replaying its head` (web-navigation.test.mjs);
- wave 6 `3bfef6725`: `pre-admission journal: record bytes bounds capture and ordinary admission still works`;
- wave 6 round 1 `718f0eebd`: `navigation model: admission finishing after pagehide sends only after its commit`.

In every case the same file passed on rerun: alone (45/45 twice), and in the immediately following `node --test --test-concurrency=2 'packages/snapback4/test/*.test.mjs'` run (344/344, then 377/377).

## Hypothesis (unverified)

The per-test fixture server starts `snapback4 dev` on an ephemeral port. Under load it exits, or has not started listening, before the first request, and the helper does not wait for readiness or report the child's exit. The failure then surfaces as a bare connection refusal instead of the server's own exit line.

## Next step

Make the fixture wait for a readiness probe with a bounded timeout. Print the child's `SNAPBACK4_EXIT` line, if any, when the probe fails, so a real server exit is distinguishable from a slow start.
