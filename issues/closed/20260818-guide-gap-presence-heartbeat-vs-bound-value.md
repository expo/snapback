# guide-gap: surface presence value reads like bound state but is a continuous publish

**Status:** Closed 2026-08-21
**Systems:** Guide, ephemeral realtime, React/Expo hooks
**Date:** 2026-08-18
**Landing SHA:** d4b4a80a9
**Evidence:** diary 0096 M3 — publishing typing through the surface
`presence` value kept the lease alive for the whole non-empty draft, failing
the 5s expiry ceiling; the correct `touch`-on-keystroke / `delete`-on-idle
pattern existed but was not findable from the obvious queries, and
`useSurface({ typing: value })` invited the Supabase `track()` reading.

Wanted: a one-pager ("presence value is a continuous publish; idle expiry
needs touch + delete / useSnapbackActivityPresence") linked from the
ephemeral-state page and the typing-indicators recipe, plus search terms so
`snapback guide typing` lands on it. The membership-backed rooms recipe
(f8cbf3d25) did not cover this heartbeat-semantics trap.

## Resolution

`guide/recipes/activity-presence.md` is the bounded decision page. It states
that a bound surface value is continuously published, explains why TTL cannot
enforce an inactivity ceiling while the provider heartbeat renews the lease,
and teaches `useSnapbackActivityPresence`: `touch()` on meaningful activity,
helper-owned idle delete, and explicit `withdraw()` on clear/send/blur/scope
exit. It names Supabase `track()` and bound Snapback presence as lifecycle
analogues, then teaches the idle-stop choreography: `track()`/`untrack()` or
touch + provider heartbeat + delete. It also names `skip` as bound withdrawal,
distinguishes it from `null`, and separates the legal 250–2,147,483,647 ms
`idleMs` range from the smaller product deadline an app may promise.

The ephemeral-state page and typing-indicators recipe link to the decision
page rather than duplicating it. Retrieval case 62 retains the diary's exact
wrong vocabulary: "typing indicator stuck", "presence not expiring",
"track() equivalent", "supabase track", and "presence heartbeat". The cold
run is retained at `guide/eval-runs/2026-08-21/activity-presence.md`, and the
packed CLI assertion proves `snapback guide typing` includes
`recipes/activity-presence.md`.

## Closure evidence

`scripts/activity-presence-vertical-contract.mjs` supplies the LLP 0295
packed-external receipt missing from the earlier partial closure. From packed
CLI, codegen, contract, client, React, Expo, and Darwin runtime packages in a
fresh external app it proves:

- exact `snapback guide typing` retrieval;
- first-pass generation and typechecking through the generated ephemeral
  reference and both advertised framework imports;
- runtime/headless publish and delete;
- React touch, explicit withdrawal, and idle withdrawal below the five-second
  ceiling;
- Expo background withdrawal;
- bound-value renewal past TTL followed by `skip` withdrawal before TTL; and
- the negative `SNAPBACK_REACT_ACTIVITY_IDLE_MS_INVALID` diagnostic with its
  supported range rewrite.

Affected checks: `node scripts/check-guide.mjs`,
`node scripts/check-retrieval-eval.mjs --check`, `./ref-check --verbose`, and
the packed vertical receipt. All run under Volta Node 24.18.0 where applicable.
