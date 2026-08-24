# LLP 0300: Snapback is a URL — URL-first development binding

**Type:** RFC
**Status:** Review
**Systems:** Client integration, React/Expo, Vite/Exact clients, Headless
client, CLI, Local server lifecycle, Auth, Templates, Guide, Developer
experience
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (author
direction 2026-08-24: "It is annoying to me that Convex and Supabase don't
seem to run into the same issues"; "maybe we should just try to be more like
them"; "Let's make an LLP/RFC about this, then refine it, then make a spec,
then implement")
**Date:** 2026-08-24
**Revised:** 2026-08-24 (b — Draft → Review at llp-super-refine loop start;
author authorization: Charlie's 2026-08-24 pipeline direction)
**Revised:** 2026-08-24 (a — initial draft)
**Related:** LLP 0299 (supervised listener port plan — prerequisite),
LLP 0181, LLP 0223, LLP 0258, LLP 0294, LLP 0295, LLP 0041,
Diary 0100, Diary 0101, Diary 0104, Diary 0106,
`issues/20260822-guide-gap-supervised-expo-mint-two-client.md`,
`issues/20260823-expo-supervisor-restart-verb-port-drift.md`

## Summary

Convex and Supabase never fight the class of problems that dominated the
LLP 0295 matrix — random dev origins, split-the-stack workarounds, supervisor
lifecycle bugs — because their entire client↔backend coupling is **one URL
in one environment variable**, and their backends never touch the client's
bundler. Snapback's coupling is a supervisor-issued, pre-admitted binding
delivered over an IPC rendezvous, and the supervisor must therefore spawn,
proxy, and enumerate the client's dev server. This RFC proposes making
**URL-first the canonical development path**: a client configured by
`SNAPBACK_URL` alone, with deployment identity *discovered from the URL and
verified* instead of pre-admitted, the dev origin allowlist relaxed to
loopback, and the dev session minted explicitly. The supervised `--expo`
path remains as a convenience, no longer the only first-class path.
Production binding rules do not change.

This is a posture inversion of LLP 0181's zero-configuration goal. The
lesson of the comparison is that *one env var is close enough to
zero-config*, and the machinery required to reach literal zero-config —
2,700 lines of supervisor plus its lease, reaper, proxy, attestation, and
enumeration subsystems — costs more than the one variable it saves.

## Background: what the coupling is today, and why it is expensive

Three structural choices compound (established in LLP 0299's analysis):

1. **An origin allowlist instead of `*`.** Auth is already bearer-token
   (`authorization: Bearer …`; no cookies anywhere in the auth path), so the
   backend does not need the client's origin for identity. It nonetheless
   admits only the exact loopback origins in `SNAPBACK_DEV_AUTH_ORIGINS` and
   records them in the application-ready receipt — so the client's origin,
   and therefore the bundler's port, is an input the backend must know
   before it starts.
2. **A pre-admitted binding.** LLP 0181 admits no arbitrary runtime URL: the
   client refuses a raw `{ origin }` (`SNAPBACK_APP_BINDING_UNAVAILABLE` /
   `SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED`) and accepts only a binding a
   live `snapback dev --expo` supervisor issued over the rendezvous (dev),
   or one baked into generated target facts (release).
3. **The supervisor that issues it.** Because the binding must be issued by
   a live supervisor, the supervisor must exist — so it spawns Metro, fronts
   it with a proxy, runs the bootstrap listener, mints an ambient dev
   session, enumerates every listener with `lsof`, and owns leases/reapers
   for all of it.

Every recorded cost traces to (2) and (3): the Metro IPv6-loopback wedge,
the CI watch-inert class, HMR storms through the proxy, listener-enumeration
refusals, process-kill witnesses, the restart-verb port drift
(`issues/20260823-expo-supervisor-restart-verb-port-drift.md`), the shared
ambient mint making two browser contexts one principal
(`issues/20260822-guide-gap-supervised-expo-mint-two-client.md`), and the
Clique lanes' 36-minute M1 split-the-stack workaround (Diary 0106). Convex
and Supabase structurally cannot have these bugs: `npx convex dev` and
`supabase start` never see the bundler at all.

LLP 0299 (stable default ports, strict pins, ranges) is the prerequisite
already in flight: a durable URL is only useful if it does not change every
morning. This RFC is the second, larger step.

## Proposal

### P1 — A URL is a first-class development binding source

Add a `declared-dev` binding source to the client packages
(`@expo/snapback-expo`, `@expo/snapback-react`, headless): in
non-production builds, the provider accepts a backend URL from, in
precedence order, an explicit `url` prop, `EXPO_PUBLIC_SNAPBACK_URL` /
`VITE_SNAPBACK_URL` / `SNAPBACK_URL` (per bundler convention). Admission
rules:

- The URL must be an absolute `http(s)` origin on loopback or an explicitly
  private host class (see OQ3 for devices/LAN); credentials, paths, query,
  and fragments are refused, mirroring `--external-client-origin`'s
  canonicalization.
- **Identity is discovered, not asserted.** On first connect the client
  fetches the backend's identity fact (the operational-readiness surface
  already carries the active deployment identity) and verifies it against
  the generated `app` export's identity. A mismatch fails with the existing
  `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` — the same safety property the
  supervised binding provides, enforced at connect instead of at issuance.
- Production builds prune the source entirely (the existing
  `process.env.NODE_ENV !== 'production'` branch pattern), and release
  bindings keep LLP 0181's rule unchanged: the target tuple must match
  generated target facts. **No runtime or remote URL override exists in
  production.** "Be a URL" means the URL is a build-time fact, exactly as
  `CONVEX_URL` is.
- The supervised rendezvous, when present, wins over the env var (a
  supervised run is more specific than ambient configuration); a stale env
  var pointing at a dead origin produces the ordinary connect refusal, not
  a hang.

### P2 — Dev origin admission opens to loopback

With bearer auth, CORS admission on dev backends stops being an allowlist
of exact origins: a development backend admits any loopback origin by
default. `SNAPBACK_DEV_AUTH_ORIGINS` remains supported as opt-in narrowing
(and stays the mechanism for admitting non-loopback tunnel/forwarded
origins). The application-ready receipt records the admission *posture*
(`loopback-any` or the explicit list) instead of requiring the exact client
origin to be known before the backend starts — removing the last reason the
backend needed the bundler's port in advance.

### P3 — `snapback dev` prints the URL; templates go two-process

The plain profile becomes the canonical template default:

- `snapback dev snapback` starts/attaches the backend on its stable planned
  port (LLP 0299), prints `SNAPBACK_URL=http://127.0.0.1:<port>` and the
  per-platform variants (`10.0.2.2` for the Android emulator), and — on an
  explicit flag or template opt-in, not silently — maintains it in the
  app's `.env.local`. LLP 0223's rejection of durable env copies is
  re-ruled for this one variable: with stable ports the copy is no longer
  stale-prone, and staleness is now *detected* (P1 discovery) rather than
  silent.
- Template `dev` scripts become two-process (`snapback dev snapback` +
  `expo start` / `vite`), the shape every Convex and Supabase template
  uses. `snapback dev --expo` remains available and documented as the
  one-command convenience that additionally owns Metro, adb reverse rules,
  and listener enumeration.

### P4 — The dev session becomes explicit

The URL path mints nothing ambiently. `snapback dev` prints (and
`snapback auth dev-session` mints on demand) an explicit dev sign-in
capability; apps and test harnesses that want distinct principals use
ordinary signup/login per context. This closes the
one-mint-per-origin-shared-by-every-tab defect class by construction on the
canonical path; the supervised path keeps its mint (it is the convenience).

### P5 — What does not change

Bearer custody (including native SecureStore custody, LLP 0252/0258),
loopback-only listeners, the receipt-verified lifecycle verbs
(start/attach/regenerate/successor), release/hosted binding admission, and
the LLP 0299 port plan. The supervisor is demoted, not deleted: its code
paths, acceptance batteries, and Android polish remain supported.

## Tradeoffs accepted by this RFC

| We gain | We give up |
| --- | --- |
| M1 = start backend, read URL, start bundler — on every stack | Boot-time binding issuance; identity check moves to connect (still fail-closed) |
| Weird setups work by construction: tunnels, devcontainers, remote VMs, multi-context Playwright, any bundler | The supervisor's proof that *every* listener (incl. Metro) is loopback-only — on the URL path Snapback vouches only for its own listener |
| ~2.7k lines of supervisor stop being load-bearing; the Metro-quirk bug class leaves the canonical path | Ambient logged-in-on-boot dev session on the canonical path (now explicit; arguably a fix) |
| Dev and prod converge on "a URL that is a build-time fact" | Android `adb reverse` polish is supervised-path-only; URL path prints `10.0.2.2` like every self-hosted backend |
| The two-client / multi-persona defect class closes by construction | LLP 0181 (27 revisions) and 0223 must be re-ruled; batteries re-pointed — the real cost is documentary |

## Security analysis

- **Hostile local page.** With bearer auth and no cookies, a malicious page
  on another local origin cannot use the user's credentials: it holds no
  token, and loopback-open CORS does not leak one. The allowlist was
  defense-in-depth for this non-attack; it remains available as narrowing.
- **Hostile URL injection.** The dev source reads build-time env and an
  explicit prop only — never remote configuration or application data — and
  is pruned from production builds. Release admission is unchanged. The
  attack LLP 0181 closed (point the app at an attacker backend at runtime)
  stays closed.
- **Wrong-generation backend.** Previously refused at issuance; now refused
  at connect via discovery. Same invariant, later detection, plus it now
  also protects the external-client and headless paths that today rely on
  operator care.
- **Token custody.** Unchanged: memory/SecureStore custody per LLP
  0252/0258; nothing new is written to disk by this RFC.

## Migration

1. Land LLP 0299 (in flight) — stable ports.
2. P1 + P2 (client `declared-dev` source + backend loopback admission +
   receipt posture field) behind no flag: additive, nothing existing
   breaks. The Spec (see pipeline below) defines the discovery fact,
   refusal codes, and precedence exactly.
3. P3 + P4: template flips, URL printing/`.env` opt-in, explicit dev
   session; guide rewrite teaching URL-first with the supervisor as the
   convenience appendix.
4. Re-rule LLP 0181 (supervised baseline → one of two admitted dev
   sources) and LLP 0223 (lifecycle ownership: the backend lifecycle stays
   owned; the client process is ordinarily caller-owned); amendment notes,
   not rewrites. Tombstone nothing.
5. Publish per LLP 0041 (rapid): each phase rides the next npm cut.

## Acceptance

1. An agent with only `guide/start/expo-chat.md` brings up the template by
   running `snapback dev snapback` and `expo start` in two terminals,
   pasting one printed env var, with a working authenticated app — no
   supervisor knowledge, no binding vocabulary, on a cold machine.
2. Two Playwright contexts against that app hold two distinct principals
   via ordinary signup — no `resolveSupervisedAuthority` skip recipe.
3. The same app behind a devcontainer port-forward and behind a tunnel
   origin (admitted via `SNAPBACK_DEV_AUTH_ORIGINS`) works unchanged.
4. A URL pointing at a wrong-generation backend refuses with
   `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` naming both identities.
5. A production build containing a `SNAPBACK_URL` env var refuses/ignores
   it (pruned source), and release binding admission is byte-identical to
   pre-RFC behavior.
6. `snapback dev --expo` continues to pass its existing acceptance battery
   unchanged.

## Open questions (for the refine loop and the author)

- **OQ1 — env naming.** `EXPO_PUBLIC_SNAPBACK_URL` / `VITE_SNAPBACK_URL` /
  `SNAPBACK_URL`: exact set and precedence, and whether the CLI writes
  `.env.local` by default in templates or only on opt-in.
- **OQ2 — discovery fact shape.** Reuse the operational-readiness surface
  as-is, or mint a minimal unauthenticated `/_snapback/identity` projection
  (identity + posture only, no receipts)? The Spec decides; the RFC
  requires only: unauthenticated, loopback, identity-bearing, stable.
- **OQ3 — devices and LAN.** The URL path on a physical device requires a
  reachable host (LAN IP or tunnel). Is printing the LAN candidate behind
  an explicit `--lan` acceptable, or does the loopback-only posture demand
  the supervised path for physical devices entirely?
- **OQ4 — `--external-client-origin`'s future.** With P2, the external
  client profile's allowlist declaration becomes redundant on loopback.
  Keep it as narrowing, or deprecate toward `SNAPBACK_DEV_AUTH_ORIGINS`?
- **OQ5 — how demoted is the supervisor?** Documentation-demoted only
  (this RFC), or should new capabilities stop landing on the supervised
  path unless they cannot exist elsewhere?

## Alternatives considered

- **Status quo + LLP 0299 only.** Stable ports remove the sharpest pain,
  but every agent still learns the binding/rendezvous vocabulary, and the
  supervisor stays load-bearing for every Expo app. Rejected by the
  author's direction.
- **Bootstrap-on-backend.** Folding the rendezvous listener into the Rust
  server removes one port but keeps issuance, the supervisor, and the
  vocabulary. Strictly weaker than P1.
- **Full supervisor removal.** Deletes the Android polish and the
  one-command path that existing users and batteries rely on, for no
  additional simplification of the canonical path. Rejected; demotion is
  enough.

## Pipeline

Per the author's direction: this RFC → `llp-super-refine` (dual-family,
until READY/READY) → author acceptance → a Spec (owner boundaries, exact
codes, discovery fact, precedence, template diffs) → implementation program
(codex lanes) with its own review gates. The Spec and implementation must
not begin before this RFC is Accepted.
