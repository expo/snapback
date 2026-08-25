# A doctor-race lane removed a browser-journey publication gate

Status: open
Date: 2026-08-25
Systems: scripts, packages/snapback-cli
Related: issues/20260825-cold-install-doctor-races-auth-mode-transition.md,
  llp/0041-publication.md

## What was observed

The lane working `issues/20260825-cold-install-doctor-races-auth-mode-transition.md` has committed a
change to `scripts/snapback-publish-core.mjs` that removes two entries from the publication gate:

- `browserReadableBackendOriginAbsent` from `BROWSER_JOURNEY_CHECK_KEYS`
- `backend-origin` from `REQUIRED_BROWSER_FORBIDDEN_MARKER_KINDS`

and adds `browserDeclaredDevUrlMatchesReadyDescriptor` in their place.

Verified at the lane worktree: `browserReadableBackendOriginAbsent` now appears **zero times** across
`scripts/` and `crates/`. The `backend-origin` marker *kind* still exists in
`scripts/snapback-package-cold-install-lib.mjs:1061` and is exercised by
`scripts/snapback-package-cold-install.test.mjs`, so the marker machinery survives — but the
publish-core gate that **required** its absence does not.

## Why this is being recorded rather than left to the lane's review

Two properties combine badly:

1. This repo's publication posture (author ruling, LLP 0041) is to **publish to npm rapidly and
   often, whenever `main` carries meaningful surface changes**, and to treat landed-but-unpublished
   surface fixes as a liability. A weakened publication gate on `main` is therefore not dormant — it
   is close to shipping by design.
2. The removal is **incidental to the lane's stated scope**. The lane was dispatched to fix a doctor
   auth-mode startup race, not to revise which browser-readable secrets block a publish. Incidental
   changes to security gates are exactly the kind a scope-focused review can wave through.

The replacement key is not obviously equivalent: `browserDeclaredDevUrlMatchesReadyDescriptor` asserts
that a declared dev URL matches the ready descriptor, which is a *consistency* property.
`browserReadableBackendOriginAbsent` asserted that the backend origin is **not readable from the
browser**, which is a *confidentiality* property. A consistency check does not subsume a
confidentiality check.

## What has not been determined

Whether the removal is justified. It may well be — if the backend origin is legitimately
browser-visible, the old check was asserting something false and the fix is correct. That case needs
to be made explicitly rather than assumed from the fact that the suite goes green.

## Required before this lands

- The lane states, in its report, why each removed key is safe to remove, not merely that tests pass.
- Its review verifies that claim specifically, and treats "the check was failing" as a reason to
  investigate rather than a reason to delete.
- If the confidentiality property still matters, it is asserted somewhere — a property that no test
  names is not enforced.
