# Lane AG — first paste, round 0

Base: `f56e8048aa9f1c9dc50f29991bd3c96be79044dc` on
`sb4-intent/ag-first-paste`. Work stays in the compiler/planner, CLI, guide and
regression/report files. No client package, engine implementation, authorization,
disclosure, bound or meter ceiling changes. No push or publication.

The cal25 program now prints **20 lines / 5,928 B**, versus **111 lines** at the
base. Its verdict is first and plain output contains no `$intent:` index names.
`--verbose` retains notes, rewrites, fields, sequences, ephemeral operations and
scale details (319 lines); JSON retains its structure and full detail. Explicit
`--cost` and `--residency` remain available. The JSON test compares plain/verbose
reports after removing only elapsed time.

## Frictions and evidence

The `baseline-*.log` files were captured with the base binary before implementation.
Minimal source reconstructions are in `reproduction/` and the language test's
`fixtures/ag/`. The original cal25 program is copied under `cal25/snapback/`;
builder files were treated as data. Full-program copies using the natural
aggregate and the exact upsert rewrite both pass check (`after-cal25-natural.json`
and `after-cal25-upsert-rewrite.json`).

| Friction / first-attempt evidence | Classification and result |
| --- | --- |
| Partial `(message, emoji)` group: cal25 `m6-check1/2.log`, cal24 log timestamp 1790559104 | **Already fixed on main by MP.** Parent-pinned `reactionCounts where .message = m.id` compiles with `.value`. The requested `count` projection spelling is **fixed here** as an alias of `.value` on count views, except where a real group column is already named count. Executed heart/laugh groups, count 2/1, and current-viewer membership; hidden/missing parent and unpinned scan controls remain enforced. MP's effective landing is `570ca4cb7`; `f6ccc4a51` is the intermediate merge, also inspected. |
| False “reads online-only table reactions”: cal25 `m6-check1.log`; cal24 `m4-react-why.txt`; cal23 `m4-reaction-prediction.txt` | **Fixed here.** The summary names the actual read-through upsert restriction. `why` prints a source-specific conditional update/insert for stable, complete keys and insert images. Pasting it executes insert and subsequent update, preserving one reaction per viewer/message. The advice explicitly requires additional read authority and held coverage and can still queue at a horizon. No automatic --fix for that product choice. Key-changing/complex/incomplete-insert cases receive no speculative rewrite. |
| `len(text)`: cal24 `m4-check.txt`; `length` familiar equivalent | **Fixed here: aliases accepted deliberately**, recorded in LLP 3000.007 §23. Executed Unicode-character and list counts, equal meters to count, and explicit custom length helper ownership. |
| `.message.conversation` in aggregate rule: cal25 `m6-check3.log` | **Traversal deliberately refused; repair fixed here.** This was an attempted restatement of inherited message authorization, not a misspelt `.conversation`. Only a structurally identical parent rule reached through the reference gets a whole-read-line inheritance comment. It compiles and preserves private-parent behavior; --fix applies the single-line case. Extra local restrictions and a standalone reference sharing a parent column's name are never removed automatically. |
| `public` on a view: comparative run M1 | **Fixed here: accepted alias of read <- allow.** Executed the count result; existing audience validation remains. |
| Helper without terminal return: cal24 `m6-check.txt` | **Fixed here: null fallthrough**, equivalent to a bare return. Executed the durable notification effect and null result. No implicit return of a final expression. |
| `shape messageObject on messages = ...`: cal24 `m6-check.txt` | **Deliberately refused with exact repair.** Replace `on messages =` with `=`. --fix applies that replacement; the pasted shape executes the expected message object. |
| Complete helper forced into viewer query: cal24 `m8-check.txt` | **Deliberately refused; rewrite fixed here.** Retain MP's caller-chain explanation. The rewrite replaces the entire unused preview query with a comment, leaving the complete scheduled job; the test executes all recipient totals. No first-50 truncation and no automatic deletion. A wanted interactive preview still requires a separately designed page/cursor, explained in the reason. |
| `groupNamed` / `chat.groupByTitle` completeness notes: comparative, cal25 | **Server completeness deliberately unchanged; advice fixed here.** The exact original query with held added is offered for a synced lookup that can run on the device. Both memory and SQLite replicas acquire coverage and execute the pasted alternatives, retaining duplicate title matches and correct missing-title results. The original server query still returns authorized matches without certifying complete/absence. No guessed uniqueness constraint. |
| Clean check, ephemeral internal index leak: full cal25 | **Fixed here.** Verdict first, terse default, full verbose/JSON detail. Ephemeral operation details now use index presentation. CLI regression covers verdict order, no internal names in plain/residency output, and unchanged JSON detail across verbosity. |

The essay also mentions an unspecified expiry-keyword guess. The supplied refusal
files and source do not identify that spelling, so it cannot be reconstructed
faithfully; no fix is claimed. The observed `shape ... on ...` guess above was the
additional reproducible spelling discovered during the evidence review.

## Safety and compatibility evidence

The new language tests execute the builder intent, rather than merely matching
messages. Alias tests compare meters; parent tests include hidden and missing
rows; upsert tests execute both branches. The safe inheritance fix must account
for every focal field as a parent hop, so a same-named parent column cannot make
a standalone group reference look redundant. Device tests cover memory and
SQLite with duplicate names and acquired membership coverage. CLI tests verify
that only mechanical repairs run under --fix.

The lowering differential retains every historical IR digest. Three newly
admitted census programs have a separate `first-paste-admissions.sha256`: one
fallthrough-helper query and two queries in a document formerly rejected at a
len call. All 11 lowering tests pass, including byte-identical ownership-on/off
IR, admission and runtime/meter comparisons. The ephemeral compatibility test
pins exactly the two changed human-advice strings; all other schema/type bytes
remain frozen. No new diagnostic code or root diagnostics-registry entry.

## Verification

- Final first-attempt language tests: **8 passed**. Complete compiled guide: **98 passed** (`final-whole-guide-pass.log`); final rule-guard test also passed after its fixture was narrowed (`final-rule-guard.log`).
- Device rewrite execution: **2 passed**, memory and SQLite (`device-first-paste-1.log`; also passed in the full Rust run).
- Final CLI check/fix: **79 + 27 passed** (`final-cli.log`); after restoring explicit --cost range detail, **79 + 10 + 28** check/cost/scale tests passed (`final-cost-cli.log`) and the unchanged client --cost test passed.
- Other affected language checks: audience/bounds **10**, maintains **14**, residency **41**, spelling **19** passed (`affected-final-2.log`, `affected-final-3.log`).
- Full-suite compatibility repairs: **1 + 6 + 40 + 11** language tests and **10 + 3 + 3 + 28 + 1** CLI tests passed; exact failed lifecycle test **1 passed** (`suite-repairs-*.log`).
- Guide docs budget: **README 300/300 physical lines**, pass (`final-docs-budget.log`).
- `./ref-check --verbose`: pass; final output in `ref-check-final.log`.
- `node scripts/check-inventories.mjs`: exit **1**, three root inventory groups failed on unchanged Snapback 1 inputs and missing generated artifacts. Every failure is classified in [FAILURES.md](./FAILURES.md); full output and input attribution are retained.

The single `scripts/test.sh` invocation is in `full-suite.log`. Exact summary:

```text
== 2 failure(s) in 1299 s
   cargo test
   client tests
```

The Rust stage had 16 failures; client tests had five. The 79 client model tests
passed. All other script stages passed. [FAILURES.md](./FAILURES.md) names and
attributes every failure. The two client receipt/retention failures are classified
environmental/nondeterministic after passing with both base and current binaries
in isolation and comparing identical fixture activation digests. One --cost
regression is fixed. Two client-owned expectations remain unchanged under the
no-client-edits scope: `client-test-followup.patch` supplies their exact edits,
validated 2/2 in a scratch copy. All 16 Rust failures were mine (changed spelling, advice and
presentation expectations), fixed with targeted reruns. The full script is not
rerun or represented as green. The final advice-safety guards and small wording
changes were made after its Rust build and have separate affected/guide checks.

Wasm: **2,042,203 B raw / 593,573 B gzip**, cap **593,719 B**, **146 B headroom**.
Freshly built by the full suite, SHA-256
`75104fe4882479ef2bfd8796df9d655853739084640c11457cffbb50309a6e2c`;
see `wasm.json`. No wasm runtime source changed afterward.

LLP 3000.007 §23 records the spelling decisions and deliberate refusals. Updated
cards: language, maintains, bounds, rules, sync, prediction, E_NOT_PREDICTABLE and
N_NEVER_COMPLETE, E_QUARRY_UNSUPPORTED and from-sql. The existing guide fact-home entries were updated to match accepted length aliases. One journal entry accompanies the change.

Captured log formatting is normalized only for trailing whitespace and blank
lines at EOF; outcomes and the exact script summary are preserved. Both root
inventory runs produced identical findings. Source/patch whitespace checks pass.
