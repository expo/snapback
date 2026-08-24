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
**Revised:** 2026-08-24 (f — cluster round 1 with LLP 0299: the admission
fork is decided as PATH-SPLIT (plain/URL profile opens to literal loopback
with replace-semantics allowlist; supervised keeps exact-origin injection
with merge semantics); the signup/new-principal exposure is recorded and
accepted with the allowlist as narrowing; client-origin stability is
delegated to the bundler with documented pinning; P5 rewritten as an
explicit 0299 amendment list; OQ4 and OQ5 closed; `.env.local` refresh
lifecycle and dev-session contract added to Spec obligations)
**Revised:** 2026-08-24 (e — post-convergence wording repairs, applied
verbatim from the round-3 reviews and UNREVIEWED by the loop; the loop's
dual-READY verdicts bind to revision (d): the discovery gate precedes every
client call including unauthenticated signup/login (only the identity fetch
is exempt); the match reference is the generated `app` export's identity;
Acceptance 5 says "url argument" for headless; the scope ruling separates
the Android emulator from physical-device transports)
**Revised:** 2026-08-24 (d — round-2 delta revision: same-UID lemma recast
and a shared-host trust boundary stated; discovery gate made a standing
invariant with an origin-reassignment acceptance case; P1 host list aligned
to the scope ruling (literal loopback + `10.0.2.2`; forwards are topology;
`host.docker.internal` dropped); non-loopback/device cases classified out of
scope with exact supported transports named; entry-point lead-in; Acceptance
5 strengthened to URL-present; allowlist-restates-loopback sentence; OQ1
names-only)
**Revised:** 2026-08-24 (c — round-1 revision: authenticity honestly
reclassified with a credential-free discovery gate; declared-dev gated by a
dev-only entry point, not NODE_ENV; bundler env reads move to
application-owned source; OQ3 closed by an explicit scope ruling; receipt
posture made compatibility-explicit; causal matrix + corrected comparisons;
mint/disk claims narrowed)
**Revised:** 2026-08-24 (b — Draft → Review at llp-super-refine loop start;
author authorization: Charlie's 2026-08-24 pipeline direction)
**Revised:** 2026-08-24 (a — initial draft)
**Related:** LLP 0299 (supervised listener port plan — landed prerequisite,
`544dd6a8e`), LLP 0181, LLP 0223, LLP 0258, LLP 0294, LLP 0295, LLP 0041,
Diary 0100, Diary 0101, Diary 0104, Diary 0106,
`issues/20260822-guide-gap-supervised-expo-mint-two-client.md`,
`issues/20260823-expo-supervisor-restart-verb-port-drift.md`

## Summary

Local Convex (`npx convex dev`, a local subprocess backend) and local
Supabase (`supabase start`) never fight the class of problems that dominated
the LLP 0295 matrix, because neither ever spawns, proxies, or enumerates the
client's bundler: the whole client contract is environment configuration —
one URL for Convex; URL plus publishable anon key for Supabase. Snapback's
dev coupling is a supervisor-issued, pre-admitted binding delivered over an
IPC rendezvous, and the supervisor must therefore own the client's dev
server. This RFC makes **URL-first the canonical development path**: a
client configured by one URL, with deployment identity discovered from that
URL over a credential-free exchange and verified before any authenticated
call; dev origin admission opened to literal loopback; two-process
templates; an explicitly requested dev session. The supervised `--expo` path
remains supported — its lines stop being *on the canonical path* and stop
being vocabulary every agent must learn, not stop existing. Production and
release binding admission do not change.

This inverts LLP 0181's zero-configuration goal. The lesson of the
comparison is that *one env var is close enough to zero-config*, and the
machinery required to reach literal zero-config costs more than the one
variable it saves.

## What each recorded failure is actually caused by

| Failure class (recorded) | Cause | Addressed by |
| --- | --- | --- |
| Random dev origins; Clique out-of-range lanes; restart moves the origin | Ephemeral port allocation | **Already fixed** — LLP 0299 (landed) |
| Restart-verb port drift (`issues/20260823-…-restart-verb-port-drift.md`) | Supervisor lifecycle reconciliation | Supervised-path ticket; a URL client re-verifies identity at connect (P1), so staleness is detected either way |
| Metro IPv6 wedge; CI watch-inert; HMR storms through the proxy; listener-enumeration refusals; process-kill witnesses | Supervisor **owns the bundler** | P3 (canonical path never owns the bundler) |
| Agents refused at raw `{ origin }`; split-the-stack rebuilds; rendezvous vocabulary tax | **Pre-admitted binding** is the only dev source | P1 |
| Two browser contexts share one principal | **Ambient supervised mint** | P4 |

The inversion rests on the last three rows. Rows one and two are not
evidence for P1 and are not claimed as such.

## Background: the three structural choices

1. **An origin allowlist instead of `*`.** Auth is already bearer-token (no
   cookies), so the backend does not need the client's origin for identity —
   yet it admits only the exact origins in `SNAPBACK_DEV_AUTH_ORIGINS`,
   which the supervisor must know before the backend starts.
2. **A pre-admitted binding.** LLP 0181 admits no arbitrary runtime URL: the
   client refuses a raw `{ origin }` and accepts only a binding a live
   supervisor issued over the rendezvous (dev) or one baked into generated
   target facts (release).
3. **The supervisor that issues it.** Because a live issuer must exist, it
   spawns Metro, fronts it with a proxy, runs the bootstrap listener, mints
   an ambient session, and enumerates every listener.

## Proposal

### P1 — A URL is a first-class development binding source

Add a `declared-dev` binding source, carried by a dev-only entry point /
generated artifact kind that release artifacts cannot select regardless of
`NODE_ENV` or bundler mode: through it, the provider accepts a backend URL
passed by **application-owned source** (see "Bundler ownership" below) as
its single `url` argument. Admission rules:

- The URL must be an absolute `http(s)` origin whose host is **literal
  loopback** (`127.0.0.1`, `localhost`, `[::1]`) or the one documented
  host-loopback alias, `10.0.2.2` from inside the Android emulator.
  SSH and devcontainer port-forwards are *topologies*, not hosts: the
  client's URL remains literal loopback on its own side of the forward and
  is admitted as such. `host.docker.internal` is not admitted — it names a
  non-loopback host interface that P5's loopback-only listeners do not
  serve. Credentials, paths, query, fragments are refused; canonicalization
  mirrors `--external-client-origin` (details: Spec). No general "private
  host class" is admitted — see the scope ruling below.
- **Credential-free discovery gate — a standing invariant, not a
  first-use step.** No credentialed call is ever issued without a
  successful identity match against the backend *currently* at the URL:
  the unauthenticated identity exchange precedes **every other client
  call to that URL — unauthenticated signup and login included; only the
  identity fetch itself is exempt** — on every new connect episode:
  initial use, reconnect after transport loss, and backend generation
  change included. A different app or generation taking the same stable
  port is therefore refused before it sees a password, a mint, or a
  credential. Re-verification cadence mechanics are Spec material; the
  invariant is not. The match reference is the generated `app`
  export's deployment identity; mismatch fails with
  `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` naming both identities; any
  other failure is an ordinary connect refusal, never a binding.
- **What this does and does not provide (honest classification).**
  Discovery is *mix-up detection*, fail-closed: a wrong-generation or
  wrong-app backend is refused before it sees a credential. It is **not**
  server authentication: the identity is client-visible, so a hostile
  local listener could echo it. On the URL path, dev backend authenticity
  is "the URL the operator configured" — exactly the posture of every
  comparable `http://localhost` stack, including local Convex and local
  Supabase. This is an accepted regression relative to supervised issuance,
  and it is accepted on two grounds. First, a same-UID attacker who can
  win the loopback port race has already compromised the development
  host as this client's user — debugger, filesystem, and environment
  access included — so server authenticity is not a meaningful control
  against them (note: it is *not* claimed such an attacker "gains
  nothing"; an impersonating listener can capture in-flight bearers from
  ordinary signup — it is that the machine was already lost). Second,
  the remaining localhost-impersonation exposure is exactly the URL-trust
  posture of every comparable local stack. **Trust boundary, stated:**
  the canonical URL path assumes a single-user development host. On
  shared or multi-user hosts — where another UID in the same network
  namespace can bind an unprivileged port without having compromised
  your account — use the supervised path or the signed-discovery
  hardening below. The supervised path retains its stronger issuance
  for whoever wants it, and **signed
  discovery** (an identity fact signed by a store-held dev key, verified
  against a fingerprint the client obtains out-of-band) is recorded as a
  Spec-phase opt-in hardening obligation, noting the real constraint that
  codegen runs without the store and cannot bake a store key fingerprint
  into generated facts.
- **Production gating is structural, not environmental.** `declared-dev`
  lives in a dev-only entry point / generated artifact kind that release
  builds cannot select; release binding admission (target-tuple match
  against generated target facts) is authoritative regardless of
  `NODE_ENV`, bundler mode, or runtime environment, on bundled and
  unbundled (headless Node) clients alike. Dead-code elimination is bundle
  hygiene, never the authorization boundary. No runtime or remote URL
  override exists in production.
- The supervised rendezvous, when present, wins over the declared URL; a
  stale URL produces the connect refusal above, not a hang.

**Bundler ownership.** A library cannot read `EXPO_PUBLIC_*` (Expo does not
transform `node_modules`) and `VITE_*` is `import.meta.env`, so the env
read lives in application-owned or generated source: templates ship the
one-liner (`<Provider url={process.env.EXPO_PUBLIC_SNAPBACK_URL}>` /
`import.meta.env.VITE_SNAPBACK_URL` / `process.env.SNAPBACK_URL` for
headless) and pass the value to the provider. The one-variable experience
is preserved at the template level; the library never guesses.

### P2 — Dev origin admission opens to literal loopback (plain/URL profile only)

**Path-split, decided.** Admission semantics differ by profile, on purpose:

- **Plain/URL profile (canonical):** the backend admits any **literal**
  loopback origin (`localhost` / `127.0.0.1` / `[::1]` plus port — never
  "DNS that resolves to loopback", so rebinding hostnames are not
  admitted) by default. An explicit `SNAPBACK_DEV_AUTH_ORIGINS`
  **replaces** that default and is the complete allowlist: an operator
  admitting a tunnel origin who still wants loopback clients admitted must
  list the loopback origins too. `--external-client-origin`, where used,
  contributes to the same explicit allowlist (union with the environment
  list when both are set); it is never required on this profile.
- **Supervised `--expo` profile:** unchanged. The supervisor injects the
  exact planned client origins; `SNAPBACK_DEV_AUTH_ORIGINS` **merges**
  additional origins and never drops the injected ones (LLP 0299 §5);
  receipts stay exact-origin.

**Accepted tradeoffs, recorded.** (1) Any local page may call and read the
*unauthenticated* dev surface from the browser; theft of an existing
session stays closed (no cookies; a page cannot read another origin's
token). (2) Sharper: a hostile literal-loopback page can call open
**signup**, obtain a fresh bearer, and act as a **new principal** with
whatever authority the app's schema grants new users. This is the local
Convex/Supabase posture and is accepted for dev; lanes that care narrow
via the explicit allowlist, which closes it. Production admission is
unchanged.

**Compatibility.** Recording posture instead of an exact origin list is a
receipt-visible change on the plain/URL path and is *not* pretended
additive: it uses an additive, versioned representation with
reader-before-writer sequencing, and old-CLI/new-server and
new-CLI/old-receipt attach combinations get explicit acceptance. The
supervised path's exact-origin receipts are untouched. Exact encoding is
Spec material.

### P3 — `snapback dev` prints the URL; templates go two-process

- `snapback dev snapback` starts/attaches the backend on its stable
  planned port (LLP 0299) and prints `SNAPBACK_URL=http://127.0.0.1:<port>`
  plus the Android-emulator variant (`10.0.2.2`). On an explicit flag or
  template opt-in — never silently — it maintains the value in the app's
  gitignored `.env.local` (LLP 0223's rejection of durable env copies is
  re-ruled for this one non-secret value: with stable ports it is not
  stale-prone, and staleness is detected by P1). Bring-up order is
  backend-then-bundler; bundlers inline env at start, so a URL written
  after the bundler started requires a bundler restart — the template
  scripts and guide say so.
- Template `dev` scripts become two-process (`snapback dev snapback` +
  `expo start` / `vite`). The canonical template value is
  `http://127.0.0.1:<port>`; the Android emulator uses the printed
  `10.0.2.2` variant manually or the supervised path's adb-reverse
  convenience. `snapback dev --expo` remains available and documented as
  the one-command convenience that additionally owns Metro, adb reverse,
  and listener enumeration; `--client <dir> --client-command <cmd>`
  remains a non-allocating child launcher, not the template shape.
- **Client-origin stability is the bundler's, delegated knowingly.** The
  canonical path does not pin the browser-facing origin; bearer storage
  and IndexedDB are browser-origin-scoped, so a bundler that restarts on
  a different port loses that origin's local state (the backend session
  and data are unaffected — identity re-verifies and sign-in
  re-establishes). Bundlers default stable (`vite` 5173, Metro 8081);
  persistence-sensitive lanes pin them natively (`vite --port
  --strictPort`, `expo start --port`). Recorded as an accepted tradeoff.
- **Opt-in `.env.local` writers own freshness:** a writer refreshes the
  value after every ready/attach/rebind that changes the backend origin,
  never clobbers unmanaged keys, and the guide states that an
  already-running bundler must restart to see it (env is inlined at
  bundler start).

### P4 — The dev session becomes explicit

The URL path mints nothing ambiently and plain `snapback dev snapback`
mints nothing by default: it prints *instructions*; the supervised
`--expo` path retains its existing issuance behavior unchanged; `snapback auth dev-session` mints on
explicit request, and the capability is an operator tool — templates never
auto-consume it as the app session, and it is never written to `.env.local`
or any bundler-public variable. Apps and harnesses wanting distinct
principals use ordinary signup/login per context. This closes the
one-mint-shared-by-every-tab class on the canonical path by construction.

### P5 — What does not change, and what this RFC amends in LLP 0299

Unchanged: bearer custody (incl. native SecureStore custody, LLP
0252/0258), loopback-only listeners, receipt-verified lifecycle verbs,
release/hosted binding admission, LLP 0299's landed allocation behavior —
owners, pins, ranges, env equivalents, holder-naming refusals, `portPlan`
provenance — and the supervised path's code, batteries, and Android
polish.

Amended in LLP 0299 (dated amendment notes there, not a tombstone): the
canonical-path scope banner (plain profile is canonical; multi-owner
surfaces are supervised-only); problem item (1) scoped as the pre-0300
diagnosis; §5's `SNAPBACK_DEV_AUTH_ORIGINS` merge scoped to the
supervised path; §7 split into universal `portPlan` vs supervised-only
exact-origin receipts; the §2 stable-port consequence restated for
bearer-only auth; OQ1/OQ2 closed by reference to this RFC.

**Scope ruling (closes former OQ3).** The canonical URL path covers: web,
iOS simulator, Android emulator (via `10.0.2.2`), SSH/devcontainer
port-forwards (literal-loopback URLs across a forward), and non-loopback
*client* origins admitted via `SNAPBACK_DEV_AUTH_ORIGINS`. The supervised
path's established mobile transports are exactly: the Android emulator
and — the sole physical-device transport — Android USB, both via verified
`adb reverse` (iOS USB forwarding is
refused today — `SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE`).
Everything else — other physical-device transports, any non-loopback
backend listener, a backend reached through an operator-run public
tunnel — is **out of scope** for both paths pending its own
explicitly-analyzed RFC, not silently "supervised territory." The gains
table below is scoped accordingly.

## Tradeoffs accepted by this RFC

| We gain | We give up |
| --- | --- |
| M1 = start backend, read URL, start bundler — web, simulators, emulators, port-forwarded containers/VMs | Boot-time binding issuance; identity check moves to a credential-free connect-time gate (still fail-closed for mix-ups) |
| Tunnel/forwarded *client* origins and multi-context Playwright work without leaving the paved path | Supervised attestation of backend authenticity on the canonical path — accepted on single-user hosts (a same-UID port-racer has already compromised the client's user; comparable stacks offer no more); shared/multi-user hosts are directed to supervised issuance or signed discovery |
| The supervisor's ~2.7k lines and its rendezvous vocabulary leave the canonical path (they remain supported) | The supervisor's proof that *every* listener incl. Metro is loopback-only — on the URL path Snapback vouches only for its own listener |
| Dev and prod converge on "a URL that is a build-time fact"; the two-client shared-principal class closes by construction | Ambient logged-in-on-boot; Android `adb reverse` polish is supervised-path-only; physical devices are not on the canonical path |
| — | LLP 0181 (27 revisions) and 0223 re-ruled; batteries re-pointed — the real cost is documentary |

## Security analysis

- **Hostile local page.** No cookies + bearer custody means CORS grants
  neither possession of an existing token nor authorization. What
  loopback-open admission *does* open is the browser channel to the
  unauthenticated dev surface (P2, recorded tradeoff). The allowlist
  remains available as narrowing.
- **Hostile URL / injection.** The dev source reads application-owned
  build-time configuration and an explicit prop — never remote config or
  application data — and cannot be selected by release artifacts (P1
  structural gating). The attack LLP 0181 closed stays closed in
  production.
- **Wrong-generation / wrong-app backend.** Refused at the credential-free
  gate before any authenticated call (P1). Dev server *authenticity* is
  the operator's configured URL, per the honest classification in P1.
- **Token custody.** Unchanged. No token or session material is written to
  disk by anything this RFC adds; the only new disk write is the opt-in,
  gitignored, non-secret `.env.local` URL.

## Migration

1. LLP 0299 — **already landed** (`544dd6a8e`): the allocator. This RFC
   amends 0299's origin-admission/receipt/scope prose as listed in P5.
   Migration note: a leftover `SNAPBACK_DEV_CLIENT_PORT` /
   `SNAPBACK_DEV_BOOTSTRAP_PORT` in the environment fails plain
   `snapback dev` with `SNAPBACK_CLI_ARGUMENT_INVALID` (LLP 0299 §5
   refuses pins for absent owners); the guide's migration text names this.
2. P1 + P2: client `declared-dev` source (dev-only entry point), discovery
   gate, loopback admission with the compatibility posture of P2. The Spec
   defines the discovery fact (identity + admission posture ONLY — no
   receipts, tokens, foreign ports, or lease state), refusal codes,
   precedence, and receipt encoding.
3. P3 + P4: template flips, URL printing/`.env` opt-in, explicit dev
   session; guide rewrite teaching URL-first with the supervisor as the
   convenience appendix.
4. Re-rule LLP 0181 and LLP 0223 via amendment notes (supervised baseline →
   one of two admitted dev sources; client process ordinarily
   caller-owned). Tombstone nothing.
5. Publish per LLP 0041; each phase rides the next npm cut.

## Acceptance

1. A cold agent with only the start packet brings up the template with
   `snapback dev snapback` + `expo start`, pasting one printed env var; the
   app boots **logged out**, and ordinary signup completes against the
   backend. No supervisor knowledge, no binding vocabulary.
2. Two Playwright contexts hold two distinct principals via ordinary
   signup — no skip recipe, no shared ambient mint.
3. The same app behind a devcontainer/SSH port-forward works unchanged; a
   tunnel *client* origin admitted via `SNAPBACK_DEV_AUTH_ORIGINS` works;
   a tunnel-only allowlist does **not** admit loopback unless restated,
   and restating both works; literal-loopback matching rejects a
   rebinding hostname.
4. A URL at a wrong-generation backend refuses with
   `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` naming both identities, and no
   credentialed request was sent before the refusal — including after a
   correct initial connection when a different backend has since taken the
   same origin: the next connect episode re-verifies and refuses before
   any credentialed traffic.
5. Release admission is **behaviorally** unchanged: a production Expo
   build, a production Vite build (including with a misleading
   `NODE_ENV`), and an unbundled headless Node process — each **with the
   URL env var and `url` argument set** — can none of them select
   `declared-dev`; release target-tuple admission behaves exactly as
   before.
6. The `--expo` battery passes; supervised receipts keep exact origins;
   old/new attach combinations from P2's compatibility posture pass.
7. Per-bundler cold-template acceptance: Expo (web + iOS sim + Android
   emulator via `10.0.2.2`), Vite, headless Node — each reading its own
   convention from application-owned source.
8. A bundler restarted on a new port still reaches the backend (admission
   is loopback-open) with that origin's browser-local state reset — the
   accepted P3 tradeoff — and the backend's data is intact after ordinary
   re-sign-in.
9. A page on a second literal-loopback origin can complete open signup as
   a NEW principal (the accepted P2 exposure) but cannot read another
   principal's data; setting an explicit allowlist without that origin
   closes even the signup channel.

## Open questions

- **OQ1 — template env variable names only** (`EXPO_PUBLIC_SNAPBACK_URL` /
  `VITE_SNAPBACK_URL` / `SNAPBACK_URL`). The library takes a single `url`
  argument; any precedence among sources lives in application-owned
  source. The `.env.local` write policy is settled in P3.
- **OQ2 — discovery fact path/shape only** (`/_snapback/identity` vs a
  reduced readiness projection). The RFC already rules it unauthenticated
  and identity+posture-only; reuse of the full readiness surface as-is is
  struck.
- **OQ4 — closed (this revision):** `--external-client-origin` is never
  required on the URL path; where used it contributes to the explicit
  allowlist (union with the environment list), keeps its `--port`
  requirement and its `--expo` refusal, and is documented as a
  compatibility spelling of the allowlist. Deprecation timing is
  implementation-phase.
- **OQ5 — closed for this RFC:** the demotion is documentation and
  template demotion only. Whether future capabilities may land
  supervised-only is a per-capability justification question, not ruled
  here.
- **Spec obligations recorded:** opt-in signed discovery (P1); receipt
  posture encoding (P2); URL canonicalization details (P1); per-bundler
  dev-entry / generated-kind exclusion mechanics (resolution or codegen —
  never dead-code elimination, which is bundle hygiene only) (P1);
  re-verification cadence for the standing discovery invariant (P1);
  `snapback auth dev-session` targeting/output/refusals (P4); `.env.local`
  writer ownership, no-clobber, and refresh-on-rebind lifecycle (P3); the
  exact supervised-rendezvous-vs-declared-URL source transition rule (P1).

## Alternatives considered

- **Status quo + LLP 0299 only.** Stable ports remove the sharpest pain;
  every agent still learns the binding vocabulary and the supervisor stays
  load-bearing for every Expo app. Rejected by the author's direction.
- **Caller-owned bundler + pre-admitted binding (the middle).** Keep
  issuance but stop owning Metro: `snapback dev` writes/serves a signed
  binding the app consumes. This removes the bundler-ownership bug class
  but keeps a live-issuer requirement, the rendezvous/binding vocabulary,
  and the refusal of plain URLs — and on a single-user host its
  attestation defends against an attacker who has already compromised the
  client's user, while on shared hosts P1 directs to supervised issuance
  or signed discovery anyway. The simpler contract dominates it.
- **Bootstrap-on-backend.** Fewer ports, same issuance machinery and
  vocabulary. Strictly weaker than P1.
- **Full supervisor removal.** Deletes Android polish and the one-command
  path for no additional canonical-path simplification. Demotion is
  enough.

## Pipeline

This RFC → `llp-super-refine` (dual-family, until READY/READY) → author
acceptance → a Spec (owner boundaries, exact codes, discovery fact,
precedence, receipt encoding, template diffs) → implementation program with
its own review gates. The Spec and implementation must not begin before
this RFC is Accepted.
