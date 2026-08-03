# 0166 L2 — materialization records and the §D7 operations

**Status:** Open (program: `20260803-0166-impl-program.md`; requires L1)
**Spec:** LLP 0157 §D7 (the store interface — records and the ten
semantic operations), LLP 0166 §D3 (retention unit), §D5 (payload
compaction — the stub model)

Scope:

- `MaterializationRecordV1`, page-set manifests, and membership records
  in the v3 sections; `ClientMaterializationAddressV1` addressing;
  `query_instance_id` allocation from the store-wide durable allocator
  (LLP 0053's rules).
- The ten LLP 0157 §D7 operations client-side: initialize (allocate
  **or load**), beginEstablishment, commitPage (atomic
  fragment+proof+memberships+product-state with the fence-triple CAS),
  commitPageSet, recordAttemptOutcome, applyAuthorizationTransition
  (delegating to LLP 0053), applyStoreAuthorityBarrier (LLP 0059
  participant), readRenderable (no check-then-read gap),
  observeMaterialization (serialized, generation-tagged snapshots),
  retire.
- Proof validation at commit/boot/render per LLP 0157 §D3 (signature,
  bindings, witness revalidation, retained-boot failure table).
- Payload compaction per 0166 §D5: reclaims fragments/proofs/manifests/
  memberships atomically; preserves identity, `QueryAuthorizationState`,
  product-state skeleton (with `heldProofs` cleared), and registration
  bookkeeping; stub derives `unknown`; re-establishment rehydrates the
  same instance (the dated 0157 payload-compaction event row).

Done means: the client legs of LLP 0157 A5 (one-page proof and
atomicity, crash cuts), A7 (retained boot, full failure table), and A8
(fence and lifecycle races) pass on the v3 store; S3's compaction-stub
legs (fences/registrations survive, same-instance rehydration) pass;
S4 stays green.

---

**Progress (2026-08-03):** implemented (Codex gpt-5.6-sol under the
Track A session's supervision) and landed. All ten LLP 0157 §D7
operations carrier-neutral over the v3 sections; Ed25519/JCS proof
validation with in-test key fixtures; every A7 retained-boot failure
table row asserted per carrier; A5/A8 legs; page-set chain validation;
compactPayload per 0166 §D5 with same-instance rehydration; derived
CompletenessStatusV1. LLP 0053 decisions are dependency-injected owner
inputs (not reimplemented); barriers use one bounded transaction
(justified by the 256-record cap). 188/188 client tests, S4 green on
all carriers, ref-check clean. Verification: no-gap readRenderable and
the signature-omitted proof preimage confirmed; carrier diffs purely
additive. Ticket stays Open until the program umbrella closes it.

**Wave-closing handoff (2026-08-03):** the batched proof pass found an
actively-owned browser-closure regression after L2 landed. Running
`node scripts/client-bundle-metrology.mjs --check` at merged main head
`3cbff593` fails because `packages/snapback-client/materialization-store.mjs`
statically imports `node:crypto`; esbuild cannot resolve that Node builtin for
the public browser profile. The complete client package suite remains green,
including L2/L7/L8, so this is specifically the shipped browser closure, not
the store semantics exercised by the Node tests. Per the wave ownership rule,
the greening lane did not edit F0a fork code; L2 owns the fix and a rerun of the
bundle-metrology gate.
