# LLP 0307 Track Q-a qualification probe — published 0.1.26 supervised `--expo` ports

Date: 2026-08-24. Probe root: `/private/tmp/claude-501/-Users-ccheever-projects-snapback/2236b7d9-696c-481f-a128-5496fa28e998/scratchpad/qa-probe/`.
Packages: `@expo/snapback-cli@0.1.26` (npm `latest`; dist-tag `fastpath-0-1-26-118babab1647`), template deps all `^0.1.26`, runtime binary build commit `118babab1647bb862e174761e37cc4e1b554b38b` (gitDirty: false). No repo source or workspace packages used; journey driven by published CLI `--help`, the scaffolded template's README/AGENTS.md, and the served guide at the running backend. Headless env per probe definition: `CI=1 EXPO_NO_DEVTOOLS=1`.

## Per-step results

| Step | Result | Wall time |
| --- | --- | --- |
| 0. Fresh install of published CLI | PASS | 24 s |
| 1. Scaffold shipped Expo template (`snapback new probeapp --template expo-chat`) + `bun install` + `bun run generate` | PASS | 51 s |
| 2. Supervised `snapback dev snapback --expo --expo-platform web` with pinned ports | **PASS — ports land exactly where pinned** | 58 s to verified ready |
| 3. Authenticated live query green | **PASS via served-guide headless path; the template's own shipped verification FAILS out of the box** | 386 s total (incl. isolation differential) |
| 4. Authored edit -> regenerate -> Metro freshness without restart | **Measured: Metro serves STALE bundle; supervisor+bootstrap serve successor; closure's own advisory names why** | 161 s |
| 5. Shortened supervised binding-term option | **Not exposed -> obligation recorded (term-crossing dropped per Q-a definition)** | 66 s |
| Cleanup (kill by recorded pid) | PASS with one operational finding (wrapper pid does not forward TERM) | 56 s |

Total ~= 13.4 minutes.

## Step 2 detail — pinned vs observed (the Q-a core)

Command: `snapback dev snapback --expo --expo-platform web --port 48150 --client-port 48160 --bootstrap-port 48170 --ready-file … --application-ready-file … --json`

| Owner | Pinned | portPlan | OS listener observed (lsof) |
| --- | --- | --- | --- |
| backend | 48150 | `{"owner":"backend","port":48150,"source":"pinned","declaredBy":"flag"}` | `snapback … 127.0.0.1:48150 LISTEN` |
| client (Metro front) | 48160 | `{"owner":"client","port":48160,"source":"pinned","declaredBy":"flag"}` | `node … 127.0.0.1:48160 LISTEN` |
| bootstrap | 48170 | `{"owner":"bootstrap","port":48170,"source":"pinned","declaredBy":"flag"}` | `node … 127.0.0.1:48170 LISTEN` |
| metro (no pin flag, per spec §3) | — | `{"owner":"metro","port":4380,"source":"range","declaredBy":null}` | `node … 127.0.0.1:4380 LISTEN` |

- `portPlan.range`: `{"lo":4287,"hi":4387,"source":"default"}`. Metro walked the default range descending past foreign listeners (other sessions held 4387–4381) and landed at 4380 — collision-tolerant scan behaved as specified with a busy fleet range.
- Application-ready receipt admitted exactly `["http://127.0.0.1:48160","http://[::1]:48160","http://localhost:48160"]` — the pinned client port in all three loopback alias origins, per LLP 0299 §9.1.
- All endpoints responded 200 (front `/`, backend `/_snapback/guide/index.md`, bootstrap `/_snapback/expo/v1/bootstrap`).
- The published `snapback dev --help` documents the whole LLP 0299 surface (`--port`, `--client-port`, `--bootstrap-port`, `--port-range`, default range sentence). Discovered from help alone.
- Supervised binding: `source:"supervised-dev"`, issuedAt `2026-08-24T22:21:11Z`, expiresAt `2026-08-24T23:21:11Z` (1 h default term).

**LLP 0299 verdict: the published ports contract holds exactly as specified.** Failures below route elsewhere (supervisor chain / template / expo package), not to 0299.

## Step 3 detail — authenticated live query

- **Shipped done-oracle FAILS out of the box.** `bun run prove` (and raw `npm test`) fail at the check 1-of-13 boundary with, verbatim:
  `SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE: The selected target does not offer the generated guest entry mechanism.`
  (`snapback verify` wraps it as `SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED`, `expectedCheckCount:13, executedCheckCount:1`, next-step `SNAPBACK_VERIFY_FIX_ACCEPTANCE`.)
  Differentials: reproduced identically (a) with and without `CI=1`, (b) in a second fully isolated fresh scaffold (`isoapp`) with no supervised loop running — so it is a published-closure defect, not environment or concurrency. Contradiction recorded at published-surface level: the generated `client-lifecycle.v1.json` DOES declare `"mechanism": "guest-v1"` entry mechanisms, and the live supervised binding offered `auth.guest-sessions` — yet the acceptance's own spawned target reports the mechanism unavailable. (Acceptance package source deliberately not read; routing between `@expo/snapback-acceptance` and the backend bootstrap surface left to the owner.) Check 1 itself (`zero-config-supervised-connect`) passed with correct app identity/hashes before the abort.
- **Green reached on the paved published surface instead**: `snapback session mint --ready-file … --email probe@example.test` (Bearer minted against the RUNNING supervised backend at 48150) -> served guide `clients/headless.md` -> `createExternalSessionClient(baseUrl, { bearerToken })` from `@expo/snapback-client` -> `db.liveQuery(api.conversations …)` 3 rows, `db.mutate(api.sendText …)` committed, `db.liveQuery(api.messagesForConversation …)` sees the write. Authenticated session + live query + authenticated mutation all green against the supervised pinned backend.
- Papercut: `snapback run <fn> --ready-file …` against a sessions-mode target refuses even a public zero-arg live query with
  `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` — "client-provided identity fields are not accepted when session authority is server-resolved" (`details.field: "userId"`); the CLI injects an identity field unconditionally. No paved one-shot CLI read exists for sessions targets.
- My own error, correctly refused: `SNAPBACK_CONNECTION_ID_REQUIRED: Snapback connectionId is required for connection-scoped operations` (guide example does pass `connectionId`; diagnostic was self-explanatory).

## Step 4 detail — Metro freshness after regeneration (T1 signal)

Sequence: append one live query to `snapback/functions.mjs` -> `bun run generate` (operations 12->13) -> supervisor watcher fired without restart:
`startup-successor-activated` -> `generated-and-loaded` -> `binding-rotated` (`previousDescriptorIdentity sha256:d3d3aa99…` -> `sha256:bb948e4b…`), and the bootstrap exchange immediately served the successor binding with a fresh 1 h term (reminted `22:29:38Z`). Disk alias `app.binding.mjs` rotated (embeds successor digest `664b18b7…`, mtime updated).

**The running Metro kept serving the pre-edit bundle**: same byte count (143,868), still embedding stale descriptor `d3d3aa99…` (x3) and stale binding digest `156f4d3e…` (x19), zero occurrences of the successor identities or the new operation name — rechecked 30+ s after rotation. So under this environment the regeneration step DOES require a Metro restart to serve the successor descriptor identity, exactly as T1 predicted.

**Mechanism pinned for this environment — and the closure diagnoses itself.** The supervised readiness stream delivered the promised advisory, twice, verbatim code:
- `SNAPBACK_EXPO_METRO_WATCH_INERT` (`condition: "ci-environment"`): "Metro file watching is inert: CI=1 is set in the environment, and Expo/Metro disable file watching under CI." remediation: "Edits will not rebuild the served bundle. Unset CI (or pass CI=0) in the supervisor environment to re-enable watching."
- `SNAPBACK_EXPO_METRO_WATCH_INERT` (`condition: "watcher-blind-root"`): the project sits under `/private/tmp`, a watcher-blind root.

Both inert conditions applied to this probe (documented headless env `CI=1`, scratchpad under `/private/tmp`); the supervisor passed `CI=1` through to the Metro worker (verified in the worker's environment). Attribution for lane H/T1: in this probe the staleness mechanism is *inert watching*, correctly named by the shipped advisory — the probe does NOT reach the undiagnosed active-watcher staleness T1 describes; that residue still needs a watcher-visible, non-CI reproduction.

**No `SNAPBACK_REACT_BINDING_MISMATCH` observed** — a web client can never get far enough to observe one, because of the blocker below.

**BLOCKER (new, published defect): supervised Expo web bundling fails outright.** The browser-facing bundle URL served by the front's own index HTML returns a Metro `TransformError`, verbatim:
`node_modules/@expo/snapback-expo/shared-browser-adapter.mjs: Invalid call at line 137: import(specifier)` — Metro log: `Web Bundling failed 302ms node_modules/expo/AppEntry.js (465 modules)`.
No `SNAPBACK_*` diagnostic accompanies it. Per probe rules this required reading one published package file to name: `shared-browser-adapter.mjs:137` is `resolveExpoSharedBrowserModules(load = (specifier) => import(specifier))` — a bare dynamic `import(specifier)` default argument, which Metro's transformer categorically refuses. The fact missing from the paved surface: any served diagnostic explaining why the supervised web client cannot build. Consequence: on published 0.1.26 the supervised `--expo --expo-platform web` browser client can never boot from the shipped template, independent of CI/watcher conditions. (The generated-module subgraph `snapback/generated/app.binding.mjs.bundle` does bundle — 143 KB — which is how freshness above stayed measurable.)

## Step 5 detail — binding term

No shortened supervised binding-term option exists on the published surface: `snapback dev --help` and `snapback start --help` carry no term/TTL/expiry flag, no `SNAPBACK_*` environment spelling for it exists in help, and the served guide's only expiry story is `SNAPBACK_APP_BINDING_EXPIRED` with a restart-the-supervisor remediation. Term-crossing therefore dropped per the Q-a definition; **obligation recorded: the supervisor exposes no shortened binding term, so minutes-scale probes cannot witness term-crossing refresh; refresh evidence remains with the existing supervised refresh tests.** Adjacent positive evidence: the binding IS reminted with a fresh full term on every regeneration rotation (observed 22:21:11 -> 22:29:38 remint).

## Cleanup + operational finding

SIGTERM to the recorded launch pid (65338, the published `snapback` bin) killed only an outer wrapper: the real supervisor (`node …/.bin/snapback dev …`, pid 65343) re-parented to init and kept the whole tree (backend 66985, Metro 67136/67302, front/bootstrap sockets) running — the wrapper did not forward TERM to its re-spawned child. SIGTERM to the real supervisor then reclaimed everything cleanly: final event `{"state":"closed","reclaimed":{"backend":true,"metro":true,"bootstrap":true,"portForwards":0}}`; all probe ports (48150/48160/48170/4380) verified released; no probe processes remain. Foreign servers on 4287–4289 and 4381–4387 untouched.

## Every SNAPBACK_* diagnostic encountered (verbatim codes)

- `SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE` — "The selected target does not offer the generated guest entry mechanism." (shipped acceptance, every run)
- `SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED` — "starter acceptance returned a failed receipt" (verify wrapper)
- `SNAPBACK_VERIFY_FIX_ACCEPTANCE` — "Repair the failing registered acceptance profile and rerun snapback verify."
- `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` — "client-provided identity fields are not accepted when session authority is server-resolved" (`field: userId`; `snapback run` vs sessions target)
- `SNAPBACK_CONNECTION_ID_REQUIRED` — "Snapback connectionId is required for connection-scoped operations" (probe author error, correct refusal)
- `SNAPBACK_EXPO_METRO_WATCH_INERT` — twice: `ci-environment` and `watcher-blind-root` conditions, with exact remediations (advisory, delivered as the guide promises)
- `SNAPBACK_CLI_ARGUMENT_INVALID` — "unrecognized subcommand" (probing nonexistent `auth mint`/`auth session`; correct refusal)
- `SNAPBACK_RUNTIME_LAUNCH_OK` — supervisor event confirming qualified runtime binary launch (info)
- Not observed anywhere: `SNAPBACK_REACT_BINDING_MISMATCH`, `SNAPBACK_DEV_PORT_UNAVAILABLE`, `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` (no false positive fired during any start on this contended host).

## Verdict

**except-for** — the LLP 0299 ports contract itself qualifies cleanly (pins exact, provenance recorded, collision-tolerant range, receipts correct: Q-a core PASS), but published 0.1.26 does not keep an agent on the full supervised `--expo` paved loop for this slice: the shipped template's web client cannot bundle at all (`@expo/snapback-expo` shared-browser-adapter dynamic-import transform error, no diagnostic), the template's own done-oracle fails at the guest bootstrap step out of the box, Metro freshness after regeneration requires a restart under the documented headless environment (correctly self-diagnosed by `SNAPBACK_EXPO_METRO_WATCH_INERT`), and no shortened binding term exists to witness term-crossing (recorded obligation).
