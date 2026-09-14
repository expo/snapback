# Astra grade client attribution audit

Observed 2026-09-14. This is a bounded static attribution audit of the received Astra grading artifacts for `d-01` and `d-04`. It did not rerun either probe, inspect private model output, modify the benchmark lane, or independently grade the application.

## Baseline and custody

The graded checkout pins `snapback4: 0.2.6` in `lanes/astra-snapback4/grading/checkout/package.json:35` and `package-lock.json:7293-7302`; the installed `node_modules/snapback4/package.json` also reports `0.2.6`. Product source was inspected with `git show` at qualified revision `342c53d306d7484cd64e820ee27a151e02eb4b0b`, rather than from the later delivery worktree contents.

| Input | SHA-256 |
|---|---|
| `lanes/astra-snapback4/grading/grader-report.json` | `410c4cd24f4e13539692c96f4f1776fc0241d6214a163623c2591ff37a636e9f` |
| `lanes/astra-snapback4/grading/trace.md` | `ad54165759fc870ab0f00f4ae5a4f8b1eb084d17bab1ffc86beac38fd44f7156` |
| `lanes/astra-snapback4/grading/evidence/follower-count-live.json` | `4819a146b318a5f9fa5788773a813159d3609726724c87b7a51197587c98e639` |
| `lanes/astra-snapback4/grading/evidence/follower-count-diagnostic.json` | `5fdc10cf1f58fd39ce3fab41685c7fbca739132f872cb6f9c4b11fe108d887c4` |
| `lanes/astra-snapback4/grading/evidence/offline-latency.json` | `1951ae8b14375f1188644abd5a65a82223f056aad0dd270cd0d9243ba9c0ab1b` |
| `lanes/astra-snapback4/grading/grader-scripts/follower-count-live.mjs` | `70f327f7184658df0a72bacea1f28b99665e58f6022257f0649d33a9d92de815` |
| `lanes/astra-snapback4/grading/grader-scripts/follower-count-diagnostic.mjs` | `9dce1cc31bad9fb202064929283bc5a4af65a8db80d522c4302326ecf17c27c6` |
| `lanes/astra-snapback4/grading/grader-scripts/offline-latency.mjs` | `9840ed044512aaea19a6522e88f77ccc10a28b46bd48182d8e0a3b5885e45441` |
| graded `snapback/schema.q` | `980071277ef45ca9041a47afbe30b9868d775e4c972d343990972aff2c4ae139` |
| graded `app/profile/[handle].tsx` | `7345c93d55cd3c947dbe96a97ce82b5d205f6fb6159aca200202d305c5d70be1` |
| graded `app/search.tsx` | `d18138acc01892cf2c028bd297691dedfe33dbdc11f2dd5a4429a3f1a868aed6` |
| graded `lib/state.tsx` | `a669ef376b179ed040dd34bf553b3cb4d68522d9136096780f73ba15fc45122d` |
| installed `node_modules/snapback4/dist/local.js` | `65266a0dca7396874c3b586fe475eed56db84e602fba556a8faabf9a56e3cec4` |

The exact 0.2.6 source hashes obtained through `git show 342c53d3...:<path>` are: `snapback4/packages/snapback4/src/local.ts` `d4687c9d345687a22b34cb5f7ecebb56149a4219aa892a5c80b6d282664365f9`, `snapback4/crates/snapback4/src/serve.rs` `22ac491fb81c7a38783d7b474902fe060402a3d7185c31e9a85c0606e7c9f831`, `snapback4/crates/snapback4-lang/src/bind/catalog.rs` `bff37283934e6e1e20fa3721b2ada87ed3246558d9bfab892a12cae59895a0b9`, and `snapback4/packages/snapback4/src/react.tsx` `cd8c889c98e112f1f3c68a30e6fa68b5464772b9f576414098e08252ec1f7e49`.

## d-01: follower count stale on Alice

**Disposition: published Snapback4 0.2.6 local-client defect, high confidence; the grader's observed behavior is supported, but its stated root cause stops one step early. It is already fixed after 0.2.6.**

The retained evidence is strong. `follower-count-live.mjs:29-45` ran three 10-second attempts while Alice remained on her own profile; all three retained attempts have `ms: null` and keep the count at 4. The diagnostic separates the mutation from the observation: at 0.5 seconds the server and Bob change 4→3 or 3→4, Alice remains stale through 15 seconds, and Alice shows the new value after reload (`follower-count-diagnostic.json`). The profile screen directly passes `useQuery(api.followState, ...)` data into `ProfileForm` (`app/profile/[handle].tsx:18-30`), so there is no component-local copy that could explain the stale value.

The app's partition declaration explains why Alice receives no local aggregate event, but that alone should not make an online query non-live. `snapback/schema.q:41-56` syncs each `follows` row only to `.followerId`; `followerCounts` groups by `followedId`. In 0.2.6, a maintain inherits its source audience only when its grouping contains that audience column (`snapback4/crates/snapback4-lang/src/bind/catalog.rs@342c53d3:197-205`), so `followerCounts` is intentionally not held by Alice's device. The local client consequently detects an unsynced dependency and sends `followState` to the server (`snapback4/packages/snapback4/src/local.ts@342c53d3:604-620`). This makes the compact count an online/server-run value; it does not require the app to replicate all `follows` rows publicly.

The 0.2.6 invalidation gap is concrete. `/changes` returns global changed-table names (`snapback4/crates/snapback4/src/serve.rs@342c53d3:869-905`). The local client parses those names but discards them (`local.ts@342c53d3:522-541`), then reruns watches only for tables touched by rows actually applied to the device (`local.ts@342c53d3:474-505`). Alice receives no follower row, so the server-run `followState` watch never reruns until route reload creates a new watch.

Post-release commit `0478626940fe9c7c71b92fbdf7523732cc141139` fixes this class: it classifies server-run operations explicitly and reruns matching watches from `/changes.tables` (`local.ts@04786269:524-546,576-580`). Its focused regression, `snapback4/packages/snapback4/test/residency.test.mjs@04786269:97-120`, changes only an online-only table and requires the observed server answer to update. The fixed source and regression hashes are `0fbb4947cd2aa69223875ef2b29881577f71195cf7c90f4e362ecd2c36aee14e` and `3d9de97e3d085681185168f90c5c502d84570865ed84536d406c7da20f1bdb69`. That commit is an ancestor of later delivery revision `2890a42d4bedfbd7baec85a35b25fe54f1b5aa14` inspected during this audit.

No new repository issue is warranted for d-01 because the exact invalidation class has a landed fix and regression. A public-sync projection could be an app-side workaround on 0.2.6, but the observed failure is not evidence that the app modeled `follows` incorrectly for its stated online live-count behavior.

## d-04: delayed offline indicator

**Disposition: published Snapback4 0.2.6 local-client responsiveness defect/limitation, medium-high confidence; the app is displaying the SDK state directly. It is not fixed in the later revisions inspected.**

The evidence distinguishes data availability from the link signal. `offline-latency.mjs:29-43` waits three seconds on the idle search route, cuts Playwright context connectivity, types a query, and separately measures the first local result and `sm-search-offline`. The retained results appear in 1 ms in all three samples while the indicator appears after 22,071 ms, 18,512 ms, and 1,743 ms. `app/search.tsx:21-33,60-64` renders that indicator directly from `useLink()` and runs search through `usePage`; there is no app timer or debounce around the link state. `lib/state.tsx:27-33` constructs the local client without overriding `waitSeconds`.

The timing matches the SDK's detection design. In 0.2.6 the local client keeps authenticated `GET /changes` open for `options.waitSeconds ?? 25` and changes the link to `offline` only when that request throws (`snapback4/packages/snapback4/src/local.ts@342c53d3:522-547`). The host accepts at most 25 seconds and waits until the deadline when no commit arrives (`snapback4/crates/snapback4/src/serve.rs@342c53d3:869-888`). Depending on where connectivity is cut inside the current poll, the app can therefore remain `online` until the in-flight poll completes or fails. The two ~20-second samples and one ~1.7-second sample are consistent with different residual times in that 25-second window.

The measurements do not retain a network trace or the start time of the particular in-flight `/changes` request, so they do not prove which browser/network layer delayed each rejection. They do rule out slow local search and an app-owned display delay. The public 0.2.6 documentation exposes `Link` and `useLink` but states no maximum offline-detection latency (`snapback4/packages/snapback4/README.md@342c53d3:704-716,741-758`). Calling this a responsiveness defect/limitation is therefore stronger than claiming a violated documented numeric SLA.

The already resolved `issues/20260913-snapback4-offline-probe-route-contract.md` covers recovery from `offline` through authenticated `GET /probe`; it does not bound the initial `online`→`offline` transition. The later residency fix `047862694...` and client-seams commit `7b2b8fc650ee5fd65906240ce7208fdc0646f610` leave the 25-second default and catch-only transition intact, as does inspected later delivery revision `2890a42d4...`. A new narrow P2 follow-up is warranted for bounded link-loss detection (for example, an abortable shorter detection channel or host-platform connectivity signal reconciled with the authenticated probe). The benchmark evidence supports the symptom and likely mechanism; a product regression should establish the exact desired bound before implementation.

## Limits

This note attributes two received observations using retained public grading artifacts and static code. It does not independently reproduce either defect, establish a general latency distribution, or change Astra's received grading result. The d-01 later-fix assessment rests on the landed source and its existing focused test, which were inspected but not rerun here. The d-04 root mechanism remains an inference from exact code and measured timing because no per-request network chronology was retained.
