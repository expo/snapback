# Client pages link/fragment sweep: react↔surfaces routing, Hermes-unsafe fragment, dead import, missing links

**Opened:** 2026-08-08 · **Severity:** P3 (documentation, batched)

One editing pass over guide/clients/ closes all of these:

1. **react.md never mentions `useSurface`/`useSnapbackCommand` or links
   surfaces.md**, yet surfaces.md's first anti-pattern (:521-524) warns
   against exactly the hand-wired multi-hook composition react.md teaches.
   The reader most likely to violate it never sees the pointer. Add
   cross-links from react.md's query/group sections.
2. **react.md:324-339's pending-sidecar fragment uses
   `crypto.randomUUID()`**, which doesn't exist on Hermes — while
   react-expo.md:31-33 says "Everything on the React page applies here" and
   its own crypto section (:434-447) states Hermes ships no
   `globalThis.crypto`. The intent key is presentation-only; use a
   carrier-safe unique-label expression or add the RN substitution clause.
3. **react-expo.md:390-407's low-level provider fragment** imports
   `api from './generated/api.mjs'` and never uses it, and passes the
   legacy `{ schema, functions, capabilityManifest }` manifest shape while
   react.md:58-60 teaches the descriptor form (both are valid,
   packages/snapback-client/react-binding.mjs:173-274). Drop the dead
   import or switch to the descriptor form.
4. **framework-bindings.md:22-27** says "React and Contract bindings ship
   today" and "Build on the external store" but links neither react.md,
   contract-adapter.md, nor headless.md's external-store section (its only
   link is auth/targets). Link the shipped bindings and the store docs.
5. **react-expo.md never links guide/backend/expo-push.md**, though push
   registration is an Expo-carrier concern with dedicated
   `@expo/snapback-client/push-installation-expo` exports
   (packages/snapback-client/package.json:207-214). One line in the install
   or store section.

Found by the 2026-08-08 comprehensive docs review (clients slice).
