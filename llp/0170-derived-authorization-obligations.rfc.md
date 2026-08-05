# LLP 0170: Derived authorization obligations

**Type:** RFC
**Status:** Review
**Systems:** Authorization, Memberships, Code generation, Auth, Diagnostics, Agent experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-04
**Revised:** 2026-08-04
**Related:** LLP 0010, LLP 0011, LLP 0053, LLP 0055, LLP 0056, LLP 0061, LLP 0065, LLP 0070, LLP 0088, LLP 0097, LLP 0100, LLP 0108, LLP 0131, LLP 0134, LLP 0144, LLP 0146

> **Evidence boundary.** The motivating observations come from an external
> four-backend comparative build (chess, 2026-08-04), whose Snapback arm passed
> 21/21 required conformance checks plus two extras. The arm's diary is synced
> verbatim as [`diaries/0057-chess-backend-bakeoff.diary.md`](../diaries/0057-chess-backend-bakeoff.diary.md);
> the working copies (`app/`, `conformance.mjs`) remain at
> `~/projects/chess-bakeoff/implementations/snapback/`. Nothing here is a claim
> about a capability's maturity — LLP 0134 owns that.

## Summary

Snapback's safety guarantees are **per-artifact**: each declaration is checked
in isolation, and each check is excellent. A request body may not carry
identity (`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`). A closed argument schema
(LLP 0131) rejects an undeclared property before it leaves the client.
`Date.now()` in a handler is a generation-time error. A job enqueues
transactionally with the write that armed it (LLP 0070).

What Snapback does **not** do is reason across declarations to *derive* an
obligation the author did not know they had. This RFC proposes that it should,
in one specific and mechanically checkable case: **an operation that returns
rows a principal does not own must be constrained by a declared ownership or
membership path, or codegen refuses to emit.**

Three supporting changes make the primary one coherent:

1. **Ownership derivation** declared per table — direct (a principal-typed
   column), indirect (a membership relation, LLP 0056/0100), `public`, or an
   explicit loud waiver.
2. **Write provenance** on columns, so a field can be closed to future
   operations rather than only to the current one's arguments.
3. **Default-deny** on the operation auth requirement, retiring the
   `optional-user` default for sessions-mode apps.

Plus one artifact: a generated, diffable **authorization surface** so the whole
posture is reviewable in one place instead of inferred by reading every
operation.

## Motivation

### What the comparative build found

The Snapback arm's authorization posture was correct, and it was correct
because the author was careful — not because anything would have objected. Two
of the three spec requirements that make chess interesting were satisfied
structurally, and the third was satisfied by vigilance:

| Requirement | How Snapback satisfied it | Structural? |
|---|---|---|
| Caller identity comes from the credential, never the body | request body may not mention identity at all | **Yes** |
| No client-supplied value may set a rating | closed argument schema has no `rating` property | **Yes, for this operation** |
| A valid token for X must not read a game X is not in | the author wrote the predicate | No |

The third row is the gap. Nothing in the manifest, codegen, or the dev loop
would have noticed its absence. An operation declared `auth: 'authenticated'`
with no scope reads every row of its table for every authenticated principal,
generates cleanly, and passes every check an author thinks to write.

### The comparison that motivates this

The same app was built on a declarative compiler (`jonliak/backend.yml`) whose
behavior in this exact case was categorically different. Because that app's
game read model was keyed by game rather than by caller, **the compiler
refused to emit** until a membership relation existed to gate it against — then
located one structurally and wired the check. Deleting the relation is a
compile error, not a silent hole.

That is not a better *runtime* guarantee than Snapback's. It is a guarantee at
a different time and of a different kind: an obligation derived from the shape
of the whole app rather than from the correctness of one declaration. It is the
only thing observed in the four-way build that Snapback could not match, and it
is the difference between "this app is safe because the author was careful" and
"this app is safe because it would not have built otherwise."

Snapback is unusually well positioned to close it. The generator already sees
the entire manifest: every table, every operation, its `reads`/`writes`, its
`authScopeField`, and its auth requirement. **That is precisely the input the
analysis needs.** No new information has to be collected; what is missing is
the inference.

### Why the adjacent defaults belong in the same document

Two further observations are individually small and jointly corrosive, because
they undercut the same claim — that in Snapback you declare it or you are
refused:

- **The default auth requirement for an app operation in a sessions-mode app is
  `optional-user`.** The arm found this only while reading `/inspect` for an
  unrelated reason. Nothing surfaces it: not codegen, not the dev loop, not the
  acceptance harness. It is the single place found where the framework lets an
  author be *less* safe by omission.
- **A closed argument schema protects the operation it is attached to, not the
  field.** `matchmaking.join` cannot carry a rating. Nothing stops the next
  operation someone adds from accepting one.

## Design

### 1. Ownership derivation

Every table declares how a row's owning principal is derived. This is a
schema-level fact, stated once, rather than a predicate repeated per operation:

- `owner: <column>` — direct. The column is principal-typed; the row belongs to
  that principal.
- `owner: { via: <relation> }` — indirect. Ownership is mediated by a declared
  membership relation (LLP 0056; addressed operations per LLP 0100). A game is
  owned jointly by its participants.
- `owner: public` — the rows are deliberately world-readable. A leaderboard is
  the canonical case, and it must stay a **one-word** declaration; if the safe
  thing is more typing than the unsafe thing, this design fails.
- `owner: unscoped` — requires a `reason:` string. Loud, reviewable, and
  surfaced in the artifact of §4.

Absence is not a fourth option. A table with no `owner` and at least one
principal-facing read is an error, with the diagnostic naming the four forms
and, where a plausible relation already exists in the schema, naming it.

### 2. The obligation rule

For every operation that returns rows of table `T` to a principal, codegen
computes whether the operation's declared authorization constrains its result
to the caller's ownership path for `T`. Three outcomes:

- **Discharged** — the operation's `authScopeField` or membership predicate
  resolves to `T`'s ownership derivation. Emit.
- **Underdetermined** — it does not. **Refuse to generate**, with
  `SNAPBACK_AUTHZ_OBLIGATION_UNDISCHARGED`, naming the operation, the table,
  the ownership derivation that was not satisfied, and the shortest edit that
  would satisfy it.
- **Waived** — the operation declares `authz: { waived: "<reason>" }`. Emit,
  and record the waiver in §4's artifact. A waiver is never inferred and never
  silent.

Two properties are load-bearing and non-negotiable:

**The refusal must be dischargeable in one obvious edit.** The comparative
build's most-praised property was not the refusal itself but the diagnostic
quality around it — line, column, source excerpt, and a hint that reasoned
about the author's own file rather than restating the rule. A refusal that
leaves an agent guessing converts a safety win into an authoring loss, and the
`degraded <fn>` lines already in codegen are the right precedent: they name the
function, the argument, the file, the line, and the repair.

**Waiver must be cheaper than a wrong predicate but more expensive than
silence.** If waiving is hard, authors will write a predicate that type-checks
and does nothing. That is strictly worse than a recorded waiver.

### 3. Write provenance on columns

A column may declare who is permitted to write it:

```
rating: { type: 'integer', writtenBy: 'system' }
```

`writtenBy: 'system'` means no client-invocable operation may include the
column in its `writes` set; only scheduled work, jobs, and system mutations
may. `writtenBy: ['<operation>', ...]` narrows to a named set. Undeclared
remains open, as today.

This is the field-level counterpart to LLP 0131's argument-level closure. The
closed argument schema already stops the *input*; this stops the *next
operation*. The chess spec's one security requirement — a rating the client
cannot set — becomes a property of the column rather than a property of every
operation that might one day touch it.

### 4. The authorization surface artifact

Codegen emits a generated, diffable authorization surface: for every operation,
its auth requirement, the tables it reads and writes, how each read discharged
its obligation, and every waiver with its reason. Rendered as a table for
review; emitted as JSON for CI.

`/inspect` already exposes `functions[].authRequirement`, so the data mostly
exists. What is missing is that it is a *runtime introspection endpoint* rather
than a *reviewable build artifact*. Promoting it means an authorization change
shows up in a diff, and CI can fail an unexplained widening — neither of which
any of the four backends in the comparative build could do.

### 5. Default-deny

An app operation in a sessions-mode app defaults to `authenticated`, not
`optional-user`. Public operations declare themselves.

Migration, since this is a breaking default: one release in which an
undeclared operation emits a `degraded`-class codegen line naming the operation
and the two ways to resolve it, then one release in which it is an error. The
`degraded <fn>` mechanism is the existing precedent for exactly this shape of
nudge.

## Non-goals

- **Not a general policy language.** The analysis answers one question — is
  this read constrained to the caller's ownership path — and refuses to
  guess about anything else. Rate limits, field-level redaction, and
  time-bounded access stay where they are.
- **Not a re-opening of LLP 0144.** Declared application refusal codes are
  Accepted and the first slice landed 2026-08-01. The comparative build's
  finding that `ctx.refuse` was absent from `@expo/snapback-*@0.1.8` is a
  publication fact, not a design fact, and belongs to LLP 0134 and to
  LLP 0171 §A — not here.
- **Not a change to the membership authority.** LLP 0056's transition matrix
  remains the sole write authorizer and LLP 0100's predicate the executable
  read authorizer. This RFC derives *where a predicate is required*; it does
  not evaluate one.
- **Not runtime enforcement.** Everything here happens at generation. The
  runtime is unchanged.

## Acceptance

1. A fixture app declaring a table with `owner: { via: <relation> }` and a read
   operation without a matching predicate **fails to generate**, and the
   diagnostic names the relation that would discharge it.
2. Adding the predicate makes the same app generate, byte-identically to the
   hand-authorized version.
3. Deleting the relation from a previously-discharged app is a generation
   error, not a silent widening.
4. A `writtenBy: 'system'` column cannot appear in any client-invocable
   operation's `writes` set; attempting it is a generation error naming both.
5. An undeclared auth requirement emits the `degraded`-class line in release
   *n* and fails generation in release *n+1*.
6. The authorization surface artifact is deterministic across regeneration, and
   a CI check fails on a widened surface with no corresponding waiver.
7. The chess app is added to the acceptance corpus as the negative fixture: its
   game read must refuse without a membership predicate, and its leaderboard
   must be one word to declare.

## Open questions

1. **Aggregates and projections.** A leaderboard reads rows nobody owns and
   returns three columns of many principals' data. `owner: public` covers the
   declared case, but what is the rule for an aggregate over a table whose base
   rows are member-scoped? Does the obligation attach to the base table, to the
   projection, or to both?
2. **Live queries and resume.** Does the obligation re-check on RQS resume, or
   is discharge a generation-time fact that resume inherits? LLP 0053's
   invalidation semantics probably answer this; it should be stated rather than
   assumed.
3. **History and branches.** How does ownership derivation project onto
   LLP 0088's history reads and LLP 0097's branch reads, where the row's owner
   at write time and at read time may differ?
4. **`owner: unscoped` and internal operations.** An operation reachable only
   from other server-side code has no principal, so the obligation is vacuous.
   Is "internal-only" a declaration Snapback should have, and if so is it here
   or in a follow-on? The comparative build's other declarative arm was missing
   this too, and both authors reached for a string prefix check in a handler
   body — which suggests the shape is real.
5. **Waiver review.** Should a waiver require a scoped grant (LLP 0055) to
   land, or is appearing in §4's artifact sufficient?
6. **Interaction with `authScopeField`.** Is ownership derivation a
   generalization that should subsume it, or a second concept that sits above
   it? Subsuming is cleaner and is a breaking change to every existing app.
