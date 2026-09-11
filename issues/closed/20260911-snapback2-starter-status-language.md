# Snapback 2 starter status language should explain the user's data and actions

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-11
**Systems:** Snapback 2 React/Expo starter query, connection and mutation status copy
**Related:** LLP 1018.008.006, LLP 1018.003, LLP 1018.003.001

## Evidence and impact

At `b47337b26`, both search screens say "Indexed results", "Partial indexed
results", and "Indexed result limit reached". React Home reports "log
downloaded". Composers use "Sync now" and may show internal refusal rewrites.
The default experience asks a chat user to understand implementation details.

Sources: [React Search](../../snapback2/packages/snapback2/templates/chat/react/src/Search.tsx),
[Expo Search](../../snapback2/packages/snapback2/templates/chat/expo/src/screens/Search.tsx),
[React Home](../../snapback2/packages/snapback2/templates/chat/react/src/App.tsx), and
[snapshot summaries](../../snapback2/packages/snapback2/src/snapshot.ts).
This is a source-based product-copy assessment, not a usability study.

## Requested outcome and acceptance

- Explain available messages, downloaded history, saved changes, waiting, and
  the person's next action. "Searching downloaded messages" can describe a
  held search; "Checking for updates" requires actual work underway.
- Preserve stale, partial, predicted, denied, empty, and confirmed distinctions.
  Never turn an unknown count into zero or a missing offline cursor into proof
  of complete server coverage.
- Match recovery wording to the action. Sign-in, connection recovery, stopped
  replay, and another-tab requirements remain distinct.
- Keep codes, source facts, and diagnostics inspectable without making default
  product copy reproduce compiler rewrites or internal operation names.
- Align React/Expo meaning and accessible status announcements. Introduce no
  new status machine or blanket hide-cached-data policy; update the diary.

The [search ticket](./20260911-snapback2-starter-search-continuation.md) owns the
missing control; the [recovery ticket](./20260911-snapback2-starter-recovery-and-dismissal.md)
owns duplicated lifecycle decisions. Coordinate the affected UI changes.

## Resolution — 2026-09-11

Search describes matching/downloaded messages, stale matches and results needing refresh. Recovery/send advice remains product-owned; structured refusals are inspected through Details. Generic edit/removal failures describe an unconfirmed outcome, while conflict explanations retain the current value. React and Expo rendered controls preserve stale/partial/predicted distinctions and original diagnostic details.

Implemented with the four-plan commission in LLP 1018.008 §13–14. Integrated verification and source-review evidence are recorded there.
