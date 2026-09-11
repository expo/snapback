# snapback2: `real channel membership revocation ends the subscriber with a refusal` flakes under load

**Filed:** 2026-09-05 by Claude Fable 5.1 (LLP 1017 landing)
**Where:** `snapback2/packages/snapback2/tests/real-owner.test.ts`, the test at ~line 236
**Status:** Open

## Symptom

In-file, the test's `sub.until(() => false, 2_000)` times out ("subscription
condition timed out after 2000 ms") and the assertion on `terminalError`
throws before `sub.close()`, `alice.close()`, `bob.close()` run. Alone, the
same test passes in under 100 ms every time.

Sampled 2026-09-05 ~16:10Z on the M5 Max at load 10–16 (several other
sessions' lanes running), three runs of the file each:

| tree | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| origin/main `900789adf` (LLP 1016 closing round) | ✖ 2052 ms | ✔ 66 ms | ✔ 71 ms |
| LLP 1017 landing candidate (main + `cap`/fan-out) | ✔ 71 ms | ✖ 2051 ms | ✔ 66 ms |

Same rate on both trees, so it is main's timing window, not the LLP 1017
change (which does not touch channels, the writer, or the live transport).

## Consequence worth fixing first

When the test throws before closing its subscriptions, the owner's later
`stop()` drains the leaked keep-alive sockets forever and `scripts/test.sh`
hangs at the package stage with no live child process (observed once for
2 h 54 min on 2026-09-05). Wrap the body in `try/finally` that closes the
subscription and both clients, so a timing miss is one red line and never a
hang.

## Likely cause

The channel refusal after `memberLeave` is delivered from the owner's turn;
under load, with the owner having served the file's earlier tests, the
re-evaluation lands after the 2 s `until` window. Either widen the window
for this test (the other `until`s in the file use 2 s too but observe
faster paths) or wait on a settled marker rather than a fixed window.

## Related

- `snapback2/packages/snapback2/tests/owner-harness.ts` `stop()` (the drain).
- Memory note in the LLP 1017 program record; LLP 1006's "hang = leaked
  subscriptions" trap.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — timing qualification; cleanup repaired. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The test moved to tests/real-owner-session.test.ts and now registers context.after to await both client closes before assertions. The old throw-skips-all-cleanup mechanism is therefore no longer the source shape. Readiness, typing and terminal waits still use 2,000 ms.

Current source: tests/real-owner-session.test.ts, real channel membership revocation ends the subscriber with a refusal. Remaining: deterministic progress-based revocation control or a bounded repeated under-load reproduction with cleanup verified after failure. No new load result is inferred from the moved test or prior isolated passes.

## Resolved — 2026-09-10

`real channel membership revocation ends the subscriber with a refusal` no
longer uses 2,000 ms readiness, typing, or terminal windows. Its callback owns
explicit promises for each semantic state. After `memberLeave` commits, the
test sends a subsequent `/control/status` action through the real owner and
requires `channelSubscriptions` to have fallen by exactly one. This is an
ordered progress witness: the mutation turn has completed channel readmission,
queued the terminal refusal, and removed Bob's handle before the later status
action can answer. The test then waits for the refused public snapshot without
a local timing guess and verifies that the subscription's already-latched
terminal is exactly `E_RULE_CHANNEL_SUBSCRIBE`.

Cleanup remains registered with `context.after` before the assertions, and the
subscription is registered there immediately after creation, so a failed
assertion cannot leak the keep-alive child. The publisher and subscriber are
also closed on the successful path.

Focused verification:

```sh
cd snapback2
node --test --test-timeout=120000 \
  --test-name-pattern='real channel membership revocation ends' \
  packages/snapback2/tests/real-owner-session.test.ts
```

Result: 1 passed, 0 failed. The semantic test body completed in 51 ms; that
measurement is informational, not part of its acceptance.
