# final-report.md — lane `opus-clique-explicit`

Clique (`social-messenger` brief, milestones **M1–M3**) built as an Expo Router
web app on **Snapback 0.1.25**, authored in the **default explicit profile**
(`snapback/` with explicit `schema.mjs` / `functions.mjs` and generated exact
function references; `authoringProfile` is not set in codegen policy).

- lane id: `opus-clique-explicit`
- model: `claude-opus-5`, effort `xhigh`
- backend: `snapback-explicit-0.1.25`
- start: `1787563038`

---

## 1. Clocks

The external lane controller owns the authoring clock; the gate files are the
authority. Raw epochs:

| Boundary | Epoch | Source |
| --- | --- | --- |
| lane start (recorded in `run-log.md`) | 1787563038 | `run-log.md` line 6 |
| M1 window opened (`gates/M1`) | 1787563033 | gate mtime |
| M1 terminal signal (green) | 1787566218 | `events/cell-milestones.jsonl` |
| M2 window opened (`gates/M2`) | 1787566218 | gate mtime |
| M2 terminal signal (green) | 1787570860 | `events/cell-milestones.jsonl` |
| M3 window opened (`gates/M3`) | 1787570860 | gate mtime |
| M3 terminal signal (green) | 1787574126 | `events/cell-milestones.jsonl` |

### Wall by milestone (controller windows)

| Milestone | Window | Wall |
| --- | --- | --- |
| M1 | 1787563033 → 1787566218 | **3,185 s** (53 m 05 s) |
| M2 | 1787566218 → 1787570860 | **4,642 s** (77 m 22 s) |
| M3 | 1787570860 → 1787574126 | **3,266 s** (54 m 26 s) |

M1's window includes all shared setup that later milestones reused: reading the
instrument (brief, CONTRACT, assertions manifest, choreography source, UI kit,
fixtures), scaffolding, the guide reads, the whole backend schema and function
surface for all three milestones, the Expo Router shell, the replay adapter, and
the acceptance runner. M2 and M3 wall is close to pure feature + suite work.

### First green

"First green" = the first moment that milestone's suite receipt was `pass:true`
**and** its choreography segment recorded `green:true` with the real
suite-status linkage.

| Milestone | Suite finished | Choreography segment recorded | First green | Elapsed in window |
| --- | --- | --- | --- | --- |
| M1 | 1787566115 | 1787566147 | **1787566147** | 3,114 s |
| M2 | 1787570588 | 1787570765 | **1787570765** | 4,547 s |
| M3 | 1787573669 | 1787573734 | **1787573734** | 2,874 s |

Each milestone reached green on the first *official* attempt of its final build;
the dry runs that preceded them are recorded as correction loops below.

---

## 2. Suite and choreography results

### Acceptance suite (`npm run acceptance -- --milestone mN`)

| Milestone | Suite-required assertions | Passed | Coverage map | Receipt |
| --- | --- | --- | --- | --- |
| M1 | 7 | **7/7** | 7/7 | `receipts/m1-suite.json` |
| M2 | 22 | **22/22** | 22/22 | `receipts/m2-suite.json` |
| M3 | 7 | **7/7** | 7/7 | `receipts/m3-suite.json` |

Every suite-required assertion in the instrument's
`schema/social-messenger/assertions.json` for M1–M3 is covered by exactly one
named test; the runner recomputes the required set from the manifest on every
run and fails if any assertion is unmapped. Typed D0.6 observations for each run
are in `receipts/mN-suite.observations.jsonl` (block claims for
`browserAssertionWait` owner `suite` and `restartReseed`, plus one
`assertion-wait` event per assertion and two `reseed` lifecycle events).

### Choreography (frozen instrument harness `0.3.3-m8`)

| Segment | Required | Implemented | Passed | Skipped (contract) | `green` | `nonGreenCause` |
| --- | --- | --- | --- | --- | --- | --- |
| m1 | 3 | 3 | **3** | 0 | `true` | `null` |
| m2 | 7 | 7 | **7** | 2 (optional) | `true` | `null` |
| m3 | 2 | 3 | **3** | 4 (optional) | `true` | `null` |

Receipts: `receipts/mN-choreography.jsonl` with sidecars
`receipts/mN-choreography.jsonl.observations.jsonl`. Every skip is one the
frozen harness itself declares unimplementable against `CONTRACT.md` (no compose
media-picker ID, no feed/sender avatar ID, no semantic receipt state token, no
group-member lifecycle controls); all are `required:false`, so no milestone's
green was structurally blocked by the instrument.

**Both** milestone green conditions were met for all three milestones: a
passing coverage-validated suite run *and* a passing choreography segment.

### Cross-milestone regression on the final build

The app changed after M1 and M2 were signalled (settled-mutation dispatch, the
authority-fence retry, people-search tokenization, the memoized conversation
composer). To keep the claim honest, all three suites and all three choreography
segments were re-run on the final shipped build into separate receipts:

| Milestone | Regression suite | Regression choreography |
| --- | --- | --- |
| M1 | 7/7 | `green:true` |
| M2 | 22/22 | `green:true` |
| M3 | 7/7 | `green:true` |

`receipts/regression-m{1,2,3}-suite.json`, `receipts/regression-choreography.jsonl`.
`tsc --noEmit` is clean.

### Platform artifacts

An iOS Hermes bundle export per milestone: `artifacts/ios-export-m1`,
`artifacts/ios-export-m2`, `artifacts/ios-export-m3` (the M3 export was rebuilt
on the final build). Each contains
`_expo/static/js/ios/entry-*.hbc`. No iOS simulator run was attempted; M6's
native artifact class is out of scope for a reduced run.

---

## 3. Correction loops and attribution

Every entry below is in `run-log.md` with an evidence pointer.

| # | What | Attribution | Evidence |
| --- | --- | --- | --- |
| 1 | Inline handler profile refused computed member access (`obj[key]`) and top-level `const` capture; rewrote helpers with `Map`/`Set` | **agent-error** (documented in `backend/handler-runtime.md`) | codegen diagnostics, `snapback/functions.mjs` |
| 2 | Hand-built AppBinding needed `auth.passwords` in `capabilities.offered` | **agent-error** (only discoverable in published client source) | `@expo/snapback-client/app-client.mjs:468` |
| 3 | `custody: 'volatile-explicit'` (template default) selects memory auth custody, so the session did not survive reload — M1 acceptance item 3 | **agent-error** (adopting a template default without checking the requirement) | `snapback/schema.mjs`, `tools/scratch/smoke3.mjs` |
| 4 | Suite `m1-a01` raced the sign-up handle-availability live query; made the pre-check advisory (unique index stays the authority) | **agent-error** | `src/auth-gate.tsx`, `tools/suite-lib.mjs` |
| 5 | Suite `m1-a08` raced the edit form's seeding pass, and an inner `innerText()` with the default 30 s timeout ate the whole poll budget | **agent-error** | `tools/suite-m1.mjs` |
| 6 | Feed paging via child→parent state sync rendered zero items on a repeated tab click; replaced with fixed `skip`-able page slots | **agent-error** | `src/feed.tsx`, `tools/scratch/m2repro.mjs` |
| 7 | Live like/reply counts never updated in the browser while the same query delivered correctly headlessly — my merged-rows `useMemo` keyed only on entry ids | **agent-error** | `tools/scratch/like.mjs`, `tools/scratch/livecheck.mjs` |
| 8 | Removing denormalized follower/following columns refused (`SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED`); took a dev-fresh reset and a reseed | **agent-error** (I denormalized first) | `logs/dev-backend.log` |
| 9 | Toggle set-state: a fast second tap re-sent the same intent because the button read a not-yet-updated projection; added a local intent override | **agent-error** | earlier `receipts/m2-choreography.jsonl` run, `src/feed.tsx` |
| 10 | `useSnapbackMutation` resolves a discriminated union, so `String(await createGroup(...))` produced `"[object Object]"` | **agent-error** (documented in `clients/react.md`) | `tools/scratch/group.mjs` |
| 11 | Both non-queued dispatch forms refuse with `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` ("waits for authorization proof") while authority settles; added a bounded retry over the closed authority-fence code set | **ambiguous** (the diagnostic says it waits; in practice it refuses and the caller must wait) | `src/data.ts`, `@expo/snapback-client/index.mjs:11136` |
| 12 | `peopleSearch` treated the whole query as one word-prefix token, so "Bob Bennett" matched nothing | **agent-error** | earlier `receipts/m3-suite.json` run |
| 13 | Typing indicator missed the 2 s ceiling because every keystroke re-rendered the message list (~60 ms/char); isolated the draft into a memoized composer | **agent-error** | `tools/scratch/typing.mjs` |
| 14 | Suite `m2-a09` assumed the seeded post stayed inside the first 100 Global entries; rewrote it to resolve through the seed ledger | **agent-error** | `receipts/regression-m2-suite.json` |

**Environment (not correction loops, but recorded workarounds):**

- `snapback dev --expo` chooses random loopback ports for Metro's front proxy
  and the supervisor bootstrap origin, which cannot satisfy this lane's pinned
  42160–42179 range. The backend runs with `--external-client-origin` on 42160,
  the Expo web client on 42161, and `src/backend.tsx` constructs the
  `supervised-dev` `AppBindingV1` from the generated descriptor.
  Attribution: **environment**.
- The instrument tree is read-only, so the choreography harness cannot install
  its own dependencies there. It runs **verbatim from the instrument** under
  `node --import ./tools/choreo-register.mjs`, a resolve hook that satisfies its
  single bare specifier (`playwright`) from this lane's pinned install.
  Attribution: **environment**.

**Attribution tally:** 12 agent-error, 1 ambiguous, 0 snapback-defect,
2 environment workarounds. I found **no Snapback defect** in M1–M3. The one
ambiguous case (`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`) is a
documentation/wording gap rather than a wrong behavior: the refusal is
effect-free and correctly fail-closed; only the caller obligation is unstated.

### Measured, not a defect

The instrument's `m2 repost-following-feed-surface` check samples the other
client's Following feed immediately after the composing client's own feed
settles. Measured on this app that is a ~50/50 race against ~270 ms live
propagation (3 of 6 in `tools/scratch/samplerace.mjs`). Best-of-three absorbs it
and the segment is green with 1–2 failed attempts retained in the receipt. This
is recorded as a measurement, not relabelled.

---

## 4. Pins

| Component | Version |
| --- | --- |
| `@expo/snapback-cli` | 0.1.25 |
| `@expo/snapback-client` | 0.1.25 |
| `@expo/snapback-codegen` | 0.1.25 |
| `@expo/snapback-react` | 0.1.25 |
| `@expo/snapback-expo` | 0.1.25 |
| `@expo/snapback-acceptance` | 0.1.25 |
| `@expo/snapback-runtime-darwin-arm64` | 0.1.25 (binary `gitCommit 9d9265394953769aaa52e63c8a914464175f93ab`, crate 0.1.0, release) |
| scaffolder | `create-snapback-app@0.1.25`, template `expo-chat` |
| `expo` | 57.0.16 |
| `expo-router` | 57.0.16 |
| `react-native` | 0.86.2 / `react-native-web` 0.21.2 |
| `react` / `react-dom` | 19.2.3 |
| `typescript` | 6.0.3 |
| Node.js | 24.18.0 (volta image; packages require `>=24`) |
| Bun | 1.3.12 (package manager) |
| Playwright | 1.62.1 (lane root `node_modules`), Chromium 151.0.7922.34 |
| UI kit | `social-messenger` UI kit `0.3.1-m8`, vendored verbatim to `clique/src/social-ui/` |
| Choreography harness | instrument `0.3.3-m8`, run unmodified from the read-only instrument tree |
| Fixture pack | instrument `fixtures/social-messenger` (`starter-m1/m2/m3.log`, `personas.json`, media) |
| Target profile | `local-dev-sqlite-ibex`, deployment posture: local binary, fixed port 42160 |

Servers started (all inside 42160–42179), and the only PIDs killed:

| PID | Role | Port | Lifecycle |
| --- | --- | --- | --- |
| 82420 | `snapback dev` backend (initial scaffold schema) | 42160 | started, killed by PID before the schema rewrite |
| 84355 | `snapback dev` backend | 42160 | started, killed by PID for the dev-fresh reset |
| 93615 | `snapback dev` backend (final) | 42160 | running until teardown |
| 86050 | `expo start --web` | 42161 | running until teardown |

No `pkill`, `killall`, or pattern kill was used at any point.

---

## 5. Source-inspection events

All inspection was of the **published packages' own shipped files** under
`clique/node_modules/@expo/snapback-*`; no Snapback implementation checkout was
opened, and no sibling lane, Snapback/Exact repository, or prior Clique/Coterie
implementation was read.

| # | File | Why |
| --- | --- | --- |
| 1 | `@expo/snapback-expo/index.d.mts`, `app-binding.d.mts`, `app-binding.mjs`, `supervised-environment.d.mts` | Determine whether `SnapbackExpoProvider` accepts an explicit binding and what `admitAppBindingV1` requires for a `supervised-dev` override |
| 2 | `@expo/snapback-client/app-client.mjs` (`:440–500`, `:600–800`) | Find the capability the auth bootstrap requires (`auth.passwords`) and how `policy.custody` selects memory vs IndexedDB custody |
| 3 | `@expo/snapback-client/app-client.d.mts`, `assets.d.mts`, `index.d.mts` | Exact shapes for `SnapbackAppBindingV1`, `AssetUploadTask`, and the client's public method inventory |
| 4 | `@expo/snapback-react/index.d.mts` | Hook signatures for `useSnapbackAssetUpload`, `useSnapbackAssetImage`, `useSnapbackPresence`, the mutation hook variants |
| 5 | `@expo/snapback-client/index.mjs` (`:645–665`, `:11120–11150`) | Establish that `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` is raised pre-dispatch and is therefore effect-free and safely retryable |
| 6 | `@expo/snapback-cli/expo-dev.mjs`, `index.mjs` | Establish that the supervised Expo loop's Metro-front and bootstrap ports are not CLI-settable, which forced the fixed-port composition |
| 7 | `@expo/snapback-cli/templates/react/*` | Compare the browser (Vite) composition's binding construction against the Expo one |

Knowledge lookups are logged in `run-log.md` with their source
(`served-guide`, `npm-registry`, `package-types`, `source-inspection`). The
served Guide was the primary documentation channel throughout: the template
start packet first (`AGENTS.md`), then escalated pages
(`backend/queries`, `backend/mutations`, `backend/assets`,
`auth/sessions-and-principals`, `auth/passwords`, `clients/react`,
`clients/headless`, `realtime/live-queries`, `realtime/ephemeral-state`,
`backend/handler-runtime`), plus `snapback guide <query>` lookups. The `backend`,
`clients`, `realtime`, `sync`, and `auth` section flats were cached to
`guide-cache/` for grep-first lookup rather than linear reading.

---

## 6. What is built, and what is not

**Built and green (M1–M3).** Email + password accounts on Snapback's built-in
provider with server-side hashing, one-time recovery codes, durable browser
session custody and server-side logout revocation; the brief's exact profile
field set with a server-enforced unique handle and fixture avatar upload;
text/image/video posts with a bounded ordered media child table; follow graph
with derived counts; likes, reposts and replies as idempotent set-state intents;
Following and Global feeds with keyset paging and implicit self-follow; post
threads; DMs deduplicated per pair; groups with roles and membership
administration; text messages with quoted replies; typing presence inside the
brief's 2 s/5 s ceilings; monotonic per-member receipt watermarks with
recipient-set-at-send-time aggregation; people search with the brief's
case-insensitive word-prefix semantics; and a versioned, idempotent action-log
replay adapter driving the app's own auth and mutation paths.

**Explicitly not built** (out of scope for a reduced run): M4 (media messages,
reactions, edit/delete), M5 (ephemeral, chat customization, full search scopes),
M6 (offline writes, push seam, custom-client API), M7, M8. No scale replay was
run.

## 7. Candid gap list

Things a grader should know are weaker than they look, in the order I would fix
them.

1. **Table visibility is `public-read`, with app-level scoping in the query
   handlers.** Only declared functions are reachable, and `chatMessages` /
   `chatDetails` return nothing to a non-member, so there is no *reachable* leak
   — but I did not use Snapback's `membership` visibility kind, so there is no
   defence in depth at the storage boundary. This is the first thing I would
   change. (M1–M3 have no assertion covering it and O3 is null on a reduced run,
   which is exactly why it was the easy thing to defer.)
2. **No `authScopeField` on any principal-dependent live query.** Codegen
   rejects a computed-record field name (`FUNCTION_UNKNOWN_FIELD`: it validates
   against the *primary table's* fields), so my per-viewer feed, chat, and
   profile queries carry no scope declaration. The `ctx.auth` gate inside each
   handler is real, but the platform's invalidation and retained-result
   bookkeeping does not know these results are per-principal.
3. **Two bounded reads that will not survive the scale envelope.** The viewer's
   own like/repost projection is `take(1024)` per table per query, and the
   Following-scope feed queries once per followed actor (fine at 8 personas,
   wrong at the brief's 500-follow probe user). Both are honest today and both
   are M6/M8 problems I did not have to solve; I have marked the first in source.
4. **Feed paging caps at six pages (120 entries).** Fixed hook slots were the
   robust fix for a live-update bug; a real client should virtualize.
5. **Receipts are implemented but not asserted end-to-end.** The state machine
   (`sent` → `delivered` → `read`, monotonic, aggregate over the recipient set at
   send time, leavers dropping out) is in `sendMessage`/`markChatState`/
   `aggregateReceipt` and renders through the kit's `ReceiptTicks` with the
   semantic state as its accessible label — but the frozen contract pins no
   semantic receipt token, so the choreography skips it as unimplementable and no
   suite-required assertion covers it. It is code with a UI, not a proven claim.
6. **Group receipt aggregation and member-removal live cutoff** are likewise
   implemented (`removeMember` deletes the membership row, which both stops
   delivery and drops the member from the aggregate requirement) but unproven for
   the same reason.
7. **`sm-profile` and `sm-convo-bubble` are lane-owned wrappers around the kit
   components**, which keep their own testIDs (`sm-profile-card`,
   `sm-convo-bubble-body`). This was necessary — the harness reads the first line
   of `sm-profile` as the display name, and it looks for message actions *inside*
   the selected bubble — and it changes no component contract, but a grader
   comparing against the kit's default IDs should know why they moved.
8. **The `seedRefs` ledger is an application table serving a test concern.** It
   is what makes per-segment idempotency true and reset-safe, and the brief asks
   for a "versioned, idempotent seed", but it is app schema carrying replay
   bookkeeping.
9. **No lockfile discipline across the two package roots.** `clique/bun.lock`
   pins the app; the lane root has a second tiny `package.json`/`bun.lock` that
   bun created for Playwright. Reproducible, but two roots.
10. **`sm-feed-diagnostics` ships in the UI.** It is a small caption showing each
    feed page slot's `status/freshness/connection/rowcount`. I added it to debug
    a staleness bug and kept it because the platform exposes no per-query
    delivery observability; it should be behind a dev flag in a real product.
11. **Timing-sensitive checks are genuinely timing-sensitive.** The M2
    repost-following check passes 1–3 of 3 attempts depending on scheduling; the
    typing check passes 3/3 with ~600 ms of headroom against a 2 s ceiling. Both
    are green, neither is comfortable.
12. **Web only, in practice.** Every milestone produced an iOS Hermes bundle
    export as required, but nothing was run on a simulator or device, and
    `custody: 'durable-required'` is proven here only on the Expo-web
    IndexedDB/Web-Locks carrier.

---

end=1787574126
