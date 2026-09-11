# Snapback 2 React starter edit draft is lost when its message briefly leaves the list

**Status:** Open
**Priority:** P3
**Date:** 2026-09-11
**Systems:** Snapback 2 React chat starter editing (`Thread.tsx`, `EditMessage.tsx`)
**Related:** LLP 1018.008.005.000, [refused edit preservation](./closed/20260911-snapback2-starter-retain-refused-edit.md)

## Evidence and impact

`EditMessage` holds the attempted text, its base and any refusal note in component
state inside the message row. `Thread.tsx` keeps `ui.editing` while the view is
loading, partial or carries a reason, but the row itself unmounts whenever its message
is absent from `snapshot.items`, and the editor then returns showing the message body.

Suspected trigger, from source review only: after "Load older messages", a newly
arrived message slides the head page's `last 50` window, the next page's cursor no
longer matches, and the edited message is missing until the replacement page loads.
Any typed draft is lost at that point.

## Requested outcome and acceptance

- Keep the draft, base and note for `[account, messageId]` outside the row so a
  transient absence restores them; still discard them on an account change, or when a
  ready, complete view no longer contains the message.
- Reproduce first: load an older page, open an editor on a message near the page
  boundary, add a new message elsewhere, and check the editor's text.
