# React optimistic mutate rolls back UI after the server already accepted the write

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** React binding, Optimistic mutations, Client SDK
**Date:** 2026-08-15
**Governing:** LLP 0180 (mutation ambiguity / effectCommitted), LLP 0107
**Related:** command-mutation path in the same file refuses *before* `mutate`
for this reason
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

```1911:1961:packages/snapback-react/implementation.mjs
      const output = await client.mutate(admittedMutation, { ... });
      if (output?.status === 'queued' || output?.queued === true) { ... }
      const result = validateResultContract(
        mutationContract,
        output.result,
        { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
      );
      if (capture && !client.authorityFence?.isCurrent?.(capture)) {
        throw diagnosticError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'optimistic mutation completed under stale authority',
        );
      }
      confirmOptimisticLayer(store, layer, result);
      return queue === false ? result : Object.freeze({ status: 'settled', result });
    } catch (error) {
      store.pendingMutations.delete(id);
      store.optimisticLayers = store.optimisticLayers.filter((entry) => entry !== layer);
      releaseLayerPin(store, layer);
      publishMaterialized(store);
      throw error;
    }
```

`client.mutate` is awaited first. After a settled (or even queued) response,
`validateResultContract` or the post-dispatch `SNAPBACK_CLIENT_AUTHORITY_STALE`
check can still throw. The shared `catch` always deletes the optimistic layer
and republishes the pre-mutation store, with no `effectCommitted` fact.

A later user retry mints a new `clientMutationId` (`localUniqueLabel()`), so
the server can apply the mutation twice. The `queue:false` violation path
has the same shape: throw after durable enqueue.

The command-mutation path in the same file refuses *before* `mutate` for
exactly this ambiguity reason.

## Desired outcome

Once `mutate` returns `settled` or `queued`, do not roll the layer back on
a local presentation/contract/authority error. Surface the install failure
with `effectCommitted: true` (or keep the layer and mark it orphaned), and
do not invite a new-id retry. Contract validation that must refuse should
run against a preview *before* dispatch, or treat post-dispatch mismatch as
a presentation defect.

## Acceptance

- A settled mutate whose result fails `validateResultContract` does not
  remove the optimistic layer as if the write never happened, and does not
  advertise a safe retry with a new `clientMutationId`.
- Post-dispatch stale-authority throws carry `effectCommitted: true`.
- `queue:false` that still enqueues does not roll back as uncommitted.
- Happy-path optimistic confirm is unchanged.

## Non-goals

- Changing server exactly-once ledger semantics.
- Replacing the command-mutation preflight, which is already correct.
