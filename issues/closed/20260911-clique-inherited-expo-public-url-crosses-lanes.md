# Clique / Expo: inherited `EXPO_PUBLIC_SNAPBACK_URL` sends a lane at another owner

**Status:** Closed
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Clique launcher, Expo `app.config`, Snapback 2 Expo template
**Related:** [20260908-clique-expo-exports-mix-backend-bindings.md](../20260908-clique-expo-exports-mix-backend-bindings.md) (shared Metro cache / export; different mechanism); LLP 1002 “The URL names its owner” (specified 2026-09-11, not in 0.0.24/0.0.25)

## Symptom

Two Clique actors ran on expo-build-1000 at once (0.0.24 ports 53100–53119, 0.0.25 ports 53200–53219). The 0.0.25 M1 browser sent signup/profile traffic to **53100**, the other lane’s owner, because `EXPO_PUBLIC_SNAPBACK_URL` was inherited in the environment. The attempt was discarded and the URL pinned. 0.0.24’s README recorded the same isolation fight.

This is not the 2026-09-08 mixed-export cache bug, though both are “the web client talked to the wrong backend.” Tonight the cause is an ambient `EXPO_PUBLIC_*` variable, not a transform cache.

Published 0.0.24/0.0.25 do not warn when the env URL disagrees with `.snapback/dev-url`. LLP 1002 now specifies that warning plus a launcher unset; it still needs to land in a published package **and** in the Clique `launch.py` / generic wrappers on builder-1000.

## Evidence

- 0.0.25 run-log epoch `1789163616`: “inherited EXPO_PUBLIC_SNAPBACK_URL=53100 sent initial M1 browser signup/profile requests outside assigned lane.”
- Local records: `benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md` (concurrent-run discovery), `benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/README.md`.
- LLP 1002 § “The URL names its owner”.

## Requested outcome and acceptance

- Clique `launch.py` / generic wrappers **unset** `EXPO_PUBLIC_SNAPBACK_URL` and `VITE_SNAPBACK_URL` before spawning Expo or the builder.
- The Expo template warns (or refuses) when an inherited URL disagrees with this project’s `.snapback/dev-url`.
- Acceptance: two concurrent lanes on one host, assigned different ports, cannot make M1 browser traffic to the other owner without an explicit pin. A failing unit/integration around `app.config.js` precedence is enough for the template half.

## Resolution — 2026-09-11

Future Linux Clique packets now take their foreground builder and M7 launchers
from `benchmarks/tools/social-messenger/linux-runner/`. Both maintained entry
points pass `run_env()` to their child, and that environment removes
`EXPO_PUBLIC_SNAPBACK_URL` and `VITE_SNAPBACK_URL` before the agent can
start Expo or Vite. The usage note requires new packets to install this source
instead of copying a live or retained run and keeps deliberate client URL pins
inside the owning lane after `.snapback/dev-url` exists.

The retained verification under `.llp/ship-runs/clique-url-isolation-20260911/`
ran `launch.py` and `launch_m7.py` concurrently with opposite foreign URL
values. Neither child inherited either variable. The same witness exercised the
shipped Expo `app.config.js`: no environment uses the owner file, a matching
explicit pin wins without warning, and a mismatching explicit pin still wins
while naming both owners in the warning. The tracked integration test now
records all three precedence cases.

The live `/home/ccheever/clique-ri-20260911` and
`/home/ccheever/clique-0025-20260911` packets remain unchanged evidence.
