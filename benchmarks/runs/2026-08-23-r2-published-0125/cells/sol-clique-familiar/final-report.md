# Clique M1–M3 final report

## Run identity and wall clock

- Lane: `sol-clique-familiar`
- Model: `gpt-5.6-sol`; effort: `xhigh`
- Raw run start: `1787596759`
- Raw run end: `1787599833`
- Total recorded authoring wall: 3,074 seconds (51m 14s)

| Milestone | Start epoch | Boundary/end epoch | Wall | First fully-green epoch | Time to first green |
| --- | ---: | ---: | ---: | ---: | ---: |
| M1 | 1787596904 | 1787598375 | 1,471s (24m 31s) | 1787598297 | 1,393s (23m 13s) |
| M2 | 1787598375 | 1787599194 | 819s (13m 39s) | 1787599111 | 736s (12m 16s) |
| M3 | 1787599194 | 1787599833 | 639s (10m 39s) | 1787599638 | 444s (7m 24s) |

M1 and M2 boundary epochs are the next milestone's controller-authorized start. M3 ends at the sealed report/cleanup epoch. “First green” is the first epoch at which both that milestone's suite and required choreography were green, not merely the first suite pass.

## Results and retained evidence

| Milestone | Suite | Starter replay | Frozen choreography | Native/build evidence |
| --- | --- | --- | --- | --- |
| M1 | 7/7 suite-required assertions passed | 16 ordered actions | 3/3 required checks passed | iOS Hermes bundle at `dist/m1-ios/_expo/static/js/ios/entry-b3a2a64d40f4ecc29a66b8722e15fde6.hbc` |
| M2 | 22/22 suite-required assertions passed | 68 installed actions, including 52 M2 actions | 7/7 required checks passed; 2 harness-declared optional media checks skipped | TypeScript and Familiar codegen green |
| M3 | 7/7 suite-required assertions passed | 87 installed actions, including 19 M3 actions; full replay repeated twice without starter duplicates | 2/2 required checks passed; the optional quoted-reply check also passed; 4 harness-declared optional checks skipped | TypeScript and Familiar codegen green |

Canonical artifacts are `suite-status.json`, `receipts/mN-suite.json`, `receipts/mN-suite.observations.jsonl`, `receipts/mN-choreography.jsonl`, and `receipts/mN-choreography.jsonl.observations.jsonl`. Seed write receipts are retained as `receipts/mN-seed.jsonl`. Every starter action was replayed sequentially through generated app mutation references, not inserted directly into SQLite.

No required assertion was relabeled. The M2 media-live skips, M3 sender-avatar skip, receipt-transition skips, and removed-member choreography skip are emitted by the frozen `0.3.3-m8` harness as structurally optional because its contract lacks semantic controls or observations. The app does render sender avatars, but the harness correctly refuses to infer them from glyphs or raw image structure.

## Correction loops and attribution

The detailed timestamped record is in `run-log.md`. Material loops were:

- M1: five agent-error loops—correct npm package identity, restrict an accidentally broad instrument search, isolate a relocated scaffold's stale absolute reservation, repair TypeScript/compiler-state assumptions, and make fixture avatar resolution React-Native-web-safe. The unavailable in-app browser was an environment limitation; the frozen Playwright harness remained authoritative.
- M2: seven agent-error loops—read the assertion manifest's correct shape, respect the inline relational ceiling, separate transport mutation identity from durable fixture identity, verify mutation settlement by unique source ID, restore feed-shell reachability after follow, lead the contracted profile surface with display name, and unmount the outgoing composer before an Expo Router stack transition. One transient `SNAPBACK_AUTH_MODE_PENDING` retry was attributed to the environment during live schema reload.
- M3: three agent-error loops—use the required principal validator during the attempted authority declaration, recover from incompatible generic writes to an authority table, and isolate client-owner/storage identity for the second in-process replay. The resulting ordinary-roster fallback is recorded as an ambiguous workaround because the codegen refusal was correct while the served Familiar recovery path was incomplete.

Two command-hygiene errors and the initial prohibited-scope discovery incident are also recorded. The latter exposed sibling-lane filenames and, on a later failed exclusion, unwanted prior-run text in terminal output. No sibling file was deliberately opened and none of that content was used as implementation input.

## Backend and runtime pins

- Authoring profile: `snapback-familiar-ts-v1`, explicitly pinned in `snapback/codegen.policy.json`.
- Published Snapback packages: `@expo/snapback-{cli,client,codegen,expo,react,acceptance}@0.1.25`.
- Final generated graph: 8 tables, 21 operations, 11 live queries, 10 mutations, and 1 ephemeral collection.
- Local backend target: `local-dev-sqlite-ibex`; health receipt reported Snapback runtime crate `0.1.0`, git commit `9d9265394953769aaa52e63c8a914464175f93ab`, SQLite version 79, and Ibex available.
- Expo `57.0.16`, Expo Router `57.0.16`, React/React DOM `19.2.3`, React Native `0.86.2`, React Native Web `0.21.2`, TypeScript `6.0.3`, Playwright `1.62.1`.
- Passwords use Snapback's built-in sessions password provider and recovery-code policy; the served guide documents its Argon2id path. No application table or log stores password material.
- All lane servers used only ports 42020 and 42021. Owned process trees `64107/64125/64132` and `64223/64241` were stopped by their exact sessions; final `lsof` and `ps` checks were empty. Earlier guide-only PIDs `58968/58977` were also stopped exactly.

Published `0.1.25` codegen writes `snapback/generated` and its running Familiar guide explicitly says `_generated` is retired/refused. I followed the build-bound guide instead of manufacturing a second generated tree. There is no `schema.mjs`, `functions.mjs`, explicit-profile fallback, scale replay, or M4–M8 implementation.

## Knowledge and source inspection

Knowledge came from the authoritative instrument, the running binary's served Guide, and published package type declarations. Guide pages covered the Expo start packet, Familiar profile, sessions/principals, passwords, fixed-origin development, ephemeral state, and membership-scoped typing. Published package types supplied exact Familiar database, provider, hook, ephemeral, and activity-presence signatures.

No Snapback implementation source was inspected. The only published-package filesystem reads were shipped type declarations, generated artifacts, and the CLI template's start packet. There were no npm README, web, or external-source lookups. The accidental prohibited-scope terminal disclosures are recorded as errors rather than source-inspection events.

## Candid gap list

- Typing is a real Snapback ephemeral activity-presence flow with TTL and idle withdrawal, but the final room policy is `allow.all`. The UI filters peers through the durable roster, which is not an authorization boundary. An outsider who learns a conversation ID could subscribe or publish. The first canonical `allow.members` design was rejected because generic Familiar writes cannot target the declared authority table; completing this safely requires the declaration-owned bootstrap/transition workflow that the served Familiar recipe did not show end to end.
- Conversation rosters are ordinary public-read rows. Message operations check current membership server-side before every read and send, and owner checks protect removal, but the roster itself is not a canonical Snapback authority declaration.
- Avatar and M2 post-media fixture references are durable URI strings rather than Snapback-managed uploaded byte assets. The suite exercises the app write/projection paths, and the frozen M2 browser cannot drive media compose, but production media custody remains unfinished.
- The final app has no interactive M2 image/video picker. Text compose, seeded media rendering data, and the suite's image/video creation paths exist; the frozen harness declares the two live media checks optional.
- Delivered/read receipt state machines and removed-member retained-history UI are not implemented. The M3 harness explicitly skips those observations as optional under its frozen contract.
- Global live queries intentionally cap at the published inline ceiling of 1024 rows. This is sufficient for reduced M1–M3 and the instructed no-scale run, not a scale architecture.
- Codegen reports 18 migration-pending warnings for generic writes on ordinary public-read tables. They are warnings under the pinned runtime, not hidden failures, but a future write-authority migration is required.
- The in-app browser controller had no available session. All required browser proof came from the frozen isolated-context Playwright choreography.

end=1787599833
