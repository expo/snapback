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

`resolve_profile` (`src/admin.rs:291`) derives the server profile from the
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
is not a repair and may fail closed. Verified against `src/admin.rs` and
LLP 0060 D1. Directions 2 (explicit exposure declaration) and 3 (narrowing
loopback default authority) remain open — this ticket stays open for them.
