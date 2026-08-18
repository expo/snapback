# LLP 0027: All Aboard — Caltrain next-train demo

**Type:** Plan
**Status:** Implemented
**Systems:** Demo apps, Cron, Realtime, Data gateway, Contract/Exact, Notifications, Developer experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-30
**Revised:** 2026-07-09 (ENG-23795 native-feeling paging pass: the station header and the selected-train card are declared 3-cell paging strips — adjacent cards physically at ±100%, dragged 1:1 by the web glue, no fade replacement; train rows select on tap and paged-past trains stay visible in compact rows; direction switching, the live-status dot, the location indicator, and system-style ↻/⚙ controls moved into a sticky footer (direction pill, circular train arrows, and E3 service-filter chips removed); the header distance line is a directions affordance — tap opens the preferred maps app, long-press (or plain press on native) opens the Apple/Google/copy-address sheet, with the maps-app preference in Settings; ETA mode gained an `auto` default that resolves to bike beyond an 18-minute walk; the stations list carries an end-of-line hint (`… San Jose Diridon 9:16`); the trip sheet got a plain ‹ back, the service badge beside the train name, and a labeled TRIP PROGRESS bar — see [Interaction model](#interaction-model), Diary 0008); 2026-07-08 (LLP 0049 correction: live 511 success now writes `liveDepartures` rows with real StopMonitoring predicted departure times and the Contract board prefers them whenever `feedRefreshState.lastSource` is `511-siri-stop-monitoring`; a live snapshot with zero station-mappable visits shows no trains instead of clock-face demo trains); 2026-07-04 (ENG-22751 real-data path made debuggable: every failed live refresh now commits an actionable, key-redacted `lastError` and both surfaces render it as a `feed-problem` line; data honesty: surfaces also render a `data-source` badge — amber DEMO DATA for the seeded/recorded/fallback feed, green LIVE only after a real 511 snapshot commits per `feedRefreshState.lastSource` — and haversine walk/bike ETAs are `~`-prefixed, see [Deterministic data](#deterministic-data); second pass same day: the whole path was re-walked against the **real** `api.511.org` (setup-page key → live fetch → redacted 401 on the board), and the two likely 511 responses now carry instructions too — HTTP 401 → update the key at setup, HTTP 429 → add a pooled key — with the instruction placed ahead of the diagnostic so the surface's 180-char truncation can't eat it; README real-data flow corrected (persistent `--db` so setup keys survive restarts; app-first boot order); real-data suite now serves the 511 mock as the real API responds (BOM + gzip + plain-text 401) and exercises the `/_snapback/api/config/set` setup path; 2026-07-01 redesign pass: full-bleed poster-stylized station art with the board typeset on it, hero-selection state, and the LLP interaction model implemented for real on web via gesture surface glue — see [Station identity](#station-identity), [Interaction model](#interaction-model), [Implementation](#implementation), Diary 0008; earlier same day — LLP 0032 R3: manifest sketch aligned with the implemented `exact.gestures: false` gap; replaced the placeholder per-station SVG drawing with real Wikimedia Commons photos from the Wikipedia List of Caltrain stations, base64-inlined inside the card SVG at build time — zero runtime egress, with visible CC BY/CC-BY-SA/CC0 photo credits; shifted live feed plan to hybrid read-through refresh plus minute-compatible polling for Cloudflare-friendly operation; 2026-06-30 corrected egress: Ibex ships fetch/http behind a coarse strict-mode `network:fetch` capability — per-host allowlist not actually enforced; work is action-scoped enablement, not a new HTTP stack; 2026-06-30 implemented Phases 0–3 as `demos/all-aboard/` — see [Implementation](#implementation) and Diary 0008)
**Related:** LLP 0000, LLP 0004, LLP 0008, LLP 0009, LLP 0013, LLP 0015, LLP 0016, LLP 0020, LLP 0024, LLP 0028, LLP 0029, Diary 0008, https://github.com/ccheever/ibex, https://openrouteservice.org, https://en.wikipedia.org/wiki/List_of_Caltrain_stations, https://511.org/open-data/transit

## Summary

**All Aboard** is a Caltrain demo whose single job is to answer one question as
fast as possible: *when is the next train, north and south, from the station I'm
closest to?* You open the app and the answer is already on screen — no taps, no
menus, no trip planner. Everything else (schedules later in the day, which stops
a train makes, where a train physically is on the line) is reachable but
deliberately secondary.

The frontend is built in **Contract/Exact** — this is the first demo that makes
Contract/Exact the *required* product surface from the start rather than a
deferred follow-up, and the first demo to lean on Contract's **gesture** and
**device-geolocation** primitives.

The backend is **Snapback**. This demo is worth building because it drives two
capabilities no existing demo exercises and that the corpus has named but not
implemented:

- **Cron / scheduled refresh** (a v1 subsystem in
  [LLP 0000](./0000-snapback.explainer.md), not yet built) — the one genuinely
  net-new backend subsystem this demo needs. The live feed is a hybrid
  read-through cache: a request or subscription that finds stale train data
  triggers one collapsed refresh action, while active subscribers may keep the
  data warm on a minute-compatible cadence. The refresh action writes durable
  `trainStatus` rows *through a mutation*; the realtime layer then pushes those
  changes to connected clients (that push path already works today).
- **Action egress** (outbound HTTP from app code) — *not* a from-scratch build.
  The Ibex runtime Snapback already links implements `fetch`, `http`/`https`, and
  WebSocket natively, behind a strict-mode `network:fetch` capability that Snapback
  already installs (`crates/snapback/src/runtime.rs` installs `Host::strict()`) and additionally
  denies at the JS layer (`ambient_restriction_source`). The work is to *un-deny*
  `fetch` for a refresh/action execution class — what the reserved `outbound_actions`
  and `cron` manifest flags anticipate — keep it out of the transactional mutation
  path, grant network only to that class, and add a secrets seam for the rotating
  API-key pool. **Caveat:** Ibex enforces only a *coarse* `network:fetch` gate
  today, **not** a per-host allowlist (the fetch call site never passes the URL's
  host); a real destination allowlist is a small engine change, detailed under
  [External data and action egress](#external-data-and-action-egress). The Caltrain
  poll and the Maps walk/bike call both ride on this.

Per [LLP 0016](./0016-diary-driven-change-program.plan.md), a new demo earns its
place by retiring glue or proving a missing runtime capability. All Aboard does
the second: it is the forcing function for **scheduled/demand refresh** (net-new)
and for **action egress** — un-denying the `fetch` Ibex already ships, scoped to
a refresh/action class. It must be phased so the UI and realtime path are proven
on recorded data *before* those capabilities are enabled, with the gaps reported
honestly rather than faked.

## Motivation

The reference-app list in [LLP 0000](./0000-snapback.explainer.md#reference-apps)
includes scheduled-execution consumers (daily-fantasy scoring, contest locks),
but the demo ladder in
[LLP 0015](./0015-demo-application-suite.plan.md#demo-ladder) has so far only
exercised durable CRUD (todo) and ephemeral presence (cursors). Nothing has yet
made **Cron** real, and nothing has exercised **server-authored data that
changes on a schedule and pushes to clients** — which is a different realtime
shape from both todo (client-driven mutations) and cursors (connection-owned
ephemeral state).

A transit "next train" app is an unusually good fit for this gap:

- The interesting data (where every train is, how late it is) is produced *by the
  world*, not by app users. The app should refresh it server-side, not from the
  client: on first demand when the cached feed is stale, and then on a cheap
  minute cadence while riders are actively watching.
- The product value is **freshness pushed to the client**: when a train slips
  three minutes, every open app should update without a manual refresh. That is the
  [LLP 0000 realtime requirement](./0000-snapback.explainer.md#realtime-live-updates)
  applied to server-authored rows.
- The UI is small, visual, and gesture-driven, which is a real test of whether
  Contract/Exact can carry a product surface (swipe, tap, geolocation, images)
  over generated Snapback artifacts — the goal
  [LLP 0015](./0015-demo-application-suite.plan.md#contractexact) sets as primary
  but no demo has yet met for a gesture-first app.

It is also genuinely useful and easy to reason about, which keeps the demo honest
about *product shape* without sliding into a scale claim.

## Scope

This Plan owns:

- the All Aboard product definition and its interaction model;
- the Snapback backend shape for schedule, trains, and live positions;
- how read-through refresh, Cron wakeups, and action egress are introduced
  *through this demo*, including the phasing that lets the UI ship before they
  exist;
- the demo's deterministic data, capability manifest, and acceptance criteria;
- the honest capability gaps (live polling, notifications) this demo must not
  fake.

It does not own:

- the Cron subsystem's general design — All Aboard is its first consumer and
  motivating case, but the scheduled-execution contract is specified in
  [LLP 0028](./0028-cron-scheduled-execution.rfc.md);
- the runtime sandbox policy for action egress and secrets — this demo needs it
  enabled and scoped, but the ambient-capability boundary is owned by
  [LLP 0009](./0009-code-execution-security.rfc.md), not redefined here;
- Snapback's schema, handler, sync, auth, or runtime semantics (LLP 0004,
  LLP 0008);
- the Contract language, gesture model, or Design Mode semantics (Exact LLPs);
- production-scale transit ingestion. This is a demo, not a departure-board
  service.

## Context Pack

Governing constraints this demo must respect:

- [LLP 0015](./0015-demo-application-suite.plan.md) — every demo has one shared
  Snapback backend, deterministic data, a `demo.snapback.json` manifest,
  machine-checkable acceptance, and honest capability gaps; demos start with a
  headless backend proof and then add the highest-value product surface.
- [LLP 0016](./0016-diary-driven-change-program.plan.md) — a later demo should
  not broaden the corpus unless it retires glue or proves a missing runtime
  capability, and the build experience lands as a diary.
- [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) — owns the live-query
  and realtime-delta path that server-authored train rows will sync over. This
  demo is a *consumer*, not a redefinition.
- [LLP 0009](./0009-code-execution-security.rfc.md) — owns the runtime sandbox
  boundary and ambient-capability policy. Enabling `fetch` for a refresh/action
  execution class is a sandbox-policy change governed here, not a free demo
  toggle; the secrets seam for the API-key pool is in the same territory.
- [LLP 0013](./0013-ephemeral-realtime-state.rfc.md) — owns ephemeral
  connection-owned latest-state. This demo deliberately does **not** model train
  positions as ephemeral state (see [Realtime model](#realtime-model)); it cites
  0013 only to record why.
- [LLP 0020](./0020-core-authoring-surface.plan.md) — a realtime-heavy demo
  cannot claim product evidence unless it uses generated artifacts, real runtime
  paths, and an honestly reported realtime capability class.
- [LLP 0000](./0000-snapback.explainer.md) — Cron and the data gateway are named
  subsystems (v1 and v2 respectively) but are not yet implemented; "scale to
  zero" and "demo proves shape, not scale" both apply.

Current implementation evidence:

- `crates/snapback/src/` contains the local server, durable storage, live matcher, and the
  ephemeral backend, but **no cron/scheduler module**, and the handler sandbox
  **denies all ambient capabilities**: `crates/snapback/src/runtime.rs` `ambient_restriction_source`
  hard-denies `fetch`, `WebSocket`, `setTimeout`, `setInterval`, `require`, and
  `process` before every handler runs. So Cron is genuinely net-new, but outbound
  HTTP is *already implemented in Ibex and merely switched off in Snapback* (see
  [External data and action egress](#external-data-and-action-egress)).
- The Ibex runtime Snapback links (`vendor/ibex`) compiles native `fetch`
  (`native_fetch_macos.mm` over NSURLSession, plus Linux/Windows) and registers
  `http`/`https` builtin modules. Outbound `fetch` is gated: the engine calls
  `checkCapability("network:fetch")` (`hermes_runtime_fetch.cc`) → the Rust
  `CapabilityManager`, and Snapback runs it in **strict** mode (`crates/snapback/src/runtime.rs`
  installs `Host::strict()`), so fetch is currently capability-denied as well as
  JS-denied. **Caveat — the allowlist is not what it looks like:** the capability
  layer *models* per-host grants (`network:fetch:<host>`, with base-grant fallback;
  there are unit tests), but the fetch call site only ever checks the bare
  `network:fetch` without the request's host, so **per-host allowlisting is not
  enforced end-to-end** — egress is all-or-nothing per module until the engine
  fetch/ws/http functions thread the host into the check.
- The manifest already reserves the matching capability flags `cron` and
  `outbound_actions` (`crates/snapback/src/manifest.rs`), both defaulting `false` — the design
  anticipated this split between transactional handlers and outbound-capable
  actions.
- The realtime push path is already implemented: a mutation commit calls
  `notify_live_subscriptions` (`crates/snapback/src/local.rs`), which the live matcher fans out to
  affected subscriptions. A refresh write through a mutation reuses this for free.
- `demos/todo/` and `demos/todo-v2/` already run a working Contract/Exact surface
  over generated Snapback artifacts via `demos/_kit/`, so the Contract surface
  path itself is proven; gestures and geolocation are the new surface load.
- The Exact checkout at `../exact` exposes tap-family events (`press`,
  `longpress`) and an `image` primitive, and a native geolocation module, so most
  of what All Aboard needs exists in source. **Correction (verified at
  implementation):** swipe/pan primitives (`swipe`, `OnSwipeDown`, `gesture`) do
  **not** exist — they live only in unbuilt Exact motion RFCs, and the Contract
  event vocabulary is exactly `press change submit longpress focus blur scrollend
  refresh`. There is also no Contract geolocation binding (Exact's own Caltrain
  twin skips it). So the gesture-first interaction ships as **press affordances**
  and geolocation is wired via `navigator.geolocation` in surface glue — the
  cursor demo (Diary 0007) caution in its strongest form: here the primitive was
  not even in source. See [Implementation](#implementation).

## Product Design

### The one thing it does

Time-to-answer is the product. On launch, before any interaction, the screen
already shows:

1. the **nearest station** (name + photo);
2. the **next train in the assumed direction**, with minutes away, expanded to
   show its stops;
3. the **next train in the opposite direction**, with just minutes away;
4. the **next three trains in the assumed direction**, each as minutes away plus
   class (local / limited / express / Baby Bullet) and nothing else.

Walking and biking time to the nearest station appear on the station card. No
login ([LLP 0000](./0000-snapback.explainer.md) auth is out of scope for this
demo; it is anonymous, read-only).

### Assumed direction

The app guesses which way you want to go so the primary answer needs no input:

> If the nearest station is **San Francisco (4th & King) down through South San
> Francisco** — i.e. San Francisco, 22nd Street, Bayshore, or South San
> Francisco — assume the rider wants to go **south**. Otherwise assume **north**.

Concretely this is `assumedDirection = stationOrderIndex <= southSanFranciscoIndex
? "south" : "north"`, where `stationOrderIndex` runs north→south. A single tap
anywhere (with no other tap action) flips the assumption.

### Interaction model

The app is driven almost entirely by gestures, so the common case stays
zero-chrome:

| Gesture | Effect |
|---|---|
| Swipe **left / right on the red header** | Page to the adjacent station (along the north–south line) — the neighbor's card is physically adjacent and follows the finger; the header edge chevrons are the tap equivalent |
| Swipe **left / right on the departures board** | Page to the later / earlier upcoming train (earlier trains sit to the left, later to the right) — the adjacent train card follows the finger |
| Scroll **up / down on the board** | Native vertical scrolling through the departures content |
| Tap the **footer direction switch** ("Switch to Southbound/Northbound") | Toggle north ⇄ south |
| Tap a **train row** | Select (page to) that train; sooner trains stay visible in compact rows above the selected card |
| Tap the **selected train's card** | Open that train's detail: ordered stops + times, and its position along the line |
| **Long-press the header distance line** (tap = open maps) | Open the directions sheet: Apple Maps / Google Maps / copy the station address |

Gestures are region-scoped since the ENG-23719 redesign (2026-07-08): the
sticky header is the station-navigation surface and the scrolling board walks
the trains horizontally while scrolling natively on the vertical axis. Since
ENG-23795 (2026-07-09) both surfaces page **contiguously**, the native
iOS-paging model: each is a declared 3-cell strip whose prev/next cards sit
physically at ±100% inside a clipped container, so mid-gesture the neighbor
is already there — no blank space, and no fade-out/fade-in replacement on
commit. The same change moved direction switching into a sticky footer
("Switch to" de-emphasized over the destination) alongside the live-status
dot (green live / gray not, with the honest DEMO DATA / SCHEDULE / STALE
label kept beside it when not live — the ENG-23642 requirement), the
location indicator (blue on a real device fix), and system-style ↻ / ⚙ icon
buttons; the separate direction pill, the circular ‹ › train arrows, and the
E3 service-filter chips are gone (paging + tap-to-select made them
redundant; filters had no strong use case on a board whose job is "next
train").

*As implemented (Exact LLP 0336 P1 / ENG-24167):* the two contiguous strips
are Contract `pager` declarations. Exact's web arena recognizes pointer and
wheel input, arbitrates the declared claim regions, installs the effective
`touch-action`, drags/springs/settles the adjacent cells, and dispatches the
same command as the visible chevron or train-row witness. Pager arrows and
the home mnemonics are declared bindings, not app listeners. The surviving
`surfaces/contract/gestures.ts` is intentionally only the P2 remainder:
sub-screen swipe-right plus Escape/ArrowLeft dismissal until those screens
become router presentations. `directions.ts` still owns URL/clipboard/maps
preference side effects, but Exact now delivers its declared `longpress`;
the demo-local timer is gone. The native Motion/host slice remains G1/G8 work.
Acceptance drives the affordances by testId and the gestures by synthetic
pointer sequences dispatched from the element under the start point, since
region decides meaning
([LLP 0015](./0015-demo-application-suite.plan.md#contractexact)).

### Train detail

Tapping a train shows:

- the ordered list of stops it makes, each with scheduled (and, when live,
  predicted) time;
- its **position along the north–south continuum** — a simple linear indicator
  of where the train currently is between its previous and next stop, derived
  from live position data when available and from the schedule otherwise.

Showing *which* stops a train makes is supported but not the focus; the detail
view is one tap deep, not the landing surface.

### Station identity

Since the ENG-23719 redesign (2026-07-08), the station screen is a **white
board under a Caltrain-red sticky header** rather than a full-screen poster.
The header (a little taller than a plain title bar, because it is also the
station-swipe surface) carries the station identity: the day's **hand-drawn
scene** as a bordered portrait chip beside the station name in white, with the
zone / walk-bike line under it. The scenes are the ENG-23684 original artwork —
three per station, 640×1136 SVGs drawn from one shared ink-and-wash style guide
— inlined by `demos/all-aboard/scripts/gen-station-art.mjs` into
`snapback/shared/station-art.gen.mjs` and picked per epoch day
(`data.ts stationArt()`: day-of-epoch mod scene count, so every station flips
to its next scene at midnight UTC and the pick stays deterministic for tests).
The art rides the Contract `image svgSource=` path (the DOM mirror blocks
`data:` URIs on `src=`); being original work it needs no attribution line. Zero
runtime egress, full determinism.

Below the header, the board answers the question in ink on white: the selected
train as a highlighted card (giant countdown, service class, train number,
delay, its upcoming stops), the next few trains, the opposite-direction teaser,
and the data-source footer; a floating red button opens Settings (no bottom
tabs). The previous full-bleed treatment — poster-stylized Wikimedia photos
with baked legibility scrims (`station-photos.gen.py` / `model.mjs
stationPhoto()`, credit line required) — is retired from this screen but the
generated module and wrapper remain for the React control arm. Flowing the
inlined assets (~1.5 MB photos + ~0.9 MB scenes) through the
[asset-storage subsystem](./0000-snapback.explainer.md#asset-storage) remains
the follow-up ([Open questions](#open-questions)); the shortcut is recorded in
the manifest `temporaryPolicy`.

## Backend Design

### Data model (durable)

All of this is ordinary durable Snapback data ([LLP 0004](./0004-application-data-api.rfc.md)),
seeded deterministically:

- **`stations`** — `{ id, name, orderIndex (north→south), lat, lng, zone,
  photoUrl, photoAttribution }`. The `orderIndex` is the spine the whole app
  navigates and the basis for assumed-direction and the position indicator.
- **`trips`** (static schedule) — one row per scheduled train run:
  `{ id, trainNumber, direction (N/S), serviceClass (local|limited|express|bullet),
  serviceDay (weekday|saturday|sunday) }`.
- **`stopTimes`** — `{ tripId, stationId, stopSequence, scheduledArrival,
  scheduledDeparture }`, indexed by `stationId` to back the per-station next-train
  query.
- **`trainStatus`** (live, refresh-written) — `{ tripId, observedAt, delaySeconds,
  status (scheduled|active|delayed|cancelled), prevStationId, nextStationId,
  progress (0..1), lat?, lng? }`. This is the train data the refresh action
  mutates; it is what makes the screen "live."
- **`liveDepartures`** (live, refresh-written) — one row per mappable 511
  StopMonitoring visit: station, direction, service, headsign/train number,
  scheduled and predicted departure times, delay, status, and source. When the
  feed source is live, the board uses these real predicted departures as the
  primary next-train truth; it does not synthesize clock-face departures from the
  seeded demo schedule.
- **`feedRefreshState`** (singleton cache metadata) — `{ id: "caltrain",
  fetchedAt, staleAfter, inFlightRunId?, lastError?, lastSource }`. This is the
  read-through guardrail: it lets the server decide whether the current
  `trainStatus`/`liveDepartures` rows are fresh enough, collapse concurrent
  refresh requests into one action, expose "updated N seconds ago" to the client,
  and return stale data when the upstream feed fails.

Predictions ("next train in N minutes") are computed from `liveDepartures` when
`feedRefreshState.lastSource` is the live 511 source. The seeded `stopTimes` +
`trainStatus` computation remains the recorded/fallback mode and coarse status
overlay. The default freshness target is **60 seconds** so the hosted Cloudflare
path can use a minute-compatible warm poll rather than a continuously re-armed
sub-minute timer loop.

### Realtime model

Train positions and predictions are **server-authoritative durable rows synced
via the [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) live-query
path** — the same delta mechanism that makes an RSVP appear live. The client
holds a live query for "trains relevant to the current station and direction";
a refresh write to `trainStatus` produces a delta that updates the minutes-away
figures and the position indicator without a manual refresh.

On subscription start, the initial result is still authoritative: it returns the
latest durable `trainStatus` rows plus `feedRefreshState`. If those rows are older
than the freshness target, the server triggers one refresh action and then pushes
the updated rows when the mutation commits. The UI can show the stale-but-usable
answer immediately ("updated N seconds ago") instead of blocking the time-to-answer
path on an upstream feed call. If there is no usable cached feed yet, the first
request may wait for a bounded refresh or show the static schedule fallback with a
clear freshness diagnostic.

This demo **rejects** the [LLP 0013](./0013-ephemeral-realtime-state.rfc.md)
ephemeral model for train positions, and records why so the distinction stays
crisp:

- ephemeral entries are **connection-owned**; train positions are owned by the
  *system* (a refresh action / scheduler), not by any client connection;
- ephemeral state is **lossy and TTL-bound**; a rider who just opened the app
  must see the current position immediately, not wait for the next poll to
  re-publish it;
- ephemeral state is explicitly **never durable**; the schedule and last-known
  positions should survive a brief disconnect.

The honest realtime capability class for this demo is **Online**
([LLP 0020](./0020-core-authoring-surface.plan.md)): the schedule could later be
cached for offline schedule-browsing, but the demo does not claim local-first
live positions.

> **Known limit, not a goal.** While riders are watching, refreshing N trains every
> minute and writing `trainStatus` churns durable rows and bumps the storage
> version on a cadence. At Caltrain scale (tens of trains, roughly one refresh per
> minute) this is a low, instructive write rate. The read-through/demand-gated
> shape deliberately avoids idle churn, but it is **not** a fan-out or
> write-throughput benchmark; per
> [LLP 0000](./0000-snapback.explainer.md#scale-targets-and-known-limits) a demo
> proves shape, not scale.

### Feed refresh and Cron

The refresh path is the heart of the demo. Cron is one wakeup source for that
path, not the only way fresh data arrives. Its contract, as this demo needs it:

- answer reads from durable `trainStatus` immediately when usable data exists,
  including a `feedRefreshState` freshness marker;
- when a request or live-query subscription sees data older than the freshness
  target, trigger one server-side refresh action and collapse concurrent demand
  behind the same in-flight run;
- while there are active live-query subscribers, keep the feed warm on a
  **minute-compatible cadence**; when there are no subscribers, idle data may go
  stale and the next request performs a catch-up refresh;
- execute server code with write access to durable storage only through a
  mutation, so the refresh can upsert `trainStatus` and `feedRefreshState` and
  reuse the existing realtime fan-out path;
- be observable (last run, trigger source, duration, success/failure, freshness
  age) and resettable for tests;
- be deterministic under test — a frozen clock plus a fixed recorded feed must
  produce identical `trainStatus` and `feedRefreshState` rows.

Load-bearing: the read-through trigger is **not** an ordinary query handler doing
network I/O or hidden writes. The generated read/subscription boundary may inspect
`feedRefreshState`, return the current durable snapshot, and enqueue or claim a
refresh action outside the query transaction. The refresh action then fetches and
commits through a mutation, preserving the query/mutation/action separation in
[LLP 0028](./0028-cron-scheduled-execution.rfc.md).

For the hosted Cloudflare shape, the accepted LLP 0049 deployment uses **60s
freshness** with a demand-armed Durable Object alarm, not a static minute Cron
Trigger. The alarm is armed only while live subscribers exist and disarmed when
the last suite-owned subscriber leaves, preserving the idle-economics claim that
the deployed app should take zero warm-poll wakeups when nobody is watching. A
Cron Trigger fallback would have to declare its per-minute idle invocations as a
measured platform fact.

All Aboard is the **first consumer** of Cron and its motivating case, but the
general scheduled-execution contract (cadence syntax, demand activation,
overlap/at-least-once semantics, failure/retry, isolation, target behavior on
Cloudflare Cron Triggers and alarms) is larger than one demo and is specified
separately in
[LLP 0028](./0028-cron-scheduled-execution.rfc.md). This Plan depends on that RFC;
the local scheduler, action-to-mutation runner, and Cloudflare demand-armed proof
have now landed, with remaining target limits named in LLP 0049's capability
manifest.

### External data and action egress

Two external dependencies, both outbound HTTP from app code: the Caltrain
real-time feed and a Maps API. The correction from this Plan's first draft —
**this is not a from-scratch "data gateway" build.** The Ibex runtime Snapback
links already implements `fetch`, `http`/`https`, and WebSocket natively, behind
a capability gate — though only a *coarse* `network:fetch` check is enforced, not
a per-host allowlist (see below). What
blocks it is Snapback's own sandbox: `crates/snapback/src/runtime.rs` `ambient_restriction_source`
is injected before every handler and hard-denies `fetch` (and `require`,
`WebSocket`, timers). So the work is enablement and policy, not a networking
layer:

- **Expose `fetch` to a refresh/action execution class only.** The invoke wrapper
  already distinguishes handler kinds (it carries a `writable` flag for query vs
  mutation). Add a third class — an *action*, the thing cron runs — that is
  granted `fetch` while ordinary query/mutation handlers keep the full deny. This
  is what the reserved `cron` and `outbound_actions` manifest flags
  (`crates/snapback/src/manifest.rs`) are for.
- **Keep egress out of the transactional path.** Load-bearing. Mutations run under
  snapshot isolation with commit-time read/write-set validation; a handler that
  blocks on a network round-trip mid-transaction breaks that model
  (non-deterministic, unsafe to retry). The shape is therefore: the action
  **fetches**, then calls a **mutation** to write `trainStatus`. That mutation is
  also what fires the realtime fan-out, so the live update falls out for free.
- **Scope destinations — and mind the allowlist gap.** Ibex enforces only a
  *coarse* `network:fetch` capability today: the engine checks `network:fetch`
  without the target host (`hermes_runtime_fetch.cc`), even though the Rust
  `CapabilityManager` can already express and match host-scoped grants
  (`network:fetch:<host>`). So egress can be scoped **by module** (grant network to
  the action class only) but cannot yet be limited to `*.511.org` + the Maps host
  without either (a) a small engine change to pass the URL host into
  `checkCapability`, or (b) an app-level URL check inside the action. For a trusted
  local demo with known endpoints, (b) is acceptable for v0; the real per-host
  allowlist — the SSRF/egress seam owned by
  [LLP 0009](./0009-code-execution-security.rfc.md) — must be tracked as a known
  gap, not assumed.
- **Add a secrets seam for the key pool.** Genuinely still missing: Ibex `fetch`
  does not store or rotate API keys. The action context needs something like
  `ctx.secrets` (scoped, never client-visible) holding the **pool of keys rotated
  across requests** to respect feed rate limits.
- **Async/timers.** `fetch` returns a Promise; the invoke wrapper already awaits
  the handler and Ibex pumps async to completion. `setTimeout` is also denied
  today, so retry/backoff in an action would need timers restored for that class.

The **live train data** refresh runs on this path (e.g. 511.org GTFS-Realtime, or
Caltrain's own feed), triggered either by stale read-through demand or by the
minute warm-poll while subscribers are present. **Walk/bike time** is deliberately
*not* on this path for v0: finding the nearest station and a rough distance needs
no external call — we already have each station's coordinates — so v0 computes
walk (~5 km/h) and bike (~15 km/h) ETAs by **haversine** from the device location,
with zero key, zero egress, and full determinism for tests. A real **routing**
call (default **OpenRouteService**; Mapbox is the alternative-of-record — see
[Open questions](#open-questions)) is a Phase-3 accuracy upgrade, run as an egress
action **proxied through Snapback** so the key stays server-side and results cache
by (location-bucket, station) to stay under ORS's low free quota. Calling ORS
directly from the client is possible (the native client can fetch, and ORS has no
restrictable client key) but leaks the key, so it stays a labeled throwaway-key
shortcut, not the default. A free **"directions in Maps" deep-link** can complement
the inline estimate for real turn-by-turn. v1 only *shows* the figure (the "leave
now" notification is out of scope, [Non-goals](#non-goals)). The static GTFS
schedule changes a few times a year and is committed seed data for v0, not a live
fetch.

### Deterministic data

For everything below the live-polling phases, the demo runs on **recorded /
seeded** data:

- a committed static schedule (a representative service day) as `stopTimes` +
  `trips` seed;
- a committed sequence of recorded `trainStatus` snapshots ("feed ticks") that a
  test harness can apply one at a time against a **frozen clock**, standing in
  for the live feed;
- no Maps fixture is needed — v0 walk/bike is haversine from the seed coordinates,
  keeping the routing path out of the deterministic data set entirely.

This is what lets Phases 0–1 prove the UI, the next-train math, and the realtime
delta path *before* Cron or outbound HTTP exist, with those capabilities marked
`expected_missing` rather than stubbed silently.

Because the recorded feed doubles as the *fallback* for every failed live
refresh, "demo data" must never be a silent dead end (ENG-22751 — a rider with
real keys couldn't tell why the board stayed canned). Three rules, as built:

- **Every fallback commits an actionable reason.** `refreshFeed` translates the
  two setup mistakes into instructions in `feedRefreshState.lastError` — server
  started without `SNAPBACK_OUTBOUND_ACTIONS=1` → say so; no `caltrainFeed` key
  → point at `/_snapback/admin/setup` — and the two likely 511 responses get a
  next step too: HTTP 401 (mistyped or not-yet-activated key) → update the key
  at the setup page; HTTP 429 (rate window exhausted — a plausible steady
  state, since the warm poll runs at 60/hr against a per-key limit) → add
  another pooled key or wait. Anything else keeps the transport error
  (`live 511 fetch failed: …`). Instructions sit *before* the diagnostic
  detail because the surface truncates the message tail-first at 180 chars.
- **The reason is rider-visible.** Both surfaces render a `feed-problem` line
  under the board footer whenever `lastSource` is not the live 511 source *and*
  `lastError` is non-empty. An intentional demo run (no keys ever configured,
  explicit `source: 'recorded'`, reset) has no error and shows nothing.
- **`lastError` is client-visible state, so it is redacted.** The 511 key rides
  in the request query string and HTTP errors quote the URL; the handler scrubs
  `api_key=…` before the message becomes durable, queryable state.

The real-data acceptance suite serves its 511 mock the way `api.511.org`
actually responds — UTF-8 BOM before the JSON, gzip content-encoding, plain-text
401 for a bad key — and drives the key through `/_snapback/api/config/set` (the
setup-page path), not only the deprecated env blob, so the user-visible path is
the tested path. A successful live refresh writes both the coarse `trainStatus`
overlay and `liveDepartures`; when the source is live the board takes its
minutes-away rows from `liveDepartures`. If 511 returns visits but none map to
the demo's station set, the live source commits with an empty departure board and
an actionable reason rather than falling through to demo trains.

Because the recorded feed is a first-class mode (not just a test harness), the
surfaces label it honestly: the board footer renders a data-source badge
(testId `data-source`) driven by `feedRefreshState.lastSource` — amber
"DEMO DATA" for the seeded/recorded/fallback feed, green "LIVE" only after a
real 511 snapshot commits — and haversine walk/bike ETAs are prefixed `~` so
straight-line estimates never pose as routed directions.

## Capabilities this demo drives

Stated plainly so the demo's justification under
[LLP 0016](./0016-diary-driven-change-program.plan.md) is legible:

| Capability | Status in repo | Role in this demo |
|---|---|---|
| **Cron / scheduled refresh** | not implemented (v1 named) | **primary build** — read-through catch-up, minute warm-poll wakeup, run ledger, demand state; needs its own LLP |
| **Action egress** (coarse `network:fetch`) | implemented & enforced (Ibex gate + Snapback strict host); fetch denied today | un-deny + grant network to the refresh/action class; reuses `cron`/`outbound_actions` flags |
| **Per-host egress allowlist** | modeled in the capability layer, **not enforced** on the fetch path | small Ibex engine change, or app-level URL check for v0; SSRF seam (LLP 0009) |
| **Secrets for the key pool** | not implemented | rotating API keys scoped to the action context; small rider on egress |
| **Realtime push of server-authored rows** | implemented (`commit → notify_live_subscriptions`) | already works; refresh writes via a mutation to use it |
| **Contract gesture binding** (swipe/tap) | primitives in Exact; unproven over Snapback data | gesture-first product surface |
| **Contract geolocation binding** | primitives in Exact; unproven over Snapback data | nearest-station selection |
| **Notifications** ("leave now") | not in scope here (v1 named) | explicitly future |

## Phases

Staged so early work goes green without faking the missing capabilities. Each
phase has its own honest manifest entry.

### Phase 0 — Headless backend on recorded data

Required surface: headless ([LLP 0015](./0015-demo-application-suite.plan.md#headless)).
Prove the backend with seeded schedule + recorded feed ticks and a frozen clock:

- next-north and next-south predictions for a given station and time are exact,
  deterministic values;
- assumed-direction inference matches the SF→South SF rule;
- nearest-station selection from a given lat/lng returns the expected station;
- applying the next recorded feed tick produces a live-query delta that changes a
  train's minutes-away / position in a subscribed headless client;
- when the recorded feed cache is stale, a read/subscription triggers exactly one
  collapsed refresh action and exposes the freshness marker.

Cron and action egress are `expected_missing`. The feed tick is applied by the
test harness, not by a scheduler or outbound fetch.

### Phase 1 — Contract/Exact product surface on recorded data

Required surface: Contract/Exact. Build All Aboard for real over generated
Snapback artifacts, still on recorded data:

- station card with photo + name; next N/S trains and next-three list as
  specified;
- swipe left/right changes station; swipe up/down changes selected train; tap
  toggles direction — each verified through the Exact agent API / structured
  tree;
- geolocation selects the nearest station (with a defined fallback when
  permission is denied);
- walk/bike ETA computed by haversine over the seed coordinates (no Maps API yet);
- train detail shows ordered stops + times and the position indicator.

Live polling and notifications remain gaps. This phase is the real test of
Contract gesture + geolocation binding.

### Phase 2 — Real scheduled refresh

Introduce the Cron subsystem ([LLP 0028](./0028-cron-scheduled-execution.rfc.md)).
A scheduled/demand refresh action advances the data — first by ticking the
recorded feed forward, then (Phase 3) by polling for real. Proves
stale-read-through catch-up, collapsed concurrent refreshes, minute warm-poll
wakeups, durable write → realtime delta on a live cadence, and observable/resettable
run history. The default cadence is one minute so the Cloudflare profile can use a
Cron Trigger wakeup rather than a continuously armed sub-minute Durable Object
alarm.

### Phase 3 — Real egress (live polling + Maps)

Enable action egress: un-deny `fetch` for the refresh/action class and grant it the
`network:fetch` capability (Snapback runs strict, so this is an explicit grant),
plus the secrets seam. Destination scoping is coarse today — either accept an
app-level URL check for v0, or make the small Ibex engine change to enforce a real
per-host allowlist. The refresh action then polls the real Caltrain feed with a
rotating key pool when stale read-through demand or the minute warm-poll asks for
it, and writes `trainStatus` via a mutation; the walk/bike action calls
**OpenRouteService** through a server-side proxy (key in the secrets seam), cached
by (location-bucket, station) to respect ORS's quota — replacing the v0 haversine
estimate. First end-to-end proof of the egress path — by enabling Ibex's existing
`fetch`, not by adding a networking layer.

### Phase 4 — Notifications (future)

"Leave now to walk / bike and still make the train" depends on the Notifications
subsystem plus time/geofence math. Explicitly future per the brief; named here
only so the v1 walk/bike display is understood as the precursor, not the feature.

## Demo manifest sketch

Illustrative `demos/all-aboard/demo.snapback.json` shape (final field names defer
to [LLP 0015](./0015-demo-application-suite.plan.md#demo-model)):

```jsonc
{
  "id": "all-aboard",
  "title": "All Aboard",
  "description": "Caltrain next-train demo: nearest station, next north/south trains, live positions pushed from read-through/minute-refreshed feed data.",
  "targetProfile": "local-dev-sqlite-ibex",
  "systems": ["Demo apps", "Cron", "Realtime", "Data gateway", "Contract/Exact", "Testing"],
  "requiredCapabilities": {
    "storageEngine": "sqlite",
    "runtimeEngine": "ibex",
    "liveQuery": true,
    "capabilityClass": "Online"
  },
  "surfaces": {
    "headless": { "requirement": "required" },
    "contract": { "requirement": "required", "exact": { "gestures": false, "geolocation": true, "image": true } }
  },
  "capabilityGaps": [
    "cron_scheduled_execution",
    "action_egress_denied_in_sandbox",
    "action_secrets_keypool",
    "notifications",
    "offline_schedule_cache",
    "postgres",
    "cloudflare"
  ],
  "temporaryPolicy": {
    "auth": "anonymous read-only; no login",
    "feed": "recorded feed ticks + frozen clock until Phase 3; 60s freshness target for live feed",
    "walkBike": "haversine from coordinates in v0; OpenRouteService via server-side proxy at Phase 3",
    "stationPhotos": "seeded Wikipedia URLs + attribution string per station"
  },
  "notClaiming": [
    "live external polling before Phase 3",
    "notifications",
    "offline/local-first live positions",
    "multi-agency or trip planning",
    "fare payment",
    "high-frequency position scale benchmark"
  ]
}
```

## Acceptance

The first accepted version (Phases 0–1) should pass:

- **Determinism** — with the seed and a frozen clock, next-north and next-south
  minutes-away for each seeded station are exact expected values; re-running
  yields identical results.
- **Direction inference** — device location nearest to San Francisco, 22nd
  Street, Bayshore, or South San Francisco yields assumed direction `south`; any
  station south of South San Francisco yields `north`.
- **Nearest station** — a set of fixture lat/lng points each resolve to the
  expected station.
- **Realtime** — applying the next recorded feed tick pushes a live-query delta
  that updates minutes-away and the position indicator in a subscribed client;
  the durable storage version advances on the refresh mutation (and only then).
- **Read-through freshness** — with a frozen clock, a request/subscription against
  stale `feedRefreshState` triggers one collapsed refresh action, returns the latest
  usable durable answer with an age marker, and then pushes the updated answer when
  the refresh mutation commits.
- **Gestures (Contract)** — swipe left/right changes the station card; swipe
  up/down changes the selected train; a bare tap toggles direction — all asserted
  through Exact's structured tree, not DOM scraping.
- **Train detail** — a selected train shows its ordered stops and times and a
  position indicator consistent with its `trainStatus` row.
- **Walk/bike** — given the seed coordinates, the station card shows the expected
  haversine walking and biking minutes (no Maps API in v0).
- **Honest gaps** — cron, outbound polling, and notifications are reported as the
  manifest's declared capability gaps with their expected diagnostic codes; no
  test path silently fakes a live fetch.

Diary acceptance (lands as `diaries/0008-all-aboard.diary.md` with the build):

- the exact glue inventory and any handwritten wire/secret/gesture code;
- whether Contract gesture and geolocation binding worked over generated
  artifacts or needed a bridge, and where Contract fought the gesture-first UI;
- how introducing read-through refresh, minute Cron, and the outbound-fetch seam
  felt versus the existing durable/ephemeral paths;
- a comparison to building the same app on React + Convex/Supabase plus a transit
  API and a maps SDK, calling out where Snapback reduced or added friction.

## Non-goals

- **Not a trip planner.** No arbitrary origin/destination routing; the line is
  linear and the app is about *next train from here*.
- **Not a schedule browser first.** Browsing later departures is reachable but
  secondary; it must not become the landing surface.
- **No notifications in v1.** Walk/bike time is displayed only.
- **No login / accounts.** Anonymous, read-only.
- **No live external polling before Phase 3.** Recorded data with explicit gaps
  until the seam exists.
- **No always-on sub-minute hosted poller in v1.** A 60s freshness target is the
  default so Cloudflare can use a minute Cron Trigger; sub-minute DO alarms are a
  later product choice, not a baseline requirement.
- **No multi-agency, fares, crowding, or real-time seat availability.**
- **No scale benchmark.** Not a claim that high-frequency position fan-out works
  at load.
- **No offline/local-first live positions.** Online-class; an offline schedule
  cache is a possible later extension, not a v1 claim.

## Open questions

- **Cron LLP** — *resolved:* the scheduled-execution contract is now specified in
  [LLP 0028](./0028-cron-scheduled-execution.rfc.md) (action→mutation path, cadence,
  demand activation, delivery/overlap/retry, determinism, observability, target
  seam). Its own open questions live there; Phase 2 tracks 0028's local scheduler.
- **Read-through refresh policy** — default freshness target is **60s** to stay
  Cloudflare Cron-Trigger-friendly. Still open: whether a local-only or always-on
  deployment should allow a 30s target, whether the first subscriber after a long
  idle should wait briefly for the catch-up refresh or always render stale data
  immediately, and the exact in-flight refresh lock/ledger shape.
- **Feed source** — 511.org GTFS-Realtime vs Caltrain's own feed; rate limits and
  the exact key-pool rotation mechanics; where the key pool is configured and how
  secrets are scoped to the action context (no secrets seam exists yet).
- **Egress enablement shape** — expose `fetch` as the global to the action class
  (simplest), or also permit `require`/import of Ibex's `http`/`https` builtins?
  And does enabling `fetch` for actions also require restoring `setTimeout` for
  retry/backoff?
- **Per-host allowlist** — Ibex enforces only coarse `network:fetch` today (the
  fetch call site drops the URL host), though the capability layer can already
  match `network:fetch:<host>`. Make the small engine change to enforce host
  scoping, rely on an app-level URL check for the demo, or push real per-host
  egress control into the Cron/security LLP?
- **Position model** — store raw `lat/lng` and project onto `orderIndex` for the
  continuum indicator, or store `prevStation/nextStation/progress` directly? How
  to handle express runs that skip stops when drawing "position along the line."
- **Predictions** — materialized by the refresh mutation into a predictions table,
  or computed at query time from `stopTimes` + `trainStatus`?
- **Realtime model confirm** — this Plan recommends durable live-query; is there a
  case for a system-published ephemeral lane for positions that is worth
  revisiting once the [LLP 0026](./0026-ephemeral-backend-abstraction.plan.md)
  backend boundary matures?
- **Walk/bike provider & placement** — *resolved:* v0 uses **haversine** (no API,
  no key, deterministic); the Phase-3 routing upgrade defaults to **OpenRouteService**,
  **proxied through a Snapback action** (key in the secrets seam) and cached by
  (location-bucket, station) to stay under ORS's free quota. **Mapbox** is the
  alternative-of-record (choose it to avoid self-hosting at scale, or if a real map
  view is added). Client-direct ORS stays a labeled throwaway-key shortcut; a Maps
  deep-link is a free turn-by-turn complement. Still open: location-bucket
  granularity and cache TTL.
- **Geolocation UX in Contract** — *resolved (ENG-22795):* the boot request is
  permission-state-first (Permissions API when present): a hard-blocked
  permission skips the doomed `getCurrentPosition` and shows actionable copy,
  a promptable state actively requests, and a `change` listener adopts the
  real location the moment access is granted — including a later site-settings
  flip — with no reload. The location-hint line is a press that re-requests a
  fresh fix from a user gesture (Chrome's quiet prompt and Safari need one).
  The denied fallback stays nearest-to-default (Mountain View), with manual
  station pick always available; both browser suites assert the grant→adopt
  path end to end via a CDP geolocation override.
- **Station photos** — Wikipedia licensing/attribution, hotlinking vs pulling
  through the asset pipeline, and whether drawings are preferable to photos for a
  consistent look.
- **Direction/track naming** — Caltrain's northbound/southbound track naming vs
  the app's north/south; weekend and holiday service days in the seed.

## Implementation

Implemented as `demos/all-aboard/` (2026-06-30, Diary 0008). All four phases ship on
one shared backend; acceptance is machine-checkable: headless 11/11, cron 7/7,
egress 4/4, Contract browser 6/6, with the Rust suite green.

- **Phases 0 + 2 (backend + cron)** landed with essentially no engine work: Cron
  and the action→mutation path were **already implemented** (`crates/snapback/src/cron.rs`,
  commit `1cb6bcb`), so the demo is Cron's first consumer, not its builder. The
  refresh is `defineCron` → action `refreshFeed` → `ctx.runMutation('applyFeedTick')`;
  the realtime delta falls out of the mutation commit. Predictions are computed at
  query/render time from the committed schedule + `trainStatus` delays + now, via a
  shared pure model (`snapback/shared/model.mjs`) used by both surface and tests.
- One engine fix was required for the **demand-activation** story: `disconnect`
  (`crates/snapback/src/local.rs`) dropped only ephemeral state, so a `whileLive` job armed but never
  disarmed. Durable subscriptions for a departed connection are now dropped.
- **Phase 3 (egress)** is an opt-in seam (`SNAPBACK_OUTBOUND_ACTIONS`,
  `crates/snapback/src/runtime.rs` + a matching codegen relaxation): with it on, an **action** keeps
  `fetch`/timers and gets `ctx.secrets`; queries/mutations stay denied; the coarse
  Ibex `network:fetch` is granted only then. Default posture is unchanged. The
  Caltrain product path never calls `fetch` — it runs on the recorded feed — so the
  demo stays deterministic; the seam is proved by a separate probe fixture.
- **Phase 1 (Contract/Exact)** ships as one `app.contract` rendering on web (DOM
  mirror) and native-ready through the Exact kernel host. Corrections vs the plan:
  **swipe gestures do not exist** in Contract (only press/longpress), so navigation
  uses press affordances and `exact.gestures` is a declared gap; **geolocation** is
  wired via `navigator.geolocation` with a default-station fallback, not a Contract
  binding; and the **browser Contract adapter does not push** server-authored deltas
  (it re-queries after local mutations and is single-boundary), so the surface feeds
  live delays into a store the view derives from on a 1s clock. These are recorded in
  `demo.snapback.json` gaps and Diary 0008, not faked.
- **Redesign pass (2026-07-01, Diary 0008).** The surface became the full-bleed
  poster board described under [Station identity](#station-identity): stylized
  full-screen station art (build-time Pillow pipeline), the board typeset on
  baked SVG scrims, a `heroOffset` state that walks the upcoming trains, and the
  [interaction model](#interaction-model) implemented for real on web via
  `gestures.ts` surface glue that drives the declared press affordances (swipe
  station/train, bare-tap flip, swipe-back on sheets, arrow keys). The
  `exact.gestures` Contract-primitive gap **stays open** (LLP 0029 G1) — the
  glue is the interim, deletable stand-in, and the affordances remain the
  portable path for native. One web-host discovery recorded honestly: the Exact
  dev server serves its own HTML shell (the demo's `index.html` is never
  consulted), so `main.ts` injects the page chrome (height chain, dark
  backdrop, touch-action rules) the full-bleed layout needs. Browser acceptance
  grew gesture checks (9/9 with headless 11/11, cron 7/7, egress 4/4 all green).

## Status

Implemented. This Plan defines the All Aboard demo and names **scheduled/demand
refresh** as its primary forcing function — the one genuinely net-new backend
shape it needs — with a phasing that proves the Contract/Exact product surface and
the realtime path on recorded data first. The intended live shape is
Cloudflare-friendly: durable read-through cache, 60s freshness target, and a
demand-armed Durable Object alarm for the hosted proof, with no always-on timer
loop and no warm-poll wakeups when nobody is subscribed. Outbound HTTP is *not* a from-scratch
build: Ibex already implements `fetch`/`http`/`https` behind a strict-mode
`network:fetch` capability that Snapback already installs, so the work is to
un-deny `fetch` and grant network to a refresh/action execution class, plus a
secrets seam — sandbox-policy work governed by
[LLP 0009](./0009-code-execution-security.rfc.md). One honest caveat: Ibex's
per-host egress allowlist is *not* enforced today (the fetch call site drops the
URL host), so a real destination allowlist is a small engine change or an
app-level check, tracked as a known gap. This Plan does not own the Cron subsystem
design; that is specified in [LLP 0028](./0028-cron-scheduled-execution.rfc.md).
The build experience is captured in Diary 0008.
