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


## Round 2 (delta) — 2026-08-15 — grok family

**Target revision r2 (sha256 first-16):** 22ba760d2d28b9ce
**Capsule:** pristine r1 clone + r2 overlay (tar sha256 first-16 13b29623e5262d06)
**Instructions (sha256 first-16):** ca01a2ee53db1a00
**Blindness:** structural
**Verdict: NOT READY (2 MATERIAL in-delta)**

### Verbatim review

I'll review the r2 RFC against the snapshot source and the listed key sites, starting with the document and its governing LLPs.Next I’ll verify the RFC’s claims against the listed source sites and the related LLPs, without looking at other reviews.The RFC’s authority and transport claims need to be checked against the actual functions, so I’m reading those implementations next.I’ve confirmed the profile and access functions; next I’m checking credential prefixes, connection grants, and the Vite/Expo handoff paths.The Vite relay, Expo supervisor, and live-socket identity paths are the load-bearing r2 claims, so I’m reading those next.I’m checking remaining authority install sites, console route policy, and the sidecar/prod-refusal patterns next.The r2 revision is mostly a coherent security-boundary repair: the safety claim is topology-honest, the Vite path preserves LLP 0030’s fence, and gating at authority installation plus a connection-grant witness matches how identity is actually installed. Two r2 decisions are still defective against the snapshot.

## Concerns

1. **D3’s credential-free AdminRead carve-out omits claim exchange**  
   **IN-DELTA · MATERIAL**  
   **Defective decision:** D3 enumerates only approval-request/poll as the routes that keep a credential-free AdminRead posture after the loopback-read default is dropped. That exception set is incomplete.  
   **Evidence:** `llp/0262-dev-identity-custody-capability.rfc.md` §D3; `src/admin.rs` registers `POST /_snapback/api/console/approval/request` and `.../poll` as AdminRead, and also registers `POST /_snapback/api/console/claim/exchange` as AdminRead. `exchange_console_claim` does not call `authorize_master`; it relies on the middleware `authorize_for_mode(..., write=false)` path, which today succeeds on loopback with no token (`evaluate_access` read arm). `packages/snapback-admin-client/index.mjs` `exchangeConsoleClaim` posts that route with empty headers. LLP 0017’s operator claim-link is the other intentional pre-credential bootstrap.  
   Implementing D3 as written (`evaluate_access` requires admin token or `sbcc_` except the two named routes) 401s the claim link before the claim code is considered. Approval and master-token mint still work; the remote-dev claim flow does not.  
   **Disposition:** Name claim-exchange in the same bounded exception (or reclassify it as Public with its own claim-code gate), and treat the LLP 0017 amendment as “every credential-bootstrap AdminRead keeps its own proof; inspection AdminRead does not.”

2. **DB-only sidecar anchor is not the admin-token pattern and does not exist for named topologies**  
   **IN-DELTA · MATERIAL**  
   **Defective decision:** D1/D2 choose `<db>.dev-identity` over a ready-file sibling because “the DB anchor always exists for served instances.” That premise is false.  
   **Evidence:** `src/cli.rs` — `--memory` sets `database_path = None`; admin-token resolution is `database_path.as_deref().or(ready_path.as_deref()).map(admin_token_sibling)`, else an ephemeral mint. LLP 0017 already documents that triad (db sibling / ready-file sibling / TTY or `SNAPBACK_ADMIN_TOKEN`). `demos/_kit/server-process.mjs` defaults `db = ':memory:'` and always passes `--ready-file`; impersonation harvest is the ready-file sibling. Managed Vite is file-backed (`.snapback/dev.sqlite3`) and would work; kit and `snapback start --memory` would not.  
   D2 tells CLI/kit/raw-start to read `<db>.dev-identity` and to “extend `captureImpersonationCapability`” to that sibling. On the default kit topology there is no database file to harvest.  
   **Disposition:** Use the real admin-token path rule (`database` else `ready-file` else TTY/env), publish the path on the ready descriptor the way `adminTokenFile` is published, and say how kit harvests it. Do not claim a DB sibling always exists.

3. **Relay stamp must overwrite a client-supplied header and re-read after backend restart**  
   **IN-DELTA · implementation-phase**  
   `packages/snapback-vite/proxy.mjs` copies inbound headers then would attach the stamp; a client-supplied value must not win. `refreshTarget` already re-resolves a restarted backend; a per-boot sidecar must be re-read or the relay stamps a rotated secret. Specify both. Not a defective decision.

4. **Expo supervisor becomes a bearer-distributing host**  
   **IN-DELTA · implementation-phase**  
   Putting `sbdev_` on the loopback bootstrap exchange is the right Expo carrier (Metro is not a request relay). Anyone who can fetch that exchange also receives the Snapback origin in the binding. That is the same residual class as a fronted Vite host; OQ1 already owns it. Do not cache the bearer in the supervised binding cache across rotation.

5. **Header spelling is unspecified**  
   **PRE-EXISTING in spirit, reshaped by r2 · implementation-phase**  
   “The capability header” is enough for the RFC if it is a dedicated carrier and not `Authorization` (sessions reserves that). Prefix `sbdev_` is prefix-free against `REGISTERED_CREDENTIAL_PREFIXES`. Fine at this altitude.

OQ1–OQ4 are left open on purpose. OQ1’s deputy framing is honest (a Vite bind check cannot see `ngrok http 5173`). OQ2 does not contradict D6: D6 names where identity is installed; OQ2 asks whether host-ops that already hold the admin token need a second witness.

## What held up

Verified against source: bind-derived `resolve_profile`; served-loopback admin-token mint vs tokenless non-loopback disable; `evaluate_access` read arm is the tokenless-read residual; `authorize_for_mode` accepts `sbcc_` first; `dev_body_authority` / `dev_host_operation_authority` / in-band live-socket `auth` are the install sites; `/connection/open` is public and can carry a server-side witness without putting `sbdev_` in served JS; Vite `virtual:snapback/dev` and Expo `EXPO_PUBLIC_*` stay credential-free; `permits_dev_body_origin` and `validate_plaintext_auth_transport` (3 callers) compose and should not become the gate; `--allow-insecure-dev-auth` is bind-only; `require_operation_profile` has 20 call sites; approval-request/poll are deliberately credential-free AdminRead.

## Overall

r2 fixed the r1 browser-path mistake and scoped the safety claim to what custody can actually close. The remaining defects are both r2 decisions: D3’s exception set is one LLP 0017 bootstrap short, and the sidecar anchor was justified with a fact the serve path and kit do not satisfy. Close those two and this is ready.

VERDICT: NOT READY


## Round 3 (delta) — 2026-08-16 — grok family

**Runtime:** grok -m grok-4.6 --reasoning-effort xhigh --output-format plain --disable-web-search --permission-mode auto --max-turns 200
**Target revision r3 (sha256 first-16):** 48daf98cff73810b
**Capsule:** pristine r2 clone + r3 overlay (tar sha256 first-16 86ae6174bf6cd10b)
**Instructions (sha256 first-16):** 1683ed63a3f2455e
**Blindness:** structural
**Note:** attempt 1 exited without a verdict (partial preserved as r3-grok-attempt1-partial.md in the run directory, not counted); this is the counted attempt 2.
**Verdict: READY**

### Verbatim review

I'll review the r3 RFC against the snapshot source, starting with the document and the custody, admin, and client sites it depends on.The RFC is loaded. Next I’ll check the admin-token ladder, access evaluation, and how dev identity is actually installed today.I’ll now read the access-control and identity-install paths, plus the related LLPs the RFC claims to amend.The r3 text matches the snapshot. The admin-token triad, AdminRead floor, Expo bootstrap split, Vite relay, and prefix registry all check out; the remaining notes are implementation-phase, not defective decisions.

## Concerns

1. **Expo gated-leg checkout must not put the operator token on the device**  
   **IN-DELTA · implementation-phase**  
   D2 correctly keeps the bearer off the bare GET `/_snapback/expo/v1/bootstrap` payload (that route is unauthenticated and CORS-readable by Expo web). The only shipped gated leg is POST `/_snapback/expo/v1/control`, which authenticates `x-snapback-operator-token` as the **admin** token and is supervisor/CLI-held (`mintSupervisedOrdinarySession`, `onControl` in `packages/snapback-cli/expo-dev.mjs`). The native JS app does not have that token, and putting `sbat_` on a simulator/device would collapse D3’s plane split. Implement the “nonce/operator-token discipline” as an app-redeemable nonce or a native-only checkout that does **not** require presenting the admin token. CORS already blocks browser POST to the control path (`allow-methods: GET, OPTIONS`).  
   **Evidence:** `packages/snapback-cli/expo-dev.mjs`, `packages/snapback-expo/supervised-environment.mjs`  
   **Disposition:** spell the app-facing checkout in the implementation sketch; do not send `sbat_` to the device.

2. **`dev_host_operation_authority` vs OQ2**  
   **PRE-EXISTING · implementation-phase**  
   D1 names `dev_host_operation_authority` as a capability gate. That function is the Dev-mode installer for `HostOperationFunctionRun` / `HostOperationMutationDryRun` (`src/server.rs`). OQ2 still asks whether `function.run` / `auth.mintSession` need the capability on top of the admin token. Those writes are already token-gated (`operation_profile_requirement`, host-ops AdminWrite after the AdminRead floor). Treat OQ2 as controlling for admin-plane host-ops; do not silently add the check inside `dev_host_operation_authority` in a way that answers OQ2 by accident.  
   **Evidence:** `src/server.rs` (`prepare_registered_route_authority`), `src/admin.rs` (`operation_profile_requirement`, `evaluate_access` / host-ops AdminRead floor)  
   **Disposition:** keep OQ2 open; implement the D1 gate on app-plane `ClientAsserted` installation first.

3. **File-backed, no-ready-file shutdown unlink**  
   **IN-DELTA · implementation-phase**  
   Impersonation/secret-read teardown is ready-file-scoped (`remove_impersonation_capability` on the ready target in `src/cli.rs`). The r3 ladder puts a file-backed capability at `<db>.dev-identity`, which can exist with no ready target. “Removed on clean shutdown” needs an explicit unlink on that db sibling, not only the ready-file publisher path.  
   **Evidence:** `src/cli.rs` (`admin_token_sibling` / `database_path.or(ready_path)`, ready-target teardown), `src/admin.rs` (`resolve_serve_admin_token`)  
   **Disposition:** implement db-sibling removal on the serve shutdown path; leftover still means unclean exit.

4. **Vite deputy residual is sharpest on the open-time witness**  
   **PRE-EXISTING · implementation-phase**  
   OQ1 already owns the fronted-Vite residual. HTTP body identity is still Origin-fenced (`permits_dev_body_origin` only admits loopback origins; `SNAPBACK_DEV_AUTH_ORIGINS` is loopback-only). A stranger browser through ngroked Vite still fails that check. The residual that actually appears after D1 is: relay stamps `/connection/open` → grant is witnessed → identity-bearing live frames (`operation_registry` live-socket `ClientAsserted`) no longer need Origin. That is why OQ1 remains load-bearing even with Origin left in place.  
   **Evidence:** `src/server.rs` (`permits_dev_body_origin` call, `operation_registry` live ops), `src/admin.rs` (`canonical_loopback_http_origin`), `packages/snapback-vite/proxy.mjs`  
   **Disposition:** no design change; keep OQ1 as written.

## Overall assessment

The r2 design is sound: bind-derived `ClientAsserted` identity is the live hole (curl and other Origin-less callers skip `permits_dev_body_origin`; served loopback still allows tokenless AdminRead). Custody matches the five existing `owner_only_file` primitives. Gating installation — not transport — is the right chokepoint. Relay-side stamping preserves LLP 0030 (`virtual:snapback/dev` already ships no origin and no secrets). The dedicated header must not be `Authorization` (sessions own it; Dev already rejects `Authorization` on bootstrap). D3’s plane split (dev-identity is not an admin read credential) is correct.

The r3 delta fixes real mismatches with this tree:

| r3 change | Snapshot check |
| --- | --- |
| Admin-token triad + ready-descriptor ad | `database_path.or(ready_path)` → `admin_token_sibling`; kit default is `:memory:` + `--memory` + ready-file |
| Claim-exchange in the D3 carve-out | `POST /_snapback/api/console/claim/exchange` is `AdminRead` and is authorized at the shared `authorize_for_mode` floor **before** the claim-code proof in the handler |
| Expo native / web / refused split | GET bootstrap is credential-free and CORS-readable; USB Android is already `adb reverse`; physical iOS and TCP/IP adb are already refused |
| Generic `SNAPBACK_DEV_IDENTITY_REFUSED` | Same collapse-to-one-403 as `ImpersonationCapabilityRegistry::authorize` |
| Relay overwrite + restart re-read | Proxy already retries on backend restart; it currently forwards client headers verbatim — overwrite is required |
| D4 `fronted` + unset = full prod | Fail-closed and consistent with `allows_provisioning()` / NonProd |

Open questions stay open and do not embed a bad decision. No unresolved material defect in the document as written.

VERDICT: READY

