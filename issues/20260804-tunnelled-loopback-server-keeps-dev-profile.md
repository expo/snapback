# A tunnelled loopback server keeps the bind-derived `dev` profile

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Server, Auth mode, Security, Developer experience
**Date:** 2026-08-04
**Governing:** LLP 0060, LLP 0031
**Related:** `llp/0168-browser-carrier-dev-edge.research.md`,
`llp/reviews/0168-browser-carrier-dev-edge.claude.md`

## Problem

This is about the server **as it ships today** — not about the unbuilt dev edge
researched in LLP 0168.

`resolve_profile` (`crates/snapback/src/admin.rs:291`) derives the server profile from the
server's **own bind address**: with `SNAPBACK_PROFILE` unset it resolves `dev`
on loopback and `prod` on a real interface. That fail-closed default is correct
for a direct bind.

It does not survive a front. A developer who runs

```sh
ngrok http 4420          # or cloudflared, or `tailscale serve`
```

against an ordinary loopback-bound Snapback dev server gets a **publicly
reachable** server that is still in the bind-derived `dev` profile, because the
server sees only its loopback listener. Dev auth is client-asserted, and the
source comment on the profile ladder describes the loopback default as granting
"the destructive/provisioning capability."

Nothing in the current server can detect this. LLP 0060 §D1 already states the
limit directly — a loopback server behind a public reverse proxy still appears
loopback, and the plaintext-listener fence proves nothing about that proxy or
about public reachability. This ticket is that stated limit meeting a
commonplace developer action.

## Why it is filed separately from LLP 0168

LLP 0168's round-1 review found this parked as a *precondition for a successor
RFC*. That is the wrong owner: gating it behind an RFC that the same document
recommends not opening leaves a live exposure with no tracked resolution. The
exposure exists whether or not the dev edge is ever built.

## Scope of the claim

- **Confirmed by source and by LLP 0060's own statement of the limit.**
- **Not** reproduced end to end with a live tunnel in this session; no receipt
  is retained. Someone should confirm the concrete `ngrok http 4420` case before
  a fix is designed, in case an unrelated guard intervenes.

## Candidate directions

1. **Documentation first, immediately.** Wherever tunnelling a dev server is
   suggested, state that it is unsupported. Note carefully that "set
   `SNAPBACK_PROFILE` explicitly" is **not** a fix — explicit `dev`, `demo`,
   and `test` all permit provisioning, and only `prod` fails closed, at the
   cost of functionality that may then refuse. Selecting a profile does not
   approve public exposure.
2. **An explicit exposure declaration.** A flag or env var by which the operator
   states "this server is fronted," moving the profile off the bind-derived
   default. Requires deciding what the server does when the declaration is
   absent but a front exists — which it cannot detect.
3. **Narrow the loopback default's authority.** Separate "may serve app data
   under client-asserted identity" from "may perform destructive/provisioning
   operations," so the tunnel case loses the dangerous half even undeclared.

Direction 3 is the only one that does not depend on operator diligence, and is
correspondingly the largest change. Direction 1 should land regardless.

## Dated note — 2026-08-10 (direction 1 landed)

`guide/auth/targets.md` now states: a tunnelled loopback server
(ngrok/Cloudflare Tunnel/Tailscale Funnel/SSH) stays bind-derived
development; public exposure this way is unsupported; `SNAPBACK_PROFILE=prod`
is not a repair and may fail closed. Verified against `crates/snapback/src/admin.rs` and
LLP 0060 D1. Directions 2 (explicit exposure declaration) and 3 (narrowing
loopback default authority) remain open — this ticket stays open for them.

## Dated note — 2026-08-15 (directions 2/3 ruled: RFC commissioned)

Author ruling 2026-08-15: pursue direction 3 via a focused RFC, with
direction 2 folded in as declared-exposure vocabulary rather than a
free-standing flag. **LLP 0262** (`llp/0262-dev-identity-custody-capability.rfc.md`,
Draft) is now the owner of record for both directions; this ticket stays open
until the enforce stage lands.

The commissioning survey sharpened the exposure claim, verified against
source at `80aa7b8a5`:

- Destructive/provisioning is already custody-gated over HTTP: served
  instances always resolve/mint the `0600` admin token (ENG-23443,
  `resolve_serve_admin_token`) and `evaluate_access` requires it for all
  writes; the tokenless-loopback write branch is embedded-router-only. The
  original "destructive/provisioning capability via the loopback default"
  fear is therefore mostly fenced already.
- The live residual through a front is (a) app-data read/write under
  client-asserted dev identity, and (b) tokenless admin reads via
  `evaluate_access`'s loopback read arm.
- The custody primitive the RFC generalizes already ships five times
  (admin token, impersonation/agent-destroy/rehearsal capabilities,
  secret-read proof) on `secure_file`/`owner_only_file`.

## Dated note — 2026-08-25 (stage 2 expanded; enforce remains gated)

LLP 0262's D1–D6 implementation state is now audited in the RFC. Stage 2 names
the committed enforcement flip `2026-08-25/LLP-0262-stage-3` in the
once-per-boot missing-capability warning, and bare-loopback admin reads now
warn once per server boot, including the real claim-exchange redemption path.
`SNAPBACK_EXPOSURE=fronted` with no explicit profile has a server-level
production-refusal witness; explicit non-production profiles retain their
truth-table behavior and warning.

The machine-exercisable D2 carrier witnesses now cover CLI verbs, `_kit` /
headless, managed Vite, external/attach Vite in a real browser, raw
sidecar/header clients, Expo web in real Chrome, iOS simulator, and Android
emulator. Current retained summaries are
`demos/expo-native-checkout-reader/receipts/web-2026-08-25T14-49-42-653Z/run-summary.json`,
`demos/expo-native-checkout-reader/receipts/ios-2026-08-25T15-06-51-734Z/run-summary.json`,
and
`demos/expo-native-checkout-reader/receipts/android-2026-08-25T14-54-18-163Z/run-summary.json`.
The native receipts report `passed` for checkout plus ordinary-session
composition, rotation replacement, replay and post-rotation refusal,
browser-Origin refusal, and tunneled bootstrap isolation. The web receipt
reports `passed` for ordinary-session query admission with no native custody,
direct browser transport refusal, and generic host-side refusal.

Exactly one supported D2 row still lacks an acceptance witness and therefore
keeps D5 stage 3 closed:

1. Android physical USB over the selected serial's `adb reverse` carrier.

Physical iOS and Android LAN/TCP remain intentionally unsupported, not silent
carrier gaps. The stage-3 enforcement arm did not change; this ticket remains
open until the outstanding USB witness lands and the author-gated flip is made.

## Dated note — 2026-08-25 (native D2 evidence correction)

Stage 3 is blocked by exactly three missing D2 witnesses: **iOS simulator —
NOT YET**, pending a strengthened rerun; **Android emulator — NOT YET**, pending
a strengthened rerun; and **physical Android USB — NOT YET**. The retained
`ios-2026-08-25T15-06-51-734Z` and
`android-2026-08-25T14-54-18-163Z` native receipts predate the fail-sensitive,
server-observed checks and must not be treated as D2 evidence. The strengthened
Expo-web evidence is `web-2026-08-25T16-03-15-778Z`.

This note supersedes the earlier claim above that the simulator and emulator
were witnessed and that only physical USB blocked stage 3. No native witness
was rerun as part of this correction.
