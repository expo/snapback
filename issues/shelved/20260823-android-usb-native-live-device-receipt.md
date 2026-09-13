# Retain the Android USB native live-device receipt

**Status:** Open — scheduled by author ruling 2026-08-23
**Opened:** 2026-08-23
**Systems:** React/Expo, Android USB, Acceptance evidence, Developer experience
**Governing:** LLP 0181 E1; LLP 0064; LLP 0168 author addendum
**Source:** `issues/closed/20260811-ios-physical-device-dev-carrier-decision-packet.md`

## Scope

Run the shipped Android `adb reverse` physical-device path using the existing
`demos/expo-golden-path-fixture/receipts/physical-device-online-checklist.md`.
Retain a dated native-app receipt with device/OS/build identity, exact forward
rules, binding and backend identity, Metro manifest/reload behavior, live-query
and mutation results, cleanup/reclamation, and any device-only failure.

This ticket proves only the Android USB carrier already represented by LLP
0181. It does not claim iOS support, authorize a LAN/tunnel/private-overlay
front, or open LLP 0168's successor-RFC gate.

## Exit

The receipt satisfies LLP 0064 provenance requirements, the targeted Expo
acceptance checks pass, all three reverse rules and owned processes are removed
after the run, and LLP 0181's “live receipt pending” status is reconciled to
the retained result without widening platform claims.
