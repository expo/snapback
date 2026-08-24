# LLP 0299: Supervised listener port plan — stable by default, pinnable everywhere

**Type:** Spec
**Status:** Implemented
**Systems:** CLI, Local server lifecycle, Expo client, Vite/Exact clients,
Developer experience, Diagnostics, Guide, Templates
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (author ruling
2026-08-23: "fix this Expo ports problem"; "make snapback very flexible and
able to handle all kinds of weird setups, not handle this as an Expo
one-off")
**Date:** 2026-08-23
**Revised:** 2026-08-24 (d — LLP 0300 harmonization amendment, cluster
refine round 1: canonical-path banner; problem item (1) scoped as the
pre-0300 diagnosis; §5 merge scoped to the supervised path; §7 split into
universal `portPlan` vs supervised-only exact-origin receipt; §2
consequence rewritten off the cookie claim; web/native listener counts;
OQ1/OQ2 closed by reference to LLP 0300)
**Revised:** 2026-08-24 (c — Implemented at landing; renumbered 0298→0299
after `c2f1b283a` claimed 0298 for durable-effect scope; dual-family review
rounds closed — grok READY, codex deltas fixed in round 3)
**Revised:** 2026-08-23 (b — review round 1: `attached` provenance and the
attach-out-of-range refusal; placeholder-held Metro port; first-owner
exhaustion reporting; backend exhaustion surfaced by the lifecycle owner)
**Revised:** 2026-08-23 (a — initial ruling and contract)
**Related:** LLP 0300, LLP 0010, LLP 0181, LLP 0223, LLP 0294, LLP 0295,
Diary 0100, Diary 0101, Diary 0104, Diary 0106,
`issues/closed/20260823-supervised-listeners-unpinnable.md`,
`benchmarks/runs/2026-08-22-clique-local-main-grok/record.md`

## Summary

`snapback dev --expo` starts four listeners on web — the Snapback backend,
the bootstrap exchange, the browser-facing client front, and the Metro
process — and three on native, where Metro is itself the client; until this
Spec only the backend could be pinned. The other
three were allocated with `listen(0)`, so every restart moved the origin the
browser had just stored a session for, pinned-range sandboxes (Clique lanes)
were pushed out of contract, and the only escape was to leave the supervised
path and rebuild the lifecycle by hand. That workaround dominated M1 wall in
the LLP 0295 matrix (Diary 0106: 36 minutes; the reduced 0.1.25 record called
it the top recurring cost).

This Spec extends the posture the Rust backend already has (LLP 0010: stable
range by default, explicit `--port` strict) to **every listener Snapback owns
in any `snapback dev` profile**, and adds the knobs weird setups need: a
per-owner pin, a caller-chosen range, environment equivalents, holder-naming
strict refusals, and provenance in the readiness record. The design is
deliberately not Expo-specific: the rule is *pin what Snapback owns, declare
what it does not*, and it composes the same way for the Expo, external-client,
and plain profiles.

> **Scope after LLP 0300 (amendment, 2026-08-24).** LLP 0300 makes the §6
> plain profile the canonical development path. On that path this Spec's
> backend range/pin/`portPlan` surface is the *whole* port surface.
> Multi-owner planning, `--client-port` / `--bootstrap-port` and their
> environment equivalents, the `metro` owner, and alias-origin injection
> are the supervised `--expo` convenience path's surface — kept, not dead.
> LLP 0300 P2 re-rules origin admission and the plain-profile receipt; the
> supervised path keeps exact-origin injection and receipts unchanged.

## The problem, and why Convex and Supabase do not have it

Convex and Supabase are "a URL". `npx convex dev` is a fixed default port
(3210) or a cloud URL; `supabase start` is 54321. Neither spawns, proxies, or
handshakes with the client's bundler; the whole coupling is one environment
variable. And neither backend cares which origin the client runs on: auth is a
bearer token the client holds and CORS is open, so a bundler on a different
port changes nothing about identity.

Snapback made three choices that compound:

1. **An origin allowlist instead of `*`.** Auth is already bearer-token
   (`authorization: Bearer …`; no cookies), so the backend does not need the
   client's origin for identity. It nonetheless admits only the exact loopback
   origins in `SNAPBACK_DEV_AUTH_ORIGINS` (LLP 0223's derived CORS/auth
   allowlist) and records them in the readiness receipt, which makes the
   client's origin — and therefore the bundler's port — an input the backend
   must know before it starts. `localhost`, `127.0.0.1`, and `[::1]` are three
   origins.
2. **A pre-admitted binding, and the supervisor that issues it.** LLP 0181
   admits no arbitrary runtime URL: the client refuses a raw `{ origin }` and
   accepts only a binding a live `snapback dev --expo` supervisor issued over
   IPC (dev) or one baked into generated target facts (release). The
   supervisor therefore spawns Metro, fronts it with a proxy, and runs a
   bootstrap listener for the handshake — putting Snapback in the critical
   path of the client dev server as the only first-class dev path.
3. **The supervisor randomized the three addresses it invented.** This is
   the bug. The Rust backend already has the right posture — no `--port`
   scans the fixed range 4287–4387 deterministically, `--port N` binds
   strictly and hard-fails on `AddrInUse` — and the Node supervisor did not
   follow it.

This Spec fixes (3) in a way that generalizes. (1) and (2) were this
Spec's pre-LLP 0300 diagnosis: LLP 0300 P2 re-rules (1) for the plain/URL
profile (any literal loopback origin is admitted by default; posture, not
an exact list, is recorded), and LLP 0300 P1 answers (2) with the
`declared-dev` URL source. The supervised `--expo` path keeps exact-origin
injection as described in §7 and §9.

## 1. Owners

A **listener owner** is a process or socket that `snapback dev` binds on the
caller's behalf. Owner names are stable identifiers used in flags,
diagnostics, and receipts:

| Owner | What it is | Profiles that have it |
| --- | --- | --- |
| `backend` | The Snapback server (API, sessions, Guide) | all |
| `bootstrap` | The supervised rendezvous listener serving `/_snapback/expo/v1/bootstrap` | `--expo` |
| `client` | The origin the browser or app uses. Expo web: the Metro front (proxy). Expo native: the Metro process itself | `--expo` |
| `metro` | The Metro bundler process behind the front (web only; on native it *is* `client`) | `--expo --expo-platform web` |

Everything Snapback does not own is **declared, never allocated**: the
external-client profile's `--external-client-origin` (LLP 0223) stays the
declaration for a caller-owned Vite/Exact/headless client, and `--client-port`
/ `--bootstrap-port` are refused outside `--expo` with a diagnostic that says
which owners exist in the active profile.

## 2. Default posture: stable, deterministic, collision-tolerant

With no port flags, every owner is allocated from the **default range
4287–4387** (LLP 0010's range, unchanged) in a fixed, documented order:

- `backend` scans **ascending** from the bottom of the range, exactly as
  today (Rust `bind_first_available`), so the canonical 4287 stays the
  backend in the common case.
- Supervisor-owned listeners scan **descending** from the top of the range in
  the order `client`, `bootstrap`, `metro`, so a fresh Expo web run yields
  `client` 4387, `bootstrap` 4386, `metro` 4385 and the two scans meet only
  when the range is nearly full.

The consequence is the Convex/Vite experience: the same ports every
morning. Backend stability keeps `SNAPBACK_URL`-style configuration,
attach identity, and constrained lanes valid across restarts (LLP 0300 P3
relies on exactly this); supervised client-origin stability preserves the
browser's origin-scoped bearer storage and IndexedDB. Auth is bearer-token
— no cookies — and on the URL path the client origin is bundler-owned, so
backend stability alone does not stabilize a caller-owned browser origin.
Under contention (the fleet, a second project) the scan walks and the
readiness record says where it landed. Ephemeral kernel-assigned ports are no longer a
default for anything a client, cookie, or receipt depends on.

## 3. Pins are strict

`--port <n>` (backend, existing), `--client-port <n>`, and
`--bootstrap-port <n>` pin one owner each. A pin is a contract:

- The listener binds **that exact port on the supervised loopback host** or
  the run refuses. No fallback, no adoption, no termination of the holder.
- Refusal is `SNAPBACK_DEV_PORT_UNAVAILABLE` with `{ owner, host, port,
  holder: { pid, command } | null, recovery }`; the holder is named through
  the same `lsof` enumeration the supervisor already uses, and is `null`
  when it cannot be named. The backend keeps its receipt-verified
  `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` path (LLP 0223) unchanged; the
  new code covers supervisor-owned listeners and the pre-spawn check.
- Pins must be distinct from each other and, when a range is also given,
  may lie inside or outside it; a pinned port is simply excluded from the
  scan. Duplicate pins, non-integer or out-of-range values, and a pin for an
  owner the active profile does not have are `SNAPBACK_CLI_ARGUMENT_INVALID`.
- `metro` has no pin flag. It is an internal upstream of `client` on web;
  callers who need it inside a range use `--port-range`.

## 4. Ranges

`--port-range <lo>-<hi>` replaces the default range for every **unpinned**
owner, including the backend: `snapback start` gains `--port-range` (mutually
exclusive with `--port`) and scans it ascending exactly as it scans the
default range today, so the backend lands inside the caller's range without a
probe-then-pin race. The supervisor scans the same range descending for its
owners (§2). Exhaustion refuses with `SNAPBACK_DEV_PORT_RANGE_EXHAUSTED`
carrying the range, the owner that could not be placed, and the observed
holders. A range must satisfy `1 ≤ lo ≤ hi ≤ 65535` and must be wide enough
for every unpinned owner in the profile; otherwise
`SNAPBACK_CLI_ARGUMENT_INVALID`.

Allocation for supervisor-owned listeners is **bind-at-allocation**, in
owner order: the `client` front and `bootstrap` servers are held from the
moment a port is chosen, and the `metro` child's port (the `client` port on
native, where Metro is the client) is held by a placeholder socket from
allocation until immediately before the child is spawned, so the backend's
ascending scan and any foreign process see every planned port as occupied.
The only probe-then-spawn window is that placeholder release, and it is
closed by the existing listener-inventory verification: a Metro that came up
elsewhere fails readiness rather than being adopted. Exhaustion is reported
for the first owner in allocation order that cannot be placed, with every
holder observed while scanning. The backend's own range exhaustion is
detected by the lifecycle owner before and after the child's scan and is
surfaced under the same `SNAPBACK_DEV_PORT_RANGE_EXHAUSTED` code; the Rust
server keeps its uncoded bind error and gains no new `SNAPBACK_*` literal.

## 5. Environment equivalents

For setups where flags cannot be edited (devcontainers, CI matrices, `npm run
dev` from a template), each flag has an environment equivalent read by the
CLI process:

| Flag | Environment |
| --- | --- |
| `--port` | `SNAPBACK_DEV_PORT` |
| `--client-port` | `SNAPBACK_DEV_CLIENT_PORT` |
| `--bootstrap-port` | `SNAPBACK_DEV_BOOTSTRAP_PORT` |
| `--port-range` | `SNAPBACK_DEV_PORT_RANGE` |

Precedence is **flag > environment > default**, per owner. Environment values
are validated exactly like flags, and a value for an owner the profile does
not have is refused, not ignored — a silently ignored pin is how a lane ends
up out of its allowed range without knowing. The readiness record names the
source of each port (§7) so the precedence that applied is visible.

Additional *admitted* client origins for a **supervised** run (a tunnel
host, a forwarded origin reached under another name) remain the
`SNAPBACK_DEV_AUTH_ORIGINS` environment **merge** that `snapback dev
--expo` performs — merged origins never drop the supervisor-injected exact
origins. LLP 0300 P2's *replace* rule is the plain/URL profile's
default-posture rule, not this paragraph; on that path loopback clients
are admitted without any declaration, and this Spec adds no flag.

## 6. Profiles

| Invocation | Owners | Port surface |
| --- | --- | --- |
| `snapback dev` (plain) | `backend` | `--port`, `--port-range` |
| `snapback dev --port N --external-client-origin O` | `backend` (client declared) | `--port`, `--port-range`; `--client-port`/`--bootstrap-port` refused |
| `snapback dev --client . --client-command vite` | `backend` (client launched but caller-configured) | same as plain |
| `snapback dev --expo --expo-platform ios\|android` | `backend`, `bootstrap`, `client` (= Metro) | all flags |
| `snapback dev --expo --expo-platform web` | `backend`, `bootstrap`, `client` (front), `metro` | all flags |

`--expo` with `--port` was already legal (LLP 0223 §Semantic contract item 2:
"port pinning and client posture are orthogonal"); this Spec completes that
orthogonality by letting the supervised client and bootstrap be pinned as
well. `--external-client-origin` with `--expo` stays refused: it declares a
client Snapback does not own, which is a different profile, not a port choice.

Android `adb reverse` rules and the emulator host-alias fallback carry the
planned ports unchanged; a pinned or ranged port is forwarded exactly like a
scanned one.

## 7. The plan is recorded, not just applied

The final readiness event, the `expo-supervisor.json` descriptor, and
`inspection()` carry a `portPlan`:

```json
{
  "portPlan": {
    "range": { "lo": 4287, "hi": 4387, "source": "default" },
    "owners": [
      { "owner": "backend",   "port": 4287, "source": "range",  "declaredBy": null },
      { "owner": "client",    "port": 48110, "source": "pinned", "declaredBy": "flag" },
      { "owner": "bootstrap", "port": 4386, "source": "range",  "declaredBy": null },
      { "owner": "metro",     "port": 4385, "source": "range",  "declaredBy": null }
    ]
  }
}
```

`portPlan` and its provenance are universal across profiles (the plain
profile carries only the `backend` owner). `source` is `pinned`, `range`,
or `attached`; `range.source` is `default`, `flag`, or `env`; `declaredBy`
is `flag`, `env`, or `null`. `attached` is the
backend owner's provenance when `--attach` (or automatic attach) adopts an
already-running, receipt-verified backend: its port was chosen by that
earlier run, not by this plan. Attach never widens a declared constraint —
when a range was declared by flag or environment and the adopted backend's
port lies outside it, the run refuses with
`SNAPBACK_DEV_ATTACH_PORT_OUT_OF_RANGE` rather than recording an out-of-range
port as planned; under the default range an attached backend at any loopback
port is admitted and recorded as `attached`. The plain profile's `ready`
event carries the same shape with only the `backend` owner. The
exact-origin application-ready receipt (`snapback.application-ready.v1`) —
embedding the admitted client origins, which contain the planned `client`
port — is the **supervised path's** contract and is receipt-verified across
attach. The plain/URL profile's receipt follows LLP 0300 P2's additive
versioned posture encoding; this Spec does not freeze that encoding.

The `--json` help/usage and `snapback dev --help` name every flag.

## 8. Non-goals and open author questions

- **Bootstrap on the backend.** Folding the rendezvous listener into the Rust
  server would remove one owner but changes the trust model (the supervisor
  mints the binding). Pinning is the flexible answer now; folding is a
  follow-up if a setup needs exactly two ports.
- **Loopback host selection** (`127.0.0.1` vs `[::1]`). The supervised host
  stays `127.0.0.1` with the IPv4-first Metro DNS order
  (issues/closed/20260805-expo-supervisor-metro-ipv6-loopback.md). A
  `--host` for IPv6-only hosts is a separate ruling.
- **OQ1 — closed by LLP 0300 P2** (2026-08-24): the plain/URL profile
  admits any literal loopback origin by default (not `*`); non-loopback
  and narrowing go through the explicit allowlist. The supervised path
  keeps exact-origin injection.
- **OQ2 — closed by LLP 0300 P1** (2026-08-24): a URL with a standing
  credential-free identity-discovery gate is the supported first-class dev
  source; LLP 0300 chose it over a receipt-verified raw-origin profile.

## 9. Acceptance

1. `snapback dev snapback --expo --expo-platform web --port 48100
   --client-port 48110 --bootstrap-port 48120` publishes readiness with
   `client` at `http://127.0.0.1:48110`, `bootstrap` at `:48120`, the backend
   at `:48100`, the application-ready receipt admitting
   `http://127.0.0.1:48110` (plus the `localhost`/`[::1]` aliases), and
   `portPlan` marking all three `pinned` / `flag`.
2. The same command with `:48110` held by another process refuses before
   Metro is spawned with `SNAPBACK_DEV_PORT_UNAVAILABLE` naming owner
   `client`, port 48110, and the holder's pid/command; the holder is
   untouched and no supervised child is left running.
3. `--port-range 48100-48199` with no pins places every owner inside the
   range, deterministically (`backend` 48100; `client` 48199; `bootstrap`
   48198; `metro` 48197), and a second concurrent run walks to the next free
   ports; a range of width less than the owner count refuses with
   `SNAPBACK_CLI_ARGUMENT_INVALID`; a fully occupied range refuses with
   `SNAPBACK_DEV_PORT_RANGE_EXHAUSTED`.
4. `SNAPBACK_DEV_CLIENT_PORT=48110` without the flag pins `client`
   (`declaredBy: "env"`); the flag wins when both are present.
5. With no flags and no environment, two consecutive supervised runs
   (`snapback dev snapback --expo --expo-platform web`) on a quiet host
   publish identical origins. (LLP 0300 P3 moves the template's `dev`
   script to the two-process plain profile; this acceptance binds to the
   explicit supervised invocation, not to the template script.)
6. `snapback dev snapback --port-range 48100-48199` (plain profile) binds
   the backend at 48100; `snapback start --port-range` refuses when combined
   with `--port`, and refuses malformed ranges.
7. `--client-port` or `--bootstrap-port` without `--expo` is
   `SNAPBACK_CLI_ARGUMENT_INVALID` naming the owners the profile has.
8. Diagnostics registry, guide manifest, and `packages/snapback-client/diagnostic-codes.d.mts`
   carry the two new codes; `guide/clients/react-expo.md` and the expo-chat
   start packet document pinning and ranges; LLP 0010, 0181, and 0223 carry
   amendment notes pointing here.

## Amendments to other documents

- **LLP 0010** — the canonical-range paragraph gains a note that supervised
  listeners follow the same range/pin posture (this Spec).
- **LLP 0181 §Web browser** — the Metro front and bootstrap ports are planned
  (§2–§4), not ephemeral.
- **LLP 0223 §Semantic contract item 1** — "the default posture stays
  tool-selected" is amended: the default is the stable deterministic range;
  pins are strict for every owner; item 2's "tool-selected port" becomes
  "plan-selected".
