# Diary 0104: Knockoff social auth

**Date:** 2026-08-21
**App:** `demos/knockoff`
**Stack:** Expo SDK 57, Expo Router, React Native, Snapback sessions, app-owned identity broker

## Build log

Knockoff started from the existing Chirp social-feed demo, then replaced every
client-supplied actor with the Snapback principal. Posts now store an author
profile id selected from `ctx.auth.userId`. Likes store the principal directly.
The client submits neither an author handle nor a liker identity.

The first intended login methods are Apple and Google. Current Snapback does
not ship those first-party providers. The capability registry correctly points
to the local external-identity broker seam, and LLP 0151 already designs the
larger provider program. That split was useful: the demo could build a real
local product journey without pretending that the hosted OIDC work exists.

The missing client seam was smaller than the provider gap. `SnapbackClient`
already had `authExchange`, but the first-party application Auth facade exposed
only password entry. Knockoff added `signInWithExternalCode`, guarded by the
generated `external-session-explicit-v1` policy. The method delegates to the
existing exchange and AuthCoordinator transition, so it adds no second custody
implementation. The application-client suite now proves both admission and
pre-transport refusal.

The broker is intentionally app-owned. It verifies Apple or Google server-side,
derives a stable opaque local address from immutable issuer and subject, and
uses the local capture path to obtain one ordinary Snapback exchange. The app
never receives provider tokens, the admin token, the impersonation capability,
or the synthetic address. Repeating Google login returns the same principal
even though the session is new.

Hermetic fixtures made the first journey runnable with no provider account.
The real Apple verifier checks JWKS signature, issuer, audience, expiry, and
nonce. The real Google path uses system-browser authorization code plus PKCE,
exchanges the code in the broker, verifies the ID token, and discards provider
tokens. Those paths compile but remain externally gated walkthroughs until the
app has Apple and Google registrations.

The sharpest friction was not OAuth code. It was understanding which claims
were honest. The local broker seam is intentionally non-production, Apple
account deletion needs retained revocation custody, Google registration is an
external ceremony, and native Google SDK handoff is a different client profile
from browser OIDC. LLP 0151 had already made each distinction. Reading it saved
the demo from treating a token-verification helper as a finished provider.

The generated backend also caught a real modeling error immediately: the first
timeline attempted `take(2048)` for likes, above the 1,024 relational ceiling.
Reducing the bound produced a valid generation. Once the schema moved to
sessions mode, the React mutation hook also widened to a queued-or-settled
dispatch result. The UI did not consume the return value, so its local callback
contract was narrowed to `Promise<unknown>` rather than lying about immediate
settlement.

The local runtime in the main checkout was stale, while `vendor/ibex` was
cleanly checked out at a different commit than Snapback's pinned gitlink. The
safe build path was a detached temporary Snapback worktree with the pinned
submodule. That build first selected Homebrew Rust 1.93 and failed because Oxc
requires Rust 1.95 or newer. Putting rustup's repository-pinned Rust 1.97 first
in `PATH` produced a qualified runtime without changing the main checkout's
submodule state.

## Real-provider dev-build attempt

The iOS development client compiled and installed with the Sign in with Apple
entitlement. The first real Apple attempt exposed the setup problem the fixture
path had hidden. Native Sign in with Apple binds to the app's bundle id and the
developer team, so a fresh demo still depends on Apple account state and an
app-owned registration before its first useful screen.

The attempt also found a client bug. The request from the app to the local
identity broker had no deadline. A broker route that stopped answering left
`active="apple"` set forever, so the login screen showed a permanent spinner.
The new broker-client regression test reproduces that state with a request that
never settles. A 15-second abort now turns it into a visible error.

The screenshot-time simulator logs identified a separate pre-app failure.
Apple's AuthKit process received a 401 and reported authentication error
`-7026` with an `Invalid client` server result. It also reported missing
simulator device identity and an invalid Anisette connection. The native
authorization promise therefore never returned to Knockoff. Real mode now
keeps the Apple button disabled until
`EXPO_PUBLIC_KNOCKOFF_APPLE_NATIVE_CONFIGURED=1` confirms that the explicit App
ID and its Sign in with Apple capability are active.

The product ruling changed after this attempt. First-party providers should use
Snapback-owned shared profiles by default in development. The shared profile
uses the browser completion flow and creates app-scoped rehearsal identities.
Staging and production still require app-owned credentials. Rehearsal accounts
never become production accounts, which avoids pretending that Apple's
team-scoped subjects and private relay addresses can migrate safely.

Compared with Clerk, this slice required much more explicit custody,
provider-registration, callback, and lifecycle work. The payoff is that the
identity mapping and session state stay under the app's control, fixtures are
hermetic, and no hosted identity vendor becomes mandatory. Compared with
Supabase Auth, Snapback currently has the stronger typed refusal and session
invalidation story but far less provider breadth. Convex would still require a
separate identity product or equivalent custom broker, so the comparison there
is mainly Snapback's integrated principal and offline authority model against
Convex's more mature hosted operations.

## What felt good

- The start packet named the external broker seam and its production limit.
- LLP 0151 had already decided app-owned Apple and Google registrations.
- `defineAuth` generated the exact external-session capability into the app
  descriptor.
- The new Auth facade method reused existing coordinator custody.
- Server-derived principals removed actor ids from every write interface.
- The acceptance test proved distinct Apple and Google principals, stable
  repeat login, and an authored post in one process.

## What felt bad

- A first-party Apple or Google provider still does not exist.
- Real provider setup cannot be hermetic because the app needs external
  registrations.
- Apple deletion-time revocation and native Google SDK handoff remain outside
  this slice.
- The demo needs three local processes: Snapback, the broker, and Expo.
- The app-owned native Apple path made provider setup the first-run experience.
- The first broker client had no request deadline and could spin forever.
- The repository shell selected the wrong Rust installation until `PATH` was
  corrected explicitly.

## Verification

- Snapback codegen: passed with seven existing write-posture migration
  warnings.
- TypeScript strict check: passed.
- Expo web production export: passed, including the `expo-sqlite` WASM asset.
- Application-client Auth facade suite: 41 tests passed.
- Broker-client deadline regression: passed in 22 ms.
- Generated-artifact corpus check: passed after registering Knockoff's backend.
- Qualified runtime: built and handler-VM-qualified in a detached worktree at
  commit `c357f753f` with the pinned Ibex gitlink and Rust 1.97.
- Social-auth acceptance: passed.
  - Apple fixture entered Snapback custody and authored a principal-derived
    post.
  - Google fixture produced a different principal.
  - Repeating Google login returned the same principal and profile.
  - The app received one-time exchange fields and no provider token.

## Adaptive auth profile follow-up

The Clerk comparison changed the demo from a mode flag into one provider-entry
Module. App code now calls one controller. A pure resolver selects synthetic,
shared browser, app-owned browser, or app-owned native before the attempt
starts. Injected Adapter tests prove that a native failure never calls the
shared Adapter.

The local shared broker now exercises the actual completion shape instead of
calling the fixture route directly. The app creates a redemption verifier. The
broker binds its challenge to the app id and an exact return target, shows a
Snapback Development Auth browser page, and redirects only a one-use code plus
state. Redemption consumes the code and returns the ordinary Snapback exchange.
Tests cover replay, a wrong verifier, an arbitrary return target, and the
100-user limit.

Native readiness needs provider configuration and a native-build probe. The
Expo config installs receipt URL schemes and adds Google's native config plugin
only when its iOS URL scheme exists. This caught a development-client problem:
the Expo tools floating window can cover the system auth browser and intercept
automated taps. The next development build disables that tools button through
the `expo-dev-client` plugin.

The shared broker still uses hermetic provider identities. That is honest but
not the final product experience. Real zero-setup Apple and Google accounts
still need Snapback-owned registrations and a public callback host behind this
same protocol.

The client resolver alone was insufficient as a deployment boundary because
Expo public configuration is mutable client input. The local broker now repeats
admission from server-only deployment configuration: development is allowed,
preview additionally needs an owner-authorized unexpired window, and staging or
production never instantiate shared auth.

Verification for this slice:

- TypeScript compiled with `npx tsc --noEmit`.
- Resolver, timeout, shared-protocol, replay, verifier, user-cap, and broker
  admission tests passed.
- The social-auth acceptance path passed against an explicitly selected,
  already-qualified Snapback binary. The current checkout could not rebuild its
  default binary because the user's modified `vendor/ibex` no longer exposes
  the expected `sfe-static-network` feature.
- A clean iOS development-client build completed with the native Google module,
  Apple capability, auth receipt schemes, and Expo tools overlay disabled.
- On the iPhone 17 Pro simulator, both Apple and Google shared entries opened
  Snapback Development Auth, returned through the one-use custom-scheme
  callback, entered distinct Snapback principals, and signed out cleanly.

## 2026-08-24 — promoting the demo's shared auth into first-party surface

The Knockoff build proved the shape. This entry is about moving it out of the
demo and into the packages, and about what that move taught.

### What moved, and where the seams landed

The demo had one broker file doing five jobs: transaction state, deployment
admission, provider verification, session completion, and HTTP. Splitting it
for first-party use forced each seam to be named:

- `@expo/snapback-client/provider-entry` — the resolver and the dispatcher.
  Pure, no I/O, no crypto.
- `@expo/snapback-client/shared-development-auth` — the *client* half. This is
  where the demo's design bit hardest: the demo's `shared-development-auth.mjs`
  used `node:crypto`, which is fine in a demo server and impossible in a client
  package that bundles for React Native. The split into a WebCrypto client half
  and a `node:crypto` broker half was not a stylistic choice; the packaging
  boundary made it mandatory. That is the kind of constraint a demo cannot
  surface, because a demo has no packaging boundary.
- `@expo/snapback-cli/shared-development-auth` + `shared-development-broker.mjs`
  — the broker half and its HTTP surface.
- `@expo/snapback-expo/shared-browser-adapter.mjs` — the Expo Adapter.

### What was easy

Promoting the *protocol* was almost mechanical. The demo's transaction store
already had the right invariants — one-use codes, exact return allowlisting,
client-held verifiers, an app-scoped subject — so the first-party version is
the same state machine with better refusals. Every test I wrote for it passed
on the first run, which is the tell that the design, not the code, was the
asset.

The resolver was the same story. `demos/knockoff/src/lib/auth-profile.ts` had
already worked out the closed selection table; promoting it was renaming
`KNOCKOFF_AUTH_*` codes to `SNAPBACK_AUTH_PROVIDER_*` and adding the
`configGeneration`/`clientBuildReceipt` fields the RFC's schema names.

### What was harder than expected

**The return target.** The demo used a fixed custom scheme
(`knockoff://auth/shared`), which needs an app-owned native build. A brand-new
app has no such build. The obvious fixes were both wrong: letting the client
send its own return URL destroys exact allowlisting, and asking the author to
register one reintroduces the setup step the whole feature exists to remove.
What worked was *deriving* the allowlist from a fact the supervisor already
owns — the Metro port — which yields `exp://127.0.0.1:8081/--/auth/shared` for
Expo Go plus the web origins. Exact allowlisting intact, nothing to configure,
no native build. This took three attempts to see.

**Where the broker lives.** The demo ran it as a second process in a second
terminal, published through an env var. Mounting it on the supervisor's
existing bootstrap listener — the origin the client already discovers — removed
the terminal, the env var, and the origin configuration in one move. The
projection then rides the ordinary exchange, which is already credential-free,
so nothing new had to be secured.

**`snapback auth enable` edits source.** This is the part I was most reluctant
about, and the reluctance was misplaced. Since the declaration is the source of
provider policy, anything *other* than a source edit would create a second
place provider policy lives. The stale-safe compare-and-write plus a refusal to
reserialize a hand-written `providers` block made it feel safe rather than
magic. Refusing loudly is what makes an automated source edit acceptable.

### Friction worth recording

- **Three pre-existing reds surfaced only because I ran the suites.**
  `application-auth-bootstrap.test.mjs` fails on a `resolveExport` crash for any
  specifier-less `export { … }`; `authoring-validation.test.mjs` fails on a
  stale Rust manifest fixture; `expo-dev-loop.test.mjs` defaulted its runtime
  binary to `/Users/ccheever/...` and so had never run on this machine at all.
  All three are filed. The third is the interesting one: a test that cannot run
  anywhere but one laptop is indistinguishable from no test, and nothing
  detected that.
- **The `expo-chat` first-read packet is 230 bytes from its ceiling.** A
  three-line posture bullet does not fit. Filed rather than papered over,
  because deciding what to displace is not the landing agent's call.
- **The symbol-registry client page needed its third budget raise in nine
  days.** Two new client exports pushed it 5 KB over. The relief is recorded on
  the open slicing ticket; the ticket is now overdue rather than anticipated.

### Compared with Convex and Supabase

Both give you social sign-in with fewer moving parts than what landed here —
but both do it by holding the provider registration themselves, which is
exactly the tether LLP 0151 refuses. The honest comparison is therefore not
"Snapback is harder" but "Snapback is telling you the truth about what it has."
Supabase's development experience is genuinely better on day one; its
production graduation story for Apple's team-scoped subjects is not better, it
is just quieter. What Snapback ships here is a development sign-in that works
with zero setup and *says* it is a rehearsal identity, plus a resolver that
refuses to let that identity reach production. I would rather explain that than
discover the graduation problem later.

The thing I would want as an app author is the piece that is still missing: a
Snapback-owned registration and hosted callback so the development identity is
a real one. Everything landed here is the protocol that would sit underneath it.

### Verification for this slice

- Provider resolver and dispatch: 16 tests.
- Shared development client half: 7 tests; broker half: 11 tests; supervised
  broker HTTP round trip: 9 tests.
- Expo shared browser Adapter: 7 tests.
- `snapback auth` setup group: 18 tests, including CLI routing and the
  delegation boundary for native auth verbs.
- App client provider entry: 8 new tests inside the existing 50-test suite,
  covering the frozen-Adapter contract and the no-fallback rule.
- Guide, inventory, and reference checks pass; `./ref-check` clean.
- **Not verified here:** any real Apple or Google login, any app-owned native
  build, and the published-package path. Those remain nonclaims.
