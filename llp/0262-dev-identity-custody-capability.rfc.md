# LLP 0262: Dev identity becomes a custody capability

**Type:** RFC
**Status:** Accepted
**Systems:** Auth mode, Server, Security, Developer experience, Local server lifecycle, Demos, Packaged dev loop, CLI
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-25 (r10: removed the harness-only Expo-web capability interceptor, retained an honest sessions/isolation receipt, and returned the web D2 row to NOT YET)
**Revised:** 2026-08-25 (D2 corrects the supervised native carrier: the binding
GET stays session-free and a later admitted adoption POST mints the session)
**Revised:** 2026-08-16 (r5: Accepted by author ruling; all four OQs ruled and folded in; revision history trimmed)
**Related:** LLP 0009, LLP 0010, LLP 0017 (D3 amends its loopback-read default), LLP 0030 (browser-facts fence preserved), LLP 0031, LLP 0036, LLP 0039, LLP 0060, LLP 0168, LLP 0181, LLP 0213, `issues/shelved/20260804-tunnelled-loopback-server-keeps-dev-profile.md`, `issues/closed/20260811-ios-physical-device-dev-carrier-decision-packet.md`

## Summary

Client-asserted dev identity is granted today because the server's **listener
bind resolved loopback** — with `SNAPBACK_PROFILE` unset, `resolve_profile`
derives `dev` from the bind, and dev-mode auth then installs identity from
request bodies with no credential. That inference does not survive a front:
a tunnel (`ngrok http 4420`), an SSH forward, or a local reverse proxy hands
a publicly reachable caller a server that still sees a loopback listener.
LLP 0060 D1 states the limit; LLP 0168 verified the server cannot detect an
undeclared front and said the repair "changes the server's auth boundary and
needs a focused RFC." This is that RFC, commissioned by author ruling
2026-08-15 on the tunnelled-loopback ticket.

The proposal: **dev identity assertion stops being a bind inference and
becomes a custody proof.** A non-prod served instance mints a per-boot
dev-identity capability as an owner-only (`0600`) sidecar on the admin
token's anchor ladder. Whatever installs dev authority — body identity on
HTTP, dev frames on a live socket — requires the capability, presented
directly by custody-holding clients and stamped **server-side by the managed
relay** for browsers, so the raw bearer never appears in served content
(LLP 0030's browser-facts fence is preserved, not amended). A caller
tunneling to Snapback's own listener lacks the capability and gets a typed
refusal.

**Scope of the safety claim (topology-honest):** this RFC closes fronts of
*Snapback's listener* (direct tunnel/forward/proxy to the server port) and
uncredentialed LAN callers. A front placed in front of a *credential-holding
dev host* (e.g. `ngrok http 5173` at Vite) makes that host a confused deputy
stamping for strangers — a named residual of this design (§D2, OQ1); the real
fix is the authenticated first-navigation carrier LLP 0168 already scoped,
which stays out of scope here. Tokenless admin **reads** on loopback close in
the same move (§D3), and `SNAPBACK_EXPOSURE=fronted` becomes declared-exposure
vocabulary (§D4).

## Motivation

The 2026-08-15 authority-site survey (recorded in the tunnelled-loopback
ticket, verified against source at `80aa7b8a5`) sharpened the exposure:
destructive/provisioning HTTP writes are already custody-gated or disabled
(the served-loopback `0600` admin token, ENG-23443; tokenless non-loopback
instances disable admin access), so the live residual through a front is
(a) app-data reads/writes under client-asserted, body-installed dev identity
and (b) tokenless admin reads via `evaluate_access`'s loopback read arm.
The exposure needs no misconfiguration, and the demand behind tunneling
(reaching a phone) is real and unserved (the iOS carrier decision packet).

Documentation (direction 1) informs only the reader; a declaration alone
(direction 2) helps only the diligent; `SNAPBACK_PROFILE=prod` refuses the
workflow rather than distinguishing the caller. Custody is the right
primitive because the repo already trusts it five times — admin token,
impersonation, agent-destroy, secret-read proof, rehearsal — all on
`secure_file`/`owner_only_file`, with the demo kit already harvesting a
sidecar (`captureImpersonationCapability`).

## Design

### D1. The dev-identity capability

- At startup, a served instance whose resolved profile permits dev-mode auth
  mints an `sbdev_`-prefixed capability (registered in
  `REGISTERED_CREDENTIAL_PREFIXES`), startup-nonce-bound, written via
  `owner_only_file` on the **admin token's anchor ladder**: database sibling
  (`<db>.dev-identity`) when file-backed, else ready-file sibling when
  `--ready-file` is given (the `--memory` + kit topology), else a
  per-process mint disclosed once on the operator TTY — the same triad
  LLP 0017 documents for the admin token. The resolved path is advertised on
  the ready descriptor exactly as `adminTokenFile`/`impersonationCapabilityFile`
  are, which is what `_kit` harvests. Rotated by overwrite each boot and
  removed on clean shutdown — an explicit unlink of whichever anchor was
  used, including the db sibling when no ready file exists (the existing
  teardown is ready-file-scoped) — so a leftover sidecar means an unclean
  exit.
  Prod never mints; a sidecar found by a prod boot is a startup refusal
  (rehearsal rule, LLP 0213) whose message names the path — a refusal
  printed to the operator, not served to a network caller.
- **Gate point:** dev *authority installation*, not transport fences.
  Wherever the server resolves `ClientAsserted` dev authority from request
  content (`dev_body_authority` / `dev_host_operation_authority` on HTTP,
  dev frames on the socket path), installation requires a verified
  capability witness. The gate lands on app-plane `ClientAsserted`
  installation first; whether admin-token-gated host-ops
  (`function.run`/`auth.mintSession` via `dev_host_operation_authority`)
  also require it is OQ2 and must not be answered incidentally by the
  implementation. `validate_plaintext_auth_transport` and
  `permits_dev_body_origin` keep their current jobs and compose; neither is
  the capability check.
- **Live sockets:** browsers cannot set custom upgrade headers, and dev
  socket frames assert identity in-band after `/connection/open`. The
  capability is therefore presented at `/connection/open` (a dedicated
  header — never `Authorization`, which sessions own — for direct clients;
  relay-stamped for browsers), the verification is bound into the resulting
  connection grant as a witness, and identity-bearing dev frames are
  accepted only on witnessed connections. Reconnects re-present; restart
  rotates the capability and grants die with the boot.
- Refusal: one non-oracular code, `SNAPBACK_DEV_IDENTITY_REFUSED`, covering
  missing/malformed/mismatched alike (the impersonation registry's
  collapse-to-one-403 discipline), constant-time comparison. **The network
  refusal body is generic** — remediation pointing at the exact sidecar path
  appears only in server-local logs and custody-holding CLI diagnostics,
  never in the response an unauthenticated (possibly tunneled) caller sees.
- The capability is a **dev credential with a LAN threat model**: it
  deliberately reaches every client the developer's own tooling starts.
  What it removes is the uncredentialed path.

### D2. Carriers, per shipped topology

The bearer never appears in browser-visible modules, served bootstrap
payloads fetchable from browser JavaScript, or `EXPO_PUBLIC_*` config —
LLP 0030's fence, which stands. (The r1 "inject like the origin" premise was
wrong: the Vite virtual module deliberately serves no origin and no secrets.)

| Topology | Carrier |
| --- | --- |
| CLI verbs | Resolve the sidecar on the anchor ladder (admin-token discipline). |
| `_kit` / harness / headless node clients | Read the ready-descriptor-advertised path at spawn (the existing `captureImpersonationCapability` shape); passed by env or client option, never argv. |
| Managed Vite loop (LLP 0030) | The relay (`proxy.mjs`) — which terminates every allowlisted app route including `/connection/open` and both WebSocket legs — attaches the header **relay-side**. It overwrites any client-supplied header value, and re-reads the sidecar on ready-descriptor nonce change or per forwarded request/upgrade — a connection-error-triggered refresh alone misses a same-port backend restart that answers with an auth refusal. Browser JS never sees the bearer; no CORS change. A *fronted Vite* stamps for strangers: named residual (OQ1), owned long-term by LLP 0168's carrier decision. |
| External/attach Vite mode | Accepts only a URL today. New explicit handoff: `SNAPBACK_DEV_IDENTITY_FILE=<path>` read by the dev-host process. Absent handoff, browser dev identity refuses (generic body; remediation in the dev host's local log). |
| Packaged Expo loop, native targets (iOS simulator, Android emulator, Android physical via USB `adb reverse`) | The supervised loop is sessions-first at the provider boundary: the rendezvous GET is binding-only, and a later admitted authority-adoption POST mints and returns an ordinary session. Where a native supervised app additionally asserts dev identity, the supervisor mints a **one-shot, startup-nonce-bound checkout nonce per selected device** and delivers it through a native-only launch channel unavailable to web or tunneled HTTP (simulator launch environment / per-serial `adb` launch extras on the reversed leg); the app redeems it once at the supervisor for the capability. The admin operator token never reaches a device (that would collapse the D3 plane split); nothing rides the bare CORS-readable bootstrap GET; nothing is cached across rotation; nothing enters `EXPO_PUBLIC_*`. Stage-2 witnesses must prove Expo web and tunneled raw HTTP cannot redeem a checkout nonce. USB Android preserves loopback via per-serial `adb reverse` and uses the same channel. |
| Packaged Expo loop, **web** target | Supervised web fetches its bootstrap from browser JavaScript, so the bearer MUST NOT ride it. The GET stays bearer-free; an ordinary session rides only the origin-admitted mint POST. Sessions-based supervised web is unaffected; browser dev-identity assertion for Expo web goes through a relay-stamping front like managed Vite or is refused at enforce — documented, not silent. |
| Physical iOS; Android over TCP/IP or LAN | **Still refused/unsupported**, unchanged — the carrier decision packet's open question. A launcher that opts into a wide bind hands the capability to the clients it configures and accepts the LAN threat model (OQ1). |
| Raw `snapback start` + hand-rolled client | Documented: resolve the sidecar (or TTY-disclosed value), send the header. Guide page carries it. |

### D3. Admin reads join the token — narrowly

The read arm of `evaluate_access` drops the bare-`loopback` allowance for
served instances: admin reads require the **admin token or an existing
console credential** (`authorize_for_mode` already accepts the console
credential ahead of `evaluate_access`). The dev-identity capability is
**not** accepted for admin reads — it is an app-plane credential that
travels to phones and browsers; the operator plane stays distinct
(LLP 0017/0039).

Named, bounded exception — the **credential-bootstrap set**: the console
approval-request, approval-poll, **and claim-exchange** routes are
deliberately pre-credential AdminRead (a browser must request, poll, and
redeem a claim before it holds any credential; claim exchange carries its
own claim-code proof in the body). The rule: *credential-bootstrap AdminRead
keeps its own proof; inspection AdminRead requires the credential.* The
carve-out is route-enumerated in the implementation and proven by a test
that redeems a first console credential end to end under the new read arm.
Embedded in-process routers keep their current posture. This section is an
explicit amendment to LLP 0017's loopback-read default; land a dated
cross-reference there.

### D4. Declared exposure

`SNAPBACK_EXPOSURE=fronted` is an operator statement that a front exists,
feeding the same acceptance rules. Truth table (served instances):

| | profile unset | `SNAPBACK_PROFILE=dev\|demo\|test` explicit | `SNAPBACK_PROFILE=prod` |
| --- | --- | --- | --- |
| exposure unset | bind-derived (today, plus D1 capability requirement) | explicit non-prod: mints, capability required | prod: never mints; sidecar presence refuses |
| `fronted` | the **resolved profile is `prod`** — full prod semantics (no mint, no dev identity, provisioning table refuses per `NonProd`); the operator must select a profile explicitly | mints — the operator explicitly chose a dev profile behind a declared front; startup prints one exposure warning line | unchanged |

The value set is closed: `fronted` and `direct` (an explicit not-fronted
declaration, behaviorally identical to unset, so CI/container policies can
require a declaration either way — author ruling 2026-08-16). Empty or
unset means unset. Any other nonempty value
resolves to full `fronted` semantics — the fail-closed direction, mirroring
`resolve_profile`'s unrecognized-value rule — with one startup warning
naming the unrecognized value; a typo can only tighten, never restore the
bind-derived default.

`--allow-insecure-dev-auth` keeps its exact current meaning (dev auth over
plaintext on a non-loopback **bind**, non-prod only); it neither grants nor
substitutes for the capability. The blessed SSH-tunnel secrets path
(LLP 0036) becomes: declare `fronted`, use credentialed surfaces. An
undeclared front remains undetectable — D1, not D4, is load-bearing.

### D5. Rollout stages

1. **Mint + distribute:** sidecar minted on the ladder; relay stamp, `_kit`,
   CLI, Expo gated leg, external-mode handoff, and guide all land; server
   verifies when presented. First capability-less dev assertion per boot
   logs one warning (request-time, once per boot, no identity or bearer
   content).
2. **Warn:** that warning names the flip date; demo and template acceptance
   suites witness every supported D2 row end to end (including the
   `--memory` + ready-file kit topology and Android USB). D3's read-arm
   change enters its own warn here (log-once on bare-loopback read),
   including the claim-flow redemption witness.
3. **Enforce:** uncredentialed dev assertion and bare-loopback admin reads
   refuse. The flip is a committed change, not an env toggle;
   `SNAPBACK_DEV_IDENTITY_UNSAFE_ACCEPT=1` exists during stage 3 only as a
   loud dated escape hatch, removed one release later.

### D6. Chokepoints

Server: dev-authority installation (`dev_body_authority` /
`dev_host_operation_authority`), `ClientAsserted` binding at
`/connection/open` plus the connection-grant witness, `evaluate_access` read
arm with the credential-bootstrap carve-out, startup mint on the anchor
ladder beside the admin-token resolution, prefix registry, ready-descriptor
advertisement. Unchanged-and-composing: `validate_plaintext_auth_transport`
(3 non-test callers), `permits_dev_body_origin` (1 caller),
`require_operation_profile` (20 call sites — none move). Client-side: relay
stamp (overwrite + restart re-read), `_kit` harvest (~34 suites use the
impersonation harvest today), CLI, Expo supervisor gated leg, guide.

## Implementation state (2026-08-25)

This is the stage-2 audit required before enforcement. It combines the exact
`grep -rn "LLP 0262" crates/ packages/ scripts/` inventory with inspection of
the unannotated composition and test sites those references govern. “Witness”
means an exercised request path or retained device receipt; a package seam test
is identified as such and does not stand in for a missing topology acceptance
witness. `NOT YET` rows keep D5 stage 3 closed.

| Item | Implemented where | Witness or gap |
| --- | --- | --- |
| D1 — mint, anchor ladder, owner-only publication, rotation/unlink, production refusal | `snapback-auth/src/dev_identity.rs`; `snapback-cli/src/cli.rs`; the ready descriptor and owned teardown in the CLI | Rust lifecycle tests cover file-backed and ready-file anchors, permissions, rotation, unlink, and production refusal. `demos/todo/tests/acceptance/headless.mjs` witnesses the `--memory` + ready-file carrier; `packages/snapback-cli/dev-loop.test.mjs` witnesses rotation across restart and `dev-fresh`. |
| D1 — HTTP `ClientAsserted` gate, generic refusal, constant-time verification, operator-only remediation | `snapback-server/src/server.rs`; `snapback-auth/src/dev_identity.rs`; `snapback-types/src/auth/crypto.rs` | Server tests witness verified, malformed, mismatched, and absent stage-2 requests. The Todo headless and browser-local-first acceptances witness current-capability admission and the generic network refusal without exposing the sidecar or bearer. |
| D1 — `/connection/open` witness and live-socket binding | `snapback-server/src/server.rs`; `snapback-client/index.mjs` | Server connection-open/live-frame tests cover witness binding and project a credential-free `devIdentityCapabilityWitnessed` observation after verification. Todo headless, browser-local-first, and the managed CLI dev loop exercise `/connection/open`; full live delivery continues in the Todo suite. |
| D2 — CLI verbs | `snapback-cli/index.mjs` resolves and passes the anchor-ladder capability; native lifecycle is in `snapback-cli/src/cli.rs` | `packages/snapback-cli/dev-loop.test.mjs` scaffolds the shipped template, drives `status`, `reload`, `restart`, and `dev-fresh`, and re-witnesses relay custody after both boot-rotating verbs. |
| D2 — `_kit` / harness / headless | `demos/_kit/server-process.mjs`; `snapback-client/index.mjs` | `demos/todo/tests/acceptance/headless.mjs` witnesses the memory/ready-file path, direct client option, current-boot admission, and mismatched-boot refusal. |
| D2 — managed Vite | Client-arm custody handoff in `snapback-cli/index.mjs`; `snapback-vite/lifecycle.mjs`; `snapback-vite/proxy.mjs`; `snapback-vite/index.mjs` | `packages/snapback-cli/dev-loop.test.mjs` runs a real sessions-first managed backend plus real Vite and an identity-bearing session `/connection/open`. The server reports `devIdentityCapabilityWitnessed: true` after the relay overwrites browser input; a direct headerless control remains stage-2-admitted but reports `false`, and the test explicitly proves the same positive assertion throws for that stripped control. The test re-witnesses custody after restart and `dev-fresh`. Package relay tests separately cover HTTP, both WebSocket legs, and same-port nonce rotation. |
| D2 — external/attach Vite | Explicit `SNAPBACK_DEV_IDENTITY_FILE` handoff in `snapback-vite/lifecycle.mjs` and relay stamping in `proxy.mjs` | `demos/browser-local-first/tests/acceptance/browser-public-witness.mjs` uses real Chrome, an external Vite host, an exactly declared dev-auth origin, and a real Snapback server. Its identity-bearing query receives the server's credential-free witnessed-capability response header through the relay; the same direct headerless request reports `false` and explicitly fails the positive assertion, while a bogus direct capability is refused. The row also proves relay overwrite and no capability response exposure. |
| D2 — Expo native iOS simulator | Checkout exchange and single `simctl launch --initialUrl` carrier in `snapback-cli/expo-dev.mjs`; native-only module in `snapback-expo-dev-identity/ios`; private provider custody in `snapback-expo` | **NOT YET:** the retained `demos/expo-native-checkout-reader/receipts/ios-2026-08-25T15-06-51-734Z/` run proves the real carrier, rotation, and refusal rows, but its application observation was made before transport and its sessions query returned zero rows. The strengthened app now requires the server's post-transport `devIdentityCapabilityWitnessed: true` connection grant and seeds/reads at least one session-owned row; the simulator must be rerun before this row is witnessed. |
| D2 — Expo native Android emulator | Per-serial checkout launch extra and `adb reverse` in `packages/snapback-cli/expo-dev.mjs`; Android native module in `packages/snapback-expo-dev-identity/android` | **NOT YET:** the retained `demos/expo-native-checkout-reader/receipts/android-2026-08-25T14-54-18-163Z/` run proves the real carrier, rotation, and refusal rows, but predates the server-observed capability assertion and nonempty-row requirement. The strengthened app is fail-sensitive in the same way as the iOS row and requires an emulator rerun. |
| D2 — Expo native Android physical USB | Same implemented Android carrier as the emulator row | **NOT YET:** no physical-device USB acceptance receipt. This is the explicit D5/OQ3 gate this lane cannot satisfy. |
| D2 — Expo web | Web export filtering in `snapback-expo/supervised-environment.mjs`; native-only checkout and provider refusal in `snapback-expo/provider.mjs`; ordinary sessions in the supervised authority path | **NOT YET — isolation witness only:** retained passed receipt `demos/expo-native-checkout-reader/receipts/web-2026-08-25T20-16-02-195Z/run-summary.json` comes from the real Expo web bundle in Chrome with no harness interceptor. It proves sessions without custody: `serverDevIdentityCapabilityWitnessed: false`, no checkout or dev-identity header, one session-owned row, and invalid-assertion refusal; its `d2Evidence` is `false`. A future positive web stamp, if required, must run through the shipped Vite/proxy relay with unconditional overwrite of client input. |
| D2 — physical iOS and Android LAN/TCP | Supervisor/device selection keeps these targets refused or unsupported; the prior physical-iOS decision packet remains authoritative | Intentionally unsupported, so there is no supported-carrier witness to gate D5. Any future support requires a new ruled carrier and acceptance witness. |
| D2 — raw `snapback start` + hand-rolled client | Sidecar advertisement and header contract ship in the native CLI; `guide/auth/targets.md` documents the operator steps | `packages/snapback-cli/dev-loop.test.mjs` independently reads the native child descriptor and owner-only sidecar, makes hand-rolled direct requests, and proves both current-boot admission and stale-capability refusal across restart and `dev-fresh`. |
| D3 — stage-2 bare-loopback read warning and credential-bootstrap carve-out | `snapback-server/src/admin.rs` emits once per `ServerContext` boot after console-credential and admin-token checks; approval request/poll/claim exchange remain route-enumerated `AdminRead` | `claim_exchange_witnesses_the_once_per_boot_bare_loopback_read_warning` first proves a token-bearing `AdminRead` does not emit the warning, then redeems the first console credential through the real claim-exchange route and proves the warning contains `DEV_IDENTITY_ENFORCEMENT_FLIP` and is consumed once. |
| D3 — enforce admin-token/console-credential read arm | Design owner remains `evaluate_access` plus the enumerated bootstrap routes | **NOT YET by design:** bare loopback reads remain admitted after the stage-2 warning; the read arm must not flip until D5 stage 3. |
| D4 — closed exposure vocabulary and complete truth table | `snapback-server/src/admin.rs`; process composition in `snapback-cli/src/cli.rs`; served warning emission in `snapback-server/src/server.rs` | `resolve_profile_exposure_truth_table_is_closed_and_fail_closed` covers unset/empty/direct/fronted/unknown across explicit profiles. Server tests witness explicit non-prod warning and `fronted` + unset resolving silently to production with a production-policy refusal. |
| D5 — staged rollout | Stage 1 mint/distribute is shipped. Stage 2 uses `DEV_IDENTITY_ENFORCEMENT_FLIP = "2026-08-25/LLP-0262-stage-3"`, names the RFC from both warning paths, and has the witnesses above | Stage 2 is **PARTIAL**. Stage 3 is blocked by exactly four missing D2 witnesses: **iOS simulator — NOT YET**, pending a strengthened rerun; **Android emulator — NOT YET**, pending a strengthened rerun; **physical Android USB — NOT YET**; and **Expo web — NOT YET**, with only the honest sessions-without-custody isolation witness in `web-2026-08-25T20-16-02-195Z`. The retained native receipts predate the fail-sensitive, server-observed checks, while Expo web has no shipped positive-stamping topology. No unsafe-accept escape hatch exists before the flip. |
| D6 — chokepoints and unchanged composing fences | Server authority installation/open/grant and warning sites are in `server.rs`/`admin.rs`; startup/sidecars are in `cli.rs`; carriers are in `_kit`, client, Vite, CLI, Expo, and the guide. Transport/origin/profile-operation gates were not moved | Component tests and the topology witnesses above exercise the landed chokepoints. The D3 enforcement chokepoint remains intentionally **NOT YET**. |

## Non-goals

- Building the LLP 0168 relay/edge, any public dev carrier, or the
  authenticated first-navigation carrier (0168 owns that design; this RFC's
  claims are scoped so its absence is a named residual, not a silent gap).
- Weakening LLP 0060 D1 or changing `--allow-insecure-dev-auth`.
- Changing hosted-target auth.
- Detecting undeclared fronts (not observable; the design stops depending
  on the distinction).

## Rulings (author, 2026-08-16)

The loop's four open questions were ruled at acceptance:

1. **OQ1 — deputy residual: documented residual.** A fronted
   credential-holding dev host (tunneled Vite/Metro) stamping for strangers
   is accepted and documented as this design's residual; the authenticated
   first-navigation carrier remains LLP 0168's decision. No dev-host
   self-bind refusal is added by this RFC.
2. **OQ2 — admin-plane host-ops: the token is sufficient.**
   `function.run`/`auth.mintSession` require no second witness; the
   capability gates app-plane `ClientAsserted` installation only, keeping
   the operator/app plane split clean.
3. **OQ3 — stage-3 timing: acceptance witness only.** The enforce flip is
   gated on the demo/template acceptance suites proving every supported D2
   topology end to end; no release-cadence coupling.
4. **OQ4 — value set: `direct` is added.** See D4.

## Revision history

- 2026-08-15 r1: initial draft; Draft → Review at super-refine loop start.
- 2026-08-15 r2: round-1 revision (browser path redesigned to relay-side
  stamping; D3 narrowed; topology matrix; D4 truth table).
- 2026-08-15 r3: round-2 revision (anchor triad ladder; credential-bootstrap
  carve-out incl. claim-exchange; Expo native/web split; generic refusal).
  Final reviewed revision: claude READY, grok READY, codex NOT READY.
- 2026-08-16 r4 (unreviewed, author-ruled): concrete native checkout-nonce
  carrier; closed fail-closed `SNAPBACK_EXPOSURE` set; four tightenings.
- 2026-08-16 r5: Accepted; OQ1–OQ4 ruled and folded in; history trimmed.
  Full round-by-round record: `llp/reviews/0262-*.run.md`.
- 2026-08-25 r6: recorded the D1–D6 implementation/witness audit and stage-2
  warning contract; stage 3 remains gated on the named D2 gaps.
- 2026-08-25 r7: witnessed the real Expo-web and current sessions-first iOS
  simulator/Android emulator rows; only physical Android USB still gates D5.
- 2026-08-25 r8: made managed/external Vite witnesses fail-sensitive with a
  server-owned observation, refreshed the nonempty Expo-web receipt, and
  downgraded the retained native receipts whose client-side evidence predates
  the strengthened checks.
- 2026-08-25 r9: reran Expo web against the current app and harness; the
  retained row and summary now carry the harness-produced fail-sensitive D2
  verdict, including the absent browser checkout header.
- 2026-08-25 r10: review found r9's Playwright interceptor had manufactured a
  capability carrier absent from the shipped Expo-web binding. Removed it,
  marked r9's receipt non-D2, retained the direct-binding isolation witness,
  and returned the Expo-web D2 row to NOT YET.
