# docs: diary numeric identities collide under concurrent authoring

**Status:** Resolved
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Demo diaries, documentation identity, inventory checks
**Date:** 2026-08-08
**Related:** LLP 0016, LLP 0061, LLP 0117, LLP 0118

## Summary

The repository instruction says new demo diaries use the next available
numeric prefix, but the corpus currently has duplicate prefixes for 11 IDs:

`0022`, `0042`, `0043`, `0044`, `0045`, `0046`, `0047`, `0048`, `0054`,
`0058`, and `0065`.

This is understandable on a continuously moving `main`: two sessions can both
observe the same next number before either lands. It still breaks the premise
that “Diary NNNN” is a stable, unambiguous reference. LLPs and issues already
use that shorthand, and there is no creation-time allocator or inventory gate
to prevent another collision.

Blindly renaming historical files is risky because prose, receipts, and LLPs
may already cite their filenames or numeric identities.

## Ask

Define a concurrency-safe diary identity policy and add a corpus check. Preserve
existing references through an explicit collision map/alias or a reviewed
reference migration; then block new collisions. A helper may reserve the next
identity at creation time, but it must work with concurrent branches rather
than assuming `main` stays quiet.

## Acceptance

- Every existing collision has an explicit canonical disposition without
  silently breaking historical links.
- New diary creation has one documented helper or protocol that is safe under
  concurrent work.
- An inventory check rejects a newly introduced duplicate identity.
- “Diary NNNN” resolves unambiguously in generated indexes and future prose, or
  the convention is changed so authors no longer rely on a bare numeric ID.


## Status (2026-08-08 docs-review execution)

Guard landed (124ecd39a): scripts/check-diary-identity.mjs verifies the
collision set — the ticket's claimed 11 prefixes confirmed exactly, each
baselined with its file pair, so KNOWN and NEW collisions are
distinguishable; `--strict` exits nonzero only on NEW collisions or a
stale baseline, and the header documents the concurrency-safe numbering
recipe (fetch origin, number above the union of local and origin trees,
land promptly). Remains: the canonical disposition for the existing 11
(rename vs alias) is an author call; recommended wiring is `--strict` in
the scheduled drift backstop so a new collision files a ticket.

## Author ruling — 2026-08-10

**Alias, don't rename.** The baselined collision map in
`scripts/check-diary-identity.mjs` is the canonical disposition for the 11
historical duplicates; existing filenames and citations stay untouched. Bare
"Diary NNNN" is authoritative only for non-colliding IDs; the 11 colliding
IDs require a qualified reference (number + slug). Wire `--strict` into the
scheduled drift backstop so a NEW collision files a ticket automatically.

## Resolution — 2026-08-10

Implemented the author ruling without renaming any historical diary or
rewriting any existing citation. `KNOWN_COLLISIONS` remains the canonical
alias map for the 11 historical duplicate numbers, and both the checker header
and `AGENTS.md` now tell authors that those numbers require number-plus-slug
references while bare `Diary NNNN` remains authoritative only for
non-colliding IDs.

The canonical local proof now includes `diary-identity`, whose command is
`node scripts/check-diary-identity.mjs --strict`. The existing LLP 0175
`driftProneGates` registry owns the wiring: changes below `diaries/` or to the
checker select the gate, and the complete scheduled backstop runs the
registered gate and files its normal idempotent filesystem ticket on a NEW
collision. No new scheduling mechanism or launchd state was added.

Verification on the unchanged historical corpus reported all 11 collisions as
KNOWN and zero as NEW in both default and strict modes. A disposable-clone
integration fixture introduced a synthetic NEW collision, observed the
backstop file `issues/20260810-main-drift-diary-identity.md`, and observed the
second run reuse that open ticket instead of filing a duplicate.
