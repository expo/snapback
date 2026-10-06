# PK — positional keys selected by argument type

2026-10-06. Base: `8e3062941096d465ec067b00d5eb37c7f1d9f8fd`, branch
`sb4-intent/pk-typed-positional-keys`. All execution stayed in the supplied
eb1000 workspace (local hostname `expose-builder-pixel`). No other fleet
machine, publication or push.

Positional reads, keyed writes and rule probes now keep identity and secondary
unique constraints together. Generic `id` and a reference to the target table
select `byId`. Otherwise declared unique keys are filtered by arity and the
ordinary key type compatibility checks, in column order. Several compatible
keys still refuse. Diagnostics offer named forms verified in the original
project; `check --fix` can apply the first admitted choice.

## Orientation and prior behavior

Read Snapback 4's AGENTS, NOT-DOING and journal, the reads/indexes/rules/types
guide sources, LLP 3000, LLP 2000.000 and the governing sections below. Used
`llp-orient` from the existing same-host lane-lv vendor checkout because this
fresh worktree's skill symlink targets were not initialized. No skill files or
submodules were changed. The scoped context pack is:

- [LLP 3000.013 §2.2](../../../llp/3000.013-quarry-states-intent.rfc.md#22-point-reads-have-one-meaning): positional point intent, declared-index provenance, NL's nullable/unique admission and context-verified repairs. Updated here.
- [LLP 3000.007 §5.1](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#51-the-seven-forms-rev-1): nominal references and ordinary types.
- [LLP 3000.007 §18.5](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#185-a-guess-costs-a-command-not-a-loop-trending-is-on-the-card): diagnostic/fix custody. This commission explicitly permits an ambiguity choice through `--fix`; plain `check` continues to refuse.
- [LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#7-decisions-during-execution): one shared Rust interpreter on server and device. No runtime, storage or client contract implementation changed.

The baseline [select_index](../../crates/snapback4-lang/src/bind/program.rs) counted declared unique indexes
by arity **before** it reached its existing type compatibility filters.
[schema::probe](../../crates/snapback4-lang/src/bind/schema.rs) independently did the same. [Catalog](../../crates/snapback4-lang/src/bind/catalog.rs) always
adds implicit unique `byId`; thus the calibration's “2 declared unique keys”
requires only one authored `unique slug`. Adding a second authored one-column
constraint makes three arity candidates. Keyed writes call the same
`select_index` through `write_key`.

The tests were written and run before the binder edits. The initial three
regressions failed; [tests-before.log](tests-before.log) retains the observed
baseline matrix, six reconstructed errors and reversed rule-key failure.
For ordinary `T[x]` with the fixture's `slug: text <=80`, `owner: principal`:

| Argument type | 0 authored unique keys | `unique slug` | `unique slug` + `unique owner` |
|---|---|---|---|
| `id` | `byId` | arity refusal (2) | arity refusal (3) |
| reference to `T` | `byId` | arity refusal (2) | arity refusal (3) |
| reference to another table | refuses | arity refusal (2) | arity refusal (3) |
| `principal` | refuses | arity refusal (2) | arity refusal (3) |
| `text` | refuses | arity refusal (2) | arity refusal (3) |

Rules had the same arity gate. With one arity candidate they checked ordered
type compatibility; with multiple candidates they refused before considering
it. Consequently `exists members[.conversation, viewer]` could not distinguish
`unique conversation, principal` from `unique principal, conversation`, despite
the distinct reference/principal types. Named equalities already retained NL's
point semantics and nullable-key proofs.

## Calibration reconstruction and the seventh-message correction

[cal31-messages.txt](cal31-messages.txt) copies the seven relevant located lines
from `~/sb4-intent/cal31-items/m3-check.log`; the first draft was not preserved.
The reconstructed `conversations` table retains `unique slug`. Four query
sites and two rule sites reproduce the six exact arity diagnostics. The same
positional expressions now compile: id/ref/exists and both rules select `byId`; the text
argument selects `bySlug`. The regression asserts each selected index.

**The seventh message is a payload error, not evidence of positional index
selection.** Its exact text, `conversations.slug is text <=80; got id`, and
rewrite, `write text <=80 into slug`, are emitted by `program.rs::write_row`
(and its full-row path). Positional `order_keys` errors use different wording,
and the baseline arity gate prevents this bare read from reaching them.
`insert conversations { slug: x, owner: viewer }` with `x: id` reproduces the
exact seventh message. It must continue to refuse. Supplying a text argument
repairs that payload while retaining the unique constraint. The original
missing draft cannot establish which payload expression caused it; this report
does not invent one or claim all seven messages were positional failures.

## Implementation and resulting rules

[positional_keys.rs](../../crates/snapback4-lang/src/bind/positional_keys.rs) supplies the shared candidate filter and diagnostic
builder. The program binder speculates on a cloned scope to obtain types;
actual key expression setup is emitted once, in authored order. Rule binding
uses its existing typed terms. Mixed positional/named total keys retain the selected
positional key when checking extra equalities. Literal identities receive the
same contextual conversion in named and positional rule probes.

| Argument type | Result, regardless of other one-column unique declarations |
|---|---|
| `id`, including optional id | Target table's identity |
| reference to `T`, including optional reference | Target table's identity |
| reference to another table | A compatible declared unique reference/id column; never an unrelated table's identity |
| `principal` | A compatible declared unique principal/id column |
| `text` | A compatible declared unique text/enum column |
| multiple arguments | One declared unique key accepting every argument in order |
| string literal | Contextual identity conversion remains possible; identity/text ties refuse |

An incompatible key still refuses. Multiple compatible keys refuse even if
one is an exact static type match. Explicit `by` keeps its prior semantics.
Generated access indexes cannot change positional meaning. Nullable unique
arguments still require proof, and named equalities retain their existing
shortest total-key preference and genuine ambiguity refusal.

The repair verifier now checks all named candidates before listing executable
forms, and retains NL's explicit-index fallback. No unproved nullable repair
or independently broken caller gets an executable rewrite. Opposite-order
indexes over identical columns also need an authored `by` name. Keyed-write
repairs replace only the target, preserving mutation payload and conditions.
The CLI matches and replaces the exact verified source span, including any read
modifiers, then recompiles. Regressions cover pages, filters and parentheses.

The reads card replaces two existing lines with one sentence explaining typed
selection; it adds no physical lines. Indexes, types and the two affected
`why` cards agree. The guide's existing word/line budgets and pinned fact
inventory remain enforced; assertions were updated to the new facts without
raising budgets or dropping compiled examples.

## Server/device and encoding

No plan or catalog **encoding** changes, new IR variants, wire fields,
capabilities or storage migrations. Existing `Get`/`Exists`, keyed-write and
rule-probe forms carry the chosen index on both hosts. A successful old
positional selection retains its prior serialized explanation string, avoiding
incidental schema digest changes. The existing durable schema byte fixtures
and lookup-selection metadata tests pass unchanged.

The client test seeds deliberately crossed id/slug values and different
principal keys in a table retaining both unique declarations. Server queries,
offline wasm queries and offline native SQLite queries return the expected
rows and unique absence. Offline queries make zero network requests. It also
checks server updates and device prediction by id against the crossed slug.

The Darwin published-device fence was **not run** here. Its four Darwin-only
cases skip on Linux; the remaining affected schema-capability checks pass.
The operator can run `packages/snapback4/test/schema-capabilities.test.mjs`
on the mini as requested.

## Verification

The final full suite **passed: exit 0, zero failures in 1,569 s**.
Command: `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`, from the repository root. Reported qualification Cargo runs use the same SQLite flag.
See [full-suite-final.log](full-suite-final.log).

- Initial regressions: 0 passed / 3 failed against the baseline, as intended.
- Affected language/guide/repair/compatibility/headroom tests: 162 passed
  ([log](affected-language.log)). The final prose-only indexes-card correction
  also passed all 113 guide tests ([log](guide-final.log)).
- Affected client and schema-capability tests: 12 passed, 4 Darwin-only skips
  ([log](client.log)).
- Locked Linux wasm build: **2,117,335 B raw / 639,888 B gzip**, cap **640,018 B** = Linux + the required **130 B** macOS allowance.
  The artifact matches the base HR measurement. The inherited cap was 639,941 B,
  based on a recorded Linux 639,811 B; current Linux is 77 B larger than that
  recorded control, leaving only 53 B headroom. Raise the cap by the same 77 B
  to restore the specified allowance. No runtime source or wasm input changed;
  this reconciles inherited measurement drift, not attributed PK device growth.
- Reference audit: `./ref-check --verbose` passed (528 documents, 10,424 references; zero errors/unchecked).
- CLI fix regressions: 27 passed, including plain refusal followed by explicit
  `--fix` selection ([log](cli-fix.log)).
- Final full suite: 5,077 Rust tests passed, 33 ignored (including 1,486
  language tests passed, 11 ignored); 9 fixture tests passed; 324 client files
  passed with 6,467 tests passed and 47 skipped; both serial models passed
  all 79 tests. Builds, docs budget, release guard, package/app typechecks
  and the wasm budget also passed. Client pool: 619 s; serial models: 352 s.
- First full run (nonqualifying): all 1,485 language tests passed (11 ignored),
  but the CLI fix target exposed one obsolete expectation that `--fix` must
  leave ambiguity unchanged. That expectation was updated and all 27 tests
  passed. Overlapping the second run's wasm rebuild also briefly removed the
  artifact needed by the first run's mixed-evidence client oracle, producing
  `ENOENT`; this was an execution mistake, not a product assertion failure.
  The first run ended with two failed phases in 1,569 s
  ([log](full-suite.log)). The final run used stable artifacts and repeated
  every phase successfully, including the mixed-evidence oracle.
