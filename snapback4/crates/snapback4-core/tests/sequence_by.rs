use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState, rows::Rows, store::Store, value::object};
use std::collections::BTreeMap;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/sequence-by.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn ctx(fields: &[(&str, Value)]) -> Context {
    Context::new("alice", fields.iter().map(|(k, v)| ((*k).into(), v.clone())).collect()).at(1000)
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn sent(out: MutationOutcome) -> Value {
    match out.state {
        WriteState::Sent { result, .. } => result,
        other => panic!("{other:?}"),
    }
}
fn send(e: &mut Engine, body: &str) -> Value {
    sent(
        e.mutate("send", None, ctx(&[("conversationId", id("c")), ("body", Value::String(body.into()))]))
            .unwrap(),
    )
}
fn engine(store: Store) -> Engine {
    let b = bound(SOURCE);
    Engine::new(store, b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}

#[test]
fn dense_shared_counters_rollback_noop_delete_upsert_and_reopen() {
    let dir = std::env::temp_dir().join(format!("sb4-sequences-{}-{}", std::process::id(), snapback4_core::ids::seed()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    for disk in [false, true] {
        let mut e = engine(if disk { Store::open(&path).unwrap() } else { Store::memory().unwrap() });
        let first = send(&mut e, "one");
        assert_eq!(first.field("ordinal"), Ok(&Value::Int(1)));
        assert!(first.field("pending").is_err());
        let join = ctx(&[("conversationId", id("c")), ("who", id("bob"))]);
        let member = sent(e.mutate("join", None, join.clone()).unwrap());
        assert_eq!(member.field("joinedAt"), Ok(&Value::Int(2)));
        assert_eq!(sent(e.mutate("join", None, join).unwrap()), Value::Null);
        let failed = e.mutate("fail", None, ctx(&[("conversationId", id("c"))])).unwrap();
        assert!(matches!(failed.state, WriteState::Failed { .. }));
        let pair = sent(e.mutate("pair", None, ctx(&[("conversationId", id("c"))])).unwrap());
        assert_eq!(pair.field("ordinal"), Ok(&Value::Int(4)));
        let other = sent(
            e.mutate("send", None, ctx(&[("conversationId", id("other")), ("body", Value::String("other".into()))]))
                .unwrap(),
        );
        assert_eq!(other.field("ordinal"), Ok(&Value::Int(1)));
        let move_ = e
            .mutate(
                "move",
                None,
                ctx(&[("messageId", first.field("id").unwrap().clone()), ("conversationId", id("other"))]),
            )
            .unwrap();
        assert!(matches!(move_.state, WriteState::Failed { .. }));
        sent(e.mutate("remove", None, ctx(&[("messageId", pair.field("id").unwrap().clone())])).unwrap());
        assert_eq!(send(&mut e, "five").field("ordinal"), Ok(&Value::Int(5)));
        if disk {
            drop(e);
            e = Engine::open(Store::open(&path).unwrap()).unwrap();
        }
        let put = sent(
            e.mutate("put", None, ctx(&[("conversationId", id("c")), ("body", Value::String("six".into()))]))
                .unwrap(),
        );
        assert_eq!(put.field("ordinal"), Ok(&Value::Int(6)));
        let again = sent(
            e.mutate("put", None, ctx(&[("conversationId", id("c")), ("body", Value::String("six".into()))]))
                .unwrap(),
        );
        assert_eq!(again.field("ordinal"), Ok(&Value::Int(6)));
        assert_eq!(send(&mut e, "seven").field("ordinal"), Ok(&Value::Int(7)));
        let page = e.query("history", ctx(&[("conversationId", id("c"))])).unwrap();
        let rows = page.data.as_array().unwrap();
        assert_eq!(rows.iter().map(|r| r.field("ordinal").unwrap().as_int().unwrap()).collect::<Vec<_>>(), [7, 6]);
        let next = e
            .query("history", ctx(&[("conversationId", id("c")), ("c", Value::String(page.next.unwrap()))]))
            .unwrap();
        assert_eq!(
            next.data
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r.field("ordinal").unwrap().as_int().unwrap())
                .collect::<Vec<_>>(),
            [5, 1]
        );
        let oldest = e.query("oldest", ctx(&[("conversationId", id("c"))])).unwrap();
        assert_eq!(oldest.data.as_array().unwrap()[0].field("ordinal"), Ok(&Value::Int(1)));
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn raw_inputs_import_and_restoration_keep_counters_honest() {
    let mut e = engine(Store::memory().unwrap());
    let row = object([
        ("id", id("raw")),
        ("conversationId", id("c")),
        ("body", Value::String("raw".into())),
        ("ordinal", Value::Int(9000)),
    ]);
    for load in [false, true] {
        let error = if load {
            e.load([("messages".into(), row.clone())])
        } else {
            e.seed([("messages".into(), row.clone())])
        }
        .unwrap_err();
        let refusal = error.refusal();
        assert_eq!(refusal.code, "E_SEQUENCE_SUPPLIED");
        assert!(refusal.rewrite.is_some());
    }
    assert_eq!(send(&mut e, "one").field("ordinal"), Ok(&Value::Int(1)));
    e.load_trusted([("messages".into(), row)]).unwrap();
    assert_eq!(send(&mut e, "after restore").field("ordinal"), Ok(&Value::Int(9001)));
    let imported = object([("id", id("imported")), ("conversationId", id("c")), ("body", Value::String("imported".into()))]);
    e.load([("messages".into(), imported)]).unwrap();
    assert_eq!(send(&mut e, "after import").field("ordinal"), Ok(&Value::Int(9003)));
}

#[test]
fn adding_or_rebinding_sequence_on_populated_table_refuses_adoption() {
    let old = SOURCE.replace("ordinal: sequence by conversationId", "ordinal: int default 0");
    let b = bound(&old);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    send(&mut e, "old");
    let b = bound(SOURCE);
    let error = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err();
    assert_eq!(error.code(), "E_ADOPT");
    assert!(error.to_string().contains("empty"));
    let b = bound(&SOURCE.replace("ordinal: sequence by conversationId", "ordinal: int default 0"));
    let mut empty = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let b = bound(SOURCE);
    empty.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(send(&mut empty, "new").field("ordinal"), Ok(&Value::Int(1)));
}

#[test]
fn store_counter_rollback_and_reset_are_atomic() {
    let mut store = Store::memory().unwrap();
    let b = bound(SOURCE);
    store.install(&b.schema).unwrap();
    {
        let tx = store.transaction().unwrap();
        tx.set_sequence("conversations", "c", 7).unwrap();
        tx.rollback().unwrap();
    }
    {
        let tx = store.transaction().unwrap();
        assert_eq!(tx.sequence_value("conversations", "c").unwrap(), 0);
        tx.set_sequence("conversations", "c", 7).unwrap();
        tx.commit().unwrap();
    }
    // Reset is the existing explicit device/store installation transaction.
    store
        .conn()
        .execute_batch("CREATE TABLE _device_base (x); CREATE TABLE _device_snapshot (x);")
        .unwrap();
    store.install_device(&b.schema, &BTreeMap::new(), true).unwrap();
    let tx = store.transaction().unwrap();
    assert_eq!(tx.sequence_value("conversations", "c").unwrap(), 0);
    tx.rollback().unwrap();
}

#[test]
fn adding_a_new_sequence_column_to_existing_rows_refuses() {
    let old = "table parents:\n  public 'test'\n  online only\ntable children:\n  parent: parents\n  public 'test'\n  online only\n";
    let b = bound(old);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("children".into(), object([("id", id("existing")), ("parent", id("p"))]))]).unwrap();
    let b = bound(&old.replace("  parent: parents", "  parent: parents\n  ordinal: sequence by parent"));
    let error = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err();
    assert_eq!(error.code(), "E_ADOPT");
    assert!(error.to_string().contains("no implicit backfill"));
}

#[test]
fn several_columns_allocate_in_name_order_and_exhaustion_rolls_back() {
    let source = "table parents:\n  public 'test'\n  online only\ntable children:\n  parent: parents\n  first: sequence by parent\n  second: sequence by parent\n  public 'test'\n  insert <- allow\n  online only\nmutation add(parent: parents):\n  return insert children { parent }\n";
    let b = bound(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let out = sent(e.mutate("add", Some("once"), ctx(&[("parent", id("p"))])).unwrap());
    assert_eq!(out.field("first"), Ok(&Value::Int(1)));
    assert_eq!(out.field("second"), Ok(&Value::Int(2)));
    let replay = e.mutate("add", Some("once"), ctx(&[("parent", id("p"))])).unwrap();
    assert!(matches!(replay.state, WriteState::Sent { .. }));
    let out = sent(e.mutate("add", None, ctx(&[("parent", id("p"))])).unwrap());
    assert_eq!(out.field("first"), Ok(&Value::Int(3)));
    e.load_trusted([(
        "children".into(),
        object([
            ("id", id("high")),
            ("parent", id("p")),
            ("first", Value::Int(snapback4_core::value::I53_MAX - 1)),
            ("second", Value::Int(snapback4_core::value::I53_MAX)),
        ]),
    )])
    .unwrap();
    let failure = e.mutate("add", None, ctx(&[("parent", id("p"))])).unwrap();
    let WriteState::Failed { why, .. } = failure.state else {
        panic!("{failure:?}")
    };
    assert_eq!(why.code, "E_SEQUENCE_EXHAUSTED");
    assert!(why.rewrite.is_some());
    assert_eq!(
        sent(e.mutate("add", None, ctx(&[("parent", id("other"))])).unwrap()).field("first"),
        Ok(&Value::Int(1))
    );
}

#[test]
fn device_only_floor_exhaustion_queues_instead_of_refusing_the_write() {
    use snapback4_core::{engine::local, meter::Ceilings};
    let source = SOURCE.replace(
        "ordinal: sequence by conversationId",
        "ordinal: sequence by conversationId\n  payload: text <=20000 ?",
    );
    let b = bound(&source);
    let mut store = Store::memory().unwrap();
    store.install(&b.schema).unwrap();
    let rows = store.transaction().unwrap();
    let row = object([
        ("id", id("large")),
        ("conversationId", id("c")),
        ("body", Value::String("large".into())),
        ("payload", Value::String("x".repeat(20000))),
        ("ordinal", Value::Int(1)),
    ]);
    rows.put("messages", &b.schema.tables["messages"], &row, None).unwrap();
    let program = &b.programs.iter().find(|p| p.program.name == "send").unwrap().program;
    let error = local::predict(
        &rows,
        &b.schema,
        program,
        ctx(&[("conversationId", id("c")), ("body", Value::String("tiny".into()))]),
        Ceilings {
            heap_bytes: 8192,
            ..Ceilings::default()
        },
    )
    .unwrap_err();
    assert_eq!(error.code(), "E_PREDICT", "floor work belongs to the device allowance: {error}");
    assert!(rows.get("messages", "large").unwrap().is_some());
}

#[test]
fn imports_of_dropped_names_refuse_without_panicking() {
    let mut e = engine(Store::memory().unwrap());
    let b = bound("table remaining:\n  public 'remaining'\n  online only\n");
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for restore in [false, true] {
        let input = [("messages".into(), object([("id", id("dropped"))]))];
        let error = if restore { e.load_trusted(input) } else { e.load(input) }.unwrap_err();
        assert_eq!(error.code(), "E_SCHEMA");
    }
}

#[test]
fn raw_insert_update_and_upsert_cannot_supply_even_the_current_value() {
    use snapback4_core::ir::{Expr, Stmt};
    let b = bound(SOURCE);
    let mut programs: Vec<_> = b.programs.into_iter().map(|p| p.program).collect();
    let row = object([
        ("id", id("forged")),
        ("conversationId", id("c")),
        ("body", Value::String("forged".into())),
        ("ordinal", Value::Int(1)),
    ]);
    for (name, statement) in [
        (
            "rawInsert",
            Stmt::Insert {
                table: "messages".into(),
                row: Expr::Literal(row.clone()),
            },
        ),
        (
            "rawUpdate",
            Stmt::Update {
                table: "messages".into(),
                key: Expr::Literal(id("existing")),
                patch: Expr::Literal(object([("ordinal", Value::Int(1))])),
            },
        ),
        (
            "rawUpsert",
            Stmt::Upsert {
                table: "messages".into(),
                key: Expr::Literal(id("existing")),
                row: Expr::Literal(object([("id", id("existing")), ("ordinal", Value::Int(1))])),
            },
        ),
    ] {
        let mut p = programs[0].clone();
        p.name = name.into();
        p.args.clear();
        p.body = vec![statement];
        programs.push(p);
    }
    let mut e = Engine::memory(b.schema, programs).unwrap();
    e.seed([(
        "messages".into(),
        object([("id", id("existing")), ("conversationId", id("c")), ("body", Value::String("existing".into()))]),
    )])
    .unwrap();
    for name in ["rawInsert", "rawUpdate", "rawUpsert"] {
        let out = e.mutate(name, None, ctx(&[])).unwrap();
        let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
        assert_eq!(why.code, "E_SEQUENCE_SUPPLIED");
        assert!(why.rewrite.is_some());
    }
    assert_eq!(send(&mut e, "after refusals").field("ordinal"), Ok(&Value::Int(2)));
}

#[test]
fn exhausted_counters_stay_behind_authority() {
    let source = SOURCE.replace(
        "public 'sequence test messages'\n  insert <- allow",
        "public 'sequence test messages'\n  insert <- .body != 'denied'",
    );
    for high in [2, snapback4_core::value::I53_MAX] {
        let b = bound(&source);
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        e.load_trusted([
            (
                "members".into(),
                object([
                    ("id", id("member")),
                    ("conversationId", id("c")),
                    ("principal", id("alice")),
                    ("joinedAt", Value::Int(high - 1)),
                ]),
            ),
            (
                "messages".into(),
                object([
                    ("id", id("last")),
                    ("conversationId", id("c")),
                    ("body", Value::String("last".into())),
                    ("ordinal", Value::Int(high)),
                ]),
            ),
        ])
        .unwrap();
        for (op, expected) in [("send", "E_RULE"), ("put", "NOT_FOUND")] {
            let out = e
                .mutate(op, None, ctx(&[("conversationId", id("c")), ("body", Value::String("denied".into()))]))
                .unwrap();
            let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
            assert_eq!(why.code, expected, "{op} must not disclose counter {high}");
        }
        {
            assert_eq!(
                sent(e.mutate("join", None, ctx(&[("conversationId", id("c")), ("who", id("alice"))])).unwrap()),
                Value::Null
            );
        }
        let out = e
            .mutate("send", None, ctx(&[("conversationId", id("c")), ("body", Value::String("allowed".into()))]))
            .unwrap();
        if high == 2 {
            assert_eq!(sent(out).field("ordinal"), Ok(&Value::Int(3)));
        } else {
            let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
            assert_eq!(why.code, "E_SEQUENCE_EXHAUSTED");
        }
    }
}

#[test]
fn descending_restoration_keeps_the_high_water_mark() {
    let mut e = engine(Store::memory().unwrap());
    for (name, ordinal) in [("ten", 10), ("one", 1)] {
        e.load_trusted([("messages".into(), object([
            ("id", id(name)), ("conversationId", id("c")),
            ("body", Value::String(name.into())), ("ordinal", Value::Int(ordinal)),
        ]))]).unwrap();
    }
    assert_eq!(send(&mut e, "eleven").field("ordinal"), Ok(&Value::Int(11)));
}

#[test]
fn bulk_seed_captures_assigned_ordinals_in_either_row_order() {
    let source = format!("{SOURCE}\ntable receipts:\n  messageId: messages\n  immutable messageId\n  public 'receipts'\n  sync public\nview receiptsByOrdinal: count receipts by messageId.ordinal\nquery totals():\n  return receiptsByOrdinal first 10 by byId\n");
    for reverse in [false, true] {
        let b = bound(&source);
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let mut rows = vec![
            ("messages".into(), object([("id", id("m")), ("conversationId", id("c")), ("body", Value::String("seed".into()))])),
            ("receipts".into(), object([("id", id("r")), ("messageId", id("m"))])),
        ];
        if reverse { rows.reverse(); }
        assert_eq!(e.seed(rows).unwrap(), 2);
        let total = e.query("totals", ctx(&[])).unwrap().data;
        let rows = total.as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].field("messageId.ordinal"), Ok(&Value::Int(1)));
        assert_eq!(rows[0].field("value"), Ok(&Value::Int(1)));
        assert_eq!(send(&mut e, "next").field("ordinal"), Ok(&Value::Int(2)));
        // Staging several shared allocations must not leak on a later refusal.
        let failed = vec![
            ("messages".into(), object([("id", id("failed")), ("conversationId", id("c")), ("body", Value::String("failed".into()))])),
            ("messages".into(), object([("id", id("bad")), ("conversationId", id("c")), ("body", Value::String("x".repeat(41)))])),
        ];
        assert!(e.seed(failed).is_err());
        assert_eq!(send(&mut e, "after rollback").field("ordinal"), Ok(&Value::Int(3)));
        // A non-target table still draws from the same preview counter.
        e.seed([
            ("members".into(), object([("id", id("member")), ("conversationId", id("c")), ("principal", id("alice"))])),
            ("receipts".into(), object([("id", id("r2")), ("messageId", id("m2"))])),
            ("messages".into(), object([("id", id("m2")), ("conversationId", id("c")), ("body", Value::String("second".into()))])),
        ]).unwrap();
        let totals = e.query("totals", ctx(&[])).unwrap().data;
        assert!(totals.as_array().unwrap().iter().any(|row| row.field("messageId.ordinal") == Ok(&Value::Int(5))));
        assert_eq!(send(&mut e, "six").field("ordinal"), Ok(&Value::Int(6)));
    }
}

#[test]
fn parent_rewrites_distinguish_import_retargeting_from_bad_types() {
    let mut e = engine(Store::memory().unwrap());
    let row = send(&mut e, "existing");
    let error = e.load([("messages".into(), object([
        ("id", row.field("id").unwrap().clone()), ("conversationId", id("other")), ("body", Value::String("existing".into())),
    ]))]).unwrap_err().refusal();
    assert_eq!(error.code, "E_SEQUENCE_PARENT");
    assert_eq!(error.rewrite.as_deref(), Some("import a new row id; do not retarget a sequence parent"));
    let error = snapback4_core::error::RuntimeError::Structural {
        code: "E_SEQUENCE_PARENT", message: "messages.parent must be a required parent reference (guide types)".into(),
    }.refusal();
    assert_eq!(error.rewrite.as_deref(), Some("declare a required reference column: conversationId: conversations; ordinal: sequence by conversationId"));
}

#[test]
fn exhausted_if_absent_cannot_collide_on_a_clamped_sequence() {
    let source = SOURCE.replace("  unique conversationId, body", "  unique conversationId, body\n  unique conversationId, ordinal");
    let source = format!("{source}\nmutation sendAbsent(conversationId: conversations, body: text <=40):\n  return insert messages {{ conversationId, body }} if absent\n");
    for body in ["last", "other"] {
        let b = bound(&source);
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        e.load_trusted([("messages".into(), object([
            ("id", id("last")), ("conversationId", id("c")), ("body", Value::String(body.into())),
            ("ordinal", Value::Int(snapback4_core::value::I53_MAX)),
        ]))]).unwrap();
        let out = e.mutate("sendAbsent", None, ctx(&[("conversationId", id("c")), ("body", Value::String(if body == "other" { "last" } else { "new" }.into()))])).unwrap();
        let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}"); };
        assert_eq!(why.code, "E_SEQUENCE_EXHAUSTED");
        let out = e.mutate("sendAbsent", None, ctx(&[("conversationId", id("c")), ("body", Value::String(body.into()))])).unwrap();
        assert_eq!(sent(out), Value::Null);
    }
}

#[test]
fn denied_sequence_targets_have_identical_refusals_and_meters() {
    use snapback4_core::ir::{Expr, Stmt};
    let source = SOURCE
        .replace("unique conversationId, body", "unique conversationId, body\n  unique conversationId, ordinal")
        .replace("public 'sequence test messages'", "read <- viewer = 'writer'")
        .replace("insert <- allow", "insert <- viewer = 'writer'")
        .replace("update <- allow", "update <- viewer = 'writer'")
        .replace("sync public", "online only");
    let source = format!("{source}\nmutation position(conversationId: conversations, n: int):\n  return upsert messages[conversationId = conversationId, ordinal = n] {{ body: 'target' }}\nmutation retry(conversationId: conversations):\n  return insert messages {{ conversationId, body: 'target' }} if absent\n");
    for op in ["position", "retry", "supplied_retry"] {
        let mut worlds = Vec::new();
        for hidden in [true, false] {
            let mut b = bound(&source);
            // Exercise raw IR too: Quarry rejects supplied insert fields statically.
            let mut raw = b.programs.iter().find(|p| p.program.name == "retry").unwrap().program.clone();
            raw.name = "supplied_retry".into();
            let mut injected = 0;
            for stmt in &mut raw.body {
                if let Stmt::Const { value: Expr::Object(fields), .. } | Stmt::Let { value: Expr::Object(fields), .. } | Stmt::InsertIfAbsent { row: Expr::Object(fields), .. } = stmt {
                    fields.insert("ordinal".into(), Expr::Literal(Value::Int(1)));
                    injected += 1;
                }
            }
            assert_eq!(injected, 1);
            let programs = b.programs.drain(..).map(|p| p.program).chain([raw]);
            let mut e = Engine::memory(b.schema, programs).unwrap();
            if hidden {
                e.seed([("messages".into(), object([("id", id("hidden")), ("conversationId", id("c")), ("body", Value::String("target".into()))]))]).unwrap();
            }
            let args = if op == "position" { vec![("conversationId", id("c")), ("n", Value::Int(1))] } else { vec![("conversationId", id("c"))] };
            let out = e.mutate(op, None, ctx(&args).with_ids(["candidate".into()])).unwrap();
            let WriteState::Failed { why, current } = out.state else { panic!("{out:?}"); };
            assert_eq!(why.code, if op == "position" { "NOT_FOUND" } else if op == "supplied_retry" { "E_SEQUENCE_SUPPLIED" } else { "E_RULE" }, "{op}: {why:?}");
            assert!(current.is_none());
            worlds.push(serde_json::to_vec(&(why, out.metered)).unwrap());
            if !hidden && op != "retry" {
                let authorized = e.mutate(op, None, Context::new("writer", args.into_iter().map(|(k,v)| (k.into(),v)).collect()).with_ids(["authorized".into()])).unwrap();
                let WriteState::Failed { why, .. } = authorized.state else { panic!("{authorized:?}"); };
                assert_eq!(why.code, if op == "position" { "NOT_FOUND" } else { "E_SEQUENCE_SUPPLIED" });
            }
        }
        assert_eq!(worlds[0], worlds[1], "{op}: code, message, detail and every meter field must be byte-identical");
    }
}


#[test]
fn sequence_table_is_lazy_and_its_creation_rolls_back() {
    let mut store = Store::memory().unwrap();
    let exists = |store: &Store| -> bool {
        store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = '_sequences')", [], |r| r.get(0)).unwrap()
    };
    assert!(!exists(&store), "opening a store must not add sequence custody");
    store.install(&Default::default()).unwrap();
    assert!(!exists(&store), "ordinary activation must not add sequence custody");
    let tx = store.read_transaction().unwrap();
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 0);
    tx.rollback().unwrap();
    assert!(!exists(&store), "an absent counter read is read-only");
    let tx = store.transaction().unwrap();
    tx.set_sequence("parents", "p", 7).unwrap();
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 7);
    tx.rollback().unwrap();
    assert!(!exists(&store), "failed first write rolls back DDL too");
    let tx = store.transaction().unwrap();
    tx.set_sequence("parents", "p", 9).unwrap();
    tx.commit().unwrap();
    assert!(exists(&store));
    let tx = store.read_transaction().unwrap();
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 9);
    tx.rollback().unwrap();
    let mut declared = Store::memory().unwrap();
    declared.install(&bound(SOURCE).schema).unwrap();
    assert!(exists(&declared), "sequence activation creates custody before allocation");
}

#[test]
fn sequence_table_creation_inside_a_savepoint_can_be_rolled_back_and_reallocated() {
    let mut store = Store::memory().unwrap();
    let tx = store.transaction().unwrap();
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 0);
    tx.savepoint("alloc").unwrap();
    tx.set_sequence("parents", "p", 7).unwrap();
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 7);
    tx.rollback_to("alloc").unwrap();
    let exists: bool = tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = '_sequences')", [], |r| r.get(0)).unwrap();
    assert!(!exists, "savepoint rollback removes first allocation's DDL");
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 0);
    tx.set_sequence("parents", "p", 9).unwrap();
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 9);
    tx.commit().unwrap();
    let tx = store.read_transaction().unwrap();
    assert_eq!(tx.sequence_value("parents", "p").unwrap(), 9);
}
