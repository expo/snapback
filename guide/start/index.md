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
authoring-profiles: [explicit, familiar]
reviewed: 2026-08-29
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
<!-- llp0259:stop-fence -->
- [familiar-react](./familiar-react.md) — full packet: Familiar TypeScript
  backend plus `useQuery` / `useMutation` in Vite.
<!-- /llp0259:stop-fence -->
- [expo-chat](./expo-chat.md) — full packet: Expo sessions-mode chat,
  `useSnapbackQuery` + `useSurface`.
- [crud-dashboard](./crud-dashboard.md) — stub: mental model first, then
  this template's proof command and edit targets.
- [media-feed](./media-feed.md) — stub: mental model first.
- [todo-contract](./todo-contract.md) — stub: mental model first.

If you arrived after a **mistaken unscoped `snapback@0.1.29` lookup**, the
published CLI package is `@expo/snapback-cli`; `create-snapback-app` is the
`npm create snapback-app` wrapper. If the **published CLI rejected unknown `expo-router` template**,
or you **assumed legacy `expo-router` major 7 for Expo 57**, do not repair the tuple by registry archaeology: run the installed
CLI's `snapback new --help`, choose one of the six template names above, and
let the scaffold write the aligned `@expo/snapback-*`, Expo, Metro, React, and
React Native pins. Package discovery is profile-neutral; choose
`familiar-react` when the application should begin in the Familiar profile.

Scaffolded apps carry their packet transcluded into `AGENTS.md` with a
digest comment — reading either copy counts once. The
[capability index](../capabilities.md) is the completeness registry with
explicit GAP rows: look terms up in it; do not linear-read it before the
first edit.

## From the chat template to a social product

If you searched for a **short, product-shaped path from that chat to the canonical social schema**:
there is no maintained end-to-end relational-social recipe today. Take this journey instead — profiles →
[app identity](../auth/app-identity-binding.md), graph →
[relational queries](../backend/relational-queries.md), feeds →
[chunked membership feeds](../recipes/chunked-semijoin-feed.md), roles →
[scoped roles](../auth/scoped-roles.md), media →
[assets](../backend/assets.md), offline →
[retention and replay](../sync/offline-and-retention.md), aggregates and
schedules → [bounded queries](../backend/queries.md) plus
[cron](../backend/cron.md).

The `expo-chat` template is Explicit, and Familiar is not covered by this
template. For Familiar, start at the
[Familiar handler dialect](../backend/familiar-profile.md) and keep the same
normalized data and authority boundaries in Familiar source.
