# Final report — grok-clique-explicit

## Clocks

| mark | epoch |
| --- | ---: |
| start | 1787656054 |
| first-product-edit.json | 1787656527 |
| M1 first green (suite+choreo) | 1787658098 |
| M2 schema successor activated | ~1787658263 |
| end | 1787659243 |

Wall by milestone (epoch delta):

| milestone | start epoch | end epoch | wall_s | status |
| --- | ---: | ---: | ---: | --- |
| M1 | 1787656054 | 1787658098 | 2044 | green |
| M2 | 1787658098 | 1787659243 | 1145 | capability-failure (web identity mismatch after additive successor) |
| M3 | — | — | 0 | blocked-by-M2 |

First-green: M1 at 1787658098 (suite receipts/m1/suite.json pass=true; choreography receipts/m1/choreography.jsonl segment green=true). M2/M3 first-green: null.

## Pins

- CLI / packages: `@expo/snapback-cli@0.1.27`, `@expo/snapback-client@0.1.27`, `@expo/snapback-codegen@0.1.27`, `@expo/snapback-expo@0.1.27`, `@expo/snapback-react@0.1.27`, `@expo/snapback-acceptance@0.1.27`
- Runtime: `@expo/snapback-runtime-linux-x64@0.1.27` (`bin/snapback`, sha256:8477a11d404b504321821f1d026212102efaf4a15afb965866c808732aa6fc3a, gitCommit 98681377721e86a836cd26f138b55e5cd2968a52)
- Template: `expo-chat` then Expo Router adaptation
- Authoring: explicit default (no `authoringProfile` in codegen.policy.json); generated `authoringProfile: snapback-explicit-v1`
- Instrument: social-messenger@0.3.3-m8
- Ports: backend 48100, bootstrap 48101, Expo web 48110, Metro 48119 (range 48100–48119)
- Lifecycle owner: pid 3605743, `snapback dev snapback --expo --expo-platform web --port 48100 --client-port 48110 --bootstrap-port 48101 --port-range 48100-48119 --application-ready-file .snapback/application-ready.json --ready-file .snapback/dev.ready.json --json`
- Native iOS / Hermes export: environment-null

## M1 → M2 deployment identity (additive, no destructive reseed)

- old schemaHash: `snapback.v1:sessions:schema:sha256:2d884c3241841d6b39e4220bf5a21509785b78a4c548752b3269b585dfadaf25`
- new schemaHash: `snapback.v1:sessions:schema:sha256:f6d3f2a1ce7a86d3b8720cb883805f44cf468dc0b405c0b8882dcf72daf93f29`
- continuity (lifecycle `startup-successor-activated`): database preserved, accounts preserved, sessions preserved, stores preserved
- starter-m1 replay: 16 actions; starter-m2 replay: 52 actions, both through generated auth/mutations

## Suite / choreography

| milestone | suite | choreography | green |
| --- | --- | --- | --- |
| M1 | pass (m1-a01,a02,a03,a04,a08,a10,a11) receipts/m1/suite.json | pass 3/3 required receipts/m1/choreography.jsonl | yes |
| M2 | incomplete; last run crashed looking up seeded Global rows after binding mismatch | not completed (login blocked: no sm-auth-email, boot error) | no |
| M3 | not run | not run | no |

Coverage map: `coverage-manifest.json` (clique-coverage-manifest.v1, all M1–M3 suite-required IDs in registered order).

## Correction loops

| when | attribution | note |
| --- | --- | --- |
| generate HANDLE_RE | agent-error | inline handler cannot capture top-level const |
| replay memory platform | agent-error | SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE; expo-web+fake-indexeddb |
| Chromium libs | environment | user-prefix .deb extract; LD_LIBRARY_PATH |
| remount dropped HANDLE_TAKEN | agent-error | stable AppChrome children slot |
| setProfile same tick as signup | agent-error | pendingProfile effect after authenticated dispatcher exists |
| Expo extra vs successor | snapback-defect | SNAPBACK_APP_BINDING_IDENTITY_MISMATCH after in-lifecycle generate; owner stdin is /dev/null so reload/restart cannot be sent |

## Source inspection

No Snapback git checkout. Reads were published npm package files (templates, README, `define.d.ts`, `ctx.d.mts`, `app-client.d.mts`, selected `.mjs` for mutation queue:false and binding admission) plus the served Guide at `http://127.0.0.1:48100/_snapback/guide/`. Recorded in run-log.md.

## Gaps

1. Supervised Expo web does not refresh its integration-receipt / admitted binding when `snapback dev` activates a schema successor in the same owner.
2. `snapback dev` JSON control channel is unusable if the process was started with stdin `/dev/null`.
3. Durable custody is unavailable on the Node `memory` platform; headless replay must impersonate `expo-web`.
4. Inline JS handlers cannot use module-level consts (only function declarations).
5. `defineCommand` admits at most one asset input, so multi-image posts need `assets.upload` then mutate.
6. Host Chromium shared libraries were absent; Playwright required a manual library prefix.
7. M3 messaging (DM reuse, typing ≤2s/≤5s, quotes) not shipped because M2 web green was blocked.

end=1787659243
