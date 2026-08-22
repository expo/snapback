# guide-gap: turn capability links into an app-level deep-link recipe

**Status:** Closed
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Capability links, Auth, Expo deep links, External API
**Date:** 2026-08-21
**Governing:** LLP 0204 D9.4; LLP 0150 capability-link bearer exception;
LLP 0061
**Evidence:** Messtimate published-0.1.24 diary
**Landing SHA:** TBD

## Problem

Snapback ships the local anonymous-set capability-link slice, including expiry,
revocation, argument templates, use counts, preview-crawler safety, and
approval-gated mutating links. The Guide's external-API page mentioned the
feature but did not show the application journey: how a signed-in issuer mints
a link, how a web/Expo recipient resolves and invokes it, how the UI represents
valid/expired/used/revoked states, and where the v1 anonymous-set ceiling ends.

Authors therefore hand-rolled token tables for invite, capture, share-to-view,
and account-claim flows even when a shipped capability link fit, or assumed the
more powerful granted-operation link design already shipped.

## Resolution

Added `guide/recipes/capability-links.md`, a local-target recipe covering the
shipped anonymous-set journey from mint and share through inert GET, explicit
invoke, use-count/replay, expiry, exact-session revocation, and terminal state.
Its CI-transcluded implementation handles Expo cold/warm links and web URLs,
rejects leaky URL shapes, keeps the recipient token in volatile closure state,
and never adopts it as session authority.

The recipe includes the invite/capture/share-to-view/upload-request/account-
claim decision table, the single-use versus multi-use/approval boundary, and
explicit nonclaims for hosted, granted-operation, identity, upload-custody,
and guest-session authority. `scripts/check-guide-capability-link-example.mjs`
provides executable acceptance for crawler-safe GET, explicit POST, replay and
use counts, expiry, revocation, strict Expo/web parsing, and secret-free public
state.

Retrieval-eval cases 73–77 route the exact diary vocabulary `invite link`,
`capture link`, `claim link`, `single-use token`, and `deep link grant` to the
recipe. The full Guide check and standalone retrieval probe pass under Volta
Node 24.18.0; `ref-check --verbose` passes.
