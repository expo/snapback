# Contract-block front-end spike report

## Verdict

**PASS on the comparable bar, with a named weakness.** A line-oriented,
indentation-scoped surface in the shape of Exact's `.contract` grammar lowers
**17/17** S1 corpus programs to byte-identical IR — the same equality result the
TypeScript front end reports — and refuses **8/8** of that front end's known-bad
first attempts *at parse time*, because the grammar does not admit the sentence.

The weakness is diagnostic quality: two of the eight refusals fall through to a
generic "cannot parse expression", where the TypeScript front end emits a family, a
source span, and a full rewritten source. That is a real advantage of the
TypeScript path and this spike does not match it.

## Results

| Measure | Contract front end | TypeScript front end |
|---|---|---|
| S1 corpus equality | **17/17** | 17/17 |
| Known-bad first attempts refused | **8/8, at parse** | 8/8, by AST policy pass |
| Gauntlet (27 code-bearing shapes) | **not applicable** — see below | 18/27 (66.7%) |
| Surface size, same 17 programs | **109 lines / 5.4 KB** | 256 lines / 8.6 KB |
| Front-end implementation | **349 lines** | 2,271 lines (`src/`) |

Reproduce:

```
node frontend-contract/check.mjs           # 17/17 S1 equality
node frontend-contract/first-attempts.mjs  # 8/8 refused by the grammar
```

## Why there is no gauntlet number

The gauntlet measures whether *naturally written TypeScript* lowers. A Contract
front end scores ~0% on it by construction, because none of the corpus is written
in Contract syntax. The honest equivalent — a corpus of Contract-shaped snippets
authored by people who were not implementing the lowerer — does not exist, and
inventing one here would measure the author, not the surface.

So this spike does **not** claim to beat 66.7%. It claims the comparable bar
(17/17) and a categorical difference in where refusal happens.

## The categorical difference

The TypeScript front end is **subtractive**: it ships a `noLib` environment that
removes `Date`, `Math.random`, `fetch`, `setTimeout`, and `eval`, then runs an AST
policy pass refusing `while`, ambient time, recursion, and `async`/`await`. Every
removal is a place where an author writes well-formed TypeScript that type-checks
and is then rejected.

The Contract grammar is **additive**: only what it names exists. The eight bad
attempts fail like this:

```
ambient-time           line 4: cannot parse expression: Date.now()
helper-scan            line 4: scan needs an explicit take=
                         hint: every read carries its bound in the source
split-loop             line 5: cannot parse loop domain: tokens split(body, " ")
                         hint: domains are: page/scan reads, `range from= to=`, …
structural-loop-tally  line 6: unknown statement "count++"
structural-rank        line 4: cannot parse expression: sort(…)[0]
unbound-count          line 4: scan needs an explicit take=
unbound-scan           line 4: scan needs an explicit take=
while-loop             line 5: unknown statement "while"
```

Three design choices do most of that work:

1. **Reads are keywords with the index inside the form.** `get users.byId [key]`,
   `scan cards.byParentOrder [key] take=50`. A read without an index does not
   parse. This is also the shape that would have caught the defect in
   `issues/20260828-plan-get-accepts-untyped-id-expression.md`, where a TypeScript
   builder accepted a `v.string()` where a document id was required because there
   was nowhere to hang the relationship.
2. **Every read carries its bound.** `take=` is required; three of the eight
   attempts fail on exactly this. In the TypeScript surface the bound of a derived
   loop is *invisible in the source* — `thread`'s mention loop carries
   `max: 85, bound_source: "messages.body max 256 / min whitespace mention 3"` in
   the IR, computed by the compiler and unstated by the author.
3. **No type annotations.** Nothing in the surface implies TypeScript semantics, so
   there are no TypeScript priors to misfire.

## What the exercise exposed about the IR

Authoring the 17 programs surfaced three things worth recording independently of
the surface question.

- **`provenance` is not derivable from the source.** Four programs needed an
  explicit `provenance=` because the value does not follow from the key expression:
  `send`'s membership `Exists` is keyed `[conversationId, viewer]` — an argument
  first — yet is `Shape`, and `thread`'s inner scan is `Computed` while a
  syntactically identical scan in `mentionScan` is also `Computed` but
  `helperWrappedScan`'s is `Arg`. Either the rule is undocumented or provenance is
  genuinely an authored fact. If it is authored, both front ends should require it
  rather than infer it.
- **`site` is an authored label, not a derived one.** Sites in the corpus are
  `board.columns`, `inbox.memberships`, `helper.cards` — they do not follow from
  program or binding names. Deriving them, as a TypeScript surface must from helper
  identifiers, makes site identity depend on refactoring.
- **The corpus never uses `Upsert`.** `sendMaintainedUnread` spells insert-or-update
  as an explicit `if unread == null / else`, which is more analyzable than an upsert
  and suggests the node may be unnecessary.

## Honest limits

- **I wrote both the grammar and the programs.** "It lowers" is partly a measure of
  the author's own consistency. The TypeScript front end faced TypeScript written by
  others; this spike did not face Contract written by others, and until it does the
  17/17 is a *feasibility* result, not an ergonomics one.
- **Diagnostics are worse.** `structural-rank` and `ambient-time` produce a generic
  parse failure. A production version needs the refusal families and rewrites the
  TypeScript front end already has; nothing about the additive approach prevents
  that, but this spike does not have it.
- **349 vs 2,271 lines is not like-for-like.** The TypeScript front end type-checks
  against a shipped environment, produces mechanical rewrites, and invokes the Rust
  checker. This lowerer only parses and emits IR.
- **Expression coverage is exactly what the 17 programs need.** `Assign`, `Break`,
  `Continue`, and `Upsert` are implemented but untested, because the corpus does not
  use them.
- **Nothing here was run through the Rust `Checker`.** Equality is against the
  committed corpus IR, not against a certificate.
