# Snapback 4: a local-first ephemeral watch drops to `loading` whenever a durable table it depends on is invalidated

**Opened:** 2026-09-26 (calibration #22 on `snapback4@0.4.3`, M3)
**Severity:** Medium: typing indicators flicker off during unrelated durable writes, and one M3 choreography attempt missed the 2 s bound in all three trials
**Area:** `snapback4/packages/snapback4/src/local-query.ts` / `local.ts`: server-fallback watches on the local-first tier; LLP 3000.017 §2.3–§3.3
**Resolved:** 2026-09-26 — lane EK, the paved typing read opts into `keep: true` (LLP 3000.019 §3.3, revision 4).

## Resolution

The ephemeral card now uses
`useQuery(api.typingIn, { roomId }, { keep: true })` and asks separately
observed `typingInMyRooms` to opt in too. An unrelated membership write can
then re-read without hiding typing; the existing displayed-expiry fence
still withdraws the answer. No client change was needed.

The original automatic-retention direction below is superseded by LLP
3000.019 revision 4. The same `members` commit may remove the viewer, and
the platform cannot distinguish that from an unrelated update. The default
therefore still withdraws the old answer. Keeping is the application's
presentation choice: it may display revoked rows until the re-read lands.

`snapback4/packages/snapback4/test/ephemeral-keep.test.mjs` reproduces both
paths on online, wasm and process clients with real server answers. A peer
sets typing once, then commits 20 member-row updates at 100 ms intervals.
Every kept publication retains the row; the default publishes loading and
then the row again. Replacement replies are held across the 4 s deadline:
the kept row disappears within 5 s of the last call, and releasing old
bodies cannot resurrect it. Initial measured disappearance was 4,445 ms
online, 4,357 ms wasm and 4,315 ms process, including the initial write's
transport and schema discovery.

## What happens

- `typingIn` reads `typing` (ephemeral) and probes `members` (durable) in
  its read rule. Its answer's `tables` is `["members","typing"]`.
- On the local-first tier, a durable commit that touches `members` (here,
  the app's own acknowledgement writes when a thread observer mounts)
  invalidates the watch.
- The re-run first evaluates on the device, which answers `unknown`. It
  publishes the `{ loading: true }` placeholder, then falls back to the
  server.
- A UI that shows typing when `data.length > 0` hides the indicator for
  that window. Under steady durable write traffic it can stay hidden past
  the benchmark's 2 s visibility bound.

The builder's probe (`evidence/typing-probe3.txt` in the lane) alternates
`typing-state {"loading":true}` with fresh server answers carrying the
peer's row. Its run log records the correction loop at `1790426288`:
"redundant acknowledgements at every observer mount kept ephemeral reads
loading during sync". The builder worked around it by removing redundant
acknowledgement writes. M3 choreography attempt 3 failed
`typing-indicator-within-2s-expires-within-5s` in all three trials (visible
timeout 2000 ms), before that workaround.

## Why it is the platform's

A device can never answer an ephemeral read, so the device-first step adds
only a placeholder. Durable invalidation of a server-answered watch should
revalidate while keeping the last server answer, with `fresh: false`, as the
online tier and N4's discovery fallback already do. It should not publish
`loading`.

## Fix direction

For a watch whose `ephemeralReads` is non-empty (or, more generally, one
whose last answer came from the server fallback because the device answered
`unknown`), an invalidation re-run should skip the device placeholder and
keep the previous answer, marked `fresh: false`, until the server replies.
Regression test: a peer's typing row stays visible across a burst of
durable commits to a table the typing query's rule probes, on the
local-first tier.

Evidence: `~/clique-sb4-20260926-astra-cal22/lanes/astra-snapback4/evidence/typing-probe{2,3}.txt`,
`m3-choreo-attempt3.jsonl`, and `run-log.md:36`.
