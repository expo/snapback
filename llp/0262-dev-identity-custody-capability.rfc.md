# LLP 0262: Dev identity becomes a custody capability

**Type:** RFC
**Status:** Review
**Systems:** Auth mode, Server, Security, Developer experience, Local server lifecycle, Demos, Packaged dev loop, CLI
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-15 (r2: three-family round-1 revision — browser path redesigned so the bearer never enters served content; D3 narrowed; topology matrix; D4 truth table)
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
dev-identity capability as an owner-only (`0600`) database sibling. Whatever
installs dev authority — body identity on HTTP, dev frames on a live socket —
requires the capability, presented directly by custody-holding clients and
stamped **server-side by the managed relay** for browsers, so the raw bearer
never appears in served content (LLP 0030's browser-facts fence is preserved,
not amended). A caller tunneling to Snapback's own listener lacks the
capability and gets a typed refusal.

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

- Destructive/provisioning HTTP writes are already custody-gated or
  disabled: a served **loopback** instance resolves or mints the `0600`
  admin token (ENG-23443) and `evaluate_access` requires it for writes; a
  tokenless non-loopback instance disables admin access outright. A tunnel
  attacker cannot `app.reset`.
- The live residual through a front: (a) app-data reads/writes under
  client-asserted dev identity (body-installed, credential-free), and
  (b) tokenless admin reads — `evaluate_access`'s read arm passes on the
  bind-derived loopback fact alone.
- The exposure needs no misconfiguration; the demand behind tunneling
  (reaching a phone) is real and unserved (the iOS carrier decision packet).

Documentation landed (direction 1) but informs only the reader; a
declaration alone (direction 2) helps only the diligent; `SNAPBACK_PROFILE=
prod` refuses the workflow rather than distinguishing the caller. Custody is
the right primitive because the repo already trusts it five times — admin
token, impersonation capability, agent-destroy capability, secret-read
proof, rehearsal capability — all on `secure_file`/`owner_only_file`, with
the demo kit already harvesting a sidecar (`captureImpersonationCapability`).

## Design

### D1. The dev-identity capability

- At startup, a served instance whose resolved profile permits dev-mode auth
  mints an `sbdev_`-prefixed capability (registered in
  `REGISTERED_CREDENTIAL_PREFIXES`), startup-nonce-bound, and writes it via
  `owner_only_file` as a **database sibling** (`<db>.dev-identity`),
  overwritten each boot. The DB sibling (admin-token pattern) is chosen over
  the ready-file sibling (impersonation pattern) because `--ready-file` is
  optional on raw `snapback start`; the DB anchor always exists for served
  instances. Prod never mints it; a leftover sidecar found by a prod boot is
  a startup refusal (rehearsal-sidecar rule, LLP 0213) whose message names
  the path and the one-line cleanup.
- **Gate point:** dev *authority installation*, not a header check bolted
  onto transport fences. Wherever the server resolves `ClientAsserted` dev
  authority from request content (body identity on registered routes, dev
  frames on the socket path), installation requires a verified capability
  witness. `validate_plaintext_auth_transport` (a bind-time fence with no
  request in hand) and `permits_dev_body_origin` keep their current jobs and
  compose; neither is the capability check.
- **Live sockets:** browsers cannot set custom upgrade headers, and dev
  socket frames assert identity in-band after `/connection/open`. The
  capability is therefore presented at `/connection/open` (an HTTP request:
  header for direct clients, relay-stamped for browsers), the verification
  is bound into the resulting connection grant as a witness, and
  identity-bearing dev frames are accepted only on witnessed connections.
  Reconnects re-present; server restart rotates the capability and existing
  grants die with the boot.
- Refusal: one non-oracular code, `SNAPBACK_DEV_IDENTITY_REFUSED`, covering
  missing/malformed/mismatched alike (the impersonation registry's
  collapse-to-one-403 discipline), with remediation text naming the sidecar
  path and the injection mechanism. Constant-time digest comparison.
- The capability is a **dev credential with a LAN threat model**: it
  deliberately reaches every client the developer's own tooling starts.
  What it removes is the uncredentialed path.

### D2. Carriers, per shipped topology

The bearer never appears in browser-visible modules, served bootstrap, or
`EXPO_PUBLIC_*` config — that is LLP 0030's fence and it stands. (The prior
draft's "inject like the origin" premise was wrong: the Vite virtual module
deliberately serves no origin and no secrets.)

| Topology | Carrier |
| --- | --- |
| CLI verbs | Read the DB sibling directly (admin-token discipline). |
| `_kit` / harness / headless node clients | Spawn-time sidecar read (extend the existing `captureImpersonationCapability` harvest to the new sibling); passed by env or client option, never argv. |
| Managed Vite loop (LLP 0030) | The relay (`proxy.mjs`) — which already terminates every app route — attaches the capability header **relay-side** to proxied requests, including `/connection/open`. Browser JS never sees it; no CORS surface changes. A *fronted Vite* thereby stamps for strangers: named residual, mitigated by Vite's existing non-loopback warning posture and owned long-term by LLP 0168's carrier decision. |
| External/attach Vite mode | Accepts only a URL today (no credential discovery). New explicit handoff: `SNAPBACK_DEV_IDENTITY_FILE=<path>` read by the dev-host process at startup. Absent handoff, browser dev identity refuses with the remediation text. |
| Packaged Expo loop (`snapback dev --expo`) | The supervisor already runs a loopback rendezvous/bootstrap exchange with the app; the capability rides that existing exchange (supervisor has filesystem custody), not `EXPO_PUBLIC_*` bake. Simulator/emulator only, as today. |
| Physical iOS / LAN phone | **Still refused/unsupported**, unchanged — that is the carrier decision packet's open question, not this RFC's. A launcher that opts into a wide bind hands the capability to the clients it configures and accepts the LAN threat model (OQ1). |
| Raw `snapback start` + hand-rolled client | Documented: read `<db>.dev-identity`, send the header. Guide page carries it. |

### D3. Admin reads join the token — narrowly

The read arm of `evaluate_access` drops the bare-`loopback` allowance for
served instances: admin reads require the **admin token or an existing
console credential** (`authorize_for_mode` already accepts the console
credential ahead of `evaluate_access`). The dev-identity capability is
**not** accepted for admin reads — it is an app-plane credential that
travels to phones and browsers; promoting it to the operator plane would
hand every app client the inspection surface (LLP 0017/0039 keep those
authority classes distinct).

Named, bounded exception: the console approval-request and approval-poll
routes are deliberately credential-free AdminRead (a browser must be able to
request and poll before terminal approval) and keep exactly that posture —
enumerated in the implementation as a route-scoped carve-out, not a general
read allowance. Embedded in-process routers keep their current posture.
This section is an explicit amendment to LLP 0017's loopback-read default;
land a dated cross-reference there with the change.

### D4. Declared exposure

`SNAPBACK_EXPOSURE=fronted` is an operator statement that a front exists,
feeding the same acceptance rules. Truth table (served instances):

| | profile unset | `SNAPBACK_PROFILE=dev\|demo\|test` explicit | `SNAPBACK_PROFILE=prod` |
| --- | --- | --- | --- |
| exposure unset | bind-derived (today, plus D1 capability requirement) | explicit non-prod: mints, capability required | prod: never mints; sidecar presence refuses |
| `fronted` | default flips to **prod semantics**: no mint, dev identity refused, operator must opt in explicitly | mints — the operator has explicitly chosen a dev profile behind a declared front; startup prints one exposure warning line | unchanged |

`--allow-insecure-dev-auth` keeps its exact current meaning (dev auth over
plaintext on a non-loopback **bind**, non-prod only); it neither grants nor
substitutes for the capability. The blessed SSH-tunnel secrets path
(LLP 0036) becomes: declare `fronted`, use credentialed surfaces. An
undeclared front remains undetectable — D1, not D4, is load-bearing.

### D5. Rollout stages

1. **Mint + distribute:** sidecar minted; relay stamp, `_kit`, CLI, Expo
   supervisor, external-mode handoff, and guide all land; server verifies
   when presented. First capability-less dev assertion per boot logs one
   warning (request-time, once per boot, no identity or bearer content).
2. **Warn:** that warning names the flip date; demo and template acceptance
   suites are the witness that every supported topology passes the
   capability end to end. D3's read-arm change enters its own warn here
   (log-once on bare-loopback read).
3. **Enforce:** uncredentialed dev assertion and bare-loopback admin reads
   refuse. The flip is a committed change, not an env toggle;
   `SNAPBACK_DEV_IDENTITY_UNSAFE_ACCEPT=1` exists during stage 3 only as a
   loud dated escape hatch, removed one release later.

### D6. Chokepoints

Server: dev-authority installation (`dev_from_auth` / dev body + host-op
authority resolution), `ClientAsserted` binding at `/connection/open` plus
the connection-grant witness, `evaluate_access` read arm, startup mint
beside the admin-token resolution, prefix registry. Unchanged-and-composing:
`validate_plaintext_auth_transport` (3 non-test callers),
`permits_dev_body_origin` (1 caller), `require_operation_profile` (20 call
sites — none move). Client-side: relay stamp, `_kit` harvest (~35 suites use
the impersonation harvest today), CLI, Expo supervisor exchange, guide.

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
   non-loopback exposure (detectable only for its *own* bind, not a front —
   the same limit as the server's)?
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
- 2026-08-15 r2: round-1 revision. Browser path redesigned (relay-side
  stamping; bearer never in served content; LLP 0030 fence preserved); D3
  narrowed to token/console credential with the console-approval carve-out
  and an explicit LLP 0017 amendment pointer; topology-honest safety claim
  and carrier matrix with named deputy residual; socket path gated via
  connection-grant witness; DB-sibling anchor; single non-oracular refusal
  code; prefix registration; D4 truth table; D5 warning timing fixed and D3
  staged; D6 chokepoints corrected to dev-authority installation with
  refreshed counts; baseline wording corrected (bind-derived listener fact;
  loopback-scoped token minting).
