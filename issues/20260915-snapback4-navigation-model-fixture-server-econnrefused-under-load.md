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

**2026-09-15 — A1 fix round 1:** Identified a teardown race: the fixture sent SIGTERM, then removed its store and allowed the next fixture to reuse its fixed test port before the old child exited. A readiness probe could therefore reach the dying predecessor. Kept the `witness/lib.mjs` fix that awaits the child exit before removing files, the callers that await `close()`, and the corresponding local-e2e shutdown waits. All three cases named above passed in the full suite's client step and its first retry, with no `ECONNREFUSED`; those runs still had separate HTTP/transport timeouts (and the full concurrent run had a record-count journal assertion). Status remains open for the supervisor's disposition.

**2026-09-16 — verification:** Node v24.18.0; `bash scripts/test.sh` passed 9/10 steps, including Cargo tests (14,046 s total under severe shared-host contention). Its client step reported 377 passed, 4 failed, 2 cancelled. The isolated client rerun reported 364 passed, 13 failed, 6 cancelled; two stalled test processes (`client-lifecycle` and `local-e2e`, no remaining children and over four minutes without output) were terminated to collect that summary. All three cases originally named in this ticket passed again, with no `ECONNREFUSED`. The remaining timeout, pending-versus-sent and stalled-process failures are unresolved; this evidence supports the fixture teardown correction, not a green client-suite claim.
