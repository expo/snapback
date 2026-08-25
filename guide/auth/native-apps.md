---
title: Authenticate a native app
id: auth.native-apps
order: 3
audience: agent-first
capabilities: [auth.external-identity-broker, auth.shared-development-providers]
authorities: [llp/0024-agent-operating-surface.spec.md, llp/0045-notifications-outbox.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, llp/0151-first-party-identity-integrations.rfc.md, llp/0181-zero-configuration-expo.rfc.md, packages/snapback-client/app-client.mjs, packages/snapback-client/index.mjs, packages/snapback-expo/supervised-environment.mjs, crates/snapback-cli/src/cli.rs, clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift]
examples: [demos/knockoff]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:c6922b6105ce5ea0d0f5f73fdcc5e54a63cab9093ba030d8509bfacfb5a7fa21
---

# Authenticate a native app

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Snapback supports two native session-entry shapes on the local target:

1. a reachable email-code delivery surface drives `/auth/request-code` and
   `/auth/exchange`; or
2. a trusted server-side identity broker authenticates the user through its
   own front door, invokes `auth.mintSession`, and returns the resulting
   Snapback session bearer to that user.

The second shape is the sanctioned bridge for native development and demos
whose identity system is outside Snapback. It is no longer necessary to
hand-write a second Snapback protocol client after the bearer is issued:
JavaScript uses `createExternalSessionClient(baseUrl, { bearerToken })`, while
Swift sets `Configuration.sessionBearer`.

**Expo apps in local development rarely need to hand-build either shape**:
the supervised dev loop (`snapback dev --expo`) returns the binding through
its loopback-only `GET /_snapback/expo/v1/bootstrap`, then the native-default
provider requests and adopts an ordinary session through the later
correlation-gated POST. See
[the supervised Expo development loop](../clients/react-expo.md#appendix-run-the-supervised-expo-development-loop)
before wiring a broker by hand.

An application that uses `SnapbackExpoProvider` can consume the broker's
one-time email-code exchange through `useSnapbackAuth()`:

- declare `externalSessionEntry: true` in `defineAuth` and regenerate;
- let the trusted broker verify the external provider and return only
  `{ challengeId, code }` from the local capture path; and
- call `auth.signInWithExternalCode(exchange)`.

The application Auth facade runs the existing `authExchange` operation through
the same coordinator-owned custody transition as built-in entry. It refuses
before network I/O if the generated policy omits
`external-session-explicit-v1`. This method does not make the broker a
first-party provider and does not widen the local-only claim on this page.

## Sign in with Apple or Google in development

An app declares the providers it offers; the declaration is the only place
provider policy lives. `snapback auth enable apple google` writes it, together
with the `externalSessionEntry` seam the provider completion path redeems
through:

```js source=packages/snapback-cli/auth-setup.test.mjs
  const next = enableProvidersInDeclaration(DECLARATION, ['apple', 'google']);
```

After `snapback generate`, the app calls one method for every provider and every
Adapter:

```js source=packages/snapback-client/app-client.test.mjs
    const entry = appClient.auth.providerEntry('apple');
    assert.equal(entry.adapter, 'snapback-shared-browser');
    assert.equal(entry.identityRealm, 'rehearsal');
    server.respond('/auth/exchange', ({ body }) => {
      assert.deepEqual(body, exchange);
      return Response.json(server.credential());
    });
    const result = await appClient.auth.signIn({ provider: 'apple' });
```

**What actually signs you in.** In local development with no app-owned provider
credentials, `snapback dev --expo` supervises a local broker on the same
loopback origin the client already discovers, and the resolver selects the
`snapback-shared-browser` Adapter. That broker issues **hermetic rehearsal
identities**: they are minted by the supervisor, their issuer names its own
provenance, and nothing in the flow contacts Apple or Google. This is a working
development sign-in with no provider setup — not a real provider login.

A rehearsal identity is app-scoped: its durable subject is derived from the app
id *and* the provider subject, so two apps on the same shared profile never
receive the same Snapback identity, and email never links accounts. Rehearsal
custody cannot enter a staging or production deployment.

The callback carries only `state` and a short-lived one-use code. Redemption
additionally requires the verifier the app kept, so neither value alone
completes a sign-in, and no provider token or Snapback session credential ever
crosses a URL.

### Native readiness requires both halves

Configuration alone never selects app-owned native auth. The installed client
must also carry the matching native integration — `expo-apple-authentication`
for Apple, `@react-native-google-signin/google-signin` for Google — and say so
with its own build receipt. Configuration that is ready while the build is not
keeps local development on the shared browser Adapter, and the projected next
action tells you to rebuild.

`snapback auth status` reports the requested credential policy, the resolved
Adapter, configuration readiness, the profile generation, and one next action
per provider. It never claims native readiness, because the CLI cannot observe
an installed build.

It does observe the shared broker. That broker is mounted by the Expo
supervisor — `snapback dev --expo` — and not by the backend server, so a plain
`snapback dev` answers `SNAPBACK_ROUTE_UNKNOWN` on the shared auth routes. The
supervisor records whether it is serving the broker in its own discovery
descriptor, `.snapback/expo-supervisor.json`, and status reads that back behind
a liveness check on the supervisor process:

```
$ snapback auth status                       # no supervisor
apple: app-owned-native (application, blocked)
  Next: Start snapback dev --expo, or run snapback auth configure apple.

$ snapback dev --expo &
$ snapback auth status                       # supervisor serving the broker
apple: snapback-shared-browser (rehearsal, ready)
google: snapback-shared-browser (rehearsal, ready)
```

Every uncertainty resolves to unavailable: a descriptor left behind by a
crashed supervisor, a supervisor that started without the broker, and a
deployment profile that refuses the shared profile all report `blocked` on
`SNAPBACK_AUTH_PROVIDER_SHARED_UNAVAILABLE` rather than name a broker that
would answer nothing. Which of those it saw is in the JSON as
`sharedDevelopment`.

`--shared-available` remains, and now means only what it says — an assertion
from a caller who knows about a broker this project directory cannot see, such
as one served by another process. It overrides the observation; it does not
replace it, and the observed answer is still reported.

### Resolution is frozen for one attempt

The Adapter is resolved once, before the attempt starts. If it returns
cancellation, a timeout, `invalid_client`, or a token refusal, that *is* the
result of `auth.signIn`. Snapback does not then open the shared browser
Adapter: doing so would change the consent brand, the provider installation,
and possibly the identity realm behind the caller's back, and could hide broken
production configuration behind a working-looking sign-in.

### Moving to your own credentials

`snapback auth configure apple` and `snapback auth configure google` record
public identifiers and secret *references*; they never accept a secret value,
and they emit the provider-console steps that cannot be automated with this
app's own bundle identifier, scheme, and return URL filled in. Apple and Google
expose no client-registration API, so that walkthrough is the honest surface.

Once a provider's identifiers are all recorded, the same command adds that
provider's Expo config plugin to your `app.json` and names the
`npx expo install` and the rebuild that finish the native half. Until then it
adds nothing: an app on the shared development profile is a browser flow and
needs no native integration. Adding the plugin is a source edit, not proof —
readiness still requires the two halves above, and the CLI cannot see your
installed build.

If your app config is a module — `app.config.ts` and its `.js`, `.mjs`, and
`.cjs` spellings — the command does not rewrite it. Config modules are code,
not data, so it names the exact `expo.plugins` edit to make and leaves the file
as you authored it. The install and rebuild steps are owed either way.

Shared and app-owned credentials are separate provider installations. Switching
rotates the auth-profile generation and signs out the incompatible rehearsal
custody; Snapback never merges the two identities by email.

**Not claimed on this page:** Snapback-owned Apple and Google registrations, a
hosted public callback, and app-owned native provider auth proven end to end.
Staging and production refuse shared credentials outright.

## Keep the broker server-side

`auth.mintSession` is a host operation available only in dev/test/demo. It
requires all three independent authorities: the ordinary AdminWrite token, the
process-bound impersonation capability, and active sessions mode. The broker
must live in the trusted server deployment that can hold those authorities.
It authenticates the external user, maps that identity to the email passed to
the host operation, and releases the returned bearer only to that same user.

From a terminal, the paved spelling of the same operation is
`snapback session mint --email <email> --ready-file <ready-file>` (or
`--url` plus the admin token, reading the impersonation capability from
stdin): it attaches the same authorities from the readiness descriptor
instead of you assembling the host-op request by hand.

For a broker that must use HTTP, the canonical
[exact `auth.mintSession` request, response, and refusal shape](../operating/host-ops.md#mint-a-session-over-http)
lives in the host-ops guide.

Never put the admin token, impersonation capability, ready-file, or mailbox
reader in a browser or native bundle. Never expose a generic “mint for email”
endpoint without the broker's own user authentication and abuse controls.

## Carry the adopted bearer

An external bearer is ordinary protocol-client custody, not
`AuthCoordinator` browser custody and not sender-constrained custody. The
client must offer `auth/rr`; auth-scoped live work must additionally offer
`auth/live`, create an authorization namespace, process invalidation snapshots,
and acknowledge them after apply. The first-party JS factory and Swift client
do this.

A browser that must restore sign-in after a full-page reload needs a different
last mile: stage a one-use challenge/code and call ordinary `authExchange` on a
client backed by `createIndexedDbAuthCustodyStorage()`. See the executable
[browser sign-in and reload recipe](../recipes/browser-auth.md). Returning an
external bearer to page state or `createExternalSessionClient` does not become
`AuthCoordinator` custody merely because the caller is a browser.

Replacing or clearing a bearer is an authority transition. In JavaScript use
`await client.replaceBearerToken(nextBearer)` (or `null` to clear): it releases
protected live-query demand, blanks predecessor rows, retires old grants and
transports, and only then fresh-subscribes under the successor. The synchronous
`setBearerToken` method refuses a changed value because it cannot provide that
barrier. A broker that rotates credentials supplies the replacement bearer
explicitly; the external-bearer seam does not silently assume refresh
ownership.

A transition that completes settles — including a downgrade. When the server
answers a handle's successor fresh-subscribe with an authorization refusal
(for example `SNAPBACK_AUTH_PERMISSION_DENIED`), the transition still
resolves; the denial lands on that handle as the frozen
`handle.authorizationDenial` fact (`{ code, message, atMs }`), is delivered to
`onUpdate` observers as an `authorization_denied` update, and renders as the
`error` query state under the React provider. The denied handle stays parked:
the next authority transition (for example rotating back to the original
bearer) fresh-subscribes it and clears the fact — no process restart. Genuine
lifecycle breakage during a transition (transport loss, broken callbacks)
still rejects with an `AggregateError`.

## Know the production boundary

The shipped email provider's capture mailbox and `auth.mintSession` are
non-production only. LLP 0045's production delivery adapter remains unbuilt,
and the Cloudflare arm exposes no sessions routes. This page therefore does
not claim hosted production native auth.

On a sender-constrained deployment, a generic native bearer is also
insufficient: LLP 0077 defines browser WebCrypto custody only, and native
Secure Enclave/Keystore proof transport remains a named design gap.

## Anti-patterns

- Do not fetch the process-local mailbox from a phone.
- Do not ship broker/admin authority in the app.
- Do not describe an external bearer as sender constrained.
- Do not infer hosted support from the local broker seam.
