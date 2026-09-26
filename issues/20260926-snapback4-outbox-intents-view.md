# Snapback 4: an SDK view over the outbox's pending and refused intents

- **Opened:** 2026-09-26, from [LLP 3000.008.002.000](../llp/3000.008.002.000-common-client-patterns.rfc.md) §9 (revision 2).
- **Area:** `packages/snapback4/src/{contract,local,client,app-online,app-client,mock}.ts`, `react.tsx`.
- **Severity:** Medium (ergonomics and a correctness trap), not a defect.

## Why

Every composer that must show earlier sends after a reload keeps its own
intent journal: the calibration-21 builder wrote 105 lines (`src/Pending.ts`)
that labelled an unknown receipt "failed … not queued", and both starters keep
account-and-backend-scoped saved intents. The device outbox already holds each
admitted intent's id, operation, arguments and viewer (`local-types.ts`
`Queued`), but the client exposes no way to list it; receipts keep only
code/family, so a refused send's text is lost unless the app saved it.

## Proposal (Opus's direction check, F4)

A read-only view, e.g. `useIntents(op)` / `client.intents()` +
`onIntents(notify)`, per account and backend: pending entries until the
replica observes them (so a row or the intent is always visible), and refused
entries with their arguments until dismissed (session-scoped first). No new
queue, no retries, no change to `useMutation`'s latest-call `last`.

Open edges: the sent-but-not-yet-observed state, refused-argument retention
and its privacy, multi-tab outbox ownership, the online and `createApp` online
tiers. Grok and Astra advised against building it until composition is shown
insufficient.

## Decide

After the post-landing cold build of LLP 3000.008.002.000 §7: if the builder
still hand-rolls an intent journal with the corrected docs and starters, build it.
