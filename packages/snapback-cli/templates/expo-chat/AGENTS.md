# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin expo-chat digest=sha256:a982797682da292c16a2027c24016c359352321d597f52bdacb83616e9e614df -->
This is the first read (LLP 0259 Rung A). Use edit targets; open one page
only for a brief, `SNAPBACK_*` refusal, or failed `prove`, via
`snapback guide <query>`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (backend + `.env.local`) plus
`bun run dev:client` separately → `bun run prove`.
`dev:supervised` is optional; it never launches a device or simulator — use
Expo Go, a dev client, or `expo run:ios|android`.

Android emulator: set printed `androidEmulatorUrl` (`10.0.2.2`) as
`EXPO_PUBLIC_SNAPBACK_URL`, restart Metro, leave its managed block
commented. Remove stale `SNAPBACK_DEV_CLIENT_PORT` /
`SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses both with
`SNAPBACK_CLI_ARGUMENT_INVALID`.

Before proof edits, read `node_modules/@expo/snapback-acceptance/README.md`.

<!-- script-glossary:begin -->
## Script glossary

`prove`: only done-oracle; writes the aggregate `snapback verify` receipt.
`npm test`: raw acceptance debug. `test:static`: no-server
coherence. `carry:headless`, `carry:web-browser`, `carry:native-simulator`:
observations after `prove`; `carry:self-check`: wiring only. Removed
`test:live` → `npm test`.
<!-- script-glossary:end -->

The native carrier owns simulator boot, drive, and screenshots; self-started
Metro must not inherit `CI=1`, which disables watching.

## Edit targets (listed, not charged)

- `snapback/schema.mjs` — sessions auth; user/conversation/membership/message/
  reaction tables; ephemeral `typing`.
- `snapback/functions.mjs` — inbox and thread live queries, `sendText` /
  `sendReply` / `react` mutations, and the bound `send` command.
- `snapback/seed.json` — seeded demo personas and conversations.
- `App.tsx` — generated `app` → `SnapbackExpoProvider`; retained files; password
  and provider entry via `useSnapbackCurrentPrincipal` / `useSnapbackAuth`.
- `src/screens/inbox-screen.tsx` / `src/screens/chat-screen.tsx` — the
  `useSnapbackQuery` inbox and `useSurface` thread (replies, reactions,
  typing, upload) from `@expo/snapback-expo`.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.
The `_generated/` spelling is a refused alias, not a compatibility alias; use
only `generated/`.

## Posture

- **Auth: sessions, guest-first, password, Apple/Google.** From anonymous `ready`, use
  the same `useSnapbackAuth()` owner for `enterAsGuest()` or password entry
  before sends/uploads. Recovery codes appear once. Web starts sessionless;
  native auto-adopts. `adoptSupervisedSession` opts web in/native out.
  After `signUpWithPassword` / `signInWithPassword`, do not call an
  authenticated mutation in the same tick. Wait until the provider's
  authenticated dispatcher exists. Do not mount a profile editor that can save
  until `getMine` (or equivalent) has a row. Keep `HANDLE_TAKEN` / refuse UI
  outside a tree that unmounts on auth change.
- **Custody: `volatile-explicit`.** Native restarts return anonymous. Use
  `durable-required` only on an admitted platform. Node `memory` refuses
  `durable-required` custody with
  `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`; see existing
  [`expo-web` + `fake-indexeddb` acceptance helper](/_snapback/guide/testing/acceptance.md#recover-when-durable-auth-custody-is-unavailable)
  under “Recover when durable auth custody is unavailable.”
- **Security:** **TEST PERSONA** `senderId`/`userId` is not a boundary. Real apps
  derive the sender from `ctx.auth.userId`; personas are display-only.

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
5. Every `SNAPBACK_*` refusal names its rule and fix; use
   `snapback guide <CODE>` for its entry.

## Escalate

`snapback guide <query>` finds symbols, codes, and anchors. The
[capability index](/_snapback/guide/capabilities.md) is a lookup, not a first read. On trigger:
[react-expo clients](/_snapback/guide/clients/react-expo.md),
[surfaces](/_snapback/guide/clients/surfaces.md),
[sessions and principals](/_snapback/guide/auth/sessions-and-principals.md),
[assets](/_snapback/guide/backend/assets.md),
[ephemeral state](/_snapback/guide/realtime/ephemeral-state.md).

<!-- llp0259:stop-fence -->
**Stop sign.** Familiar `query()` / `useQuery` is experimental and outside
this template. If selected, read the
[Familiar handler dialect](/_snapback/guide/backend/familiar-profile.md).
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
