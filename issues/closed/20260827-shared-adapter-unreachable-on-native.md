# The shared development Adapter could never run on native

- Status: Resolved
- Date: 2026-08-27
- Systems: `packages/snapback-expo` (`shared-browser-adapter.mjs`, `provider.mjs`),
  `packages/snapback-cli` (`shared-development-broker.mjs`)
- Governing: LLP 0151 §Shared development browser Adapter
- Found by: driving the `expo-chat` provider buttons in Expo Go on an iOS
  simulator against `snapback dev --expo --expo-platform ios`

## What happened

The provider entry rendered correctly on native — both providers
`snapback-shared-browser · rehearsal · ready` — and tapping **Continue with
Apple** put a refusal on screen immediately:

```
the shared development Adapter requires WebCrypto for its redemption verifier
```

`createSharedDevelopmentVerifier` needs `getRandomValues` and `subtle.digest`,
and takes them from `globalThis.crypto`. Measured in Expo Go over CDP:

```js
{ hasCrypto: "undefined", getRandomValues: "undefined",
  subtle: "undefined", subtleDigest: "undefined" }
```

Hermes has no `globalThis.crypto` at all — not the digest, not even
`getRandomValues`. So the PKCE verifier could never be minted, and native
provider sign-in refused before it reached the broker. The Adapter had no seam
to supply one: `createSharedBrowserAdapter` called the verifier with no
argument, even though `createSharedDevelopmentVerifier(cryptoObject)` accepts
one.

This is the *native* half of a feature whose native story is the headline —
LLP 0151 specifies "the external-user-agent completion flow on native". It had
never worked.

## Second defect, behind the first

With crypto resolved, the flow reached the real `ASWebAuthenticationSession`
("*Expo* Wants to Use *127.0.0.1* to Sign In"), the supervisor's authorization
page rendered inside it, and consent did nothing — the same symptom Expo web
had before `issues/closed/20260826-shared-broker-refuses-expo-web-cors.md`.

Same cause, opposite scheme. That fix put the *http(s)* return origins in
`form-action`, deliberately excluding `exp://`. The native completion redirects
to `exp://127.0.0.1:<metroPort>/--/auth/shared`, so the policy blocked it. The
web-only fix had encoded a web-only assumption, and a test asserted it
(`doesNotMatch(formAction, /exp:/)`), which is why the suite stayed green.

## Resolution

- `resolveExpoSharedBrowserModules` resolves a WebCrypto surface: the global
  when it has one, otherwise an `expo-crypto`-backed shim implementing
  `getRandomValues` and SHA-256 `subtle.digest`. That is the same package the
  supervised client already resolves for native auth custody. Any other digest
  algorithm is a named refusal rather than a silent substitution.
- `createSharedBrowserAdapter` takes `cryptoObject` and passes it to the
  verifier; `provider.mjs` supplies the resolved one.
- `form-action` now names every allowlisted return target, `exp://` included.
  `URL.origin` is `null` for a non-special scheme, so scheme and host are
  composed directly. Still exact targets only — no wildcard.
- The test that asserted `exp://` was absent now asserts it is present.

## Verified end to end on the simulator

Expo Go 57.0.9 on iPhone 17 Pro (iOS 26.5), freshly scaffolded `expo-chat`,
`snapback dev --expo --expo-platform ios`: sign out → **Continue with Apple** →
iOS consent sheet → supervisor authorization page inside
`ASWebAuthenticationSession` → consent → session closes → app shows
`Signed in as usr_1zyz6fgdqbzqyh94natfr610y8`.

That is the **same principal** the Expo web run produced, which is the
app-scoped rehearsal identity behaving as designed across client surfaces.

Regression coverage asserts the shape rather than a round trip, since Node has
WebCrypto globally and would pass either way: the crypto test deletes
`globalThis.crypto` to simulate Hermes before resolving.
