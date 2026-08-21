# Knockoff

Knockoff is an Expo SDK 57 social app with a live feed, profiles, posts,
replies, likes, Apple login, and Google login. It uses Snapback's own sessions
and application custody. Clerk, Firebase Auth, and Supabase Auth are not
dependencies.

## What the demo proves

The checked acceptance path proves the current local broker seam:

1. A server-only broker verifies an Apple or Google identity fixture.
2. The broker derives a stable opaque email from immutable issuer and subject.
3. Snapback issues a one-time email-code exchange through its local capture
   path.
4. `signInWithExternalCode` installs the resulting session through the
   application Auth facade and its ordinary coordinator custody.
5. `ensureProfile`, `createPost`, and `toggleLike` derive the actor from
   `ctx.auth.userId`. The client never submits an author or liker identity.
6. Repeating Google login returns the same Snapback principal.

The default app mode uses hermetic Apple and Google fixtures, so an agent can
run the complete path without provider accounts. Set
`EXPO_PUBLIC_KNOCKOFF_AUTH_MODE=real` only after you configure the app-owned
provider registrations described below.

## Run the proof

From the repository root, the catalog commands are:

```sh
bun run --cwd demos/knockoff start
bun run --cwd demos/knockoff test
```

Generate the backend, typecheck the Expo app, and run the social-auth witness:

```sh
cd demos/knockoff
bun install
bun run generate
bun run typecheck
SNAPBACK_RUNTIME_BINARY=/path/to/qualified/snapback bun run test
```

The witness starts an isolated sessions-mode server and a server-only identity
broker. It signs in with both provider fixtures, creates principal-bound
profiles, writes a post, checks the live feed, signs out, and proves stable
repeat login.

## Run the app locally

Use three terminals. Start Snapback without the Expo supervisor's automatic
development session so that the app opens on its login screen:

```sh
cd demos/knockoff
node ../../packages/snapback-cli/cli.mjs dev snapback \
  --ready-file .snapback/dev.ready.json
```

Start the server-only broker:

```sh
cd demos/knockoff
SNAPBACK_KNOCKOFF_READY_FILE=.snapback/dev.ready.json bun run broker
```

Start Expo:

```sh
cd demos/knockoff
EXPO_PUBLIC_KNOCKOFF_AUTH_MODE=fixture \
EXPO_PUBLIC_KNOCKOFF_AUTH_ORIGIN=http://127.0.0.1:3777 \
bun run start
```

The loopback broker origin works from the iOS simulator and web on the same
Mac. Android emulators and physical devices need a reachable development
origin. Do not put the Snapback admin token or impersonation capability in an
`EXPO_PUBLIC_*` variable.

## Configure real Apple login

Real Apple login requires an app-owned Apple Developer registration. Set:

- create an explicit App ID whose bundle identifier is
  `com.snapback.knockoff`, enable its Sign in with Apple capability, and rebuild
  the development client after the registration is active;
- `KNOCKOFF_APPLE_CLIENT_ID` on the broker to the app's bundle identifier;
- `EXPO_PUBLIC_KNOCKOFF_APPLE_NATIVE_CONFIGURED=1` in Metro only after the
  Apple Developer registration above is active;
- `KNOCKOFF_BROKER_IDENTITY_SECRET` on the broker to at least 32 random
  characters; and
- `EXPO_PUBLIC_KNOCKOFF_AUTH_MODE=real` in the Expo build.

The app uses `expo-apple-authentication` on iOS. It sends the identity token,
authorization code, nonce, and first-login name to the broker. The broker
verifies the token signature, issuer, audience, expiry, and nonce against
Apple's JWKS.

This demo does not retain an Apple refresh token or implement provider
revocation during account deletion. LLP 0151 requires that behavior before an
Apple provider can become a production Snapback capability.

## Configure real Google login

Real Google login requires an app-owned OAuth client. Set the same client id in
both processes:

- `KNOCKOFF_GOOGLE_CLIENT_ID` on the broker;
- `EXPO_PUBLIC_KNOCKOFF_GOOGLE_CLIENT_ID` in the Expo build;
- `KNOCKOFF_BROKER_IDENTITY_SECRET` on the broker; and
- `EXPO_PUBLIC_KNOCKOFF_AUTH_MODE=real` in the Expo build.

The app opens the system browser through `expo-auth-session` with PKCE. It
sends the authorization code, verifier, and exact redirect URI to the broker.
The broker exchanges the code with Google, verifies the returned ID token, and
discards provider tokens after session entry.

Google's current Expo guidance prefers a provider-specific native library when
one is available. This first slice uses the system-browser OIDC profile because
it exercises the same provider-independent completion seam on iOS, Android,
and web. A native Google SDK handoff remains part of LLP 0151's first-party
provider work.

## Security boundary

Provider tokens stay in the broker process. The app receives only a short-lived
Snapback exchange object. The broker alone holds the local capture authorities.
The stable provider mapping uses issuer and subject, never mutable email.

This is still a local demo. It uses Snapback's non-production capture mailbox
to enter an ordinary session. It does not claim hosted Auth, production Apple
or Google registration, a first-party OIDC engine, account linking, provider
revocation, or production challenge delivery.
