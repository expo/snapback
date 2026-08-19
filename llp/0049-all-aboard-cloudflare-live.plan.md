# LLP 0049: All Aboard on Cloudflare with live data

**Type:** Plan
**Status:** Implemented
**Systems:** Demo apps, Cloudflare, Deployment, Runtime, Security, Cron, Data gateway, Realtime, Contract/Exact, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-08-01 (0137 a4-f1/a5-f1: §Action Egress dated note —
`ctx.fetch` gained its local implementation on the detached action host,
same lane and egress gate as `ctx.fetchStream`, response value
field-compatible with the coordinator's; descriptor slots stay
hosted-only.) 2026-07-28 (the fast deployment-identity lane now regenerates
All Aboard's intentionally ignored schema/functions manifests from the
tracked source and refuses tracked `artifacts.json` drift before recomputing
identity, making its clean-checkout claim reproducible); 2026-07-25
(deployment-identity freshness is now commit/CI-gated:
`verify-local-proof` and the fast `deployment-identity` CI lane recompute the
committed manifests with `generate-deployment-identity.mjs --check`, so a
landing that changes deploy inputs without regenerating fails at commit time
instead of at the next deploy — see §Deployment-identity freshness gate);
2026-07-12 (tenth pass, ENG-24341–ENG-24369 / ENG-24387–ENG-24388:
the whole-codebase review hardened compiled-seed provisioning, manifest-backed
storage/index enforcement, action abandonment and admission, invocation-scoped
secret capabilities and encoded redaction, recoverable cron leases with
commit-coupled mutation replay, socket-session ownership, atomic subscription
migration/reset and schema rebuild, source-derived deployment identity,
authenticated config status and stdin-only config writes, and rollback-attested
mixed-state deploy bootstrap with a post-secret final health proof;
focused Miniflare and mocked-deploy regressions pin every corrected boundary);
2026-07-11 (ninth pass, ENG-23840 / ENG-23841 / ENG-23626:
operational closeout — a valid Cloudflare account credential was restored and
the rotated admin credential was persisted in OS-backed secure storage before
upload to both proof gateways; the deliberate All Aboard no-subscriber run then
had zero-demand, inactive/disarmed observations bracketing a settled two-hour
pure window whose Adaptive analytics observed no rows and summarized to
zero-estimate Worker requests / Worker execution GB-s / Durable Object requests, with
non-empty controls bracketing the sparse result. Phase 4's
credential blocker, checklist, and follow-up disposition now reflect the
completed proof; status remains Implemented); 2026-07-08 (eighth pass: live
511 success now writes
`liveDepartures` and the deployed proof asserts future rows directly, closing
the false-live-board failure where a live source could still render demo
clock-face trains in the middle of the night; remote acceptance is now 21/21.
Seventh pass, ENG-23643: the deployed URL now loads
in the native Exact hosts — the handwritten Contract `index.html` carries the
`exact:platform-manifest` discovery link (the vite plugin injects it only into
HTML it generates itself, so the macOS host got web HTML with no manifest
pointer and white-screened), the gateway answers `/__exact/*` asset misses
with explicit JSON 404 instead of the SPA index.html fallback, and the remote
acceptance suite walks the native host discovery chain — root HTML → link →
platform manifest → macOS/iOS envelopes → startup sources — plus the agent-endpoint
404 shape, 20/20. Sixth pass 2026-07-07, ENG-23628–ENG-23632: all four
implementation phases built and the plan's product claim EARNED — All Aboard
is deployed live at
https://snapback-all-aboard-proof.ccheever-0f6.workers.dev with real 511 keys
(a two-member pool) and a directions key configured through the guided
`config.set` bulk-activation flow (attested `applied` at generation 1),
host-mediated action egress with both placement slots proven against the real
511 and OpenRouteService APIs, the generated Contract surface served
same-origin and driving `client.action` through the gateway action route, and
the demand-armed alarm warm poll running a real scheduled cycle through
the hardened claimed runner with a live push to a hibernation socket
(targets/cloudflare/test/acceptance.remote.all-aboard.mjs, 16/16; the cadence moved
from 60s to 180s with a transactional one-poll-per-180s upstream budget
shared by cron and manual Refresh, and a 390s LIVE-badge freshness window —
ENG-23642). Named remaining
limits live in the capability manifest (generalized_outbound_actions,
egress_destination_allowlist, calendar_cron_triggers,
http_outbox_poll_fallback, config automation); the long-window idle billing
counters remain LLP 0040's open measurement. Two real-world corrections from
the remote run: actions execute on a dedicated handler Worker (the handler
server chains invocations per isolate, so a slow fetch would have queued
transactional work — the Cloudflare analogue of the local DK-4 fresh-VM
fence), and first-deploy service bindings are circular, so deploy.sh
bootstraps with `services` stripped. Status Accepted → Implemented. Fifth
pass same day, ENG-23627: the five queued
revision decisions ratified — host-mediated fetch with placement slots and
fail-closed `.expose()`, the demand-armed DO alarm superseding LLP 0028's
minute-static-wakeup All Aboard default for this deployment,
keep-notes-plus-app-selector, the secret-carried `SNAPBACK_CONFIG_GENERATION`
attesting activation, and gateway-served same-origin static assets. Charlie
ratified by directing execution of the full implementation set
(ENG-23627–ENG-23632) on this plan as written; recorded by the implementing
session. Status Draft → Accepted; LLP 0028's default-shape wording and the
All Aboard cadence comments corrected in the same change per
§Likely Follow-ups. Fourth pass same day: the four remaining open
questions resolved — OQ1 one-JSON-array-secret pool encoding and OQ6
stage-2-hard-gate ratified by Charlie; OQ2 gateway-Worker binding locus and
OQ5 guided-flow-only `config.set` decided at Charlie's direction on the
session's recommendation; the five revision decisions queued in
§Open Questions remain pending ratification. Third pass same day: GPT-5
cross-family review applied
at the author's direction — see
[reviews/0049-all-aboard-cloudflare-live.gpt-5.md](./reviews/0049-all-aboard-cloudflare-live.gpt-5.md):
the host-mediated fetch decision now owns the source/API migration it actually
requires — All Aboard's handlers today call `.expose()` + ambient `fetch` with
the 511 key in the URL query string, so the host fetch gains secret placement
slots (query-param and header), `.expose()` fails closed on this profile, and
error envelopes are redacted at the coordinator boundary; the
`SNAPBACK_CONFIG_GENERATION` carrier is re-pinned as a secret binding written
last (or bulk-written with the entries) so the attesting activation always
postdates every secret write — interactive `wrangler secret put` alone never
attests; the live commit path is corrected to `applyLiveFeedSnapshot`, with
`applyFeedTick` reserved for recorded/fallback evidence and `routeEstimate`
committing nothing; the alarm-first decision is restated as a proposed
supersession of LLP 0028's minute-static-wakeup All Aboard default, which
0028 and the All Aboard source comments still carry; the gateway now serves
the web bundle same-origin and Phase 2 adds the `client.action` transport the
proof lacks. Second pass earlier same day: Claude cross-family review applied
at the author's direction — see
[reviews/0049-all-aboard-cloudflare-live.claude.md](./reviews/0049-all-aboard-cloudflare-live.claude.md):
warm-poll primitive inverted to demand-armed DO alarm first per LLP 0028's
decision table, with the Cron Trigger fallback's idle wakeups declared against
the LLP 0040 idle-economics claim; host-mediated fetch pinned as the decision
with the handler receiving redacted descriptors only — values never enter the
isolate; config-generation attestation mechanism pinned; Phase 0 decided as
keep-notes-fixture-plus-app-selector; detached action execution, watchdog
parity, cron idempotency, one-alarm dispatcher, and admin-gated manual runs
carried into the phases; LLP 0028 grace-window and LLP 0047 exfiltration
citations corrected. Decisions taken in revision are proposals pending
Charlie's ratification; initial draft earlier same day)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0014, LLP 0015, LLP 0018, LLP 0027, LLP 0028, LLP 0029, LLP 0031, LLP 0036, LLP 0040, LLP 0047, LLP 0048, LLP 0050, Diary 0008, Diary 0012, https://511.org/open-data/transit, https://openrouteservice.org

## Summary

This Plan defines the work required to run the **All Aboard** Caltrain demo on
Cloudflare with its real-data path enabled: 511.org feed secrets, directions
secrets, action egress, and demand-gated warm polling that keeps live train
status fresh while riders are subscribed.

This is not a new secrets design. It consumes
[LLP 0036](./0036-app-secrets-and-config.rfc.md): app source declares config,
actions declare `uses`, app code receives `ctx.secrets` handles only in actions,
and Cloudflare maps to the `deploy-time-binding` backend class. Values live in
Cloudflare Worker secrets/bindings, not in Durable Object SQLite, generated
bundles, logs, diagnostics, or app rows.

This is also not a new Cloudflare architecture. It extends the narrow proof in
[LLP 0040](./0040-cloudflare-narrow-proof.rfc.md) from "one notes app with
query/mutation/live" to "one real demo app with live external data." The target
is still one generated app, one gateway Worker, one coordinator Durable Object
with embedded SQLite, one V8 handler harness, WebSocket hibernation, and an
honest capability manifest for everything still missing.

The product claim this Plan earns is deliberately narrow:

> All Aboard can be deployed to Cloudflare, configured with 511 and directions
> API keys through the platform secret mechanism, warm-poll live train data while
> a live subscription is active, and push the resulting server-authored updates
> to the generated Contract surface without a hand-written pump.

## Motivation

All Aboard is the demo that forced Snapback's local action, cron, egress, and
secrets work ([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md),
[LLP 0028](./0028-cron-scheduled-execution.rfc.md), and
[LLP 0036](./0036-app-secrets-and-config.rfc.md)). The Cloudflare proof now
exercises V8, Durable Object SQLite, hibernating live sockets, and the generated
handler harness, but it does so with a synthetic notes app and explicitly
declares `outbound_actions`, `cron`, and hosted config backends as gaps.

That leaves an important question unanswered: does the Cloudflare target carry
the same useful app shape as the local target, or only the narrow storage/live
core? A live All Aboard deployment is the smallest example that forces the
missing pieces together without pretending to be a complete hosted platform.

The example is useful precisely because it crosses target boundaries:

- **Secrets:** 511 and directions keys are deployment-owned values, declared by
  app source and granted only to the actions that use them.
- **Actions:** external data is fetched outside the transactional query/mutation
  path, then committed through normal mutations so the version and realtime
  contracts stay intact.
- **Cron / warm polling:** the app should refresh while riders are watching, and
  go idle otherwise.
- **Cloudflare economics:** the implementation must not recreate a local polling
  server on Workers. Wakeups, hibernation, and idle behavior remain measurable
  platform facts.

## Scope

In scope:

- deploying the existing All Aboard Snapback app bundle on the Cloudflare proof
  target;
- configuring `caltrainFeed` and `directions` through Cloudflare secrets;
- granting those secrets to `refreshFeed` and `routeEstimate` only;
- enabling controlled outbound `fetch` for actions on Cloudflare;
- migrating the All Aboard action handlers from the local `.expose()` +
  ambient-`fetch` shape onto the host-mediated fetch capability this plan
  chooses (§Action Egress);
- running the `warmPoll` job on Cloudflare while the relevant live query is
  active;
- proving that a warm-poll action can fetch, commit through a mutation, and push
  the resulting live update to the browser;
- updating capability manifests, acceptance tests, deployment docs, and the demo
  diary with honest evidence.

Out of scope:

- multiple Snapback apps per Cloudflare deployment;
- user-uploaded app code or hosted marketplace execution;
- external auth, offline replay, notifications, assets, or Postgres graduation;
- per-user OAuth credentials;
- a general Cloudflare secrets management product beyond LLP 0036's
  `deploy-time-binding` class;
- replacing All Aboard's local acceptance path.

## Governing Constraints

- **Cloudflare rows and versions stay in the coordinator Durable Object.**
  Version allocation, row writes, and journal append remain one
  `transactionSync`, preserving LLP 0007's gap-free visibility contract through
  LLP 0040's target shape.
- **Handlers get no ambient Worker authority.** The handler harness must continue
  to deny free access to Worker env, bindings, storage handles, and ambient
  network. Actions may receive explicit egress and secret capabilities; queries
  and mutations may not.
- **Secrets are deployment config, not app data.** Durable Object SQLite may hold
  app rows, cron state, journals, subscription state, and config status metadata,
  but never secret values. Cloudflare Worker secrets/bindings are the value
  store.
- **Cloudflare secret writes are operator-side.** A running Worker cannot mutate
  its own secret bindings. `config.set` on this profile is guided/operator-side:
  print or run `wrangler secret put`/API operations from the deploy controller,
  then attest application by observing the active runtime generation/status.
- **Cron is a wakeup seam, not a timer loop.** The target may use Cloudflare Cron
  Triggers, Durable Object alarms, or both, but it must not use `setInterval` or
  any always-awake loop that prevents hibernation.
- **All Aboard remains honest without keys.** The app can boot on recorded or
  fallback data, but any surface that shows demo data must say so. The live-data
  claim requires configured keys and evidence from the live path.

## Starting Point (2026-07-07)

Local All Aboard already declares the required configuration:

- `caltrainFeed`: 511.org Open Data API key, pooled, optional, used by the live
  feed refresh action.
- `directions`: OpenRouteService/HeiGIT Directions API key, pooled, optional,
  used by the route estimate action.

The local target has the first-class config store, action-only grants,
redacting secret handles, action egress, cron, and the acceptance suites that
exercise those paths.

Two source facts matter for this plan's egress decision: the All Aboard action
handlers are written in the local values-in-isolate shape —
`ctx.secrets.rotating(…).expose()` plus ambient `fetch`, with the 511 key
riding the URL query string and the directions key riding an `Authorization`
header — and the browser surface invokes both actions through the generated
`client.action` transport.

At plan authoring, the Cloudflare proof had:

- one checked-in notes app bundle, not All Aboard;
- a gateway Worker plus coordinator Durable Object;
- Durable Object SQLite app rows and journal;
- a service-bound V8 handler Worker;
- live WebSocket hibernation and storage-backed subscription rehydration;
- an admin token secret for `/reset` and `/evict`;
- `secretsJson: null` for app handler invocations;
- no action route or egress, no cron runner, no hosted config backend
  implementation, and no static asset serving;
- local Miniflare acceptance and measurement evidence, but no successful
  real-Cloudflare run with the repo owner's current token.

## Target Behavior

### Deployment Shape

The first All Aboard Cloudflare deployment remains a single-app proof:

- gateway Worker routes HTTP, WebSocket, action invocations, and admin
  endpoints, and serves the static web bundle (scheduled events arrive here
  only under the §Warm Polling Cron Trigger fallback);
- coordinator Durable Object owns the app instance, app SQLite tables, journal,
  subscription registry, cron ledger, and version counter;
- handler Worker executes generated All Aboard handlers through the shared V8
  harness and reaches host operations only through the coordinator channel;
- Contract/web surface is served by the gateway Worker and points its
  generated bindings at that same origin (§Realtime And Browser Surface).

The deploy step compiles or copies the generated All Aboard artifacts into the
Cloudflare app bundle. Runtime code hot-load remains a capability gap.

**As-built deploy transaction (ENG-24364 / ENG-24388).** Before changing an
existing Worker, the controller snapshots the latest deployment's complete
version/traffic set. Any later failure restores and re-probes handler and
action-handler first, then switches the gateway last as the compatibility
cutover. A worker confirmed missing before bootstrap is tracked before each
Wrangler attempt (local failure can follow remote activation), re-probed during
cleanup, deleted only when confirmed present, and re-probed absent afterward;
new dependents are removed action-handler → gateway → handler. Ambiguous state
or unprovable rollback is a critical failed-closed result. Each gateway config
carries Cloudflare's version-metadata binding. Wrangler gateway deploy output
provides an exact `Current Version ID`; the controller requires that same id at
100% in the control plane and in live `/health`, so a concurrent operator's
different healthy version cannot be mistaken for this transaction. Legacy
secret put/delete output has no authoritative version id, so any real secret
mutation is followed by a final ordinary gateway deploy (secrets persist) and
that deploy's exact reported id is activated and probed. A no-op removal needs
no extra activation. Only the final exact-version binding/full-health proof
commits a successful deploy.

### Config And Secrets

Cloudflare implements LLP 0036's `deploy-time-binding` backend for this profile.
The app-facing declarations stay the same as local All Aboard.

The deploy controller maps declared entries to Worker secret binding names. The
exact naming should be generated and stable; the first implementation should use
a mechanical, app-scoped form such as:

```text
SNAPBACK_SECRET_ALL_ABOARD_CALTRAIN_FEED
SNAPBACK_SECRET_ALL_ABOARD_DIRECTIONS
```

The binding name is not an app API. App code still asks for
`ctx.secrets.rotating('caltrainFeed')` or `ctx.secrets.rotating('directions')`.

Secret values live on the coordinator/gateway side, not the handler side —
and under this plan's egress decision (§Action Egress: host-mediated fetch)
that is literal, not aspirational. The handler invocation payload for an
action carries **redacted handle descriptors only**: entry names, grant facts
from the function's declared `uses`, set/missing state, member count, and fresh
invocation-scoped opaque capability ids. The immutable handle itself exposes
only its opaque id — never a forgeable entry name or rotation cursor — and the
coordinator resolves it through the active invocation's private capability map
to the actual value from Cloudflare secret bindings only at its own fetch
boundary, when the action passes the handle to the host fetch operation. The
local runtime's values-in-`secretsJson` shape does not port to this profile;
if the scoped-handler-fetch fallback is ever taken instead, values do enter
the isolate and the manifest must say so (§Action Egress).

Capability ids expire with the invocation and cannot be replayed into another
action, including one granted a different entry. Queries and mutations continue
to receive no `ctx.secrets`. A function that asks
for an undeclared entry fails with `SNAPBACK_CONFIG_UNDECLARED`; a declared but
unset entry fails with `SNAPBACK_CONFIG_MISSING`. Status and diagnostics report
names, set/missing state, verification state, and grant relationships only.

Applied-state attestation needs a mechanism this backend does not provide
naturally: every `wrangler secret put` immediately creates and activates a new
Worker version by itself, with no generation counter the runtime can report,
and LLP 0036 D7 makes `applied` an *attested* state, not a hope. Two facts pin
the first implementation:

- **The ordering invariant.** The activation carrying the bumped
  `SNAPBACK_CONFIG_GENERATION` stamp must be the same activation as — or
  strictly later than — every secret write it attests. Observing the runtime
  report generation ≥ N then proves the serving version postdates those
  writes. A generation stamped in an activation that precedes, or floats free
  of, the secret change can attest `applied` falsely; an interactive
  `wrangler secret put` of an entry alone therefore never attests anything.
- **The carrier is itself a secret binding, not a deploy-time var.** The
  deploy controller writes the changed entries and the bumped generation in
  one `wrangler secret bulk` payload (one activation), or as individual
  `secret put`s with the generation stamp written **last**. A `[vars]`-style
  carrier was rejected: vars are replaced wholesale by the next plain
  `wrangler deploy`, which would silently reset the generation, while secret
  bindings persist across code deploys and every write is itself an
  activation. The generation is not sensitive; the secret store is just the
  only write path with the right activation-and-persistence semantics.

The admin-token-gated Cloudflare `config.status` projection reports that generation plus the
declaration hash — and the platform version/deployment identifier when
available, which costs nothing and makes operator diagnosis concrete. The
writer computes `pending` (it staged generation N), and attests `applied`
by observing the runtime report generation ≥ N **and** each requested
declaration's set/member-count state — exactly the 0036 contract, with the
generation ride-along as the Cloudflare-specific carrier. The guided writer
accepts one JSON object from stdin, refuses secret-bearing argv, validates every
name and nonempty string-array pool against authenticated status, and sends the
bulk payload directly to Wrangler. All of
this lands on the gateway/coordinator Worker only; the handler Worker's
deploy carries no app secret bindings and no generation stamp.

**Operator-controller hardening (ENG-24499 / ENG-24501, 2026-07-12).** Both
the deployment transaction and guided config writer now fail closed unless
the repository-local installed Wrangler matches the exact committed
Cloudflare version pin and root lock. They invoke its JS entry directly; no
`npx` installer or ambient executable can share secret stdin or change the
controller mid-transaction. Config's initial status request, Wrangler child,
retry sleeps, and attestation requests consume one overall deadline. Before a
write, expiry is `SNAPBACK_CONFIG_STATUS_UNKNOWN`; after a child starts, expiry
is `SNAPBACK_CONFIG_APPLY_PENDING`, because activation may be remote even when
the bounded local child is killed.

Pool rotation state is coordinator-local durable metadata, and the pooled
value encoding is decided (OQ1, 2026-07-07): **one JSON-array Worker secret
binding per pooled entry**. The user-facing contract stays "pooled entry
rotates"; the array encoding is documented because it shapes
`wrangler secret bulk` payloads (the binding value is a JSON-array string).
The rotation cursor is applied modulo the current member count, so a pool
edit can never strand it out of range, and the read-modify-write race on the
array — two operators editing the pool concurrently — is an accepted risk
while deployments are single-operator; multi-operator use or automated key
acquisition is the revisit trigger.

### Action Egress

Cloudflare actions may use `fetch` only through the action execution class. The
proof must keep the denial tests for queries and mutations: ambient `fetch`,
Worker env, bindings, and storage handles remain unavailable there.

**Dated note (2026-08-01, 0137 a4-f1/a5-f1): `ctx.fetch` is now
target-portable.** The buffered host-mediated fetch designed here for the
Cloudflare coordinator gained a local implementation: the detached action
host serves `host.fetch` on the same execution lane and under the same
`SNAPBACK_OUTBOUND_ACTIONS` gate as `ctx.fetchStream` (whose local leg had
shipped with LLP 0076 while plain `ctx.fetch` dead-ended as an anonymous
unknown host call). The response value is field-compatible with the
coordinator's (`{status, ok, url, bodyText}`, authored URL echoed, the same
1,000,000-byte bound and `SNAPBACK_HOST_FETCH_RESPONSE_*` refusals). The
profile split stands: descriptor placement slots resolve only at the hosted
boundary; the local value-mode profile stages `ctx.secrets` values and
refuses descriptor slots with `SNAPBACK_HOST_FETCH_SLOT_INVALID`, exactly
like the streamed sibling.

**Decision: host-mediated fetch**, with scoped handler fetch as the named
fallback (ratified 2026-07-07, ENG-23627):

- **Host-mediated fetch (chosen):** the handler action calls a host operation,
  passing URL, method, headers, body, timeout, and secret handle descriptors;
  the coordinator resolves descriptors to values, performs the Worker `fetch`,
  redacts diagnostics, and returns the response envelope. This keeps secret
  values and Worker bindings out of the handler isolate entirely and delivers
  the true host-boundary `asBearer()` unwrap LLP 0036 names as an honest gap
  in the local v1 (where it is `expose()` sugar).
- **Scoped action fetch in handler (fallback):** the handler receives an
  action-only fetch capability with secrets already granted and no env/binding
  exposure. Taking this fallback means values enter the isolate; the
  capability manifest must then state plainly that action code with a granted
  secret can exfiltrate it by design — the defense-in-depth honesty LLP 0036
  §Runtime exposure already records for handlers holding values — while
  queries/mutations still cannot. LLP 0047 should gain the same statement for
  the hosted profile as part of that fallback landing.

Host-mediated fetch is not how the All Aboard source works today, and this
plan owns that migration rather than assuming it. The current handlers are
the local values-in-isolate shape: `fetchCaltrainDelays` calls
`ctx.secrets.rotating('caltrainFeed').expose()` and splices the key into the
511 URL **query string** (`api_key=…`), and `routeEstimate` calls `.expose()`
on `directions` and sends the value as an `Authorization` header — both over
ambient `fetch`. A descriptors-only profile cannot run that source unchanged,
so the decision carries four named requirements:

- the host fetch operation accepts secret **placement slots** — at minimum
  query-parameter (511's `api_key`) and header (directions' `Authorization`)
  — and the coordinator substitutes values only at its own fetch boundary;
- All Aboard's action handlers migrate from `.expose()` + ambient `fetch` to
  the action-only host fetch capability with slots;
- on this profile `.expose()` **fails closed** with a coded error (working
  name `SNAPBACK_CONFIG_EXPOSE_UNSUPPORTED`; the final name and handle-API
  shape land in LLP 0036 with the backend) rather than returning an opaque
  placeholder — code that believes it holds a key value must fail loudly,
  not silently carry a token that stopped being a key;
- the host fetch **error envelope is redacted at the coordinator boundary**
  before it re-enters the isolate. Today a failed 511 fetch throws
  `HTTP 401 from <url>` with the key in the URL, and only handler-side code
  scrubs it before the message becomes `feedRefreshState.lastError` —
  durable, live-streamed state. Under host mediation the coordinator does
  the substitution, so the coordinator owns the scrub; the handler-side
  redaction remains as defense in depth, not the only line.

Running the source unchanged is not a neutral choice: it *is* the
scoped-handler-fetch fallback, with that fallback's manifest consequence.

Action execution must also stay off the coordinator's serialization mutex.
LLP 0040's hardening (ENG-23575) serialized every invocation-bearing entry
point behind a coordinator-local mutex; a slow 511 round-trip executed inside
that mutex would stall every query, mutation, and live push on the object. The
Cloudflare action path therefore mirrors the local ENG-23324 pattern
(LLP 0028 §Execution): stage the invocation under the mutex, run the external
fetch outside it, and reacquire per host call and per mutation commit. Action
runs carry wall-clock watchdog parity with the local target
(`SNAPBACK_ACTION_TIMEOUT`-equivalent; LLP 0047's `action_wall_clock_timeout:
Enforced`). The watchdog flips host-owned abandonment before answering: every
later host call is rejected, and a nested mutation rechecks abandonment at its
final synchronous commit boundary inside the coordinator mutex. Production
hides testing-only actions, strips testing budget/destination overrides, and
enforces a bounded per-action public admission rate.

Action commits still flow through mutations. `refreshFeed`'s live success
path commits through `applyLiveFeedSnapshot`, which stamps
`lastSource: '511-siri-stop-monitoring'`; `applyFeedTick` advances the
recorded/fallback feed and must never be presented as live evidence.
`routeEstimate` commits nothing — it returns the estimate to its caller and
declares `writes: []` — so it exercises grants and egress without the
mutation leg. The coordinator must not hold a write
transaction open across external fetch. Destination allowlisting stays with
the egress seam (LLP 0036 §Egress coupling); whatever delta exists between the
local egress posture and this profile's first cut is a named manifest fact,
not a silent difference.

### Warm Polling

All Aboard's `warmPoll` job is demand-gated: it should run only while a live
subscription that needs `liveTrainStatus` is active. LLP 0028 defines the
activation states (`armed`, `inactive:no-demand`, `catching-up`) and a
staleness policy for the first subscriber after idle; it does **not** define a
linger window after the last subscriber departs. If this implementation wants
one (to avoid churn from a rider refreshing the page), that is a new, small
requirement to record back into LLP 0028 — it is not assumed here.

**Decision: the accepted primitive is a demand-armed Durable Object alarm**,
with the minute Cron Trigger as the named fallback (ratified 2026-07-07,
ENG-23627). This is not taste — it is LLP 0028's own decision table
(§Cloudflare: wakeup source vs durable runner): `warmPoll` is demand-gated
*and* dynamically armed, and both of those rows route to DO alarms, because
Cron Triggers are deploy-time static and fire every minute while deployed —
"not zero invocations while deployed," in 0028's words. A permanent minute
wakeup also structurally conflicts with LLP 0040's decisive measurement
("idle with no connections: does the deployment incur any billable usage?")
for a job that by policy has nothing to do while nobody watches.

Stated honestly, this is a **proposed supersession**, not a mere application
of LLP 0028: that document's table also routes minute-compatible demand-gated
jobs that "can tolerate a static wakeup" to Cron Trigger + demand check, 0028
today calls the minute static wakeup "the default All Aboard shape," and the
All Aboard source comments pin `jitter: false` specifically to stay on a
minute Cron Trigger. This plan asserts that LLP 0040's idle-economics
measurement makes zero idle wakeups a *requirement* for this deployment,
which moves `warmPoll` to the table's DO-alarm row. Charlie ratified that
supersession on 2026-07-07 (ENG-23627); 0028's default-shape wording and the
All Aboard cadence comments are corrected in the same change
(§Likely Follow-ups) so no conflicting normative text survives into
implementation.

The staging:

1. **Manual and alarm-only stage:** admin-gated manual run triggers (the same
   `SNAPBACK_ADMIN_TOKEN` POST surface as `/reset` and `/evict`, ENG-23587 —
   never a public run-now route) plus a coordinator Durable Object alarm drive
   `warmPoll` for active subscriptions. Subscribing to `liveTrainStatus` arms
   the alarm only when the durable row belongs to the current authenticated
   socket session; socketless/stale rows cannot create demand, and losing the
   last current subscriber cancels it. Manual run-now is a one-shot action that
   records last-run status without allocating scheduled claim/replay rows. This proves
   action → mutation → live push with zero idle wakeups.
2. **Hardened durable runner stage:** the coordinator claims due runs in
   durable cron state with an expiring ownership lease, executes the action,
   records a terminal outcome, and early-outs cheaply on wakeups with no work.
   A live lease is not completion; an expired nonterminal claim is acquired by
   a new attempt. Delivery is
   at-least-once with the stable idempotency key `(jobName, scheduledAt)`
   (LLP 0028 §Scheduler state) — required here because DO-alarm auto-retry
   re-runs the *whole* action. Each scheduled action's stable key and nested
   mutation sequence therefore reach the mutation commit: the mutation result
   ledger row is written in the same SQLite transaction as app rows/version,
   and a recovery attempt replays that result instead of committing twice.
   At-least-once egress may repeat, but durable app commits do not. Terminal
   claims and their replay rows are pruned together. Any alarm use follows LLP 0014's
   one-alarm-per-object dispatcher rule, which LLP 0040 carried into this
   target shape.

Stage 2 is a hard gate for the live-data claim (OQ6, decided 2026-07-07):
stage 1 may land and demo as a checkpoint, but the §Summary product claim and
the manifest's live-data fact wait for the hardened runner's evidence.

The Cron Trigger fallback may be taken only if real measurements show the
alarm shape's cost profile is worse (re-arm churn, retry behavior) — and
taking it means declaring the per-minute idle invocations as a measured
platform fact in the capability manifest and excluding this deployment from
the no-connection-idle-zero claim. In either shape, no implementation may use
`setInterval` or hold the object awake solely to wait for the next poll.

### Realtime And Browser Surface

The live update path stays ordinary Snapback:

1. browser subscribes to the generated All Aboard live query;
2. coordinator persists the subscription and hibernates the socket when idle;
3. warm polling fetches external data through an action;
4. the action invokes the durable mutation that writes feed state/train rows;
5. the mutation commit appends the journal and fans out affected live queries;
6. the Contract surface receives the update over generated bindings.

The browser surface must not contain a hand-written polling pump to compensate
for Cloudflare target gaps. A small deployment-origin configuration hook is
acceptable — meaning only "which gateway origin do the generated bindings point
at," never a parallel data path; app data flow must remain generated Snapback
bindings.

**Decision (ratified 2026-07-07, ENG-23627): the gateway Worker serves the
built web bundle itself,** through Workers static assets on the same origin as the API
and WebSocket routes, with the API paths taking precedence over asset lookup.
Same-origin removes the CORS surface entirely and keeps the deploy a
one-command story. The named fallback is a separately hosted static bundle
whose generated bindings point at the gateway origin — acceptable for the
proof, but taking it makes the gateway's CORS posture explicit scope instead
of a non-issue.

Same-origin static serving carries one protocol obligation beyond the browser
(ENG-23643): the deployed origin is also what the native Exact hosts open.
The macOS/iOS loaders fetch the root URL, receive the web `index.html`, and
discover the native artifacts through its
`<link rel="exact:platform-manifest">` tag — the vite plugin injects that link
only into HTML it generates, so All Aboard's handwritten `index.html` must
carry it explicitly, pointing at the build-emitted
`/__exact/platform-manifest.json`. And because `/__exact/*` paths are
protocol endpoints, the gateway must never let the static-assets
single-page-application fallback answer them: a miss there returns an explicit
JSON 404 (with a dev-server-only diagnostic for `/__exact/agent/*`, which the
Exact Log Console probes), so web HTML is never misread as a native payload.
The remote acceptance suite walks the same chain the native hosts walk — root
HTML → discovery link → platform manifest → macOS/iOS envelopes → startup
sources — and asserts the agent-endpoint 404 shape.

At plan authoring, the surface also needed an action transport. The generated
client invokes actions as `client.action('refreshFeed', …)` and
`client.action('routeEstimate', …)`; the proof's gateway then exposed `/query`,
`/mutation`, and `/live/stream`, but no action route. Phase 2 added the
action leg alongside egress so browser-originated action calls ride the same
generated bindings as everything else.

## Implementation Plan

### Phase 0: Recorded-data All Aboard on the Cloudflare proof

- **Decision (ratified 2026-07-07, ENG-23627): keep the notes bundle and add a
  deploy-time app selector** that builds either notes or All Aboard. The notes
  proof's Miniflare acceptance is LLP 0040's pinned regression surface. At
  ratification, 0040's own real-Cloudflare acceptance was still open, so
  replacing the bundle outright would have orphaned that evidence. There was
  no selector at plan authoring: the app bundle was hardcoded in the
  coordinator, the handler Worker, the gateway object name, and both wrangler
  configs, so the selector was real (small) work, not a flag flip.
- Port the All Aboard schema, seed, queries, mutations, and live query subset
  needed by the Contract surface.
- Preserve the V8 ambient-denial tests.
- Serve the built Contract web bundle from the gateway Worker (same-origin
  static assets, §Realtime And Browser Surface), with the generated bindings
  pointed at that origin.
- Keep live external data disabled; recorded/fallback data must be labeled.

Exit evidence:

- Miniflare acceptance proves All Aboard query, mutation, initial live snapshot,
  live push from a local mutation, reset/seed, and capability reporting.
- The capability manifest still declares secrets, actions, egress, and cron as
  unavailable or partial for this phase.

### Phase 1: Cloudflare deploy-time secrets backend

- Generate a Cloudflare config binding plan from the app manifest's `config`
  section.
- Extend `targets/cloudflare/deploy.sh` or its replacement to guide or execute the
  secret write flow for `caltrainFeed` and `directions` against the gateway
  Worker only: one `wrangler secret bulk` payload carrying the changed
  entries plus the bumped `SNAPBACK_CONFIG_GENERATION`, or individual
  `wrangler secret put`s with the generation stamp written last
  (§Config And Secrets).
- Add config status for Cloudflare that reports declarations, missing/set state,
  grant relationships, and active config generation without exposing values —
  the generation carried by the `SNAPBACK_CONFIG_GENERATION` stamp, plus the
  platform version/deployment identifier when available
  (§Config And Secrets), so the writer can attest `applied` per LLP 0036 D7.
- Construct action-only grant entries in the coordinator from Worker bindings
  and declared `uses` — set/member facts plus fresh invocation-scoped opaque
  capability ids; never values or a forgeable name/cursor handle. Resolve ids
  only through the active invocation's private map (§Config And Secrets).
- Keep queries and mutations secret-free.

Exit evidence:

- A Cloudflare/Miniflare test shows a granted action can observe a redacted
  handle and a missing configured value produces `SNAPBACK_CONFIG_MISSING`.
- The handler invocation payload for a granted action contains no secret
  value — descriptors only, asserted by test, not by convention.
- Authenticated config status refuses public reconnaissance, and a `config.set`
  walk-through accepts secret pools only over stdin and reaches `applied` via
  the generation stamp plus requested declaration member state: the
  guided flow reports `pending` with the staged generation, the
  generation-bearing activation lands with or after every entry write, and
  status attests the new generation after activation. An entry write with no
  subsequent (or combined) generation-bearing activation stays `pending` —
  asserted by test, not convention.
- `.expose()` on a granted handle fails closed with this profile's coded
  error (§Action Egress); no code path returns a raw secret value inside the
  isolate.
- A query and a mutation in the same app cannot access `ctx.secrets`.
- A destructive reset does not clear configured secrets.
- Logs, errors, status, inspect, and generated files do not contain configured
  test key material.

### Phase 2: Cloudflare action egress

- Add action execution mode to the Cloudflare coordinator/handler invocation
  path, staged under the serialization mutex but executed off it, with host
  calls reacquiring per call (§Action Egress, the ENG-23324 pattern).
- Implement host-mediated fetch (the §Action Egress decision): descriptors
  unwrap to values only at the coordinator's fetch boundary, placement slots
  cover query-param and header secrets, and every error envelope is redacted
  before it re-enters the isolate.
- Migrate the All Aboard action handlers off `.expose()` + ambient `fetch`
  onto the host fetch capability (§Action Egress) — the 511 query-string
  placement and the directions header placement are both in scope.
- Add the gateway action route and wire the generated `client.action`
  transport to it (§Realtime And Browser Surface).
- Enforce wall-clock timeout and structured failure for action execution
  (watchdog parity with the local `SNAPBACK_ACTION_TIMEOUT`).
- Ensure no Durable Object transaction is held while external fetch is in
  flight.
- Route `refreshFeed` and `routeEstimate` through the Cloudflare action path.

Exit evidence:

- A configured `caltrainFeed` key reaches a mocked 511-compatible endpoint in
  Miniflare — substituted into the `api_key` query parameter at the
  coordinator boundary — and commits through `applyLiveFeedSnapshot` with
  `lastSource: '511-siri-stop-monitoring'`; a run that falls back to
  `applyFeedTick` does not satisfy this item.
- A configured `directions` key reaches a mocked directions endpoint —
  substituted into the `Authorization` header at the coordinator boundary —
  and returns the expected route estimate (`routeEstimate` declares
  `writes: []`; there is no commit leg to assert).
- A generated-client `client.action` call reaches the gateway action route
  end to end for both `refreshFeed` (manual trigger) and `routeEstimate`.
- A deliberately slow action fetch does not block a concurrent query,
  mutation, or live push on the same coordinator.
- Query/mutation ambient fetch remains denied.
- Error text for 401/429/network failures is actionable and key-redacted at
  the coordinator boundary: a forced 401 whose upstream error embeds the
  resolved URL reaches the handler, the durable `feedRefreshState.lastError`
  row, logs, and status JSON with the `api_key` value already scrubbed.

### Phase 3: Warm polling on Cloudflare

- Persist cron job state and activation state in the coordinator object.
- Arm `warmPoll` only while the live query activation policy is satisfied:
  subscribe arms the DO alarm, last-unsubscribe cancels it (§Warm Polling).
- Add the admin-gated manual run trigger on the existing `SNAPBACK_ADMIN_TOKEN`
  surface, then the hardened durable runner: claim-by-idempotency-key
  `(jobName, scheduledAt)`, at-least-once, one-alarm-per-object dispatcher.
- Record the cron ledger fields the local target exposes: last run, next run,
  trigger, outcome, duration/failure where available.
- Terminal claim state, last-run summary, nominal advance, and terminal-history
  pruning commit in one Durable Object SQLite transaction. The post-terminal
  fault seam must roll all of them back together (ENG-24500).

Exit evidence:

- With an active live subscription, a scheduled warm-poll run fetches, commits,
  records the ledger, and pushes a live update to the browser.
- With no active live subscription, no alarm is armed: the idle deployment
  takes zero warm-poll wakeups (or, under the declared Cron Trigger fallback,
  the wakeup early-outs without fetching and the idle invocation rate is
  recorded as a platform fact).
- A duplicate wakeup or alarm retry for an already-claimed slot does not
  double-fetch or double-commit.
- Eviction/rehydration does not lose subscription activation, armed-alarm
  state, or cron ledger state.
- The implementation uses no interval timer and remains compatible with
  WebSocket Hibernation.

### Phase 4: Real Cloudflare acceptance and measurements

**Historical prerequisite — satisfied:** at drafting time this phase, and
LLP 0040's then-open decisive evidence, was blocked on a valid Cloudflare API
credential for the repo owner's account. That prerequisite was first satisfied
for the 2026-07-07 implementation run. A later credential revocation and an
unpersisted admin-token rotation blocked only operational reruns, tracked as
ENG-23840; they did not undo the construction evidence. On 2026-07-11 the
account credential was restored and a newly rotated admin credential was
persisted safely before upload to both proof gateways, reopening both admin-gated and analytics
paths. The deliberate run below closes the remaining proof residue. Phases
0–3 retain their Miniflare regression surface, and the live-data claim remains
grounded in real Cloudflare evidence rather than that surface alone.

- Deploy handler, gateway (carrying the static web bundle), Durable Object
  migration, and secrets to a real Cloudflare account (plus the Cron Trigger
  only if the §Warm Polling fallback was taken).
- Run remote acceptance against the deployed URL.
- Capture cold start, mutation, live update, warm-poll, eviction/rehydration,
  connected-idle, and no-connection-idle evidence.
- Update the capability manifest with actual supported/unsupported facts.
- Update the All Aboard and Cloudflare diaries with the concrete build and
  deploy experience.

Exit evidence:

- Remote acceptance proves live 511 refresh with key-redacted diagnostics.
- Remote acceptance proves directions key usage or records the remaining
  directions gap explicitly.
- Billing/usage evidence distinguishes no-connection idle, connected hibernating
  idle, and scheduled wakeups.
- The generated capability manifest no longer declares `outbound_actions` and
  `cron` as blanket gaps for the All Aboard Cloudflare profile; any remaining
  partial limits are named.

#### Phase 4 operational closeout evidence

The ENG-23840 credential repair exposed no value or credential location in the
repository: the account credential was restored, and the rotated admin
credential was persisted in OS-backed secure storage before it was applied to
both proof gateways. That restored the operator path needed for ENG-23841.

The deployed All Aboard fixture was reset, then five status observations at
`2026-07-11T23:32:13Z`, `23:32:18Z`, `23:32:23Z`, `23:32:33Z`, and
`23:32:44Z` all reported zero demand. The final observation is the official
reset/disarm boundary. The pure no-subscriber interval ran from
`2026-07-11T23:37:44Z` through `2026-07-12T01:37:44Z`; a post-window probe at
`2026-07-12T01:39:47Z` still reported `inactive:no-demand`, `demand: 0`,
`nextRun: null`, and `lastRun: null`. No subscriber-driven re-arm or scheduled
run was observed or recorded.

After analytics ingestion had settled, the controls read at
`2026-07-12T02:28:06Z` and the final quiet re-read at
`2026-07-12T02:43:38Z` returned `errors: []`. The raw
`workersInvocations`, `durableObjectInvocations`, `durableObjectPeriodic`, and
`durableObjectStorage` rows were all empty. The request datasets summarized to
**0 estimated Worker requests / 0 estimated Worker execution GB-s / 0 estimated Durable
Object requests** for the quiet interval, while the account-wide periodic query
observed 0 µs active time. Sparse absence supports this observed-zero estimate
because non-empty controls bracketed it: the
pre-window control reported 11 Worker requests, 0.240013125 GB-s, and 2,675
estimated Durable Object requests; the post-window control reported 3 Worker
requests, 0.2347815 GB-s, and 245 estimated Durable Object requests; across the
script-attributed dataset union those controls included
all three expected All Aboard identities: gateway, handler, and action handler.
Worker controls covered the gateway; Durable Object request controls supplied
the three-script coverage across that union. Cloudflare's Adaptive datasets may
be sampled, and the empty quiet rows carry no sample interval or confidence
data, so this is not an absolute event-absence or invoice guarantee. The
`durableObjectPeriodic` and `durableObjectStorage` datasets have no script
identity and remain account-wide; storage also had no positive control, so its
empty array is telemetry absence, not evidence that durable bytes disappeared.
Together the controls establish the correct account/filter and a settled
ingestion path for the observed-zero estimate. The
[machine-readable closeout artifact](../targets/cloudflare/generated/measurements.remote.idle.2026-07-12.json)
preserves the status observations, window boundaries, raw dataset rows,
summary, and controls. This closes ENG-23841 and the proof residue in
ENG-23626; it complements, rather than rewrites, the earlier watched-window
observation where demand correctly kept the alarm armed (LLP 0028
§Scale-to-zero tension; LLP 0050 §All Aboard no-subscriber idle evidence).

## Acceptance Checklist

The implementation completed against this checklist. An agent can run or
inspect evidence for each item:

- **App deployed:** the Cloudflare target serves All Aboard, not the notes proof.
- **Secrets configured:** `caltrainFeed` and `directions` can be set through
  Cloudflare Worker secrets/bindings, with no values in repo files, generated
  bundles, app rows, logs, or status JSON.
- **Grants enforced:** `refreshFeed` receives `caltrainFeed`; `routeEstimate`
  receives `directions`; unrelated actions, queries, and mutations do not.
- **Egress scoped:** action fetch works with secret values injected only at
  the host boundary — query-param and header placements both proven;
  query/mutation fetch remains denied.
- **Actions reachable from the surface:** generated `client.action` calls
  reach the deployed gateway's action route; the app surface contains no
  hand-rolled action HTTP.
- **Live feed works:** a 511 response causes durable train/feed rows to update
  through the live-snapshot mutation path (`applyLiveFeedSnapshot`,
  `lastSource: '511-siri-stop-monitoring'`), writes `liveDepartures` rows with
  real predicted departure times, and pushes to a live subscriber; recorded-tick
  commits do not satisfy this item, and a live 511 snapshot with no
  station-mappable visits must show no live trains rather than demo schedule
  rows.
- **Directions works:** a route estimate can use the directions key, or a
  declared remaining gap explains why this did not land in the same slice.
- **Warm polling works:** active live subscribers cause `warmPoll` to run on
  the declared cadence (180s since ENG-23642; originally proven at 60s)
  through the stage-2 hardened durable runner — stage 1 (manual + alarm-only)
  does not earn this item (OQ6); no active subscribers do not cause external
  fetch, and cron + manual Refresh together never exceed one upstream 511
  poll per 180s window (the transactional claimFeedPoll budget).
- **Idle wakeups are honest:** the alarm shape shows zero warm-poll wakeups
  with no subscribers, or the declared Cron Trigger fallback's idle invocation
  rate is measured and named in the manifest — never silently folded into the
  no-connection-idle claim. The accepted alarm shape's direct deployed proof
  is recorded in §Phase 4 operational closeout evidence.
- **Hibernation preserved:** sockets are accepted with WebSocket Hibernation, and
  subscription state survives object wake/rehydration.
- **No silent product claim:** recorded/fallback data remains visibly labeled;
  live data is labeled live only after a real external snapshot commits.
- **Remote evidence captured:** real Cloudflare runs prove the live path and
  record the controlled two-hour no-subscriber settled-analytics observation;
  the claim does not rest on Miniflare.
- **Native static discovery works for macOS and iOS:** the served HTML carries
  the `exact:platform-manifest` discovery link, the manifest → envelope →
  startup chain loads for both targets with native content types, and
  `/__exact/*` misses answer JSON 404 rather than the SPA HTML fallback
  (ENG-23643; covered by the remote acceptance suite's discovery-chain checks).

As of the 2026-07-12 operational closeout, no checklist residue remains:
ENG-23840 restored the operator path, ENG-23841 supplied the direct idle→zero
window, and ENG-23626 can close without changing this Plan's Implemented status.

## Capability Manifest Changes

The Cloudflare All Aboard profile should distinguish three facts:

- `cloudflare-do-sqlite-v8` narrow proof support: query/mutation/live with no
  actions or cron;
- All Aboard recorded-data support: app deployed with generated surface and live
  local writes, but no live egress;
- All Aboard live-data support: action egress, deploy-time secrets, and
  warm-poll wakeups enabled for this app.

The manifest should avoid a global "Cloudflare supports all outbound actions"
claim until the action egress contract is generalized beyond All Aboard's
fetches. It can truthfully say the target supports the `refreshFeed` and
`routeEstimate` action shapes this Plan proves — which, after the
§Action Egress migration, means exactly the two secret placements those
actions exercise, query-param and header — with named gaps for host-bound
fetch helpers, destination allowlists, non-secret config entries, acquisition
automation, and multi-app hosted execution.

## Open Questions

No decision in this plan remains pending. The five decisions the review
revisions pinned were ratified on 2026-07-07 (ENG-23627) — Charlie ratified
by directing execution of the full implementation set (ENG-23627–ENG-23632)
on this plan as written — each keeping its named fallback: host-mediated
fetch with placement slots and fail-closed `.expose()` (§Action Egress); the
demand-armed DO alarm, superseding LLP 0028's minute-static-wakeup All Aboard
default for this deployment (§Warm Polling); keep-notes-plus-app-selector
(Phase 0); the secret-carried generation stamp written last as the attesting
activation (§Config And Secrets); and gateway-served same-origin static
assets (§Realtime And Browser Surface). The numbered questions below are all
resolved: 1 and 6 ratified by Charlie on 2026-07-07, 2 and 5 decided the same
day at Charlie's direction on the session's recommendation, and 3, 4, and 7
decided in the review revisions and ratified with the set above; each
strikethrough entry records its resolution.

1. ~~Secret binding encoding for pools.~~ **Decided 2026-07-07 (Charlie): one
   JSON-array Worker secret per pooled entry.** Easier rotation state and
   local parity, and the mid-incident "add a second key" stays a single
   `wrangler secret bulk` edit. The concurrent read-modify-write race on the
   array is accepted for now — single-operator deployments; multi-operator
   use or automated acquisition is the revisit trigger — and the rotation
   cursor applies modulo the current member count so pool edits cannot
   strand it. See §Config And Secrets.
2. ~~Where should platform secret bindings live?~~ **Decided 2026-07-07 (at
   Charlie's direction, on the session's recommendation): on the gateway
   Worker.** The anticipated awkwardness never materialized: the Coordinator
   Durable Object class is defined in the gateway Worker script, so the DO's
   env *is* the gateway env and the host fetch boundary reads bindings
   directly; the service binding to the handler Worker carries invocation
   payloads (descriptors only), and `wrangler.handler.jsonc` declares no
   bindings beyond its HOST route — asserted by the ambient-denial tests.
3. ~~Host-mediated fetch versus scoped handler fetch.~~ **Decided in the
   2026-07-07 review revision (ratified 2026-07-07, ENG-23627):**
   host-mediated fetch,
   with scoped handler fetch as the named fallback and its honesty
   consequence stated — see §Action Egress.
4. ~~Cron Trigger versus DO alarm as the accepted warm-poll primitive.~~
   **Decided in the 2026-07-07 review revision (ratified 2026-07-07,
   ENG-23627):**
   demand-armed DO alarm, per LLP 0028's decision table and LLP 0040's
   idle-economics claim; the Cron Trigger fallback requires declaring its idle
   wakeups — see §Warm Polling.
5. ~~How much of `config.set` is productized on Cloudflare now?~~ **Decided
   2026-07-07 (at Charlie's direction, on the session's recommendation): the
   minimum — the guided deploy-controller flow plus status attestation.**
   The Phase 1 walk-through is the productization bar. A richer CLI/API
   driving the Cloudflare API is deferred until a second hosted consumer or
   real operator pain forces it, so no automation gets built on the
   attestation flow before it has been proven end to end once.
6. ~~Is stage 2 a hard gate for the live-data claim?~~ **Decided 2026-07-07
   (Charlie): yes.** Stage 1 may land and demo as a checkpoint, but the
   §Summary product claim and the manifest's live-data fact wait for the
   hardened durable runner's evidence — see §Warm Polling and the acceptance
   checklist.
7. ~~Where is the browser surface served from?~~ **Decided in the 2026-07-07
   GPT-5 review revision (ratified 2026-07-07, ENG-23627):** the gateway
   Worker serves
   the built web bundle through same-origin static assets, API routes taking
   precedence; a separately hosted bundle pointing at the gateway is the
   named fallback and makes the CORS posture explicit scope — see §Realtime
   And Browser Surface.

## Follow-up disposition

- **Completed:** [LLP 0040](./0040-cloudflare-narrow-proof.rfc.md) records the
  app selector and the notes proof's role as the pinned regression fixture.
- **Completed:** [LLP 0036](./0036-app-secrets-and-config.rfc.md) records the
  Cloudflare `deploy-time-binding` backend, JSON-array pool encoding,
  generation attestation, placement-slot host-boundary unwrap, and
  profile-scoped fail-closed `.expose()` behavior.
- **Completed:** [LLP 0028](./0028-cron-scheduled-execution.rfc.md) records the
  ratified demand-armed-alarm supersession, corrected 180-second cadence, and
  both the earlier demand-armed observation and this Phase 4 direct
  no-subscriber idle→zero evidence. No linger window was introduced, so that
  conditional requirement never fired.
- **Not triggered:** [LLP 0047](./0047-hosted-execution-limits.rfc.md) needs the
  granted-secret exfiltration rider only if the scoped-handler-fetch fallback
  is taken; this implementation retained host-mediated fetch.
- **Completed:** Diary 0008 and Diary 0012 carry the All Aboard build,
  deployment, measurement, and operational-closeout experience.

## Deployment-identity freshness gate (2026-07-25)

The source-derived deployment identities
(`targets/cloudflare/generated/deployment-identity.<app>.json`, regenerated by
`node targets/cloudflare/scripts/generate-deployment-identity.mjs`) were originally
enforced only at deploy time: `targets/cloudflare/deploy.sh` runs
`scripts/cf-check-compat`, which recomputes the identities and refuses to
deploy on drift. That placement punished the wrong commit — a landing that
changed deploy inputs (bundled Worker sources, the All Aboard schema manifest,
wrangler/compat configs) without regenerating passed everything at commit time
and silently made main un-deployable; the next unrelated deploy then failed.
This happened twice on 2026-07-25 alone.

Freshness is now commit/CI-gated: `scripts/verify-local-proof` runs
`node targets/cloudflare/scripts/generate-deployment-identity.mjs --check` with the
generated-artifact drift gates, and the dedicated fast lane
`.github/workflows/deployment-identity.yml` first runs All Aboard codegen with
its declared outbound-action generation flag, refuses any change to the
tracked generated `artifacts.json`, and then runs the same `--check` on every
push/PR without submodules, Hermes, or credentials. That materialization is
required because the Worker imports the full schema/functions manifests while
those derived files are intentionally ignored. The identity generator hashes
the recreated bytes but excludes its own identity output, so the check is
clean-checkout reproducible and not self-referential. The offending commit
therefore fails within minutes instead of the next deploy. The deploy-time
refusal in `cf-check-compat` remains as the last-line guard.
