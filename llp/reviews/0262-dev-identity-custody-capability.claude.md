# Reviews: LLP 0262 — Dev identity becomes a custody capability

## Round 1 — 2026-08-15 — claude family

**Reviewer:** fresh blind general-purpose agent (Claude Fable 5 harness), capsule cwd
**Target revision (sha256):** 7f1ca7cf4d4aef28407df4591c9baac93b7deea041a8bd5f6e652a5cc265d7ab
**Capsule:** git archive fa81cd856 minus llp/reviews/0262* (tar sha256 first-16 39f3385a0932fc02)
**Instructions (sha256 first-16):** 965e8344aca27f39
**Blindness:** structural
**Verdict: NOT READY**

### Verbatim review

All claim sites are now verified. Here is the review.

---

# Review: LLP 0262 — Dev identity becomes a custody capability (r1)

## Verification summary

The document's factual claims were checked against the snapshot and are substantially accurate:

- `resolve_profile` derives `dev` from a loopback bind with `SNAPBACK_PROFILE` unset (`src/admin.rs:330-340`), and the dev-mode body dev-user selector is accepted with no credential for callers that omit `Origin` (`src/server.rs:13007-13023`) — the uncredentialed-assertion exposure is real.
- `evaluate_access` allows reads on bare loopback (`src/admin.rs:3641-3670`); the tokenless-loopback write branch is embedded-router-only because the serve path resolves/mints a `0600` token on every loopback bind (`src/admin.rs:2337-2415`, `src/cli.rs:8467-8488`). The `loopback` fed to it is the **bind** posture, so tunnelled requests pass as loopback — confirmed.
- The impersonation capability precedent is as described: per-boot, `sbic_`, startup-nonce-associated, owner-only ready-file sidecar, constant-time digest comparison (`src/admin_impersonation.rs`), minted beside `src/cli.rs:8505-8519`; the rehearsal sidecar prod-presence startup refusal exists (`src/cli.rs:8356-8371`). `secure_file`/`owner_only_file` hardening (O_NOFOLLOW, strict 0600) confirmed (`src/secure_file.rs:22,104,151`).
- The demo kit harvests the impersonation sidecar (`demos/_kit/server-process.mjs`, `captureImpersonationCapability`), console mint requires `loopback && Local` (`src/admin.rs:5238-5257`), direction 1 landed in `guide/auth/targets.md:40-52`, `auth.mintSession`/`function.run` are AdminWrite operations (`src/server.rs:18838-18854`), LLP 0060 D1's fence limit and LLP 0168's "needs a focused RFC" conclusion are quoted accurately, and the tunnelled-loopback ticket's 2026-08-15 survey matches the RFC's motivation section.

One claim the code contradicts, and it is load-bearing — see concern 2.

## Concerns

**1. Serve-time bootstrap injection redistributes the capability over the very channel the RFC claims to close — MATERIAL.**
Defective decision: D2's first row has the dev host "inject the capability into the served client bootstrap," i.e. hand the raw custody credential to **any HTTP caller who can fetch the bootstrap**. The RFC's own motivation names the demand behind tunnelling as "reaching a phone" — and reaching a phone with a web client means tunnelling the client-serving port (the Vite dev host, the packaged dev host's client arm, or the server-served supervised Expo bootstrap exchange `/_snapback/expo/v1/bootstrap`, `packages/snapback-expo/supervised-environment.mjs:8-18`). In every such topology the tunnel stranger fetches the bootstrap first and receives the capability, then asserts identities freely — the Summary's claim ("a caller reaching the server through a tunnel does not have the machine's filesystem and gets a typed refusal") and D1's claim ("removes the *uncredentialed* assertion path — a tunnel or LAN stranger who was not handed the capability by the developer's own launcher") are both false in these topologies, because the launcher hands the capability to strangers automatically. LLP 0168 itself flags the tunnelled-Vite-relay composition (`llp/0168-browser-carrier-dev-edge.research.md:92`), and neither the dev host nor the server can detect the front. OQ1 does not cover this: OQ1 is about the capability *legitimately* handed to the developer's own phone on a wide bind, not about serve-time distribution to arbitrary callers. Custody proofs work in the four shipped precedents precisely because distribution is out-of-band of the attacked channel (filesystem, spawn env); serving one over HTTP breaks that property. Disposition: add an explicit channel/topology analysis; scope the safety claim honestly (the proof holds only for tunnels of channels that do not serve client bootstrap), and redesign the browser path so the raw capability never enters HTTP-served content (e.g., relay-side header attach with its own limits stated), or accept and document the residual.

**2. The Vite-row premise "the same way it already injects the origin" is contradicted by the code and by LLP 0030's fence — MATERIAL.**
Defective decision: the feasibility of the primary injection path rests on a precedent that does not exist. The Vite plugin's virtual module deliberately ships **only a relative base path and sanitized state**, with the governing invariant: "no private loopback URL, admin token, token-file path, or command line may reach browser-visible module code; the browser client uses the relative base path, never the backend origin" (`packages/snapback-vite/index.mjs:181-197`, `@ref LLP 0030#generated-app-facts`). So (a) the dev host does *not* already inject the origin into browser bootstrap — the design explicitly refuses to; and (b) injecting a `0600`-custody credential into browser-visible bootstrap contravenes the same governing fence (the admin-token exclusion is the exact class), which the RFC neither acknowledges nor proposes to amend. An origin-injection precedent does exist for Expo (`__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__`), but not for the row that cites LLP 0030. Disposition: correct the premise; if browser-visible credential injection is intended, amend LLP 0030's fence deliberately and defend the change; otherwise redesign the browser path.

**3. D3 grants the widely-distributed dev-identity capability admin-read authority without justification — MATERIAL.**
Defective decision (decision quality/safety): D3 makes reads accept "the admin token **or the dev-identity capability**." By D1's own framing the capability deliberately travels to every client the developer's tooling starts — browsers and LAN phones included — while every constituency that legitimately needs admin reads (CLI, dev host, `_kit`, harness) has filesystem custody and can present the token (and the console's derived credential is already accepted ahead of `evaluate_access` in `authorize_for_mode`, `src/admin.rs:3858-3871`, so console flows don't need this either). The coupling means any leak of the client-held capability — including via concern 1's serve-time distribution, devtools, or request logs — discloses the whole admin inspection surface that D3 exists to protect, and it hands every phone client admin-read authority it has no use for. The narrower option (token/console-credential-only reads) was available and is not argued against. Disposition: drop the capability from the read gate, or explicitly justify the coupling and its blast radius in the RFC.

**4. D6 chokepoint counts have drifted — implementation-phase.**
`validate_plaintext_auth_transport` has three non-test call sites (`src/admin.rs:3245`, `src/cli.rs:694`, `src/server.rs:10506`), not two; `require_operation_profile` has 20 call sites, not 22; "~14 acceptance tests" understates current `captureImpersonationCapability` usage (~35 demo files). The structural claims (few chokepoints, single `permits_dev_body_origin` caller at `src/server.rs:13015`, mint beside `src/cli.rs:8506`) hold. Refresh the counts.

**5. Browser WebSocket carrier unaddressed — implementation-phase.**
Browsers cannot set custom headers on WebSocket upgrades. If any dev-identity assertion travels on the live-socket path rather than exclusively on HTTP requests (e.g., `connection/open` before socket attach), D1's "dedicated header" carrier is infeasible from browser clients. The chokepoint list should state where the assertion is established and confirm the header carrier suffices, or name the WS-side carrier.

**6. Per-boot rotation and stale-sidecar operational edges — implementation-phase.**
Per-boot rotation invalidates "printed origin config" for phone clients on every server restart (workable where a live bootstrap exchange exists; a papercut for printed config), and the D1 prod-presence startup refusal (mirroring rehearsal) means a crashed dev boot's leftover sidecar wedges a subsequent prod/`fronted` boot until removed. Specify cleanup and the remediation message.

**7. D4 wording admits two readings — implementation-phase.**
"Refuses to mint the dev-identity capability's *loopback conveniences*" plus "the bind-derived profile **default** flips to `prod` semantics" can be read as (a) `fronted` changes only the unset-profile default, with explicit `SNAPBACK_PROFILE=dev` still minting, or (b) `fronted` kills dev identity outright — and reading (b) collides with "dev identity requires the capability (already true after D1)" and with D1's prod-presence refusal. Reading (a) is coherent and evidently intended ("the operator must select capabilities explicitly"); one clarifying sentence resolves it.

**8. D3's rollout staging unspecified — implementation-phase.**
D5's three stages are written for the dev-identity capability. Dropping the bare-loopback read allowance is its own breaking change for tokenless local read tooling; state whether D3 rides the same stages.

## Overall assessment

The problem diagnosis is verified and precise; the survey claims match the source almost everywhere, and the choice of custody over transport inference is the right primitive with five shipped precedents behind it. D1's server-side mechanics, the typed refusals, and the staged rollout are sound. The document's weakness is concentrated in the client-distribution half: D2's serve-time browser injection rests on a factually wrong precedent, conflicts with LLP 0030's browser-facts fence, and — most importantly — re-serves the credential over exactly the channels a developer tunnels to reach a phone, which is the RFC's own motivating scenario; the safety claims are correspondingly overbroad, and D3 amplifies the blast radius by giving that same widely-distributed credential admin-read authority. These are fixable with a topology-scoped safety claim, a redesigned (or honestly-caveated) browser path reconciled with LLP 0030, and a narrowed or justified D3 — but as written they are defective decisions, not polish.

VERDICT: NOT READY


## Round 2 (delta) — 2026-08-15 — claude family

**Reviewer:** fresh blind general-purpose agent (Claude Fable 5 harness), capsule cwd
**Target revision r2 (sha256 first-16):** 22ba760d2d28b9ce
**Capsule:** pristine r1 clone + r2 overlay (tar sha256 first-16 13b29623e5262d06)
**Instructions (sha256 first-16):** ca01a2ee53db1a00
**Blindness:** structural
**Verdict: NOT READY** (1 MATERIAL, IN-DELTA; pre-existing text clean)

### Verbatim review

I have now read the target RFC in full and verified its claims against the snapshot source. Below is my Round 2 (delta) review.

---

# Review: LLP 0262 r2 — Dev identity becomes a custody capability

## Verification summary (claims checked against source)

Verified accurate: `resolve_profile` bind-derived dev default and fail-closed typo handling (`src/admin.rs` ~330); `evaluate_access` read arm passing on `loopback || token_ok` and tokenless non-loopback `Disabled` (`src/admin.rs` ~3641); `authorize_for_mode` accepting the console credential ahead of `evaluate_access` (`src/admin.rs` ~3858); console approval request/poll registered as `RoutePolicy::AdminRead` with the console shell itself `SystemStatic`/public, so D3's carve-out is sufficient for the credential bootstrap (`src/admin.rs` ~4252–4268, `src/server.rs` RoutePolicy enum); D6 counts — exactly 20 `require_operation_profile` call sites, 3 non-test `validate_plaintext_auth_transport` callers, 1 `permits_dev_body_origin` caller, 34 suites using `captureImpersonationCapability: true` (doc says ~35); `--allow-insecure-dev-auth` semantics (`src/admin.rs` ~117); `sbdev_` mutually prefix-free against the registry (`src/auth/crypto.rs` ~18–39, 732); the relay terminating every allowlisted app route including `POST /connection/open` and both WebSocket legs, so relay-side stamping is feasible with no CORS change (`packages/snapback-vite/proxy.mjs`, `allowlist.mjs`); dev-mode socket frames asserting identity in-band after `/connection/open`, with in-process grants that die on restart (`src/server.rs` `handle_live_socket_text_authorized` ~30008, `prepare_act` ~6443); the dev-authority installation chokepoints `dev_body_authority`/`dev_host_operation_authority` (`src/server.rs` ~10906–10925); `permits_dev_body_origin` composing as an origin fence (`src/admin.rs` ~2221, `src/server.rs` ~13008); external Vite mode accepting only `server.url` (`packages/snapback-vite/index.mjs` ~231); the Expo supervisor loopback bootstrap exchange (`packages/snapback-cli/expo-dev.mjs` ~28, ~202); LLP 0168's "changes the server's auth boundary and needs a focused RFC" (line 153); LLP 0213's prod-startup-refusal precedent (M-23); LLP 0036's blessed SSH tunnel (line 429); LLP 0030's browser-facts fence; both referenced tickets exist.

## Concerns

**1. The DB-sibling anchor premise is false for in-memory served instances, and D2's `_kit` row does not compose with it.**
IN-DELTA (delta items 5 and 6). **MATERIAL.**
Defective decision: D1 chooses the DB sibling *over* the ready-file sibling on the stated ground that "the DB anchor always exists for served instances." It does not: `snapback start --memory` is a first-class served mode with no database path at all (`src/cli.rs` ~8168: `if args.memory { (None, None) }`), and it is the demo kit's *default* topology (`demos/_kit/server-process.mjs` line 94: `db = ':memory:'`; line 628 pushes `--memory`). The cited "admin-token pattern" is in fact a **dual-anchor ladder**, not a DB sibling: `database_path.as_deref().or(ready_path.as_deref()).map(admin_token_sibling)` — DB sibling when file-backed, ready-file sibling when in-memory, per-process token when neither (`src/cli.rs` ~8467–8497; the shutdown path at ~9238 removes the ready-sibling token an in-memory instance was "handed off through"). As written, an in-memory served instance mints a capability with nowhere to publish it, D2's `_kit` row ("extend the existing `captureImpersonationCapability` harvest to the new sibling") has nothing to harvest — the impersonation harvest reads a *ready-file* sibling (`src/admin_impersonation.rs` ~178: `<ready-file>.impersonation`) — and stage 3 would break the 34 harvest-using acceptance suites plus every dev-identity client of a `--memory` instance. The doc also mischaracterizes its own cited precedent while rejecting the alternative that the precedent actually uses.
Evidence: `src/cli.rs` (~8168, ~8467–8497, ~9238), `demos/_kit/server-process.mjs` (94, 628), `src/admin_impersonation.rs` (~167–180), `llp/0262-dev-identity-custody-capability.rfc.md` D1/D2.
Disposition: replace the single-anchor decision with the admin token's actual ladder (DB sibling when file-backed; ready-file sibling for in-memory instances with a ready file, advertised in the descriptor like `impersonationCapabilityFile`; document the no-anchor posture for `--memory` without `--ready-file`), and correct the false premise sentence.

**2. The Expo supervisor rendezvous hands the bearer over a credential-free loopback HTTP exchange, weaker than 0600 file custody.**
IN-DELTA (delta item 5). Implementation-phase.
The bootstrap exchange is a credential-free loopback origin advertised via `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` (`packages/snapback-cli/expo-dev.mjs` ~56–64), so any local process of *any* user can fetch whatever payload rides it — broader than the owner-only file every other carrier row uses. The doc's stated threat model ("deliberately reaches every client the developer's own tooling starts"; removes only the uncredentialed path) plausibly covers this, and the exchange already has an operator-token control-plane precedent (`x-snapback-operator-token`, ~1062) to harden against cross-user harvest at implementation time. No defective decision identified.
Disposition: note in D2 that the exchange leg should gate the capability payload (nonce or operator-token discipline) rather than serving it on the bare payload route.

**3. The sidecar is "overwritten each boot" but never removed, so every dev→prod flip on the same database hits the startup refusal.**
IN-DELTA (delta item 6). Implementation-phase.
The prod-presence refusal is a deliberate, precedented fail-closed choice (LLP 0213 M-23), and the message carries the one-line cleanup; but because D1 specifies overwrite-only, a *clean* dev shutdown leaves the sidecar, making the refusal the ordinary case rather than a crash indicator. The in-memory admin-token precedent removes its handoff file at shutdown (`src/cli.rs` ~9238). No defective decision — the refusal posture is right — but clean-shutdown removal would make the signal meaningful.
Disposition: implementation note; consider remove-on-clean-shutdown.

**4. D4's "default flips to prod semantics" under `fronted` + unset profile is ambiguous about scope.**
IN-DELTA (delta item 9). Implementation-phase.
It is unclear whether the *resolved profile itself* becomes Prod (also disabling provisioning/seeding/`function.run` via `OperationProfileRequirement::NonProd`, `src/admin.rs` ~180–248) or only the dev-identity mint/acceptance flips. Either reading is fail-closed and defensible; the decision (no silent dev behind a declared front) is sound, so this is a precision gap, not a defective decision.
Disposition: one clarifying sentence in D4.

**5. Pre-existing text: no MATERIAL concern found.**
PRE-EXISTING. Not a concern per se, recorded for completeness: the custody primitive, its five precedents, the motivation's authority-site facts, the non-goals, and OQ2–OQ4 all check out against source, and the r2 rewrites (topology-honest scoping, relay-side stamping preserving LLP 0030's fence, the grant-witness socket design, the D3 narrowing with the console-approval carve-out, the origin-fence composition) are correct against the code as it stands.

## Overall assessment

R2 is a substantial, well-verified improvement: the safety claim is now honestly scoped with the confused-deputy residual named and parked on LLP 0168 (OQ1); the browser path genuinely preserves LLP 0030's fence because the relay terminates every app route including `/connection/open`; the socket design matches the real grant machinery; D3's narrowing correctly excludes the app-plane capability from the operator plane and carves out exactly the two routes that need credential-free AdminRead; the D6 chokepoints and counts are accurate to the file. The one defect is concentrated and fixable: D1's anchor decision rests on a factually false premise about served instances, contradicts the very admin-token precedent it cites, and as written strands the capability on the in-memory topology that the demo kit — the enforcement witness D5 depends on — uses by default. Until the anchor decision is corrected to the dual-anchor ladder the codebase already implements, the document contains an unresolved MATERIAL concern.

VERDICT: NOT READY


## Round 3 (delta) — 2026-08-15 — claude family

**Reviewer:** fresh blind general-purpose agent (Claude Fable 5 harness), capsule cwd
**Target revision r3 (sha256 first-16):** 48daf98cff73810b
**Capsule:** pristine r2 clone + r3 overlay (tar sha256 first-16 86ae6174bf6cd10b)
**Instructions (sha256 first-16):** 1683ed63a3f2455e
**Blindness:** structural
**Verdict: READY** (first claude READY — claude family closes out per the author's drop-after-first-READY instruction)

### Verbatim review

I have now verified all seven delta items and the key pre-existing claims against the snapshot source. Here is the complete review.

---

# Review — LLP 0262 r3 (delta round, round 3)

## Source verification of the enumerated delta

Every r3 delta item was checked against the snapshot:

- **Anchor ladder (item 1):** `llp/0017-admin-console-inspection-surface.rfc.md` (§ around "minted token persists 0600 next to the SQLite database (or the ready file for in-memory instances, or per-process when there is neither)") confirms the triad exactly as r3 now states it. Ready-file sibling precedents exist (`P.secret-read-root`, `<ready-file>.rehearsal` in `src/cli.rs`), descriptor advertisement precedents exist (`admin_token_file` in `src/cli.rs` ~6713/6816, `impersonationCapabilityFile` in `src/host_ops_contract.rs` ~148), and `demos/_kit/server-process.mjs` (~958) harvests exactly this shape. Clean-shutdown removal matches the 0137 G1 descriptor-scoped custody precedent. The r2 DB-only-sibling anchor was a real defect for the `--memory` kit default; r3 corrects it faithfully.
- **Credential-bootstrap carve-out (item 2):** In `src/admin.rs` (~4183–4276) exactly three console routes carry `RoutePolicy::AdminRead`: `/_snapback/api/console/claim/exchange`, `/console/approval/request`, `/console/approval/poll`. Every other console route (`claim` mint, `claim/status`, `claim/revoke`, `approval/approve`, `credential`, all reachability routes) is AdminWrite. The r3 enumeration matches the source route-for-route. The console shell itself is `system_static_route`, so gating the read arm does not strand the pre-credential browser. `authorize_for_mode` (`src/admin.rs` ~3858) accepts the console credential ahead of `evaluate_access`, as D3 asserts. The `evaluate_access` read arm (`loopback || token_ok`, ~3665) is the exposure D3 closes.
- **Expo split (item 3):** `packages/snapback-cli/expo-dev.mjs` confirms the topology: a bare, CORS-admitted, browser-fetchable GET `/_snapback/expo/v1/bootstrap` payload leg (~1076–1088 with `access-control-allow-origin` for admitted loopback origins) and a separate `x-snapback-operator-token`-gated POST control leg (~1028–1074); sessions-first supervised mint (`mintSupervisedOrdinarySession`, operator token supervisor-held); per-serial `adb reverse` for USB with TCP/IP adb explicitly refused (~373–433); rendezvous origin (not credentials) in `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`. The r2 undifferentiated Expo row would have put the bearer on the browser-fetchable leg for the web target; the r3 split is the correct repair and matches how the code actually distinguishes legs.
- **Generic refusal (item 4):** matches the impersonation registry discipline (`src/admin_impersonation.rs` ~89: "unrelated credentials intentionally collapse to one 403"). Moving path remediation out of the network body removes a genuine oracle the r2 text would have handed a tunneled prober; the operator-TTY prod-refusal message naming the path is consistent with this (printed, not served).
- **Relay pins (item 5):** `packages/snapback-vite/proxy.mjs` forwards client headers wholesale today (forward loop copies all non-hop-by-hop headers), so the overwrite pin is load-bearing and correct; the ready-file re-resolve-on-restart machinery (~94, ~130, ~223) makes restart re-read a natural extension. `/connection/open` is allowlisted (`allowlist.mjs`:48) and both WS legs terminate in the relay. Sessions own `Authorization: Bearer` (session mint envelope), so the never-Authorization pin is correct.
- **D4 fronted+unset = prod (item 6):** `resolve_profile` (`src/admin.rs` ~330) already fails closed to `Prod` on any unrecognized value; pinning `fronted`+unset to full prod semantics (including `allows_provisioning` refusing `NonProd` operations, ~256) extends the same fail-closed pattern coherently and removes the r2 ambiguity about what that cell meant.
- **D5/D6 updates (item 7):** witness-list and count updates. `validate_plaintext_auth_transport` has exactly 3 non-test callers, `permits_dev_body_origin` exactly 1, as D6 claims; `require_operation_profile` call sites and the impersonation-harvest suite count are approximately right (I count ~21 and ~52 grep hits respectively vs. "20" and "~34" — content-located, rounding-level).

Core pre-existing premises re-verified: `dev_body_authority` (`src/server.rs` ~10906) installs identity from the request body `auth` object with no credential; unset-profile loopback resolves `Dev`; LLP 0168 records the undetectable-front verification and the "focused RFC" commission; LLP 0060 D1 states the fence limit; LLP 0030 confirms the virtual module serves no secrets (the r2 correction of the r1 premise stands); destructive writes are already custody-gated (ENG-23443 comment on `evaluate_access`); `sbdev_` fits the `REGISTERED_CREDENTIAL_PREFIXES` registry pattern (`src/auth/crypto.rs` ~732).

## Concerns

1. **Native gated-leg carrier mechanism unspecified.** IN-DELTA. Implementation-phase. D2's native Expo row commits to "nonce/operator-token discipline" without saying how a nonce reaches native targets but not the web bundle. No defective decision: native-only channels exist (simctl launch environment/arguments, `adb -s <serial> shell am start` extras, the per-serial `adb reverse` leg), the operator token itself is correctly kept supervisor-held (`packages/snapback-cli/expo-dev.mjs` ~278–301), and D5 stage 2 requires an end-to-end witness per supported row, which forces the mechanism to be built and proven. Disposition: specify the nonce channel in the implementation; no doc change required.

2. **"Keeps its own proof" overstates approval-request/poll.** IN-DELTA. Implementation-phase. The r3 rule says "credential-bootstrap AdminRead keeps its own proof," but of the three routes only claim-exchange carries a cryptographic proof (the claim code); approval-request/poll are proof-free, rate-limited, and gated by the token-holding terminal's approve step (`src/admin.rs` approval registry, ~1099–1226). The document's own parenthetical states this accurately, and exposing request/poll to a fronted caller is precisely the designed RFC-8628-shaped remote-approval flow, so no defective decision — the sentence's shorthand is just looser than the parenthetical. Disposition: optional one-word tightening ("its own proof or the operator-approval gate") at next edit.

3. **Relay stamps whatever the allowlist admits, including CSRF-shaped simple requests.** PRE-EXISTING (relay-side stamping is r2; r3 only pinned overwrite/re-read). Implementation-phase. A non-admitted local page could fire a no-preflight simple POST at the relay, which would stamp and forward it. Mitigations already in the design and code: the allowlist is narrow (`allowlist.mjs`), JSON bodies from foreign origins trigger preflight, the backend's `permits_dev_body_origin` and dev CORS admission exist today with the same shape, and the broader stamping-for-strangers class is exactly OQ1's named residual. Disposition: implementation should stamp only after content-type/route validation; covered by OQ1's framing otherwise.

4. **Enforce-stage read flip may strand unenumerated tokenless loopback read tooling.** PRE-EXISTING core (D3 landed in r2; r3 extended the carve-out and added the redemption witness). Implementation-phase. Any local script hitting AdminRead GETs bare will break at stage 3. D5 stage 2's log-once warning plus the demo/template acceptance witnesses (now including the claim-flow redemption test) are the designed discovery mechanism; OQ3 already holds the timing question. No defective decision.

5. **D6 count drift.** IN-DELTA. Implementation-phase. "20 call sites" for `require_operation_profile` vs. ~21 in source; "~34 suites" for the impersonation harvest vs. ~52 grep-level file hits. The claims are explicitly approximate/content-located and nothing in the design turns on the exact numbers. Disposition: refresh at implementation time.

## Overall assessment

Round 3's delta is a faithful repair round: each of the seven items addresses a real r2 defect (the nonexistent DB sibling under `--memory`, the incomplete bootstrap carve-out that would have broken first-credential redemption, the Expo web target that would have put the bearer on a browser-fetchable route, the path-disclosing refusal oracle, the underpinned relay stamp, the ambiguous `fronted`+unset cell), and each lands on the shape the source actually has. I verified the route enumeration, the anchor triad, the Expo leg split, and the relay machinery directly against the snapshot; all match. The remaining concerns are implementation-phase details or fall squarely inside the four Open Questions' framings, none of which embeds a defective decision. The document's core moves — custody at the authority-installation chokepoint, topology-honest scoping with the deputy residual named rather than papered over, operator-plane/app-plane separation retained in D3, fail-closed exposure declaration — are correct, coherent, feasible against the code as it exists, and safe.

Key evidence paths: `src/admin.rs` (evaluate_access ~3641, authorize_for_mode ~3858, console routes ~4183–4276, resolve_profile ~330), `src/server.rs` (dev_body_authority ~10906, OpenConnectionRequest ~5216), `src/auth/crypto.rs` (~732), `src/admin_impersonation.rs` (~89), `packages/snapback-cli/expo-dev.mjs` (~28, ~278–301, ~373–433, ~1016–1107), `packages/snapback-vite/proxy.mjs` and `allowlist.mjs` (:48), `demos/_kit/server-process.mjs` (~958), `llp/0017-admin-console-inspection-surface.rfc.md`, `llp/0030-managed-snapback-vite-dev.rfc.md` (~415, ~699–703), `llp/0168-browser-carrier-dev-edge.research.md` (~71, ~153), `llp/0060-hosted-auth-security.rfc.md` (D1 ~216).

VERDICT: READY
