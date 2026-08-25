# Familiar cannot author the advertised offline replay capability

**Status:** Closed
**Opened:** 2026-08-24
**Resolved:** 2026-08-25
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

Repair shape (revised 2026-08-24 per the LLP 0307 review round — a bare
vocabulary add is explicitly ruled out): adding the id to the authorable
set alone would convert today's generate-time fail-closed refusal into
later runtime traps (the binding still omits the settlement ledger, so
queue dispatch refuses at M7 time). Two-part repair instead:

1. **Drift gate now, without changing authorability:** a parity test
   binding `TARGET_CAPABILITY_IDS` to the Rust registry *through an
   explicit, tested allowlist of intentionally non-authorable ids* (with
   `offline_mutation_replay` on that allowlist today, each entry carrying
   a reason). The gate stops future silent drift; the generate-time
   refusal for allowlisted ids should name the full vocabulary table
   (target facts ∩ authorable set ∩ binding offers ∩ client admission —
   LLP 0306 idea 5) so the refusal teaches instead of mystifying.
2. **Authorability lands only as one owned unit** (LLP 0253/0058 dated
   amendment, LLP 0307 Track S3): schema acceptance + generated facts +
   settlement-ledger binding admission + queue-aware client acceptance +
   refuse-before-output for targets lacking the ledger — the acceptance
   list below, together, never the id alone.

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

## Resolution

Resolved as the indivisible LLP 0307 S3 unit rather than as a bare vocabulary
addition:

- `offline_mutation_replay` moved from the reasoned non-authorable allowlist
  into the shared schema-authorable target-capability set; the Rust-registry
  parity split is now 40 authorable plus 5 intentionally non-authorable ids.
- Explicit and Familiar schema requirements lower through the same path into
  schema requirements, generated function experimental acknowledgments, and
  application binding requirements.
- The supervised local SQLite binding issuer now requires the selected
  `local-dev-sqlite-ibex` manifest's positive settlement-ledger fact before it
  offers the capability. A requirement alone cannot mint the offer.
- A selected ledger-less target refuses `SNAPBACK_CAPABILITY_UNSUPPORTED`
  before output with the complete target-facts / authorable-set /
  binding-offers / client-admission vocabulary. The independent client fence
  still refuses `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED` before
  transport and before queue persistence.
- The npm-packed closure witness generates both authoring profiles, admits the
  target-grounded binding, queues through `useSnapbackMutation` without an
  app-owned queue, replays the same `clientMutationId` after reconnect, and
  proves the ledger-less pre-transport negative.

The governing self-contained dated amendments are recorded in LLP 0253 and
LLP 0058. No new `SNAPBACK_*` diagnostic code was introduced.
