# Snapback 4: W5R2a's first online write is load-sensitive

Status: Open
Date: 2026-09-29
Scope: `packages/snapback4/test/acquisition.test.mjs`, test `W5R2a wasm: a sent queued id emits once beyond 256 other emissions`

Lane EA's landing suite on eb1000 (`== 1 failure(s) in 1566 s`, 2026-09-29, host load about 60 with two other
full suites and a timing lane running) failed at `acquisition.test.mjs:504`:

    assert.equal(first.state, "sent")    // actual: 'pending'

The first online mutate after `f.mode("sent-queued")` returned `pending`: its server answer did not arrive within
the call's wait. In 26 earlier landing suites this test never failed. On the EA land tree it passed 6 of 6
isolated, and on one pinned CPU it passed 4 of 4 on both the EA tree (7.2–7.7 s) and main (7.5–8.0 s). EA's
identity wait therefore does not slow it; the assertion assumes the write settles within the default wait on a
loaded host.

Fix: make the precondition explicit. Either give this first write an explicit `waitSeconds` sized for the suite,
or wait for the write's receipt (`client.write(id)` until `sent`) before asserting the emission count. Keep the
test's actual invariant: a sent, queued id emits exactly once beyond 256 other emissions.
