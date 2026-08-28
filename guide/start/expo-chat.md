---
title: Start packet — expo-chat
id: start.expo-chat
order: 4
audience: agent-first
capabilities: []
authorities: [llp/0114-first-class-react-and-query-groups.spec.md, llp/0259-agent-first-read-budget.rfc.md, llp/0297-client-canonicalization-budgets.research.md, llp/0299-supervised-listener-port-plan.spec.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-client/canonical-client-value.mjs, packages/snapback-codegen/index.mjs, packages/snapback-cli/templates/expo-chat/snapback/schema.mjs, packages/snapback-cli/templates/expo-chat/App.tsx, packages/snapback-cli/templates/expo-chat/acceptance.mjs]
examples: [packages/snapback-cli/templates/expo-chat]
status: current
targets: [all]
maturity: shipped
authoring-profiles: [explicit]
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:4de6650a9f7ede77da2b4358d03106d9ddc0680eb613c7a0d190116f8df1c2cd
---

# Start packet: the `expo-chat` template

<!-- start-packet:begin expo-chat -->
First read (LLP 0259 Rung A): use edit targets. Brief, `SNAPBACK_*` refusal,
or failed `prove` → open one `snapback guide <query>` result.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (backend + `.env.local`) plus
`bun run dev:client` separately → `bun run prove`.
`dev:supervised` is optional; it never launches a device or simulator — use
Expo Go, a dev client, or `expo run:ios|android`.

**Metro's inner port escaped 4287–4387:** use one `--port-range <lo>-<hi>`
that contains every owned listener, shared by Explicit and Familiar backends.

**Supervised Expo web wants stdin detached or the owner dies on pipe EOF:**
stdin EOF now closes only the optional command channel and leaves the
supervisor and its children live; launchers may use `/dev/null`.

Android emulator: set `androidEmulatorUrl` (`10.0.2.2`) as
`EXPO_PUBLIC_SNAPBACK_URL`, restart Metro, keep its managed-block line
commented. Remove stale client/bootstrap port variables; plain dev refuses
them with `SNAPBACK_CLI_ARGUMENT_INVALID`.

Proof: read `node_modules/@expo/snapback-acceptance/README.md`.

<!-- script-glossary:begin -->
## Script glossary

`prove`: done-oracle; writes the aggregate `snapback verify` receipt. `npm
test`: raw acceptance debug. `test:static`: no-server coherence. `carry:*`:
post-`prove` observations; `carry:self-check`: wiring only. Removed `test:live`
→ `npm test`.
<!-- script-glossary:end -->

Carrier owns simulator/screenshots. Do not pass `CI=1` to
Metro; it disables watching.

## Edit targets (listed, not charged)

- Backend: `snapback/{schema.mjs,functions.mjs,seed.json}` — auth, tables,
  queries/mutations/commands, ephemeral `typing`, and seeded personas.
- Client: `App.tsx`, `src/screens/{inbox-screen,chat-screen}.tsx` — provider,
  auth entry, inbox, thread, replies, reactions, typing, and upload.
- Proof: `acceptance.mjs`, `snapback.verify.config.mjs`.

`snapback/generated/` is codegen-owned: regenerate and commit
`generated/artifacts.json`; never hand-edit. The `_generated/` spelling is a
refused alias.

## Posture

- **Auth: sessions, guest-first, password, Apple/Google.** Web starts sessionless;
  native auto-adopts; `adoptSupervisedSession` reverses either default. After
  `signUpWithPassword` / `signInWithPassword`, do not call an
  authenticated mutation in the same tick. Wait until the provider's
  authenticated dispatcher exists. Do not mount a profile editor that can save
  until `getMine` (or equivalent) has a row. Keep `HANDLE_TAKEN` / refuse UI
  outside a tree that unmounts on auth change.
- **Custody: `volatile-explicit`.** Native restart is anonymous.
  `durable-required` needs an admitted platform. Node `memory` refuses
  `durable-required` custody with `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`.
  See the [`expo-web` + `fake-indexeddb` acceptance helper — Recover when durable auth custody is unavailable](../testing/acceptance.md#recover-when-durable-auth-custody-is-unavailable).
- **Security:** **TEST PERSONA** `senderId`/`userId` is not a boundary. Real apps
  derive the sender from `ctx.auth.userId`; personas are display-only.

## Safety traps (reconciled at landing)

1. In sessions mode, declare each function's `auth`; omission gets legacy
   `optional-user` plus `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT`.
2. Inline args objects churn `useSnapbackQuery` — the subscription keys on
   args identity; hoist or memoize.
3. `app.api.queries`: 4,096-node `CanonicalClientValueV1` ceiling.
   `snapback generate` warns; Expo boot can refuse with
   `SNAPBACK_REACT_ARGS_INVALID`. Do not export unused table queries; replace
   `*Before` variants with an optional `before` argument.
4. Structured fields are opaque: interiors are not queryable and a
   nested principal is a snapshot, not membership. Base64/data-URI media is row data under the
   32 KiB value ceiling; use generated asset/media upload. See
   [Structured stored values](../getting-started/your-first-backend.md#structured-stored-values).
5. Changed seed identity refuses with `SNAPBACK_SEED_MIGRATION_REQUIRED`;
   migrate or reset-install.
6. A `SNAPBACK_*` refusal names its rule/fix; `snapback guide <CODE>` routes it.

## Escalate

`snapback guide <query>` finds symbols, codes, and anchors; the
[capability index](../capabilities.md) is lookup-only. Trigger pages:
[clients](../clients/react-expo.md), [surfaces](../clients/surfaces.md),
[auth](../auth/sessions-and-principals.md), [assets](../backend/assets.md),
[ephemeral state](../realtime/ephemeral-state.md).

> **If you searched for a “short, product-shaped path from that chat to the canonical social schema”:** see
> [From the chat template to a social product](./index.md#from-the-chat-template-to-a-social-product).

<!-- llp0259:stop-fence -->
**Stop sign.** Familiar `query()` / `useQuery` is experimental and outside
this template. If selected, read the
[Familiar handler dialect](../backend/familiar-profile.md).
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->
