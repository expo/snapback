# Diary 0107: Sonnet 5 Clique Explicit on unpublished local main

**Date:** 2026-08-22
**Run:** `benchmarks/runs/2026-08-22-clique-local-main-sonnet5/`
**Lane:** Claude Sonnet 5, Clique M1–M8, Explicit authoring profile
**Backend:** local source commit `b70caf19eae1d4763224ebd182955e04430a67eb`
**Outcome:** M1–M4 green via the frozen Playwright choreography; M7
functionally complete (no frozen choreography exists for it); M5/M6/M8
partial, each blocked by at least one verified, disclosed gap rather than an
unresolved app bug. 710,707 output tokens, 1,054 tool uses, ~3h44m wall
(10:32Z–14:17Z).

This is N=1 diagnostic evidence against unpublished source, not scored or
claim-eligible — same posture as the prior Codex-based local-main run
(diaries 0104/0105). The lane agent's complete diary, essay, final report,
and generated app remain under
`/Users/ccheever/clique-main-20260822/explicit/` on this machine (outside
git). See `benchmarks/runs/2026-08-22-clique-local-main-sonnet5/record.md`
for the paired Familiar-profile result and important methodology caveats
that apply to comparing the two.

## M1–M4 — accounts, feed, messaging, media — GREEN

Backend design for M1–M3 was largely adapted from `demos/coterie` — a
sibling lane in this repo building the identical brief on a different
client framework against the same Snapback backend — which the agent called
"the single biggest accelerant of the whole session," turning hours of
social-graph/messaging schema design into about 20 minutes of porting.
Built-in password auth and live queries made cross-client profile/feed/
message updates fall out for free, with zero hand-written subscription or
cache-invalidation code across all four milestones.

Two real environment-level defects cost most of M1's time: the CLI's
checkout-root inference assumes a one-level-nested release layout and came
up short for a `target/debug/snapback` cargo path, wrongly refusing the
runtime-readiness receipt as drifted despite byte-identical artifacts
(related open ticket:
`issues/20260817-0275-auto-qualify-packaged-runtime-in-prove.md`); and
`snapback dev --expo`'s zero-config auto-session-mint actively fights an app
implementing real first-party auth (signing out the phantom principal
revoked one session shared by every browser context). Both have findable
root causes and working fixes, but neither is flagged anywhere the agent was
reading, which cost real time.

M4's standout finding: every image and video in the app had been rendering
broken since M2 — the agent was passing a raw `v.assetRef` id straight into
`<Image>` as a URL instead of resolving it through `useSnapbackAssetUrl`,
across every media-rendering screen. The docs were correct and explicit
about the resolution step; M2's choreography simply has no compose
media-picker test id, so a "green M2" never actually exercised an image.
Filed as the sharpest single lesson of the run: **choreography-green is
only as strong as what the frozen contract actually drives.** A second M4
flake (the video-viewer check passing in isolation but failing in the full
run) turned out to be self-inflicted — 144 accumulated messages from ten
unreset choreography reruns against the same dev database, degrading
interaction latency until it looked exactly like a platform bug.

## M5 — ephemeral, chat config, search — PARTIAL

Redesigned message search as a client-side `localStorage` cache after
confirming Snapback has no offline-resolution story for a brand-new live
query subscribed after the network drops (the guide says so outright).
Genuinely blocked by a verified `environment` defect, not fixable from the
app: the frozen UI kit's "selected" state relies on React Native's nested
`accessibilityState`/`accessibilityValue` props, and the scaffold's
installed `react-native-web@0.21.2` doesn't forward those to the DOM at all
— confirmed by reading `forwardedProps/index.js` directly. No
`aria-selected` ever lands on the node the choreography checks.

## M6 — offline writes, push seam, custom-client API — PARTIAL

Push-log emission and the custom third-party client (`API.md` +
`scripts/custom-client-demo.mjs`, built on the same `@expo/snapback-client`
package the app itself uses) both work end to end. The one required
offline-writes assertion is blocked by a real, disclosed platform gap:
`guide/capabilities.md` marks the Expo/web durable outbox as "awaiting
device qualification," and `queue: "auto"` degrades to a hard rejection
rather than pretending to queue. The agent called this the clearest
capability-gap finding of the run — and noted, slightly ironically, that
the headless custom-client path is currently a more solid foundation for
offline-durable integration than the app's own Expo/web front end.

## M7 — polls and backfilled message count — done, uncovered by choreography

Polls reused the same idempotent-set-state pattern used everywhere else in
the app (follow/like/repost/reaction). Rereading M3's own code against M7's
spec surfaced a real, previously-undetected bug: `deleteMessage` and the
disappearing-message sweep never decremented `conversations.messageCount`,
violating the brief's own semantics since M4. Fixed both call sites and
shipped an idempotent `backfillMessageCounts` mutation plus a runner script
— no dedicated "migration" primitive needed, just the same
mutation-and-headless-client pattern used throughout.

## M8 — insights, digest, multi-device — PARTIAL

3 of 5 choreography assertions passed with zero additional fixes, including
two multi-device checks (same-account live messaging across two browser
contexts, cross-device read-state sync) that "just worked" because the M1
auth model and M3 receipt design never had a device concept to begin with.
The remaining two fail for the identical, already-diagnosed M6 offline-
outbox gap. The daily-digest cron shipped but is unverified against a full
period given remaining time — a disclosed gap, not a claimed pass.

## Bottom line

21 correction loops: 3 `snapback-defect`, 3 `snapback-defect`-adjacent
(disclosed platform gaps, not bugs), 1 `environment`, 14 `agent-error`. The
agent's own framing: the live-query/session model is a structural strength
that paid off in features it was never specifically built for (multi-device
sync), the worst bug of the run was its own (asset-URL resolution), and the
two real platform gaps (offline search resolution, offline write
durability) were both discoverable from the guide's own capability index
rather than hidden — "a meaningfully different experience from a platform
that quietly pretends to queue the message and loses it," even though the
underlying capability is behind Convex/Supabase today for that specific
slice.
