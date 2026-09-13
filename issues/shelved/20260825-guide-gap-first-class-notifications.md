# Guide gap: first-class notification delivery remains unshipped

**Status:** Open
**Systems:** Guide, Notifications, Capability registry
**Date:** 2026-08-25
**Governing:** LLP 0045, LLP 0222
**Capability row:** `backend.notifications`

## Gap

Snapback ships the narrower local Expo push seam, but the first-class durable
email/SMS/push notification lifecycle in LLP 0045 remains design-only. The
capability registry must keep that distinction visible until durable intent,
provider delivery, retry, settlement, and target qualification ship.

## Acceptance

- the durable notification lifecycle has an implementation and target-specific
  qualification witness;
- the Guide teaches its delivery and failure semantics without weakening the
  narrower Expo push seam; and
- `backend.notifications` can point to a shipped page or be removed as a GAP.
