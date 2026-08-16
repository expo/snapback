# Device retained store serves stale media-bearing LiveQuery rows

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Client, Expo, Live
queries, Assets

**Related:** guide/backend/media-happy-paths.md (the "media-bearing
LiveQueries deliberately do not receive the current single-table RQS resume
class" caveat), demos/media-happy-post, LLP 0244

## Signal (physical iPhone, Expo Go, demos/media-happy-post)

Ada's `profiles` row (media-bearing: `v.media()` avatar) kept rendering an
OLD avatar assetId on the device across multiple full app relaunches, while:

- a headless plain `query` as the same persona returned the current row;
- a headless **live** subscription (`client.liveQuery`, `rqsStore: null`)
  returned the current row on its first emission
  (`demos/media-happy-post/tests/probe-live-avatar.mjs` — prints
  `LIVE_AVATAR {"assetId":"01a00b8b-…"}` while the device still showed
  `01a00b6e-…`);
- the device's non-media `posts`/collection LiveQueries updated live
  correctly in the same session.

Server lanes are therefore correct; the staleness is client-side and
correlates with the on-device retained store
(`registerExpoFileSystemRqsFiles`): the retained media-bearing row is
rehydrated on boot and the fresh baseline emission never supersedes it in
the rendered output.

## Suspected shape

Media-bearing LiveQueries carry no single-table RQS resume class, so their
retained rows cannot resume-validate; whatever the client does on
reconnect/rehydration for that class appears to keep the retained row
instead of replacing it with the fresh baseline. Reproduce with an Expo
client + file RQS store + a media-bearing row updated while the client is
offline/closed, then relaunch.

## Wanted

Root-cause and fix in the client rehydration/supersession path for
media-bearing retained rows; regression coverage at the rqs-resume level
(the existing rqs-resume-expo suites are the home). The device demo and its
probes are the live repro.

## Resolution (2026-08-16, Phase I)

Root cause: the QMK/materialization retained-seed path in
`SnapbackClient.liveQuery()` set `seededFromMaterialization` but never
`seedFrameDelivered`, so after the retained first paint the fresh baseline
subscribe installed the new rows on the handle but the post-establishment
callback to frame-driven consumers stayed guarded off forever — React hooks
rendered the stale retained row indefinitely while imperative reads saw
truth. Exactly the device symptom (media-bearing rows are the common case
because they always retain without a resume class, but the hole was not
media-specific). Fixed by marking the seed frame delivered on that path;
three-session real-file-store regression (session A retains → out-of-band
media change → session B must supersede) proven red→green in
rqs-resume-native.test.mjs. Landed with the Phase I lane; the device demo
re-verifies visually on the next run.
