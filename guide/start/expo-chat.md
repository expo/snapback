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
This is the whole first read (LLP 0259 Rung A). Use edit targets; open one page
only for a brief, `SNAPBACK_*` refusal, or failed `prove`, via
`snapback guide <query>`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (backend + `.env.local`) plus
`bun run dev:client` in another terminal → `bun run prove`.
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

`prove`: done-oracle; writes the aggregate `snapback verify` receipt.
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
  entry via `useSnapbackCurrentPrincipal` / `useSnapbackAuth`.
- `src/screens/inbox-screen.tsx` / `src/screens/chat-screen.tsx` — the
  `useSnapbackQuery` inbox and `useSurface` thread (replies, reactions,
  typing, upload) from `@expo/snapback-expo`.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.
The `_generated/` spelling is a refused alias, not a compatibility alias; use
only `generated/`.

## Posture

- **Auth: sessions mode, guest-first plus password entry.** The app reaches
  anonymous `ready`; call `auth.enterAsGuest()` on the same `useSnapbackAuth()`
  owner before sends/uploads, or enter a password. Recovery codes appear once
  after signup or guest claim.
  URL-first dev mints no ambient session; multi-browser proofs sign up or sign
  in separately in each context instead of adopting the supervised mint.
- **Custody: `volatile-explicit`.** This disposable template deliberately says
  memory custody, so a native process restart returns anonymous and must enter
  again. It does not silently weaken a durable policy; select
  `durable-required` only for a platform tuple admitted by the native custody
  capability row. Node `memory` refuses `durable-required` custody with
  `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`; see existing
  [`expo-web` + `fake-indexeddb` acceptance helper](../testing/acceptance.md#recover-when-durable-auth-custody-is-unavailable)
  under “Recover when durable auth custody is unavailable.”
- **Security caveat — client-supplied `senderId` is only a demo convenience.**
  The **TEST PERSONA** control passes its id as `senderId`/`userId`. In real
  apps, derive the sender server-side from `ctx.auth.userId`, drop the
  argument, and keep personas display-only.

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
[capability index](../capabilities.md) is a lookup, not a first read. On trigger:
[react-expo clients](../clients/react-expo.md),
[surfaces](../clients/surfaces.md),
[sessions and principals](../auth/sessions-and-principals.md),
[assets](../backend/assets.md),
[ephemeral state](../realtime/ephemeral-state.md).

<!-- llp0259:stop-fence -->
**Stop sign.** Familiar `query()` / `useQuery` is experimental and outside
this template. If selected, read the
[Familiar handler dialect](../backend/familiar-profile.md).
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->
