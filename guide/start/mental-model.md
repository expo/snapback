---
title: Snapback in one screen
id: start.mental-model
order: 2
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

# Snapback in one screen

The shared mental model for building an app on Snapback. If the app came
from `snapback new`, read the template's [start packet](./index.md) instead
— it names the exact files and proof command; this page is the fallback
when no template is selected.

- **You write three files.** `snapback/schema.mjs`
  (`defineSchema`/`defineTable`/`v.*`, chainable `.index(...)` and
  `.sync()`), `snapback/functions.mjs` (named queries, live queries, and
  mutation plans), and `snapback/seed.json`. Codegen owns everything under
  `snapback/generated/`: regenerate, commit `generated/artifacts.json`,
  never hand-edit outputs.
- **The server is the security boundary.** Scope inside the function
  (`eq('ownerId', authUserId())`), never with a client-supplied owner
  argument.
- **A live query is a named, generated subscription.** Clients bind the
  generated reference; there is no ad-hoc query language on the wire.
- **Presence is ephemeral.** Typing indicators and cursors ride ephemeral
  state, not tables.
- **Sessions mode is for users and uploads.** `{ auth: { mode: 'sessions' } }`
  in the schema; app-side uploads require it, and each function's `auth`
  should then be declared explicitly.
- **The loop.** Edit → `bun run generate` → `bun run dev` →
  `bun run prove`. A green verify receipt is "done"; anything else is a
  claim.
- **When something refuses,** read the `SNAPBACK_*` code, then run
  `snapback guide <CODE>` for the exact rule and fix.

## Escalate one page at a time

1. Start from the template packet (or this page) and open the packet's
   named edit-target files to work.
2. One unresolved design question → `snapback guide <query>`; open exactly
   the page it names.
3. A further page only on a trigger: the brief is outside the packet, a
   structured `SNAPBACK_*` refusal, or a failed `prove`.

Budgeted `snapback guide` lookups never count as extra pages. The
[capability index](../capabilities.md) is the completeness registry with
explicit GAP rows: grep it or look terms up before assuming a feature is
missing — do not linear-read it.

<!-- llp0259:stop-fence -->
**Stop signs.** Familiar `query()` / `useQuery` (the TypeScript `schema.ts`
profile) and tiny-data `db.*` are experimental, non-default surfaces. If
you are writing either without an explicit brief, return to the generated
references and the `useSnapback*` hooks.
<!-- /llp0259:stop-fence -->
