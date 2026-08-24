# LLP 0302: declared-dev client binding — generated kind, discovery gate, provider contract

**Type:** Spec
**Status:** Accepted
**Systems:** Client integration, React/Expo, Vite/Exact clients, Headless
client, Code generation, Templates, Guide, Diagnostics
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (standing
overnight directive 2026-08-24: RFC → refine → Specs → refine →
implementation)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (f — Review → Accepted; the refine loop never
applies acceptance — this transition is applied by the orchestrator under
the author's standing overnight directive of 2026-08-24, after the
cluster's dual READY per-target and set verdicts)
**Revised:** 2026-08-24 (e — post-freeze corrections from punch-list round
3: full non-2xx un-verify restored (fail-closed beats 4xx noise; subsumes
the 3xx gap); release-variant leftover sentence rewritten to the sentinel;
§7 inventory lists all three new client codes; "library stamp" wording;
obligations box added)
**Revised:** 2026-08-24 (d — round-2 revision, after which the normative
surface is FROZEN per the Spec-type default: stream-less consumers get a
normative per-operation preflight (the idle-swap residual is closed, not
merely stated); the precedence table is scoped to capability-present with
named rendezvous signals; the release variant is import-stable; the brand
is a library-internal stamp; un-verify narrowed to transport failure,
drop, or 5xx; malformed-fact and refusal codes pinned via LLP 0301 §7a)
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

> **Scope freeze (2026-08-24).** Per LLP 0010 §2's Spec-type default, the
> normative surface of this Spec froze after the round-2 revision (d):
> subsequent revisions make corrections and restorations only, and any
> demand for new normative closure is recorded as an obligation, never
> folded as new prose.


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
  release emits the variant that does not construct it — the named export
  at the same path is the import-stable sentinel of the bullet below. Generated output is replaced atomically, and a dirty
  dev→release transition (stale files) is covered by acceptance.
- **Library-internal stamp (the brand):** the dev variant obtains its
  capability by calling a library mint; the library stamps it internally
  (a private Symbol/WeakMap the library owns), and the admission arm (§2)
  accepts a `declared-dev` candidate only when the library's own stamp is
  present — unforgeable from public API. The app's public deployment identity is *checked*
  (below) but is **not** the brand — a candidate assembled from public
  data is refused. `admitAppBindingV1` gains no option that constructs
  one from raw application data.
- **Import-stable release variant:** the release variant exports the
  same named surface at the same path (a sentinel that constructs
  nothing), and the generated `app` surface is replaced in the same
  atomic step as the variant, so importers never fail to resolve or
  load. **Capability-absent rule:** with the release variant, a provided
  `url` is ignored for source selection (a debug-level diagnostic names
  that `declared-dev` is not present); the existing `release` /
  `hosted-development` / `supervised-dev` admission runs byte-for-byte
  unchanged. The release build with `url` set therefore builds, boots,
  and admits exactly as before.
- Generation-provenance check: the dev capability embeds the generating
  `app`'s DeploymentIdentity; admission refuses with
  `SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED` (also the unbranded-candidate
  code) when it differs from the importing generated `app`'s identity,
  using the LLP 0301 §2a comparator.

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
  **any non-2xx** on a non-identity call — which immediately *un-verifies*
  the episode: the failed call is not retried and no other call is made
  until re-verification. (Fail-closed on purpose: a wrong listener can
  answer 4xx, and the cost of over-triggering is one credential-free
  loopback GET.)
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
  or digest-incomplete `deployment`, missing `admissionPosture` —
  refuses with `SNAPBACK_APP_IDENTITY_FACT_INVALID`; any network refusal,
  non-2xx (including Prod's `SNAPBACK_APP_IDENTITY_UNAVAILABLE`), or
  redirect is an ordinary connect refusal naming the code; never a
  binding. `admissionPosture` is
  otherwise echoed in diagnostics and not consumed.
- Cadence: no timer for streamed clients — the standing stream's drop is
  the replacement signal, so no unverified call can follow a swap.
  **Stream-less mode is normatively closed, not a residual:** a consumer
  operating without the standing stream (an explicitly stream-less
  headless configuration) MUST re-verify before **every top-level
  operation** — each operation is its own episode. There is no mode in
  which a call may reach a replaced backend without a preceding match;
  LLP 0300's standing invariant holds for both shapes.

## 4. Source precedence — rendezvous wins, literally

This table applies when the generated dev capability is present (§1);
with the release variant, §1's capability-absent rule takes precedence and
`url` is never a source selector. "Configured" means the supervised
environment signal is installed — `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`
or the injected `__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__` global; "absent"
means neither is set.

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

New client codes: `SNAPBACK_APP_BINDING_URL_INVALID`,
`SNAPBACK_APP_IDENTITY_FACT_INVALID`,
`SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED`. Reused:
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
   library stamp is refused.
4. Precedence table: completed rendezvous ignores `url`; failed
   configured rendezvous refuses without URL fallback; absent rendezvous +
   `url` selects `declared-dev`.
5. Per-bundler cold templates (rows 1, 2, 7): Expo web + iOS sim +
   Android emulator via pasted `10.0.2.2`, Vite, headless (Origin-less
   identity GET) — one env var each, logged-out boot, ordinary signup,
   two distinct principals in two contexts.
6. Bundler restart on a new port (row 8): still connects; browser-local
   state reset accepted; backend data intact after ordinary re-sign-in.

## 8a. Recorded obligations (post-freeze; resolved in implementation, not
by new Spec prose)

- Define the stream-less "top-level operation" atom (including nested and
  concurrent operations) in the implementation's client documentation, and
  ship an executable per-operation preflight battery exercising §3's
  stream-less mode. (Punch-list round 3, both families.)

## 9. Out of scope

Server admission, identity route, receipts, CLI printing/writer,
dev-session, documentary deliverables (LLP 0301); implementing signed
discovery (§6); production/hosted binding arms (unchanged).
