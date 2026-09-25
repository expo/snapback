#[path = "common/meter.rs"]
mod common;
use common::*;

#[test]
fn measured_ir_programs() {
    let programs = measured_programs();
    let mut engine = engine(programs.clone(), 8);
    for p in programs {
        let started = std::time::Instant::now();
        let result = engine.query(&p.name, context()).unwrap();
        assert!(result.complete, "{result:?}");
        println!("{}: heap={} B, wall={} us, result={:?}", p.name, result.metered.heap_bytes, started.elapsed().as_micros(), result.data);
    }
}

use snapback4_core::ir::*;
use snapback4_core::meter::{Ceilings, Cut, Meter};
use snapback4_core::error::{MeterKind, RuntimeError};
use snapback4_core::value::{Value, object};
use snapback4_core::{Engine, Schema, WriteState};

#[test]
fn heap_cut_stops_queries_and_rolls_back_mutations() {
    for push in [false, true] {
        let programs = vec![
            growing("read", ProgramKind::Query, push, 128),
            growing("write", ProgramKind::Mutation, push, 128),
            growing("small_read", ProgramKind::Query, push, 2),
            growing("small_write", ProgramKind::Mutation, push, 2),
            written(),
        ];
        let mut engine = engine(programs.clone(), 128);
        let result = engine.query("read", context()).unwrap();
        assert!(!result.complete);
        assert_eq!(result.data, Value::Null);
        assert_eq!(result.next, None);
        assert_eq!(result.capped_at.as_ref().map(|cut| cut.0), Some(MeterKind::HeapBytes));
        assert!(result.metered.heap_bytes > Ceilings::default().heap_bytes);
        assert!(result.metered.steps < Ceilings::default().steps);
        assert!(result.metered.examined < Ceilings::default().examined);
        let result = engine.mutate("write", None, context()).unwrap();
        let WriteState::Failed { why, .. } = result.state else { panic!("mutation should abort") };
        assert_eq!(why.code, "E_BOUND");
        assert!(why.message.contains("heap bytes"), "{}", why.message);
        assert!(why.message.contains("16777216"), "{}", why.message);
        assert!(result.metered.heap_bytes > Ceilings::default().heap_bytes);
        assert_eq!(result.events, 0);
        assert_eq!(engine.query("written", context()).unwrap().data, Value::Bool(false));
        println!("{} mutation cut: heap={} B, steps={}", if push { "push" } else { "concat" }, result.metered.heap_bytes, result.metered.steps);
        let mut engine = common::engine(programs, 2);
        let small = engine.query("small_read", context()).unwrap();
        assert!(small.complete);
        assert_eq!(small.data, Value::Int(if push { 128 } else { 8000 }));
        assert!(matches!(engine.mutate("small_write", None, context()).unwrap().state, WriteState::Sent { .. }));
        assert_eq!(engine.query("written", context()).unwrap().data, Value::Bool(true));
    }
}

#[test]
fn heap_meter_allows_the_ceiling_and_records_the_first_cut() {
    for cut in [Cut::Abort, Cut::Cap] {
        let mut meter = Meter::new(Ceilings::default(), cut);
        meter.at("first");
        meter.heap(Ceilings::default().heap_bytes).unwrap();
        let error = meter.heap(1).unwrap_err();
        assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::HeapBytes, actual: 16_777_217, ceiling: 16_777_216, .. }));
        if cut == Cut::Cap {
            meter.at("second");
            meter.heap(1).unwrap_err();
            assert_eq!(meter.capped_at, Some((MeterKind::HeapBytes, "first".into())));
        } else {
            assert_eq!(meter.capped_at, None);
        }
    }
}

#[test]
fn allocating_builtins_charge_the_result_and_keep_their_values() {
    let list = Value::Array(vec![Value::String("one".into()), Value::String("two".into())]);
    let sorted = Value::Array(vec![object([("n", Value::Int(1))]), object([("n", Value::Int(2))])]);
    let cases = vec![
        (Builtin::Concat, vec![Value::String("hi".into()), Value::String("🙂".into())], Value::String("hi🙂".into())),
        (Builtin::Concat, vec![list.clone(), list.clone()], Value::Array(vec![Value::String("one".into()), Value::String("two".into()), Value::String("one".into()), Value::String("two".into())])),
        (Builtin::Slice, vec![Value::String("a🙂z".into()), Value::Int(1), Value::Int(2)], Value::String("🙂".into())),
        (Builtin::Slice, vec![list.clone(), Value::Int(1), Value::Int(2)], Value::Array(vec![Value::String("two".into())])),
        (Builtin::Sort { keys: vec![SortKey { field: "n".into(), order: Order::Asc, optional: false }] }, vec![Value::Array(vec![object([("n", Value::Int(2))]), object([("n", Value::Int(1))])])], sorted),
        (Builtin::MentionTokens, vec![Value::String("@alice, @bob @alice".into())], Value::Array(vec![Value::String("alice".into()), Value::String("bob".into())])),
        (Builtin::Divmod { remainder_sink: "rest".into() }, vec![Value::Int(7), Value::Int(3)], object([("quotient", Value::Int(2)), ("remainder", Value::Int(1)), ("sink", Value::String("rest".into()))])),
    ];
    for (function, args, expected) in cases {
        let copies: u64 = args.iter().map(Value::clone_heap_bytes).sum();
        let p = program("read", ProgramKind::Query, vec![Stmt::Return(builtin(function.clone(), args.into_iter().map(Expr::Literal).collect()))]);
        let mut engine = Engine::memory(Schema::default(), [p]).unwrap();
        let result = engine.query("read", context()).unwrap();
        assert!(result.complete, "{function:?}");
        assert_eq!(result.data, expected, "{function:?}");
        assert!(result.metered.heap_bytes >= copies + fixture_heap(&result.data), "{function:?}: {result:?}");
        engine.set_ceilings(Ceilings { heap_bytes: result.metered.heap_bytes - 1, ..Ceilings::default() });
        let capped = engine.query("read", context()).unwrap();
        assert!(!capped.complete, "{function:?}");
        assert_eq!(capped.capped_at.as_ref().map(|cut| cut.0), Some(MeterKind::HeapBytes));
    }
}

#[test]
fn share_charges_its_recipient_workspace() {
    let recipients = Value::Array(vec![Value::Id("bob".into()), Value::Id("alice".into())]);
    let p = program("read", ProgramKind::Query, vec![Stmt::Return(builtin(Builtin::DeterministicShare, vec![int(7), Expr::Literal(recipients.clone()), Expr::Literal(Value::Id("alice".into()))]))]);
    let mut engine = Engine::memory(Schema::default(), [p]).unwrap();
    let result = engine.query("read", context()).unwrap();
    assert!(result.complete);
    assert_eq!(result.data, Value::Int(4));
    assert!(result.metered.heap_bytes >= recipients.clone_heap_bytes() + fixture_heap(&recipients));
    engine.set_ceilings(Ceilings { heap_bytes: result.metered.heap_bytes - 1, ..Ceilings::default() });
    assert!(!engine.query("read", context()).unwrap().complete);
}

#[test]
fn bindings_and_owned_variable_reads_charge_without_aliasing() {
    let mut row = object([("s", Value::String("x".repeat(4000)))]);
    let shared = row.clone();
    assert_eq!(row.clone_heap_bytes(), 0);
    if let Value::Row(fields) = &mut row { fields.insert("s".into(), Value::Null); }
    assert_ne!(row, shared);
    for value in [Value::String("x".repeat(4000)), Value::Bytes(vec![7; 4000]), Value::Array(vec![shared.clone()]), shared] {
        let p = program("read", ProgramKind::Query, vec![
            Stmt::Let { name: "a".into(), value: Expr::Literal(value.clone()) },
            Stmt::Let { name: "b".into(), value: var("a") },
            Stmt::Assign { name: "a".into(), value: Expr::Literal(Value::Null) },
            Stmt::Return(var("b")),
        ]);
        let mut engine = Engine::memory(Schema::default(), [p]).unwrap();
        let result = engine.query("read", context()).unwrap();
        assert!(result.complete);
        assert_eq!(result.data, value);
        assert!(result.metered.heap_bytes >= 2 * fixture_heap(&value) + 3 * value.clone_heap_bytes());
    }
}

#[test]
fn scalar_inspection_borrows_large_values_but_still_charges_steps() {
    let mut engine = engine(measured_programs(), 8);
    let result = engine.query("count_text_100", context()).unwrap();
    assert_eq!(result.data, Value::Int(4000));
    assert_eq!(result.metered.heap_bytes, 8000, "range iterates under the step meter without materializing its 100 integers");
    assert!(result.metered.steps >= 300);
}

#[test]
fn sha256_charges_utf8_work_before_its_fixed_result_and_rolls_back() {
    let digest = |name: &str, kind: ProgramKind, text: &str| {
        program(name, kind, vec![Stmt::Return(builtin(Builtin::Sha256, vec![self::text(text)]))])
    };
    let write = Program {
        body: vec![
            Stmt::Insert { table: "writes".into(), row: Expr::Literal(object([
                ("id", Value::Id("written-before-cut".into())),
                ("bucket", Value::Int(0)),
                ("body", Value::String("ok".into())),
            ])) },
            Stmt::Return(builtin(Builtin::Sha256, vec![text("abc")])),
        ],
        ..program("write_hash", ProgramKind::Mutation, Vec::new())
    };
    let programs = vec![
        digest("hash_empty", ProgramKind::Query, ""),
        digest("hash_ascii", ProgramKind::Query, "abc"),
        digest("hash_multibyte", ProgramKind::Query, "🙂"),
        program("raw_empty", ProgramKind::Query, vec![Stmt::Return(text(""))]),
        program("raw_ascii", ProgramKind::Query, vec![Stmt::Return(text("abc"))]),
        write,
        written(),
    ];
    let mut full = engine(programs.clone(), 0);
    let empty = full.query("hash_empty", context()).unwrap();
    let ascii = full.query("hash_ascii", context()).unwrap();
    let multibyte = full.query("hash_multibyte", context()).unwrap();
    let raw_empty = full.query("raw_empty", context()).unwrap();
    let raw = full.query("raw_ascii", context()).unwrap();
    assert_eq!(empty.data, Value::String("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into()));
    assert_eq!(ascii.data, Value::String("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into()));
    assert_eq!(empty.metered.steps - raw_empty.metered.steps, 2, "sha256 adds one expression-node step and the mandatory +1 work charge");
    assert_eq!(ascii.metered.steps - empty.metered.steps, 3, "the variable charge is the UTF-8 byte length");
    assert_eq!(multibyte.metered.steps - empty.metered.steps, 4, "the variable charge counts UTF-8 bytes, not characters");
    assert_eq!(ascii.metered.heap_bytes - raw.metered.heap_bytes, 64, "the owned digest string is the fixed output allocation");

    full.set_ceilings(Ceilings { steps: ascii.metered.steps - 1, ..Ceilings::default() });
    assert_eq!(full.query("hash_ascii", context()).unwrap_err().code, "E_BOUND", "a step cut refuses a scalar query");
    full.set_ceilings(Ceilings { heap_bytes: ascii.metered.heap_bytes - 1, ..Ceilings::default() });
    let capped = full.query("hash_ascii", context()).unwrap();
    assert!(!capped.complete);
    assert_eq!(capped.data, Value::Null);
    assert_eq!(capped.capped_at.as_ref().map(|cut| cut.0), Some(MeterKind::HeapBytes));

    let mut measured = engine(programs.clone(), 0);
    let success = measured.mutate("write_hash", None, context()).unwrap();
    assert!(matches!(success.state, WriteState::Sent { .. }));
    assert_eq!(measured.query("written", context()).unwrap().data, Value::Bool(true), "the probe observes a successful mutation before testing rollback");
    let mut cut = engine(programs, 0);
    cut.set_ceilings(Ceilings { steps: success.metered.steps - 1, ..Ceilings::default() });
    let failed = cut.mutate("write_hash", None, context()).unwrap();
    let WriteState::Failed { why, .. } = &failed.state else { panic!("hash step cut must refuse: {failed:?}") };
    assert_eq!(why.code, "E_BOUND");
    assert_eq!(why.family, "bound");
    assert_eq!(success.metered.heap_bytes, failed.metered.heap_bytes + 64, "step refusal precedes digest allocation");
    assert_eq!(failed.events, 0);
    assert_eq!(cut.query("written", context()).unwrap().data, Value::Bool(false), "the preceding insert rolls back with the mutation");
}

// Test-only sizing of public fixture/expression results; no raw pricing API is
// available to interpreter callers.
fn fixture_heap(value: &Value) -> u64 {
    match value {
        Value::String(s) | Value::Id(s) => s.capacity() as u64,
        Value::Bytes(b) => b.capacity() as u64,
        Value::Array(a) => a.capacity() as u64 * std::mem::size_of::<Value>() as u64 + a.iter().map(fixture_heap).sum::<u64>(),
        Value::Row(m) | Value::Map(m) => 40 + m.iter().map(|(k,v)| 80 + k.capacity() as u64 + fixture_heap(v)).sum::<u64>(),
        _ => 0,
    }
}
