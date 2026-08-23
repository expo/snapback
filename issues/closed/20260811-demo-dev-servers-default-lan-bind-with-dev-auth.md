# Two demo dev-servers default to a LAN-wide bind with insecure dev auth

**Status:** Closed
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Demos, Local server lifecycle, Auth, Security, Developer experience
**Date:** 2026-08-11
**Governing:** LLP 0060 (D1 dev-auth override), LLP 0181, LLP 0168
**Related:** `issues/closed/20260811-ios-physical-device-dev-carrier-decision-packet.md`
(and its `.packet.md`), `issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`
**Found while:** Verifying the iOS carrier decision packet's evidence against
committed code

## Problem

Two committed demo launchers bind the Snapback server to `0.0.0.0` **by
default** while also passing `--allow-insecure-dev-auth` and pinning
`SNAPBACK_PROFILE=dev`:

- `demos/warble/scripts/dev-server.mjs:60` — `WARBLE_HOST ?? '0.0.0.0'`
- `demos/relay-room-bakeoff/snapback-expo/scripts/dev-server.mjs:42` —
  `RELAY_ROOM_BIND_HOST ?? '0.0.0.0'`

Dev auth trusts the caller's asserted identity. Combining it with a default
non-loopback bind means anyone on the same network can assert any identity to
that backend, and the developer gets that posture without opting in.

The profile pin is load-bearing, not incidental: Warble's own comment
(`dev-server.mjs:73-76`) records that a non-loopback bind with `SNAPBACK_PROFILE`
unset resolves to `prod`, and the prod profile refuses dev auth outright. The
launcher sets `dev` specifically to keep the override usable across a LAN bind.

## What is NOT the problem

This ticket is deliberately narrow. Three nearby things are fine and should not
be swept into a fix:

- **`demos/messaging-snapback/scripts/dev-server.mjs:30-31` is already correct**
  and is the model to copy. It is loopback-only by default and documents the
  opt-in: "Set `MESSAGING_HOST=0.0.0.0` to reach it from a phone on the LAN
  (same `--allow-insecure-dev-auth` trade-off Warble makes)."
- **`demos/competitive-checkpoint/acceptance/drill/entrypoint.sh:11`** binds
  `0.0.0.0` inside a container behind Fly's TLS-terminating edge and labels
  itself "drill posture, not a supported binding." That is deliberate and
  scoped.
- **Warble documents its reasoning thoroughly** (`dev-server.mjs:7`,
  `73-76`). Its default is the issue, not its honesty about it. Relay-room
  appears to be the copy that inherited the default without the reasoning.

## Root cause worth naming

This is a symptom of the gap the carrier decision packet is about: Snapback has
no supported physical-device development carrier, so demos that wanted a phone
on the LAN each improvised one, and the improvisation that spreads by
copy-paste is the least safe default. Fixing the default does not close the
carrier gap; it stops the gap from teaching a bad pattern in the meantime.

## Desired outcome

Make loopback-by-default with an explicit env opt-in the shared pattern across
demo dev-servers, matching `messaging-snapback`. When the opt-in is used, print
one line at startup naming the exposure and the identity trust it implies, so a
LAN bind is never silent.

## Acceptance

- `warble` and `relay-room-bakeoff` bind loopback by default; the existing env
  variables still select a wider bind.
- Choosing the wider bind emits one startup line naming the bind address and
  the dev-auth identity-trust consequence.
- `messaging-snapback`'s existing posture and the competitive-checkpoint drill
  are unchanged.
- Each demo's README/diary states that LAN phone delivery is an unsupported
  workaround, consistent with `demos/tiny-triumphs/README.md`.

## Non-goals

- Removing `--allow-insecure-dev-auth` or changing LLP 0060 D1.
- Changing profile inference — that is owned by
  `issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`, which stays
  open and is not duplicated here.
- Authorizing any carrier, relay, or public listener; that remains the decision
  packet's open question.

## Resolution

Resolved 2026-08-15:

- Warble and Relay Room now bind `127.0.0.1` by default, while `WARBLE_HOST`
  and `RELAY_ROOM_BIND_HOST` retain the explicit wider-bind escape hatch.
- Both launchers emit the same single warning line for a wider bind, naming the
  selected bind address and that anyone on the network can assert any identity
  under dev auth.
- Warble retains its unconditional `SNAPBACK_PROFILE` dev pin, preserving prior
  launcher behavior on loopback while keeping the non-loopback override usable.
- Messaging Snapback and the competitive-checkpoint drill are unchanged.
- Both READMEs and both LAN-phone-referencing diaries identify physical-iOS LAN
  delivery as an unsupported workaround and point to the still-open carrier
  decision.
- Both launchers pass `node --check`; the dry host-resolution/warning harness
  proves loopback defaults, working `0.0.0.0` overrides, and warnings only for
  wider binds. Both demo acceptance suites were run: Relay Room passes, while
  Warble's three retention checks pass and three offline-write checks remain
  red beginning at `SNAPBACK_CLIENT_REFUSED: fetch failed`. That acceptance
  test uses the shared server harness rather than the launcher changed here;
  full verbatim output is recorded in `report.md`.
