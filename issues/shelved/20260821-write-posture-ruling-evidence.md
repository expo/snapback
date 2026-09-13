# Evidence for the nine write-posture rulings — and why most cannot be answered from source

**Status:** Deferred — author ruling waits on LLP 0274's runtime carrier/lowerer
**Filed:** 2026-08-21
**Parent:** `issues/shelved/20260821-fixture-policy-repair-plan.md`

## Read this first

The rulings are NOT currently blocking. `issues/shelved/20260821-fixture-policy-repair-plan.md`
records that LLP 0274's runtime carrier and lowerer do not exist yet, so
`open-write` and `authenticated-write` cannot be declared at all today. This
document exists so the ruling is INFORMED when the mechanism lands, not so it
can be made now.

## The headline: the candidate answers were wrong

The plan proposed `authenticated-write` for six shared families and
`owner(userId)` for three helpers. Source analysis does not support that.

**`owner(userId)` is invalid or unsupported for all three helpers:**

| Helper | Finding |
|---|---|
| Concurrency | Undetermined between unattributed-auth and open. **Owner invalid** — mixed HostPlan/Ibex semantics and an arbitrary-row `pairSet`. |
| Live scheduler | Undetermined; authenticated attribution plausible, **owner unsupported**. Global reads; the scheduler owns timing, not row authority. |
| Network profile | Undetermined; authenticated attribution plausible, **owner unsupported**. The profile perturbs observation only, and profile state has a separate admin writer. |

That inference came from a sealed marker and a user-scoped shape. LLP 0274 says
field names and caller values are not authority, and this is a concrete
instance: the shape suggested owner, the semantics do not support it.

**Relational migration splits three ways** rather than taking one posture:
`items` → owner (medium confidence), `itemSummaries` → refused (high), `groups`
→ undetermined (low).

## What is still needed — six specific questions

These cannot be answered from source. Each is a product-contract decision:

1. **Local** — are cron-authored rows intentionally ordinary todos in the same
   product table? If yes, either anonymous/open generic authority must be
   explicitly accepted, or a distinct system-authority contract named. Current
   owner/authenticated postures cannot represent both.
2. **RQS bundle** — do `createPost`/`createTodo` model real app operations or
   disposable setup? Are posts anonymously writable, or merely publicly
   readable?
3. **Live coalesce, live delta, concurrency** — is anonymous mutation part of
   the benchmark-fixture contract? The owning infrastructure features do not
   answer this.
4. **Mutation-settlement identity** — may anonymous mutations record
   external-effect intents? That single decision separates open from
   authenticated.
5. **Relational `groups`** — who administers the shared public dimension: any
   authenticated user, members of some resource, an operator/service path, or
   anonymous callers?
6. **Live scheduler / network profile** — is `userId` intended as host-owned
   writer attribution, and is `createTodo` contractually authenticated-only?
   The sealed marker settles neither.

## Why "undetermined" is the right answer here

Declaring a posture one rank weaker than the product contract makes the corpus
assert a MORE PERMISSIVE contract than production:

```
refused < owner            < authenticated-write < open-write
refused < membership-write < authenticated-write < open-write
```

These are shared constructors, so later fixtures copy them and a future product
change that should fail these tests would pass. A confident wrong answer is
worse than an admitted gap, because the gap stays visible and the wrong answer
becomes precedent.
