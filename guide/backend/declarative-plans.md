---
title: Declarative mutation plans
id: backend.declarative-plans
order: 3
audience: agent-first
capabilities: [backend.functions]
authorities: [llp/0004-application-data-api.rfc.md, llp/0051-language-neutral-data-tier.rfc.md, llp/0133-local-settlement.spec.md, llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0144-declared-app-refusal-codes.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/settlement-bounded-skew.test.mjs, src/storage.rs, src/value_expr.rs, demos/warble/snapback/functions.mjs, demos/todo/snapback/functions.mjs, demos/signal-desk/snapback/functions.mjs]
examples: [demos/warble, demos/todo, demos/signal-desk]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:391f5bef508ca9c561097cb2f5de09f3c55ca2953808ca3c93f8ee2eb89361ae
---

# Declarative mutation plans

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`defineMutation` composes a **host-executed plan** — no JavaScript handler
runs. The plan is a sequence of closed steps (`insert`, `patch`, `del`,
`get`, `guard`, `letBind`, `deleteWhere`, `insertEach`, …) whose values are
expressions over the arguments, prior bindings, server-derived auth facts,
and runtime time/ids. The host validates, buffers, and commits the whole
plan with [mutation semantics](./mutations.md) — one commit, one version,
read-set conflict validation. This page is the complete plan vocabulary; the
JS-handler alternative and everything shared between the two forms (results,
conflicts, buffered-write ceilings) stay on [mutations](./mutations.md).

## Write a plan mutation

A single-step plan inserts a row from arguments plus trusted runtime values,
binds the server-minted id, and returns it:

```js source=demos/warble/snapback/functions.mjs
export const createPost = defineMutation({
  args: { body: v.string(), authorHandle: v.string(), authorName: v.string() },
  plan: insert(
    'posts',
    {
      feed: lit('home'),
      authorHandle: arg('authorHandle'),
      authorName: arg('authorName'),
      body: arg('body'),
      likeCount: lit(0),
      // Minted into the deterministic ctx ledger at enqueue time, so an
      // offline post replays with the timestamp the UI already showed rather
      // than jumping to the reconnect time.
      createdAt: runtimeNow(),
    },
    { bindIdAs: 'postId' },
  ),
  result: results.value(v.object({ postId: v.string() })),
  returns: returnExpr(record({ postId: bindingRef('postId') })),
});
```

A multi-step plan reads, refuses when the read misses, and moves a
denormalized counter atomically with the write that justifies it:

```js source=demos/warble/snapback/functions.mjs
export const likePost = defineMutation({
  args: { postId: v.string(), userHandle: v.string() },
  plan: [
    get('posts', arg('postId'), 'post', { elseError: 'POST_NOT_FOUND' }),
    insert('likes', { postId: arg('postId'), userHandle: arg('userHandle') }),
    patch('posts', arg('postId'), {
      likeCount: add(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ],
  refusals: ['POST_NOT_FOUND'],
  result: results.value(v.object({ liked: v.boolean(), likeCount: v.integer() })),
  returns: returnExpr(
    record({
      liked: lit(true),
      likeCount: add(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ),
});
```

## The `defineMutation` spec keys

- `args` — the closed argument validators, exactly as on `defineJsMutation`.
- `plan` — one step or a plain array of steps, executed in order; at least
  one step is required. (`mutationPlan(...steps)` is **not** this array: it
  wraps a flattened, frozen step list into the container
  `defineWriteWithActivity` accepts for its authored `primary` steps.)
- `returns` — a return binding (below); omitted behaves like
  `returnChangedCount()`, reporting the committed changed-row count.
- `result` — the declared result contract. A plan mutation admits
  `results.value(...)` or `results.document(...)` only; anything else
  refuses generation.
- `boundedSkew` — exactly `{ field, maxSkewMs }`, the LLP 0133 lane-L
  opt-in: accept a client-captured settlement time for one declared field
  when within the bound (below).
- `auth`, `refusals`, `trackedRefusals` — the shared authored-function keys.
  Every application code used by plan `elseError`/`guard` must appear in
  `refusals`; platform codes with the reserved `SNAPBACK_` prefix are exempt.
  See [refusal behavior](#refuse-from-a-plan-elseerror-and-guard).

For `boundedSkew`, `maxSkewMs` is an integer from 1 through 86,400,000, and
`field` must name **exactly one direct `runtimeNow()` write** across the
plan's `insert`/`patch`/`insertEach` values — a transformed or derived use
is inexpressible by construction. An out-of-bound claim is re-derived from
the server clock, not refused:

```js source=packages/snapback-codegen/settlement-bounded-skew.test.mjs
const direct = defineMutation({
  plan: insert('events', { capturedAt: runtimeNow(), observedAt: runtimeNow() }),
  boundedSkew: { field: 'capturedAt', maxSkewMs: 5_000 },
});
```

## Plan steps, completely

| Step | Meaning |
| --- | --- |
| `insert(table, values, { bindIdAs }?)` | Buffer one insert. `values` maps fields to expressions; `bindIdAs` names a binding that holds the server-minted id for later steps and `returns`. |
| `patch(table, id, values)` | Buffer a partial update of the row `id` (an expression). |
| `del(table, id)` | Buffer deletion of one row. (`delete` is a reserved word; the helper is `del`.) |
| `get(table, id, bindAs, { elseError }?)` | Point read captured into the read set. A missing row binds `null` (compose with `coalesce`) unless `elseError` names the typed failure code that rejects the mutation. |
| `guard(cond, elseError)` | Truthiness check over an expression; failure rejects the whole mutation with the author-supplied code. |
| `letBind(bindAs, expr)` | Bind a computed expression for later steps. |
| `deleteWhere(table, filter)` | Set-oriented delete. The filter array is required (`SNAPBACK_DELETE_WHERE_FILTER_REQUIRED`; non-array is `SNAPBACK_DELETE_WHERE_FILTER_INVALID`); an explicitly authored `[]` clears the table deliberately — see [mutations](./mutations.md#define-the-write-boundary). |
| `insertEach(table, source, itemAs, values)` | A bounded comprehension: one insert per element of the argument-supplied array `source`, with `values` expressions over the `itemAs` binding. |
| `assertSourceChanged(table, id, operation)` | Assert the plan changed that row with `'insert'`, `'patch'`, or `'delete'`; used by generated write-plus-activity plans to bind provenance rows to their source write. |
| `allocateSequence(counter, scope, into)` | Allocate one value from a declared [scoped sequence](./sequences.md) into a binding. Admitted only inside `defineWriteWithActivity`-generated plans; hand-authored `defineMutation` plans use the JS-tier `ctx.sequence.allocate` instead. |

Two related helpers are not steps: `existingOwner({ table, id, visibility })`
declares the owner-checked activity scope of a
`defineWriteWithActivity` profile (the visibility field must be a required
string or principal), and `mutationPlan(...)` is that profile's step
container noted above.
Both live with the write-plus-activity design reference in
[safe standard patterns](./standard-patterns.md#design-reference-write-plus-one-activity-row).

Steps execute in declaration order. General iteration, data-dependent step
skipping, and cross-step control flow are permanently outside the profile —
a mutation that needs them outgrew the IR (below).

## Return bindings

`returns` declares what the mutation's logical `result` is, without running
code:

- `returnBinding(name)` — the value of a binding (`bindIdAs`, `letBind`,
  `get`, or `allocateSequence` targets).
- `returnChangedCount()` — the committed changed-row count.
- `returnDocument(table, id)` — one complete stored document, read inside
  the committing transaction at the new version, so it observes the plan's
  own writes; a missing row returns `null`. The `id` is an expression. Pair
  with `results.document(table)`.
- `returnLiteral(value)` — a constant.
- `returnExpr(expr)` — any expression; with `record({...})` this covers
  computed summaries, as in `createPost` above.

The smallest useful shape is a patch that reports its effect:

```js source=demos/todo/snapback/functions.mjs
export const editTitle = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});
```

## The expression algebra

Every `values` entry, `id`, `cond`, filter value, and `returnExpr` body is an
expression built from this closed vocabulary (`define.mjs`; the runtime
authority is `src/value_expr.rs`, and the data-tier corpus pins each entry's
behavior):

**Arguments and bindings.** `arg('name')` — strict property access; a
caller-optional argument consumed by it refuses generation with
`SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION`. `argOpt('name')` — the
omission-tolerant twin: a missing property evaluates to `null`; supply
defaults with `coalesce(argOpt('name'), lit(fallback))`. `argsRoot()` — the
whole args object, the null-safe base `argOpt` is built on.
`bindingRef('name')` (alias `binding`) — a prior step's binding.
`field(base, ...keys)` — null-propagating access by arbitrary string keys,
hyphenated keys first-class. `lit(value)` (alias `literal`) — a JSON
constant.

**Server-derived auth facts.** `authUserId()` — the effective user;
`authKind()`, `authActorKind()`, `authIsDelegated()`, `authActualActor()`,
`authActivityActorKind()`, `authGrantId()` — the LLP 0055 principal facts;
`clientMutationDigest()` — the settled client-mutation identity digest.
These are the plan-side equivalents of `ctx.auth` reads.

**Trusted runtime values.** `runtimeId()` and `runtimeNow()` — the plan-side
`ctx.runtime.id()` / `ctx.runtime.now()`
([trusted runtime values](./trusted-runtime-values.md)).

**Arithmetic, comparison, boolean.** Binary: `add`, `sub`, `mul`, `div`,
`mod`, `eqv`, `ne`, `lt`, `lte`, `gt`, `gte`, `and`, `or`. Unary: `not`,
`neg`. Expression equality is **`eqv`** — plain `eq(field, value)` is the
declarative-query *filter* helper (as are `ltFilter`/`lteFilter`/
`gtFilter`/`gteFilter`), not an expression.

**Conditionals, strings, records.** `cond(test, whenTruthy, otherwise)` —
the ternary. `concat(...parts)` — string concatenation; plain strings are
lifted to literals. `record({ field: expr, ... })` — the closed record
constructor for computed summaries.

**The pinned function library.** `call(name, ...args)` admits exactly
`len`, `trim`, `lower`, `abs`, `min`, `max`, `round`, `floor`, `ceil`, and
`coalesce` (`PINNED_FUNCTIONS`); `coalesce(...)` is exported directly.
Codegen fails closed on any other name — growing the library is a
profile-version event, not an app-side extension.

## Refuse from a plan: `elseError` and `guard`

Plan refusals are **their own channel**, different from `ctx.refuse` in a JS
handler, and the split matters when you write the client branch:

- A failed `get(..., { elseError: 'CODE' })` or `guard(cond, 'CODE')`
  rejects the whole mutation — nothing commits — and the code arrives as
  `diagnostic.code` **itself**. It is not wrapped in
  `SNAPBACK_APP_REFUSAL`, and there is no `details.appCode`. The details
  carry the failing step kind (`Get` additionally names the table and id).
- Every application code in `elseError` or `guard` must also appear in the
  mutation's `refusals: [...]` declaration. Codegen and server artifact
  validation reject an undeclared code. This cross-check makes the authored
  failure vocabulary complete, but it does not change the runtime envelope:
  plan failures still arrive as `diagnostic.code`, not `details.appCode`.
- A plan code is a free string. Unlike `ctx.refuse` codes, it may
  deliberately reuse a platform code so distinct failure paths collapse to
  one public outcome — the owner-checked delete below returns the same
  `SNAPBACK_ROW_NOT_FOUND` for "missing" and "not yours", disclosing
  neither:

```js source=demos/signal-desk/snapback/functions.mjs
export const deleteIncidentForAcceptance = defineMutation({
  args: { incidentId: v.id('incidents') },
  auth: 'authenticated',
  result: results.value(v.boolean()),
  plan: [
    get('incidents', arg('incidentId'), 'incident', {
      elseError: 'SNAPBACK_ROW_NOT_FOUND',
    }),
    guard(
      eqv(field(bindingRef('incident'), 'commanderId'), authUserId()),
      'SNAPBACK_ROW_NOT_FOUND',
    ),
    del('incidents', arg('incidentId')),
  ],
  returns: returnLiteral(true),
});
```

When a caller should branch on the reason from a **JS** handler, that is the
declared-refusal channel —
[refuse with a declared code](./mutations.md#refuse-with-a-declared-code-not-a-bare-throw).

## Know when the plan is not enough

The named out-of-profile classes (LLP 0051 D2) are explicit: data-dependent
step skipping (`conditional-writes`), uniqueness/quota/membership guards
over non-id keys (`filtered-read-guards`), coercion the pinned library lacks
(`type-coercion`), and general iteration (`general-iteration`). A mutation
in one of these classes belongs on `defineJsMutation`; declaring the class
as `outgrewIr` there makes codegen emit the class-specific "outgrew the IR"
info diagnostic into the generated manifest, keeping the tier ladder
explicit.

## Anti-patterns

- **Do not write a JS handler for a plan-expressible write.** The plan form
  is the paved road: no handler VM, a statically validated write shape, and
  the same commit semantics. Reach for `defineJsMutation` only when a named
  out-of-profile class applies.
- **Do not branch on `details.appCode` for a plan refusal.** Plan
  `elseError`/`guard` codes arrive as `diagnostic.code` directly; only
  `ctx.refuse` produces the `SNAPBACK_APP_REFUSAL` + `appCode` envelope.
- **Do not omit application plan codes from `refusals: [...]`.** Codegen and
  server artifact validation require every non-`SNAPBACK_` `elseError` and
  `guard` code to be declared. Platform codes retain their reserved namespace
  and need no application declaration.
- **Do not use `eq` where `eqv` is meant.** `eq` builds a declarative-query
  filter clause; expression equality inside a plan is `eqv`.
- **Do not smuggle client time or client-minted ids through `args`** to
  bypass `runtimeNow()`/`runtimeId()`. The closed argument schema and the
  [trusted runtime values](./trusted-runtime-values.md) page exist to keep
  those server-authored; `boundedSkew` is the one declared, bounded
  exception for a single directly assigned time field.
- **Do not emulate iteration by unrolling data-dependent steps.** The tuple
  of steps is static; a variable-shaped write set outgrew the IR.
