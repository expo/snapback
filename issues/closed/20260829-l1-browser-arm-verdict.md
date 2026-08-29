# L1 live-query invalidation — real-browser arm verdicts (shapes a–c)

**Status:** Closed (verdicts recorded in LLP 0317 O14 r2.8)
**Opened:** 2026-08-29
**Systems:** Live queries, Authorization invalidation, Client SDK, Acceptance testing
**Source:** LLP 0317.000 lane L1; LLP 0317 row O14 shapes (a)–(c); the client-arm
clause of LLP 0317.000 P1 that `issues/closed/20260829-l1-live-query-invalidation-linux-verdict.md`
left open and `issues/closed/20260829-o14-real-browser-arm-harness.md` chartered
**Harness:** `tests/acceptance/browser-live-invalidation-v1.mjs` at `3bb37aef9`
(landed `fe869de4a` + the sandbox-mode landing `3bb37aef9`)

## Why this arm was owed

The headless rerun of 2026-08-29 passed shapes (a)–(c) 10/10 on Linux x86_64
but could not close (b) and (c) as negatives: the lanes had reported them from
real Playwright browser contexts, and P1 names the client arm. This runner
drives real Chrome over raw CDP, runs the real `@expo/snapback-client` bundle
in the page with browser IndexedDB and Web Locks custody, and uses
`Target.createBrowserContext` for genuinely separate contexts (two for (a)
and (c), one for (b)), distinct principals with explicit distinct
`storagePartition`s, and the headless harness's witness invariants (original
subscription id unchanged, no `resubscribed`, socket attached, polling off,
authoritative frame inside 2,500 ms).

## Setup (P6)

- Host `expo-build-450b`, Linux 6.8.0-100-generic x86_64, node v24.13.1;
  browser `Chrome/140.0.7339.186` (Playwright's Chromium 1193), `headless=new`;
  Chromium sandbox **disabled** via `SNAPBACK_BROWSER_NO_SANDBOX=1` because the
  host restricts unprivileged user namespaces (recorded in the report; custody,
  protocol and witness evidence do not depend on it).
- Checkout `3bb37aef9c68319d7fa53766d58dd84a345ffea2`, clean; local
  `origin/main` resolved to the same SHA (`headEqualsOriginMain: true`).
- Binary built there by `scripts/bootstrap-ibex-runtime`; all 30 spawned
  servers reported `gitCommit 3bb37aef9…`, `gitDirty: false`; sha256
  `f8fa4186f378a04d665cdf4269100e31ce57358dbf8aeed4e6eb1625116299c0`.

```sh
CHROME_PATH=$HOME/.cache/ms-playwright/chromium-1193/chrome-linux/chrome \
SNAPBACK_BROWSER_NO_SANDBOX=1 SNAPBACK_RUNTIME_BINARY=$HOME/lanes/o14-linux/target/debug/snapback \
  node tests/acceptance/browser-live-invalidation-v1.mjs --shape a,b,c --runs 10 \
  --report-file ~/o14-linux-results/o14-browser-browser-3bb37aef9.json
```

## Verdicts

| Shape | Topology | Result | Verdict |
|---|---|---|---|
| (a) cross-context child-row invalidation | two browser contexts, distinct principals and partitions | 10/10 | **not reproducible** |
| (b) same-client own-write on an open hook | one context | 10/10 | **not reproducible** |
| (c) nested / list / point subscriptions, insert and patch, two contexts | two browser contexts | 10/10 | **not reproducible** |

`PASS LLP 0317.000 O14 standards-real browser invalidation — 30/30`. Each
verdict line as emitted: "10/10 consecutive fresh-server passes on Linux
x86_64 in real Chrome contexts with an exact clean runtime".

Together with the headless Linux rerun and the L19 landing, O14 is now fully
dispositioned: (a)–(c) not reproducible on both arms; (d) exact-179 not
reproducible; (d) past-ceiling confirmed, fixed in `9f7eb7f5d`, and proven
10/10 on both platforms.

## Scope limitations recorded by the report

Chrome only (Safari and Firefox are separate evidence arms); the
source-checkout client bundle, not the published 0.1.29 package bytes; the
sandbox mode above. None of these is a mechanism the lanes reported.

## Retained evidence

`~/o14-linux-results/o14-browser-browser-3bb37aef9.{json,log}` on
`expo-build-450b` (lane worktree retained); copy in the session scratchpad.
