# guide-gap: turn capability links into an app-level deep-link recipe

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Capability links, Auth, Expo deep links, External API
**Date:** 2026-08-21
**Governing:** LLP 0204 D9.4; LLP 0150 capability-link bearer exception;
LLP 0061
**Evidence:** Messtimate published-0.1.24 diary

## Problem

Snapback ships the local anonymous-set capability-link slice, including expiry,
revocation, argument templates, use counts, preview-crawler safety, and
approval-gated mutating links. The Guide's external-API page mentions the
feature but does not show the application journey: how a signed-in issuer mints
a link, how a web/Expo recipient resolves and invokes it, how the UI represents
valid/expired/used/revoked states, and where the v1 anonymous-set ceiling ends.

Authors therefore hand-roll token tables for invite, capture, share-to-view,
and account-claim flows even when a shipped capability link fits, or assume the
more powerful granted-operation link design already ships.

## Required change

- Add one executable recipe for mint -> share -> inert GET -> explicit invoke
  -> terminal/revoked state using the shipped anonymous-set slice.
- Include Expo Linking and web URL parsing without treating the URL token as a
  session or copying it into durable app storage, logs, analytics, or referrers.
- Explain single-use versus multi-use/approval behavior and exact target/local
  maturity.
- Provide a decision table for invite, capture, share-to-view, upload request,
  and account claim: shipped capability link, app-owned token row, or unshipped
  granted-operation/identity flow.
- Add retrieval cases for `invite link`, `capture link`, `claim link`,
  `single-use token`, and `deep link grant`.

## Acceptance

- A cold agent implements one Expo/web share-to-view flow from Guide material
  without reading server source or inventing a token table.
- The recipe proves expiry, replay/use count, revocation, crawler-safe GET, and
  no token leakage.
- The page never presents anonymous-set links as granted-operation or guest
  session authority.

