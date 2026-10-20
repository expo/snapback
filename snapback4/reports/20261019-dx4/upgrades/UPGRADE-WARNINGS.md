# Copied-app upgrade warnings

All ten upgrades and their post-upgrade checks exited 0. Target package bytes are the DX4 candidate labelled 0.4.34; no manifest version was bumped. These are source/schema upgrade tests, not a production-store downgrade claim. Copies omitted dependencies, generated output, frozen probe evidence, credentials and stores; originals were not modified. The local registry substituted only candidate Snapback tarballs; the real npm resolver and existing project manifests were used. Original Expo manifests needed --legacy-peer-deps during baseline installation; the upgrade itself used its ordinary package-manager path.

## Wave 18: 004-snapback-mass-spec-sample-queue (0.4.33 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. No matching dev-door scripts found.
- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.mjs

Full stdout/stderr and check facts: `wave18-004.json`.

## Wave 18: 015-snapback-substation-switching-orders (0.4.33 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. No matching dev-door scripts found.
- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.mjs, scripts/frontend-proof.mjs

Full stdout/stderr and check facts: `wave18-015.json`.

## Wave 18: 019-snapback-chimney-sweep-reports (0.4.33 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. Review: scripts/acceptance.mjs
- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.mjs, scripts/frontend-proof.mjs

Full stdout/stderr and check facts: `wave18-019.json`.

## Wave 18: 033-snapback-fencing-bout-pools (0.4.33 → candidate)

- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.ts, scripts/frontend-proof.ts

Full stdout/stderr and check facts: `wave18-033.json`.

## Wave 18: 045-snapback-honor-guard-details (0.4.33 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. Review: scripts/acceptance.mjs
- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.mjs, scripts/frontend-proof.mjs

Full stdout/stderr and check facts: `wave18-045.json`.

## Wave 17: 005-snapback-kiln-firing-queue (0.4.31 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. Review: scripts/acceptance.mjs, scripts/hardened.mjs, scripts/probe-smoke.mjs
- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.mjs

Full stdout/stderr and check facts: `wave17-005.json`.

## Wave 17: 010-snapback-allotment-water-turns (0.4.31 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. Review: dist-v1/_expo/static/js/web/index-f6b144a24cc69add59508930b7cd316e.js, scripts/acceptance.mjs
- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/runtime.mjs

Full stdout/stderr and check facts: `wave17-010.json`.

## Wave 17: 019-snapback-apiary-hive-inspections (0.4.31 → candidate)

- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.mjs, scripts/frontend-proof.mjs

Full stdout/stderr and check facts: `wave17-019.json`.

## Wave 17: 033-snapback-compounding-dual-check (0.4.31 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. Review: dist-v1/assets/index-Om22RmpA.js, scripts/acceptance.ts, scripts/day2-proof.ts, scripts/probe-proof.ts, scripts/runtime.ts

Full stdout/stderr and check facts: `wave17-033.json`.

## Wave 17: 045-snapback-instrument-loan-bank (0.4.31 → candidate)

- password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors. Review: scripts/acceptance.mjs, scripts/frontend-proof.mjs, scripts/probe-serve.mjs
- startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): scripts/acceptance.mjs, scripts/frontend-proof.mjs

Full stdout/stderr and check facts: `wave17-045.json`.

