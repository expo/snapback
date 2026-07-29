# Guide gap: assets and notifications need capability-index rows

**Status:** Resolved
**Area:** Guide, Capability index, Assets, Notifications
**Found by:** LLP 0102 Partiful/Snapback deep-round arm
**Date:** 2026-07-28
**Governing:** LLP 0044, LLP 0045, LLP 0061, LLP 0102

## Problem

The frozen generated capability manifest reports `assetUpload: false`,
`notifications: false`, and explicit `assets`/`notifications` gaps. The
Guide's capability index promises to list the complete authoring surface,
including explicit GAP rows, but contains neither capability.

A builder therefore has to inspect generated artifacts, repository examples,
or draft LLPs to learn that Snapback does not ship authenticated asset
upload/delivery/deletion or a first-class notification delivery product.
Partiful's asset scenario became a product GAP, and its complete performance
scenario consequently could not run.

## Suggested resolution

- Add owned, dated GAP rows for authenticated assets and notifications/effect
  delivery.
- Link the governing draft LLPs and state the current non-goal clearly.
- Tell builders not to relabel application table bytes or an app-authored
  effect ledger as shipped product capabilities.

## Evidence

- `demos/backend-bakeoff/arms/partiful/snapback/work/snapback/generated/capability.manifest.json`
- `demos/backend-bakeoff/arms/partiful/snapback/evidence/acceptance-results.json`
- `diaries/0030-partiful-backend-bakeoff.diary.md`

## Acceptance

- `guide/capabilities.md` contains explicit assets and notifications rows with
  maturity, owner, review date, authorities, and an honest page/GAP pointer;
- Guide search for “asset upload” and “notification delivery” reaches those
  rows; and
- the rows are covered by the existing Guide checker.

## Resolution

Resolved 2026-07-29 by `f7cdf4940`. The capability index now has explicit,
owned design-only GAP rows for authenticated asset bytes and notification
delivery. Each row names its nonclaim and governing LLP; the Guide checker
passes.
