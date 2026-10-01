# PRL publication audit

This extends [PR round 5](../20260930-pr-subscription-pressure/round5/PUBLICATION-AUDIT.md)
and [round 6](../20260930-pr-subscription-pressure/round6/PUBLICATION-AUDIT.md).
Their authorization predicates and the online queue-inclusive second remain.
The change amortizes ready subscriber callbacks; it never stores a candidate
read or delays its authorization, answer installation, deadline registration,
facade followers or delivery acceptance.

| Route / boundary | PRL behavior and evidence |
| --- | --- |
| Local evaluation, remembered write, copied recovery, raw/facade one-shot, detached getter/resubscription | Code unchanged. The complete subscription-pressure authority, memory, notified-tables, sync-memory, refusal-candidate, watermark, round2/round3 and options files pass. |
| Apply/publication, including lost acknowledgment, housekeeping, unknown/empty/unrelated footprints, no-op, keep:false | Code unchanged. The round-5 sync-memory and round-6 noop files pass on both devices. Replacement owner selection and resumption remain exact. |
| Queued/running local attempt and pending scope cut | Work ownership, cancellation, signal, incarnation, revision, change/reset versions and publication predicates unchanged. Device/scopes/round1/round2/round3 regressions pass. |
| Online ambiguous change evidence | Same one-second deadline from receipt, including capacity wait. `online scope-ambiguous change evidence expires while waiting for capacity` still passes with eight occupied slots. Priority/fairness unchanged. |
| Successful online observation | Existing acceptance and deadline checks run, then `watch.publish` immediately installs the current answer. Only positive callbacks are queued, and only with backlog. Empty/null results and either old/new row deadline notify immediately. The retiring episode deadline caps the batch timer; later completions cannot extend it. The causal browser test reads eight new raw answers while their UI notification turn is held. |
| Ready notification flush | Holds only owner references and callbacks present at publication. Checks the live map, data presence, and current subscription membership. It carries no read body or authority predicate that could bless an old result. Ordinary immediate notifications remove that owner's queued notification. |
| New/removed subscriber | New subscribers read current state but do not inherit an old callback. Removed subscribers and closed/replaced owners are skipped. The closed-active-read liveness regression detects the initial implementation's late-subscriber mistake and passes the correction. |
| Denial, terminal refusal, reset, row/episode expiry | Withdrawal itself and its ordinary notifications stay synchronous. The new browser control holds the ready turn, receives a terminal refusal, verifies all raw/rendered rows denied, then releases old bodies and callbacks without restoring data. Source getters still check deadlines synchronously. Five direct controls independently catch delayed empty/null results, old/new row deadlines and the retiring episode boundary in the initial candidate; the correction passes all five. Other owners without answers still withdraw at their original second. |
| Facade approval and held/closed answers | No facade implementation changes. Followers run during source publication/reset, before positive raw UI notification; existing held deadlines, identities and terminal source checks stay. Keep/retention/answers-stay suites pass. |
| Scope reset/close during an already-draining callback batch | A later callback reads current source state; no data is captured. A closed owner is absent from the live map; a withdrawn owner lacks data. Closing the client cancels the timer and clears the map. |
| Queue turns and clear | A real host task resets the same eight-start allowance. postTask uses a cancellable signal; MessageChannel closes both ports. Timer injection/non-browser fallback remain. Dedicated tests cover both browser turn backends, 1,000 starts and cancellation; existing capacity, fairness, liveness and linear selection regressions pass. |
| LL live path | Local publication, notified-cut registration, held-only parking, fallback, metadata reads and media dependency selection are unchanged. Both live-propagation files and media-dependencies pass; PQ still records zero unrelated evaluations and at most eight active. No new latency-distribution claim is made. |

Final affected run: **1,202 tests, all pass, no cancellations/skips**, including
all five boundary corrections. The exact 59-file inventory and digests are in
[affected-hardened-files.json](affected-hardened-files.json); full output is
[raw/affected-hardened.log](raw/affected-hardened.log). The earlier 1,197-pass
pre-hardening run remains retained separately.
