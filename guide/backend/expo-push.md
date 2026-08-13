---
title: Expo push notifications
id: backend.expo-push-seam
order: 46
audience: agent-first
capabilities: [backend.expo-push-seam]
authorities: [llp/0143-expo-push-notification-seam.rfc.md, llp/0222-connected-client-predicate.rfc.md, llp/0045-notifications-outbox.rfc.md, src/push.rs, src/connected_clients.rs, src/server.rs, src/admin.rs, packages/snapback-codegen/define.mjs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-client/push-registry.mjs, packages/snapback-cli/fake-expo-push.mjs]
examples: [packages/snapback-cli/fixtures/push-seam]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:1b03a6d605d8591c0d82496900f39eb17acd1209f609feb927610e6bc0f84af6
---

# Expo push notifications

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

<!-- @ref LLP 0143#d0-the-decided-frame-seam-not-capability — this page
teaches the Expo provider seam without turning it into a delivery claim. -->

Snapback's Expo seam keeps device tokens out of application tables, resolves
declared audiences inside the host, and records what happened at Expo's ticket
and receipt boundaries. It is not the first-class notification outbox designed
by [LLP 0045](repo:llp/0045-notifications-outbox.rfc.md), and the target still
reports `notifications: false`.

The local capability manifest reports the separate structured capability
`notifications.expoPushSeam`. Using it requires all of these:

- session auth and a `definePushSeam` declaration;
- the additive `@expo/snapback-client/push-registry` client subpath;
- `SNAPBACK_OUTBOUND_ACTIONS=1` on both generation and the serving process;
- a declared audience whose host-enforced `authorize` clause admits the
  invocation; and
- Expo project credentials and native permission setup owned by the app.

Hosted targets omit the structured capability. There is no hosted native-auth
entry, authenticated token-registration path, provider custody, or durable
receipt-poll home yet.

The local seam's acceptance kit combines the packaged deterministic fake-Expo
carrier with a 2026-08-03 physical iOS development-build witness whose ticket
and receipt both settled `ok`. That external witness is retained in LLP 0143's
implementation record. It does not widen the receipt beyond the never-claims
below, and it does not turn the separate first-class `notifications` capability
on.

## Declare custody, audiences, and retention

`definePushSeam` is installed on a session-auth schema. `appScope` must bind
the EAS project, native application identity, and deployment environment.
Registry and ledger retention are explicit app facts between one day and one
year. Audience declarations are closed: membership resolution, or a bounded
explicit-principal resolver for immediate/system use, plus either membership
authorization or an explicit `system` authorization.

```js fragment reason="Representative declaration; no complete push demo has landed yet"
export const pushSeam = definePushSeam({
  appScope: {
    easProjectId: 'your-eas-project-id',
    applicationId: 'com.example.app',
    environment: 'development',
  },
  registry: { idleRetentionMs: 30 * 24 * 60 * 60 * 1000 },
  audiences: {
    guests: {
      resolve: {
        membership: eventMembers,
        resourceArg: 'eventId',
        roles: ['guest'],
      },
      authorize: {
        membership: eventMembers,
        resourceArg: 'eventId',
        roles: ['host'],
      },
    },
  },
  uses: ['expoPushAccessToken'],
  ledger: { retentionMs: 30 * 24 * 60 * 60 * 1000 },
});

export default defineSchema({ events, eventMembers }, {
  auth: { mode: 'sessions' },
  pushSeam,
});
```

Declare `expoPushAccessToken` as an optional deployment config entry and grant
it in every sending action's `uses`. Accounts without enhanced push security
may leave it unset. Snapback then attempts the request without a bearer; if
Expo requires one, `UNAUTHORIZED` settles as `failed-config` — an
intent-level aggregate state, distinct from the per-message
`expo-error-config` classification (see
[two state vocabularies](#two-state-vocabularies-intent-aggregates-and-per-message-lifecycle))
— rather than being retried. Config values never enter source, handler arguments, or the ledger.
See [Secrets and deployment config](../operating/secrets-and-config.md).

## Register the current installation

Importing the root client adds no push code or property. Attach the explicit
subpath and inject Expo's file-system module to select the conventional
device-scoped default:

```js fragment reason="Expo supplies the native module; Snapback owns the dedicated push file"
import * as ExpoFileSystem from 'expo-file-system';
import { SnapbackClient } from '@expo/snapback-client';
import { createExpoPushInstallationStorage } from '@expo/snapback-client/push-installation-expo';
import { attachPushRegistry } from '@expo/snapback-client/push-registry';

const pushInstallationStorage = createExpoPushInstallationStorage({
  fileSystem: ExpoFileSystem,
});
const client = attachPushRegistry(new SnapbackClient(origin, { bearerToken }), {
  pushInstallationStorage,
});

await client.push.registerExpoToken({
  projectId: 'your-eas-project-id',
  getExpoPushTokenAsync: Notifications.getExpoPushTokenAsync,
});
```

The installation id lives in the dedicated
`snapback-push/installation.v1.json` document-store member, not in the RQS
cache. Ordinary logout preserves it while the server retires the exact session
generation's token row transactionally. Account switching also preserves the
id; registering under the successor session rebinds the device through the
single-owner rule. A full app-data custody wipe must call
`pushInstallationStorage.clear()`; the next registration mints a new id. An OS
app-data reset or reinstall removes the app container and therefore also mints
a fresh id. Apps with another native durable key/value store may still pass a
custom `pushInstallationStorage`; missing custody continues to refuse rather
than fall back to process memory. Web push registration is outside v1.

The app still owns `expo-notifications` setup: OS permission prompts,
`projectId`, foreground behavior, and `addPushTokenListener`. On a rotation
signal, reacquire the Expo token with `getExpoPushTokenAsync` and call
`registerExpoToken` again. Registration is idempotent, rotation is atomic, and
the same token bytes have one live owner per app scope. Explicit logout flows
may also call `client.push.unregisterToken()`; server-side session termination
is the authoritative cleanup if they do not.

Never put Expo token bytes in an application table, query result, log, or
action argument. The protected registry exposes only bounded cardinalities and
retirement facts to operator inspection.

## Send to a declared audience

Generated action contexts expose `ctx.push.send` only when the schema declares
the send/ledger half of the seam. Pass a reference produced by the declared
audience function, not token bytes:

```js fragment reason="Representative action; generated audience names and args are app-specific"
export async function notifyGuests(ctx, { eventId }) {
  return ctx.push.send({
    to: pushSeam.audiences.guests({ eventId }),
    title: 'The plan changed',
    body: 'Open the app for the latest details.',
    data: { eventId },
    dedupeKey: `event:${eventId}:plan-change:v1`,
  });
}
```

The reference itself can be built two equivalent ways. The schema-side form
above (`pushSeam.audiences.guests({ eventId })`) works wherever the schema
module's `pushSeam` export is in scope. Inside a generated action handler,
the context exposes the same helpers without importing the schema:
`ctx.push.audience('guests', { eventId })` and its property twin
`ctx.push.audiences.guests({ eventId })`. Generated contexts type both
through `GeneratedPush`, closing the audience name union and each audience's
exact argument shape; an empty or non-string audience name refuses with
`SNAPBACK_PUSH_SEND_INVALID`. All three spellings produce the same audience
reference — an `{ audience, args }` value, never resolved tokens.

The host validates the reference, authorizes it against current membership,
resolves current members and live registry rows, reserves the durable ledger,
marks `transmitting` before the first provider byte, and sends serial batches
of at most 100 messages. A zero-row audience records `zero-target`; it is not
an error. Reusing a dedupe key with the same binding is a no-op. Reusing it
with a different audience or payload refuses.

Authority depends on the trigger:

- A directly invoked action uses its server-resolved user and must satisfy the
  audience's membership `authorize` clause.
- Cron/system actions may use only audiences declaring `{ system: true }`.
- A mutation may enqueue a deferred action with
  `ctx.jobs.enqueue(action, args, { pushGrant: { to, dedupeKey } })`. Capture
  checks producer membership inside the mutation transaction; the job stores
  only the exact audience reference and dedupe key. At system-authority
  execution the host rechecks that producer's current membership and
  re-resolves recipients. Explicit-principal audiences are refused here.

The return value contains `intentId`, `attempt`, `targetCount`, `batchCount`,
the current aggregate `state`, and `deduplicated`.

If the process dies after claiming a batch but before its durable transmit
marker, maintenance safely sends the exact protected binding after the claim
lease expires. Once the marker exists, recovery settles an unanswered attempt
as `ambiguous` instead. Fresh action reservations are not maintenance work, so
the worker cannot race the action that created them.

## Read handoff facts without reading secrets

Export one `definePushLedgerQuery({ auth: 'authenticated' })`. It accepts only
`intentId`; the host loads the stored audience reference and rechecks its
current authorization before returning flat lifecycle rows. The projection
contains opaque intent, batch, message, and token-row ids plus timing, state,
ticket id, allowlisted error code, and retirement effect. It never contains
token bytes, title/body/data, dedupe key, audience arguments, config, or Expo
prose. Do not query the protected ledger tables directly.

## Skip an immediate push when a client is fresh

Session-auth action contexts on the local target include
`ctx.realtime.hasFreshClient({ principalId })`. You may use it before
`ctx.push.send` as an advisory policy input:

```ts fragment reason="Representative action policy; the generated app supplies its audience-specific push request"
if (await ctx.realtime.hasFreshClient({ principalId })) {
  return { skipped: true, reason: 'connected' };
}
return ctx.push.send(pushRequest);
```

The local capability manifest names `semanticsVersion: 2`, a fixed
`freshnessBudgetMs: 15000`, and the `managed-websocket` plus
`authenticated-poll` transports. The fact is existential across the
principal's devices and tied to this app-instance authority. `false` means
only that no qualifying witness is fresh; it is not proof that the user is
offline. `true` does not prove that a live event was rendered or acknowledged.

Do not use this branch as exactly-once live-vs-push arbitration or to settle a
durable notification intent. That requires LLP 0045's durable intent,
idempotency, attempt, cancellation, and terminal-settlement lifecycle, which
is still a GAP. Hosted targets omit this predicate until their session/push
conjunction and a sound single-authority route or shared aggregation index both
exist.

## Treat ambiguity as possible duplicate display

After a durable `transmitting` marker, a socket drop or timeout means Expo may
have accepted the request even though Snapback did not receive tickets. The
attempt becomes `ambiguous` and is never automatically re-driven.

An explicit operator/app decision may send the same bound intent again with
`redriveAmbiguous: true`. It creates a new attempt marked with an ambiguous
predecessor. **The device may receive the notification twice.** The flag
refuses if no matching ambiguous predecessor exists, and deferred grants may
not authorize it.

HTTP 429/5xx request failures are retryable because the provider refused the
request. `DeviceNotRegistered` at either the ticket or receipt stage retires
and erases the token row. Raw provider prose is always dropped; only the
closed error vocabulary crosses into settlement.

## Interpret receipts narrowly

The local maintenance worker polls at 15 minutes after handoff, then 30
minutes, 1 hour, 2 hours, and 4-hour-capped intervals, for at most seven polls
inside a roughly 24-hour window. It requests at most 1,000 ticket ids at once.
Tests may call `POST /_snapback/api/push/maintenance` with an injected clock
only when a Dev/Test profile uses a loopback provider override; injected time
is refused against the real Expo endpoint.

### Two state vocabularies: intent aggregates and per-message lifecycle

The seam records state at two granularities, and the two closed vocabularies
overlap without being equal — do not switch on one expecting the other's
values:

- **Intent-level aggregate state** — what `ctx.push.send` returns as `state`
  and what an intent row carries. Closed set: `reserved`, `handed-to-expo`,
  `expo-accepted`, `expo-error`, `failed-permanent`, `failed-config`,
  `failed-retryable`, `ambiguous`, `ambiguous-receipt`, `zero-target`. The
  `failed-config` settlement from an unset-but-required
  `expoPushAccessToken` and the `zero-target` empty-audience outcome exist
  only here.
- **Per-message lifecycle state** — what the ledger query's per-recipient
  rows carry. Closed set: `reserved`, `handed-to-expo`, `expo-accepted`,
  `expo-error`, `expo-error-config`, `expo-error-rate`, `failed-permanent`,
  `ambiguous`, `ambiguous-receipt`. The receipt-stage provider
  classifications `expo-error-config` and `expo-error-rate` exist only here.

Reading the shared names:

- `handed-to-expo` means the send endpoint returned a successful ticket.
- `expo-accepted` means Expo's receipt says it handed the message to APNs/FCM.
- `expo-error` (both vocabularies), plus the message-level `expo-error-config`
  and `expo-error-rate`, are closed provider classifications.
- `ambiguous` means request response certainty was lost.
- `ambiguous-receipt` means the bounded receipt window ended without an
  answer.

The seam does not and will not claim: device delivery; notification display;
read or interaction state; OS permission state; exactly-once sending or
duplicate suppression; ordering across recipients or across intents; delivery
latency, availability, or any SLA; continued token validity or current
registration beyond the recorded retirement facts. A product string such as
"invitations sent" is product copy, not a fact this seam backs.

Push payloads pass through Expo and APNs/FCM as plaintext from Snapback's
perspective. Do not put protected row data in `title`, `body`, or `data`.
Prefer an opaque id that the app resolves through an authorized read when the
user opens it.

## Test without exfiltrating tokens

Production sends are pinned to `https://exp.host`. Only a dev/test-profile
server accepts `SNAPBACK_EXPO_PUSH_BASE_URL`, and the value must be a loopback
HTTP(S) origin. The shared conformance fixture scripts ticket responses,
receipt responses, both `DeviceNotRegistered` stages, and a socket close after
request bytes; it uses the same bounded HTTP carrier as production. Import
`startFakeExpoPushService` from
`@expo/snapback-cli/testing/fake-expo-push` for that reusable carrier; the
committed `push-seam` fixture exercises it through the generated app surface.

iOS simulators cannot mint Expo push tokens. Android emulators with Play
services generally can, but deterministic acceptance should still use fixture
tokens and the loopback provider. A real-device receipt is a separate release
witness, not permission to claim delivery or display.

## Anti-patterns

- Do not store push tokens in app rows or expose them to handlers.
- Do not accept a provider URL in an app argument or config entry.
- Do not equate a ticket or receipt with device delivery.
- Do not retry an ambiguous attempt without the explicit duplicate-risk flag.
- Do not defer an arbitrary principal list under system authority.
- Do not put sensitive content in a notification payload.
