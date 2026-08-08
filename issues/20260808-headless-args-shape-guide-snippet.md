# guide-gap: headless client query/liveQuery args nesting reads ambiguously

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 4
**Systems:** Guide, Headless client
**Date:** 2026-08-08
**Related:** Diary 0069 (run 5, 0.1.15)

`client.query(ref, { args: {...} })` requires nested args; the guide's
todo snippet reads as flat (`db.query(api.listTodos, { userId: ADA })`),
producing SNAPBACK_ARGUMENT_VALIDATION_FAILED and a source-reading detour
(run-5 skill lane; the m4 lanes hit the same). Fix the snippet(s) to the
nested form and state the rule in one line.
