# LLP 0143: Expo push-notification seam

**Type:** RFC
**Status:** Draft
**Systems:** Notifications, React/Expo, Actions, Auth, Secrets and config,
Deployment, Testing, Documentation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-01 (initial draft, commissioned as ballot item 5 from
the LLP 0137 Track B findings; direction decided by the author the same
day: an integration seam to Expo's push service — option (a) — not a
first-class Snapback delivery capability)
**Related:** LLP 0000, LLP 0027, LLP 0028, LLP 0036, LLP 0045, LLP 0049,
LLP 0053, LLP 0055, LLP 0064, LLP 0070, LLP 0102, LLP 0137,
issues/20260801-0137-a4expo-f1-no-mobile-push-boundary.md,
issues/20260801-0137-a4-outbound-notification-effects-unauthorable.md,
issues/20260728-guide-gap-assets-and-notifications-capability-rows.md

## Summary

A Snapback app on a phone has no way to say "tell my guests." The LLP
0137 A4 Expo arm pinned the gap precisely (finding `a4expo-f1`): the
public closure has no device-token registration surface, no push
integration or mention anywhere in the guide, and the generated
capability manifest ships `notifications: false`. The Track B receipt
check `EXPO-09-PUSH` exists solely to force this fact into the open, and
today its only honest answer is an explicit GAP.

This RFC designs the decided remedy: an **integration seam to Expo's
push service**, not a first-class Snapback delivery capability. Expo
already operates the hard half — APNs and FCM credentials, transport,
fan-out — behind one HTTP API that Expo apps get device tokens for with
one call. Snapback's half is the part that matches its existing
differentiators: **custody** (push tokens are bearer-shaped secrets that
must never sit in app-readable rows), **authorization** (who may send,
to whom, under which config grant), and **honest receipts** (what was
handed to Expo, when, for which token identity — never a delivery
claim).

The seam is three pieces:

1. a platform-owned **device-token registry** written from the client
   (`expo-notifications` token in, principal + installation custody
   inside, retirement wired to logout/terminal auth and to Expo's
   `DeviceNotRegistered` receipts);
2. a **send lane for actions** (`ctx.push.send`) that resolves
   principals to tokens inside the host, posts to the Expo push API over
   the landed `ctx.fetch`/`host.fetch` egress seam under a declared
   config grant, and never exposes token bytes to handler code; and
3. a **handoff ledger** in Snapback's honesty-surface style: per-send
   attempt rows recorded at time T with token identity and dedupe key,
   upgraded by Expo's two-stage ticket/receipt protocol, with terminal
   facts named for what they are (`handed-to-expo`, `expo-accepted`,
   `expo-error`, `ambiguous`) and an explicit never-claims list
   (delivery, display, read, OS permission state).

LLP 0045 (notifications outbox) remains the owner of the eventual
first-class notifications capability; its first slice is email-first and
explicitly defers the push device-token lifecycle. This seam is the
mobile-shaped slice designed to be absorbable into that outbox later:
the ledger shape here is chosen so 0045's durable intent lifecycle can
lift it without a second migration.

## Motivation

- **The product moment is load-bearing and dead.** The A4 contract's
  "tell my guests" leg failed on web (`a4-f1`: outbound effects
  unauthorable on packaged 0.1.7 — since fixed on main at `117dcae2`)
  and is doubly dead on mobile (`a4expo-f1`): even with the egress fix,
  there is no token story, no provider integration, and no hosted relay
  (`a1expo-f5`). The A4 Expo diary's verdict named this one of the two
  walls between the carrier and shippability.
- **The reference bar is table stakes elsewhere.** Firebase Cloud
  Messaging ships token registration, send APIs, and delivery fan-out as
  documented core mobile features; the frozen 0102/0137 evidence treats
  push as an expected mobile capability, not an extension.
- **The receipt check already exists.** `EXPO-09-PUSH` in the Track B
  receipt manifest demands "push-notification boundary or explicit GAP"
  for every A4 Expo arm. This RFC defines what a non-GAP answer looks
  like.
- **The pieces this seam composes with have landed.** The
  `ctx.fetch` → `host.fetch` action egress seam is in the runtime
  (src/runtime.rs, LLP 0049 §Action Egress); declared config grants
  exist (LLP 0036 `uses` + `ctx.secrets`); deferred and scheduled sends
  have owners (LLP 0070 `runAfter` first slice, LLP 0028 cron actions);
  client terminal-auth facts have a recorded pattern
  (`authTerminalStatus`/`subscribeAuthTerminal` in the packaged client);
  and LLP 0053 owns authorization invalidation semantics that token
  retirement must respect.

## Current state (as built)

- `schemas/capability.manifest.local-dev-sqlite-ibex.json` reports
  `notifications: false`; the capability index row
  `backend.notifications` is design-only, owned by LLP 0045, with an
  explicit GAP entry.
- The guide's mobile pages (`clients/react-expo.md`) and the closure
  contain no push, APNs, FCM, or `expo-notifications` mention.
- Apps CAN, on current main (post-`117dcae2`), author the naive bridge
  themselves: an action `ctx.fetch` POST to
  `https://exp.host/--/api/v2/push/send` with tokens stored in an
  ordinary app table. Nothing stops this; nothing makes it safe. Token
  rows in app tables are readable wherever app queries reach, survive
  logout, and acquire no retirement on `DeviceNotRegistered`. The A4
  arms' `notifyIntents`/`notifyAttempts` ledgers are exactly this
  scaffolding "around a boundary that does not exist" (a4expo-f1).
- The Expo surfaces this seam integrates, cited as they actually are:
  - `expo-notifications` on the device:
    `getExpoPushTokenAsync({ projectId })` returns an
    `ExponentPushToken[...]` string (an EAS project id is required in
    current SDKs); `requestPermissionsAsync()` owns the OS permission
    prompt; neither is a Snapback surface and this RFC does not wrap the
    permission flow.
  - Send: `POST https://exp.host/--/api/v2/push/send` accepts one
    message or an array (up to 100 per request) of
    `{ to, title, body, data, ... }` and returns per-message **tickets**
    (`{ status: "ok", id }` or `{ status: "error", details }`). An
    optional `Authorization: Bearer <access token>` header applies when
    the Expo account enables enhanced push security.
  - Receipts: `POST https://exp.host/--/api/v2/push/getReceipts` with
    `{ ids: [...] }` returns per-ticket **receipts** — `ok` means Expo
    handed the message to APNs/FCM; `error` carries
    `details.error` codes such as `DeviceNotRegistered`,
    `MessageTooBig`, `MessageRateExceeded`, `InvalidCredentials`.
    `DeviceNotRegistered` is the documented signal to stop using a
    token.
  - Neither tickets nor receipts ever report device delivery, display,
    or read. That boundary is Expo's, and this seam inherits it
    honestly rather than papering over it.

## Design

### D0. The decided frame: seam, not capability

Option (a), decided 2026-08-01: Snapback integrates Expo's push service;
it does not build first-class push delivery. Reasons recorded:

- Expo's service already abstracts APNs/FCM credential custody and
  transport for exactly the audience Snapback's Expo carrier serves.
- Snapback's leverage is custody, authorization, and receipt honesty —
  the parts the naive app-authored bridge gets wrong — not delivery
  infrastructure.
- The hosted gap (`a1expo-f5`) makes first-class delivery premature:
  there is nowhere production-shaped for Snapback-owned delivery to run.
- LLP 0045 already owns the eventual first-class boundary; a competing
  capability would fork the design. This seam is scoped to be absorbed.

Everything below is inside that frame.

### D1. Device-token custody

**Tokens are bearer-shaped secrets.** Anyone holding an Expo push token
can address that device (modulo the account's enhanced-security
setting). They therefore never enter ordinary app tables.

- A platform-owned **push-token registry** (working name
  `pushTokens`), keyed by `(principal, installation)`:
  - written only through a dedicated client surface
    (`client.push.registerToken(token)` → a host-mediated registration
    op), never by app mutations;
  - readable by **no** query surface, generated or JS — the registry has
    no result contract; `ctx.push.send` resolves it host-side;
  - `installation` identity is the client-store identity the packaged
    client already mints (the RQS/client-store id), so one principal on
    two devices holds two rows and logout on one device retires one
    (open question 2 pins the exact identity).
- **Retirement lanes:**
  - explicit unregister (`client.push.unregisterToken()`);
  - terminal auth loss: the client records the terminal fact at the
    `handleTerminalAuthLoss` choke point (`authTerminalStatus`
    pattern); server-side, session logout/invalidation (LLP 0053)
    retires the `(principal, installation)` rows minted under that
    session's custody;
  - provider-driven: a `DeviceNotRegistered` receipt retires the token
    row and annotates it with the receipt identity (D3);
  - re-registration after retirement is an ordinary insert — token
    registration is idempotent per `(principal, installation)` with
    last-write-wins on the token bytes.
- Token bytes at rest are deployment-custody data, stored outside seed
  artifacts and export surfaces; `snapback` operator inspection prints
  registry cardinalities and retirement facts, never token bytes (the
  config `status` discipline from LLP 0036 applied to tokens).

### D2. The send lane

Sends happen **from actions**, composing with the landed egress seam —
but apps do not hand-roll the Expo POST, because that would require
handing them token bytes.

- `ctx.push.send({ to, title, body, data?, dedupeKey })` where `to`
  names **principals** (or a declared audience shape, e.g. "all
  registered installations of these principals"), never raw tokens.
  The host resolves principals → tokens from the registry, chunks into
  ≤100-message Expo requests, and performs the POST over the same
  `host.fetch` boundary actions already use — so the deployment's
  egress opt-in (`SNAPBACK_OUTBOUND_ACTIONS`) and the action wall-clock
  watchdog govern it unchanged.
- The Expo access token (enhanced push security) is a declared config
  entry (working name `expoPushAccessToken`, `required: false`) granted
  to the seam via the action's `uses` — LLP 0036 custody, redacting
  handles, never in source or seed.
- **Authorization:** `ctx.push.send` is available only inside actions
  (and cron-run actions), inheriting the action's server-resolved
  authority; the app's own role gates (the A4 pattern: a nested
  mutation's `requireRole` before the send) remain the product-level
  policy. The seam adds one platform rule: a send may address only
  principals the deployment knows — there is no arbitrary-token spray
  surface.
- **Deferred and scheduled sends** compose by construction: LLP 0070's
  `runAfter` targets actions, LLP 0028's cron targets actions, and this
  is an action-side surface. An RSVP-deadline reminder is a cron action
  calling `ctx.push.send`; a "send in an hour" is `runAfter`.
- `dedupeKey` is required. One key = at most one handoff attempt chain
  (D3); retries under the same key are attempt-seq increments, matching
  the A4 arms' ledger idiom and Expo's own guidance to retry
  server-side errors without duplicating messages.

### D3. The handoff ledger (receipts and honesty)

Expo's protocol is two-stage and this seam records both stages without
ever inflating them:

- **Attempt row at time T** (the moment of the Expo POST): dedupe key,
  attempt seq, target token identities (as registry row ids / digests —
  not token bytes), message-size class, and the request outcome:
  per-message ticket `{ok, id}` or ticket error. State:
  `handed-to-expo` (tickets held) or `failed` (transport/4xx — safely
  retryable) or `ambiguous` (no response — the A4-10 discipline:
  never silently failed, never claimed sent).
- **Receipt upgrade:** a bounded poll (the cron machinery LLP 0045
  already pins for its runner; suite-driven tick in tests) calls
  `getReceipts` for held ticket ids and upgrades attempts to
  `expo-accepted` (receipt ok — handed to APNs/FCM) or `expo-error`
  (receipt error, code retained; `DeviceNotRegistered` additionally
  fires D1 retirement). Tickets with no receipt inside the poll window
  settle `ambiguous` with the window recorded.
- **Naming is the honesty surface.** Fields say `handedToExpoAt`,
  `expoAcceptedAt`, `expoErrorCode` — there is no `deliveredAt` anywhere
  in this seam. The ledger is queryable by the app through a declared
  read surface (host/cohost-shaped in A4 terms) so a product can render
  "invitations sent" honestly.
- **Never-claims list (normative):** the seam does not and will not
  claim device delivery, notification display, read/interaction state,
  or OS permission state. The guide page for this seam must carry this
  list verbatim; a wrapper that renames `expo-accepted` to "delivered"
  is the exact dishonesty this design exists to prevent.

### D4. Capability identity and target availability

- New manifest capability (working id `notifications.expoPushSeam`),
  distinct from LLP 0045's `notifications` boolean, which stays `false`
  until the outbox ships. The capability row lists the three surfaces
  (registry, send lane, ledger) and the never-claims list.
- **Local target:** full seam, with the Expo endpoint overridable to a
  suite-owned fixture (the A4 arms' scripted-provider idiom) so
  acceptance runs offline and deterministic; `EXPO-09-PUSH` flips from
  GAP to a witnessed boundary on the simulator (Expo push tokens are not
  obtainable on simulators, so the acceptance registers a fixture token
  through the same documented client surface — the boundary and ledger
  are the witnessed facts, per the a4expo-f1 fix shape).
- **Hosted target:** reported Missing until the hosted executor lane can
  hold the config grant and egress (`a1expo-f5` is the gate); no
  invented local equivalence, per LLP 0064's honesty rules.

### D5. A4 contract fit

The acceptance shape for the "tell my guests" leg, written against this
seam (and intended as the packaged-closure conformance test):

1. simulator app registers a token through the documented client
   surface (fixture token on simulator);
2. an RSVP change triggers a host action; `ctx.push.send` with a dedupe
   key produces exactly one attempt row (`handed-to-expo`) against the
   fixture endpoint, recorded at T with token identity;
3. the receipt poll upgrades it (`expo-accepted`), and a scripted
   `DeviceNotRegistered` receipt on a second send retires that token in
   the registry;
4. a re-run under the same dedupe key is a receipted no-op; an
   unauthorized principal's send refuses with the platform auth code
   (which must survive the action boundary — `a4-f5` is a dependency of
   this witness);
5. logout retires the installation's tokens; a subsequent send to that
   principal records zero targets rather than a stale handoff.

### D6. Migration and the no-op posture

- Apps that declare nothing push-shaped pay nothing: no registry, no
  ledger tables, no manifest row, no runtime cost. The seam is
  strictly additive and the capability manifest is the discovery
  surface.
- The naive app-authored bridge (action + `ctx.fetch` + app-table
  tokens) remains *possible* on current main. The guide should
  document it only as an explicitly-warned interim recipe (token
  custody and retirement hazards named) or not at all — open question
  5; this RFC's position is that the seam, not the recipe, is the
  documented path.
- **Absorption into LLP 0045:** the outbox's durable intent lifecycle
  (enqueue, authorize, dedupe, retry, deliver) maps onto this seam's
  ledger one-to-one (intent ≈ dedupe-key chain; delivery attempt ≈
  attempt row; provider adapter ≈ the Expo POST + receipt poll). When
  0045's push slice arrives, this seam becomes its Expo provider
  adapter and the `notifications.expoPushSeam` capability folds into
  the first-class row. The RFC commits to not inventing ledger fields
  0045's lifecycle cannot carry.

## Consequences

- `EXPO-09-PUSH` gains a witnessable non-GAP answer on the local
  target; the A4 contract's mobile "tell my guests" leg becomes
  implementable end-to-end (send-side) without claiming what Expo does
  not report.
- Token custody moves from "whatever the app does" to a platform
  surface with retirement wired to the auth lifecycle — the part FCM
  reference apps routinely get wrong.
- Two honest limits stay visible: hosted remains Missing until the
  hosted lane exists, and nothing anywhere claims delivery. Products
  that need read receipts or delivery SLAs need a different provider
  relationship, and the capability row says so.
- LLP 0045's scope is unchanged; this RFC adds a provider-shaped
  down-payment it can absorb.

## Open questions

1. Surface naming: `ctx.push` vs `ctx.notifications.expo`; capability id
   `notifications.expoPushSeam` vs a `push.*` family. (Guide and
   manifest naming review.)
2. The exact installation identity for registry keying: the packaged
   client's store id, the RQS resume identity, or a new
   installation-scoped id minted at registration — and what happens on
   store reset.
3. Receipt-poll cadence, window, and retention on the local target; who
   drives it on hosted once that lane exists (Expo recommends checking
   receipts within roughly a day — pin the window).
4. Config entry naming and required-ness for the Expo access token;
   whether the seam should refuse sends when the account requires
   enhanced security and the grant is absent, or attempt and record the
   `InvalidCredentials` receipt.
5. Whether to document the interim app-authored bridge recipe with
   warnings before the seam ships, or hold the guide silent until the
   seam is the story (guide-gap tickets 20260728 and a4expo-f1 both
   press for *some* documented posture now).
6. Sequencing against LLP 0045's email-first slice: does the seam land
   independently (this RFC's assumption) or ride the outbox's first
   provider-adapter milestone?
7. Should the acceptance kit ship the fake-Expo fixture (tickets +
   receipts + scripted `DeviceNotRegistered`) as a shared harness, the
   way the A4 arms shipped scripted providers ad hoc?
8. Audience shapes for `to`: principals only, or also declared groups
   (e.g. a membership resource — "all seated guests of event X")
   resolved host-side; the A4 fit wants the latter eventually.

## Prior art

- **LLP 0045** — notifications outbox: owns the first-class capability;
  defers push token lifecycle; open question "what is the first push
  provider and how are device tokens modeled?" — this RFC is that
  answer's Expo-shaped half.
- **LLP 0137 / Diary 0045 Track B entry** — the motivating evidence:
  `a4expo-f1` (this gap), `a4-f1` (egress hole, fixed on main),
  `a4-f5` (auth-code collapse through actions, a dependency of D5),
  `a1expo-f5` (hosted mobile gap, the D4 hosted gate).
- **Expo push service** — `expo-notifications` token acquisition, the
  `exp.host` send + receipts HTTP API, and its explicit
  tickets-then-receipts, no-delivery-claim contract, which this seam
  mirrors rather than hides.
- **Firebase Cloud Messaging** — the reference bar for "push is a core
  mobile feature": token registration, send APIs, topic fan-out; also
  the reference for what honest receipts cannot promise (FCM likewise
  reports handoff, not display).
