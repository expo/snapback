# Decide a supported iOS physical-device development carrier

**Status:** Open
**Impact:** 4
**Urgency:** 2
**Ease:** 1
**Confidence:** 4
**Systems:** React/Expo, Local server lifecycle, Developer experience, Security, Auth, Packaging
**Date:** 2026-08-11
**Governing:** LLP 0168, LLP 0181, LLP 0060
**Related:** `issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`,
`diaries/0058-relay-room-expo-backend-bakeoff.diary.md`,
`diaries/0059-tandem-expo-messaging-bakeoff.diary.md`,
`diaries/0075-tiny-triumphs.diary.md`

**Packet:** [`20260811-ios-physical-device-dev-carrier-decision-packet.packet.md`](./20260811-ios-physical-device-dev-carrier-decision-packet.packet.md)
— assembled 2026-08-11. Recommends topology (c), an already-hosted backend plus a
separately admitted development asset carrier, and holds the LLP 0168
successor-RFC gate closed (not-yet) on A3 grounds. Awaiting author go/no-go and
the six rulings in its §9.

## Problem

Tiny Triumphs needed two stable HTTPS exposures for an Expo Go phone: one for
Metro and one for the loopback Snapback backend. Tuft made that operationally
possible, but it is not a supported Snapback physical-device development
carrier. The diary records an Expo Go link prepared but not launched, so it is
demand evidence and setup evidence, not a live-device receipt.

This is now part of a repeated workflow family rather than a theoretical
matrix cell: the earlier messaging bakeoffs also prepared phone-reachable
Metro/backend paths and public-origin rewrites. At the same time, LLP 0181 is
explicit that the current supervised binding union has no iOS physical-device
development arm. Android USB has a representable `adb reverse` path; current
`devicectl` and `iproxy` cannot supply the inverse forwarding direction iOS
needs.

Directly tunnelling today's loopback server is not an acceptable shortcut.
The separate open tunnel ticket records that the server continues to infer the
`dev` profile from its own loopback bind even when a public front makes it
reachable. Two convenient URLs do not establish transport security, route
admission, or an authorized binding.

## Scope: decision packet only

This ticket does not authorize a relay, tunnel supervisor, public listener, or
new binding arm. It assembles the evidence and on-paper decisions required to
determine whether LLP 0168's successor-RFC gate can open for the native
Expo/Metro carrier.

The packet must produce:

1. **Demand and carrier statement.** Name the exact iOS workflow (Expo Go or a
   development client), required HMR/reload behavior, observed frequency, and
   why simulator, Android USB, a static HTTPS export, or an already hosted
   release target does not serve it. Reconcile LLP 0168 A1's current “remote
   browser HMR” wording with the native Metro carrier instead of silently
   claiming that wording already covers it.
2. **Auth-boundary answer.** Supply LLP 0168 A2: a falsifiable design that does
   not infer safe client-asserted identity from a loopback peer that may be a
   front. Reconcile the answer with the still-open explicit-exposure and
   narrowed-loopback-authority directions in the tunnel ticket.
3. **Hostname and certificate choice.** Supply LLP 0168 A3 for every claimed
   iOS carrier, including per-device trust/bootstrap cost, stability across
   host changes, and the treatment of Metro manifests, HMR WebSockets, source
   maps, and the Snapback origin.
4. **One topology recommendation.** Choose among a device-side bridge, a
   route-composing secure edge, an already-hosted backend plus a separately
   admitted development asset carrier, or a documented no-go. Do not carry a
   menu of incompatible security models into implementation.

## Outcomes

- **No-go or not-yet:** keep iOS physical-device local development an explicit
  nonclaim; recommend simulator, Android USB, or an admitted hosted/release
  target. Record what evidence would reopen the decision.
- **Gate satisfied:** amend LLP 0168 where its browser-specific A1 wording must
  cover the selected native carrier, then create and review one successor RFC.
  Only that RFC may authorize the time-boxed fenced spike and eventual LLP
  0181 E5 implementation.

## Acceptance

- The packet cites concrete diary evidence and distinguishes setup, successful
  launch, and retained live-device receipts.
- An author can answer go/no-go on one named carrier without making an
  implementation choice during review.
- The auth and hostname/certificate answers are independently falsifiable.
- The existing tunnel-profile exposure retains its own present-tense owner;
  this ticket does not duplicate or close it.
- Tiny Triumphs and other demos describe Tuft/tunnel phone delivery as an
  unsupported workaround until an accepted carrier and receipt exist.

## Non-goals

- Implementing or publishing a development edge in this ticket.
- Treating a QR code, stable DNS name, TLS tunnel, or loopback backend as an
  authorization proof by itself.
- Blocking the shipped simulator/emulator and Android USB paths.

## Ruling record — 2026-08-15

Author ruling (Charlie, 2026-08-15, recorded by orchestrating agent session):

- The packet's NOT-YET recommendation is **ACCEPTED**. iOS physical-device
  local development stays an explicit nonclaim, the LLP 0168 successor-RFC
  gate stays closed on A3 grounds, and topology (c) — an already-hosted
  backend plus a separately admitted development asset carrier — is adopted.
- **Packet §9 ruling 1: YES.** "Development bundle, hosted backend" becomes a
  representable binding; a small LLP 0181 amendment adding that binding arm is
  commissioned (size M).
- **Ruling 2:** resolved per the packet's own analysis — a client pointing at
  an already-admitted hosted target is outside the LLP 0168 gate.
- **Ruling 3:** the LLP 0168 A1 scoping edit is accepted.
- **Rulings 4, 5, and 6 remain OPEN** — F-A2-4 blast-radius measurement
  scheduling, Android USB live receipt scheduling, and the private-overlay
  carrier question are not resolved by this ruling.
- The due non-authorizing doc-posture fixes (react-expo carrier-table row,
  diary hedge, relay-room launcher note) may proceed.
