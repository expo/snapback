# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin expo-chat digest=sha256:d0993a54174d8546a473ceed0a4b766f1455fb4835618814b90dc49d810afd6a -->
This packet is the whole required first read for this app (LLP 0259
Rung A). Open the edit targets below and work; open one further Guide page
only via `snapback guide <query>` or on a trigger — the brief is outside
this packet, a structured `SNAPBACK_*` refusal, or a failed `prove`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (supervises the Expo client; it never
launches a device or simulator — Expo Go, a dev client, or
`expo run:ios|android` is your job) → `bun run prove`.

`bun run prove` (`npm run prove` is equivalent) is the acceptance command:
it runs the registered live profile through `snapback verify` and writes
the receipt to `.snapback/verify-receipt.json`. Done = green receipt.
Carrier kits: `npm run carry:headless`, `npm run carry:web-browser`,
`npm run carry:native-simulator` (owns simulator boot, deep-link drive, and
screenshots); `npm run carry:self-check` validates without a server. If you
launch Metro yourself, do not inherit `CI=1` — a truthy `CI` disables file
watching and serves a stale bundle; prefer `bun run dev`.

## Edit targets (work files — listed, not charged to the first read)

- `snapback/schema.mjs` — sessions mode with guest auth
  (`defineAuth` + `{ auth: { mode: 'sessions' } }`), tables for users,
  conversations, memberships, messages, reactions; ephemeral `typing`.
- `snapback/functions.mjs` — inbox and thread live queries, `sendText` /
  `sendReply` / `react` mutations, and the bound `send` command.
- `snapback/seed.json` — seeded demo personas and conversations.
- `App.tsx` — boot: `SnapbackExpoProvider` with the generated `app`
  descriptor; `registerExpoFileSystemRqsFiles` at the root gives retained
  offline rendering on native (web uses the browser persistence arm).
- `src/screens/inbox-screen.tsx` / `src/screens/chat-screen.tsx` — the
  consumers: `useSnapbackQuery` for inbox rows; one `useSurface` handle
  drives the thread (live reads, replies, reactions, typing presence,
  image upload) from `@expo/snapback-expo`.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.

## Posture

- **Auth: sessions mode, guest-first.** The supervised dev loop mints its
  session automatically; that is what makes authenticated sends and in-app
  image upload (typed `assetRef` delivery) work out of the box.
- **Security caveat — client-supplied `senderId` is a demo convenience,
  never a boundary.** The seeded **TEST PERSONA** control passes the active
  persona's id as `senderId`/`userId` so demos work. In a real app, derive
  the sender from the adopted session on the server (`ctx.auth.userId`),
  drop the argument, and keep personas display-only.

## Safety traps (reconciled at landing)

1. Declare each function's `auth` explicitly in sessions mode: omitting it
   gets legacy `optional-user` widening plus the
   `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` advisory.
2. Inline args objects churn `useSnapbackQuery` — the subscription keys on
   args identity; hoist or memoize.
3. Structured stored fields (`v.array(...)`, `v.object({...})`) are typed
   but opaque (experimental): interiors are not queryable, and a nested
   `v.principal()` is a snapshot, not membership.
4. A changed seed identity never silently resets data: expect
   `SNAPBACK_SEED_MIGRATION_REQUIRED`, then migrate or reset-install.
5. Every `SNAPBACK_*` refusal names its rule and fix: read it, then run
   `snapback guide <CODE>` for the exact entry.

## Escalate

`snapback guide <query>` returns exact symbols, diagnostic codes, and page
anchors — budgeted lookups do not count as extra pages. The
[capability index](/_snapback/guide/capabilities.md) is the completeness registry: look
up, do not linear-read. Deeper pages, only when triggered:
[react-expo clients](/_snapback/guide/clients/react-expo.md),
[surfaces](/_snapback/guide/clients/surfaces.md),
[sessions and principals](/_snapback/guide/auth/sessions-and-principals.md),
[assets](/_snapback/guide/backend/assets.md),
[ephemeral state](/_snapback/guide/realtime/ephemeral-state.md).

<!-- llp0259:stop-fence -->
**Stop signs.** Familiar `query()` / `useQuery` (the TypeScript `schema.ts`
profile) and tiny-data `db.*` are experimental, non-default surfaces — not
this template's path. Writing either without an explicit brief means you
left the golden path.
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds
typed control tools with local admin authority. Preview setup with
`snapback agent setup --print <client> --server mcp-control`. With the dev
server running this packet is served at
`http://127.0.0.1:4287/_snapback/guide/start/expo-chat.md` (replace the
origin if startup selected another port); `snapback guide <query>` is the
budgeted lookup channel.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); it repeats this packet-first contract.
