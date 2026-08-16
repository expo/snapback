---
title: Start packets
id: start.index
order: 1
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:bd97fffef93eb1f0ec657dc31bc3f48b358897c55b65120859abd274d06ddbaa
---

# Start packets

The budgeted first read for building an app on Snapback (LLP 0259 Rung A):
read your template's packet — or the shared mental model plus its stub —
open the packet's named edit targets, and escalate one page at a time with
`snapback guide <query>`.

- [Snapback in one screen](./mental-model.md) — the shared mental model
  (about 3 KiB); the fallback when no template is selected.
- [react](./react.md) — full packet: Vite web starter,
  `useSnapbackQueries`.
- [expo-chat](./expo-chat.md) — full packet: Expo sessions-mode chat,
  `useSnapbackQuery` + `useSurface`.
- [crud-dashboard](./crud-dashboard.md) — stub: mental model first, then
  this template's proof command and edit targets.
- [media-feed](./media-feed.md) — stub: mental model first.
- [todo-contract](./todo-contract.md) — stub: mental model first.

Scaffolded apps carry their packet transcluded into `AGENTS.md` with a
digest comment — reading either copy counts once. The
[capability index](../capabilities.md) is the completeness registry with
explicit GAP rows: look terms up in it; do not linear-read it before the
first edit.
