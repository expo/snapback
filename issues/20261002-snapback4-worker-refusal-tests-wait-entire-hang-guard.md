# Snapback 4 worker source-refusal tests consume the entire hang guard

Status: Open
Date: 2026-10-02
Scope: `snapback4/packages/snapback4/test/worker-regressions.test.mjs`

The three `named snapshot refuses a symlinked ... package manifest` cases use
`spawnSync(dev, { timeout: hangBudget() })`, then inspect stderr and the absence
of worker starts. The host remains available while snapshot admission refuses;
each test therefore waits 122 seconds before inspecting an already observable
refusal. FDL round 2's retained full suite measured 122073.949, 122055.239 and
122040.106 ms for these three cases. This is fixture overhead, not evidence
that the supervisor takes two minutes to refuse an unsafe source.

Follow-up: asynchronously observe the existing refusal, retain both original
assertions, and explicitly shut down the fixture-owned host. Cover all three
manifest locations. Do not shorten a product timeout or treat a hang timeout
itself as proof of correct refusal.

Found during QF round 0; kept separate from the new-declaration startup race.
The new 15-minute file watchdog still bounds this file with the current cases.
