# Snapback 2 React starter should retain an editor and draft after refusal

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 React chat starter editing
**Related:** LLP 1018.008.006, LLP 1018.003.001

## Evidence and impact

At `b47337b26`, [Thread.onEdit](../snapback2/packages/snapback2/templates/chat/react/src/Thread.tsx)
reads text from `window.prompt`, invokes `edit.run`, and retains no editor state
for the attempted text. Rejection appears later in the thread header. Reopening
Edit starts with the rendered message body, not the refused attempt.

This is a source-confirmed missing draft lifecycle, not a new executed conflict
reproduction. The [copied Clique edit issue](./20260909-clique-refused-edit-leaves-edit-mode.md)
concerns another artifact that retains a draft but clears `editId`; its frozen
benchmark and fresh-copy acceptance remain owned by that ticket.

## Requested outcome and acceptance

- Use an accessible in-app editor that retains the target and attempted text
  after terminal refusal and explains the result.
- Acceptance as `queued` or `committed` may close that submission's editor;
  cancellation is explicit. Refusal must not silently reissue the operation.
- If the user changes the draft or target before settlement, an older result
  cannot erase or close the newer edit.
- A conflict can show current readable content while preserving the attempt.
  Account/authorization changes must not expose another account's draft or
  unreadable server content.
- Exercise queued, committed, refused, cancellation, and late-result behavior
  in the current starter; preserve outbox/item semantics and update its diary.

This is a React starter repair, not an Expo editing feature or a new generic
form/retry framework. Editor policy remains an application decision.
