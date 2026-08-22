# Asset width prework and TUS HEAD/inspect lazy expiry remain unfenced after the asset migration

Status: Open
Created: 2026-08-21
Related: issues/20260821-authorized-effect-remedy-classification.md,
issues/20260821-durable-authority-to-effect-handoff-design.md,
issues/20260821-nonsql-durability-census.md

Found by codex and grok reviewing the asset split-phase migration. The six migrated sites are
correctly fenced; these are writes the migration did not cover.

## 1. Width materialization runs before reservation (codex, High)

The signed-URL and strict-delivery routes materialize a missing ladder width BEFORE reserving
authority (`crates/snapback-server/src/server/asset_routes.rs:455` and `:609`; reservation happens
at `:469` / `:627`).

For a missing ladder width that prework commits a publication plan, performs the blob PUT, marks
it staged, and commits blob/rendition/quota state
(`crates/snapback-engine/src/local/engine.rs:13387`, `:14066`).

Interleaving: middleware prepares authority; logout commits; the stale handler enters width
preparation, whose policy probe uses only the resolved principal; the missing rendition is durably
materialized; the later reservation sees the retired session and returns 401. **The client gets no
URL and no bytes, but the durable rendition and quota effect remain.**

The blob PUT belongs to the withholding class and needs the durable authority-to-effect handoff.
The SQLite blob/rendition/quota commit, however, is ordinarily fenceable and currently is not.

## 2. TUS HEAD / attempt-inspect lazy expiry is unfenced (grok)

`asset_attempt_for_caller` performs lazy expiry as a durable write and is not fenced
(`crates/snapback-engine/src/local/engine.rs:12873-12880`, `:11907-11914`). PATCH and cancel now
fence exactly this lazy-expiry write; HEAD and inspect do not.

These are leftover members of the same write the migration fenced elsewhere, so the inconsistency
is the finding — one caller of a write is fenced and another is not.

Also unfenced and outside the migration's list: finalize, and the on-demand width SQLite+blob
commits from item 1.

## Why these did not block the migration

Each is strictly better than the pre-migration state and none regresses anything. The migration's
subject was corrected to claim only the SQLite state and receipt commits it actually fences, so
the gap is recorded rather than implied.

## Fix

Item 2 is a straightforward extension of the landed pattern: fence the lazy-expiry write at its
remaining callers, so one write is not fenced on some paths and unfenced on others.

Item 1 splits: fence the SQLite blob/rendition/quota commit; route the blob PUT through the
withholding rule rather than a fence. Prefer reserving before width prework if the route can be
reordered without holding authority across the PUT.
