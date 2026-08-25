# final-report — grok-clique-convex

lane id grok-clique-convex
model grok-4.6
effort=xhigh
backend=convex-1.45.0
host=Linux x86_64 (web authoring; iOS Simulator / Xcode / Hermes export = environment-null)

## Raw clocks

| mark | ISO-8601 UTC | epoch |
| --- | --- | ---: |
| lane start | 2026-08-25T11:07:37Z | 1787656057 |
| first-product-edit | 2026-08-25T11:15:12.000Z | 1787656512 |
| M1 start | 2026-08-25T11:15:12Z | 1787656512 |
| M1 suite pass | 2026-08-25T11:57:48.302Z | 1787659068 |
| M1 first-green (suite + choreo) | 2026-08-25T12:00:28.762Z | 1787659228 |
| M2 start | 2026-08-25T12:01:06Z | 1787659266 |
| M2 suite pass | 2026-08-25T12:01:26.090Z | 1787659286 |
| M2 first-green | 2026-08-25T12:09:56.434Z | 1787659796 |
| M3 start | 2026-08-25T12:10:10Z | 1787659810 |
| M3 suite pass | 2026-08-25T12:10:09.468Z | 1787659809 |
| M3 choreography terminal (not green) | 2026-08-25T12:23:05.367Z | 1787660585 |
| lane end | 2026-08-25T12:30:57Z | 1787661057 |

Orientation wall (start → first-product-edit): **455 s**.
Lane wall to M3 terminal (start → 12:23:05Z): **4528 s**.

## Wall by milestone

Authoring wall is milestone-start → first-green, except M3 which never greened.

| milestone | start epoch | terminal epoch | wall_s | wall_hms | outcome |
| --- | ---: | ---: | ---: | --- | --- |
| M1 | 1787656512 | 1787659228 | 2716 | 0:45:16 | green |
| M2 | 1787659266 | 1787659796 | 530 | 0:08:50 | green |
| M3 | 1787659810 | 1787660585 | 775 | 0:12:55 | **instrument-failure** (suite pass; required choreography fail) |

M4–M8 not built (out of scope). Scale replay not run.

## First-green times

- **M1 first-green:** 2026-08-25T12:00:28.762Z (epoch 1787659228). Receipt `receipts/m1/choreography.jsonl` runId `284143bb-5f89-4535-94b3-0219d88bfafb`, `green: true`.
- **M2 first-green:** 2026-08-25T12:09:56.434Z (epoch 1787659796). Receipt `receipts/m2/choreography.jsonl` runId `f6521a24-097c-4ab2-9511-23c9931bef42`, `green: true`. One prior M2 choreography attempt failed because `FeedTabs` vanished after `/profile/{handle}`; after moving tabs into authenticated chrome the retained receipt is green.
- **M3 first-green:** none. Suite is green; required typing choreography cannot pass on this host (see instrument failure).

## Suite / choreography results

Entrypoint: `npm run acceptance -- --milestone mN`.
Coverage: `coverage-manifest.json` format `clique-coverage-manifest.v1`, instrument `social-messenger@0.3.3-m8`. All suite-required IDs mapped.

| ms | suite | suite receipt | choreography required | choreo receipt | green |
| --- | --- | --- | --- | --- | --- |
| M1 | pass 7/7 (`m1-a01,a02,a03,a04,a08,a10,a11`) | `receipts/m1/suite.json` sha256 `0c69a04aa63639cf66ec63e848f2bebf38892fb61e706d5180a9fca57810c54f` | 3/3 required passed (profile-edit-live-visibility fastest visibleMs 86.5; session persist; logout-on-relaunch) | `receipts/m1/choreography.jsonl` | yes |
| M2 | pass 22/22 | `receipts/m2/suite.json` sha256 `5ad204cff28d56491fc134a3222ae27dc6c214c2d1b7a8c60fce05eee4983465` | 7/7 required passed; 2 optional skipped (image/video compose: no media-picker test ID). follow-unfollow attempt 1 timed out at 20s; attempts 2–3 passed (best-of-3). | `receipts/m2/choreography.jsonl` | yes |
| M3 | pass 7/7 (`m3-a03,a04,a05,a10,a11,a14,a15`) | `receipts/m3/suite.json` sha256 `80a8c5e7bfc36847a38fa655fe938e5a0c6f8bfee1d8d1e04a571da60f6e3c9c` | required `dm-live-messages` passed (fastest visibleMs 210.6); required `typing-indicator-within-2s-expires-within-5s` **failed** all 3 attempts (visible≈3188–3222ms, expires≈1311–1314ms). Optional quote passed. 4 optional skipped (no contracted receipt/group-member tokens). `green: false`, `nonGreenCause: choreography-failed`. | `receipts/m3/choreography.jsonl` runId `56817fe3-7abc-4b04-a018-721f38d0ff7c` | **no** |

`suite-status.json`: m1/m2/m3 `pass: true` (suite only). Choreography is the M3 blocker.

### Instrument failure (M3 required typing)

Frozen choreography 0.3.3-m8 measures `visibleMs` from the **start** of Playwright `pressSequentially(\`typing-${uuid}-${attempt}\`, { delay: 25 })`. On this host Playwright 1.62.1 took **≈3199 ms** to type that 45-character string, which already exceeds the **2000 ms** appearance ceiling. Expiry (~1.3 s after input stops) is inside the 5 s budget. Product work (native `<textarea data-testid="sm-convo-input">`, idle `setTyping(false)`, scheduler backup) cannot start the indicator before the first keystroke, and cannot make sequential typing cheaper than the clock. **Green is structurally impossible on this harness+host pairing.** Recorded as instrument measurement failure, not a product skip and not M3 green.

iOS Simulator / Xcode / Hermes: **environment-null** on Linux x86_64, not a failed product proof.

## Correction loops and attribution

Counted as distinct authoring loops that changed code, config, or process after a failing diagnostic.

**M1 (12 loops; first-green 45m16s)**

| # | failure | attribution |
| ---: | --- | --- |
| 1 | Convex local backend EXDEV (`/tmp` vs project FS) | environment / Convex CLI |
| 2 | bcryptjs `externalPackages` also EXDEV | package source; bundled instead |
| 3 | dashboard bound 6790, outside 48200–48219 | Convex CLI (`cli.bundle.cjs` `DEFAULT_LOCAL_DASHBOARD_PORT`); patched to 48203 |
| 4 | Expo `CI=1` froze Metro reload | Expo CLI |
| 5 | missing `babel-preset-expo` | scaffold |
| 6 | instrument choreography `npm i` EACCES (read-only snapshot) | instrument; copied to `harness/choreography` |
| 7 | ESM main-guard vs symlink `import.meta.url` | package source; ran via `realpath` + adapter `fixtures.directory` |
| 8 | handle field only on sign-up mode | product (kit usage) |
| 9 | auth mode toggle races | product |
| 10 | logout left React session state | product |
| 11 | duplicate email treated as login when password matched | product vs fixture (register only idempotent if `args.userId === existing`) |
| 12 | `throw new Error` redacted to “Server Error” | Convex (needed `ConvexError`) |

**M2 (3 loops; first-green 8m50s)**

| # | failure | attribution |
| ---: | --- | --- |
| 1 | `sm-feed-tab-*` gone after profile navigation | product vs frozen choreography (tabs must live in chrome, not only home ScrollView) |
| 2 | `sm-profile` innerText first line was kit “Edit profile” | kit vs choreography first-line author-name check; wrapped displayName/bio first, kit `testID=sm-profile-kit` |
| 3 | follow-unfollow attempt 1 20s timeout, then pass | live-query / Playwright flake; best-of-3 still green |

**M3 (3 loops; no green)**

| # | failure | attribution |
| ---: | --- | --- |
| 1 | typing rows do not expire because live queries ignore wall time | Convex capability (no TTL/presence primitive); scheduler + client idle clear |
| 2 | RN-web controlled `TextInput` batched `pressSequentially` into one late `onChange` | react-native-web + Playwright; native textarea + `onInput` ping |
| 3 | appearance still >2s after (2) | **instrument**: clock includes full sequential type of 45 chars; see above |

## Resolved package pins

From `package-lock.json` (lockfileVersion 3):

| package | resolved |
| --- | --- |
| convex | **1.45.0** (exact pin) |
| expo | 57.0.16 |
| expo-router | 57.0.16 |
| expo-constants | 57.0.14 |
| @expo/metro-runtime | 57.0.13 |
| babel-preset-expo | 57.0.8 |
| react / react-dom | 19.2.3 |
| react-native | 0.86.2 |
| react-native-web | 0.21.2 |
| bcryptjs | 2.4.3 (cost 10, `"use node"` action) |
| playwright / playwright-core | 1.62.1 |
| ajv | 8.20.0 |
| typescript | 7.0.2 |

Other pins: Convex `node.nodeVersion=24`; UI kit `vendor/social-ui` 0.3.1-m8; choreography 0.3.3-m8; schema 0.3.0-m8. Ports used: Expo 48200, Convex API 48201, site 48202, dashboard 48203. `CHOREO_BASE_URL=http://127.0.0.1:48200`. `CONVEX_AGENT_MODE=anonymous`.

## Token totals

Not surfaced. Grok lanes have no harness-native per-turn usage adapter in this instrument (metering README: Kimi/Grok → `unavailable`). `lane-report.json` `firstProductEdit.orientationTokens` are all `null`. No estimator substituted.

`firstProductEdit` joined from `first-product-edit.json`: `at=2026-08-25T11:15:12.000Z`, `orientationBytes=4639`, `selectedSkills=[]`. Orientation uniqueBytes in `lane-report.json` is 4639.

## Servers (recorded PIDs; killed only these)

Convex tree (pgid 854924): 854924 bash, 854928 npx, 854930 sh, 854934 npm, 854946 sh, 854947 `convex` CLI (dashboard 48203), 854962 `convex-local-backend` (48201/48202), 855017 esbuild, 855050 node executor.
Expo tree (pgid 859439): 859439 bash, 859443 npx, 859445 sh, 859449 npm, 859464 sh, 859465 `expo start --web` (48200).
Dead leftover: 855945 (earlier Expo, already gone).
Never pattern-killed. Did not touch driver `events/grok.pid` 849275 or `events/load-sampler.pid` 849274.

## Candid gap list

1. Frozen M3 typing assertion measures from the start of a long `pressSequentially`; green is host-impossible here.
2. Convex has no unique indexes; handle/DM pair-key/idempotent IDs are occupancy-checked in mutations.
3. Convex has no ephemeral TTL/presence; typing expiry is a scheduled mutation plus client idle.
4. User-visible action errors require `ConvexError`; plain `Error` is redacted.
5. Anonymous local dashboard port is not a public flag; required a dist patch to stay in 48200–48219.
6. Mixed `/tmp` vs project filesystem EXDEV on this host; `CONVEX_TMPDIR` had to sit in-tree.
7. Instrument choreography tree is not writable (`npm i` EACCES); needed a lane copy.
8. Kit `sm-profile` leading “Edit profile” and feed tabs only on the home screen disagree with choreography’s navigation.
9. No contracted test IDs for compose media picker, receipt state tokens, or group-member controls — optional choreography correctly skipped, not faked.
10. Password auth is a Node action + bcrypt, not Convex Auth; fine for the brief, extra glue vs Clerk/Firebase Auth.
11. Native iOS/Hermes out of scope on this host (environment-null).
12. No Grok token channel, so efficiency scorecard evidence is null by construction.

M1 and M2 are green on suite and required choreography. M3 suite is green; M3 milestone is **not** green because of the instrument typing clock.

Lane wall start→end: **5000 s** (1h 23m 20s). Close-out after M3 terminal: **472 s**.

end=1787661057
