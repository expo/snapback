# guide-gap: period-scoped message and digest recipes

**Status:** Resolved
**Opened:** 2026-09-09
**Resolved:** 2026-09-09
**Systems:** Snapback 2 Guide, Quarry expiry, effects, schedules
**Related:** LLP 1016 D5; LLP 1018.007.004

## Gap

The guide documented timers, effects and jobs separately but did not show how
to carry a configured disappearing-message deadline through lexical branches,
share one bounded preview between storage and emission, or distinguish new
period unread activity from standing unread totals. Repairing the copied
Clique app required learning those combinations from compiler experiments.

## Resolution

The expiry card now teaches explicit deadline precedence and one helper across
text, media, and poll sends. The effects card teaches a shared 80-scalar preview. The
schedule card now routes period digests through current bounded selection,
membership-incarnation period custody with scoped author/recipient access,
owner-only maintained counts and pruning, atomic unique record/log/effect
admission, replay mode, and an all-zero quiet-period skip. It records the need
to suppress replay activity at source admission rather than relying on a later
sweep guard when replay mode can change inside the same period, while keeping
the current relationship mirror accurate. It also records the
create/delete/update obligation when an explicit compact counter replaces an
over-budget declarative maintain, and prevents a bounded read from claiming
later unread rows cleared. Executable expiry/preview and digest fixtures retain
the recipes; test-only inspection separately proves the private row rule.
Period schedules expose their logical start/end as typed binding fields, so
one cutoff survives late firing, chunk continuation and restart. Digest and
prune are ordered chunks of that one cutoff-bound job instead of independently
scheduled sweeps that can cross a bucket boundary or overtake each other. No
provider request is part of their proof.
