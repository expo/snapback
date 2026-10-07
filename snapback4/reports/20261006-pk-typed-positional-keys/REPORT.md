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

## Round 1 — review fixes (2026-10-07)

Both Astra P2 findings are addressed. Grok's optional literal preference is
unchanged: a string literal that admits both identity and a text key still
lists both named forms; `--fix` takes the first verified form in declaration
order, including implicit `byId` first. No new intent heuristic was added.

**Sync planning.** `intent_sync::need` now consumes the result of
`schema::bind_rule` and its existing service-disjunct stripping, so planning
and final sync binding use the same admitted index and ordered rule terms.
The planner resolves this before adding access indexes. It derives the
content prefix and inverse membership access from that choice, and horizon
planning uses the resulting content prefix. It no longer counts positional
candidates by arity independently. Rule binding still checks declared
provenance, compatible types, uniqueness and nullable argument proofs;
sync still enforces required group keys, exact audiences and recipient-last
invertibility. Errors remain owned by final schema binding.

The new `typed_positional_sync` regression exercises inferred and explicit
sync audiences, competing reverse-order and incompatible composite keys,
with and without a horizon (12 combinations). Every admitted schema equals
its explicit `by pair` control, including the content and inverse indexes.
It also verifies that a reversed probe retains `reverse` and still refuses
sync, genuine ambiguity refuses, unproved nullable point arguments refuse,
and nullable audience group keys still fail sync even with a present probe
argument. [Before-fix sync failure](round-1/sync-before.log).

**Compile latency and evaluation.** `select_index` retains bound key
expressions/types for candidate selection and final lowering. It neither
clones the binder to discover their types nor recursively calls itself after
choosing an index. `program/keys.rs` factors the existing operand sequence;
a mixed key binds its positional prefix once, applies contextual identity
conversion only to literal syntax, then continues with the named operands.
The existing snapshots and setup sequencing retain authored order.

The eight-level regression failed before the change at **9.164 s** and now
passes in about **59 ms**, with exactly eight runtime reads. A second test
uses an allocating first key and a later writing helper: the first key takes
the first supplied id and the helper inserts exactly one row with the second,
for both ordinary and mixed keys. The CLI was measured three times after
recovery: typed **58.5–62.9 ms**, explicit `byId` **49.4 ms** (compiler-reported
check time). [Before](round-1/tests-before.log),
[regressions](round-1/typed-tests.log), [CLI timings](round-1/latency-results.json).

**Compatibility.** Replayed the reviewer's exact 6,588-source archive, whose
SHA-256 is recorded in [differential-summary.json](round-1/differential-summary.json).
Historical language crates were extracted from commits `8e30629410` and
`7eba286ddd` under this worktree's ignored target directory and rebuilt
against the unchanged local core/dependencies; no other host or checkout
was modified. The same review probe compares diagnostics, notes, schema,
program IR, result types, selection metadata and full program debug data.
All **1,118 pre-PK accepted programs** and all **1,550 round-0 accepted
programs** remain identical. There are zero changed accepted programs and
no additional admissions in that corpus (the sync witnesses are separate).
[Diff result](round-1/differential-changes.json).

**Recovery and verification.** The host interruption left all edits intact.
On resumption, `git status`/`git diff` and completed log tails were checked;
there were no surviving PK verification processes. The retained affected
language log completed all 282 tests (including PK, sync, intent, 113 guide,
and NL repair tests). The differential had not run and was restarted;
temporary reviewer binaries were unavailable, so historical probes were
rebuilt locally. After recovery, all 27 CLI fix tests and all 9 client tests
passed. The full suite was started anew because the refactor reaches shared
key lowering and sync planning. It **passed: exit 0, zero failures in
1,532 seconds**, with the required SQLite flag:

`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`

- Rust: **5,082 passed, 33 ignored**, including **1,491 language tests passed,
  11 ignored**; the new PK/sync tests and all guide/intent/NL repair targets
  passed again in this run.
- Fixture wrappers: **9 passed**. Client pool: **324 files passed**, with
  **6,467 tests passed and 47 skipped**. Serial models: **79 passed**.
- Builds, docs budget, release guard and package/app typechecks passed.
- Locked wasm rebuild: **2,117,335 B raw / 639,888 B gzip**, byte-identical
  to round 0; cap remains **640,018 B**. No plan/catalog encoding change,
  runtime change, new capability or macOS qualification is claimed.
- Final reference and diff audits passed.

Evidence: [full suite](round-1/full-suite.log),
[affected language](round-1/affected-language.log),
[CLI fixes](round-1/cli-fix.log), [clients](round-1/client.log),
[wasm bytes and hash](round-1/wasm-comparison.json),
[reference audit](round-1/ref-check.log). All work stayed on eb1000.
Commit only; nothing pushed.
