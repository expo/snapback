# LLP 0307 Track Q-b qualification probe — published 0.1.27

**Date:** 2026-08-25 · **Probe target:** published npm `@expo/snapback-cli@0.1.27`
(latest; runtime stamp `98681377721e`, `@expo/snapback-runtime-darwin-arm64`)
· **Qualifies:** LLP 0301 (URL-first dev lifecycle) + LLP 0302 (declared-dev
client binding) — the **caller-owned** lifecycle. NOT LLP 0299 (Q-a already
qualified the supervised path against 0.1.26).
**Environment:** macOS darwin-arm64, Node v24.18.0, bun 1.3.12, Expo SDK 57,
fresh dir under `/private/tmp/...scratchpad/qb-probe/` (a guide-documented
watcher-risk root — see finding F6). Backend pinned to uncommon port 14311,
caller-owned Metro pinned to 14322, `CI` unset for the caller-owned Metro per
the served guide's own advisory (react-expo.md line ~495).
**Source discipline:** journey executed from published packages, their served
guide (`/_snapback/guide/*`), `--help`, template README/AGENTS, published
package READMEs and `.d.mts` public type declarations, and the app's own
generated artifacts. No repo source consulted for execution (the two Spec
files were read only for the probe definition). No published-package
*implementation* source was needed to complete the journey.

## Verdict

**YES — published 0.1.27 keeps an agent on the caller-owned paved loop.**
Every step of the journey (scaffold → plain `snapback dev --write-env` →
caller-owned `expo start` → declared-dev in-process mint → authenticated live
query green → transport-episode crossing with automatic re-verification →
authored schema edit → automatic regeneration → successor pickup by both a
fresh headless client and the still-running Metro, hot) completed on published
surface alone, with the LLP 0301/0302 contracts observed exactly on the wire.
No 0301/0302-owned mechanism failed. The findings below are off-spec
papercuts and scope notes, none of which forced the agent off the paved loop.

## Per-step results

### Step 1 — scaffold the shipped template · **PASS** · wall 1s (+7s `bun install`)

`snapback new chatapp --template expo-chat --json`. The shipped template is
already URL-first-shaped: `"dev": "snapback dev snapback --write-env"`,
`"dev:client": "expo start"` (supervised demoted to `dev:supervised`), and
`App.tsx` carries the exact LLP 0302 §5 one-liner
`url={process.env.EXPO_PUBLIC_SNAPBACK_URL}`. README teaches the
two-terminal flow first. 485 packages, all `@expo/snapback-*` at 0.1.27.

### Step 2 — `snapback dev` (plain) + caller-owned Metro · **PASS** · backend ready 22s, Metro up 9s, first web bundle 4s

`snapback dev snapback --port 14311 --write-env --json` (no `--expo`):

- Pinned port honored exactly (`portPlan.owners: [{owner: backend, port: 14311, source: pinned, declaredBy: flag}]`).
- `--json` emits `snapbackUrl` + `androidEmulatorUrl` (LLP 0301 §4).
- Posture per LLP 0301 §2/§3: `admissionPosture: "loopback-any"`,
  `clientOrigins: []`; the `snapback.application-ready.v1` receipt carries the
  same two fields (writer row "plain, no declarations" exact).
- `.env.local`: exactly one `# >>> snapback dev >>> … <<<` marker block,
  `EXPO_PUBLIC_SNAPBACK_URL` / `VITE_SNAPBACK_URL` / `SNAPBACK_URL` all
  byte-equal to the printed URL, Android `10.0.2.2` line written **commented**,
  and the warn-on-unignored advisory fired (correct here — no gitignore).
- Identity fact (LLP 0301 §1): `GET /_snapback/api/app/identity` → 200, exact
  v1 three-field shape (`formatVersion` `snapback.app-identity.v1`,
  `deployment` DeploymentIdentity, `admissionPosture`), `Cache-Control:
  no-store`, **no** ETag/Last-Modified.
- Caller-owned Metro: `env -u CI expo start --port 14322` (CI-unset per the
  served guide's explicit teaching for self-started bundlers). Metro loaded
  `.env.local` and exported the vars itself; web bundle built clean —
  **the 0.1.26 Q-a expo-web import-specifier blocker is gone at 0.1.27** on
  the caller-owned path (5.9MB dev bundle, 200, no unresolved modules,
  `EXPO_PUBLIC_SNAPBACK_URL` value inlined, declared-dev machinery present).

### Step 3 — declared-dev in-process mint + authenticated live query · **PASS** · construct→green 547ms

Headless caller-owned client (`createSnapbackAppClient({ app, url, platform })`
— the spelling documented in the published `@expo/snapback-client` README):

- **Mint shape (LLP 0302 §1):** generated dev variant installs the capability
  via the library seam (`unsafeInstallDeclaredDevCapabilityForGeneratedCode`);
  the runtime object has keys exactly `[format, deploymentIdentity]` with
  `format: "snapback.declared-dev-capability.v1"` — **no `expiresAt` exists
  anywhere on the capability**, and the public type
  (`internal/declared-dev-mint.d.mts`) has no expiry field to set. Clock
  expiry is structurally removed, exactly per LLP 0302 §2.
- **Gate order (LLP 0302 §3):** wrapped `fetch`/`WebSocket` wire log shows the
  very first backend request of the episode is the credential-free identity
  GET; signup and every other call strictly after it.
- Password signup → authenticated principal (userId/sessionId/sessionClass).
- Live query `messagesForConversation` with `transport: 'stream'` →
  `connection: 'live'`, authenticated `sendText` mutation `settled`, delivery
  observed through the standing stream, `authoritativeAnswerClass:
  'authoritative'`, `freshness: 'current'`, `deliveryLagMs: 3`.

### Step 4 — LLP 0302 §3 standing gate across a transport episode · **PASS** · drop→re-verified 4.8s, full step 8.6s

Killed the backend server process I owned (pid read from my ready
descriptor), re-ran `snapback dev` (same port; it spawned a replacement and
re-maintained `.env.local` byte-stable). Client behavior, zero manual binding
work and zero client code touched:

- Stream drop observed: `live → polling → stale`, with honest typed
  `SNAPBACK_APP_BINDING_UNAVAILABLE` ("identity endpoint could not be
  reached") while the port was dead — and during the whole outage + recovery
  the **only** HTTP requests on the wire were identity GETs (post-drop wire
  log: ws-close, then 12+ consecutive `/_snapback/api/app/identity` GETs, not
  one non-identity call before the first match). Fail-closed exactly as
  specified.
- Replacement up → automatic re-verification → `live` again; the session
  survived process replacement (store-backed) — post-episode authenticated
  mutation `settled` and delivered live with **no re-sign-in and no
  re-binding**.
- **Binding-term note:** declared-dev has no term to cross (expiry removed by
  0302); the episode crossing is the term-crossing analogue and it passed.
  This resolves the Q-a term-crossing obligation for the caller-owned path:
  there is no clock term; the standing gate is the re-verification and it ran.

### Step 5 — authored schema edit → regenerate → successor pickup · **PASS** · edit→backend successor ~2s; headless pickup <1s; Metro hot, 1s

Added `tagline: v.optional(v.string())` to the `users` table.

- The dev loop's own watcher fired within ~2s **even under `/private/tmp`**:
  generated dir atomically replaced (new digest binding module
  `app.binding.7c0968f4….mjs`, old digest module gone), identity route serving
  the successor `schemaHash` (`…a89b3cd7bed0`). No manual `generate` needed.
- **Stale-client arm:** a client constructed from a pre-edit copy of the
  generated dir refused fail-closed with
  `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` **naming both identities verbatim**
  (generated + backend serialized DeploymentIdentity) — LLP 0302 §3 exact.
- **Headless successor pickup:** fresh process importing the regenerated
  `app.mjs` → ready → signup → live green in <1s. *What's needed: a new
  process/import — inherent to headless (module bytes are the binding).*
- **Caller-owned Metro pickup: HOT — no restart needed.** The Metro started
  *before* the edit served the successor on the next full-bundle request:
  new digest module (41 refs), new schemaHash, `tagline` present, **zero**
  stale-generation bytes. This is the caller-owned counterpart of lane T1's
  diagnosis: with `CI` unset (the guide's advice for self-started bundlers),
  Metro's watcher works and generated-module freshness holds. Scope: proved
  for full-bundle re-requests (a browser still reloads the page to fetch a
  new bundle, ordinary web semantics); live HMR push to an open browser tab
  was not probed. The only restart-class caveat that remains is the
  documented one: if the *URL itself* changes, `.env.local` is rewritten and
  the bundler must restart (env values inline at bundler start) — not hit
  here since the port was pinned stable.

## Verbatim SNAPBACK_* diagnostics observed

| Code | Where | Disposition |
| --- | --- | --- |
| `SNAPBACK_RUNTIME_LAUNCH_OK` | dev readiness `runtimeRecovery` | ordinary green |
| `SNAPBACK_APP_BINDING_UNAVAILABLE` | client, during backend outage: "The development application identity endpoint could not be reached." | correct fail-closed episode behavior (LLP 0302 §3) |
| `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` | stale-generation client: "Generated application identity {…} does not match backend identity {…}" — both identities named | correct refusal (LLP 0302 §3) |
| `SNAPBACK_ADMIN_SECRET_READ_REQUIRED` | `snapback restart --ready-file …` (native host.restart), exit 5: "a valid secret-read lease is required" | finding F2 — off-0301/0302 surface |

Not observed (correctly): no `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER`, no
`SNAPBACK_DEV_ENV_WRITER_CONFLICT`, no `SNAPBACK_APP_IDENTITY_FACT_INVALID`,
no `SNAPBACK_EXPO_METRO_WATCH_INERT` (caller-owned Metro stayed fresh), no
`SNAPBACK_DEV_ADMISSION_POSTURE_INVALID`.

## Findings (all except-for grade; none broke the paved loop)

Failure routing per the Q-b charter: nothing here routes to LLP 0299 —
no supervised mechanism ran. Nothing below is a defect in an LLP 0301/0302
normative mechanism; F1–F5 route to the owners named.

1. **F1 — liveQuery transport default is manual polling.** A caller-owned
   headless client reaching for "live query green" gets a polling handle by
   default; providing `onUpdate` does not select push, and with
   `fallbackToPoll: false` it still silently sits at `polling`. The served
   headless guide documents `transport: 'stream'` plainly ("Transport
   default" section) — this probe lost ~3 min to it. Route: headless-guide
   ergonomics / client-owner, not 0301/0302. (React/Expo providers are
   unaffected — the provider owns transport.)
2. **F2 — no credential-free caller-owned backend-restart verb.** Native
   `snapback restart` refuses without a secret-read lease
   (`SNAPBACK_ADMIN_SECRET_READ_REQUIRED`, exit 5). The working caller-owned
   gestures are: kill your own server pid (from the ready descriptor) and
   re-run `snapback dev` (what this probe did — clean), or the dev loop's
   stdin control channel (`snapback.dev-command.v1` verbs incl. `restart`;
   unusable when the loop was started with stdin closed). Route: host-ops /
   CLI owner; a dev-loop-scope restart one-liner would close it.
3. **F3 — SIGTERM to the `snapback dev` loop leaves the managed server
   running** (daemon/attach model: the next `snapback dev` attached
   instantly, and `state: generated-and-loaded, managed: true` suggests this
   is deliberate). An agent expecting terminal-1 Ctrl-C to free the port will
   be surprised; the served guide's caller-owned section does not state the
   daemon lifetime. Route: LLP 0301 documentary owner (one sentence in the
   URL-first guide section), or CLI owner if it is in fact a leak.
4. **F4 — `snapback guide` fallback hint prints `http://127.0.0.1:4287/...`**
   while this project's server runs at 14311 (a foreign 4287 server from
   another session may exist on this box; either way the hint is not bound to
   the invoking project's own port). Cosmetic; route: CLI guide verb owner.
5. **F5 — row identity spelling:** seeded/served rows expose `_id`
   (`_version`, `_createdAt`…); an untyped probe that guesses `id` gets
   `undefined`. Generated `api.d.ts` types make this a non-issue for TS
   consumers; note for raw-JS agents. Route: none needed (or headless-guide
   example nit).
6. **F6 — good news, scoped:** the `/private/tmp` watcher-blind advisory did
   **not** bite: both the dev loop's regeneration watcher (~2s) and
   caller-owned Metro (CI unset, fsevents) stayed fresh under
   `/private/tmp`. The advisory remains right to exist (CI=1 or
   watchman-blind roots), but it is conservative on this host. Corroborates
   lane T1's CI-passthrough diagnosis from the caller-owned side.
7. **F7 — scope note:** LLP 0302 §3 stream-less per-operation mode was not
   independently exercised (the standing-stream shape was); the packed
   battery `declared-dev-episode.test.mjs` owns that per §8a. Browser-tab HMR
   propagation of the successor was likewise out of scope (headless web).

## Wall-clock summary

| Step | Wall |
| --- | --- |
| 1 scaffold + install | 1s + 7s |
| 2 backend ready (generate+launch+env write) | 22s |
| 2 caller-owned Metro up / first web bundle | 9s / 4s |
| 3 client construct → bootstrap ready → authenticated | 225ms |
| 3 authenticated live query green (incl. mutation round-trip) | 547ms |
| 4 episode: kill → replacement up → auto re-verified → post-episode green | 8.6s end-to-end |
| 5 edit → backend serves successor | ~2s |
| 5 headless successor pickup (new process) | <1s |
| 5 Metro successor bundle (no restart) | 1s |
| Whole journey incl. probe-harness debugging | ~35 min (journey-only replay ≈ 2 min) |

## Artifacts

- `qb-probe/chatapp/` — the scaffolded app (schema edit in place, both
  generated generations: live dir + `generated-pre-edit/` stale copy)
- `qb-probe/chatapp/qb-step34.mjs`, `qb-step5.mjs` — probe scripts
- `qb-probe/step34-result.json`, `step5-result.json` — machine records
  (wire logs, connection logs, phase timings)
- `qb-probe/dev-backend.log` — first dev-loop readiness JSON
- `qb-probe/web-bundle.js`, `web-bundle-2.js` — pre/post-edit Metro bundles
- All probe-owned processes killed (Metro 4804/4927, dev loops 85329/95870,
  servers 88930/96532); ports 14311/14322 verified free.
