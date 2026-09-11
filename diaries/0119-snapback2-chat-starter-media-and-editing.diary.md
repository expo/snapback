# Diary 0119: Snapback 2 chat starter media and editing

**Date:** 2026-09-11
**Subject:** the `snapback2` React chat starter on the page-resource Thread (main after `75a67c92c`); not a published package
**Agent:** Claude Opus 5, llp-ship run `20260911-s2-starter-papercuts`
**Tickets:** `issues/closed/20260911-snapback2-react-starter-thread-media.md`,
`issues/closed/20260911-snapback2-starter-retain-refused-edit.md`

## What changed

- Ordinary photos and clips render in the React thread (`MessageMedia.tsx`) with
  loading, not-downloaded and unavailable states and a bounded retry when the
  connection returns.
- Edits happen in an in-thread form (`EditMessage.tsx`) that survives refusals, late
  results and conflicts.
- Web `AssetImage` reports refusals, as React Native's already did.

## What felt good

- Real-owner jsdom tests pinned the editor lifecycle cheaply, including a delayed
  owner response, an owner-side conflict and an offline and reconnect cycle.
- The page resource gives the thread one item list across pages, so neither media nor
  editing needed pagination code.

## What was hard or surprising

- Five independent review rounds on the first branch each found a real defect that
  passing tests had missed: fake refusals with friendly rewrites hid the owner's
  compiler advice; a conditional edit needs its base to follow accepted text; a queued
  note promised automatic delivery while the readiness action was `connect`; an
  offline byte read refuses as a transport error, not an offline one; and an offline
  clip reports nothing at all, because its player URL is minted over the network and
  `useAssetUrl` drops that failure. Testing against the real owner and the real
  offline client closed each gap. The silent clip failure belongs in the SDK.
- A concurrent session landed a different implementation of the search, status and
  recovery tickets on the same starter files mid-run. The branch could not
  fast-forward; the author chose to port only the two tickets main still had open.
- The 60-line plain-screen contract on `Thread.tsx` pushed media and editing into two
  files. That keeps the screen readable but moves code rather than removing it.
- A bounded-retry test first counted every asset request and failed on photos left by
  earlier tests in the same file; scoping it to its own asset fixed a test bug, not a
  product bug.

## Comparison

React plus Convex: an edit form needs the same late-response guard. Convex has no
offline queue or held media, so the not-downloaded state and reconnect retry have no
equivalent there.
