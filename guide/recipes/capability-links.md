---
title: "Recipe: capability links for Expo and web"
id: recipes.capability-links
order: 15
audience: agent-first
capabilities: [api.external-exposure]
authorities: [llp/0204-app-external-surfaces.rfc.md, llp/0150-agent-token-acquisition.rfc.md, llp/0031-server-route-taxonomy.spec.md, llp/0294-early-expo-workflow-closure.plan.md, crates/snapback-server/src/server.rs, crates/snapback-kernel/src/storage/capability_links.rs, crates/snapback/tests/route_policy_v1.rs, packages/snapback-codegen/auth-artifacts.test.mjs, scripts/check-guide-capability-link-example.mjs]
examples: [packages/snapback-codegen/auth-artifacts.test.mjs, scripts/check-guide-capability-link-example.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.24
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:dc636112af1bf4c02640204a13226a5e75261f71c7ea013eb578170b04bfaf6b
---

# Recipe: capability links for Expo and web

> **Local target only.** Snapback 0.1.24 ships the local anonymous-set slice,
> and only over local carriers. Use it from a same-host web app, iOS Simulator, or an
> Android emulator whose supervised carrier can reach the loopback backend.
> Public-recipient sharing, physical-device delivery, hosted capability links,
> granted-operation links, identity-bearing links, and guest-session entry are
> not shipped. Do not expose the local server through a public tunnel.

Use this recipe for an expiring **share-to-view** URL whose target query is
already callable by an anonymous user. The exact minting session can revoke it
while that session remains current. The recipe covers signed-in mint, share,
crawler-safe inert `GET`, Expo/web intake, explicit `POST` invoke,
use-count/replay handling, expiry, and same-session revocation.

The minted URL names the Snapback server origin. On another computer or phone,
its loopback host names that recipient's device, not the development machine.
The URL is therefore not a public share carrier. The supported journey here is
same-host web or a supervised simulator/emulator route; a hosted application
edge and physical-device recipient carrier remain future work. Use the
[Expo carrier table](../clients/react-expo.md#choose-simulator-emulator-or-usb-routing)
for exact routing constraints, and keep the
[local-target boundary](../auth/targets.md#a-public-tunnel-does-not-make-the-loopback-server-production-ready)
when choosing a carrier.

An `sbl_…` capability-link token is a secret URL and bearer invocation input
for one link. It is **not** a session, user, principal, login, guest identity,
OAuth token, or general deep link grant. Never place it in a `SnapbackClient`
`bearerToken`, `Authorization`, an auth coordinator, SecureStore, AsyncStorage,
localStorage, IndexedDB, the RQS store, an app table, logs, analytics, crash
reports, or referrers.

## Choose the right link before building

The shipped link adds pinned arguments, attribution, a budget, expiry, and an
optional use count to one exposed function in the **external anonymous set**:
`auth: 'public'`, or `auth: 'optional-user'` invoked without a user. It does
not make protected data or a protected operation anonymous.

| App intent | Use today | Boundary |
| --- | --- | --- |
| **Invite link** | Shipped capability link only for an already-anonymous RSVP/capture function; otherwise an app-owned invitation-token row | Group membership, protected content, principal creation, and identity-bearing acceptance require the unshipped granted-operation/identity flow. |
| **Capture link** | Shipped single-use or approval-per-use link when the capture mutation/action is deliberately anonymous and exposed | “Enter as guest, keep a draft, claim it later” is not this feature. First-party guest entry is unshipped and awaiting owner review. |
| **Share-to-view** | Shipped query link when the exact query is anonymous and exposed | A private row, owner query, or membership query needs the unshipped granted-operation link; do not weaken the function to make the link fit. |
| **Upload request** | App-owned request row plus the normal authenticated [asset upload](../backend/assets.md) flow | A capability link is not upload custody or an asset-owner session. The implemented slice has no capability-link asset-upload ceremony. |
| **Account claim** / **claim link** | App-owned one-time claim-token row and an authenticated app ceremony, if the app owns that protocol | Account/guest claim is identity authority. Granted-operation links and first-party guest entry remain unshipped; a capability link cannot claim an account. |

An app-owned token row remains appropriate when the token represents durable
product workflow state rather than one function invocation: named invite
acceptance, staged upload ownership, account claim, guest continuity, or a
workflow with product-specific resend/rotation rules. Do not build such a row
for the share-to-view case below.

## Expose one anonymous query

The function must say `auth: 'public'` (or explicitly `optional-user`) and the
schema must expose that exact name. This codegen fixture is the minimal shape
used by the Guide's CI:

```js source=packages/snapback-codegen/auth-artifacts.test.mjs
export const listTodos = defineLiveQuery({
  table: 'todos',
  index: 'by_title',
  filter: [eq('title', lit('fixed'))],
  auth: 'public',
  authorityIndependent: true,
});
```

```js source=packages/snapback-codegen/auth-artifacts.test.mjs
  api: {
    enabled: true,
    functions: { listTodos: { expose: true, since: 'v1' } },
    origins: ['https://example.com:8443'],
  },
```

Capability-link storage and routes activate with `api.enabled` on a
sessions-mode app. V1 mint admission requires a live signed-in human session,
an exposed function whose effective auth is `public` or `optional-user`, and a
valid pinned/caller argument template. It does **not** ask whether the issuer
could invoke a protected function through their session: even an exposed
protected function the issuer can call directly is refused with
`SNAPBACK_CAPABILITY_LINK_FUNCTION_NOT_ANONYMOUS`.

Landing and invoke re-check that the API is enabled and the function remains
exposed and anonymously callable. They also require an active, unexpired,
unexhausted link and a still-live human minter principal. Use-time life follows
the principal, not the minting session: refreshing, rotating, or ending that
session does not kill an otherwise valid link.

## Mint and share from the issuer boundary

`POST /capability-links` requires a signed-in session bearer and returns the
raw token exactly once inside `url`. The current first-party application client
does not ship a typed `mintCapabilityLink` wrapper and deliberately does not
reveal coordinator-owned bearer bytes. Use the HTTP helper only inside an
issuer integration that already owns an explicit session bearer. Do not read
an undocumented `appClient.client.bearerToken` property or copy browser/native
custody into application state to make this call.

```js source=scripts/check-guide-capability-link-example.mjs
export async function mintShareLink(
  fetchImpl,
  serverOrigin,
  sessionBearer,
  { functionName = 'listTodos', expiresInMs = 3_600_000, uses = 1 } = {},
) {
  const response = await fetchImpl(new URL('/capability-links', serverOrigin), {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: {
      authorization: `Bearer ${sessionBearer}`,
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: JSON.stringify({
      function: functionName,
      pinnedArgs: {},
      callerArgs: [],
      expiresInMs,
      uses,
    }),
  });
  if (!response.ok) throw new Error('capability-link mint failed');
  const minted = await response.json();
  return Object.freeze({
    id: minted.id,
    serverUrl: new URL(minted.url, serverOrigin).href,
    expiresAtMs: minted.expiresAtMs,
    remainingUses: minted.remainingUses,
  });
}
```

Use `serverUrl` directly only when the recipient carrier can reach that exact
server origin. Do not print it. The response also returns the safe management
id `cplk_…`. Retain that id for a revoke button only while the exact minting
session and authority instance remain current; a replacement session cannot
use it. The URL token itself must not enter durable app state.

For a supervised simulator/emulator app, construct a custom-scheme URL only by
validating the minted server URL against the one configured origin and closed
token shape:

```js source=scripts/check-guide-capability-link-example.mjs
export function toExpoCapabilityUrl(serverUrl, options) {
  const target = resolveCapabilityTarget(serverUrl, options);
  if (target === null || !/^[a-z][a-z0-9+.-]*$/u.test(options.expoScheme)) {
    throw new TypeError('capability server URL or Expo scheme is invalid');
  }
  const token = new URL(target).pathname.split('/').at(-1);
  return `${options.expoScheme}://share/${token}`;
}
```

This changes only the app ingress carrier; invocation still targets the exact
local `serverOrigin`. It does not make a physical device or public recipient
able to reach a loopback server.

The local target defaults to seven days and refuses expiry beyond thirty days.
Set a shorter application-specific `expiresInMs` whenever possible. `uses: 1`
is a **single-use token**. Omit `uses` for an expiry-bounded query link (with
same-session revoke while that session remains current), or set a positive
count for a bounded multi-use query link.

For mutations/actions, `uses: 1` is required unless every use is approval-
gated by the function declaration or mint request (`approval: true`). An
approval-per-use link creates a pending effect; the minter must explicitly
approve it. Possession never chooses an approver. Multi-use approval is not
multi-use direct write authority.

## Keep shared URLs crawler-safe

The minted server URL is safe to unfurl: `GET /capability-links/{token}` only
returns bearer-free metadata (`id`, function, kind, caller-argument names,
expiry, remaining uses, and approval mode). It does not invoke the function,
consume a use, mutate link state, or create an approval request. The actual
read or write happens only at `POST /capability-links/{token}/invoke` after an
explicit user action.

Snapback marks the mint and token-bearing routes `no-store`, applies
`Referrer-Policy: no-referrer`, and normalizes the registered `{token}` path
for diagnostics/telemetry. Keep those properties through any proxy. A custom
web landing route such as `/share/{token}` must also:

- redact the path before access/application/error logging;
- send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`;
- render no third-party scripts, pixels, fonts, images, or auto-submitting
  forms; and
- scrub the address bar before analytics or other app subsystems mount.

If the frontend cannot guarantee all four, share the minted Snapback URL
directly. Do not put it in a `?token=` parameter, redirect it through a link
shortener, or add campaign parameters.

## Strip Expo links before router state exists

Do not add a `Linking.addEventListener` beside Expo Router. That listener is
additive: the router or another subscriber can persist the same secret URL
before your callback runs. Reserve capability-link ingress at Expo Router's
native-intent boundary instead. Put this wrapper in `app/+native-intent.tsx`:

```ts fragment reason="application-owned Expo Router boundary wiring"
import { redirectCapabilitySystemPath } from '../capability-link-intake';
import { capabilityLinkOptions } from '../capability-link-options';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return redirectCapabilitySystemPath({ path }, capabilityLinkOptions);
}
```

The checked implementation runs before Expo Router creates navigation state.
It moves a valid target into a process-local, one-use handoff and returns a
changing clean route such as `/shared/1`. The sequence is not a secret and
contains no token; changing it makes a second intent observable while the
shared screen is already warm. A malformed token-bearing path returns the
clean `/invalid-link` route; unrelated paths pass through unchanged.

```js source=scripts/check-guide-capability-link-example.mjs
let nativeCapabilityHandoffSequence = 0;
let pendingNativeCapabilityTarget = null;

export function redirectCapabilitySystemPath({ path }, options) {
  const target = resolveCapabilityTarget(path, options);
  if (target !== null) {
    nativeCapabilityHandoffSequence += 1;
    const handoffSequence = String(nativeCapabilityHandoffSequence);
    pendingNativeCapabilityTarget = Object.freeze({ handoffSequence, target });
    return `/shared/${handoffSequence}`;
  }
  if (typeof path === 'string' && path.includes('sbl_')) return '/invalid-link';
  return path;
}

export function takePendingNativeCapabilityTarget(handoffSequence) {
  if (pendingNativeCapabilityTarget?.handoffSequence !== String(handoffSequence)) return null;
  const { target } = pendingNativeCapabilityTarget;
  pendingNativeCapabilityTarget = null;
  return target;
}
```

Implement the screen as `app/shared/[handoffSequence].tsx`. Take the pending
target whenever that non-secret route parameter changes, not only on mount;
then construct `openCapabilityLink` and render analytics or other application
subsystems. This is the warm-start signal for a second share intent. If the
take returns `null`, render the unavailable state.

```tsx fragment reason="application-owned dynamic Expo Router screen wiring"
const { handoffSequence } = useLocalSearchParams<{ handoffSequence: string }>();
const handledHandoffSequence = useRef<string | null>(null);

useEffect(() => {
  if (handledHandoffSequence.current === handoffSequence) return;
  handledHandoffSequence.current = handoffSequence;
  const target = takePendingNativeCapabilityTarget(handoffSequence);
  // Open target, or render unavailable when it is null.
}, [handoffSequence]);
```

Do not mirror the secret target into params, navigation state, a React store,
or durable storage. The checked parser accepts only one fixed server origin,
one fixed web origin, one fixed Expo scheme, and the exact `sbl_` token shape;
it rejects query strings, fragments, embedded credentials, foreign origins,
and arbitrary callback origins.

```js source=scripts/check-guide-capability-link-example.mjs
const TOKEN_PATTERN = /^sbl_[A-Za-z0-9_-]{43}$/u;
const UNAVAILABLE = 'SNAPBACK_CAPABILITY_LINK_UNAVAILABLE';
```

```js source=scripts/check-guide-capability-link-example.mjs
function resolveCapabilityTarget(rawUrl, {
  serverOrigin,
  webOrigin,
  expoScheme,
}) {
  let incoming;
  try {
    incoming = new URL(rawUrl);
  } catch {
    return null;
  }
  if (incoming.username || incoming.password || incoming.search || incoming.hash) return null;

  const expectedWebOrigin = new URL(webOrigin).origin;
  const expectedServerOrigin = new URL(serverOrigin).origin;
  let token = null;
  if (incoming.origin === expectedServerOrigin) {
    token = incoming.pathname.match(/^\/capability-links\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  } else if (incoming.origin === expectedWebOrigin) {
    token = incoming.pathname.match(/^\/share\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  } else if (
    incoming.protocol === `${expoScheme}:`
    && incoming.hostname === 'share'
  ) {
    token = incoming.pathname.match(/^\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  }
  if (!TOKEN_PATTERN.test(token ?? '')) return null;
  return new URL(`/capability-links/${token}`, serverOrigin).href;
}
```

For web, read and scrub the URL before mounting analytics or third-party
subresources:

```js source=scripts/check-guide-capability-link-example.mjs
export function consumeWebCapabilityLocation(windowLike) {
  const rawUrl = windowLike.location.href;
  windowLike.history.replaceState(null, '', '/shared');
  return rawUrl;
}
```

The initial web request still reaches your edge with the token path, so
`replaceState` complements rather than replaces the proxy controls above.
Neither native-intent rewriting nor `replaceState` can erase OS/browser share
history, notification previews, clipboard history, or records retained by the
channel that delivered the URL. Bound that residual exposure with the shortest
practical expiry, a small use count, and same-session issuer revocation while
it remains available.

## Preview, then invoke only on a user action

The checked controller keeps the token-bearing server URL only in a volatile
closure. Its public snapshot contains only the server's bearer-free landing
projection. Opening performs one `GET`; it never invokes automatically.

Set `fetchImpl` to raw platform fetch, for example
`globalThis.fetch.bind(globalThis)`, or to a wrapper proven never to add the
coordinator bearer. Do not pass a `SnapbackClient` authenticated transport.
The token is the complete credential on both landing and invoke: the server
refuses **any** `Authorization` header on either request with
`SNAPBACK_CAPABILITY_LINK_UNAVAILABLE`, even when the bearer is otherwise a
valid signed-in session.

```js source=scripts/check-guide-capability-link-example.mjs
async function requestCapability(fetchImpl, url, method, args) {
  const response = await fetchImpl(url, {
    method,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify({ args }) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return Object.freeze({
      ok: false,
      code: payload?.diagnostic?.code ?? 'REQUEST_FAILED',
    });
  }
  return Object.freeze({ ok: true, payload });
}
```

```js source=scripts/check-guide-capability-link-example.mjs
export async function openCapabilityLink(rawUrl, options) {
  let target = resolveCapabilityTarget(rawUrl, options);
  if (target === null) return Object.freeze({ status: 'invalid-link' });

  let previewRequest = await requestCapability(options.fetchImpl, target, 'GET');
  if (!previewRequest.ok) {
    target = null;
    return Object.freeze({
      status: previewRequest.code === UNAVAILABLE ? 'unavailable' : 'request-failed',
      code: previewRequest.code,
    });
  }
  let preview = previewRequest.payload;
  let terminal = null;

  const snapshot = () => Object.freeze(terminal ?? { status: 'ready', preview });
  const refresh = async () => {
    if (target === null) return snapshot();
    previewRequest = await requestCapability(options.fetchImpl, target, 'GET');
    if (!previewRequest.ok) {
      terminal = Object.freeze({
        status: previewRequest.code === UNAVAILABLE ? 'unavailable' : 'request-failed',
        code: previewRequest.code,
      });
      target = null;
    } else {
      preview = previewRequest.payload;
    }
    return snapshot();
  };

  return Object.freeze({
    snapshot,
    refresh,
    async invoke(args = {}) {
      if (target === null) return Object.freeze({ invoked: false, state: snapshot() });
      const invokeTarget = `${target}/invoke`;
      const result = await requestCapability(options.fetchImpl, invokeTarget, 'POST', args);
      if (!result.ok && result.code === UNAVAILABLE) {
        terminal = Object.freeze({ status: 'unavailable', code: result.code });
        target = null;
      } else if (result.ok && preview.remainingUses === 1) {
        terminal = Object.freeze({ status: 'used' });
        target = null;
      } else {
        await refresh();
      }
      return Object.freeze({ invoked: true, result, state: snapshot() });
    },
  });
}
```

Create this controller after URL intake. Render `controller.snapshot()` and
wire `controller.invoke({})` to a button press; never call it in a mount effect,
route loader, preview render, or link listener. Pass only raw fetch:

```js fragment reason="application-owned controller construction"
const controller = await openCapabilityLink(rawUrl, {
  ...capabilityLinkOptions,
  fetchImpl: globalThis.fetch.bind(globalThis),
});
```

| State | UI | Network behavior |
| --- | --- | --- |
| `invalid-link` | “This link is malformed.” | None. |
| `ready` | Function label, expiry, remaining-use facts, and an explicit View/Submit button | Inert `GET` already completed; button performs `POST`. |
| `used` | “This single-use link has been used.” | The volatile target is cleared; replay performs no request. |
| `unavailable` | “This link is expired, used, revoked, or unavailable.” | The server deliberately gives the same non-enumerating refusal for all terminal causes. |
| `request-failed` | Retry without echoing the URL | No diagnostic, exception, or UI copy includes the token. |

After a multi-use invocation, the controller performs another inert `GET` to
refresh `remainingUses`. A successful single-use invocation clears the target
locally. A server-side expiry, exhausted use count, successful same-session
revocation, or deactivated minter principal returns the same
`SNAPBACK_CAPABILITY_LINK_UNAVAILABLE`; the app must not distinguish them.

The issuer can revoke with `DELETE /capability-links/{id}` only from the exact
minting session and authority instance. A successful same-session revoke is
immediate at the next landing/invoke gate. After refresh, rotation, or sign-out,
a replacement session gets `SNAPBACK_CAPABILITY_LINK_REVOKE_DENIED`; the link
does not die and remains usable until expiry, use exhaustion, or minter-
principal deactivation. Treat revoke as a same-session convenience, not a
durable issuer control. Bound every link with the shortest practical
`expiresInMs` and a small `uses` count.

Keep `id` and token roles separate: management uses the safe id; recipients use
the secret URL.

```js source=scripts/check-guide-capability-link-example.mjs
export async function revokeShareLink(fetchImpl, serverOrigin, sessionBearer, id) {
  const response = await fetchImpl(
    new URL(`/capability-links/${encodeURIComponent(id)}`, serverOrigin),
    {
      method: 'DELETE',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        authorization: `Bearer ${sessionBearer}`,
        'x-snapback-auth-client-protocol': '1',
      },
    },
  );
  if (response.status !== 204) throw new Error('capability-link revoke failed');
}
```

The issuer bearer remains in its existing custody boundary; only the safe
management id crosses into the revoke-button state. After a successful
same-session revocation, a recipient's next `refresh()` or `invoke()` converges
on `unavailable` without revealing whether revocation, expiry, exhaustion, or
principal deactivation caused it.

## Run the executable proof

The Guide consistency lane runs:

```sh
node scripts/check-guide-capability-link-example.mjs
```

It generates a sessions/API fixture, boots the configured native Snapback
runtime, signs in, and proves against the real routes that protected functions
fail the v1 anonymous mint gate; repeated crawler `GET` is inert; any
`Authorization` on token `GET`/`POST` is refused; explicit raw-fetch `POST`
consumes uses; exhausted server-side replay, an injected expiry boundary, and
real same-session `DELETE` revocation converge on the unavailable diagnostic;
another session cannot revoke; ending the minting session does not kill the
link; and every mint/token/management response carries `Cache-Control:
no-store` and `Referrer-Policy: no-referrer`. It also proves that cold and warm
Expo native-intent rewriting gives the router only changing clean non-secret
routes, each volatile handoff is one-use, web scrubbing precedes opening, and
public UI state contains no token.

## Anti-patterns

- Creating an app token table for an anonymous share-to-view query that fits
  this shipped slice.
- Weakening a protected query to `public` so an anonymous-set link can reach it.
- Treating a capability URL as a guest session, login, principal, or general
  deep link grant. Guest entry remains unshipped and awaits owner review.
- Putting the token in `Authorization`, client auth custody, durable storage,
  logs, analytics, crash reports, query parameters, redirects, or referrers.
- Reusing an authenticated client transport for landing/invoke, or assuming a
  replacement session can revoke a link minted by an earlier session.
- Adding a capability-link `Linking` listener beside a router or another URL
  consumer; intercept and strip at the exclusive pre-navigation boundary.
- Treating a loopback server URL or custom-scheme wrapper as a public or
  physical-device share carrier, or tunnelling the local server to make it one.
- Invoking on `GET`, mount, route load, link receipt, crawler preview, or any
  event other than an explicit user action.
- Claiming granted-operation capability links ship. They are commissioned
  design only; the current link cannot reveal protected data or acquire
  identity/authority.
