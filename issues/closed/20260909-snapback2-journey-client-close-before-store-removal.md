# Await journey client closure before removing durable store files

Status: Closed
Systems: Snapback 2 test runner
Related: LLP 1002, LLP 1018.007
Reported: 2026-09-09, independent Sol xhigh proof-source review
Resolved: 2026-09-10

`snapback2/packages/snapback2/src/test.ts` finally starts each asynchronous
`client.close()` without awaiting it, then removes the durable store root.
An in-flight carrier close can race that removal. This line predates the Clique
correction; the focused completed proofs have clean owner exits and no observed
teardown failure attributable to this race. Do not turn that observation into a
claim that the race is safe.

Await completion of all owned client closures before removing the root, preserve
cleanup errors appropriately, and add a deterministic delayed-close regression
that proves removal cannot overtake closure. Keep cleanup scoped to the runner's
owned temporary directory and preserve the original test failure if cleanup
also fails. Do not raise journey deadlines or alter offline-derived assertions.

Evidence: `llp/reviews/1018.007-clique-correction-program.code-sol-final.md`,
2026-09-09 retained proof-source re-review of `4f0d35467`.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — current source gap. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

Current src/test.ts still starts every client.close() without awaiting the returned promises, then awaits epoch/provider cleanup and removes storeRoot. Those unrelated awaits do not establish that durable carriers have finished closing.

Source: snapback2/packages/snapback2/src/test.ts finally block in runJourney. Remaining: an actual delayed-close runner regression proving store removal waits; preserve the original journey error if cleanup fails. This triage confirms the source ordering, not an observed physical store-loss event.

## Resolution — 2026-09-10

`runCheck` now awaits all owned client closes before the epoch/provider cleanup
and before removing its temporary store directory. Cleanup uses all-settled
semantics so one failed close cannot prevent another close from completing, and
the emitted failure retains the primary journey error followed by any cleanup
errors. `test-runner-cleanup.test.ts` deterministically holds one close promise
and proves root removal cannot overtake it.
