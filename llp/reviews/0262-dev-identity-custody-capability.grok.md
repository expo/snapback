# Reviews: LLP 0262 — Dev identity becomes a custody capability

## Round 1 — 2026-08-15 — grok family

**Runtime:** grok -m grok-4.6 --reasoning-effort xhigh --output-format plain --disable-web-search --permission-mode auto --max-turns 200
**Target revision (sha256):** 7f1ca7cf4d4aef28407df4591c9baac93b7deea041a8bd5f6e652a5cc265d7ab
**Capsule:** git archive fa81cd856 minus llp/reviews/0262* (tar sha256 first-16 39f3385a0932fc02)
**Instructions (sha256 first-16):** 965e8344aca27f39
**Blindness:** structural
**Verdict: NOT READY**

### Verbatim review

I'll review the RFC independently: first the document and its governing LLPs, then verify the key claims against the source.Next I’ll read the governing LLPs and tickets, then check the claim sites in the source.I'll verify the RFC's claim sites in the source next, locating the functions by content rather than by possibly drifted line numbers.I’ve verified the claim sites against the code. Next I’ll check a few remaining chokepoints, then write the classified review.The core move in LLP 0262 is the right one: stop granting client-asserted dev identity from a bind-derived loopback fact, and reuse the existing per-boot `0600` sidecar pattern. Source checks out on the residual exposure (app-data identity plus tokenless admin reads through a front). Two decisions as written undo part of that repair.

## Concerns

### 1. Launcher injection republishes the capability to anyone who can load the launcher

**Severity:** MATERIAL

**Defective decision:** D2’s serve-time injection — “the dev host process … injects the capability into the served client bootstrap the same way it already injects the origin” — plus the security claim that a tunnel caller “does not have the machine’s filesystem and gets a typed refusal.”

**Evidence:** The packaged loop does not inject an origin into the browser. `@expo/snapback-vite` serves only a relative base path and explicitly forbids secrets and backend origins in the virtual module (`packages/snapback-vite/index.mjs` `renderVirtualModule`; LLP 0030 §Security posture; `packages/snapback-vite/package.test.mjs` asserts the module must not leak `serverUrl` or the backend origin). The Vite process is itself a loopback reverse proxy (`packages/snapback-vite/proxy.mjs`): it forwards allowlisted app routes to Snapback, so Snapback’s peer is always the local Vite process.

The summary lists “any local reverse proxy” as a motivating front. After D2, that proxy is also the process with filesystem custody. Two implementable readings both fail the written guarantee:

- **Capability in the served bootstrap** (what D2 says): anyone who can `GET` the page — including `ngrok http 5173` in front of Vite, or Metro with an `EXPO_PUBLIC_*` bake — receives the bearer. LLP 0168 already named this topology (“TLS tunnel to a Vite server already carrying the LLP 0030 relay”) as composing both axes while remaining an undeclared front.
- **Relay stamping** (the only injection that would not put a secret in JS): Vite attaches the header to every proxied request. The tunnel hop into Vite is still loopback, so Vite cannot tell a local tab from a public caller. That is 0168’s “front credential proves possession unless minting proves policy.”

OQ1 is about an explicit `0.0.0.0` opt-in. It does not cover a default loopback Vite/Metro that is itself fronted. Direct `ngrok http 4420` against Snapback is closed by D1; the local-reverse-proxy case the document itself names is not.

**Disposition:** Decide a launcher policy, in the RFC text: either (a) the injecting process is a deputy and tunnelled Vite/Metro remains an explicit residual, in which case retract “any local reverse proxy” and the typed-refusal guarantee, or (b) injection must not be “whoever can load what the launcher serves” — for example stamp only after a check Vite can actually make, or do not put a bearer in browser-visible modules at all. Do not analogize to origin injection; that path does not exist.

### 2. The identity capability is also an admin-read credential

**Severity:** MATERIAL

**Defective decision:** D3 — served-instance admin reads accept “the admin token **or** the dev-identity capability.”

**Evidence:** Today `evaluate_access` allows every admin read when `ctx.loopback` is true (bind address, not request peer: `src/admin.rs` `ServerContext::record_bound_address`, `evaluate_access` read arm `loopback || token_ok`). That is the residual the 2026-08-15 survey named. Writes on a served instance already require the minted `0600` token (`resolve_serve_admin_token`, ENG-23443). Secret reads already have their own lease. The admin console already has a separate derived credential; `authorize_for_mode` accepts `x-snapback-console-credential` **before** `evaluate_access`, and mint already requires `loopback && Local` (`require_console_mint_posture`).

The identity capability is designed to travel to every client a launcher starts, including a phone on a wide bind (D1, D2, OQ1). Admin reads today do **not** follow that path: a non-loopback bind without a token returns `AdminAccess::Disabled` (`evaluate_access(false, Some(token), None, false)`). After D3, a Warble/Expo client that was handed the capability in order to assert `auth.user_id` can read the inspection surface (`/_snapback/api/*` AdminRead), which LLP 0017 deliberately kept off the app-identity plane (console/claim/device-approval, “never a browser credential” for impersonation in `src/admin_impersonation.rs`).

The tunnel-read goal does not need this `or`. Dropping the bare-loopback arm and keeping token / console-credential is enough. CLI and `_kit` already hold the admin token (`demos/_kit/server-process.mjs` `resolveTestAdminToken` / returned `adminToken`). The `or` is a new privilege composition, not a convenience the existing clients require.

OQ1 asks whether one vs two identity capabilities is acceptable on a wide bind. It does not ask whether that bearer is also AdminRead.

**Disposition:** D3 should require the admin token or an existing console credential on served instances, and leave the identity capability off the admin-read arm. If the author wants capability holders to be operators, say so explicitly and reconcile LLP 0017’s console/claim design; do not smuggle that through “the same move.”

### 3. D4 has no truth table, and “loopback conveniences” fights D1’s prod-mint rule

**Severity:** implementation-phase

The recoverable reading is sound: `SNAPBACK_EXPOSURE=fronted` flips only the **unset** `SNAPBACK_PROFILE` default from bind-derived `dev` to `prod`; an explicit `SNAPBACK_PROFILE=dev` still mints; SSH-tunnel secret transit (LLP 0036’s loopback-or-TLS `config.set` rule) then uses credentialed surfaces only. As written, “refuses to mint the dev-identity capability’s *loopback conveniences*” can be read as “still mint, but not conveniences” or “prod never mints” (D1). Implementers need the 2×2 (`fronted` × profile unset/explicit) and the interaction with `--allow-insecure-dev-auth`.

### 4. D6 will tempt a gate on the Origin-present branch, which is not the tunnel attacker

**Severity:** implementation-phase

`permits_dev_body_origin` has one caller, and that caller runs only when `Origin` is present (`src/server.rs` around the `SNAPBACK_AUTH_DEV_ORIGIN_REFUSED` check). No-Origin clients (curl, Expo native, most harnesses) skip it and still get `ResolvedAppAuthority::dev_from_auth` via `prepare_registered_route_authority`. `validate_plaintext_auth_transport` is a bind/middleware fence with no request headers — it cannot verify a per-request capability. The load-bearing chokepoint is Dev-mode authority installation (`dev_body_authority` / `dev_host_operation_authority`), not those two functions. Hang the D1 check there (and on ClientAsserted connection-open), then compose with the existing fences.

### 5. Several mechanism claims are false or drifted; they do not change the decisions if 1 and 2 are fixed

**Severity:** implementation-phase

- CLI does **not** resolve the admin token “next to the ready file.” The token is a database sibling (`admin_token_sibling`); the impersonation bearer is the ready-file sibling (`impersonation_capability_sibling`, `discover_impersonation_capability`). D2 should say “exactly as impersonation,” not “exactly as the admin token.”
- Impersonation comparison collapses missing, malformed, and wrong into one 403 (`ImpersonationCapabilityRegistry::authorize`). D1’s REQUIRED vs MISMATCH pair is more oracular than the discipline it claims to reuse. Prefer one code, or justify the split.
- `sbdev_` must join `REGISTERED_CREDENTIAL_PREFIXES` (`src/auth/crypto.rs`); the namespace is a checked prefix-free invariant. Feasible (`sbdev_` does not collide).
- Browser-sent header needs a `cors_allow_headers` entry (`src/server.rs`); impersonation is intentionally absent because it is not a browser credential. `snapback-client` currently puts identity in the body (`SnapbackClient.auth` → `auth.user_id`) and removed the dead `x-snapback-dev-user` header.
- `require_operation_profile` has 20 call sites, not 22. `captureImpersonationCapability` is used by far more than “~14” suites. `validate_plaintext_auth_transport` has two production callers plus `AppState::validate_auth_transport`.
- D3 amends LLP 0017’s “ordinary loopback reads open” default; that should be an explicit related-doc update, not a silent override.
- Gate ClientAsserted authority resolution, not every connection-bound follow-up. Live WS already rides the connection grant after `/connection/open`; browsers cannot portably set a custom header on the upgrade.

## Overall assessment

D1 is the right primitive for this repo. The residual the 2026-08-15 survey named is real: `resolve_profile` is bind-derived, Dev mode installs `ResolvedAppAuthority::dev_from_auth` from the body with no peer proof, and `evaluate_access` still opens admin reads on a loopback bind. Destructive HTTP writes are already token-gated; secret reads are already separately proved; the impersonation / agent-destroy / rehearsal sidecars are a proven custody shape; `_kit` already harvests that shape. D5’s staged flip and the non-goals (no 0168 edge, no weakening of LLP 0060 D1, no hosted-auth change, no undeclared-front detector) are the right altitude.

The document is not ready because two decisions re-open what D1 claims to close. D2, as specified, turns the blessed launcher into a deputy that hands the bearer to whoever can load it, which is exactly the local-reverse-proxy front the RFC set out to remove. D3 then attaches AdminRead to that same widely distributed bearer, which no current client needs and which escalates the LAN/phone path OQ1 is still debating. Fix those two decisions — and write D4 as a table — and the rest is implementation.

VERDICT: NOT READY

