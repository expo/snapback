# A3 sweep: any attached live subscriber wedges the watch-reload evolution in SNAPBACK_AUTH_MODE_PENDING

- **Status:** Resolved
- **Opened:** 2026-08-01
- **Resolved:** 2026-08-01 (between-arms fix lane)
- **Systems:** Runtime, Auth, Live queries, CLI
- **Related:** LLP 0137 (A3 arm), LLP 0058 §Same-mode provisioning,
  demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f5-live-subscriber-wedges-watch-reload.json,
  issues/closed/20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic.md

The only working schema-evolution path (the dev supervisor's live watch
reload) deadlocked the moment any live stream subscription was attached.
Repro matrix (evidence/app/repro-evolution3.mjs):

- zero clients / sessions-only clients / handles disposed BEFORE the swap:
  reload lands `generated-and-loaded` in under a second, data flows;
- one attached live handle: reload reports `generated-but-not-loaded`
  carrying `SNAPBACK_AUTH_MODE_PENDING`, every app-data request refuses with
  the same code, and admission never reopens — not even after the subscriber
  disposes.

## Root cause

Not the drain, and not a projection failure. The same-mode activation
(`ModeTransitionGuard::commit_and_project_mode_state`, `src/auth/admission.rs`)
validated the **post-commit** carrier with the strict `in_flight == 0` check.
But the transition's own private projection root is `Clone`, and every live
publication effect guard retains a clone in the after-Local owner batch
(`exec_guard::retain_through_after_local`), which flushes only after the
commit closure's Local write scope exits. With at least one live
subscription the projection therefore publishes at least one frame, a clone
of the projection root survives `drop(projection_admission)`, and the
post-commit validation misread the transition's own root as a foreign
in-flight admission — after the durable commit had already landed. Per the
fail-closed design that classified the activation as an ambiguous
post-commit failure: admission retired into a non-accepting epoch,
permanently `SNAPBACK_AUTH_MODE_PENDING`, with no recovery short of restart
(which then hit the startup-pin refusal, the f4 ticket). With no live
subscription, no frame is published, no clone is retained, and the check
passed — exactly the observed matrix.

## Fix

`src/auth/admission.rs`: the epoch now counts the projection root separately
(`projection_in_flight`, set by `admit_transition_projection`, cleared on the
root token's drop). The committed-carrier validation proves "no **foreign**
root in flight" (`validate_closed_allowing_projection_root(true)`), while
every reopen path — `publish_successor` / `publish_committed_mode_state` /
`publish_committed_generation` — keeps the strict all-roots-dropped gate, so
LLP 0058's "the projection root is dropped before reopen" is unchanged (the
after-Local batch flushes before the carrier's owner publishes). LLP 0058
§Same-mode provisioning carries the dated note.

## Regression tests (proven to fail pre-fix)

- `auth::admission::tests::retained_projection_root_clone_does_not_fail_the_committed_carrier`
- `auth::admission::tests::published_successor_after_projection_root_flush_reopens_accepting`
- `local::tests::same_mode_activation_with_live_subscriber_survives_after_local_owner_retention`
  (drives the served ordering: reservation + Local write scope + after-Local
  owner retention with a live subscriber attached)

## Acceptance witness

repro-evolution3.mjs `live` scenario against the fixed binary: with the live
handle attached, the source swap reloads `generated-and-loaded`, the
post-swap query returns rows under the evolved catalog while the handle is
still attached, and admission stays open. `idle`/`session`/`live2` unchanged.
