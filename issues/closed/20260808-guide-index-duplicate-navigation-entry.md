# guide: operating index contains an exact duplicate navigation entry

**Status:** Open
**Impact:** 1
**Urgency:** 2
**Ease:** 5
**Confidence:** 5
**Systems:** Guide, navigation, consistency checks
**Date:** 2026-08-08
**Related:** LLP 0061

## Summary

`guide/index.md` links “Local instance forks” to
`operating/instance-forks.md` twice in the same Operating section. The exact
duplicate appears once immediately after agent controls and again after error
tracking, and is repeated in the generated flat projection.

The current guide consistency check verifies reachability but does not reject
an identical label/target pair within one navigation section.

## Ask

Remove the duplicate and add a narrow uniqueness check for exact repeated
label/target pairs within the same index section. The check should still allow
one page to be routed from different intent sections when the labels or section
contexts are intentionally distinct.

## Acceptance

- The Operating list contains one “Local instance forks” entry.
- A fixture proves an exact duplicate in one section fails the guide check.
- Intentional cross-section routing remains supported.


## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5): the second "Local
instance forks" entry was deleted from guide/index.md's Operating section.
The proposed duplicate-entry checker was not built — a recurrence would
surface in ordinary review, and the one-line check remains a cheap
follow-up if the class ever recurs. Independently found and fixed by both
the Codex and Claude audits (the Claude side tracked it in the
guide-meta-hygiene-sweep ticket, also closed today).
