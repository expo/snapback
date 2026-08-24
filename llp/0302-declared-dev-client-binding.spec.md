# LLP 0302: declared-dev client binding — generated kind, discovery gate, provider contract

**Type:** Spec
**Status:** Review
**Systems:** Client integration, React/Expo, Vite/Exact clients, Headless
client, Code generation, Templates, Guide, Diagnostics
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (standing
overnight directive 2026-08-24: RFC → refine → Specs → refine →
implementation)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (b — Draft → Review at llp-super-refine loop start;
authorization: the author's standing overnight directive)
**Revised:** 2026-08-24 (a — initial draft)
**Related:** LLP 0300 (Accepted — the governing RFC), LLP 0301 (the
server/CLI sibling; owns the identity fact this Spec consumes), LLP 0299,
LLP 0181

## Summary

The client half of LLP 0300 P1/P4: a fourth binding source,
`declared-dev`, gated **structurally by a generated artifact kind** rather
than an entry-point condition; the standing credential-free discovery gate;
the rendezvous-vs-URL transition rule; and the per-template one-liners.
The wire contract it consumes (identity fact, admission posture) is LLP
0301 §1–§2.

## 1. Structural gating: a generated kind, not an env branch

LLP 0300 P1 requires that release artifacts **cannot select**
`declared-dev`, regardless of `NODE_ENV`, bundler mode, or bundling at
all. Export-map `development` conditions do not hold across Metro, Vite,
and unbundled Node uniformly, so this Spec chooses the RFC's other
admitted mechanism:

- Codegen emits `generated/declared-dev.mjs` into the app's generated
  directory **only when generating for development** (the existing dev vs
  release generation modes). The module exports one capability:
  `declaredDev(url)` → a candidate binding
  `{ source: 'declared-dev', target: { origin }, provenance: { generation:
  <the generated app's deployment identity> } }`.
- Release generation **omits the file**. A release build that imports it
  fails at build/resolve time (bundled) or module-load time (headless) —
  structurally, before any admission logic runs. Dead-code elimination
  remains bundle hygiene only.
- The provider/admission layer refuses a `declared-dev` candidate whose
  `provenance.generation` does not equal the importing generated `app`'s
  identity — the module cannot be smuggled between builds.
- Release binding admission (`release`, `hosted-development`,
  `supervised-dev` arms in `admitAppBindingV1`) is byte-for-byte
  unchanged.

## 2. The `declared-dev` admission arm

Added to the existing source list (`app-binding.mjs`):

- `target.origin` must be an absolute `http(s)` origin whose hostname is
  literal `127.0.0.1`, `localhost`, `[::1]`, or `10.0.2.2` — mirroring
  LLP 0300 P1's ruling; credentials/path/query/fragment refused;
  canonicalization mirrors `--external-client-origin`
  (`SNAPBACK_APP_BINDING_URL_INVALID` on refusal, naming the reason).
- Admitted only in the presence of the generated capability (§1);
  `admitAppBindingV1` gains no option that constructs one from raw
  application data.
- Provenance carries `generation` only; expiry semantics: a
  `declared-dev` binding does not expire by clock — it is re-verified by
  the standing gate (§3) instead.

## 3. The standing discovery gate

State machine per (client instance, origin):

- **Episode start** — first use, transport reconnect, or observed
  `startupNonce` change (any response/stream carrying a nonce different
  from the verified one) opens an *unverified* episode.
- In an unverified episode the ONLY permitted request is
  `GET /_snapback/api/app/identity` (LLP 0301 §1) — no bearer, session,
  mint, signup, login, or any other call, credentialed or not.
- **Match:** returned `deployment` equals the generated `app`'s deployment
  identity → episode verified; all traffic proceeds; the returned
  `startupNonce` is pinned for restart detection.
- **Mismatch:** fail with `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` naming
  both identities. Any other failure (network refusal, non-2xx, malformed
  fact, Prod's typed refusal) is an ordinary connect refusal, never a
  binding.
- Cadence: no timer. Re-verification triggers are exactly the episode
  starts above. (LLP 0300 records cadence as Spec-owned; this is the
  ruling.)

## 4. Source precedence: rendezvous wins

When the supervised rendezvous is present — an installed supervisor origin
(`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` / the injected global) that
completes its exchange — the supervised binding is used and `declared-dev`
is not consulted. Otherwise, if the application passed `url`, the
`declared-dev` path runs. A configured-but-dead URL yields the connect
refusal above; the provider does not fall back from a failing rendezvous
to a URL or vice versa within one boot (no silent source switching; the
diagnostic names which source was selected and why).

## 5. Provider and template contract

- Providers (`SnapbackExpoProvider`, the React provider, headless
  `createSnapbackAppClient` wrapper) accept one optional `url` argument.
  The library reads no environment.
- Template one-liners (application-owned source, per bundler):
  - Expo: `<SnapbackExpoProvider url={process.env.EXPO_PUBLIC_SNAPBACK_URL} …>`
  - Vite/React: `url={import.meta.env.VITE_SNAPBACK_URL}`
  - Headless: `url: process.env.SNAPBACK_URL`
  Each template imports the generated `declared-dev` capability from its
  generated directory and passes it alongside `url` (exact prop shape is
  the implementation's; the contract is: generated capability + url, no
  library env reads).
- When `url` is undefined and no rendezvous is present, behavior is
  today's (binding unavailable), with the diagnostic now naming the
  `SNAPBACK_URL` option.

## 6. Signed discovery: deferred

The LLP 0300 opt-in hardening obligation is **deferred, not designed
here**: implementation files `issues/…-signed-discovery-opt-in.md`
recording the constraint (codegen runs without the store, so the key
fingerprint needs an out-of-band channel) and the trigger (shared-host
lanes). No client surface in this Spec depends on it.

## 7. Diagnostics

New client codes: `SNAPBACK_APP_BINDING_URL_INVALID`,
`SNAPBACK_APP_BINDING_SOURCE_CONFLICT` (rendezvous + URL both live and
disagreeing on origin — refused, not silently chosen). Reuse
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` and the existing unavailable/
refusal codes elsewhere.

## 8. Acceptance (client half of LLP 0300's battery)

1. Release generation omits the capability; a release build importing it
   fails structurally; `NODE_ENV`/mode do not resurrect it (LLP 0300
   acceptance 5, with URL env and `url` argument set).
2. Gate ordering: a fixture backend records request order — identity GET
   strictly precedes signup/login/any call in every episode; origin
   reassignment mid-run (kill backend, boot wrong-generation backend on
   the same port) → next episode refuses with IDENTITY_MISMATCH and no
   credentialed or signup request was sent (LLP 0300 acceptance 4).
3. Wrong-app generated capability vs running backend → IDENTITY_MISMATCH
   naming both.
4. Rendezvous-wins: supervised environment present → supervised source
   selected even with `url` set; conflict diagnostic when both are live
   with different origins.
5. Per-bundler cold templates (LLP 0300 acceptance 7): Expo web + iOS sim
   + Android emulator via `10.0.2.2`, Vite, headless — one env var each,
   logged-out boot, ordinary signup (LLP 0300 acceptance 1), two distinct
   principals in two contexts (acceptance 2).
6. Bundler restart on a new port: still connects (server admits loopback),
   browser-local state reset accepted (LLP 0300 acceptance 8).

## 9. Out of scope

Server admission, identity route, receipts, CLI printing/writer,
dev-session (LLP 0301); signed discovery (§6 deferral); production/hosted
binding arms (unchanged).
