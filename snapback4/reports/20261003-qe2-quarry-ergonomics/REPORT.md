# QE2 — Quarry ergonomics from calibration #30

2026-10-03. Base: `9e41df69f36138fdd2570fbfd918b2b9d33294ad` (0.4.12),
branch `sb4-intent/qe2-quarry-ergonomics`. Work and measurements ran locally on
the supplied eb1000 worktree (Linux hostname `expose-builder-pixel`). No other
fleet host was used. Nothing pushed or published.

Calibration #30 scored data modeling 90, down from 92, citing unfamiliar
reference, nullability and rule-expression semantics. This report checks its
three concrete cases; it does not claim a new calibration score.

## Decisions and implementation

1. **Total ordinary write images.** The shared engine completes omitted optional
   insert-result columns as null after applying defaults and write authority.
   The supplied payload remains unchanged; the serialized program IR is unchanged. Defaults retain the writing
   host's `now`/`viewer`; explicit values still win. Update results already use
   the authorized post-write row and retain omitted fields. Owned fields keep
   projection, and sequence/receipt columns keep their engine-assigned result
   paths. Maintained columns remain compile-time
   `E_MAINTAINED_COLUMN_RESULT`, with a fresh authorized-read rewrite. No new
   device opcode is needed. The result copy and added fields are metered;
   raw inserts without a bound result retain their move-only path. Reading an omitted `photo` no longer raises E_FIELD
   and the isolated insert/preview operation remains prediction-eligible.

2. **One live reference hop in write rules.** `.message.conversation` and
   `messages[.message].conversation` lower to a fixed RuleTerm reference with an
   old/next image selector. Insert, named update and delete are supported;
   delete evaluates its pre-delete image. The shared interpreter point-reads
   the target under its read rule. A missing, expired or unreadable target
   yields an unknown leaf: neither negation nor comparison with null turns it
   into authority. Each syntactic hop prepays one rule probe independently of
   short-circuiting. Target dependencies enter the schema-sized reservation;
   nested authority work shares the existing physical walk allowance. Devices
   require current covered authority, including locally pending parents;
   retained-only data cannot supply it. Read-through capture/lifetime semantics
   stay separate. The serialized `rule-reference` capability fences old engines.
   Multiple hops, private/maintained fields, nonordinary targets and final
   after-insert obligations refuse `E_QUARRY_RULE_HOP` with a concrete lookup
   or read-through rewrite. Invalid raw-schema positions are also rejected.

3. **Precise point narrowing; existing enum widening.** An identical unique-key
   `t[k]` becomes non-null after `require exists t[k]`, `require t[k] != null`,
   and inside the present arm of `if t[k] != null`, including helper arguments.
   Stable key identities share the binder's lexical branch/loop joins. Writes,
   including inlined expression helpers, invalidate facts; changed key roots
   cannot reuse them. Job viewer changes clear authority-dependent point facts. No lookup is removed from execution or metering.
   Enum widening to text already exists at the base, including minimum/maximum
   Unicode character bounds; the reported mismatch was the nullable row.
   The guide now states that distinction.

   **Membership does not prove parent existence.** Required references are
   typed ids, not foreign keys. A membership can survive an absent conversation
   even when it is precisely the parent's read-rule witness. Inferring existence
   would admit unsafe programs. QE2 therefore uses the fallback authorized in
   the task: `require exists conversations[conversation] else NOT_FOUND` before
   the TTL call, or bind `conversations[conversation] ! else NOT_FOUND`.
   The diagnostic names that exact repair. An optional *column* still gets its
   own field-level assertion repair; a parent guard cannot make it required.

## Baseline reproduction and the builder source

Before product edits, the original builder's three `.q` files compiled. Five
new regression expectations failed on the unchanged engine/compiler; the sixth
(original-source compile) passed. The retained
[baseline output](./baseline-regressions.txt) shows:

| Calibration case | Unmodified main | QE2 |
| --- | --- | --- |
| Omitted insert `m.photo` | Compiles; mutation fails `E_FIELD: missing field photo` | Null; defaulted `edited` and `at` also present; eligible in isolation |
| Reactions membership rule through message | `E_QUARRY_UNKNOWN: rules cannot traverse .message.conversation` | Compiles and authorizes against the readable message |
| TTL helper after a direct point guard | `E_QUARRY_TYPE: ... enum('off', '24h', '7d') ?` | All three requested guard forms compile |
| Builder source as-is | Compiles | Compiles, sends, replays and emits its preview |
| Builder source with three workarounds reverted | Rule refusals and nullable TTL errors, plus downstream receipt errors | Only three precise parent-guard diagnostics remain |
| Reverted source plus explicit parent guards | Still fails on main | Compiles, sends, replays and emits the restored `m.photo` preview; reactions execute |

The calibration files are copied byte-for-byte into
`crates/snapback4-lang/tests/fixtures/qe2/cal30/`. The regression helper explicitly
removes the three `?? 'off'` occurrences, restores the notification's
`'Photo' if m.photo != null else slice(text, 0, 80)`, and restores the reactions
insert/update membership rules. It separately adds the three explicit parent
guards. Thus the fully reverted source is not silently treated as safe; the
permitted one-line repair is exercised and documented. The retained [final CLI checks](./cli-checks.json) independently pass the original and guarded
projects; the unguarded reverted project reports exactly those three
E_QUARRY_TYPE repairs (lines 264, 296 and 344). Input hashes, including
the original check/failure outputs and worker, are in
[evidence-sha256.json](./evidence-sha256.json).

Both calibration variants create Alice/Bob profiles and a group, send a message,
replay its durable write id, assert the same settlement sequence and one
notification effect with `preview: Hello`, then set a reaction. A replay carries
its durable success without repeating its transient result, as before. Existing
failed write receipts remain failed; this fix does not rewrite their history. The
worker's local provider is not invoked; the durable effect is inspected directly.

The complete calibration `send` remains `predicts: never` in both forms because
writing `messages` evaluates **receipt-derived maintenance `unread`**. This is
independent of `m.photo`. The smaller synced regression predicts total insert
and update images and the one-hop rules on memory, SQLite and wasm.

## Verification

The retained [focused output](./affected-tests.txt) and
[completion checks](./completion-tests.txt) pass **188 distinct Rust tests**
(17 QE2 language, two device stores, 22 existing ergonomics, 112 guide,
11 lowering, five recorded-field and 19 recorded-default checks). All historical lowering hashes remain unchanged. Both wasm/process
[wire tests](./wire-tests.txt) pass. The final compilation inputs are pinned in [source-sha256.json](./source-sha256.json).
The requested full suite completed with **zero failures in 1,995 seconds**:
4,785 Rust tests plus 17 doctests passed (34 existing ignored tests), all 303
client files passed with 6,036 passing tests and 11 existing skips, all 79 model
tests passed, and all nine fixture wrappers passed. Every build, guide-budget,
release-guard and package/app typecheck category passed. The [suite summary](./full-suite-summary.txt),
[complete compressed output](./full-suite.log.gz), and [counts and artifact hashes](./verification.json)
retain the final result. All 41 pinned build/test inputs stayed unchanged through qualification.
`./ref-check --verbose` reported zero errors and zero unchecked references;
all affected Rust sources remain within 1,500 lines and `git diff --check` passes.
Commands use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, eight Cargo jobs, no
incremental compilation and stripped dev/test debug information; these settings
avoid unnecessary cold-worktree disk and memory cost without changing test counts.

- Focused language regressions, existing ergonomics/enum tests and guide tests.
- Shared device scenario over memory and SQLite, including reopen.
- Web wasm and process-backed device scenario through the actual wire dispatcher.
- Full `bash snapback4/scripts/test.sh`, including all Rust tests, compiled guide
  cards, fixture wrappers, package/app typechecks, client files and model tests.
- Reference/metadata audit, source-size and whitespace checks.

The first full run exposed guide size/definition pins, the old wasm cap, and
an omitted-payload default regression in the initial compiler-only attempt.
Completing the engine result instead preserves both omission semantics and all
historical IR hashes. The first run's doctest stage also overlapped a focused
Cargo rebuild and lost a replaced rlib; final qualification runs without a
competing Cargo invocation. These development failures are not counted as passes.

The second run found an unnecessary result-copy reservation on raw literal
inserts in both server and device disclosure matrices. A large seed row then
hit the ordinary heap ceiling before inserting. Result completion now requires
a bound result variable, and a ten-million-character raw-insert regression
protects the original allocation path. That superseded run was stopped before
client tests; its component logs are retained under `target/qe2/full-suite-2-parts/`.
Only this lane's own suite process and its owned children were stopped.

Refusal coverage includes hidden/absent/expired/null references, null comparison
and negation, equal logical meters across absent and differently sized hidden
parents, prepaid probe ceilings, old/next/delete rule images, forbidden hop
positions, raw-schema admission, changed keys, writes in helpers/conditionals,
loop iterations, branch leakage, job authority changes and optional-column repairs.

## Wasm

Pinned Binaryen 132 and the repository wasm build script, measured on this host:

| Artifact | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Unmodified main | 2,048,676 | 617,398 |
| QE2 final build | 2,058,160 | 620,784 |
| Delta | +9,484 | +3,386 (0.55%) |

The increase pays for the rule term's streaming codec, capability declaration
and shared authorization path. Result completion reuses the existing insert-result path; point narrowing stays
in the compiler. The budget is 621,414 bytes: measured Linux plus the **existing
130-byte estimated macOS offset and 500-byte headroom**. No macOS measurement
is claimed; no runtime resource ceiling changes. The initial full run correctly
reported its overrun against the old cap before this justified budget revision.

## Governing context and documentation

The orientation pack comprises LLP 3000.007 §5.2/§5.4 (composition, defaults),
§17–18 (authority and metering), LLP 3000.013 §2.2/§12.3 (point reads and builder
forms), LLP 3000.014 §2 (read-through), and LLP 3000.015 §1–2 (field projection
and shared authority accounting). The earlier 20260927 QE report and rounds
establish existing enum widening and pure-call facts; this work extends point
facts without pretending table-reading helpers are pure. `llp-orient` was read
from the adjacent initialized LLP vendor checkout because this fresh worktree's
vendor link is uninitialized.

Updated the language, types, writes and rules cards and added the dedicated
`why E_QUARRY_RULE_HOP` card. LLP 3000.007 §5.2/§5.4 and LLP 3000.013 §2.2/§12.3
carry dated revisions. The journal records the behavior, validation and byte cost.
