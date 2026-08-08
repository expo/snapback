# Auth pages hygiene sweep: supervised-loop routing, snippet framing glosses, order dup, CLI mint mention

**Opened:** 2026-08-08 · **Severity:** P3 (documentation, batched)

One editing pass over guide/auth/ (+ one realtime alias note) closes all of
these:

1. **native-apps.md never routes Expo authors to the shipped supervised
   dev-loop auth.** The supervised loop auto-mints an ordinary session via
   `GET /_snapback/expo/v1/bootstrap` under `SnapbackExpoProvider`
   (packages/snapback-expo/supervised-environment.mjs:8-18), taught only in
   clients/react-expo.md:164-269. An agent starting from the auth section
   hand-builds a broker the dev loop already provides. One cross-link
   sentence (sessions-and-principals.md:230-231 mentions the loop with no
   link either).
2. **protecting-data.md:59-75** presents the kit mock server's fixture code
   as what "Snapback returns" — add a lead-in naming it as the mock's wire
   shape.
3. **app-identity-binding.md:86** calls `requireFixtureSession(ctx)` with
   no gloss — one clause ("the control's own fixture gate — your port
   omits it").
4. **targets.md:4 and scoped-roles.md:4 both carry `order: 3`** after the
   section was renumbered around them.
5. **The paved CLI mint verb is undiscoverable:** native-apps.md:27 and
   app-identity-binding.md:170 teach only the raw `auth.mintSession` host
   op; mention `snapback host session mint` (src/cli.rs:2366-2370,
   4816-4818) where the host op is taught.
6. **realtime/ephemeral-state.md:50** imports from `@messenger/snapback-react`
   — the demo's tsconfig/metro alias for `@expo/snapback-react`
   (demos/messaging-snapback/package.json:20). One prose note so cold
   agents don't install a nonexistent package.

Found by the 2026-08-08 comprehensive docs review (auth/realtime slice).
