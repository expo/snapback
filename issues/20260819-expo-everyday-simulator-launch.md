# Add an everyday supervised Expo simulator command

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Expo, CLI, Templates, Developer experience
**Date:** 2026-08-19
**Governing:** LLP 0181 E1, LLP 0196 T4, LLP 0294 W2

## Problem

`snapback dev --expo` supervises the backend, Metro, bootstrap exchange, and
binding but deliberately does not launch Expo Go or a development client. The
native carrier kit can boot a shut-down simulator, approve/deep-link the
scheme, capture online/offline screenshots, and clean up, but it is a bounded
proof director rather than the ordinary edit loop.

Users and their agents therefore reconstruct the common development task:
start the supervisor, discover Metro's port, boot/select a simulator, and open
the right deep link. The presence of `carry:native-simulator` does not make
that a good day-to-day workflow.

## Required change

- Add one ordinary command that selects or accepts an exact iOS simulator,
  starts the supervised backend/Metro path, launches the installed Expo Go or
  declared development client, and stays attached for edits.
- Derive the selected Metro URL from structured supervisor state.
- Refuse ambiguous multi-device selection and name installation/development-
  client prerequisites precisely.
- Keep this lifecycle separate from `carry:native-simulator`; it does not own
  screenshots, offline relaunch, or proof authority.
- Decide whether the primary spelling is a CLI launch flag, a scaffold script
  such as `dev:ios`, or both projections over one implementation.

## Acceptance

- From a fresh packed Expo scaffold, one documented command opens a selected
  iOS simulator into application-ready UI without manual port lookup or deep
  linking.
- Backend edits regenerate/reload while the same supervised session remains
  usable.
- Exact simulator selection, already-booted and shut-down states, missing Expo
  Go/development client, port collision, child exit, Ctrl-C, and cleanup have
  bounded tests and stable diagnostics.
- The command makes no carrier-receipt or product-completeness claim.
