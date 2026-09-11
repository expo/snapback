# Snapback 2 React starter should retain an editor and draft after refusal

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 React chat starter editing
**Related:** LLP 1018.008.006, LLP 1018.003.001

## Evidence and impact

At `b47337b26`, [Thread.onEdit](../../snapback2/packages/snapback2/templates/chat/react/src/Thread.tsx)
reads text from `window.prompt`, invokes `edit.run`, and retains no editor state
for the attempted text. Rejection appears later in the thread header. Reopening
Edit starts with the rendered message body, not the refused attempt.

This is a source-confirmed missing draft lifecycle, not a new executed conflict
reproduction. The [copied Clique edit issue](../20260909-clique-refused-edit-leaves-edit-mode.md)
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

## Resolution — 2026-09-11

**Status:** Closed. `window.prompt` is replaced by an in-thread form,
`react/src/EditMessage.tsx`, on the page-resource Thread. It starts from the rendered
message, keeps the target and attempted text after a terminal refusal ("Could not
confirm edit. Your edit is still here; open details for the next step.", with the
structured refusal under Edit details), closes when the edit is committed or queued,
and otherwise closes only on Cancel. A refusal is never resubmitted. A result applies
only to the text it answers: once newer text is typed, an older committed or refused
result neither closes nor replaces it, and an accepted older attempt becomes the base
the newer text edits, so saving it does not conflict with the person's own change. A
conflict names the current readable message ("Edit not sent. Current message: … Save
again to replace it."), keeps the attempt and rebases onto the current text; an
unreadable row cannot be saved. One editor is open at a time. The editor is released
only when a ready, complete view no longer contains its message; a partial or loading
view does not release it, although the draft itself lives in the message row and is
[not yet kept](../20260911-snapback2-starter-edit-draft-across-page-shifts.md) if the
message briefly leaves the list. Changing account or conversation discards the editor
and draft.

Evidence (`chat-screens-refusal.test.ts`): a refused edit keeps its text after one
request, shows its details and closes on Cancel; a committed edit closes; a delayed
committed result for older text (awaited through the client's own mutation promise)
leaves newer text open and that text then saves; a delayed refusal for older text
leaves newer text open with no alert; other messages' Edit is disabled while an editor
is open; an offline edit queues and closes; a message removed elsewhere releases its
editor; an open editor keeps its draft through an offline and reconnect cycle; an
owner-side conflict shows the current text and saving again replaces it; after
switching accounts and back, the earlier editor and draft are gone. Expo editing was
out of scope.
