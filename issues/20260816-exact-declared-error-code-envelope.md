# Exact drops declared error codes from the Contract mutation envelope

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Contract, Exact,
Provider adapters, Error handling

**Related:** LLP 0266; `demos/coterie/src/data/memory-provider.ts`;
`demos/coterie/tests/memory-provider.test.ts`

## Problem

Exact's provider declaration generator emits mutation error unions with a
required literal `code` field, such as `duplicate_email` or
`session_required`. Coterie's provider now sets both `Error.name` and
`Error.code` for every declared error before throwing. The real generated
mutation path still delivers only `{ name, message, stack }` to its caller.

The loss occurs in Exact's Contract runtime: `SerializedError` in
`packages/exact-contract/src/runtime/data-provider.ts` has no `code` field and
`serializeDataError()` copies only `message`, `name`, and `stack` from an
`Error`. `createBoundaryContractDataProvider().mutate()` returns that serialized
shape after catching the provider error. The generated TypeScript contract and
the runtime value therefore disagree.

Coterie cannot fix this without modifying the sibling Exact repository. Its
tests assert delivered error names and explicitly document that runtime codes
are absent pending this fix.

## Closure wanted

Extend Exact's serialized provider-error contract with `code?: string` and
preserve a string-valued `error.code` in `serializeDataError()`. Verify the
field across the boundary-provider mutation path and every transport/envelope
that serializes `DataMutationResult`, with a generated declared-error test that
asserts the literal code reaches the final mutation caller. Reconcile the
generated error-union field with the runtime type so consumers can branch on
`code` without a cast. Once available in the Exact version linked by Coterie,
change the Coterie regression from name-based delivery to a literal-code
assertion and close this ticket.
