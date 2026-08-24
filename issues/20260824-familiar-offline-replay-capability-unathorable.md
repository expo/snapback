# Familiar cannot author the advertised offline replay capability

**Status:** Open
**Opened:** 2026-08-24
**Systems:** Familiar TypeScript codegen, schema capabilities, app binding,
offline mutation replay
**Related:** LLP 0058; LLP 0201; LLP 0255;
`benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`

## Problem

Published Snapback 0.1.25 exposes `offline_mutation_replay` in generated target
capability facts and documents queue-aware client dispatch, but a Familiar
TypeScript application cannot require that capability at the schema boundary.

The Clique Familiar M7 lane observed this sequence:

1. A queue-aware poll vote refused safely with
   `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED` because the supervised
   binding did not offer `offline_mutation_replay`.
2. The generated target capability manifest listed
   `offline_mutation_replay` as experimental.
3. Adding `offline_mutation_replay` to the Familiar schema's
   `requiredCapabilities` failed codegen as an unknown required target
   capability.

The lane therefore could not admit the local SQLite settlement ledger through
the mandatory Familiar-only authoring profile and used an app-owned
localStorage set-state queue instead.

## Impact

Familiar applications cannot express the capability needed to use Snapback's
native durable offline mutation replay on a target that implements it. The
client refusal is correctly fail-closed, but the authoring/runtime capability
vocabularies disagree and push application authors into bespoke queue custody.

## Evidence

- Compact raw run:
  `/Users/ccheever/clique-published-0125-sol-high-20260823/lanes-m7/familiar/`
- Timeline and exact diagnostics: `run-log.md`, correction loops 2–3.
- Final outcome and workaround: `final-report.md`.
- Public pin: all consumed `@expo/snapback-*` packages were 0.1.25.

## Code pointers (verified 2026-08-24 on main `9a782983d`)

The split is visible inside one file, ~50 lines apart:

- The authorable vocabulary `TARGET_CAPABILITY_IDS`
  (`packages/snapback-codegen/index.mjs:1056-1096`) omits
  `offline_mutation_replay`; enforcement at `index.mjs:1880-1891` refuses it
  as unknown, and the validator is **profile-independent** (called from both
  profile paths), so Explicit is equally unable to require it — Familiar
  just has no escape hatch.
- The experimental-maturity mirror `EXPERIMENTAL_TARGET_CAPABILITY_IDS`
  **does contain it** (`index.mjs:1127`) and is byte-asserted against Rust in
  `crates/snapback/tests/capability_v0.rs:146-163` — but that gate checks
  maturity only, never the authorable set.
- The Rust registry carries the id
  (`crates/snapback-types/src/manifest/capability_registry.rs:129`), the
  local SQLite target declares it
  (`crates/snapback-engine/src/manifest/capabilities.rs:2283`), and the
  committed local manifest lists it in `supportedCapabilities`.
- No test or gate cross-checks `TARGET_CAPABILITY_IDS` against
  `TargetCapabilityId::ALL` or any target's `supportedCapabilities`; that is
  the structural hole that let the vocabularies drift.

Minimal repair shape: add the id to the authorable set plus a parity test
binding the authorable set to the Rust registry (or an explicit,
tested allowlist of intentionally non-authorable ids), so the next
capability cannot drift the same way. The settlement-ledger admission and
queue-aware client acceptance below remain the larger half.

## Acceptance

- Familiar schema authoring accepts the canonical
  `offline_mutation_replay` capability where the target manifest exposes it.
- Codegen carries the requirement into generated function/application facts.
- A supervised local SQLite binding positively offers the corresponding
  settlement-ledger capability.
- `useSnapbackMutation` can queue a stable set-state intent offline and
  `replayQueuedMutations()` settles it after reconnect without an app-owned
  queue.
- A target without the settlement ledger still refuses before transport with
  the existing typed diagnostic.
- Published-closure tests prove capability vocabulary parity across Familiar
  schema input, generated target facts, binding offers, and client admission.
