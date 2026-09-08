# Published 0.0.18 and a fresh installed workflow

Published `snapback2@0.0.18` and `snapback2-darwin-arm64@0.0.18` from qualified source `7b947aa4def19d51ea786783625fb023f3bc891d`. Both public version records and `latest` tags match the original qualified integrity hashes. The fresh installed workflow passes after the retained registry-propagation failure and an app index-selection correction. This is a Darwin arm64, headless workflow; it makes no new Linux, browser, device, or comparative performance claim.

The prior publisher explicitly transferred its reservation to DX at `2026-09-08T01:30:07Z`. Its compiler and benchmark work remained paused. DX used the existing reviewed publication helpers and the exact retained tarballs, without rebuilding, repacking, or editing shared product code. Direct execution replaced the incomplete historical agent-continuation packet. Existing type-fix and timeout-helper reviews were reused; this evidence-only writeup did not receive a new independent review.

## Publication

The standard publisher ran once on Apartment M1, exited **0 in 44.323 seconds**, and passed **all 19 installed consumer summaries**, including both complete template test receipts. The qualified production binary includes Ibex 2, vanilla Hermes, and the media helper. [Activation events](publication/activation-events.jsonl) retain the actual publisher and consumer results.

| Package | Qualified/public SRI |
|---|---|
| snapback2-darwin-arm64 | `sha512-JLOYb8u5B41XUN5wfGBhpPkONhjqRX4KsiqOCQ6PMupBPDh92ANo7LZhNvoyeb3Z/qtfWOgjBSlTEX4Xiq1yLA==` |
| snapback2 | `sha512-UBOM7aQErcCB7vIjg19wubG2w521VzEkLvFJhlCPUK3rAxdd8Tkp8UB7bZ334WomaIJEEXMk5LczYcJE7SlvWA==` |

The immediate registry observation returned E404, so the activation wrapper correctly exited **1** despite publisher success. Read-only observations 01–06 preserve partial propagation: platform first, then shim metadata, then the downloadable shim tarball. No republish occurred. [Observation 06](publication/public-registry-observation-06.json) confirms both public versions and tags; [the later tarball observation](workflow/first-attempt/tarball-observation-02.json) confirms the canonical shim download and its SRI. Publisher success alone was insufficient to start a reliable fresh install.

Chat check was **1.054045292 s against 1 s: RED**. The 17 timed consumer steps sum to approximately 35.350 seconds, also above the 30-second budget; that sum is not an exact whole-consumer timer. Dry qualification's chat 1.056400375 s / 1 s remains RED. No timing failure was relabeled as passing. Apartment start load was 11.43/7.15/5.82; this was a shared host.

[Final remote custody](publication/final-remote-custody.json) verifies unchanged qualified source/artifacts. [Stopped-state observation](publication/stopped-state-result.json) records all observed owners absent and owned cache/log/tmp removed. Original source metric bytes were restored after retaining the publication append.

## Fresh installed workflow

Node **24.18.0**, npm **11.16.0**, public pinned `snapback2@0.0.18` and `react@19.1.1`; normal npm dependency/peer/lifecycle behavior, no `--legacy-peer-deps` or `--ignore-scripts`. No workspace package links or compiler overrides were used.

The initial empty-cache install hit its **30-second timeout**; its eventual npm log also recorded a shim tarball E404. `npm ci` and app execution were not attempted on that failed installation. After the canonical tarball was observed available, a deliberate second attempt used new producer and consumer directories and reused only the first attempt's private npm cache. The package and lockfile were copied byte-for-byte into the consumer, which had no `node_modules` before `npm ci`. Thus this is a fresh install/ci witness with a warmed npm cache, not a passing cold-cache install. [Attempt context](workflow/after-propagation/attempt-context.json) and [report errata](workflow/after-propagation/report-errata.json) correct the inherited script's stale cache-policy sentence.

| Step | Observed seconds | Result |
|---|---:|---|
| Default install after propagation | 4.105 | pass |
| Fresh `npm ci` | 5.483 | pass |
| Doctor | 1.444 | pass; exceeds the 0.5 s budget |
| Todos scaffold, client none | 4.941 | pass |
| Initial check | 3.518 | pass; exceeds the 1 s budget |
| Dev startup | 2.826 | pass |
| First `todos.list` as alice | 0.479 | seeded todo returned |
| Check after explicit index correction | 4.150 | pass |
| Focused `published row types` journey | 9.396 | 1 check passes |
| Full test | 5.844 | all 7 checks pass |
| Edited `todos.add` as alice | 0.309 | committed, typed row returned |
| Installed declaration/type probes | 20.537 | pass |

The fixture edit exposes the inserted row from `todos.add` and adds a merged-row query. An intentional `done: 42` produced the correct number-to-boolean diagnostic and advice to use `true` or `false`. Adding the second index also exposed an ambiguity in the original list query; the diagnostic named both indexes and the `by <index>` correction. The first corrected check still failed on that ambiguity; naming `byOwnerId` resolved it. Both original failures remain in the command logs. This was a test-app correction, not a product repair.

The focused test explicitly selects one authored journey and skips top-level derived checks. It is not automatic affected-test inference. The full receipt covers certification, rules, bounds, invalidation, replay, and both authored journeys. A single focused run being slower than a full run does not establish relative product performance: Office load was roughly 106–149 during these operations, with unrelated work active. [Host observation](workflow/first-attempt/host-observation.json) records the machine context. No controlled idle-host comparison was performed and no exact contention penalty is inferred.

[Type evidence](workflow/after-propagation/consumer/type-evidence.json) uses the installed TypeScript **5.9.2**, complete package resolution, and `skipLibCheck: false`:

- Public declarations: **75 SourceFiles**, zero diagnostics, existing precise-type and incompatible-assignment controls pass.
- Standalone offline declarations: **60 SourceFiles**, zero diagnostics; exported class/function declaration modifiers remain intact.
- Actual generated insert and merge consumers: **74 SourceFiles each**, zero diagnostics, precise boolean fields, non-any rows, and `IsAny=false`.
- Removing each negative control's `@ts-expect-error` produces exactly **TS2322**, “Type 'boolean' is not assignable to type 'number'.” No declaration diagnostic filtering was used.

This verifies the landed generated-row import and ambient declaration fixes on the published package. It is scoped consumer coverage, not a claim that every optional SDK surface was checked. [Final local custody](workflow/after-propagation/final-custody.json) verifies all **156 installed qualified files unchanged** and the dev owner file absent after successful stop.

## Timeout reporting

Every fresh-workflow subprocess uses `execute` imported unchanged from accepted R3 helper SHA256 `b66c1e0e7eddb99d6a17a3902a0d3fb116f35618c47068d16b8d97a87438fa0a` (accepted source/reviews and six controls: commit `26863efea`). Only `installed()`'s version metadata is rebound to 0.0.18; timeout code is not edited.

An actual deliberate 30-second hang produced **semantic exit 124**, **actual child return -9**, and `actualProcessWaitCompleted=true` in 30.187 seconds. [Timeout control](workflow/first-attempt/timeout-control-report.json) preserves that result.

The real initial npm timeout exercised the refusal path: process identity no longer matched, so the helper refused to signal it and recorded `cleanupUnknown=true`, `actualReturnCode=null`, `actualProcessWaitCompleted=false`, and semantic exit **124**. A later separate observation found the PID absent and npm's log ended with exit 1; that does not invent a parent-waited exit. The original `.running.json` and timeout receipt remain. The log grew after the receipt-time hash snapshot; the later log hash is preserved separately. Direct-child completion never claims that all descendants closed their log writers.

## Reproduction and retained files

The [workflow driver](workflow/after-propagation/workflow.py), [original continuation](workflow/after-propagation/continuation.py), [index-corrected continuation](workflow/after-propagation/continuation-r2.py), [type probe](workflow/after-propagation/type-probe.mjs), app sources, exact package/lock inputs, command argv/cwd/bounds, outputs, and type fixtures are retained here. Drivers bind the original local evidence and accepted helper paths and use exclusive receipt creation; use a new output directory when reproducing rather than overwriting these receipts.

To repeat the product path independently: install the two pinned dependencies above in a new directory with `npm install --save-exact --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000`; copy package/lock to another new directory and run `npm ci` with the same flags. Invoke the installed `node_modules/snapback2/bin/snapback2.mjs` with `init . --template todos --client none`, `check`, `dev`, `run todos.list --as alice`, then use the retained edited app sources and `test --journey "published row types"`, full `test`, and `run todos.add '{"title":"Verified published change"}' --as alice`. Stop with `dev --stop`. The type probe resolves TypeScript and Snapback solely from that consumer's installed dependencies.

[Copy custody](copied-evidence.json) binds each copied evidence file to its original path, size, and hash. No credentials or running stores were copied. The preserved first install, app correction, and small metadata-preparation correction are not overwritten by the final passing workflow.
