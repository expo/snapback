//! Quarry-source allocation and per-occurrence rule-hop prices on both runners.
use super::runner::Runner;
use crate::{
    Ceilings, Context, Schema, Value,
    ir::Program,
    meter::{Cut, Meter, Metered},
    rows::{MemoryRows, Rows},
    value::object,
};

fn run(source: &str, name: &str, device: bool) -> (Value, Metered) {
    run_args(source, name, device, Default::default())
}

fn run_args(
    source: &str,
    name: &str,
    device: bool,
    args: std::collections::BTreeMap<String, Value>,
) -> (Value, Metered) {
    run_seeded(source, name, device, args, |_, _| {})
}

fn run_seeded(
    source: &str,
    name: &str,
    device: bool,
    args: std::collections::BTreeMap<String, Value>,
    seed: impl FnOnce(&Schema, &MemoryRows),
) -> (Value, Metered) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // The language dev-dependency links its own core instance in unit tests.
    let schema: Schema =
        crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
    let program: Program = crate::json_codec::from_text(
        &crate::json_codec::to_text(
            &bound
                .programs
                .iter()
                .find(|p| p.program.name == name)
                .unwrap()
                .program,
        )
        .unwrap(),
    )
    .unwrap();
    let rows = MemoryRows::default();
    if let Some(parent) = schema.tables.get("parents") {
        rows.put(
            "parents",
            parent,
            &object([
                ("id", Value::Id("p".into())),
                ("owner", Value::Id("alice".into())),
                ("value", Value::Int(1)),
            ]),
            None,
        )
        .unwrap();
    }
    seed(&schema, &rows);
    let mut runner = Runner::new(
        &rows,
        &schema,
        Context::new("alice", args).at(100),
        Meter::new(Ceilings::default(), Cut::Abort),
        0,
    );
    runner.device = device;
    if device {
        runner.device_allowance = Some(Meter::new(Ceilings::default(), Cut::Abort));
    }
    let result = runner.run(&program).unwrap();
    assert!(runner.charge_output(&result).unwrap());
    assert!(runner.missing_fact.is_none());
    (result, runner.meter.used)
}

#[test]
fn known_default_price_is_independent_of_declared_maximum() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/qe2/empty-owned-default.q");
    for default in ["", "café"] {
        let source = source.replace("default ''", &format!("default '{default}'"));
        let small = source.replace("5000000", "10");
        let mut results = vec![];
        for device in [false, true] {
            let large_result = run(&source, "add", device);
            assert_eq!(large_result, run(&small, "add", device));
            assert!(large_result.1.heap_bytes < 4096);
            if default.is_empty() {
                assert_eq!(large_result.1.heap_bytes, 1_621);
            }
            results.push(large_result);
        }
        assert_eq!(results[0], results[1]);
    }
}

#[test]
fn bound_result_and_sibling_hops_have_equal_server_device_prices() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/qe2/result-cost.q");
    for probes in [1, 2] {
        let source = if probes == 2 {
            source.replace(
                ".parent.value = 1",
                ".parent.value = 1 and .parent.owner = viewer",
            )
        } else {
            source.into()
        };
        for name in ["bound", "discarded"] {
            let server = run(&source, name, false);
            assert_eq!(server, run(&source, name, true));
            assert_eq!(server.1.rule_probes, probes);
            // These measured prices are quoted in guide writes.
            assert_eq!(
                (server.1.heap_bytes, server.1.steps, server.1.output_bytes),
                if name == "bound" {
                    (2316, 20, 70)
                } else {
                    (926, 12, 13)
                }
            );
            assert_eq!(
                server.0,
                if name == "bound" {
                    object([
                        ("photo", Value::Null),
                        ("edited", Value::Bool(false)),
                        ("label", Value::String("".into())),
                    ])
                } else {
                    Value::Bool(true)
                }
            );
            eprintln!("{name}, {probes} hop(s): {:?}", server.1);
        }
    }
}

#[test]
fn inlined_helper_and_branch_keep_the_consumed_insert_result() {
    let source = "table records:\n  note: text <=10 ?\n  public\n  insert <- allow\n  sync public\nfn label(note: text ?): note ?? 'empty'\nmutation add():\n  r = insert records { id: 'r' }\n  if viewer != null:\n    return label(r.note)\n  return 'other'\n";
    for device in [false, true] {
        assert_eq!(run(source, "add", device).0, Value::String("empty".into()));
    }
}

#[test]
fn consumed_if_absent_result_is_still_completed() {
    let source = "table records:\n  note: text <=10 ?\n  public\n  insert <- allow\n  sync public\nmutation add():\n  r = insert records { id: 'r' } if absent\n  require r != null else NOT_FOUND\n  return r.note\n";
    for device in [false, true] {
        assert_eq!(run(source, "add", device).0, Value::Null);
    }
}

#[test]
fn bound_large_insert_charges_each_result_byte_once() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/qe2/bound-insert.q");
    for device in [false, true] {
        let (result, metered) = run_args(
            source,
            "add",
            device,
            [("payload".into(), Value::String("x".repeat(2_400_000)))].into(),
        );
        assert_eq!(result, Value::Null, "the omitted field is completed");
        assert_eq!(metered.heap_bytes, 14_401_017);
    }
}

// @ref LLP 3000.022#14.3 — the complete source reservation composes with
// QE2's total result copy and per-occurrence authorized reference probes.
#[test]
fn private_maintenance_total_results_and_rule_hops_share_all_seven_meters() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/qe2/result-cost.q")
        .replace("table parents:\n", "table parents:\n  total: count kids by .parent\n")
        .replace(".parent.value = 1", ".parent.value = 1 and .parent.owner = viewer");
    for name in ["bound", "discarded"] {
        let seed = |schema: &Schema, rows: &MemoryRows| {
            rows.put("parents", &schema.tables["parents"], &object([
                ("id", Value::Id("p".into())), ("owner", Value::Id("alice".into())),
                ("value", Value::Int(1)), ("total", Value::Int(0)),
            ]), None).unwrap();
        };
        let server = run_seeded(&source, name, false, Default::default(), seed);
        let device = run_seeded(&source, name, true, Default::default(), seed);
        assert_eq!(server, device, "{name}");
        assert_eq!(server.1.rule_probes, 2);
        assert!(server.1.rows_written > 1, "the private maintain was reserved");
    }
}

// @ref LLP 3000#contended-read-serving — a private durable queue position
// changes scheduling, never the predicting caller's logical admission price.
#[test]
fn following_tail_and_total_result_prices_ignore_private_queue_length_and_clock() {
    let source = format!("{}{}\nmutation post():\n  p = insert posts {{id: 'new', authorId: viewer, at: now}}\n  return p.removed\n",
        include_str!("../../../snapback4/tests/timeline/app.q"),
        include_str!("../../../snapback4/tests/timeline/declaration.q"));
    let device = run(&source, "post", true);
    assert_eq!(device.0, Value::Bool(false));
    for tail in [None, Some(crate::value::I53_MIN), Some(0), Some(4_000_000_000_000), Some(crate::value::I53_MAX - 1)] {
        let server = run_seeded(&source, "post", false, Default::default(), |schema, rows| {
            if let Some(at) = tail {
                let t = &schema.timelines[0];
                let table = t.table("Work");
                rows.put(&table, &schema.tables[&table], &object([
                    ("id", Value::Id("old".into())), ("viewerId", Value::Id("someone-else".into())),
                    ("epoch", Value::Null), ("remaining", Value::Int(0)),
                    ("kind", Value::String("delivery".into())), ("actorId", Value::Id("someone-else".into())),
                    ("readerId", Value::Null), ("eventId", Value::Id("old-post".into())),
                    ("cursor", Value::Null), ("admitted", Value::Id("00000000000000000000000000000000".into())),
                    ("at", Value::Int(at)), ("status", Value::String("pending".into())), ("error", Value::Null),
                ]), None).unwrap();
            }
        });
        assert_eq!(server, device, "private tail {tail:?}; all seven meters and result");
    }
}

#[test]
fn receipt_results_complete_ordinary_fields_inside_the_existing_copy_reservation() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/rp-predecessor/schema.q")
        .replace("table messages:\n", "table messages:\n  label: text <=20 default 'ready'\n  note: text <=20 ?\n  extra: json <=100 ?\n  extras: [json <=100] <=2 ?\n")
        + "\nmutation completed():\n  m = insert messages { id: 'new', conversation: 'c', sender: viewer, text: 'hello', at: now }\n  return { label: m.label, note: m.note, photo: m.photo, text: m.text }\n";
    for device in [false, true] {
        let (result, _) = run_seeded(&source, "completed", device, Default::default(), |schema, rows| {
            for (table, row) in [
                ("conversations", object([("id", Value::Id("c".into())), ("creatorId", Value::Id("alice".into())), ("lastOrdinal", Value::Int(0)), ("title", Value::Null)])),
                ("members", object([("id", Value::Id("a".into())), ("conversation", Value::Id("c".into())), ("principal", Value::Id("alice".into())), ("joinedOrdinal", Value::Int(0)), ("seenOrdinal", Value::Int(0)), ("deliveredOrdinal", Value::Int(0))])),
            ] { rows.put(table, &schema.tables[table], &row, None).unwrap(); }
        });
        assert_eq!(result, object([("label", Value::String("ready".into())), ("note", Value::Null), ("photo", Value::Null), ("text", Value::String("hello".into()))]));
    }
}

#[test]
fn live_chain_occurrences_prepay_each_link_on_both_runners() {
    for (rule, probes) in [
        (".message.room.value = 1", 2),
        (".message.room.value = .message.room.value", 4),
        ("true or .message.room.value = 1", 2),
        ("exists witnesses[value = .message.room.value]", 3),
    ] {
        let source = format!("table rooms:\n  value: int\n  public\n  sync public\ntable messages:\n  room: rooms\n  public\n  sync public\ntable witnesses:\n  value: int\n  unique value\n  public\n  sync public\ntable children:\n  message: messages\n  public\n  insert <- {rule}\n  sync public\nmutation add():\n  insert children {{ id: 'child', message: 'm' }}\n  return true\n");
        let execute = |device| run_seeded(&source,"add",device,Default::default(),|schema,rows| {
            for (table,row) in [
                ("rooms",object([("id",Value::Id("c".into())),("value",Value::Int(1))])),
                ("messages",object([("id",Value::Id("m".into())),("room",Value::Id("c".into()))])),
                ("witnesses",object([("id",Value::Id("w".into())),("value",Value::Int(1))])),
            ] { rows.put(table,&schema.tables[table],&row,None).unwrap(); }
        });
        let server = execute(false);
        assert_eq!(server.1.rule_probes,probes,"{rule}");
        assert_eq!(server,execute(true),"{rule}: all seven public meters and result agree");
    }
}

#[test]
fn final_hop_keys_remain_charged_after_authorized_scratch_is_released() {
    use crate::schema::{RuleExpr, RuleTerm};
    let source = "table parents:\n  value: text <=200\n  public\n  sync public\ntable witnesses:\n  value: text <=200\n  unique byValue: value\n  public\n  sync public\ntable children:\n  parent: parents\n  public\n  sync public\n  insert <- allow\n  after insert <- exists witnesses[value = .parent.value]\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}",bound.diagnostics);
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
    for device in [false,true] {
        let rows = MemoryRows::default();
        rows.put("parents", &schema.tables["parents"], &object([
            ("id",Value::Id("p".into())), ("value",Value::String("x".repeat(200)))
        ]),None).unwrap();
        let mut runner = Runner::new(&rows,&schema,Context::new("alice",Default::default()).at(100),Meter::new(Ceilings::default(),Cut::Abort),0);
        runner.device = device;
        if device { runner.device_allowance = Some(Meter::new(Ceilings::default(),Cut::Abort)); }
        let rule = RuleExpr::Exists { table: "witnesses".into(), index: "byValue".into(), key: vec![RuleTerm::Reference { table:"parents".into(), column:"parent".into(), field:"value".into(), old:false }], equalities:vec![], provenance:crate::ir::KeyProvenance::Shape };
        let key = runner.final_reference_key("children",&rule,&object([("parent",Value::Id("p".into()))])).unwrap().unwrap();
        assert_eq!(key,vec![Value::String("x".repeat(200))]);
        assert!(runner.meter.used.heap_bytes >= 800, "the returned key is still owned after private read scratch ends");
        assert_eq!(runner.meter.used.rule_probes,1);
    }
}
