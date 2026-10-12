# A Lean model of Quarry's core

This is Stage 2 of [LLP 3000.035](../../llp/3000.035-quarry-semantics-in-lean.plan.md)
(§5.2). It is a small Lean 4 model of the core of Snapback 4's data
language, with proofs of the security properties. It has three parts:

- an executable big-step semantics;
- Hoare-style rules proved sound against that semantics;
- theorems about values, disclosure, write authority and completeness.

The model is **not normative**. When it disagrees with the engine, the
difference is a Rust defect, a model defect or an open language question.
It is never a win for either side by default.

The model is written from the language card, the guide cards and the LLPs,
not from the interpreter, binder, `value.rs` or `key.rs`. Each point the
documents leave open is in [`OPEN.md`](./OPEN.md), with the choice the model
makes.

## Build

```sh
cd snapback4/lean
./check.sh          # lake build, the no-sorry/axiom audit, the examples, the oracle fixture
lake build          # library + both executables (≈15 s cold, <1 s warm)
lake exe quarry-model [--print]   # the hand-written examples; nonzero exit on mismatch
lake exe quarry-oracle < cases.jsonl   # the harness oracle: one JSON case per line in, one outcome per line out
```

The toolchain is pinned in `lean-toolchain` (Lean 4.34.1, through elan).
There is no Mathlib and no other dependency. The only import outside the
model is `Lean.Data.Json`, used to print outcomes.

`check.sh` refuses the build in four cases:

- any `sorry`, `admit`, `native_decide` or `axiom` in the sources;
- a headline theorem (listed in `Audit.lean`) that depends on an axiom
  other than `propext`, `Quot.sound` or `Classical.choice`;
- an example that disagrees with its expected outcome;
- `quarry-oracle` answering `fixtures/oracle-smoke.jsonl` differently from
  `fixtures/oracle-smoke.expected`.

The model is not part of `scripts/test.sh`, because CI hosts do not have
elan.

## What is modelled (the core fragment)

| Area | File | Contents |
| --- | --- | --- |
| Values | `Quarry/Value.lean` | Scalars: null, bool, i53 int, text (as code points), nominal id, bytes. Values: scalars, arrays, rows. The one total order. A self-delimiting order-preserving key encoding. |
| Syntax | `Quarry/Syntax.lean` | Schema: tables, typed nullable columns, unique keys with `else CODE`, read/insert/update/delete rules. Rules: allow, deny, `=`, `!=`, `exists t[..]` probes, and, or, not, over the row, old/next images and `viewer`. Expressions: arithmetic, comparison, and/or/not, `!` / `else`, `??`, conditionals, pure helper calls, arrays, records, point reads, pages, `count`, `exists`. Statements: `x = e`, `require`, `if`, `return`, and insert/upsert/update/delete. |
| Store and rules | `Quarry/Store.lean` | Rows, the store, rule evaluation, visibility (`visibleRows`), a rule's disjuncts and terms. |
| Evaluator | `Quarry/Eval.lean` | `evalExpr` and `execStmts`: total and structural on fuel. The page walk, `complete` and `next`, counts and search `exists`; when a scan is decided (its pins, or a page guard: a grant or a pinned parent probe). Reads see only a `View` of visible rows. |
| Writes | `Quarry/Write.lean` | Insert, upsert, update and delete, with rule checks and the documented refusal codes (`E_RULE`, `NOT_FOUND`, `E_CONFLICT`, `E_CONSTRAINT`, `E_REFERENCED`, application codes). A delete applies its references' `on delete` actions (LLP 3000.039 §3): the read prerequisite, the cascade closure, restrict probes outside it, set null, removal. Caps are carried as unenforced declarations: the emitter admits a capped table only when the program never inserts into or updates it. |
| Running | `Quarry/Run.lean` | `run : Case → Outcome`. An outcome is an answer (data, `complete`, `next`), unavailable, committed (result and store), or refused (code). |
| Case I/O | `Quarry/CaseJson.lean`, `Oracle.lean` | The harness's case JSON decoded to a `Case`, and outcomes printed with every scalar tagged. Input and output only: no semantics, used by no proof. |
| Examples | `Quarry/Examples.lean` | 45 hand-written programs from the guide cards and LLPs, each citing the sentence its expectation comes from (three for LLP 3000.039's referential actions). |

**Out of scope** (§5.2): the meter, apart from one abstract ceiling on
visible candidates examined (OPEN M1), and the following:

- expiry and ephemeral tables;
- maintained columns and views;
- residency, sync and devices;
- search, jobs and effects;
- loops, `walk`, `merge` and shapes;
- sequences, caps, immutable columns, `after insert` and field authority;
- defaults, text bounds and formats, and assets;
- `created`, parent hops and `read through`.

## What is proved

Every statement below is a theorem over the operational semantics, with no
`sorry` (see `Audit.lean`).

**Value order** (`Value.lean`, `Order.lean`)

- `Scalar.cmp_lawful`: the order decides equality, is antisymmetric, and
  `lt` is transitive.
- `Scalar.le_refl`, `Scalar.le_antisymm`, `Scalar.le_trans`,
  `Scalar.le_total`: so `≤` is a total order.
- `keyCmp_lawful`, by `lex_lawful`: the same holds for keys
  (lexicographic).
- `encKey_agrees`: **value order agrees with key order**. Comparing encoded
  keys symbol by symbol equals the lexicographic value order. The proof
  goes through `enc_append`, which shows the encoding is self-delimiting.
  The encoding is the model's own. The engine's byte format is not modelled
  or compared.
- `id_ne_text`: an id never equals a text with the same characters.
- `codepoint_order`: U+E000 sorts before U+10000.

**Determinism** (`Proofs/Determinism.lean`)

- `run_deterministic`: one outcome per case. This holds by construction.
- `sortRows_perm`, `candidates_perm`, `pageRead_perm`: **scan order is
  determined by key order**. If ids are unique, any physical ordering of the
  tables' rows gives the same candidates in the same order, and the same
  page. `Rule.eval_perm`: no rule verdict depends on that ordering either.

**No disclosure** (`Proofs/Disclosure.lean`)

- `query_noninterference`: a query's whole outcome is a function of the
  viewer's visible rows. The outcome covers data, `complete`, `next`, a
  refusal, or unavailability.
- `page_rows_readable`, `pageRead_visible`: every row a page returns, and
  the row its `next` follows, passes its table's read rule.
- `countRead_eq`: **what a count reveals**. `count(domain)` is exactly the
  number of visible rows in the domain that match its filter, and nothing
  else.
- `existsRead_eq`: `exists` is true exactly when a visible row matches,
  whenever it answers; `existsRead_decided`: it never answers `false` from
  an undecided scan (LLP 3000.036 §15.12).
- `query_ignores_hidden_insert`: inserting a row the viewer cannot read,
  into a table no read rule probes, changes no query outcome.
- `query_writes_nothing`: a query never changes its world.

An `exists` witness inside a read rule grants visibility, but it is never
returned. Changing a witness row is a change of authority, not a disclosure.

**Write authority** (`Proofs/Authority.lean`)

- `applyWrite_authorized`: a successful write either leaves the store
  unchanged (`if absent`) or is one authorized `Step`:
  - an insert whose insert rule admits the new image;
  - an update of an existing row whose update rule admits (old, next);
  - a delete whose delete rule admits the row, together with the
    referential actions its schema declares on the rows naming it (LLP
    3000.039: the parent's delete authorizes a declared cascade or set null).

  Each rule is evaluated in the store immediately before that write.
- `refDelete_without_actions`: a delete from a table that no action-carrying
  reference names removes exactly that row, as every delete did before.
- `mutation_authorized`: a committed mutation's store is reached by a chain
  of authorized steps. The proof uses `execStmts_inv`: statements change the
  world only through writes.

**Completeness soundness** (`Proofs/Disclosure.lean`, `Proofs/Continuation.lean`)

- `pageRead_complete`: a page that leaves `complete` true was decided (by its
  pins, or by a page guard: a readable grant or a pinned parent probe). It returned exactly the first N qualifying
  visible rows after its cursor, in key order.
- `decided_store`, `pageRead_complete_store`: **a decided scan sees all of
  its rows or none**. The rows its pins select in the store are all readable
  to the caller, or none is, so a complete page omits no qualifying row. Its
  parts: `uniform_readable_eq` (pins that fix every column the rule reads
  give one verdict) and `granted_readable` (a positive disjunct whose row
  columns are all pinned — none, for a grant — that holds over the caller's
  view with the pinned values makes every row the pins select readable;
  `Rule.eval_mono`, `Rule.eval_pin`).
- `walk_complete`: the same fact for the underlying candidate walk.
- `cut_continuation`: a page cut by the ceiling, followed by the leading
  qualifying rows of its continuation from `next`, equals the uncut page.
  This is Stage 1's oracle 2, proved.

**Short-circuit and helper calls (the LLP 3000.003 shapes)** (`Proofs/ShortCircuit.lean`)

- `or_true_skips`, `and_false_skips`, `or_true_skips_null_assertion`,
  `cond_true_skips`: the skipped side is never evaluated, for every `e`.
  Request state is unchanged.
- `identity_sum`: `identity(1) + identity(2) = 3`.
- `call_scope_independent`: a helper call does not see the caller's locals
  or row.

**Axiomatic rules** (`Proofs/Hoare.lean`)

- `triple_nil`, `triple_assign`, `triple_require`, `triple_ret`,
  `triple_ite`, `triple_write`, `triple_conseq`: each is sound against
  `execStmts`. Correctness is partial: refusals abort.
- `triple_write_authorized`: the mutation write rule, with write authority
  folded in.

Planted faults were each rejected by the proofs. Each fault was put into the
model, `lake build` failed, and the fault was reverted:

- marking a cut page complete: `pageRead_complete` failed;
- evaluating the right side of `true or e`: `or_true_skips` failed;
- dropping the insert-rule check: `doInsertImage_ok` failed;
- letting `visibleRows` leak one table: `page_rows_readable` and
  `visibleRows_insert_hidden` failed.

## What is only executable, or not proved

- **Refusal codes and their precedence** (OPEN W1–W4) are executed and
  checked by the examples, but not proved. No theorem says which code a
  given failure produces.
- **Filters with nested reads.** `pageRead_complete`, `countRead_eq` and
  `existsRead_eq` assume the filter is a pure predicate (`FiltIs`). Filters
  without reads satisfy this. A filter with a nested read does too when its
  value does not depend on the meter, but no theorem discharges that
  hypothesis.
- **Query-level completeness.** It is proved per read (`pageRead_complete`).
  That a request's `complete` is the conjunction of its reads holds by
  construction (`markIncomplete` only clears the flag) and is not stated as
  a theorem.
- **Non-functional facts.** Termination needs no proof (fuel). Fuel
  exhaustion (`E_MODEL_FUEL`) and ill-typed states (`E_MODEL_TYPE`) are
  model-only refusals that a checked program cannot reach.

## The Lean oracle: the emitter, the case format and the comparison

The model is an oracle of the Stage 1 harness (LLP 3000.035 §5.2), built on
2026-10-08:

- **The emitter**, `snapback4_lang::emit::lean`
  (`crates/snapback4-lang/src/emit/lean.rs`), translates a checked program's
  *surface* tree (never the binder's IR, so the binder is under test too)
  into the terms of `Syntax.lean`, with the expansions listed there. Anything
  outside the core fragment is an `Unsupported` with a stable reason (for
  example `call-sum`, `now`, `loop`, `table-expiry`, `type-money`), never a
  partial translation. `snapback4 check --emit-lean <file.q>` prints one
  file's translation.
- **The runner**, `quarry-oracle` (`Oracle.lean`), reads one case per line
  and writes one outcome per line, staying alive across cases (one process
  per harness worker).
- **The harness**, `snapback4-difftest run-lean`
  (`crates/snapback4-difftest/src/lean.rs`), compares the engine (SQLite,
  default ceilings) with the model on every supported generated case,
  shrinks each new signature (`lean--{field}--{engine}~{model}`) and replays
  it. Findings and their diagnoses are in
  `crates/snapback4-difftest/cases/found/lean--*`.

A case (one line):

```json
{
  "version": 1,
  "schema": { "tables": [ {
    "name": "items",
    "cols": [ { "name": "owner", "nullable": false }, { "name": "maybe", "nullable": true } ],
    "uniques": [ ["tag"] ], "uniqueCodes": [ null ],
    "read":   { "probe": { "table": "access", "key": [ ["bucket", { "col": ["self", "bucket"] }], ["principal", "viewer"] ] } },
    "insert": "allow",
    "update": { "and": [ { "eq": [ { "col": ["old", "owner"] }, "viewer" ] }, { "eq": [ { "col": ["next", "owner"] }, "viewer" ] } ] },
    "delete": "deny" } ] },
  "helpers": [ { "name": "identity", "params": ["x"], "body": { "var": "x" } } ],
  "store": { "items": [ { "id": "r0", "cols": { "owner": { "id": "bob" }, "maybe": { "null": null } } } ] },
  "viewer": "bob",
  "program": { "name": "run", "kind": "query",
               "params": [ { "name": "bucket", "optional": false }, { "name": "c", "optional": true } ],
               "body": [ { "ret": { "page": { "table": "items", "pins": [ ["bucket", { "var": "bucket" }] ],
                                              "filter": null, "order": ["label", "score"], "desc": false,
                                              "take": 20, "after": { "var": "c" } } } } ] },
  "args": { "bucket": { "int": "0" }, "c": { "null": null } },
  "budget": null
}
```

The format's rules:

- **Scalars are tagged.** The forms are `{"null":null}`, `{"bool":b}`,
  `{"int":"…"}`, `{"text":"…"}`, `{"id":"…"}` and `{"bytes":"hex"}`. An int
  is a decimal string, so no float is ever involved. The wire's untyped form
  is not enough, because an id is not a text (OPEN V1). Values add
  `{"arr":[…]}` and `{"row":[[name, value], …]}` (ordered pairs).
- **Rules, terms, expressions, statements and writes** use one key per
  constructor of `Syntax.lean`, with the constructor's arguments
  (`CaseJson.lean` is the decoder). `"viewer"`, `"allow"` and `"deny"` are
  bare strings.
- **Store rows** are `{"id":…,"cols":{name: scalar}}`; columns are put in the
  table's declared order and an absent column is null.
- **The output** is one of:
  - `{"kind":"answer","data":…,"complete":b,"next":…}`;
  - `{"kind":"unavailable"}`;
  - `{"kind":"refused","code":"…"}`;
  - `{"kind":"committed","result":…,"store":{…}}` (the store in the input's
    row form, so a follow-up case can run over it);
  - `{"kind":"error","error":"…"}` for a line that does not decode. The
    harness treats it as an emitter defect, never as a verdict.

  Every value is tagged. (`Outcome.toJson` in `Json.lean`, used by the
  examples, still prints ids and text alike, as on the wire.)

How the harness compares against the engine's outcome record:

| Model | Engine field | Rule |
| --- | --- | --- |
| `kind` | refusal / `unavailable` / data / committed | exact |
| `refused.code` | `refusal.code` (or a failed write's `why.code`) | exact; sites are not modelled |
| `answer.data`, `committed.result` | `data`, `result` | exact, both tagged; rows compare as field maps |
| `answer.complete` | `complete` | exact |
| `answer.next` | `next` | presence only (OPEN C1); then each side continues from its own cursor and the next page is compared, to the end |
| `committed.store` | the engine's store | through `observe` (a point reread), run on each side's resulting store |
| (none) | meter fields, cut sites, `tables`, `seq`, expiry | not compared: out of scope |

The engine runs at the default ceilings and the model unbounded, so no
compared case is cut. Comparing cuts (OPEN M1: a cut is reported, and
continuation reaches the uncut answer, `cut_continuation`) is not yet done.
