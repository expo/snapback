# Convex Chat CHAT-12 logout diagnosis

## Conclusion

The original Stop-class candidate was a harness false positive, not a Convex
protected-delivery defect.

The failed harness used `ConvexClient.setAuth(async () => null)` as though its
`onAuthChange(false)` callback were the application's logout barrier.
`ConvexClient` does not expose `clearAuth()`. The provider-specific React
application uses `ConvexReactClient`, whose official API exposes
`clearAuth()` specifically to clear the current token.

With `ConvexReactClient.clearAuth()`:

- the already-connected private-channel watch transitioned to
  `UNAUTHENTICATED`;
- a fresh private query on that same client was denied;
- a brand-new anonymous private query was denied; and
- after that barrier, Alice committed unique message sequence 135 and Bob's
  established watch received no post-logout result.

The full clean acceptance rerun repeated the corrected barrier and passed
CHAT-12.

## Evidence

- `receipts/acceptance-error-original-harness.json` — preserved false-positive
  Stop receipt.
- `receipts/logout-diagnosis-readonly.json` — authoritative row inspection,
  immediate watch invalidation, and two denied fresh reads.
- `receipts/logout-diagnosis-delivery.json` — the one-message minimal
  reproduction after the corrected barrier.
- `receipts/scenarios/CHAT-12-LOGOUT.json` — corrected clean-run acceptance.
- `work/scripts/diagnose-logout-delivery.mjs` — exact executed diagnostic.

Erratum: the raw delivery receipt's `logoutMethod` string says
`ConvexClient.clearAuth()`. The retained executed source imported and
instantiated `ConvexReactClient`; raw evidence is intentionally not rewritten.

## Versions and target

- Convex client/CLI: `1.42.3`
- Official anonymous local backend:
  `precompiled-2026-07-21-82d5e9f`
- Endpoint: `http://127.0.0.1:3310`
- Namespace: `llp0102-chat-convex-w2`
- Backend binary SHA-256:
  `525d31533ed61e091c24f2e5e992c03e20712a8a9b99f0236543422429f1f950`

## Primary documentation

- [ConvexReactClient.clearAuth](https://docs.convex.dev/api/classes/react.ConvexReactClient)
  defines the React client's token-clearing operation.
- [ConvexClient API](https://docs.convex.dev/api/classes/browser.ConvexClient)
  exposes `setAuth` but not the React client's public `clearAuth` method.
- [Auth in Functions](https://docs.convex.dev/api/interfaces/server.Auth)
  defines unauthenticated `getUserIdentity()` behavior.
- [Local Deployments](https://docs.convex.dev/cli/local-deployments) documents
  the official anonymous local beta target used by the reproduction.
