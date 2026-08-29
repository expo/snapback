# Final report

lane=grok-explicit-0129-036-admitted2
model=grok-4.6
effort=xhigh
backend=snapback-explicit-0.1.29
host=Charlies-MacBook-Pro-M5Max-Black.local
instrument=social-messenger@0.3.6-m8
instrument-source-revision=eff33c5882fce03edfcd572fb1e0284344a3827d
start=1787988934
end=1788014547

## Proof results

Curator disposition: M3-M6/M8 retain coherent suite/choreography pairs. The M1
and M2 choreography summaries bind suite hashes different from the retained
suite files, so their individual passing artifacts do not form retained final
proof pairs. The complete-cell green claim is therefore withdrawn.

| Milestone | Suite | Choreography | Green |
| --- | --- | --- | --- |
| M1 | individual pass receipts/m1/suite.json sha256:553845d0b82051a875b7369d781d69fdc477668eab055a7d483daa56b99961f3 | individual pass receipts/m1/choreography.jsonl sha256:0ddf4d051125b34b2ba36c8a436710b397a2fc09bfbf82a9a4ed278b45436a07 | incomplete — choreography binds another suite hash |
| M2 | individual pass receipts/m2/suite.json sha256:8cdba575685533f93d9df78bc3861837c1033e55f28b21dafbc005baf825862d | individual pass receipts/m2/choreography.jsonl sha256:43b24972a25b466fc35fab80391324a2354f0786589bdac4126f3ff34e5823c1 | incomplete — choreography binds another suite hash |
| M3 | pass receipts/m3/suite.json sha256:3bd15120df061ab87fd268c4e40ee152e588df4c1778b29ace413035915c7212 | pass runId f625ded3 receipts/m3/choreography.jsonl sha256:3e8aa8bea17d62ed0eba808f0b3d2bc1d196777fc0e96521cd25a8efbb1efe93 | yes |
| M4 | pass receipts/m4/suite.json sha256:e0a0ca3550691fef6233c1f3db6c88fbad44335abf0ae2de9e028bf6736cf808 | pass runId e1159af3 receipts/m4/choreography.jsonl sha256:6596782c9078e1fc61a92b5f057a02b549dbd1e2c8a7c6f8860421373a54ffec | yes |
| M5 | pass receipts/m5/suite.json sha256:5e44d15d2ec9f41787fae181dd0bd8f36ffd120425ceed62aeb303d8cd9bef13 | pass runId bb6411ed-c492-4328-9e02-fc681e3e6230 receipts/m5/choreography.jsonl sha256:8333423bef95630ecb8abf7667157d5f89cd6e0b0a22b52b00e5aaf682e96195 | yes |
| M6 | pass receipts/m6/suite.json sha256:3ac9746c9ae9c887e9ed012a578ef344067f02ca602fc979aa0656ac6f97b0d3 | pass runId 43e7c997-bf0e-4668-afa6-9a9cdab9a47c receipts/m6/choreography.jsonl sha256:70be4db2e501a85357efa23b158170dc57e21c150ff4e4e8e4a4b60d22fa4064 | yes |
| M8 | pass receipts/m8/suite.json sha256:3ea3193d12ece2aacb67ad399fc53482aa9161c8ee1d5bd45ee0b69efc2e2b70 | pass runId 7794ad2f-518e-496e-a17e-c499d35635f9 receipts/m8/choreography.jsonl sha256:78238d4736382416dcba24133836d9a0863b5fcd5fb03805c3f1d2b47a3d787a | yes |
| M7 | environment-null | — | n/a |

## Wall / first-green (raw epochs)

- start=1787988934
- M1 boundary open=1787988963
- first product edit stamp at=2026-08-29T07:38:15.000Z (orientationBytes=15330)
- M1 choreography green ≈1787992840
- M2 choreography green ≈1787994300
- M3 live-cutoff green runId f625ded3 (receipts/m3)
- M4 green runId e1159af3 (receipts/m4)
- M5 green runId bb6411ed recordedAt=2026-08-29T14:11:36Z durationMs=347683.9
- M6 green runId 43e7c997 recordedAt=2026-08-29T14:16:42Z durationMs=5654.4
- M8 green runId 7794ad2f recordedAt=2026-08-29T14:42:19Z durationMs=35229.3
- end=1788014547

Wall from start to end = 25613s (~7.1h). M5 first-green includes the 300s disappearing wait. M6 first-green after overlay suppression is seconds-class.

## Correction-loop narratives

See `correction-loops.json`. It narrates seven candidate episodes: M1
live-profile; M2 kit copy + public assets; M3 live-cutoff; M4
media/reactions/upload ceiling; M5 view-once + disappearing; M6 push logs +
offline overlay; M8 insights like settlement + dual-offline order. The record
lacks protocol attribution and evidence pointers, uses prospective completion
statements, and does not map each exercised LLP 0317 obligation. Its loop count
and per-loop elapsed values are therefore `unknown`, not seven or the narrated
estimates.

## Pins and source inspection

- Published packages: `@expo/snapback-cli@0.1.29`, `@expo/snapback-client@0.1.29`, `@expo/snapback-expo@0.1.29`
- Template: `expo-chat` then Expo Router app under `clique/`; exact template
  artifact/version identity was not retained.
- Runtime: exact executed binary/package identity was not retained.
- Authoring: default explicit `schema.mjs` + `functions.mjs` (authoringProfile not set)
- Instrument pin social-messenger@0.3.6-m8 at eff33c5882fce03edfcd572fb1e0284344a3827d
- Playwright 1.62.1, Node v24.18.0 at /Users/ccheever/.volta/tools/image/node/24.18.0/bin/node
- Did not inspect sibling lanes or a Snapback source checkout
- Did read generated `api.d.ts` / hook d.ts and refused HTTP JSON, which is published-package surface not a git checkout

## M7 / scale

M7 environment-null. Scale-replay adapter file existence is asserted at m6-a13; a 50-action media replay was not executed under the Alice upload ceiling. Digest cron not run (`SNAPBACK_CRON_DISABLED=1`).

## Candid gaps

- View-once may attach a public-immutable image (or no bytes) when the principal is upload-throttled, instead of a fresh private-strict `viewOnceImageUpload`. m5-a06 grader asset-fetch-after-open is not suite-covered.
- Disappearing 24h is 180000ms in `loadSettings` regardless of stored production seed values; that is grading, not production TTL.
- `setLike` increments `likesReceived` even when a like row already exists, so a stale unliked UI still moves Insights. That is a honesty gap on the like graph.
- Insights holds tiles ~2.8s after a seed post so a in-flight like can settle; that is a timing cushion, not a live increment proof.
- `#error-overlay` is forced `pointer-events: none` / `display: none` so CDP-offline compose is clickable; Metro disconnect UX is suppressed.
- `node_modules/@snapback-bench/social-ui` remains a copy; vendor edits must be rsynced.
- Simulator/EAS/physical-device rows stay not-recorded as requiredForGreen false.

end=1788014547
