# LLP 0143: Expo push-notification seam

**Type:** RFC
**Status:** Implemented
**Systems:** Notifications, React/Expo, Actions, Auth, Secrets and config,
Deployment, Testing, Documentation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-23 (author ruling: the durable reservation is the caller
authority handoff; no live-session veto may run after accepted reservation).
2026-08-10 (LLP 0222 connected-client predicate recorded as advisory push-policy input, never exactly-once settlement). 2026-08-03 (PUSH-01 Exit: a physical iOS development build
returned an allowlisted Expo ticket and receipt with `ok` status; the local
`notifications.expoPushSeam` integration seam is shipped, while hosted remains
Missing and the first-class LLP 0045 `notifications` boolean remains false.)
**Revised:** 2026-08-02 (PUSH-01 packaged acceptance, generated ledger
projection, and safe pre-transmit recovery amendment; the real dev-build
receipt remains the final exit witness.) 2026-08-01 (loop CONVERGED dual-family READY — Fable round 3,
Codex round 3, zero unresolved concerns; artifacts
reviews/0143-expo-push-notification-seam.{fable,codex}.md. Status
advances Draft -> Review; acceptance is the author's call; two
cosmetic Fable nits recorded for the next natural edit.) 2026-08-01 (v3, round-2 dual-family reconciliation — Fable
READY with one must-fix, Codex NOT READY; artifacts appended to
`llp/reviews/0143-expo-push-notification-seam.{fable,codex}.md`, each
against v2 sha256 `35f0a6e2…`. Every point verified and applied; none
refuted. Dispositions — Fable R2-1 + Codex #2 (the shared finding, D3b
crash discrimination): applied; a durable fenced `transmitting`
transition now precedes the first network byte, recovery treats
claimed-without-marker as safe re-drive and marker-without-settlement
as `ambiguous`, and attempts past the transmit boundary are never
auto-re-driven. Codex #4 (rotation + custody details): applied —
verified that `addPushTokenListener` emits a native `DevicePushToken`,
so D1c's rotation lane now reacquires the Expo token via
`getExpoPushTokenAsync` before re-registering; `appScope` is pinned to
a declared (EAS project id, application identity, environment profile)
tuple; and D1a replaces the unsupported "bounded, not accumulated"
claim with a declared idle-retention GC rule (reinstall with a new
token strands the old row otherwise). Codex #5 (host-enforced send
authorization): applied; D2b/D2c now bind every audience resolver to a
declared authorize clause the HOST evaluates at capture and at send in
all three trigger modes — composing the LLP 0100 membership-addressed
declaration vocabulary and LLP 0053's invalidation semantics — so
`ctx.push.send` refuses without host-verified evidence and the app
`requireRole` convention is defense in depth, not the boundary. Codex
#1 (matrix correction): applied; `MessageTooBig` reclassified to the
receipt stage per Expo's error documentation, ticket-stage wording
narrowed. Codex #9 (poll schedule): applied; D3d pins first poll,
interval progression, attempt count, and terminal rule as published
facts. Codex #3 clarification: applied (each message row belongs to
exactly one batch attempt; re-drives mint new rows). Fable nit 2:
applied (single ownership is per `appScope`; a cross-scope collision
refuses and records a leak-indicator diagnostic). Fable nit 3: applied
(D2b cross-references the resolver-authorization declaration and OQ8).
Status remains Draft.)
2026-08-01 (v2, round-1 dual-family reconciliation — both
NOT READY; artifacts in
`llp/reviews/0143-expo-push-notification-seam.{fable,codex}.md`, each
against v1 sha256 `16ec3b56…`. Every material point verified against the
tree or the Expo documentation and applied; none refuted, one applied
with a nuance. Dispositions — Fable c1 (ambiguous-retry can
double-deliver): applied; D3 now forbids auto-retry of `ambiguous`,
scopes at-most-once to the handoff attempt, and records the
device-duplicate risk normatively. Fable c2 + Codex m4 (installation
identity absent on the carrier): applied; D1 promotes it from open
question to a named dependency with a default proposal (seam-minted id
persisted beside auth custody; the landed B1 RN durable-store arm is the
plausible carrier), scoped by app/EAS project identity. Fable c3
(multi-principal same token): applied as a normative single-owner rule.
Fable c4 (payload privacy): applied. Fable c5 (pacing): applied in D2.
Fable c6 (simulator overbreadth): applied; per-OS scoping recorded,
uniform fixture kept as a determinism choice. Fable c7 (ledger read
contract on the packaged closure): applied to D6. Fable c8 (a4-f5 gate
legibility): applied to D5. Codex m1 (Expo API corrections): applied —
token object shape (`ExpoPushToken.data`), `projectId`
optional-but-recommended, `DeviceNotRegistered` in tickets AND receipts,
a request/ticket/receipt outcome matrix replacing the "4xx retryable"
prose, receipt timing pinned to Expo's ~15-minute check guidance and
~24-hour clearing; the v1 `InvalidCredentials` receipt claim was correct
for provider-credential failures and is kept in the matrix beside the
request-level `UNAUTHORIZED` case Codex identified (nuance recorded).
Codex m2 (crash-safe attempt protocol): applied; D3 defines durable
reservation, claim fencing, payload binding, divergent-key refusal,
settlement, and recovery at each of the four crash points. Codex m3
(per-message ledger): applied; the ledger is normalized into intent
chain / batch attempt / per-token message rows with aggregate state as a
derived projection; D5 rewritten accordingly. Codex m5 (authority
composition with the shipped scheduling slice): applied; verified
against LLP 0070 (v1 `ctx.jobs.enqueue` is mutation-produced and
executes callees as system authority; `producerPrincipal` is provenance
only) — D2 now defines three trigger modes and a capture-then-revalidate
recipient-authorization rule with execution-time audience resolution.
Codex m6 (activation/read contracts, endpoint exfiltration): applied;
D6 defines the source declaration and manifest shape, and D2 pins the
production endpoint with operator-owned, test-profile-only, loopback
overrides. Codex m7 (a1expo-f5 gate breadth): applied; D4 states the
full hosted conjunction from the ticket. Codex s8 (never-claims
completeness, "invitations sent"): applied. Codex d9 (receipt cadence
and 1,000-id chunking): applied. Status remains Draft.)
2026-08-01 (initial draft, commissioned as ballot item 5 from the LLP
0137 Track B findings; direction decided by the author the same day: an
integration seam to Expo's push service — option (a) — not a
first-class Snapback delivery capability)
**Revised:** 2026-08-02 (ACCEPTED by Charlie Cheever in the 2026-08-02
decision sitting — see `issues/20260802-author-decision-packet.md` for the
sitting record. The dual-family READY convergence with zero unresolved
concerns stood; the nine open questions resolve during implementation as
the document itself proposes. Acceptance authorizes the seam design;
`notifications: false` remains the honest manifest claim until the
implementation lands.)
**Revised:** 2026-08-02 (device-token registry implementation record added.
This is D1 plus the registry-only D6 activation slice, not the complete seam;
the send lane, ledger, receipts, and full capability identity remain open.)
**Revised:** 2026-08-02 (the registry client boundary was corrected to an
explicit additive subpath. Root imports and ordinary clients now retain no
push-shaped runtime, export, property, or type; a prospective bundle ledger
freezes both positive attachment and root-negative proofs.)
**Revised:** 2026-08-02 (D2/D3 local implementation amendment: all nine
implementation questions resolved; generated action send types, deferred
grants, crash-safe ledger, bounded ticket/receipt carrier and maintenance,
explicit ambiguity redrive, shared fake-Expo acceptance, structured local
capability facts, and guide page recorded. First-class `notifications` stays
false and hosted stays Missing.)
**Revised:** 2026-08-02 (OQ2 ratification implemented after Charlie closed the
veto window: Expo uses a dedicated device-scoped document-store member,
logout/account switch preserve it, and only full app-data reset or reinstall
mints a fresh identity.)
**Related:** LLP 0000, LLP 0027, LLP 0028, LLP 0036, LLP 0039, LLP 0045,
LLP 0049, LLP 0053, LLP 0055, LLP 0064, LLP 0070, LLP 0100, LLP 0102,
LLP 0137,
issues/closed/20260801-0137-a4expo-f1-no-mobile-push-boundary.md,
issues/20260801-0137-a4-outbound-notification-effects-unauthorable.md,
issues/shelved/20260801-0137-a1expo-f5-hosted-mobile-gap.md,
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
to whom, under which trigger mode and config grant), and **honest
receipts** (what was handed to Expo, when, for which token identity —
never a delivery claim, and never an at-most-once-display claim the
provider protocol cannot support).

The seam is three pieces:

1. a platform-owned **device-token registry** written from the client
   (`expo-notifications` token in, principal + installation custody
   inside, a single-owner rule per token bytes, retirement wired to
   session end, to token rotation, and to `DeviceNotRegistered` at
   either provider stage);
2. a **send lane for actions** (`ctx.push.send`) that resolves
   audiences to tokens inside the host at execution time, posts to the
   Expo push API over the landed `ctx.fetch`/`host.fetch` egress seam
   under a declared config grant, paces chunked fan-out, and never
   exposes token bytes to handler code — with recipient authorization
   defined per trigger mode, because the shipped scheduling slice runs
   deferred callees as system authority; and
3. a **handoff ledger** normalized to Expo's actual protocol: a
   dedupe-keyed intent chain, per-POST batch attempts, and per-token
   message rows carrying ticket and receipt outcomes, driven by a
   crash-safe reserve/claim/settle protocol, named in Snapback's
   honesty-surface style (`handed-to-expo`, `expo-accepted`,
   `expo-error`, `ambiguous`) with an explicit never-claims list.

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
- **The pieces this seam composes with have landed — with one corrected
  claim.** The `ctx.fetch` → `host.fetch` action egress seam is in the
  runtime (crates/snapback/src/runtime.rs, LLP 0049 §Action Egress); declared config
  grants exist (LLP 0036 `uses` + `ctx.secrets`); cron actions exist
  (LLP 0028); the shipped one-off scheduling surface is the
  mutation-produced `ctx.jobs.enqueue` whose v1 executes callees as
  **system authority** with `producerPrincipal` as provenance only
  (LLP 0070) — D2 designs around that fact rather than assuming
  inherited user authority; client terminal-auth facts have a recorded
  pattern on main (`authTerminalStatus`/`subscribeAuthTerminal`; the
  packaged 0.1.7 closure carries only the `handleTerminalAuthLoss`
  choke point); LLP 0039 owns session-end authority transitions and
  LLP 0053 owns permission-revocation invalidation — token retirement
  binds to both, on the correct side of that division.

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
    `getExpoPushTokenAsync({ projectId? })` resolves to an
    `ExpoPushToken` object whose `.data` field is the
    `ExponentPushToken[...]` string; `projectId` is optional in the API
    (it defaults from the app's Expo/EAS configuration) and explicitly
    recommended. `requestPermissionsAsync()` owns the OS permission
    prompt, and `addPushTokenListener` reports token rotation while the
    app runs. None of these is a Snapback surface; this RFC wraps
    registration only, never the permission flow.
  - Send: `POST https://exp.host/--/api/v2/push/send` accepts one
    message or an array (up to 100 per request) of
    `{ to, title, body, data, ... }` and returns per-message
    **tickets** (`{ status: "ok", id }` or `{ status: "error",
    details }`). Ticket errors include `DeviceNotRegistered` — the
    token-retirement signal can arrive at the ticket stage, not only in
    receipts. An `Authorization: Bearer <access token>` header applies
    when the Expo account enables enhanced push security; omitting it
    then fails at the request level (`UNAUTHORIZED`), before any ticket
    exists.
  - Receipts: `POST https://exp.host/--/api/v2/push/getReceipts` with
    `{ ids: [...] }` (up to 1,000 ids per request) returns per-ticket
    **receipts** — `ok` means Expo handed the message to APNs/FCM;
    `error` carries `details.error` codes such as `DeviceNotRegistered`,
    `MessageTooBig`, `MessageRateExceeded`, and `InvalidCredentials`
    (the app's APNs/FCM push credentials held by Expo are invalid — a
    provider-credential fact, distinct from the request-level
    `UNAUTHORIZED` above). Expo recommends checking receipts about 15
    minutes after sending and clears them after roughly 24 hours.
  - Neither tickets nor receipts ever report device delivery, display,
    or read. Expo's handoff is best-effort and carries no server-side
    idempotency: re-posting the same logical message is a new message
    to the device. The seam inherits both limits honestly (D3).

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

**D1a. The registry and its key.** A platform-owned push-token registry
(working name `pushTokens`), keyed by
`(appScope, principal, installation)`:

- `appScope` binds the registration to the token's minting domain,
  pinned as a declared tuple: the EAS project id, the application
  identity (iOS bundle identifier / Android application id), and the
  deployment environment profile. Two Expo projects (or incompatible
  token domains) never share rows, and the tuple is declared once in
  `definePushSeam` (D6), not inferred per registration.
- `installation` is a **named dependency, not a naming choice** (this
  supersedes v1's OQ2 framing). The ratified v1 default mints an opaque
  installation id at first registration and persists it in a dedicated small
  device store, never in the RQS cache. The Expo carrier uses the app document
  container member `snapback-push/installation.v1.json` over the app-injected
  `expo-file-system` module; another native durable key/value adapter may
  implement the same storage interface. Ordinary logout keeps the id while
  session termination retires the server binding. Account switch keeps the id
  and registration under the successor session rebinds it through D1b. A full
  app-data custody reset explicitly clears the member, and an OS app-data reset
  or reinstall loses the app container; the next registration then mints a
  fresh installation. Missing durable custody refuses rather than substituting
  process memory. The
  stale predecessor row is often retired promptly — by the
  single-owner rule below when the reinstall re-mints the *same* token
  bytes, by session end, or by `DeviceNotRegistered` on the next send
  — but a reinstall that mints a *different* token under a lingering
  session strands the old row until a send happens to sweep it, so
  boundedness needs its own rule: the registry declares an
  **idle-retention window** (a `definePushSeam` fact, D6), and rows
  with no successful handoff and no re-registration inside the window
  are retired by the seam's maintenance lane with the retirement
  reason recorded. OQ2's final home and reset semantics are therefore closed.
- Registration is idempotent per key with last-write-wins on token
  bytes, and each registration records the session/authority
  generation that performed it (D1c).

**D1b. Single-owner rule (normative).** Within one `appScope`, token
bytes have at most one live row. Registering token bytes already held
by another principal's live row in the same scope retires the
predecessor row in the same transaction (a device that switches users
stops receiving the previous user's sends). Without this rule, a send
addressed to principal A would display on a device currently signed in
as B, including whatever the app put in `data`. Across `appScope`s the
same bytes are illegitimate by construction (Expo tokens are
project-scoped): a cross-scope collision refuses the registration and
records a leak-indicator diagnostic rather than silently retiring
either row.

**D1c. Retirement lanes.**

- explicit unregister (`client.push.unregisterToken()`);
- **session end** (logout, expiry, admin session revocation): these are
  LLP 0039 authority transitions, not LLP 0053 authorization events —
  the client deletes its retained state through the AuthCoordinator
  path, and server-side the registry rows recorded under that session's
  authority generation are retired transactionally in the same
  session-end commit. A concurrent re-registration from a *different*
  live session of the same principal is keyed to its own generation and
  survives; a re-registration racing its own session's logout loses
  (generation fencing decides, never wall clock);
- **permission revocation** (LLP 0053's admin verb — "remove this user
  from every group") does not by itself retire tokens: the principal
  still exists and may hold app-independent authority. Whether an app
  wants send-audience membership to gate at resolution time is exactly
  what execution-time audience resolution (D2c) provides;
- **token rotation:** `addPushTokenListener` fires with a **native
  `DevicePushToken`** (the raw APNs/FCM token), not a new Expo token —
  so the client surface treats the event as a rotation *signal*,
  reacquires the Expo token via `getExpoPushTokenAsync`, and
  re-registers the new `ExpoPushToken.data` under the same
  `(appScope, principal, installation)` key; the old bytes are
  replaced atomically. Rotation while backgrounded is caught by the
  next foreground registration refresh;
- **provider-driven:** `DeviceNotRegistered` at *either* stage — push
  ticket or receipt — retires the row and annotates it with the
  ticket/receipt identity (D3).

**D1d. Custody at rest and in diagnostics.** Token bytes are
deployment-custody data, stored outside seed artifacts and export
surfaces. Operator inspection prints registry cardinalities and
retirement facts, never token bytes (the LLP 0036 `status` discipline
applied to tokens). Provider responses are never persisted raw: Expo
ticket error *messages* can echo the token, so the ledger persists an
**allowlist** — status, ticket/receipt id, enumerated `details.error`
code, and enumerated sub-codes — and drops free-text provider prose.

### D2. The send lane

Sends happen **from actions**, composing with the landed egress seam —
but apps do not hand-roll the Expo POST, because that would require
handing them token bytes.

**D2a. Surface.** `ctx.push.send({ to, title, body, data?, dedupeKey,
redriveAmbiguous? })`
where `to` names a declared audience (D2c), never raw tokens. The host
resolves the audience to registry rows, chunks into ≤100-message Expo
requests, and performs the POST over the same `host.fetch` boundary
actions already use — the deployment's egress opt-in
(`SNAPBACK_OUTBOUND_ACTIONS`) and the action wall-clock watchdog govern
it unchanged. The platform paces chunk submission (serial per attempt,
bounded burst across attempts) and treats rate-class provider outcomes
as retryable with backoff (D3e); pacing limits are published manifest
facts, not tunables hidden in prose.

**D2b. Trigger modes and authority (corrected against the shipped
scheduling slice).** Verified: LLP 0070's v1 `ctx.jobs.enqueue` is
produced from mutations and executes callees as the same system
authority cron actions use; `producerPrincipal` is provenance only.
There is no shipped action-side `runAfter` that inherits user
authority. The seam therefore defines three modes rather than implying
inheritance:

Authorization in every mode is **host-enforced, not an app
convention**: each declared audience resolver (D2c) carries a declared
`authorize` clause — the LLP 0100 membership-addressed vocabulary
(membership resource, resource argument, permitted roles) or an
explicit `system` allowance — and the host evaluates that clause
itself before any transmit. An action that calls `ctx.push.send`
without satisfying the clause is refused by the host; an app-side
`requireRole` in a nested mutation (the A4 idiom) remains good
defense in depth but is never the boundary. Revocation composes: the
clause is evaluated against current membership state (LLP 0053's
invalidation semantics apply), at capture for deferred sends and again
at send time in every mode.

1. **Immediate, client-triggered:** a client-invoked action calls
   `ctx.push.send`; the host evaluates the audience's `authorize`
   clause against the action's server-resolved (user) authority before
   transmit and refuses on failure.
2. **Cron/system:** a cron action sends under system authority; only
   resolvers whose clause explicitly allows `system` are usable, and
   the app's own due-scan logic remains the product-level trigger —
   exactly as the A4 reminder leg works.
3. **Deferred (`ctx.jobs.enqueue` from an authorized mutation):** the
   producing mutation runs as the user and is where recipient
   authorization happens; the job's action later executes as system
   authority. The seam makes this honest with **capture then
   revalidate**: at capture the host evaluates the audience's
   `authorize` clause as the producer and mints a narrow send grant —
   the declared audience reference and its arguments, bound to the
   dedupe key, recorded with `producerPrincipal` provenance — and at
   execution time the system-authority action may send only through
   that captured grant, with the clause re-evaluated and the audience
   *re-resolved* at send time (D2c). No captured grant, no deferred
   send; arbitrary principal-id lists are not a deferred-send
   audience. (The declarable vocabulary of resolver `authorize`
   clauses beyond membership-addressed shapes was resolved by implementation
   question 8 below.)

**D2c. Audiences (normative).** `to` is a **declared audience
resolver** — a generated, declaration-checked reference (e.g. "the
registered installations of these explicit principals" or, per resolved
implementation question 8, "members of membership resource R with roles …") — not an
arbitrary id list at execution time. Every resolver declaration
carries the `authorize` clause D2b enforces. Resolution always happens
host-side **at execution time**, never at enqueue time: this is the
rule that makes deferred sends respect retirement, the single-owner
rule, and membership changes between enqueue and send. A resolver that
yields zero rows records a zero-target attempt (D5 step 5), which is a
fact, not an error.

**D2d. Config custody and endpoint pinning.** The Expo access token
(enhanced push security) is a declared config entry (working name
`expoPushAccessToken`, `required: false`) granted via `uses` — LLP 0036
custody, redacting handles, never in source or seed. The provider
endpoint is **pinned to Expo's production endpoint**. Because the
endpoint receives bearer-shaped tokens, an endpoint override is a
token-exfiltration lever: overrides are operator-owned deployment
custody, honored only on local/test target profiles, refused when
non-loopback, and never expressible through app arguments or app
config. The A4 arms' argument-passed `providerUrl` idiom is exactly
what this seam must not reproduce.

**D2e. Payload privacy (normative).** Title, body, and `data` transit
Expo and APNs/FCM in plaintext as far as Snapback can observe. The
seam's guide page must state that protected row data does not belong in
push payloads; the recommended shape is an opaque reference the app
resolves through its authorized read surfaces on open. The seam does
not scan payloads; it states the boundary.

### D3. The handoff ledger (receipts, honesty, and crash safety)

**D3a. Normalized shape (per-message, not aggregate).** Expo's protocol
is per-message; one scalar attempt state cannot carry a batch whose
tickets and receipts diverge. The ledger is three levels:

- **Intent chain** — one per dedupe key: the captured payload binding,
  audience reference, trigger mode, attempt count, and a *derived*
  aggregate projection for product UI;
- **Batch attempt** — one per Expo POST (≤100 messages): request
  outcome, HTTP class, timing;
- **Message row** — one per (attempt, token identity), and each
  message row belongs to **exactly one** batch attempt (a re-drive
  mints new message rows under its new attempt; it never rebinds old
  ones): ticket outcome, ticket id, receipt outcome, enumerated error
  codes, retirement effect. Ticket ids, receipt state, error
  classification, and token retirement live here; nothing aggregate
  ever overwrites them.

**D3b. Crash-safe protocol.** "Record at the moment of the POST" is not
a protocol. The seam's send path is reserve → claim → transmit →
settle, all durable, with the transmit boundary itself a durable
transition:

1. **Reserve:** the intent chain and this attempt's message rows are
   committed (state `reserved`, payload and resolved audience bound to
   the dedupe key) *before* any bytes leave the host. Reusing a dedupe
   key with a divergent payload or audience reference refuses.
2. **Claim:** a single fenced owner claims the attempt (the LLP 0070
   lease idiom); a crashed owner's lease expires and the attempt
   becomes recoverable.
3. **Transmit boundary (normative):** the owner durably writes the
   batch attempt's `transmitting` transition **before the first
   network byte leaves the host**. This marker is the crash
   discriminator: without it, a claimed attempt with no ticket rows
   cannot be told apart from one Expo accepted just before a crash.
   Once an attempt has entered `transmitting` it is **never
   automatically re-driven**.
4. **Transmit:** the Expo POST(s) run under the claim.
5. **Settle:** ticket outcomes are written per message row; the batch
   attempt records the request outcome.

**Caller-authority handoff ruling (2026-08-23).** For an immediate
session/service-backed send, reservation is the authoritative transfer from
the live caller to the durable intent. Reservation must revalidate and commit
the caller authority atomically. Once it commits, claim, `transmitting`,
provider I/O, and settlement proceed from the durable intent and must not be
vetoed by a later live-session check. An optional check before reservation may
only fail fast; it cannot replace the reservation's atomic validation. The
required implementation correction is tracked by
`issues/shelved/20260823-expo-push-reservation-authority-handoff.md`.

Crash recovery by point, discriminated by the marker: before reserve —
nothing exists, the send never happened; after reserve or claim,
**no `transmitting` marker** — no bytes were sent; recovery re-drives
safely; **marker present, no settlement** — bytes may have reached
Expo and the tickets are lost; recovery settles the attempt
`ambiguous` (D3c: only an explicit re-drive, which records the
duplicate risk, may follow); mid-batch ticket persistence — message
rows settle individually, and unsettled rows in a batch whose response
was lost settle `ambiguous`.

**D3c. Ambiguity and duplicates (normative honesty).** Expo has no
server-side idempotency; the dedupe key exists only in Snapback's
ledger. Therefore:

- at-most-once is claimed **per handoff attempt**, never per device
  display;
- `ambiguous` attempts are **never auto-retried**. An explicit
  re-drive (operator or app-initiated) is a new attempt under the same
  intent chain, and the ledger records on it that the previous attempt
  was ambiguous — i.e. **the device may receive the notification
  twice**. This sentence, or its equivalent, is normative for the
  guide page;
- `failed` attempts with a retryable class (D3e) may auto-retry under
  backoff, because no bytes were accepted.

**D3d. Receipt upgrade.** A bounded poll (the cron machinery LLP 0045
already pins for its runner; suite-driven tick in tests) collects held
ticket ids in ≤1,000-id `getReceipts` chunks. The v1 schedule is
pinned, published as manifest facts beside pacing: first poll 15
minutes after handoff (Expo's guidance), then doubling intervals — 30
minutes, 1 h, 2 h, 4 h — capped at 4 h, at most **seven polls per
attempt**, terminal at the earlier of receipt arrival or the ~24-hour
window close. Message rows upgrade to `expo-accepted` (receipt ok —
handed to APNs/FCM) or `expo-error` (enumerated code retained;
`DeviceNotRegistered` additionally fires D1 retirement). Ticket ids
with no receipt when the schedule exhausts settle `ambiguous-receipt`
with the window recorded. Ledger retention is the seam's own declared
limit (D6), independent of Expo's clearing.

**D3e. Outcome matrix (normative).** Request level: HTTP 400
(malformed) → `failed-permanent`, no retry; `UNAUTHORIZED` (enhanced
security without a valid bearer) → `failed-config`, no retry until the
config generation changes; HTTP 429 → `failed-retryable` with backoff;
HTTP 5xx → `failed-retryable` with backoff; transport error/timeout →
`ambiguous` (D3c). Ticket level (per message): `ok` →
`handed-to-expo`, receipt pending; `DeviceNotRegistered` → terminal for
that token + registry retirement; any other enumerated ticket error →
`failed-permanent` for that message. Receipt level: `ok` →
`expo-accepted`; `DeviceNotRegistered` → `expo-error` + retirement;
`MessageTooBig` → `expo-error`, `failed-permanent` for that message
(a receipt-stage error in Expo's documentation, not a ticket-stage
one); `InvalidCredentials` → `expo-error-config` (operator-facing:
Expo's stored APNs/FCM credentials for the app are invalid);
`MessageRateExceeded` → `expo-error-rate`, retryable as a new attempt
under pacing; no receipt in window → `ambiguous-receipt`. In every
cell the persisted diagnostic is the allowlisted code (D1d), never
provider prose.

Snapback-side diagnostics that reach an HTTP boundary retain a separate,
reviewed projection. Malformed send/deferred-grant input and a missing declared
config grant are 400; dedupe or explicit-redrive state conflicts are 409; an
Expo response outside the closed ticket/receipt vocabulary is 502; an
unavailable, unsupported, or attempt-counter-exhausted seam is 503. Internal
ledger/claim/receipt fences, staged-config corruption, worker failure,
operator override refusal, and response serialization remain fail-safe 500s.
`SNAPBACK_EXPO_PUSH_BASE_URL` is an operator environment variable, not a
diagnostic code.

**D3f. Naming is the honesty surface.** Fields say `handedToExpoAt`,
`expoAcceptedAt`, `expoErrorCode` — there is no `deliveredAt` anywhere
in this seam.

**Never-claims list (normative, extended).** The seam does not and will
not claim: device delivery; notification display; read or interaction
state; OS permission state; exactly-once sending or duplicate
suppression (D3c); ordering across recipients or across intents;
delivery latency, availability, or any SLA; continued token validity or
current registration beyond the recorded retirement facts. UI
projections built on the ledger must preserve the
handed/accepted/error/ambiguous vocabulary; a product string like
"invitations sent" is product copy, not a fact this seam backs, and the
guide page must say so. The guide page carries this list verbatim.

### D4. Capability identity and target availability

- New manifest capability (working id `notifications.expoPushSeam`),
  distinct from LLP 0045's `notifications` boolean, which stays `false`
  until the outbox ships. The capability row lists the three surfaces
  (registry, send lane, ledger), the pacing and retention facts, and
  the never-claims list.
- **Local target:** full seam, with the Expo endpoint overridable only
  as D2d allows (operator-owned, test-profile, loopback) so acceptance
  runs offline and deterministic; `EXPO-09-PUSH` flips from GAP to a
  witnessed boundary. Platform scoping, stated precisely: iOS
  simulators cannot mint Expo push tokens; Android emulators with Play
  services generally can. The acceptance nevertheless uses the fixture
  token path uniformly on both — a deliberate determinism choice, so
  the witnessed facts are the boundary and the ledger, not Google's
  emulator image (per the a4expo-f1 fix shape).
- **Hosted target:** reported Missing until the full conjunction the
  `a1expo-f5` ticket actually describes holds — hosted
  sessions/native-auth entry (the Cloudflare arm exposes no sessions
  routes; the capture mailbox and `auth.mintSession` are
  non-production), authenticated registry operations over that entry,
  provider config custody on the hosted profile, action egress, a
  durable receipt-poll home, and a hosted conformance receipt. Config
  and egress alone (v1's phrasing) are not the gate; without hosted
  native auth, authenticated token registration cannot exist. No
  invented local equivalence, per LLP 0064.

### D5. A4 contract fit

The acceptance shape for the "tell my guests" leg, written against this
seam (and intended as the packaged-closure conformance test). Sequencing
note: step 4's refusal witness cannot pass while `a4-f5`
(SNAPBACK_AUTH_PERMISSION_DENIED collapsing to SNAPBACK_HANDLER_FAILED
through the action boundary) is unfixed — that ticket is an explicit
gate of this witness, not a footnote.

1. simulator app registers a token through the documented client
   surface (fixture token, per D4);
2. an RSVP change triggers a host action; `ctx.push.send` with a dedupe
   key produces one intent chain, one batch attempt, and one message
   row per registered installation (`handed-to-expo`) against the
   fixture endpoint, each recorded at T with token identity;
3. the receipt poll upgrades the message rows (`expo-accepted`); a
   scripted `DeviceNotRegistered` — exercised once as a ticket error
   and once as a receipt error — retires the affected token in the
   registry both ways;
4. a re-run under the same dedupe key is a receipted no-op; an
   `ambiguous` attempt (scripted socket drop) is not auto-retried, and
   its explicit re-drive records the duplicate risk; an unauthorized
   principal's send refuses with the platform auth code (gated on
   `a4-f5`);
5. logout retires the installation's tokens; a subsequent send to that
   principal records a zero-target attempt rather than a stale handoff.

### D6. Activation, migration, and the no-op posture

- **Activation is a declaration, not an ambient.** The seam exists in a
  deployment only when the app's source declares it (working shape:
  `definePushSeam({ appScope: { easProjectId, applicationId,
  environment }, audiences: { name: { resolve, authorize } },
  uses, registry: { idleRetention }, ledger: { retention },
  read: { auth } })`). The declaration generates the manifest row, the
  registry (with its D1a idle-retention GC fact) and ledger stores,
  the audience resolvers with their host-enforced authorize clauses
  (D2b/D2c), the config grant binding, and the ledger read
  projection. Apps that declare nothing push-shaped pay nothing: no
  registry, no ledger, no manifest row, no runtime cost.
- **The ledger read surface is a generated, declaration-checked
  projection** (host/cohost-shaped auth in A4 terms), privacy-bounded
  to lifecycle facts (states, timestamps, enumerated codes, token-row
  ids — never token bytes, payloads, or provider prose), and —
  learning from `0137-a1-f1`, where a platform-typed field made its
  table unqueryable on the packaged closure — its result contract must
  be expressible and conformance-tested **on the packaged closure**,
  not only in-repo. That requirement joins the absorption commitment
  below.
- The naive app-authored bridge (action + `ctx.fetch` + app-table
  tokens) remains *possible* on current main. The guide should
  document it only as an explicitly-warned interim recipe (token
  custody, retirement, and endpoint hazards named) or not at all —
  resolved implementation question 5 chooses the latter; this RFC's position
  is that the seam, not the
  recipe, is the documented path.
- **Absorption into LLP 0045:** the outbox's durable intent lifecycle
  (enqueue, authorize, dedupe, retry, deliver) maps onto this seam's
  ledger one-to-one (intent ≈ dedupe-key chain; delivery attempt ≈
  batch attempt + message rows; provider adapter ≈ the Expo POST +
  receipt poll). When 0045's push slice arrives, this seam becomes its
  Expo provider adapter and the `notifications.expoPushSeam` capability
  folds into the first-class row. The RFC commits to not inventing
  ledger fields 0045's lifecycle cannot carry, and to keeping the
  ledger's read contract packaged-closure-expressible.

## Consequences

- `EXPO-09-PUSH` gains a witnessable non-GAP answer on the local
  target; the A4 contract's mobile "tell my guests" leg becomes
  implementable end-to-end (send-side) without claiming what Expo does
  not report — including the duplicate-on-ambiguous-re-drive fact the
  provider protocol makes unavoidable.
- Token custody moves from "whatever the app does" to a platform
  surface with a single-owner rule and retirement wired to the auth
  lifecycle on the correct side of the 0039/0053 division — the parts
  FCM reference apps routinely get wrong.
- Deferred sends are honest about authority: captured narrow grants
  plus execution-time audience resolution, instead of pretending the
  shipped system-authority job lane inherits the user.
- Two honest limits stay visible: hosted remains Missing until the full
  `a1expo-f5` conjunction holds, and nothing anywhere claims delivery.
  Products that need read receipts or delivery SLAs need a different
  provider relationship, and the capability row says so.
- LLP 0045's scope is unchanged; this RFC adds a provider-shaped
  down-payment it can absorb.

## Implementation questions — resolved 2026-08-02

1. **Surface and capability naming.** The shipped names are
   `definePushSeam`, the additive `client.push` registry surface, and
   action-only `ctx.push.send`. The structured target fact's id is
   `notifications.expoPushSeam`; it remains distinct from LLP 0045's
   `notifications` boolean. Future absorption may alias these names but does
   not rename v1 artifacts silently.
2. **Installation identity home and reset.** The final v1 boundary is the
   additive registry module's dedicated device store, beside but not inside
   the RQS cache. With an app-injected `expo-file-system` module the
   conventional carrier owns `snapback-push/installation.v1.json`; a custom
   `pushInstallationStorage` remains available for another native durable
   key/value store. It mints once and persists through ordinary logout and
   account switch; session termination retires the old server binding and a
   successor registration rebinds the same installation. A full custody wipe
   calls the retained installation adapter's `clear()`, after which the next
   registration mints a new id; OS app-data reset and reinstall have the same
   fresh-device result. Snapback refuses missing custody instead of choosing process memory.
   Web registration is out of v1.
3. **Receipt ownership and manifest facts.** Local receipt polling belongs to
   the existing host maintenance worker, off the app lock during provider I/O.
   Its batch, first-poll, interval, attempt, and window bounds are published in
   `expoPushSeam`. Hosted omits the descriptor until it has its own durable
   poll home and the rest of D4's conjunction; local ownership is not inferred
   for it.
4. **Enhanced-security config.** The access token is optional in both seam
   and deployment config. When it is absent Snapback attempts the send without
   a bearer; Expo `UNAUTHORIZED` settles `failed-config`. No retry occurs until
   an app/operator makes a new attempt under corrected config. A token grant
   can be consumed only when both the seam and action declare it.
5. **Guide posture.** The guide ships the protected seam only. It does not
   teach the app-table/argument-provider-URL bridge, even as an interim recipe.
6. **LLP 0045 sequencing.** The seam lands independently. It remains a
   provider-shaped input that the later outbox can absorb; `notifications`
   stays false now.
7. **Fixture ownership.** A shared in-process fake Expo carrier ships with the
   push subsystem conformance suite. The send and receipt stages use the same
   production bounded HTTP carrier and cover tickets, receipts, both
   `DeviceNotRegistered` stages, provider-prose dropping, request-byte socket
   loss, no automatic ambiguity retry, explicit duplicate-risk redrive,
   dedupe/zero-target, and authorization refusal. It is test infrastructure,
   not a public provider package.
8. **Audience vocabulary.** V1 admits (a) membership resolvers over app or
   resource membership declarations and declared role subsets, and (b)
   explicitly bounded principal arrays. Authorization is independently either
   membership-addressed (app/resource plus roles) or explicit system. The host
   evaluates authorization and resolves recipients at execution. Deferred
   grants admit membership resolvers only, are transaction-captured with the
   exact audience arguments and dedupe key, and revalidate the producer's
   current membership before use.
9. **Rate feedback.** V1 publishes static pacing: serial ≤100-message batches
   per action attempt. `MessageRateExceeded` records `expo-error-rate` but does
   not adapt global pacing. Adaptive feedback requires a later design and its
   own convergence evidence.

### 2026-08-03 — OQ2 author-ratified installation identity lifecycle

The veto window recorded in
`issues/20260802-author-decision-packet.md` is closed: Charlie states no
opinion, so the delegated device-scoped-store default stands as ruled. The
production carrier is a dedicated small store exposed through the explicit
`pushInstallationStorage` injection, not auth custody and not the RQS cache.
Logout keeps the installation identity and unbinds the principal (deliveries
stop until someone signs in); account switch keeps it and rebinds; app-data
reset and reinstall mint a fresh identity. User-visible: push works across
logins on the same phone, while a wiped or reinstalled app is a new device.
This dated note resolves OQ2 without weakening the existing refusal to use
process-memory custody.

## Implementation record

### 2026-08-02 — D1/D6 registry slice

The first independently landable slice implements platform custody without
claiming provider handoff:

- `definePushSeam({ appScope, registry: { idleRetentionMs } })` is the exact
  registry declaration. It is valid only with session auth. Schema activation
  creates the protected registry and exact auth-lifecycle triggers only when
  declared; removing the declaration removes those objects. This proves D6's
  undeclared no-storage/no-maintenance posture for the registry half.
- The live registry key is `(appScope, principal, installation)`. Registration
  is one transaction: exact live session generation, idempotent refresh,
  last-write-wins rotation, same-scope single-owner transfer, cross-scope
  refusal with a bounded leak indicator, and no token bytes in the response.
- Exact-catalog triggers retire and erase the bound generation in the same
  SQLite transaction as session terminalization or durable expiry-clock
  advancement. Explicit unregister and declared idle-retention maintenance
  are live. The protected registry table, its PK autoindex, four named indexes,
  and three triggers are checked against a once-built exact reference catalog,
  including `table_xinfo`, `foreign_key_list`, `index_list`, and `index_xinfo`
  physical shape; forged `sqlite_schema` index text cannot hide different
  btree columns. A tested `DeviceNotRegistered` transition accepts only a
  token-row id plus an allowlisted `ticket:`/`receipt:` reference; it has no
  production caller until the send and receipt slices exist.
- Inspection reports only live/retired cardinalities and allowlisted reason
  counts. Auth backup retains registry schema but secure-deletes all custody
  rows from the staged image; the proof scans raw SQLite bytes, including free
  space, for the token fixture. Token bytes are request-only secret input and
  are absent
  from app storage, responses, diagnostics, inspection, and exports.
- The JS spelling for this slice is `client.push.registerToken`,
  `client.push.registerExpoToken`, and `client.push.unregisterToken`.
  Installation identity storage is explicitly native: the Expo default takes
  the app's `expo-file-system` module and owns one dedicated document-store
  member; another adapter may be injected. The client refuses with
  `SNAPBACK_PUSH_INSTALLATION_CUSTODY_REQUIRED` when neither is present.
  Unregister reads existing custody only: when no installation id exists it
  returns `{ tokenId: null, retired: false }` locally, without minting, writing
  storage, or making a network request.

Open-question dispositions at this boundary: OQ1 is resolved only for the
registry spellings (`definePushSeam`, `client.push`); the complete seam's
manifest capability id waits for the send/ledger shape. OQ6's independent
sequencing assumption is confirmed. OQ7 begins with deterministic in-process
registry fixtures, but the shared fake-Expo tickets/receipts/socket-drop kit
and real dev-build receipt remain completion gates. At this slice boundary OQ2
still awaited the author ruling; the ratified implementation amendment below
now closes it. OQ3–OQ5 and OQ8–OQ9 belonged to later slices.

Honesty posture: the capability index advertises a local, partial
`backend.push-token-registry-v1` GAP with the HTTP route as witness.
`notifications: false` is unchanged. There is no `ctx.push.send`, audience
resolver, handoff ledger, receipt poll, endpoint override, hosted claim, or
delivery claim in this implementation record.

### 2026-08-02 — D6 additive client-boundary correction

The first registry landing accidentally constructed `client.push` in the root
`SnapbackClient` and retained the complete registry runtime for applications
that never selected notifications. Commit `91a0a718` corrects that D6 defect:

- the root package exports no push symbol, the root constructor has no push
  option or property, and its declarations reject `client.push`;
- `@expo/snapback-client/push-registry` owns the runtime and declarations;
  `attachPushRegistry(client, { pushInstallationStorage })` explicitly returns
  the same client with the frozen registry surface attached;
- the additive module receives only the root client's package-private request
  funnel. Registration stays behind external-bearer replacement and dispatches
  only under successor custody; no generic request API becomes public; and
- LLP 0145's immutable primary baseline remains byte-identical. The versioned
  `baseline.push-registry.v1.json` ledger is frozen to `91a0a718` and owns the
  public subpath, positive attachment, and root-negative profiles, each with
  executable registry behavior proof.

This correction changes no registry storage or wire contract. The send lane,
audience authorization, handoff ledger, provider tickets/receipts, and full
capability claim remain open exactly as recorded above.

### 2026-08-02 — D2/D3 local send, ledger, receipt, and acceptance amendment

The independently landed registry is now connected to a local-target provider
lane without widening custody:

- `definePushSeam`'s installed audiences generate exact-name references and
  app-specific `GeneratedPushAudienceReference` unions. Send-capable generated
  action contexts expose `ctx.push.send`; registry-only schemas do not. The
  host still treats TypeScript as ergonomics rather than authority: it
  revalidates the declaration, exact argument union, trigger authority,
  membership roles, payload bound, and dedupe key before reserving.
- Immediate membership sends, explicit system audiences, and mutation-produced
  deferred grants are distinct. A deferred `pushGrant` is captured with an
  ordinary mutation read dependency, digested into job idempotency, persisted
  atomically with the job, and carried only into that job's action. Execution
  revalidates current producer membership and re-resolves recipients; raw
  principal arrays and duplicate-risk redrives refuse in this mode.
- The exact protected ledger stores intent, batch-attempt, and per-token rows.
  Reservation precedes a fenced claim; `transmitting` commits before provider
  bytes; token rotation is rebound only on the safe pre-transmit side. Lost
  certainty settles `ambiguous`, erases token snapshots, and never enters the
  recovery redrive path. `redriveAmbiguous: true` is the only v1 explicit
  duplicate-risk redrive: it requires an identical ambiguous predecessor,
  increments the intent attempt, mints new batch/message rows, and records
  `previous_ambiguous`.
- Send tickets and receipt polling share one 1 MiB-bounded HTTP carrier.
  Persisted outcomes come only from closed request/ticket/receipt vocabularies;
  provider prose is dropped. Ticket- and receipt-stage
  `DeviceNotRegistered` both transactionally retire and erase registry rows.
  The ordinary host maintenance sweep recovers expired claims and claims due
  receipt ids, releases the app lock across provider I/O, and settles only a
  bounded HTTP-200 response that passes the receipt parser. The seventh lost
  poll remains durably due so the next sweep terminalizes it rather than
  stranding it.
- `crates/snapback/src/push/fake_expo.rs` is the shared deterministic carrier. Its acceptance
  uses the production HTTP function for a mixed ticket batch and receipt poll,
  proves both provider retirement stages, dedupe and zero-target behavior,
  direct authorization refusal, and a socket close after request bytes. The
  latter proves no automatic redrive and the explicit attempt-2
  `previous_ambiguous` marker. Separate parser fixtures cover every allowlisted
  receipt code and refuse unknown codes or prose-only errors.
- The local capability manifest carries structured
  `notifications.expoPushSeam` facts: surfaces, dependencies, endpoint posture,
  send/receipt bounds, retention declaration bounds, static pacing, and the
  never-claims vocabulary. Hosted/remote profiles withhold it and retain an
  explicit GAP. The first-class `notifications` boolean remains `false`.
  `guide/backend/expo-push.md` teaches the additive registry, declared
  audiences, config and egress requirements, ambiguity risk, receipt
  vocabulary, payload privacy, and hosted boundary.

The seam's protected per-message ledger is exercised through the host and
operator/test inspection in this slice. The real-device receipt required by
the repository PUSH-01 exit is an external acceptance witness and is recorded
separately from the deterministic fixture; its absence cannot weaken or
upgrade any manifest fact.

### 2026-08-02 — D3b/D6 closure amendment

The final local acceptance pass closed two implementation gaps without
widening the provider claim:

- The original reaper moved an expired pre-`transmitting` claim back to
  `reserved`, but no maintenance worker could subsequently own and send that
  batch. Recovered batches now retain a nonzero claim-fence witness;
  maintenance claims only those rows, rebinds current token custody,
  reconstructs the exact protected payload, and commits a fresh
  `transmitting` marker before provider I/O. Fresh fence-zero action
  reservations are ineligible, so the worker does not race their originating
  action. Live and recovered sends share the published single-attempt pacing
  boundary. Post-marker loss remains `ambiguous` and is never automatically
  re-driven.
- `definePushLedgerQuery({ auth })` now supplies D6's generated app-readable
  projection. It accepts only an intent id, reloads the stored audience
  reference, and repeats current host authorization. Returned rows contain
  lifecycle states and opaque ids/timestamps only; token bytes, payload,
  dedupe key, audience arguments, config, and provider prose remain absent.
- The deterministic carrier is also exported as
  `@expo/snapback-cli/testing/fake-expo-push` and exercised by a committed
  generated fixture. The package proof covers authorization-before-I/O,
  tickets and receipt upgrade, idempotent replay, both
  `DeviceNotRegistered` stages, request-byte socket loss, explicit ambiguous
  redrive, and zero-target retirement through the production bounded HTTP
  path. The test is registered in the canonical package inventory.
- Dev/Test may drive one maintenance cycle with an injected clock only while
  the Expo endpoint override names loopback. The real endpoint rejects an
  injected clock; production remains owned by the ordinary maintenance worker.
- The HTTP diagnostic review classifies malformed app declarations and
  test-only maintenance requests as `400`, durable dedupe/redrive conflicts as
  `409`, an Expo response outside the closed provider vocabulary as `502`, and
  an unavailable, unsupported, or attempt-exhausted send seam as `503`.
  Host-owned ledger corruption, claim races, staged-config corruption, endpoint
  override refusal, send serialization, and maintenance-worker failure retain
  the fail-safe `500` class. `SNAPBACK_EXPO_PUSH_BASE_URL` is an environment
  variable, not a diagnostic. These transport classes do not widen any delivery
  claim.

These additions complete the implementation-resolvable OQ dispositions above.
They do not change D4: local manifests publish the structured
`notifications.expoPushSeam` descriptor, hosted/conformance profiles withhold
it, and the broader `notifications` boolean remains `false`. The Accepted
contract makes the closed capability id a stable compatibility fact; the
physical dev-build receipt remains a separate repository Exit witness and
cannot demote or upgrade that manifest fact. It is not evidence of device
delivery, display, read state, exactly-once behavior, or an SLA.

### 2026-08-02 — OQ2 installation-identity ratification amendment

Charlie closed the author-decision packet's veto window, so the delegated
device-scoped-store default is now the v1 contract and implementation:

- `@expo/snapback-client/push-installation-expo` constructs the conventional
  Expo carrier in `Paths.document/snapback-push/installation.v1.json`, which
  the app passes to `attachPushRegistry` as `pushInstallationStorage`. The app
  still owns and injects the native module, preserving the registry subpath's
  frozen no-native-dependency closure. The file is a closed two-field artifact,
  and corrupt or unavailable custody fails with stable diagnostics; its bytes
  never enter RQS state, app data, requests, or logs.
- The factory returns one process writer per file-system module and directory.
  Its write is first-writer-wins, and the registry re-reads the committed store
  after minting, so concurrent first use converges on one id. Each later
  operation also re-reads the store, so a completed reset cannot be masked by
  an in-memory promise.
- Logout preserves the file and server-side session termination unbinds its
  token row. Account switching preserves the same id; registration under the
  successor session invokes D1b's single-owner rebind. Only the retained
  storage adapter's `clear()`, an OS app-data reset, or reinstall removes
  custody; the next registration mints a fresh device identity. Missing
  custody still refuses, and custom native storage remains supported.

The client package acceptance covers concurrent first use, logout/account
switch preservation, full reset, RQS separation, and corrupt-store refusal.
This closes OQ2 without widening D4's capability claim or the real-receipt Exit
witness.

### 2026-08-03 — PUSH-01 physical-device Exit amendment

PUSH-01's external acceptance gate ran on the temporary All Aboard SB-EXPO
probe without placing its source or credentials in this repository. EAS build
`7af395e4-38d8-4053-ab63-4dcda53fef75` produced an ad-hoc iOS development
client for `dev.allaboard.sbexpo`; the paired physical phone loaded the probe
through Metro and minted its token entirely inside the app. The probe neither
rendered nor logged that token and discarded all free-form provider text.

The retained closed evidence is:

- witness `push-01-msdm9q33` under EAS project
  `e9f81917-0af8-4449-a7c5-948422068c50`;
- Expo ticket `019fc914-5711-753e-a8cb-39881feab344`, status `ok`, sent at
  `2026-08-03T19:23:01.071Z`;
- receipt status `ok` at `2026-08-03T19:23:11.445Z`, with no error code; and
- a foreground device callback at `2026-08-03T19:23:01.818Z`, plus Charlie's
  contemporaneous visual observation of the notification.

Only the ticket and receipt are capability evidence. The callback and human
observation are supplemental and do not establish a delivery contract. This
amendment therefore promotes the **local** `notifications.expoPushSeam` guide
row from partial to shipped, closes the real-device GAP, and advances this RFC
to Implemented. It leaves the complete hosted conjunction Missing and keeps
the distinct LLP 0045 `notifications` boolean false. Nothing here claims
device delivery, display, read state, exactly-once behavior, latency,
availability, or an SLA.

### 2026-08-10 — connected-client advisory policy input

LLP 0222 now supplies `ctx.realtime.hasFreshClient({ principalId })` to local
session-auth actions. A push action may use this advisory fact to skip an
immediate Expo attempt when at least one authenticated client transport is
fresh inside the fixed 15-second budget. The predicate is existential across
devices, and `false` means only “no fresh witness,” not “offline.”

This does not widen any D3 receipt or exactly-once claim. In particular, a
fresh client may disconnect before observing the event, so the predicate must
not settle or cancel a durable notification intent; LLP 0045's 2026-08-10
amendment assigns live-vs-push arbitration requiring exactly-once behavior to
that durable lifecycle. Hosted use remains unavailable until the hosted
session/push conjunction and a sound single-authority or shared aggregation
route both exist.

## Prior art

- **LLP 0045** — notifications outbox: owns the first-class capability;
  defers push token lifecycle; open question "what is the first push
  provider and how are device tokens modeled?" — this RFC is that
  answer's Expo-shaped half.
- **LLP 0070** — durable background work: the shipped
  mutation-produced `ctx.jobs.enqueue` slice, its system-authority
  execution and `producerPrincipal` provenance, and the lease/claim
  idiom D3b borrows.
- **LLP 0039 / LLP 0053** — session-end authority transitions vs
  permission-revocation invalidation; D1c's retirement lanes sit on
  that division rather than blending it.
- **LLP 0100** — membership-addressed operations: the declared,
  host-enforced authorization vocabulary D2b's audience `authorize`
  clauses reuse instead of inventing a push-specific one.
- **LLP 0137 / Diary 0045 Track B entry** — the motivating evidence:
  `a4expo-f1` (this gap), `a4-f1` (egress hole, fixed on main),
  `a4-f5` (auth-code collapse through actions, an explicit D5 gate),
  `a1expo-f3` (the missing on-device durable store behind the
  installation-identity dependency), `a1expo-f5` (the full hosted
  conjunction in D4).
- **Expo push service** — `expo-notifications` token acquisition
  (`ExpoPushToken.data`, optional-but-recommended `projectId`,
  `addPushTokenListener` as a native-token rotation signal), the
  `exp.host` send + receipts
  HTTP API (100-message sends, 1,000-id receipt reads, ~15-minute
  receipt guidance, ~24-hour clearing), and its explicit
  tickets-then-receipts, best-effort, no-idempotency,
  no-delivery-claim contract, which this seam mirrors rather than
  hides.
- **Firebase Cloud Messaging** — the reference bar for "push is a core
  mobile feature": token registration, send APIs, topic fan-out; also
  the reference for what honest receipts cannot promise (FCM likewise
  reports handoff, not display).
