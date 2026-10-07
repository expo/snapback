# RX — write rules follow live references

2026-10-06; resumed after reboot on 2026-10-07. Base `9bcf6cfb630ea1947ccbfd2b397c5c1c884cd2bf` (0.4.13),
branch `sb4-intent/rx-rule-hops`. All work and measurements use this eb1000
worktree (Linux hostname `expose-builder-pixel`). No other worktree, machine
or lane's processes were used. Nothing pushed or published.

## Result

Write rules now follow up to **three** row-local references, including inside
unique-key probes. Final-insert obligations can resolve the same paths at
transaction end. Every hop is a live authorized point read, every syntactic
occurrence prepays its probe, and missing device coverage withholds prediction.
Private fields, maintained values, ephemeral targets and paths beyond three
hops remain refused with specific reasons and concrete mutation checks.

The exact commission example already works on the base. RX does not claim to
have introduced depth-one probe keys: it preserves them, admits chains and
named-id lookup spelling, and closes a retained-coverage hole exposed by the
new tests. Authorization stays in the table in the client witness; its
`setReaction` mutation contains **no `require`**.

## Baseline and calibration reconstruction

The [tests-first output](./binder-before.log) has two passing tests (ordinary
one-hop comparisons/probe keys, private/over-depth refusals) and two failing
new expectations (chains, final-insert hops), before product edits.
QE2's existing `write_rule_follows_one_authorized_reference` regression also
already contains `exists members[.message.conversation, viewer]`.
A supplemental [published-binary matrix](./published-baseline-matrix.json), run
after implementation, independently checks eleven write forms on the
integrity-verified 0.4.13 CLI and retains each input and exact diagnostic.

| Term/position | Base 0.4.13 | RX | Governing reason |
| --- | --- | --- | --- |
| `.message.conversation` comparison | Accepted | Accepted | LLP 3000.007 §5.4, QE2 live-point semantics |
| `exists members[.message.conversation, viewer]` | Accepted | Accepted | Same term binder inside a unique probe; no separate probe-key prohibition |
| `messages[.message].conversation` | Accepted | Accepted | QE2's documented explicit spelling |
| `messages[id = .message].conversation` | E_QUARRY_RULE_HOP | Accepted, identical lowering | A binder spelling gap, not a documented soundness restriction |
| `.reaction.message.conversation` | E_QUARRY_RULE_HOP | Accepted | QE2's fixed depth-one scope; RX bounds the chain at three and accounts for every read |
| Hop in `after insert` | E_QUARRY_RULE_HOP | Accepted | QE2 excluded this position. Its previous evaluator resolved only focal/viewer/literal keys; RX adds authorized, prepaid, covered resolution at transaction end |
| Target table with a restricted read audience | Accepted, subject to runtime read authority | Accepted on the same terms | Row privacy is not a blanket compiler ban; an unreadable row produces an unknown leaf |
| Private source/target field | E_QUARRY_RULE_HOP | Refused | Disclosure: LLP 3000.015 §1 and 3000.007 §5.4; row readability is not field authority |
| Maintained target or column | E_QUARRY_RULE_HOP | Refused | Cost: LLP 3000.007 §17 and 3000.007.001; a live derived value is not a fixed one-probe field read |
| Ephemeral target | E_QUARRY_RULE_HOP plus ephemeral admission refusal | Refused | Lifetime/authority: LLP 3000.017 §2.1 explicitly forbids ephemeral references, rule probes and durable mutation reads |
| More than three hops | E_QUARRY_RULE_HOP | Refused | RX's fixed shape bound in LLP 3000.007 §5.4; no claim that depth four is intrinsically unsound |
| Arbitrary live read-rule hop | Refused | Refused | LLP 3000.014 §§2–5: whole-parent audience capture, immutable inputs and inherited lifetime, not live traversal |

The distinction between an explicit design rationale and an implementation
boundary matters: QE2 §5.4 names the old depth and final-obligation exclusions;
it does **not** prove that additional hops or final obligations are unsound.
The cost/coverage explanation for lifting those boundaries follows the old
binder and engine code, not invented LLP text.

The decisive baseline text is [LLP 3000.007 §5.4](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md):
“Each term in insert, update and delete rules admits one live typed-reference
hop” and “Deeper hop chains, private/maintained target fields, ephemeral targets
and final after-insert obligations refuse E_QUARRY_RULE_HOP”. The same section
says “Each occurrence prepays one rule probe” and requires “current covered
authority”. These are the old depth, position, cost and prediction boundaries.
[LLP 3000.015 §1](../../../llp/3000.015-shared-baseline-for-snapback5.spec.md)
adds the disclosure rule: a private column “never appears” in a delivered row
or result for anyone other than its owner.
[LLP 3000.017 §2.1](../../../llp/3000.017-ephemeral-tables.rfc.md)
states “Nothing may depend on ephemeral rows except a query's own reads”.
[LLP 3000.014 §2](../../../llp/3000.014-a-child-reads-through-its-parent.rfc.md)
instead says a read-through child “copies the parent's stored captures, never
walking to a live grandparent”. Its QX membership-path spelling is still an
accepted **capture alias** when it spells the whole parent rule and satisfies
the immutable-reference/lifetime requirements; RX does not reclassify it as a
live read-rule hop.

The [preserved M3 log](./cal31-m3-check.log) reports exactly three hop errors:
`messaging.q:12:33`, `27:66`, `28:66`. The read/insertion/update shapes suggested
by the guide and preserved reactions table are:

```quarry
read <- exists members[.message.conversation, viewer]
insert <- .principal = viewer and exists members[.message.conversation, viewer]
update <- .principal = viewer and exists members[.message.conversation, viewer]
```

These reconstruct the **intended predicates**, not the lost spelling. The
first position is consistent with a parent read traversal; the adjacent later
positions are consistent with reactions insert/update membership checks. The
log cannot establish the containing table or recover exact source text. In
particular, every error carries the old **generic** rewrite from the binder's
non-member-base branch, whereas a direct admitted row-local hop has a concrete
rewrite. Known examples reaching that branch include named-key explicit
lookups and an unqualified reference root (`message.conversation`). The latter
inside `  read <- exists members[message.conversation, viewer]` places the
refused dot at column 33 exactly. A simple canonical write hop places its dot
at column 60, not the logged 66. Whitespace, a different expression or both
were present; choosing one as the original would fabricate evidence.

The stronger check is reproducible: restored membership predicates in the
**preserved final calibration schema**, for all three reactions write rules,
compile with the actual published Linux 0.4.13 binary: **28 tables, 62
operations, zero problems**. See [published control](./published-cal31-restored.log),
[verified package integrities](./published-integrity.json),
[the published rules card](./published-guide-rules.txt), and
[input hashes](./calibration-sha256.json). The observed builder workaround is
real, but does not demonstrate that the exact canonical probe-key form was
unsupported. No new calibration score is claimed.

## Enforcement, prediction and prices

`RuleTerm::Reference` keeps its one-hop representation. A new
`ReferenceChain { column, hops, old }` stores the ordered target table/field
pairs; validation checks every link, field visibility, ordinary lifetime,
image selection and the three-hop bound. Named update terms start from the
selected old/next image; delete starts from its pre-delete image. References
are live reads, with no new capture or implicit referential action.

Each link calls the existing authorized point reader. Missing, null, expired
or hidden links yield an unknown leaf, including under `not`, `!=`, `= null`
and negated existence probes. A null **field of an authorized row** remains
an ordinary null value. The chain does not cache a shared prefix across
syntactic occurrences. Scratch follows declared targets; private work stays
inside the request's existing 8,192-row physical allowance.

The shared-runner regression checks the full seven-meter tuple as well as
results on server/device execution. Isolated successful inserts charge:

| Rule | Prepaid rule probes |
| --- | ---: |
| `.message.room.value = 1` | 2 |
| `.message.room.value = .message.room.value` | 4 |
| `true or .message.room.value = 1` | 2 |
| `exists witnesses[value = .message.room.value]` | 3 |

Separate boundary tests set the probe ceiling one below the required amount
and receive E_BOUND even when the path would be short-circuited. Hidden/absent
parents of different sizes have identical public refusal and complete logical
meter tuples. No resource ceiling or target-resolution fence is relaxed.
`check --cost` and `why` list every hop; residency certificates retain distinct
occurrences, every target read rule, final-obligation dependencies and receipt
field dependencies.

Final obligations resolve from their inserted image at transaction end, under
a prepaid authorized scope. Their returned key copies retain a separate heap
reservation based on declared source-field bounds, charged before any hop; they
do not escape the read scratch unpriced. A membership created later in the same mutation
can therefore satisfy the obligation. The final target remains the existing
structural existence check; all rows supplying its key must be readable. A
failed hop rolls back the transaction using the same generic constraint
refusal for absent and hidden parents. On devices the final witness also needs
current coverage. This does not give `after insert` arbitrary Boolean rules,
residual predicates or creation proofs that it did not have before.

The [coverage regression before the fix](./coverage-before.log) caught a
pre-existing problem in `witness_covered`: testing only that a retained row
was *not Left* also admitted **Unknown** scope metadata. Tracked retained and
owner-key witnesses now need affirmative current-row evidence, and retained
absence needs a current group. Until-revoked delivered rows remain their own
current evidence; pending rows still use the ordinary provisional authority
path. The memory/SQLite scenario removes coverage independently for reactions,
messages, conversations and membership witnesses while keeping cached row
images, and confirms E_PREDICT and rollback. It also follows pending parents
and refuses hidden ancestors.

Diagnostics supply actual table/field names and authorized parent bindings,
then the mutation `require`. Private-field repairs additionally require that
field's owner before evaluating the predicate, so masking cannot make `not`
grant authority. Maintained-view repairs name their real group-key arguments
instead of inventing a by-id lookup. Ephemeral authority must first move to
durable data: LLP 3000.017 also forbids using an ephemeral read in a durable
mutation, so moving that predicate alone is not a valid workaround.

## Serialized bytes and the Darwin fence

Changed persisted/catalog representation:

- A depth-two/three term adds the externally tagged JSON variant
  `{"ReferenceChain":{"column":"reaction","hops":[{"table":"reactions","field":"message"},{"table":"messages","field":"conversation"}],"old":false}}`.
- A final obligation still uses `FinalExistsOnInsert { table, index, key }`,
  but its key may now contain `Reference` or `ReferenceChain`.
- Both cases add `rule-reference-v2` to the existing exact
  `Constraint::Capabilities` carrier. Existing ordinary effect references
  also retain `rule-reference` as before.
- Execution-site metadata enumerates prepaid hop occurrences. That changes
  metadata for existing hop operations too. Schema/backend generation identity
  includes the changed representation; persisted schema/backend JSON changes.

Unchanged: application row payloads, capture fields, stored keys/index encoding,
partition-log format, mutation arguments, client answer contract and program
opcodes. Existing one-hop term JSON stays unchanged. Ordinary schemas without
hops retain their old representation; historical lowering/codec controls test
that claim. No catalog format number or package version was bumped.

The integrity-verified **published 0.4.13** wasm and Linux devices reject both
new schema cases on initial open and persisted reopen. Its engine refuses the
persisted generation via `doctor`; the refusal leaves the store unchanged.
The current wasm/native devices open and reopen the same bytes. The dedicated
[client fence tests](../../packages/snapback4/test/rx-rule-hop-capability.test.mjs)
run here without skips; [output](./published-fence.log).

For the Mac witness, extract `snapback4@0.4.13` and
`snapback4-darwin-arm64@0.4.13` under one directory, preserving
`<package-name>/package/`, then run from `snapback4/`:

```sh
RX_PUBLISHED_ROOT=/absolute/path/to/extracted-packages \
  node --test packages/snapback4/test/rx-rule-hop-capability.test.mjs
```

The test selects the actual host platform package. No Darwin execution or
measurement is claimed by this lane.

## Wasm and verification

Locked Binaryen 132, Rust's repository wasm profile, eb1000 Linux:

| Artifact | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Unmodified base rebuilt here | 2,117,335 | 639,888 |
| RX | 2,129,835 | 643,098 |
| Delta | +12,500 | +3,210 |

The cap is **643,228 B = measured Linux + 130 B for macOS**, with no further
headroom. Its change from the inherited cap is 3,287 B: the rebuilt base is
77 B above the previous recorded Linux measurement of 639,811 B. This report
keeps the measured comparison separate from that inherited record. The code
increase pays for the bounded chain codec/interpreter, final-obligation
resolution and affirmative tracked coverage. Whole-artifact measurements,
not per-function attribution. [Control](./wasm-before.log), [RX build](./wasm-final.log).
The earlier [pre-budget-adjustment build](./wasm-after.log) correctly reports the old cap's overrun.

Focused verification: [113 guide, 17 QE2, 10 RX binder and seven server tests](./language-final.log),
[ten shared-runner allocation/meter tests](./core-final.log),
[two memory/SQLite scenarios and nine nullable-key integration cases](./device-final.log),
and [three actual-client/cost tests plus two published-engine fence cases](./client-final.log).
The 11 historical lowering tests also passed in the earlier focused language run.
The resumed **full suite passes: 0 failures in 2,079 seconds** on 2026-10-07.
[Complete output](./full-suite.log.gz), [machine-readable summary](./full-suite-summary.json):

| Stage | Passed | Ignored/skipped |
| --- | ---: | ---: |
| Rust tests and doctests | 5,088 | 33 |
| Client pool, all 325 files | 6,463 | 47 |
| Both serial client-model files | 79 | 0 |
| Fixture wrapper | 9 | 0 |

The build, wasm budget, guide budget, release guard, package typecheck/build,
chat check, and chat/Expo typechecks also pass. Both RX client/fence files run
without skips. [Reference audit](./ref-check.log) and
[affected-source line census](./source-line-audit.json) pass. The positional-key
binder `bind/program.rs` is untouched.

The first full run was superseded during the final audit. Its Rust stage found
an obsolete final-hop refusal expectation and diagnostic-repair assertions;
the fixes pass in the focused results above. It was interrupted during client
tests after the final source was ready. Its [output](./full-suite-before.log.gz) and [starting digest](./source-sha256-before.json)
are retained as development evidence, not final qualification. The new full run
uses the unchanged [final source digest](./source-sha256.json).

The subsequent full rerun was killed by the eb1000 reboot at about
2026-10-06 08:45Z, after its build/wasm/guide/typecheck stages. Its
[partial output](./full-suite-reboot-interrupted.log.gz) is not a completed
qualification. On 2026-10-07, `git status`, staged/unstaged diffs and every
final source digest were rechecked: all 28 hashed source/metric files matched,
and none of this lane's old test processes remained. The entire suite was
restarted with the same flags and published-engine controls.

All Cargo work uses eight jobs, `CARGO_INCREMENTAL=0`, dev/test debug information
disabled, and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Node is
24.13.1. The guide stays at 374 lines and passes its unchanged word budget.
The worktree was below 6 GB before the full-suite inventory build and 14 GB
after it. Final worktree use is 16.63 GiB; the largest sampled `du -sh`
was 17G, below the 40 GB limit. Exact bytes are in the qualification summary.

### Native-export status finding during the full suite

The [first complete-source run](./full-suite-export-status.log.gz)
([summary](./full-suite-export-status-summary.json)) passed all 5,088 Rust tests/doctests (33 ignored)
but its client pool hit one failure in unchanged `export-native.test.mjs:88`:
the wrapper returned 1 instead of preserving a mock export child's status 7.
The assertion did not retain that invocation's stdout/stderr. The full-file
[isolated rerun](./export-native-rerun.log) passed nine tests with its usual
Darwin-only skip; [20 serial trials](./export-native-control.json) and
[40 concurrency-eight trials](./export-native-parallel.json) of the failing
case also passed. Cause and baseline inheritance are **unconfirmed**.

[The follow-up ticket](../../../issues/20261006-snapback4-native-export-status-intermittent.md)
keeps the observation open and asks for subprocess diagnostics before any
change to the status/cleanup contract. No exporter code, expectation, deadline
or test count was changed by RX. The resumed complete suite passes, including
this case in the ordinary client pool; that pass does not erase the observed
failure or establish its cause.

## Governing context

The `llp-orient` skill was read in this worktree after initializing only the
small pinned `vendor/llp` submodule. Scope: the rule binder, schema admission,
shared engine, prediction dependency certificates, device coverage and CLI
cost explanation. The context pack is:

- LLP 3000 root/§7 and LLP 2000.000 §§5–7: one shared interpreter, runtime
  resource bounds, scoped verification. Root and current design work are in
  `llp/current`; no Snapback 1 inventories/gates are imported.
- LLP 3000.007 §5.4 (in current): QE2 rule semantics and this RX amendment;
  §17–18: private authorization work, fixed public charges and physical bound.
- LLP 3000.014 §§2–5: separate read-through capture, liveness and coverage.
- LLP 3000.015 §1: field disclosure and caller accounting; LLP 3000.017 §2.1:
  ephemeral references and durable-authority exclusion.
- Guide rules, prediction and ephemeral cards: the current authoring forms;
  QE2 report/rounds: retained baseline semantics and allocation regressions.

No new design document or gate was introduced. The existing §5.4 and guide
are amended; the journal is append-only. Hand-off: the user's planned Darwin
qualification and subsequent integration/publication, plus the separate
native-export status investigation linked above.
