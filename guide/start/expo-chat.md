---
title: Start packet — expo-chat
id: start.expo-chat
order: 4
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, llp/0299-supervised-listener-port-plan.spec.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-cli/templates/expo-chat/snapback/schema.mjs, packages/snapback-cli/templates/expo-chat/App.tsx, packages/snapback-cli/templates/expo-chat/acceptance.mjs]
examples: [packages/snapback-cli/templates/expo-chat]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:560723c3d50af032b129a79451faf7bf891f34dc3de8504df6f7f09a4a568a4f
---

# Start packet: the `expo-chat` template

<!-- start-packet:begin expo-chat -->
This is the whole first read (LLP 0259 Rung A). Work from the edit targets;
open one more page only for a brief, `SNAPBACK_*` refusal, or failed `prove`,
via `snapback guide <query>`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (backend + `.env.local`) and
`bun run dev:client` in a second terminal (`dev:supervised` = optional
one-command convenience; it never
launches a device or simulator — Expo Go, a dev client, or
`expo run:ios|android` is your job) → `bun run prove`.

Android emulator: paste printed `androidEmulatorUrl` (`10.0.2.2`) as
`EXPO_PUBLIC_SNAPBACK_URL`, then restart Metro; leave its managed-block line
commented. Remove leftover `SNAPBACK_DEV_CLIENT_PORT` /
`SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses them with
`SNAPBACK_CLI_ARGUMENT_INVALID`.

Before changing proof, read `node_modules/@expo/snapback-acceptance/README.md`.

<!-- script-glossary:begin -->
## Script glossary

`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`
receipt. `npm test`: raw acceptance debug path. `test:static`: no-server
coherence. `carry:headless`, `carry:web-browser`, `carry:native-simulator`:
observations after `prove`; `carry:self-check`: wiring only. Removed
`test:live` → `npm test`.
<!-- script-glossary:end -->

The native carrier owns simulator boot, drive, and screenshots. Self-started
Metro must not inherit `CI=1` (it disables watching).

## Edit targets (work files — listed, not charged to the first read)

- `snapback/schema.mjs` — sessions auth; user/conversation/membership/message/
  reaction tables; ephemeral `typing`.
- `snapback/functions.mjs` — inbox and thread live queries, `sendText` /
  `sendReply` / `react` mutations, and the bound `send` command.
- `snapback/seed.json` — seeded demo personas and conversations.
- `App.tsx` — generated `app` → `SnapbackExpoProvider`; native retained files;
  password entry via `useSnapbackCurrentPrincipal` / `useSnapbackAuth`.
- `src/screens/inbox-screen.tsx` / `src/screens/chat-screen.tsx` — the
  `useSnapbackQuery` inbox and `useSurface` thread (replies, reactions,
  typing, upload) from `@expo/snapback-expo`.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.
The `_generated/` spelling is a refused alias; use only `generated/`.

## Posture

- **Auth: sessions mode, guest-first plus ordinary password entry.** The
  app reaches anonymous `ready`; call `auth.enterAsGuest()` on the same
  `useSnapbackAuth()` owner before sends or image upload, or use ordinary
  password entry. Recovery codes surface once after signup or guest claim.
  URL-first dev mints no ambient session; multi-browser proofs sign up or sign
  in separately in each context instead of adopting the supervised mint.
- **Custody: `volatile-explicit`.** Node `memory` refuses `durable-required`
  custody with `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`; see existing
  [`expo-web` + `fake-indexeddb` acceptance helper](../testing/acceptance.md#recover-when-durable-auth-custody-is-unavailable)
  under “Recover when durable auth custody is unavailable.”
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

`snapback guide <query>` returns exact symbols, codes, and anchors. Use the
[capability index](../capabilities.md) as a lookup, not a first read. On trigger:
[react-expo clients](../clients/react-expo.md),
[surfaces](../clients/surfaces.md),
[sessions and principals](../auth/sessions-and-principals.md),
[assets](../backend/assets.md),
[ephemeral state](../realtime/ephemeral-state.md).

<!-- llp0259:stop-fence -->
**Stop sign.** Familiar `query()` / `useQuery` is experimental, non-default,
and outside this template. If a brief selects it, read the
[Familiar handler dialect](../backend/familiar-profile.md) before editing.
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->
