# Clique / Snapback 2 — final report

lane id grok-clique-snapback2
model grok-4.6
effort=xhigh
backend=snapback2-0.0.20
tokens=null (advisory; Grok)

## Wall clock

start=1788960695
end=1788970779
lane wall seconds=10084 (~2.8 h)

Approximate milestone walls (from run-log epochs; overlapping Expo restarts included in the then-current milestone):

| milestone | start epoch | end epoch | wall s | first-green | status |
| --- | ---: | ---: | ---: | --- | --- |
| M1 | 1788960695 | 1788963800 | 3105 | 1788963800 | green |
| M2 | 1788963800 | 1788965550 | 1750 | 1788965550 | green |
| M3 | 1788965550 | 1788970433 | 4883 | null | aborted |
| M4 | 1788965550 | 1788965800 | suite-only | null | blocked-by-M3 |
| M5 | 1788965550 | 1788965800 | suite-only | null | blocked-by-M3 |
| M6 | 1788965800 | 1788970433 | suite-only | null | blocked-by-M3 |
| M7 | — | — | — | null | not-run |
| M8 | 1788965800 | 1788970433 | suite-only | null | blocked-by-M3 |

M4–M6/M8 suites ran during M3’s choreography loops (same session, same owner). They do not make those milestones green. M3 is `aborted` (choreography not green; wall cap not exhausted; session moved on to remaining suite evidence). Aborted counts as a capability-failure for proceed. M4+ are `blocked-by-M3` (prerequisite not green). One independent CF; the lane did not hit two consecutive CFs.

## Suite and choreography

| milestone | suite | coverage receipt | choreography | receipts |
| --- | --- | --- | --- | --- |
| M1 | 8/8 pass | coverage-m1.json | green | receipts-m1.jsonl |
| M2 | 23/23 recorded (22 suite-required) | coverage-m2.json | green | receipts-m2.jsonl |
| M3 | 8/8 recorded (7 suite-required) | coverage-m3.json | failed (dm-live-messages, typing, receipts, dave candidate) | receipts-m3.jsonl |
| M4 | 5/5 pass | coverage-m4.json | not-run | — |
| M5 | 6/6 pass | coverage-m5.json | not-run | — |
| M6 | 5/5 pass | coverage-m6.json | not-run (web); simulator absent | — |
| M8 | 6/6 pass | coverage-m8.json | not-run (web); simulator absent | — |

Coverage map: `coverage-manifest.json` (`clique-coverage-manifest.v1`, instrument `social-messenger@0.3.6-m8`).

## Correction loops

1. M1 profile-edit-live-visibility — RN-web fill vs empty handle. Attribution: agent-error. Evidence: receipts-m1.jsonl.
2. M3 send `E_CONSTRAINT` unreadCounts.byConversationPrincipal — sender could not read recipient unread row. Attribution: agent-error. Evidence: acceptance m3-send-root.
3. M2 choreo media `aria-valuetext` / video poster / profile feed tabs. Attribution: agent-error. Evidence: receipts-m2.jsonl first run vs green rerun.
4. M3 choreo composer/send/live DM — Expo web form vs Playwright; several iterations. Attribution: agent-error. Evidence: receipts-m3.jsonl.
5. M8 hideTrending — `admin.dropTrending` is a schedule target (`E_OPERATOR_REQUIRED`). Attribution: snapback2-defect (knowledge-gap / API shape). Evidence: client mutation refusal; hideTrending added.

## Native artifacts

- dist/ios-m1 Hermes `.hbc` (M1 export)
- dist/ios-m2 `index-26822a22360dc890c092e79b75736eb3.hbc`
- dist/ios-m3, ios-m4, ios-m5, ios-m6, ios-m8: copies of the M2 export (same JS bundle; not independently rebuilt)
- M6/M8 iOS simulator proofs: not produced. Simulators exist on the host (iOS 26.3–26.5); several foreign Clique sims were already Booted. This lane did not boot or install onto them.

## Scale replay

Not executed against a fresh instance. `fixtures/scale.log` is 167159 actions.

- adapter: `scripts/replay.mjs` (also used by `scripts/seed.mjs`)
- M6 sample-50: pass (50/50) on the dev owner at http://127.0.0.1:50400
- scale start epoch: null
- scale end epoch: null
- invariant-manifest-combined.json verification: not-run

Platform bound that would have bitten a full replay: following-feed merge and any follower fan-out are capped at 50 (`E_STRUCTURAL_FANOUT` without `cap 50 by followed`). u0500’s 500 follows and u0900’s 900 followers cannot be projected as 500/900 merge lanes.

## Resolved package pins

- snapback2 0.0.20 (npm; darwin-arm64 binary)
- expo ~54.0.37, expo-router ~6.0.24, react 19.1.0, react-native 0.81.5
- Node v24.18.0 (`/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node`)
- Playwright 1.62.1 (choreography)
- ports: snapback2 owner PID 56596 on 127.0.0.1:50400; Expo web last PID 16526 on *:50401 (earlier Expo PIDs 99398, 53541, 78993, 10436, 34516, 48665, 75074, 90131 rotated by explicit kill of those PIDs only)

## Hand-authored line counts (wc -l, selected)

| path | lines |
| --- | ---: |
| snapback/schema.q | 431 |
| lib/thread-view.tsx | 593 |
| scripts/acceptance.mjs | 366 |
| app/index.tsx | 340 |
| scripts/replay.mjs | 217 |
| scripts/seed.mjs | 204 |
| snapback/messages.q | 171 |
| snapback/posts.q | 166 |
| snapback/groups.q | 110 |
| lib/chat-settings-screen.tsx | 108 |
| app/profile/[handle].tsx | 109 |
| API.md | 39 |
| snapback/*.q + scripts + app + lib (sum of counted files) | ~5200 |

Vendor-ui is the frozen kit copy; small `aria-valuetext` patches were applied for RN-web.

## Gap list

1. Following-feed `merge` first 50 follow lanes; follower write fan-out refused without `cap 50 by followed` (celebrity / u0500).
2. Thread query cannot join full image columns + profiles + quotes under the 4 MiB maintained-address ceiling; media is `messageMedia` as a second query.
3. Schedule-target mutations are not client-callable (`E_OPERATOR_REQUIRED`).
4. Sender cannot see other principals’ unread rows unless read rules are broadened (unique-insert race).
5. Expo web + Playwright: controlled RN inputs, missing `aria-valuetext`, Metro `hot=false`.
6. Starter group Weekend Plans includes Erin; three-client choreography aggregate receipts wait for her unless she is removed.
7. Scale replay not run; M3 web choreography not green; M4–M8 web choreography and M6/M8 simulator proofs absent.
8. Digest `newPostsInFollowing` is not incremented per follower at post-create (fan-out cap).
9. iOS milestone bundles after M2 are copies, not fresh exports.

end=1788970779
