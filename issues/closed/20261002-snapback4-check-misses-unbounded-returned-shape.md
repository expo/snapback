# Snapback 4: `check` accepts a returned shape that the read meter refuses at scale

**Opened:** 2026-10-02, from calibration #29 (snapback4 0.4.11), grader defect d-01 (major)
**Area:** `snapback4-lang` read-shape analysis, `snapback4 check`, guide `why/E_SHAPE_EXCEEDS_METER.md`
**Status:** Closed 2026-10-03 — landed as merge 04441ba8ae (lane UB): advisory `N_SHAPE_METER` in ordinary `check`; see LLP 3000.007 §24 and `snapback4 why N_SHAPE_METER`.

## What happened

A cold builder's inbox query computed each chat's unread count with a raw `count(messages where …)` inside its returned shape. `check` was silent. The query passed the 10% and 50% scale checkpoints, then the server refused it at 100,015 messages:

```
E_SHAPE_EXCEEDS_METER: the returned shape at programs.inbox.2 examines more than the 8,192-row meter on its own; bound it (`first N`/`last N`) or move it out of the returned shape
```

The builder then adopted the guide's row-keyed maintained count (`view unreadCounts: count messages by members m …`, read as `unreadCounts[.id]`), but only after the replay. The grader's scale curve therefore spans two source generations. The same final schema still uses a raw count in `fn unreadIn` (via `query unreadPreview`).

## Wanted

`check` should detect, at authoring time, a returned-shape aggregate or collection whose examined rows grow with data and have no static bound. It should name the site and point to the paved alternatives (maintained count or view, `first N`/`last N`, or moving the work out of the shape), with zero false refusals on bounded programs.
