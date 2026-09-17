# Grok launcher review, final one-line delta

Received 2026-09-16, `grok-4.6` requested at xhigh; native model receipt:
`grok-4.6-build`. Continued only its own blind inline-source review session
`01a0abb1-7c8e-7552-9eb1-c7cf1275649b`; no other review supplied. Actual final text:

## Verdict: READY

Final reviewed hash:
- `run-pilot.mjs`: `35f2417ea79479f18c0ae8d19e4107d1cf10284c0f25505a6b283c4dbe11f53b`

Unchanged:
- `stage-pilot.mjs`: `f1ff8973d57afe3ec70bad62ea2b735cd3422b121f3ef1dadc0d3f806eba9177`
- `pilot-prompt.md`: `93969c649dab511b59e9d1d5bf212e732ad50b641b44950eaed07504feeeb260`

The delta is only the removal of the unverified-PGID pre-`fail` `child.kill('SIGTERM')`. That throw still lands in the same `try` (`run-pilot.mjs` around the `ps` check), `groupValidated` stays false, and `finally` is the only cleanup: `group-not-targeted`, then `cleanupExactChild` as the sole TERM/KILL sender. Negative PGID is still never used on this branch.

That fixes the evidence lie the deleted line caused: a child that died from the unrecorded pre-signal was logged as `exact-child-disappeared` / `after: 'no-signal'`. Now a TERM-ignoring leader is recorded as TERM → 5s wait → KILL → disappearance; a TERM-accepting leader as TERM → disappearance. `end.json` is still written; `lifecycleError` from `PILOT_PROCESS_GROUP_UNVERIFIED` still yields exit 1.

No new material runtime, lifecycle, or evidence issue. The previous READY call on staging, packet integrity, holdout omission, and validated-group kill of residuals still holds.
