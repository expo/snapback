# LLP 0302: declared-dev client binding — generated kind, discovery gate, provider contract

**Type:** Spec
**Status:** Review
**Systems:** Client integration, React/Expo, Vite/Exact clients, Headless
client, Code generation, Templates, Guide, Diagnostics
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (standing
overnight directive 2026-08-24: RFC → refine → Specs → refine →
implementation)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (c — round-1 revision: gating rebuilt on an
always-emitted generated module with a module-private brand (release
builds succeed with `url` set); the episode machine rebuilt on transport
lifecycle with the stateless idle-swap residual stated; rendezvous-wins
made literal and `SOURCE_CONFLICT` dropped; malformed-fact enumeration;
cache-bypass; Origin-less headless rule; canonicalization deferred to the
LLP 0301 §2b shared algorithm and vectors)
**Revised:** 2026-08-24 (b — Draft → Review at loop start)
**Revised:** 2026-08-24 (a — initial draft)
**Related:** LLP 0300 (Accepted — the governing RFC), LLP 0301 (the
server/CLI sibling; owns the identity fact and the shared canonicalization
this Spec consumes), LLP 0299, LLP 0181

## Summary

The client half of LLP 0300 P1/P4: the `declared-dev` binding source,
gated structurally by an **always-emitted generated module whose dev and
release variants differ**; the standing credential-free discovery gate as
a transport-lifecycle episode machine; literal rendezvous-wins precedence;
and the per-template one-liners. The wire contract is LLP 0301 §1/§2a/§2b.

## 1. Structural gating: one stable module, two generated variants

LLP 0300 P1 requires that release artifacts cannot select `declared-dev`
regardless of `NODE_ENV`, bundler mode, or bundling at all — and release
builds must still **succeed** with the URL env and `url` argument present
(LLP 0300 acceptance 5). Therefore:

- Codegen **always** emits the same generated module path (inside the
  generated `app` surface — application source imports nothing new and
  nothing that can be absent). Generating for development emits the
  variant that constructs the `declared-dev` capability; generating for
  release emits the variant that does not export or construct that source
  at all. Generated output is replaced atomically, and a dirty
  dev→release transition (stale files) is covered by acceptance.
- **Module-private brand:** the dev variant mints its capability with a
  brand private to the module instance (an unexported closure value); the
  admission arm (§2) accepts a `declared-dev` candidate only when it
  carries that brand. The app's public deployment identity is *checked*
  (below) but is **not** the brand — a candidate assembled from public
  data is refused. `admitAppBindingV1` gains no option that constructs
  one from raw application data.
- **Capability-absent rule:** when the running artifact's generated
  variant is the release one, a provided `url` is ignored for source
  selection (a debug-level diagnostic names that `declared-dev` is not
  present in this artifact); the existing `release` / `hosted-development`
  / `supervised-dev` admission runs byte-for-byte unchanged. The release
  build with `url` set therefore builds, boots, and admits exactly as
  before.
- Generation-provenance check: the dev capability embeds the generating
  `app`'s DeploymentIdentity; admission refuses (typed) when it differs
  from the importing generated `app`'s identity, using the LLP 0301 §2a
  comparator.

## 2. The `declared-dev` admission arm

- `target.origin` is admitted by the LLP 0301 §2b shared algorithm and
  vectors, with the URL-surface literal set `127.0.0.1`, `localhost`,
  `[::1]`, `10.0.2.2` (`SNAPBACK_APP_BINDING_URL_INVALID` on refusal,
  naming the failed rule). `10.0.2.2` is the emulator NAT alias for host
  loopback — a URL host only, never a browser Origin.
- No clock expiry; the standing gate (§3) is the re-verification.

## 3. The standing discovery gate — transport-lifecycle episodes

State machine per (client instance, origin). The transports are named:
Snapback clients hold a **standing live-query stream** per backend
connection (the existing client transport); headless request/response use
is the degenerate case below.

- **Episode start:** (a) first use of the origin by this client instance;
  (b) establishment of a new standing stream (including every reconnect
  after a stream drop); (c) any transport error, connection drop, or
  non-2xx on a **non-identity** call — which immediately *un-verifies*
  the episode: the failed call is not retried and no other call is made
  until re-verification.
- In an unverified episode the only permitted request is
  `GET /_snapback/api/app/identity`, sent credential-free with cache
  bypass (`cache: 'no-store'`; no conditional headers) and refusing
  redirects. Headless callers send it without an `Origin` header (LLP
  0301 §1 admits Origin-less).
- **Match** (LLP 0301 §2a comparator against the generated `app`'s
  identity) → verified; all traffic proceeds, including unauthenticated
  signup/login — which are forbidden before the match, exactly like
  credentialed calls.
- **Mismatch** → `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` naming both
  identities. **Malformed fact** — wrong/missing `formatVersion`, missing
  or digest-incomplete `deployment`, missing `admissionPosture` — or any
  network refusal, non-2xx (including Prod's
  `SNAPBACK_APP_IDENTITY_UNAVAILABLE`), or redirect → an ordinary connect
  refusal naming the code; never a binding. `admissionPosture` is
  otherwise echoed in diagnostics and not consumed.
- Cadence: no timer. **Stated residual (accepted):** a purely stateless
  consumer that observes no failure across an instant backend swap on the
  same port could send one post-swap call unverified; clients that hold
  the standing stream do not have this window (the old process's death
  drops the stream). This is the same single-user-host residual LLP 0300
  accepts, and headless consumers that need better start a standing
  stream or re-instantiate the client per operation.

## 4. Source precedence — rendezvous wins, literally

| Rendezvous state | Selected source |
| --- | --- |
| Exchange completes | Supervised binding; `url` **ignored** (diagnostic names the supervised source and notes the ignored `url`) |
| Configured but exchange fails | Typed supervised failure; **no** URL fallback within this boot |
| Absent | `declared-dev` when `url` is set; otherwise today's unavailable diagnostic, now naming the `url` option |

There is no conflict refusal: a completed rendezvous is never refused
because `url` also exists. (`SNAPBACK_APP_BINDING_SOURCE_CONFLICT` from
revision (b) is dropped.) No silent source switching within one boot in
either direction.

## 5. Provider and template contract

- Providers accept one optional `url` argument; the library reads no
  environment. Template one-liners (application-owned source): Expo
  `url={process.env.EXPO_PUBLIC_SNAPBACK_URL}`; Vite
  `url={import.meta.env.VITE_SNAPBACK_URL}`; headless
  `url: process.env.SNAPBACK_URL`. Templates pass **only** `url` — the
  generated capability travels inside the generated `app` surface (§1),
  never through template code.
- Android emulator: the pasted `androidEmulatorUrl` value (LLP 0301 §4);
  the writer-managed block is the host-loopback value.

## 6. Signed discovery

Designed in LLP 0301 §9; **not required for these Specs to go READY and
excluded from this implementation set** — the client-side hook (optional
fingerprint argument; refusal of unsigned facts when configured) is part
of that future work, tracked by the issue LLP 0301 §9 names.

## 7. Diagnostics

New client code: `SNAPBACK_APP_BINDING_URL_INVALID`. Reused:
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`, the existing unavailable/refusal
codes, and LLP 0301's `SNAPBACK_APP_IDENTITY_UNAVAILABLE` by name. All
new codes are s5_d10-classified with the landing (LLP 0301 §7).

## 8. Acceptance (client half; set traceability in LLP 0301 §8)

1. **Release matrix (LLP 0300 row 5):** production Expo, production Vite
   (misleading `NODE_ENV` included), and unbundled headless — each with
   the URL env and `url` argument set — **build and run successfully**,
   cannot select `declared-dev` (capability-absent rule observed), and
   admit release bindings byte-identically; a dirty dev→release generated
   directory is regenerated atomically and behaves as release.
2. **Gate ordering (row 4):** a fixture backend records request order —
   the identity GET strictly precedes signup/login/every call in every
   episode; kill-and-replace with a wrong-generation backend on the same
   port → the stream drop opens an episode, the next exchange refuses
   with IDENTITY_MISMATCH, and no signup or credentialed request was sent
   post-swap; the identity fetch is observed with `no-store` (no cached
   match across the swap).
3. Wrong-app generated capability vs running backend → IDENTITY_MISMATCH
   naming both; a hand-assembled `declared-dev` candidate without the
   module brand is refused.
4. Precedence table: completed rendezvous ignores `url`; failed
   configured rendezvous refuses without URL fallback; absent rendezvous +
   `url` selects `declared-dev`.
5. Per-bundler cold templates (rows 1, 2, 7): Expo web + iOS sim +
   Android emulator via pasted `10.0.2.2`, Vite, headless (Origin-less
   identity GET) — one env var each, logged-out boot, ordinary signup,
   two distinct principals in two contexts.
6. Bundler restart on a new port (row 8): still connects; browser-local
   state reset accepted; backend data intact after ordinary re-sign-in.

## 9. Out of scope

Server admission, identity route, receipts, CLI printing/writer,
dev-session, documentary deliverables (LLP 0301); implementing signed
discovery (§6); production/hosted binding arms (unchanged).
