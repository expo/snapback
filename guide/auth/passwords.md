---
title: Email and password
id: auth.passwords
order: 2
audience: agent-first
capabilities: [auth.passwords, auth.sessions, auth.browser-session-custody, auth.application-bootstrap-native-custody]
authorities: [llp/0227-password-credential-auth.rfc.md, llp/0214-snapback-identity-core.spec.md, llp/0215-effect-budgets.spec.md, llp/0011-auth-and-permissions.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0238-explicit-client-lifecycles.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, crates/snapback-auth/src/auth/provider.rs, crates/snapback-server/src/auth/runtime.rs, crates/snapback-types/src/auth/wire.rs, crates/snapback-types/src/contract_types.rs, crates/snapback-kernel/src/storage/auth_identity.rs, crates/snapback-server/src/server.rs, crates/snapback-cli/src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/app-client.mjs, packages/snapback-client/app-client.test.mjs, packages/snapback-client/index.mjs, packages/snapback-client/password-auth.test.mjs, packages/snapback-react/auth-bootstrap.test.mjs, packages/snapback-react/index.mjs, packages/snapback-expo/provider-auth-bootstrap.test.mjs, packages/snapback-expo/provider.mjs, packages/snapback-admin-client/index.mjs]
examples: [packages/snapback-cli/templates/react, packages/snapback-cli/templates/expo-chat, tests/fixtures/application-auth/browser-explicit/application, demos/browser-auth]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:eaff689bf18067532fde1b0fc3ed72bc259043893ac37fd2c914974a76df01bd
---

# Email and password

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Password login is a credential class on the ordinary
[sessions surface](./sessions-and-principals.md). A successful signin runs the
same session-creation core as an email-code exchange and returns the same
credential response. There is **no parallel identity system, no parallel token,
and no separate session shape** — one principal, several credentials.

This is the first sign-in method a browser app can offer end users without a
mail adapter. Email-code login still has no self-serve production path (no
delivery), so if you need a real user to sign themselves in today, this is it.

<!-- since: 0.1.21 -->
## Declare email identifiers before activation

Choose the password identifier in the app's `defineAuth` program and pass that
program to `defineSchema(..., { auth: { mode: 'sessions' }, authProgram })`.
Use `identifier: 'email'` for the email-v1 canonicalizer:

```js source=packages/snapback-cli/templates/react/snapback/schema.mjs
const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});
```

Codegen derives the non-secret `app.authBootstrap` policy from that normalized
auth program and adds `auth.application-bootstrap.v1` to the generated app's
required capabilities. Do not hand-author either fact. Binding admission
intersects the generated password mechanism with the target's
`auth.passwords` capability before credential UI can issue network work. The
React template's static acceptance check pins both generated facts:

```js source=packages/snapback-cli/templates/react/acceptance.static.mjs
assert.equal(descriptor.authBootstrap.format, 'snapback.application-auth-bootstrap.v1');
assert(descriptor.capabilities.required.includes('auth.application-bootstrap.v1'));
```

`identifier: 'username'` selects username-v1. An app with no declared password
mechanism keeps the existing username-v1 default. The choice is stored in
catalog v4 at the first sessions activation and is immutable afterward;
codegen/startup refuses a later contradictory declaration with
`SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE` instead of reinterpreting
existing identities.

The default password minimum is 12 decoded UTF-8 bytes. To choose a different
app-wide minimum, set `minimumLength` on the password mechanism:

```js fragment reason="policy-only excerpt from the defineAuth password mechanism shown above"
password: {
  kind: 'password',
  identifier: 'email',
  provider: 'builtIn',
  recovery: 'recoveryCodes',
  minimumLength: 8,
}
```

The declaration is a safe integer from 8 through 128; every password
mechanism in one program must resolve to the same value or codegen refuses
`SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_CONFLICT`. The maximum remains 1,024
UTF-8 bytes, and common-password screening still applies. Omit the field to
keep 12. This is a startup policy, so restart the backend after changing it. An
invalid declaration refuses codegen/startup with
`SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID`; an entered password that
misses the active policy refuses with `SNAPBACK_AUTH_PASSWORD_POLICY`, whose
redacted details name the active minimum, maximum, default, and `defineAuth
mechanisms.<name>.minimumLength` configuration path.

<!-- since: 0.1.23 -->
## Sign up, then sign in

> **One application client owner is one custody context.** In a Node
> acceptance process, constructing multiple clients without an explicit
> `storagePartition` can make personas share login: the second client adopts
> the authenticated durable default owner and can have the same user. Use one
> stable partition per persona/worker from the
> [multi-persona client recipe](../recipes/multi-persona-clients.md).

For an ordinary React application, construct one application client from the
generated `app` and the admitted environment binding, then give that owner to
`SnapbackProvider`. The clean browser Explicit fixture is runnable first-party
source; its host supplies the admitted binding and platform:

```js source=tests/fixtures/application-auth/browser-explicit/application/App.mjs
import React from 'react';
import { createSnapbackAppClient } from '@expo/snapback-client';
import {
  SnapbackProvider,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
} from '@expo/snapback-react';

import { app } from './snapback/generated/app.mjs';
import { createAuthPanel } from '../../shared/auth-panel.mjs';

const AuthPanel = createAuthPanel({
  useAuth: useSnapbackAuth,
  useCurrentPrincipal: useSnapbackCurrentPrincipal,
});

export async function createApplication({ binding, platform, now, onSnapshot }) {
  const appClient = await createSnapbackAppClient({ app, binding, platform, now });
  return Object.freeze({
    app,
    appClient,
    element: React.createElement(
      SnapbackProvider,
      {
        appClient,
        fallback: (state) => React.createElement(
          'pre',
          { 'data-fixture': 'boot' },
          JSON.stringify(state),
        ),
      },
      React.createElement(AuthPanel, { onSnapshot }),
    ),
  });
}

export { app };
```

`fallback` owns construction states. When children render, the bootstrap is
`ready`: binding, custody, client, and authority synchronization have settled.
`ready` does **not** mean signed in. A cold password-only app still settles a
server-witnessed anonymous principal so the entry form is reachable; generated
`anonymousPublic` controls anonymous app-data access, not whether boot can
finish.

Inside the provider, use the canonical facade and principal projection. The
template clears any previous recovery projection before every operation, then
keeps the signup result only long enough to render its one-time codes:

```tsx source=packages/snapback-cli/templates/react/src/App.tsx
export function App() {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const workspace = useSnapbackQueries(workspaceQueries);
  const createTodo = useSnapbackMutation(api.createTodo);
  const connection = useSnapbackConnection();
  const [email, setEmail] = useState('person@example.com');
  const [password, setPassword] = useState('replace-this-password');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const todos = workspace.queries.todos.status === 'ready'
    || workspace.queries.todos.status === 'refreshing'
    ? workspace.queries.todos.data
    : [];

  const signUp = async () => {
    setRecoveryCodes(null);
    const result = await auth.signUpWithPassword({ email, password });
    setRecoveryCodes(result.recoveryCodes);
  };
  const signIn = async () => {
    setRecoveryCodes(null);
    await auth.signInWithPassword({ email, password });
  };
  const signOut = async () => {
    setRecoveryCodes(null);
    await auth.signOut();
  };
```

Render all five `CurrentPrincipalSnapshot` states distinctly: `loading`,
`anonymous`, `authenticated`, `refreshing`, and `blocked`. Only the
`authenticated` arm has a current `userId`. The template's account UI also
makes the recovery handoff explicit:

```tsx source=packages/snapback-cli/templates/react/src/App.tsx
        {recoveryCodes ? (
          <aside>
            <strong>Save these recovery codes now. They are shown once.</strong>
            <pre>{recoveryCodes.join('\n')}</pre>
          </aside>
        ) : null}
```

The application must hand those codes to the user for separate safe custody
at signup. They are not session credentials: do not put them in the app
client, general persistence, logs, analytics, diagnostics, or a later account
screen. Snapback cannot read them back. Clear the projection when the user
leaves the handoff or starts another auth action. Recovery consumption and
rotation each return a new one-time set and require the same handling; see
[Recovery codes are the recovery path](#recovery-codes-are-the-recovery-path).

The complete ordinary sequence is:

1. Wait for provider `ready`; `useSnapbackCurrentPrincipal()` reports the
   settled anonymous arm.
2. Call `auth.signUpWithPassword`. Save the returned recovery codes now; the
   principal projection becomes `authenticated` only after coordinator
   adoption and its barrier settle.
3. On a full browser reload, construct the same app client again. Browser and
   Expo web use IndexedDB plus Web Locks, so the owner restores the settled
   principal without another signup or sign-in. `dispose()` only releases the
   process projection; it does not sign out or delete durable custody.
4. Call `auth.signOut()`. The provider blanks predecessor protected state,
   revokes the session, settles anonymous custody, and only then publishes the
   anonymous principal.
5. Call `auth.signInWithPassword` for the existing account. Sign-in returns
   the ordinary credential projection, not recovery codes.
6. To switch users, sign out first, replace the form identity, then sign in or
   sign up. Entry while an application-entered or restored principal is still
   authenticated refuses with a typed `signOut` remediation; there is no
   implicit latest-user-wins switch.

### Claim a guest with a password

When the generated policy includes `guest-v1`, the same facade can first run
`await auth.enterAsGuest()` and later call
`auth.claimGuestWithPassword({ email, password })`. Claim preserves the guest
principal, revokes its guest-era sessions, and adopts the password successor
through the ordinary coordinator barrier. Its recovery codes are a one-time
return boundary with the same handling as signup. If the email already belongs
to another principal, `SNAPBACK_AUTH_GUEST_CLAIM_COLLISION` refuses without
revealing that account or taking it over. A reaped, expired, logged-out, or
non-guest predecessor fails as the uniform invalid-guest-session class.

The browser restoration path is package-tested against a fresh application
client over the same durable custody record:

```js source=packages/snapback-client/app-client.test.mjs
    restored = await createSnapbackAppClient(input);
    assert.equal(restored.auth.currentPrincipal().status, 'authenticated');
    assert.equal(
      restored.auth.currentPrincipal().provider,
      null,
      'restoration does not fabricate the provider availability key as issuance provenance',
    );
    assert.equal(restored.bootstrapState().authoritySource, 'durable-restored');
```

### Use the same owner through Expo

An Expo application passes only the generated `app` to the ordinary provider.
When that descriptor carries the generated bootstrap policy and required
capability, `SnapbackExpoProvider` resolves the environment and delegates to
the same application-client owner; its `useSnapbackAuth` and
`useSnapbackCurrentPrincipal` exports project the same contracts. The current
`expo-chat` template keeps this composition at the root:

```tsx source=packages/snapback-cli/templates/expo-chat/App.tsx
export default function App() {
  const [thread, setThread] = useState<Thread | null>(null);
  return (
    <SnapbackExpoProvider app={app} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <TestPersonaProvider>
        <AccountEntry />
        {thread
          ? <ChatScreen conversationId={thread.id} title={thread.title} onBack={() => setThread(null)} />
          : <InboxScreen onOpen={(id, title) => setThread({ id, title })} />}
      </TestPersonaProvider>
    </SnapbackExpoProvider>
  );
}
```

**Expo web** selects the shipped browser IndexedDB/Web Locks carrier and has
the same durable reload restoration as React web. **Both native OS paths ship
at the exact iOS/Android + `single-runtime` tuples in the published 0.1.24
closure** (first publish recorded in
[the closed custody first-publish gate](repo:issues/closed/20260816-custody-first-publish-gate.md));
neither path falls back to memory. The iOS receipt proves only the share-sheet extension kind. Its
built/embedded Notification Service Extension remains a nonclaim because
simulator `simctl push` cannot invoke that service stage. The disposable
cross-platform `expo-chat` template
therefore keeps `custody: 'volatile-explicit'`: it can exercise
signup/sign-in/sign-out but cannot claim process-death restoration or supported
relaunch. Read [Authenticate a native app](./native-apps.md) for the native
broker and custody threat boundary, and [Targets](./targets.md) before making
any hosted or production claim.

### Keep custom identity brokers on the advanced seam

If the app already has an external identity front door, custom gateway, or
application-owned identity binding, keep that explicit composition on the
[browser sign-in and reload custody recipe](../recipes/browser-auth.md). That
recipe deliberately owns a trusted broker, `AuthCoordinator`, and one-use
exchange; it is not a second spelling for the first-party password journey.
The ordinary and advanced owners cannot share one app/storage partition.

### Use the low-level methods only in advanced compositions

The underlying client methods remain available for custom shells and tests.
`authPasswordSignup` mints an ordinary session and adopts it into an
application-supplied `AuthCoordinator`, exactly as `authExchange` does. You
need no admin token, no impersonation capability, and no `auth.mintSession`.

```js source=packages/snapback-client/password-auth.test.mjs
    const result = await fixture.client.authPasswordSignup({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.equal(result.session.userId, USER);
    assert.equal(fixture.coordinator.authority.userId, USER);
    assert.equal(Object.hasOwn(result, 'token'), false);
```

`authPasswordSignIn` takes the same `{ email, password }` and returns the same
shape. After either, the client holds an ordinary session: protected queries,
refresh, the logout barrier, and reload restoration all behave exactly as they
do after an email-code exchange.

Both methods require an `AuthCoordinator` and an anonymous predecessor — they
create a fresh authority, so they adopt through the same anonymous-issuance
path `authExchange` uses. The bearer is never returned to your code; the
coordinator owns it. An ordinary React or Expo app should not construct that
coordinator itself; use the application-client/provider journey above.

## The exact session shape

Two different shapes carry the user id, at two layers. Both are real; use the
one for the layer you are at.

**On the wire**, `POST /auth/password/signin` returns the LLP 0057 composed
credential response — the same five fields as `/auth/exchange`:

```text
{
  "tokenType": "Bearer",
  "token": "…",
  "refreshAfter": 604800000,
  "session": {
    "id": "…",
    "userId": "usr_…",          ← the server-issued principal
    "provider": "local-password",
    "createdAt": 0,
    "expiresAt": 0,
    "absoluteExpiresAt": 0
  },
  "authorityDescriptor": { "descriptorVersion": 1, "authorityInstanceId": "aut_…", "sessionGeneration": 1 }
}
```

**In the client**, the session projection nests authority, and
`session.authority.userId` is the principal:

```text
session.authority.userId        ← principal id, client-side projection
session.authority.isAuthenticated
credential.session.userId       ← the same principal, wire response
```

`session.provider` reports `local-password` at mint **and on every later
refresh**, so a session's credential class stays legible for its whole life.

Signup additionally returns `recoveryCodes` — the only response that carries a
sixth field. Everything else stays byte-shape-identical to `/auth/exchange`.

## Recovery codes are the recovery path

Signup returns eight one-time recovery codes. **They are shown exactly once**
and are not readable again — not through the admin console, not through any
route. Store them at signup or lose them.

- `authRecoveryConsume({ email, code })` mints a session and automatically
  replaces the whole set. A consumed code cannot be reused.
- `authRecoveryRotate()` replaces the set for an authenticated principal —
  use it after suspected disclosure.

Recovery codes never enter coordinator custody, the public credential
projection, or error diagnostics.

## Changing a password

`authPasswordChange({ currentPassword, newPassword })` requires both an
authenticated session **and** the current password — a stolen bearer alone
cannot rotate a credential.

Change is a **same-authority rotation**, not a new login: it rotates the acting
session's bearer, keeps the authority instance id, and revokes the user's
*other* sessions. A session belonging to a different user is untouched. Because
the authority is preserved, the client adopts it through the same rotation path
refresh uses.

`authPasswordSet({ newPassword, stepUp })` adds a first password to a principal
that has none. It additionally requires a fresh operation-bound step-up
challenge naming the principal's own verified `email-code` identity — acquire it
with `POST /auth/request-code` against that address.

## From the CLI

Passwords are accepted on stdin and **never** on the command line, in any
profile — so they never reach process listings or shell history.

```sh
printf '%s' "$PASSWORD" | snapback auth password signup \
  --url http://127.0.0.1:4000 --email person@example.com --password-stdin

printf '%s' "$PASSWORD" | snapback auth password signin \
  --url http://127.0.0.1:4000 --email person@example.com --password-stdin
```

`--password-fd N` and the `SNAPBACK_PASSWORD` environment variable are accepted
**only** under dev and test profiles, and refused elsewhere with a typed code.
`snapback auth password change` reads the session token first, then the current
and new passwords, from stdin in that order.

These verbs need no admin token and no impersonation capability. They are the
product front door, not an operator impersonation path — unlike
`snapback session mint`.

## What a failed signin tells an attacker: nothing

Wrong password, unknown identifier, and locked-out all answer the **same**
`SNAPBACK_AUTH_CREDENTIAL_INVALID` with the same status, body, headers, and
timing envelope. A signin against an address with no account still performs a
full key-derivation against a dummy hash so the cost is uniform.

Lock state is deliberately **invisible on the wire**. A visible lock would
itself be an oracle: a real account's counter resets when its owner signs in
while a missing address's never does, so lock behavior would diverge across
histories and disclose successful-authentication activity. Lock existence,
threshold, and expiry are observable only through the authenticated admin
projection and `authProgramReadiness`.

<!-- since: 0.1.21 -->
An operator can call `admin.passwordAttempt(email)`. Its AdminRead response
contains the declared `failureThreshold`, `failureWindowMs`, and
`lockDurationMs`, plus either `attempt: null` or the canonical identifier,
window start, failed count, lock deadline, and current `locked` bit. It never
contains the password hash. The corresponding AdminWrite
`snapback auth password unlock` verb deletes that ledger row early.

Declared v1 posture — **every threshold is a profile parameter, not a fixed
constant**, so acceptance suites and benchmark envelopes can raise them:

| | Default |
| --- | --- |
| Consecutive failures before lock | 10 |
| Lock duration | 15 minutes |
| Failure window (sub-threshold decay) | 15 minutes |
| Password length | 12–1024 UTF-8 bytes by default; declare `minimumLength` from 8–128 |
| Argon2id | m=19456 KiB, t=2, p=1 |

An operator can clear a lock early with the AdminWrite unlock verb; otherwise
the lock expires on its own with no intervention.

## Capability boundaries — read before shipping

These are not shipped, and Snapback says so rather than pretending:

- **Production signup is not blind-accept.** On local/dev/test, signing up with
  an address that already has an account refuses with a distinguishable code —
  a deliberate, documented enumeration oracle on the trusted local target.
  Blind-accept needs mail delivery to notify the real owner, so
  `authProgramReadiness` reports production signup **unready** rather than
  faking it.
- **Mail-delivered password reset does not exist.**
  `POST /auth/password/reset` works only against the local capture mailbox and
  refuses outside that profile. Real reset waits on the LLP 0045 mail adapter.
  Recovery codes are the self-serve path in the meantime.
- **Reset is same-principal only.** The address's `email-code` identity and its
  password identity must belong to the same principal. A password-only account,
  an email-code-only account, and the two-principal squat state all refuse
  uniformly — transferring a squatter's credential to someone who later proves
  the address is exactly the hijack this contains.
- **A password never proves you own the email address.** It proves control of
  the account whose login name is that string. Only an email-code exchange
  proves address ownership, and the two claims are separate identity rows in
  separate provider namespaces. A password identity can never satisfy an
  email-code lookup.
- **Catalog v4 is required.** A store created by an older runtime keeps working
  for everything else and reports the password provider unready — it does not
  fail. There is no silent migration.
- **Sender-constrained custody is refused, not downgraded.** When
  sender-constrained credentials are active, password methods refuse with a
  typed error rather than quietly falling back to bearer-only custody.

## Anti-patterns

- **Do not construct `AuthCoordinator` or call an authority-adoption method in
  an ordinary React/Expo app.** The generated application client and provider
  own that composition; the explicit seam is for custom brokers and shells.
- **Do not discard, log, analyze, or silently persist signup recovery codes.**
  Present the one-time projection immediately and hand custody to the user.
- **Do not implement user switch as sign-in over an authenticated principal.**
  Sign out, wait for settled anonymous, then enter the successor account.
- **Do not infer Expo-native restoration from browser or Expo-web evidence.**
  The iOS and Android `single-runtime` arms have separate Phase-2 receipts
  and ship in the published 0.1.24 closure (first publish recorded in the
  [closed custody first-publish gate](repo:issues/closed/20260816-custody-first-publish-gate.md)). The iOS extension evidence
  is share-sheet-kind-only; NSE/`simctl push` remains a nonclaim.
- **Do not generalize this local bearer journey into hosted or
  sender-constrained auth.** Check [Targets](./targets.md) first.
