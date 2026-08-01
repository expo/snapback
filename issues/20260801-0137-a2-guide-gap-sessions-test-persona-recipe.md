# 0137 A2 guide-gap: the sessions dev/test persona recipe is undocumented (mailbox header, impersonation sidecar, external-bearer client)

- **Date:** 2026-08-01
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f6-sessions-test-persona-recipe-undocumented.json`
- **Severity:** documentation — the sweep's one recorded assistance event exists because of this gap

What a cold consumer cannot learn from the guide today:

- how to read the admin-gated mailbox (`GET /_snapback/api/auth/mailbox?challengeId=…`) — the route is only a bare capability-index row;
- that it requires `x-snapback-impersonation-capability` carrying the `dev.ready.json.impersonation` sidecar contents (the `SNAPBACK_AUTH_IMPERSONATION_REQUIRED` diagnostic does not name its carrier, unlike the exemplary auth-protocol diagnostic);
- that a headless authenticated client is built with `createExternalSessionClient(baseUrl, { bearerToken })` after `/auth/exchange` (bare `authClientProtocol: 1` construction refuses without pointing there).

The arm learned the recipe from packaged `@expo/snapback-cli/comparator-profile.mjs` bytes (recorded assistance event in the run capsule). Once known it is genuinely better than the frozen competitor baseline: three bearer-backed personas in ~100ms each versus Convex's custom-JWT issuer ceremony.

Ask: one guide section (auth/sessions-and-principals or testing/acceptance) with the complete persona recipe and exact header names, plus the diagnostic naming its expected carrier. Witness: a cold agent mints two personas and passes a cross-principal check from the guide alone.
