# Handlers cannot see their protocol settlement identity; effect idempotency keys are reinvented per app

**Opened:** 2026-08-08 · **Severity:** P2 (platform seam; flagged independently twice by the Zerobugs control)

The client supplies `clientMutationId` and the server replays duplicates
without re-entering the handler — but the handler context never exposes
that identity. Two independent Zerobugs lanes hit the same wall
(PLAN "Guide gaps" 2026-08-06, twice): a transaction-coupled notification
intent needs a replay-stable unique key, and the frozen provider contract
needs exactly `clientID:mutationID:email`. The control worked around it
with a namespaced `ctx.runtime.id()` fallback plus composition-injected
identity arguments on eight generated calls — counted app complexity that a
read-only `ctx.mutation.settlementId` (or equivalent) would delete.

Ask: expose a read-only settlement identity on the mutation handler
context so downstream effect workers can correlate client settlement and
provider idempotency without app-owned identity plumbing. Owner seam:
D5 mutation semantics / D7 effect idempotency (the LLP 0183 review round
flagged this exact split as an unowned cross-cutting contract).

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution (2026-08-08)

Landed. Mutation handlers now read their settlement identity directly:

```js
const { clientMutationId, settlementId } = await ctx.mutation.settlement();
```

- `clientMutationId` — the opaque id the client minted, verbatim, or `null`
  when the request carried none.
- `settlementId` — the durable settlement identity digest
  (`ClientMutationIdentity::activity_digest`), a `sha256:` value over
  `{authFingerprint, authorityInstanceId, clientMutationId, function,
  inputFingerprint[, operationIssuance]}`; `null` exactly when
  `clientMutationId` is.

Both are read-only own properties of a fresh, frozen, null-prototype object
and are derived from the request, so the identity is replay-stable by
construction and does not consume the LLP 0051 D1 ctx-answer ledger. Queries
and actions expose the member but refuse it with
`SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE` without a host round-trip — the
idempotency key is mutation-only (LLP 0043 M1/M2), and an action's durable
work crosses `ctx.runMutation`.

Design recorded in
[LLP 0043 §Handler-visible settlement identity (2026-08-08)](../llp/0043-offline-replay-retention.rfc.md#handler-visible-settlement-identity-2026-08-08).

Implementation: `mutation.settlement` host op in `src/runtime.rs` and
`cloudflare/src/host-ops.js`; `ctx.mutation` in
`packages/snapback-harness/ctx-bootstrap.js` (shared byte-for-byte with the
workerd/V8 leg); `AuthInput.client_mutation_id` carried beside the existing
`client_mutation_digest` (both `serde(skip)`/`schemars(skip)`, so zero
committed-schema churn); `GeneratedMutationSettlement` in
`packages/snapback-codegen/index.mjs`; derived-fork host-op allowlist widened
in `src/instance_fork.rs`.

Proof — `tests/mutation_settlement_identity_v0.rs`, 5/5:

```
test mutation_handler_observes_its_settlement_identity ... ok
test settlement_identity_is_absent_without_a_client_mutation_id ... ok
test settled_duplicate_does_not_re_enter_the_handler ... ok
test settlement_identity_is_stable_across_a_genuine_re_entry ... ok
test queries_and_actions_refuse_the_settlement_surface ... ok
```

The re-entry case is the real retry path: a first attempt that throws retains
no settlement, so the same `clientMutationId` genuinely re-enters the handler
— the digest is byte-identical across both entries while `ctx.runtime.id()`
differs, proving re-entry actually happened. Also green: `ctx_ledger_v0` 9/9,
`offline_replay_v0` 7/7, `artifact_schemas_v0` 35/35, `host_ops_v0` 12/12,
`workerd_twin_v0` 31/31, `wire_fixtures_v1` 7/7,
`instance_fork_vm_egress_v1` 1/1, harness `envelope.test.mjs` 6/6, both
touched codegen tests, `./ref-check --verbose` 0 errors,
`node scripts/check-inventories.mjs` PASS.

**Named arm asymmetry:** the hosted coordinator keeps no client-mutation
replay ledger and never echoes `clientMutationId`, so the hosted arm answers
the honest all-null twin. A replay-stable effect key is a local-target
capability today.

**Follow-up:** guide absorption of the new authoring surface is filed
separately as `issues/20260808-guide-gap-mutation-settlement-identity.md`.
