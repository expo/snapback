# Snapback 2 text addition checked before execution

**Status:** Closed

## Original report — 2026-09-05

Snapback 2 text `+` passes `check` but fails execution (open, 2026-09-05; Clique L9 fix 1). Reproduce with `snapback/schema.q` containing `table docs:\n  body: text <=2000\n  public\n` and `snapback/probe.q` containing `query probe(a: text <=4, b: text <=4):\n  return a + b\n`; from `snapback2/`, run `export PATH=/opt/homebrew/bin:$PATH SNAPBACK2_COMPILER=$PWD/packages/snapback2/dist/compiler.mjs`, then run `./target/debug/snapback2 check --project /tmp/l9-fix1/bare-plus --json` (exit 0, `{"compilerMs":117.61,"generation":"82d9e90500c6b36831a2608d026d5c26595c13489a315ce7d75790a915ccea3b","ok":true,"operations":1,"schemaCertificate":{"schedules":[]}}`), `./target/debug/snapback2 dev --project /tmp/l9-fix1/bare-plus`, and `./target/debug/snapback2 run probe.probe '{"a":"a b ","b":"c d"}' --as alice --project /tmp/l9-fix1/bare-plus --json` (exit 1, `{"code":"E_TYPE","family":"input","guide":"input/runtime","message":"E_TYPE: expected int, got string","rewrite":"fix the refused input and retry"}`). Quarry carries the left text type through addition and lowers to integer-only IR `Add`; the TypeScript evaluator also refuses `E_TYPE`. Refuse text addition at check or implement it with sound concatenated bounds in both evaluators; L9 only refuses constructed text at the `words` boundary. Regression witness: `words_text_plus_ir_refuses_identically_in_engine_and_twin` in `snapback2/crates/snapback2/tests/quarry_words.rs`.

## 2026-09-11 triage and resolution

**Priority:** P2. **Disposition:** Closed; supported direct Quarry now refuses
text addition during binding, before IR or execution.

The current `quarry/bound.ts::binary` admits time arithmetic explicitly,
handles decimal/money brands, and otherwise requires both arithmetic operands
to be present ints. The old TypeScript data compiler that produced this
check/runtime mismatch was deleted by `090bb82bc`.

**Verification:** a temporary `compileInline` probe used the ticket's exact
schema and `return a + b` operation. `bun test
src/triage-compiler-probe.test.ts` passed on 2026-09-11 by asserting
`ok === false`, `E_QUARRY_TYPE`, and “requires present numeric operands.” The
probe was removed after the run. This satisfies the ticket's permitted
check-time-refusal outcome.
