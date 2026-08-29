# Plan `get()` accepts an id expression of any type, so a lookup-by-field compiles silently wrong

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Code generation, Authoring surface, Agent experience, Sync
**Date:** 2026-08-28
**Related:** LLP 0329.006, LLP 0329.007, LLP 0329.008, LLP 0329.009, LLP 0010,
LLP 0264

## Summary

`get(table, id, bindAs)` is declared as
`get(table: string, id: ValueExpr, bindAs: string, opts?)`
(`packages/snapback-codegen/define.d.ts:313`). Nothing binds `id`'s type to the
target table's document-id type, and codegen performs no such check.

An author who needs a non-key lookup — which no `MutationStep` provides
(LLP 0329.006) — naturally reaches for `get` and passes the field they have.
That plan **compiles clean**:

```js
args: { profileId: v.id('profiles'), handle: v.string(), … },
plan: [
  get('profiles', arg('profileId'), 'profile', { elseError: 'PROFILE_NOT_OWNED' }),
  get('profiles', arg('handle'), 'byHandle'),   // <- handle is v.string(), not an id
  …
]
```

`generate()` returns `ok: true`. The emitted artifact carries the bad step
verbatim:

```json
{"Get":{"bind_as":"byHandle","else_error":null,"id":{"Arg":"handle"},"table":"profiles"}}
```

At runtime this looks for a `profiles` row whose `_id` equals a handle string, so
the binding is `null` for every input and the guard built on it never fires.

## Why it matters beyond the type error

The bad read also lands in the optimistic-prediction metadata:

```json
{"binding":"byHandle","idArg":"handle","kind":"point","requiredFields":["_id"],"table":"profiles"}
```

so a client's local read requirements inherit it.

This is a **silent-wrongness surface inside the analyzable path**. The argument for
declarative plans over JS handlers is that plans are checkable; here the check that
the schema plainly supports — `v.id('profiles')` versus `v.string()` — is not
performed at the one point in the loop where an agent would see it. It also sits
exactly where an agent lands when working around the missing index-read step, so
the missing capability and the silent failure compound.

## Reproduction

Scratch backend with a `profiles` table (`by_owner`, `by_handle` indexes), the
plan above, then:

```js
const r = await generate(backendDir);   // packages/snapback-codegen/index.mjs
// r.ok === true
```

Verified 2026-08-28 against `main` at `d23666d12` with workspace deps installed.

## Scope of the claim

Established: **codegen accepts it and emits it.** Not established: whether server
activation or the runtime refuses it later. Even if something downstream does, the
agent's fast loop — the one LLP 0010 makes the point of the design — does not.

## Suggested fix

Type the id expression against the table's declared id domain, the way
`bounded-children.v1` already requires "one schema-required, nonoptional child
foreign-key field whose declared ID domain is the parent table" (LLP 0110 §1.1).
A diagnostic naming the mismatch, and naming the absence of a lookup-by-index step
as the likely intent, would convert the silent failure into the paved-path pointer
LLP 0329.006's finding calls for.
