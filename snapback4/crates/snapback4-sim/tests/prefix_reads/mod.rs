use super::*;

const SEEK: &str = include_str!("../fixtures/lane-source.q");
const PREFIX: &str = include_str!("../fixtures/prefix-reads.q");

fn engine(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn member(room: &str, viewer: &str, unread: i64) -> (String, Value) {
    ("members".into(), snapback4_core::value::object([("id", id(&format!("{room}-{viewer}"))), ("roomId", id(room)), ("principal", id(viewer)), ("unread", Value::Int(unread))]))
}

fn message(name: &str, room: &str, expires: Value) -> (String, Value) {
    ("messages".into(), snapback4_core::value::object([("id", id(name)), ("roomId", id(room)), ("body", Value::String("coffee".into())), ("at", Value::Int(1)), ("expiresAt", expires)]))
}

#[test]
fn w13c_whole_group_loop_merge_and_exists_run_without_spurious_overflow() {
    let mut engine = engine(PREFIX);
    engine.seed([member("r1", "dev:alice", 3), member("r1", "dev:bob", 5), member("r2", "dev:alice", 7), member("empty", "dev:alice", 0),
        message("a", "r1", Value::Null), message("b", "r1", Value::Null), message("c", "r2", Value::Null)]).unwrap();
    let context = |args| Context::new("dev:alice", args).at(100);
    let roster = engine.query("roster", context(args(&[("roomId", id("r1"))]))).unwrap();
    assert!(roster.complete && roster.next.is_none());
    assert_eq!(roster.data.as_array().unwrap().len(), 2);
    let total = engine.query("unreadTotal", context(args(&[]))).unwrap();
    assert_eq!(total.data, Value::Int(10));
    assert!(total.complete);
    let merge = engine.query("everywhere", context(args(&[("q", Value::String("cof".into()))]))).unwrap();
    assert!(merge.complete);
    assert_eq!(merge.data.as_array().unwrap().len(), 3);
    for (room, expected) in [("r1", true), ("empty", false), ("hidden", false)] {
        let answer = engine.query("hasMessages", context(args(&[("roomId", id(room))]))).unwrap();
        assert_eq!(answer.data, Value::Bool(expected));
        assert!(answer.complete && answer.next.is_none(), "{answer:?}");
        println!("exists {room}: examined={} probes={} complete={}", answer.metered.examined, answer.metered.rule_probes, answer.complete);
    }
    let grouped = engine.query("grouped", context(args(&[("q", Value::String("cof".into()))]))).unwrap();
    assert!(grouped.complete, "{grouped:?}");
    assert_eq!(grouped.data.as_array().unwrap().len(), 2);
    let bump = engine.mutate("bump", Some("bump"), context(args(&[("roomId", id("r1"))]))).unwrap();
    assert!(matches!(bump.state, WriteState::Sent { .. }));
    assert_eq!(engine.query("unreadTotal", context(args(&[]))).unwrap().data, Value::Int(11));
}

#[test]
fn w13c_nine_thousand_row_uniform_loop_is_meter_capped() {
    let mut engine = engine(PREFIX);
    engine.seed((0..9000).map(|n| member(&format!("r{n:05}"), "dev:alice", 1))).unwrap();
    let answer = engine.query("unreadTotal", Context::new("dev:alice", args(&[]))).unwrap();
    assert!(!answer.complete && answer.next.is_none() && answer.capped_at.is_some(), "{answer:?}");
    assert_eq!(answer.data, Value::Int(snapback4_core::Ceilings::default().examined as i64));
    assert_eq!(answer.cut, Some(snapback4_core::engine::ReadCut::Meter));
    println!("9000-row loop: returned={} examined={} probes={} complete={} cut={:?}", answer.data.as_int().unwrap(), answer.metered.examined, answer.metered.rule_probes, answer.complete, answer.cut);
}

#[test]
fn w13c_hidden_prefix_worlds_are_identical_and_expired_only_is_false() {
    let mut answers = Vec::new();
    for hidden in [false, true] {
        let mut engine = engine(PREFIX);
        engine.seed([member("live", "dev:alice", 0), message("expired", "live", Value::Int(50))]).unwrap();
        if hidden { engine.seed([message("secret", "hidden", Value::Null)]).unwrap(); }
        let mut world = Vec::new();
        for op in ["hasMessages", "hasMatches"] {
            let input = |room| if op == "hasMessages" { args(&[("roomId", id(room))]) } else { args(&[("roomId", id(room)), ("q", Value::String("cof".into()))]) };
            let hidden = engine.query(op, Context::new("dev:alice", input("hidden")).at(100)).unwrap();
            assert_eq!(hidden.data, Value::Bool(false));
            world.push((hidden.data, hidden.metered, hidden.complete, hidden.next, hidden.cut));
            let expired = engine.query(op, Context::new("dev:alice", input("live")).at(100)).unwrap();
            assert_eq!(expired.data, Value::Bool(false));
            assert!(expired.complete);
            assert_eq!(expired.metered.examined, 1);
        }
        answers.push(world);
    }
    assert_eq!(answers[0], answers[1]);
}

#[test]
fn w13c_undefined_compiler_temporaries_are_internal_with_operation_and_site() {
    use snapback4_core::ir::{Expr, Stmt};
    let bound = snapback4_lang::compile(&[("schema.q".into(), "query broken():\n  return 1\n".into())]);
    for expr in [Expr::Variable("$missing".into()), Expr::Field { base: Box::new(Expr::Variable("$missing".into())), name: "id".into() }] {
        let mut program = bound.programs[0].program.clone();
        program.body = vec![Stmt::Return(expr)];
        let mut engine = Engine::memory(bound.schema.clone(), [program]).unwrap();
        let error = engine.query("broken", Context::new("dev:alice", args(&[]))).unwrap_err();
        assert_eq!(error.code, "E_INTERNAL");
        assert!(error.message.contains("broken:1"));
        assert!(!error.message.contains("$missing"));
        println!("{}", error.message);
    }
}

#[test]
fn w13c_rule_exists_keeps_one_probe_across_expired_siblings() {
    let source = "table permits:\n  room: text <=10\n  until: time ?\n  by byRoom: room\n  by byExpiry: until\n  expire at .until\n  read <- deny\ntable targets:\n  room: text <=10\n  by byRoom: room, id\n  read <- exists permits[room = .room]\nquery check():\n  return targets['g'] first 1 by byRoom\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let bytes = serde_json::to_string(&bound.schema.tables["targets"].rules.read).unwrap();
    assert_eq!(bytes, r#"{"Exists":{"table":"permits","index":"byRoom","key":[{"Field":"room"}],"provenance":"Shape"}}"#);
    println!("rule exists serialization: {bytes}");
    for live in [false, true] {
        let mut observations = Vec::new();
        for expired in [0, 9000] {
            let mut engine = engine(source);
            let mut seed = (0..expired).map(|n| ("permits".into(), snapback4_core::value::object([("id", id(&format!("e{n:05}"))), ("room", Value::String("g".into())), ("until", Value::Int(1))]))).collect::<Vec<_>>();
            if live { seed.push(("permits".into(), snapback4_core::value::object([("id", id("live")), ("room", Value::String("g".into())), ("until", Value::Null)]))); }
            seed.push(("targets".into(), snapback4_core::value::object([("id", id("target")), ("room", Value::String("g".into()))])));
            engine.seed(seed).unwrap();
            let answer = engine.query("check", Context::new("dev:alice", args(&[])).at(100)).unwrap();
            assert_eq!(answer.metered.rule_probes, 1);
            assert_eq!(answer.metered.examined, u64::from(live));
            assert_eq!(answer.data.as_array().unwrap().len(), usize::from(live));
            observations.push((answer.data, answer.metered, answer.complete));
        }
        assert_eq!(observations[0], observations[1]);
    }
}

#[test]
fn w13c_existence_cut_before_a_live_match_returns_false_on_a_capped_answer() {
    let mut engine = engine(PREFIX);
    engine.seed([member("r1", "dev:alice", 0), message("a", "r1", Value::Int(1)), message("b", "r1", Value::Int(1)), message("c", "r1", Value::Null)]).unwrap();
    engine.set_ceilings(snapback4_core::Ceilings { examined: 2, ..Default::default() });
    let answer = engine.query("hasMessages", Context::new("dev:alice", args(&[("roomId", id("r1"))])).at(100)).unwrap();
    assert_eq!(answer.data, Value::Bool(false));
    assert!(!answer.complete && answer.next.is_none());
    assert_eq!(answer.cut, Some(snapback4_core::engine::ReadCut::Meter));
}

#[test]
fn w13c_lane_source_inline_seek_matches_locals_and_direct_page() {
    for eager in [false, true] {
        let source = if eager { SEEK.replace("last 10 by byHourAt:", "last 10 by byHourAt where .authorId = viewer:") } else { SEEK.into() };
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        for hour in 0..30 {
            engine.seed([("hours".into(), snapback4_core::value::object([("id", id(&format!("h{hour}"))), ("hourAt", Value::Int(hour)), ("bucketId", Value::Int(0))])),
                ("posts".into(), snapback4_core::value::object([("id", id(&format!("p{hour}"))), ("authorId", id("dev:alice")), ("at", Value::Int(hour * 3_600_000)), ("hourAt", Value::Int(hour))]))]).unwrap();
        }
        let context = || Context::new("dev:alice", args(&[("at", Value::Int(29 * 3_600_000))]));
        let inline = engine.query("inline", context()).unwrap();
        let locals = engine.query("bound", context()).unwrap();
        assert_eq!(inline.data, locals.data);
        assert_eq!(inline.data.as_array().unwrap().len(), 10);
        assert!(inline.complete && inline.next.is_some());
        assert_eq!(engine.query("direct", context()).unwrap().data.as_array().unwrap().len(), 25);
        let key = engine.query("keyExpression", context()).unwrap();
        assert!(key.complete);
        assert_eq!(key.data.as_array().unwrap()[0].field("hourAt").unwrap(), &Value::Int(24));
        let filtered = engine.query("sourceFilter", context()).unwrap();
        assert_eq!(filtered.data, inline.data);
        assert!(filtered.complete);
        println!("lane source eager={eager}: inline=10 bound=10 direct=25 key=10 where=10; examined inline={} bound={}", inline.metered.examined, locals.metered.examined);
    }
}

mod first_witness {
    const DEVICE: bool = false;
    use snapback4_core::{Context, Engine, Value, engine::QueryOutcome, error::Refusal};
    type Query<'a> = dyn FnMut(&str, Context) -> Result<QueryOutcome, Refusal> + 'a;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) {
        let mut engine: Engine = super::engine(source);
        engine.seed(rows).unwrap();
        check(&mut |name, context| engine.query(name, context));
    }
    mod cases { include!("../common/prefix_witness.rs"); }
}
