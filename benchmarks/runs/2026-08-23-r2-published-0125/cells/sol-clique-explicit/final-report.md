# Clique M1–M3 final report

Lane: `sol-clique-explicit`  
Model: `gpt-5.6-sol`  
Effort: `xhigh`  
Instrument: `social-messenger@0.3.3-m8`  
Backend: `snapback-explicit-0.1.25`

## Clock and first green

Raw lane start epoch: `1787562369`  
Raw lane end epoch: `1787566098`  
Total authoring wall: `3729s` (`62m09s`)

| Milestone | Raw start | Raw end | Wall | First full-green epoch | Start-to-first-green |
|---|---:|---:|---:|---:|---:|
| M1 | `1787562383` | `1787565293` | `2910s` (`48m30s`) | `1787565244.184` | `2861.184s` (`47m41.184s`) |
| M2 | `1787565297` | `1787565752` | `455s` (`7m35s`) | `1787565709.197` | `412.197s` (`6m52.197s`) |
| M3 | `1787565755` | `1787566098` | `343s` (`5m43s`) | `1787565946.005` | `191.005s` (`3m11.005s`) |

First full green is the retained choreography segment-summary timestamp after its linked suite was already green. Suite receipt finish epochs were M1 `1787564784.671`, M2 `1787565337.941`, and M3 `1787565907.828`.

## Results

The single entrypoint is `npm run acceptance -- --milestone mN`. It replays every installed starter segment through generated application mutations before running the milestone assertions, writes the linked suite receipt, updates `suite-status.json`, and emits the typed suite observation sidecar.

| Milestone | Suite-required | Required choreography | Optional choreography | Status |
|---|---:|---:|---:|---|
| M1 | 7/7 passed | 3/3 passed | none | green |
| M2 | 22/22 passed | 7/7 passed | 2 honest skips: image/video compose controls are absent from the frozen contract | green |
| M3 | 7/7 passed | 2/2 passed | quoted reply 1/1 passed; 4 honest skips for uncontracted sender-avatar, semantic receipt, and group-member controls | green |

Aggregate: 36/36 suite-required assertions and 12/12 required choreography checks passed. The frozen harness emitted `green:true` and `nonGreenCause:null` for every milestone. All three starter logs have retained JSONL replay receipts, and M3's installed-segment rerun left table counts unchanged.

Receipt SHA-256 values:

- M1 suite `4f44686769bd7a92b825984277cfe7d1c8b3b5339033bbcc40659bbf028a9cfd`; choreography `cf2e882e18b3e11d60cb0b65d51a81162651efa6036b65d1630fc69cd5647944`.
- M2 suite `80e63b552e5a76c0d3cc2363fc908acc270cde6501497e2753a2d11bb2c3e633`; choreography `d259024b356095c38b973840c11c7ae38342b4f7c7b53fda5c3bf096e706f89c`.
- M3 suite `250430147fb0b6df4620bb41da2f4ab7dd34543ee40184aba2089ba9d9b56c88`; choreography `05b53f51edef1c93fd1b507eac43742610d748f3e301d9a5129f94d0e72a3737`.

Each milestone also has an exported iOS Hermes `.hbc` bundle under `dist/mN-ios/`. No M4–M8 feature work or scale replay was performed.

## Correction loops and attribution

Run-log `correction-loop` markers: M1 10, M2 3, M3 1. All 14 were attributed `agent-error`; none was relabeled as a Snapback defect. Counting the wider set of retained errors, retries, workarounds, milestone failures, and correction markers gives:

| Milestone | Recovery events | Agent error | Environment | Snapback defect | Ambiguous |
|---|---:|---:|---:|---:|---:|
| M1 | 35 | 23 | 12 | 0 | 0 |
| M2 | 6 | 6 | 0 | 0 | 0 |
| M3 | 2 | 2 | 0 | 0 | 0 |

The expensive M1 loops were fixture-path/schema-shape assumptions, auth policy spelling, replay transport identity reuse, acceptance static-check mistakes, and the Expo AppBinding/fixed-port carrier. M2 required two non-green choreography runs: first to preserve feed navigation from a directly opened profile, then to disambiguate the frozen profile text order and unmount a background composer retained by the router stack. M3 required one suite correction: its static checks pointed at the lane route instead of the frozen QuotedReply boundary and used the wrong prop spelling. The M3 browser choreography passed on its first run.

## Pins and generated shape

- All Snapback application packages are exact `0.1.25`: CLI, client, codegen, Expo, React, acceptance, and `@expo/snapback-runtime-darwin-arm64`.
- Runtime qualification reported the packaged Darwin arm64 runtime, build commit `9d9265394953769aaa52e63c8a914464175f93ab`, release profile.
- Generated authoring profile: `snapback-explicit-v1`, with no `snapback/codegen.policy.json` override. Generated shape: 9 tables, 21 operations, 8 live queries, 13 mutations, and 1 ephemeral binding.
- Installed app stack: Expo `57.0.16`, Expo Router `57.0.16`, React/React DOM `19.2.3`, React Native `0.86.2`, TypeScript `6.0.3`.
- Harness pins: Playwright `1.62.1`, AJV `8.20.0`. Toolchain: Node `26.7.0`, Bun `1.3.14`, npm `11.19.0`.

## Process custody

Recorded server/supervisor PIDs were `94404`, `94715`, `94741`, `96944`, `820`, `823`, `1941`, `1963`, `1979`, `1984`, `3185`, `3199`, `3205`, and `3206`. Export worker PIDs `4760` and `6089` were also recorded. Shutdown used only the owned TTY sessions/PIDs; no pattern kill was used. Final verification found none of those processes alive and no listeners on ports 42000–42019.

One failed combined-supervisor attempt briefly selected internal ports `59926`, `59927`, and `59933` before its listener attestation refused startup and reclaimed the process tree. This violated the requested port envelope during that failed environment experiment and is retained candidly in `run-log.md`; the successful server topology used only 42000 and 42001.

## Source inspection

Three events went beyond the served Guide into published-package shipped files, all retained in `run-log.md`:

1. `@expo/snapback-acceptance@0.1.25` `index.d.mts`/`index.mjs` for supported supervised binding construction.
2. `@expo/snapback-cli@0.1.25` `expo-dev.mjs` for Metro public/process port allocation and child environment after CLI help exposed no Expo port option.
3. `@expo/snapback-expo@0.1.25` `provider.mjs`, `supervised-environment.mjs`, and `app-binding.mjs` for explicit binding/environment admission after the provider reported `SNAPBACK_APP_BINDING_UNAVAILABLE`.

No unpublished Snapback checkout or implementation repository was inspected.

## Candid gaps

- The successful web carrier uses a lane-authored, generated-identity-bound fixed loopback AppBinding/environment for 42000/42001. It is a development-only solution, not a release binding or deployment configuration.
- The schema requests durable-required auth custody. Web persistence is proven by choreography; the optional qualified native custody module is not installed, so the Hermes artifact builds but a native runtime may refuse custody until that carrier is supplied.
- Seeded image/video posts render and suite creation is covered, but the frozen contract has no media-picker compose control, so the app exposes text composition only.
- Backend DM/group/member/receipt operations are implemented, but the frozen M1–M3 UI surfaces do not provide new-DM, new-group, or member-management controls. Choreography retains those limits instead of inferring UI.
- The profile signup collision error is visible, but the compact signup flow derives a handle from email and offers no pre-profile alternate-handle recovery form.
- Codegen retains bounded N+1 advisories in feed/conversation projections. The runtime also warned about inline live-query args identity churn. Both are correct at fixture volume but should be batched/memoized before high traffic.
- Pagination uses a timestamp cursor and deterministic in-page tie-break; a composite cursor would be safer for truly simultaneous writes.
- Queries intentionally cap bounded collections (commonly 1,024 rows). Scale behavior was not replayed because the run explicitly excludes scale replay and M4–M8.

end=1787566098
