# Review: LLP 0031 - Server route taxonomy and authority boundary

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-07-01
**Redacted:** No - reviewed local repository files and the in-repo LLP corpus; no separate external reviewer or provider was invoked.
**Method:** Review requested as `$llp-review 0031 revise if there are things that need to be fixed`. Read the full LLP 0031 draft, LLP 0005 review guidance, related coverage in LLP 0013, LLP 0017, LLP 0024, LLP 0030, and verified route/auth claims against `src/server.rs`, `src/admin.rs`, `src/ephemeral.rs`, and `demos/_kit/client.mjs`.

> **Independence note.** LLP 0031 is authored by Charlie Cheever / Claude, and this GPT/Codex session did not author the draft. This is an independent GPT-family review of the Claude-authored draft. It is still not an external provider review; the author decides whether this is enough for the LLP 0005 loop.

## Overall assessment

LLP 0031 is the right structural follow-up to LLP 0030. The core claim is sound: the Vite proxy should not have to rediscover Snapback's privileged routes by hand forever; the server should guarantee that app-data routes live at the root and system authority lives under `/_snapback/*`.

The draft's main weakness was that it collapsed two different things under "system routes are admin-authorized": the static admin console shell at `/_snapback/admin*`, which does not call `authorize()`, and the stateful admin API under `/_snapback/api/*`, which does. That distinction matters because the enforcement mechanism must test both path class and auth policy. A second issue was transport coverage: `/ephemeral/delete` also exists as a WebSocket message over `/live/{id}/stream`, so classifying only the HTTP route would leave a system operation reachable through an app-data route.

## Strengths

- **Good ownership boundary.** The spec correctly makes route taxonomy a server responsibility rather than each proxy's burden.
- **Grounded in actual code.** The root `/admin/*` aliases are genuinely ungated in `src/server.rs`, and the token-gated equivalents for schema/functions/reset/seed genuinely do not exist yet under `/_snapback/api/*`.
- **Correct migration order.** Add gated system operations first, move callers, then retire aliases. That avoids breaking demos and tests mid-migration.
- **Honest about ambiguous app operations.** `/inspect`, `/ephemeral/delete`, `/ephemeral/collections*`, and `/connections/*/disconnect` are correctly left for explicit classification rather than hand-waved into one bucket.

## Concerns

- **G1 - `/_snapback/admin*` is not itself an `authorize()`-gated API. [Medium] [Applied]** `src/admin.rs` serves `/_snapback/admin`, `/_snapback/admin/`, and `/_snapback/admin/{*path}` through static console handlers with no `authorize()` call. The API routes below `/_snapback/api/*` are the routes that enforce admin read/write policy. I revised the summary, invariant, route table, and security posture so `/_snapback/admin*` is a system presentation lane that may be public only because it does not itself expose instance data/control.

- **G2 - The proposed registry needed to record auth policy, not just path class. [High] [Applied]** A registry that only says "app-data vs system" would prove namespace placement but not the equally important question of whether stateful system API routes call the right auth policy. I revised the enforcement section so registry entries include path class (`app-data`, `system-static`, `system-api`) and auth policy (`public`, `app-auth`, `admin-read`, `admin-write`), and the test asserts system API entries carry admin auth.

- **G3 - WebSocket-carried operations can bypass an HTTP-only taxonomy. [Medium] [Applied]** `src/server.rs` accepts `EphemeralDelete` messages over `/live/{connection_id}/stream`, while `/ephemeral/delete` is listed as ambiguous. If the HTTP delete becomes system/control but the WebSocket message remains on the app-data `/live/*` route, the operation is still app-reachable. I added a table row, enforcement note, migration-plan item, and open question requiring transport parity or an explicit split between app-scoped own-entry delete and admin forced-delete.

- **G4 - `/` was a third class in the table despite the two-class invariant. [Low] [Applied]** The invariant says every route is app-data or system, with some app-data routes public. I changed `/` from `public read` to `app-data/public read` so the table matches the invariant.

## Suggestions

- Prefer a registry schema that makes handler intent explicit: method, path pattern, transport/message kind, path class, auth policy, and a short authority note.
- When implementing the black-box fallback, include both path-placement tests and auth-policy tests: root `/admin/reset` absent, `/_snapback/api/*` writes token-gated when configured, and `/_snapback/admin*` static assets do not expose JSON state.
- Decide `/ephemeral/delete` by semantics, not by current implementation convenience. If it means "delete my own ephemeral entry," it can be app-data; if it means "force-delete arbitrary live state," it is admin/control and needs a different endpoint/message.

## Open questions

- Should the static console shell be disabled or token-gated on non-loopback binds, or is it acceptable to serve shell/assets publicly as long as all data/control calls go through `/_snapback/api/*`?
- Does app-scoped connection disconnect need its own route/message distinct from admin force-disconnect, mirroring the likely split for ephemeral delete?
- Should `/inspect` remain a public app-data structural read after it is trimmed, or should only `/_snapback/api/inspect` exist once the admin contract is the canonical entry point?

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0031 in `Draft`. It is ready to drive the route-registry implementation once the ambiguous operation classifications are settled. The highest-value author decision is the app-scoped-vs-admin split for ephemeral delete and connection disconnect, because that determines whether the root routes are retired, renamed, or preserved as app-data.
