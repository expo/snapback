# Social quote-jump proof still passes async predicates to Playwright waitForFunction

Status: Open
Discovered: 2026-10-31, PUB051 social-fixture audit
Scope: verification follow-up, not an established product regression

PUB051 confirmed that the pinned Playwright runner resolves `page.waitForFunction(async () => false)` immediately with a false handle (22.7ms in a fresh Chromium page). An async predicate therefore is not a polling barrier. The concrete probe and output are retained in PUB051 records at `diagnosis/social-ready-probe/async-predicate.json`.

The social-browser fixture was repaired under PUB051 by using the existing waitFor helper around `page.evaluate`, so every poll observes the resolved value. A remaining repository search found two async predicates in `snapback4/packages/snapback4/test/social-quote-jump-browser.test.mjs`: the layout/readiness barrier (around line162) and post-Send history check (around line335). The first owns font/layout/correction timing and needs its measurement semantics audited before a mechanical replacement. Other synchronous predicates are unaffected.

Follow-up: replace both with awaited-value polling, preserve measurement on the page clock and the layout-correction ownership assertions, prove an always-false async check cannot pass, then run the quote-jump proof on its web/process/Expo fixture tiers. Do not loosen latency limits or normalize a surfaced runtime regression into a pass.

PUB051 does not claim this unrelated quote-layout proof has been repaired. No product failure was established from these sites; the issue records a verification gap beyond opening-refusal recovery.
