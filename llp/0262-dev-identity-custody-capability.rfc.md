# LLP 0262: Dev identity becomes a custody capability

**Type:** RFC
**Status:** Review
**Systems:** Auth mode, Server, Security, Developer experience, Local server lifecycle, Demos, Packaged dev loop, CLI
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-15 (r3: round-2 revision — anchor ladder, credential-bootstrap carve-out, Expo topology split, non-disclosing refusal)
**Related:** LLP 0009, LLP 0010, LLP 0017 (D3 amends its loopback-read default), LLP 0030 (browser-facts fence preserved), LLP 0031, LLP 0036, LLP 0039, LLP 0060, LLP 0168, LLP 0181, LLP 0213, `issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`, `issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`

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
  removed on clean shutdown, so a leftover sidecar means an unclean exit.
  Prod never mints; a sidecar found by a prod boot is a startup refusal
  (rehearsal rule, LLP 0213) whose message names the path — a refusal
  printed to the operator, not served to a network caller.
- **Gate point:** dev *authority installation*, not transport fences.
  Wherever the server resolves `ClientAsserted` dev authority from request
  content (`dev_body_authority` / `dev_host_operation_authority` on HTTP,
  dev frames on the socket path), installation requires a verified
  capability witness. `validate_plaintext_auth_transport` and
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
| Managed Vite loop (LLP 0030) | The relay (`proxy.mjs`) — which terminates every allowlisted app route including `/connection/open` and both WebSocket legs — attaches the header **relay-side**. It overwrites any client-supplied header value and re-reads the sidecar when the backend restarts (per-boot rotation). Browser JS never sees the bearer; no CORS change. A *fronted Vite* stamps for strangers: named residual (OQ1), owned long-term by LLP 0168's carrier decision. |
| External/attach Vite mode | Accepts only a URL today. New explicit handoff: `SNAPBACK_DEV_IDENTITY_FILE=<path>` read by the dev-host process. Absent handoff, browser dev identity refuses (generic body; remediation in the dev host's local log). |
| Packaged Expo loop, native targets (iOS simulator, Android emulator, Android physical via USB `adb reverse`) | The supervised loop is sessions-first (the rendezvous returns an ordinary session). Where a native supervised app additionally asserts dev identity, the capability rides a **gated leg** of the loopback rendezvous (nonce/operator-token discipline, not the bare payload route), is never cached across rotation, and never enters `EXPO_PUBLIC_*`. USB Android preserves loopback via per-serial `adb reverse` and uses the same leg. |
| Packaged Expo loop, **web** target | Supervised web fetches its bootstrap from browser JavaScript, so the bearer MUST NOT ride it. Sessions-based supervised web is unaffected; browser dev-identity assertion for Expo web goes through a relay-stamping front like managed Vite or is refused at enforce — documented, not silent. |
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

## Non-goals

- Building the LLP 0168 relay/edge, any public dev carrier, or the
  authenticated first-navigation carrier (0168 owns that design; this RFC's
  claims are scoped so its absence is a named residual, not a silent gap).
- Weakening LLP 0060 D1 or changing `--allow-insecure-dev-auth`.
- Changing hosted-target auth.
- Detecting undeclared fronts (not observable; the design stops depending
  on the distinction).

## Open questions

1. **OQ1 — the deputy residual.** A fronted credential-holding dev host
   (tunneled Vite/Metro) stamps for strangers. Accept as a documented
   residual owned by LLP 0168's carrier decision (this draft's position), or
   require the dev host to refuse stamping when it detects its own
   non-loopback exposure (detectable only for its *own* bind — the same
   limit as the server's)?
2. **OQ2 — `function.run`/`auth.mintSession`.** Both are admin-token-gated
   writes already; do they additionally require the dev-identity capability
   (defense in depth), or is the token sufficient?
3. **OQ3 — stage-3 timing.** Gate the enforce flip on the demo/template
   acceptance witness only, or also on one qualified release with stage-2
   warnings live?
4. **OQ4 — `SNAPBACK_EXPOSURE` value set.** Only `fronted`, or also
   `direct` (explicitly not fronted) so CI/container contexts can be
   required to declare rather than defaulted?

## Revision history

- 2026-08-15 r1: initial draft (Draft → Review at super-refine loop start).
- 2026-08-15 r2: round-1 revision — relay-side stamping (bearer never in
  served content, LLP 0030 fence preserved); connection-grant witness; D3
  narrowed to token/console credential; topology matrix with named deputy
  residual; D4 truth table; D5 timing; D6 corrected chokepoints; baseline
  wording corrected.
- 2026-08-15 r3: round-2 revision — sidecar anchor corrected to the admin
  token's real triad ladder with ready-descriptor advertisement (the DB
  sibling does not exist for `--memory` instances, the kit default);
  claim-exchange joins the credential-bootstrap carve-out with the
  bootstrap-vs-inspection rule and an end-to-end redemption witness; Expo
  row split into native (gated rendezvous leg; USB Android included as
  shipped) vs web (bearer never in browser-fetchable bootstrap) vs refused
  rows; network refusal body made generic with path remediation moved to
  local logs/CLI; relay overwrite + restart re-read pinned; sidecar removed
  on clean shutdown; D4 `fronted`+unset pinned to full prod semantics.
