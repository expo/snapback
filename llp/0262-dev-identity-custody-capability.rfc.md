# LLP 0262: Dev identity becomes a custody capability

**Type:** RFC
**Status:** Review
**Systems:** Auth mode, Server, Security, Developer experience, Local server lifecycle, Demos, Packaged dev loop, CLI
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-15 (super-refine loop start: Draft → Review)
**Related:** LLP 0009, LLP 0010, LLP 0017, LLP 0030, LLP 0031, LLP 0036, LLP 0039, LLP 0041, LLP 0060, LLP 0168, LLP 0181, LLP 0213, `issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`, `issues/closed/20260811-demo-dev-servers-default-lan-bind-with-dev-auth.md`, `issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`

## Summary

Client-asserted dev identity is granted today because the transport peer is
loopback. That inference does not survive a front: an ngrok/cloudflared/
Tailscale tunnel, an SSH forward, or any local reverse proxy hands a publicly
reachable caller a server that still sees a loopback peer and therefore still
accepts any asserted identity with no credential. LLP 0060 D1 states the limit
("a loopback reverse proxy remains explicitly outside that fence"); LLP 0168
verified the server cannot detect an undeclared front and concluded the repair
"changes the server's auth boundary and needs a focused RFC." This is that
RFC, commissioned by author ruling 2026-08-15 on the tunnelled-loopback
ticket.

The proposal: **dev identity assertion stops being a locality inference and
becomes a custody proof.** At startup a non-prod server mints a per-boot
dev-identity capability as an owner-only (`0600`) sidecar of the readiness
file, exactly like the impersonation capability (`src/admin_impersonation.rs`)
it is modeled on. A request asserting a dev identity must carry the
capability; the loopback peer address alone no longer suffices. The packaged
dev loop, demo launchers, and CLI — which already have filesystem custody —
inject it into the clients they start. A caller reaching the server through a
tunnel does not have the machine's filesystem and gets a typed refusal.

Two adjacent gaps close with the same move: the tokenless-loopback **admin
read** branch of `evaluate_access` (disclosure of the inspection surface
through a front), and the missing **declared-exposure vocabulary** (the
ticket's direction 2), which becomes one input to the same acceptance rule
rather than a free-standing flag.

## Motivation

### The residual exposure, precisely

The 2026-08-15 authority-site survey (recorded in the tunnelled-loopback
ticket) sharpened the ticket's original claim:

- **Destructive/provisioning operations are already custody-gated over
  HTTP.** Every served instance resolves or mints a `0600` admin token
  sibling of the database (ENG-23443, `resolve_serve_admin_token`), and
  `evaluate_access` requires it for all writes; the tokenless-loopback write
  branch is reachable only from embedded in-process routers. A tunnel
  attacker cannot `app.reset` or `schema.load`.
- **What a front actually exposes:** (a) app-data reads and writes under
  client-asserted dev identity — any caller may assert any identity with no
  credential, because `resolve_profile` derives `dev` from the loopback bind
  and dev-mode auth trusts the asserted identity; and (b) tokenless admin
  **reads** — `evaluate_access` allows reads on bare loopback, so the
  admin inspection surface is disclosed (secret reads carry their own
  custody proof; the rest of the read surface does not).
- The exposure requires no misconfiguration. `ngrok http 4420` against a
  default dev server is a commonplace developer action — the demand behind
  it (reaching a phone) is real and currently unserved
  (`issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`).

### Why the existing directions are insufficient

- Documentation (direction 1, landed 2026-08-10 in `guide/auth/targets.md`)
  informs only the reader.
- An exposure declaration alone (direction 2) helps only the diligent
  operator; the accidental tunnel is exactly the case where no declaration
  will be made. LLP 0168 §"Bind address is not exposure" also shows a
  declaration is configuration vocabulary, not an observable security fact.
- `SNAPBACK_PROFILE=prod` is not a repair: it refuses the dev workflow
  wholesale rather than distinguishing the caller.

### Why custody is the right primitive

The codebase already trusts filesystem custody over transport inference in
five shipped mechanisms: the admin token (`<db>.admin-token`), the
impersonation capability (`<ready-file>.impersonation`, per-boot,
startup-nonce-bound, `src/admin_impersonation.rs`), the agent-destroy
capability, the secret-read proof, and the rehearsal capability — all built
on `secure_file`/`owner_only_file` (O_NOFOLLOW, validate-through-fd, strict
`0600`). The demo kit already harvests such a sidecar for ~14 acceptance
tests (`captureImpersonationCapability`). This RFC generalizes a proven
pattern to the identity-assertion surface rather than inventing a mechanism.

## Design

### D1. The dev-identity capability

- At startup, a server whose resolved profile permits dev-mode auth mints a
  `sbdev_`-prefixed capability bound to the startup nonce and writes it as
  `<ready-file>.dev-identity` via `owner_only_file`, beside the existing
  impersonation sidecar. Prod never mints it; its presence in prod state is
  a startup refusal, mirroring the rehearsal sidecar rule (LLP 0213).
- A request that asserts a dev identity (dev auth mode, dev body
  impersonation, `function.explain` with a dev user, dev-user selection on
  host ops) MUST present the capability in a dedicated header. Verification
  reuses the impersonation capability's comparison discipline and composes
  with — never replaces — the existing gates (`validate_plaintext_auth_
  transport`, `permits_dev_body_origin`, profile checks).
- Missing or mismatched capability yields a typed refusal
  (`SNAPBACK_DEV_IDENTITY_CAPABILITY_REQUIRED` /
  `SNAPBACK_DEV_IDENTITY_CAPABILITY_MISMATCH`) whose message names the
  sidecar path and the injection mechanism, per the LLP 0010 remediation
  posture. The refusal must be non-oracular about which identity was
  asserted.
- The capability is a **dev credential with a LAN threat model**, not a
  session: it deliberately travels to every client the developer's own
  tooling starts, including a phone on the LAN when the operator opts into a
  wider bind. What it removes is the *uncredentialed* assertion path — a
  tunnel or LAN stranger who was not handed the capability by the
  developer's own launcher.

### D2. Injection paths (who has custody, and how clients receive it)

| Client | Carrier | Mechanism |
| --- | --- | --- |
| Packaged dev loop / Vite dev host (LLP 0030, 0041) | serve-time injection | The dev host process has filesystem custody; it reads the sidecar and injects the capability into the served client bootstrap the same way it already injects the origin. Browser code never reads the filesystem. |
| Demo launchers / `_kit` | spawn-time harvest | Extend `captureImpersonationCapability`'s existing sidecar read; launchers pass the value to the clients they configure (env for headless, served config for web, printed origin config for Expo). |
| CLI verbs | direct read | The CLI resolves the sidecar next to the ready file exactly as it resolves the admin token today. |
| Acceptance/harness | existing pattern | Same as impersonation capability adoption; tests that assert refusals get the negative case for free. |
| Hand-rolled clients | documented | `guide/auth/targets.md` and the headless guide document the header and the sidecar path. |

### D3. Admin reads join the token

The read arm of `evaluate_access` drops the bare-`loopback` allowance for
served instances: reads require the admin token or the dev-identity
capability. The embedded in-process router keeps its current posture (it is
already the only tokenless-write path and is not network-reachable). The
admin console flows are unaffected in substance — the console mint already
requires `loopback && Local` and mints its own credential — but the
inspection surface stops being readable by any process that can reach the
port.

### D4. Declared exposure (direction 2, as vocabulary)

`SNAPBACK_EXPOSURE=fronted` is an operator statement that a front exists. It
does not repair anything by itself; it feeds the same acceptance rule:

- With `fronted` declared, the server refuses to mint the dev-identity
  capability's *loopback conveniences* — dev identity requires the
  capability (already true after D1) **and** the bind-derived profile
  default flips to `prod` semantics for gating decisions, so the operator
  must select capabilities explicitly.
- The blessed SSH-tunnel path for secrets transit (LLP 0036) gets a
  supported spelling: declare `fronted`, use credentialed surfaces only.
- Absent declaration + present front remains undetectable — that is exactly
  why D1, not this, is the load-bearing change. The declaration exists so
  that intentional fronting has a paved, honest posture instead of a
  documented "unsupported."

### D5. Rollout stages

1. **Mint + distribute:** server mints the sidecar; dev loop, `_kit`,
   CLI, and guide all present it; server verifies when present, logs
   (once, startup) when dev identity is asserted without it. No refusals.
2. **Warn:** the acceptance log line becomes a per-boot startup warning
   naming the flip date; demos and templates are verified to pass the
   capability end to end (the acceptance suites are the witness).
3. **Enforce:** assertion without the capability refuses. The stage flip is
   a committed change, not an env toggle; `SNAPBACK_DEV_IDENTITY_
   UNSAFE_ACCEPT=1` exists during stage 3 only as a loud, dated escape
   hatch and is removed one release later.

### D6. Chokepoints (from the 2026-08-15 survey)

Implementation touches, deliberately few: `validate_plaintext_auth_transport`
(2 callers), `permits_dev_body_origin` (1 caller), the dev-mode acceptance
path in request handling, `evaluate_access` read arm, the startup mint beside
`src/cli.rs:8506`'s impersonation mint, and the operation-profile table
entries that select dev users (`function.run`, `auth.mintSession`,
`function.explain`) — the 22 `require_operation_profile` call sites do not
move. Client-side: dev host injection, `_kit`, CLI, guide.

## Non-goals

- Building the LLP 0168 relay/edge or any public dev carrier; 0168's
  "do not build on this record" ruling stands. This RFC removes the danger
  of the improvised substitutes, it does not add a supported one.
- Weakening LLP 0060 D1: the plaintext-listener fence, the sessions
  refusal, and `--allow-insecure-dev-auth`'s narrow meaning are unchanged.
- Changing hosted-target auth in any way.
- Detecting undeclared fronts. Not observable; the design stops depending
  on the distinction instead.

## Open questions

1. **OQ1 — capability scope on wide binds.** When a launcher opts into
   `0.0.0.0` and hands the capability to a phone client, the LAN threat
   model returns for holders of the capability. Is that acceptable as
   documented (the capability marks the developer's own clients), or should
   the wide-bind path mint a second, narrower capability?
2. **OQ2 — `function.run`/`auth.mintSession`.** Both are admin-token-gated
   writes already; do they additionally require the dev-identity capability
   (defense in depth) or is the token sufficient there?
3. **OQ3 — stage-3 timing.** Enforce is a breaking change for hand-rolled
   dev clients. Gate the flip on the demo/template acceptance witness only,
   or also on one qualified release with stage-2 warnings live?
4. **OQ4 — `SNAPBACK_EXPOSURE` value set.** Only `fronted`, or also
   `direct` (explicitly not fronted) so the declaration can be required in
   CI/container contexts where the default would otherwise be guessed?
