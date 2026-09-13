# Acquisition code reviews

These are the actual final review texts received from independent Sol and Grok
sessions, with the input/source hashes each review examined. They are source
reviews, not execution evidence. Only final review text is published; provider
streams and internal reasoning are excluded.

Early reviews found substantive authority, durability, and lifecycle defects.
The implementation was repaired between candidates; a fast diagnostic is not
retroactively made correct by a later fix. Owner r1 and SDK r1 Sol reviewers
subsequently implemented their repairs, so those are integration reviews rather
than independent final verification. Final v4 reviewers did not implement fixes
and were mutually blind. Each subsequent delta review continued only its own
family's context. Both v7 reviews found the memory-adapter notification defect;
v8 repairs it and the separately reproduced mutable-declaration defect. Both
[Sol](final-v8/sol-review.md) and [Grok](final-v8/grok-review.md) approved the
bounded v7-to-v8 delta with no confirmed remaining blocker. Neither reviewer
ran tests or benchmarks.

| Finding group | Disposition in the final implementation |
| --- | --- |
| Owner continuation used caller arguments instead of executed canonical arguments | Continuations preserve the owner's canonical runnable declaration; affected Rust tests pass |
| Declaration changes, account/generation transitions, denial and persistence failure could preserve or revive old scope | Dataset identities and authority are checked across async work; retirement withdraws held acquired-origin resources; atomic guarded cleanup and shared-adapter initialization fencing preserve withdrawal |
| One denied dataset removed unrelated datasets | Successful denial removes only that dataset; failed authority persistence uses the documented fail-closed session fallback |
| Receipt advancement and same-sequence invalidation could leave acquired readiness published | Known floors and invalidation suspend acquired evidence in RAM and storage before revalidation |
| Cancellation/reconnect completion semantics and captured restarts disagreed | Completion belongs to the current cycle; transient reconnect resumes it, cancel rejects it, explicit resume creates a new cycle, and deferred restarts recheck handle state |
| Stored rows trusted claimed hashes; repeated walks redecoded full envelopes | Actual canonical contents and row identity are checked; only owned immutable representations with current row bindings can reuse decoded envelopes |
| Old cancellation affected a successor, and memory notifications disagreed with guarded storage updates | Cancellation and fallback bind the exact current token and checkpoint; memory mutation and notification use the same full predicate |
| Caller mutation redirected an existing acquisition handle | Registration owns declaration identity, root arguments and the expansion function reference |
| Whole-corpus loads/maps, old-version collection and synchronous compression | Remain explicit [performance follow-ups](../../../issues/20260912-browser-acquisition-cost-and-storage-amplification.md); no isolated cache speedup or completed scaling redesign is claimed |

`received.json` lists only reviews actually received. Frozen source snapshots
for historical reviews remain in the private run workspace; the published
input manifests bind their exact file bytes. Final package, source, benchmark,
and control evidence are recorded in the acquisition report.
