# LLP 0301: URL-first dev lifecycle — server, CLI, and wire contract

**Type:** Spec
**Status:** Review
**Systems:** Server, CLI, Local server lifecycle, Auth, Templates, Guide,
Diagnostics
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (standing
overnight directive 2026-08-24: RFC → refine → Specs → refine →
implementation)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (b — Draft → Review at llp-super-refine loop start;
authorization: the author's standing overnight directive)
**Revised:** 2026-08-24 (a — initial draft)
**Related:** LLP 0300 (Accepted — the governing RFC), LLP 0299, LLP 0302
(the client-side sibling), LLP 0010, LLP 0181, LLP 0223

## Summary

The server/CLI half of LLP 0300: the identity-discovery wire contract, the
path-split origin-admission implementation, the receipt posture field, URL
printing and the opt-in `.env.local` writer, the explicit dev-session
command, and the two-process template flip. The client half (the
`declared-dev` binding source and the standing discovery gate) is LLP 0302;
this Spec owns everything the client calls.

## 1. The identity fact

- **Route:** `GET /_snapback/api/app/identity` (unauthenticated; no other
  method). Served by development-profile servers only; a Prod-profile
  server refuses with `404` and the typed body code
  `SNAPBACK_APP_IDENTITY_UNAVAILABLE` (production clients never discover —
  release bindings are pre-admitted, LLP 0300 P1).
- **Shape** (`formatVersion: "snapback.app-identity.v1"`), and nothing
  more — LLP 0300 rules the fact identity-and-posture-only:

  ```json
  {
    "formatVersion": "snapback.app-identity.v1",
    "deployment": { "…": "the active DeploymentIdentity, exactly as the readiness fact carries it" },
    "admissionPosture": "loopback-any" | "explicit-list",
    "startupNonce": "<the running server's startup nonce>"
  }
  ```

  No receipts, tokens, ports, lease or reaper state, or foreign-listener
  facts. `startupNonce` is already client-visible via the bootstrap
  exchange and gives LLP 0302 its restart signal.
- CORS on this route follows the same admission as the rest of the dev
  surface (§2) — the fact is readable by any admitted origin, and the
  fetch itself is the one call LLP 0302 exempts from the gate.

## 2. Origin admission — the path split, implemented

Admission is decided by one server-side input,
`SNAPBACK_DEV_ADMISSION_POSTURE`, set only by the lifecycle owner
(`runDev`), never documented for hand use:

- **Plain/URL profile:** `runDev` sets `loopback-any` when no explicit
  origins are declared. The server's existing origin check
  (`dev_body_origin_refused` seam) admits any **literal** loopback origin:
  scheme `http`/`https`, hostname exactly `localhost`, `127.0.0.1`, or
  `[::1]` (case-insensitive, brackets canonicalized), any port. No DNS
  resolution is ever performed on the Origin header (rebinding names stay
  refused). The existing `canonical_loopback_http_origin` normalizer is
  the single matcher.
- **Explicit list replaces:** when the operator declares origins —
  `SNAPBACK_DEV_AUTH_ORIGINS` and/or `--external-client-origin` — `runDev`
  passes posture `explicit-list` and the **union of the declarations** as
  the complete allowlist. Flag-only `--external-client-origin` is the
  singleton complete allowlist (replace, not union-with-default) — the
  same semantics as a tunnel-only environment list. The flag keeps its
  `--port` requirement and its `--expo` refusal.
- **Supervised `--expo` profile: unchanged.** The supervisor injects exact
  planned origins; caller `SNAPBACK_DEV_AUTH_ORIGINS` **merges** and never
  drops injected origins (`expoBackendDevAuthEnvironment` today); the
  server receives the merged exact list with posture `explicit-list`.
- An unrecognized posture value fails closed to `explicit-list` semantics
  with whatever list accompanies it, and emits
  `SNAPBACK_DEV_ADMISSION_POSTURE_INVALID` as a structured startup
  diagnostic (refusal, not adoption of `loopback-any`).

## 3. Receipt posture (additive, versioned)

`snapback.application-ready.v1` gains one optional field,
`admissionPosture: "loopback-any" | "explicit-list"`:

- Supervised runs keep writing exact `clientOrigins` and now also write
  `admissionPosture: "explicit-list"`. Byte-level assertions in existing
  batteries are updated to tolerate the additive field; semantics are
  unchanged.
- Plain runs write `admissionPosture: "loopback-any"` and `clientOrigins`
  as the explicit declarations only (empty when none).
- **Reader rule (reader-before-writer):** a missing field means
  `explicit-list` (every pre-existing receipt). Readers ship before
  writers within one publication; an old CLI reading a new receipt sees an
  unknown optional field and, per the receipt verifier's existing
  unknown-field posture, must tolerate it — the Spec's acceptance includes
  the four old/new CLI×receipt attach combinations from LLP 0300 P2.

## 4. `snapback dev` prints the URL; the opt-in writer

- On every `ready`/attach/rebind of a plain-profile backend, the CLI
  prints, as both human line and `--json` event field:
  `SNAPBACK_URL=http://127.0.0.1:<port>` and
  `androidEmulatorUrl=http://10.0.2.2:<port>`.
- `--write-env [path]` (default `./.env.local`, opt-in only — templates
  may opt in via their `dev` script): writes/refreshes
  `EXPO_PUBLIC_SNAPBACK_URL`, `VITE_SNAPBACK_URL`, and `SNAPBACK_URL` to
  the backend origin. The writer manages **only the block between its
  marker comments**, never clobbers other keys, refreshes after every
  ready/attach/rebind that changes the origin, and prints the
  bundler-must-restart caveat when it rewrites while a bundler could be
  running. It never writes any credential (LLP 0300 P4). The target file
  must be gitignored or the writer warns.
- `snapback dev --expo` continues to print its supervised readiness; the
  URL-printing surface is additive there (the backend origin line prints
  in both profiles).

## 5. `snapback auth dev-session`

Explicit replacement for the ambient mint on the canonical path:

- `snapback auth dev-session [--ready-file <path>] [--email <address>]
  [--json]` mints an ordinary dev session against the running backend
  using the existing supervised-mint machinery (ready-file descriptor +
  managed admin token), prints the bearer and expiry to **stdout only**
  (never a file), and exits.
- Refusals (typed): no ready file / no running backend
  (`SNAPBACK_DEV_SESSION_TARGET_MISSING`); backend not in a mode that can
  mint (reuse the existing supervised-mint refusal codes).
- Plain `snapback dev` prints the instruction naming this command; it
  never runs it. `--expo` issuance is unchanged (LLP 0300 P4).

## 6. Templates go two-process

For `expo-chat`, `react`, and `crud-dashboard`:

- `"dev"`: `snapback dev snapback --write-env` (backend only, opt-in
  writer on — the template's `.env.local` is gitignored by the scaffold
  already).
- `"dev:client"`: the bundler (`expo start` / `vite`).
- `"dev:supervised"` (expo-chat only): the previous
  `snapback dev snapback --expo --expo-platform web`, kept as the
  documented convenience.
- Start packets and READMEs teach the two-terminal shape first and the
  supervised path as the appendix; the client one-liner comes from LLP
  0302's template contract. `media-feed` follows expo-chat.
- Migration text (guide + start packets) names the leftover-environment
  footgun: `SNAPBACK_DEV_CLIENT_PORT`/`SNAPBACK_DEV_BOOTSTRAP_PORT` in the
  environment fail the plain profile with `SNAPBACK_CLI_ARGUMENT_INVALID`
  (LLP 0299 §5).

## 7. Diagnostics

New codes: `SNAPBACK_APP_IDENTITY_UNAVAILABLE`,
`SNAPBACK_DEV_ADMISSION_POSTURE_INVALID`,
`SNAPBACK_DEV_SESSION_TARGET_MISSING`. All server-emitted codes are Rust
literals and must be classified per the s5_d10 table; the JS-side writer
and CLI reuse existing codes wherever a fitting one exists.

## 8. Acceptance (server/CLI half of LLP 0300's battery)

1. Identity fact: dev server serves the v1 shape unauthenticated; Prod
   refuses typed; the fact carries exactly the four fields.
2. Admission: loopback-any admits `localhost`/`127.0.0.1`/`[::1]` on any
   port and refuses a rebinding hostname; tunnel-only explicit list
   refuses loopback unless restated; flag-only equals singleton list;
   supervised merge never drops injected origins (existing battery).
3. Receipt: the four CLI×receipt attach combinations; supervised battery
   green with the additive field.
4. Writer: refresh-on-rebind, no-clobber, marker-block ownership, no
   credential bytes, warn-on-unignored.
5. dev-session: mints against a running plain backend; typed refusal with
   none; nothing written to disk.
6. Hostile-origin signup boundary (LLP 0300 acceptance 9, server side):
   with loopback-any, a second-origin signup succeeds as a new principal;
   with an explicit list excluding it, even signup is refused.
7. Template cold bring-up (LLP 0300 acceptance 1): two terminals, one env
   var, logged-out boot, ordinary signup — driven per template.

## 9. Out of scope

The client gate, source arms, and per-bundler exclusion (LLP 0302); signed
discovery (deferred obligation, ticket to be filed at implementation);
guide/docs beyond the migration and template texts named here.
