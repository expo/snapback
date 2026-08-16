# LLP 0249 action `effects` vocabulary needs a naming and semantic decision

**Status:** Open
**Severity:** P1
**Systems:** Codegen, action declarations, contracts, diagnostics
**Date:** 2026-08-12
**Related:** LLP 0249 D1; `packages/snapback-codegen/contract-emitter.mjs:181`; `packages/snapback-codegen/index.mjs:12452`; `packages/snapback-codegen/index.mjs:12573`

## Problem

LLP 0249's example puts `effects:` on `defineAction`, but Snapback already uses
an effects vocabulary for mutation/ephemeral contract emission at the source
locations above. Reusing the word without defining its relationship would
create two authorities that look interchangeable but describe different
things: state/ephemeral effects versus isolated-worker powers and egress.

Before this lane, `defineAction` silently dropped the proposed `runtime` and
`effects` keys. It now refuses either at define time with
`SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN`; the profile cannot masquerade as an
ordinary portable action while the vocabulary is undecided. The spike's draft
source profile and attempt receipt show the data that eventually needs a
stable home.

## Required decision

- Decide whether isolated actions use `effects`, `powers`, `grants`, or a
  nested runtime declaration, and define the exact closed vocabulary.
- State how declared egress, crypto compute/entropy, secrets, result authority,
  and writes relate to existing mutation/ephemeral effects.
- Specify contract emission, compatibility/versioning, diagnostics, and
  unknown-key behavior before enabling authoring.

## Completion

An accepted decision owns one unambiguous declaration grammar and projection.
Codegen tests prove every unsupported or misspelled effect refuses, while the
portable action grammar remains unchanged.

## Ruling (2026-08-15)

Author ruling (Charlie, 2026-08-15, recorded by orchestrating agent session):
isolated actions use a **NESTED RUNTIME DECLARATION** — a namespaced
`runtime: { ... }` block (kind, egress, secrets, crypto/entropy, result
authority, writes) — not a top-level `effects`/`powers`/`grants` vocabulary.
The existing mutation/ephemeral effects vocabulary stays untouched and
authoritative for state effects; the runtime block is a separate closed
vocabulary with its own versioning, contract emission, and unknown-key
refusals. Detailed grammar to be specified by the implementing lane under
LLP 0249 D1 and reviewed before authoring is enabled.
