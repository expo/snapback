use snapback4_core::{
    Context, Engine, Value, WriteState,
    meter::Ceilings,
    schema::through::{DEADLINE, PARENT_DEADLINE},
    value::object,
};
const MODEL: &str = include_str!("read_through/lifetime.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    if source.contains("upsert children[id] { parent, body:") {
        assert!(!b.diagnostics.is_empty() && b.diagnostics.iter().all(|d| d.code == "E_QUARRY_IMMUTABLE"), "{:?}", b.diagnostics);
        // Source rejects this arm; keep exercising the external-IR runtime boundary.
        let mut runtime = snapback4_lang::compile(&[("schema.q".into(), source.replace("upsert children[id] { parent, body:", "upsert children[id] { body:"))]);
        assert!(runtime.diagnostics.is_empty(), "{:?}", runtime.diagnostics);
        for program in &mut runtime.programs {
            if program.program.name == "put" {
                for statement in &mut program.program.body {
                    if let snapback4_core::ir::Stmt::WriteTarget { patch: snapback4_core::ir::Expr::Object(fields), .. } = statement {
                        fields.insert("parent".into(), snapback4_core::ir::Expr::Variable("parent".into()));
                    }
                }
            }
        }
        return runtime;
    }
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = bound(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn ctx(viewer: &str, now: i64, args: &[(&str, Value)]) -> Context {
    Context::new(
        viewer,
        args.iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
    .at(now)
}
fn rows(until: Value) -> Vec<(String, Value)> {
    vec![
        (
            "children".into(),
            object([
                ("id", id("c")),
                ("parent", id("p")),
                ("body", Value::String("hello".into())),
                ("until", Value::Null),
            ]),
        ),
        (
            "parents".into(),
            object([("id", id("p")), ("owner", id("alice")), ("until", until)]),
        ),
    ]
}
fn image(e: &Engine) -> Vec<(String, Value)> {
    ["parents", "children"]
        .into_iter()
        .flat_map(|n| {
            e.store()
                .rows(n)
                .unwrap()
                .into_iter()
                .map(move |r| (n.into(), r))
        })
        .collect()
}
fn old_source() -> String {
    MODEL
        .replace(
            "read through .parent",
            "ownerCopy: principal\n  read <- .ownerCopy = viewer",
        )
        .replace(
            "body: 'hello', until",
            "body: 'hello', until, ownerCopy: viewer",
        )
}
fn old_rows(owner: &str, until: Value) -> Vec<(String, Value)> {
    let mut rows = rows(until);
    if let Value::Row(f) | Value::Map(f) = &mut rows[0].1 {
        f.insert("ownerCopy".into(), id(owner));
    }
    rows
}

#[test]
fn immutable_capture_payloads_and_import_parent_replacement_are_atomic() {
    let mut e = engine(MODEL);
    e.seed_at(rows(Value::Null), 100).unwrap();
    let before = image(&e);
    let replacement = vec![(
        "parents".into(),
        object([
            ("id", id("p")),
            ("owner", id("bob")),
            ("until", Value::Null),
        ]),
    )];
    assert!(e.load(replacement).is_err());
    assert_eq!(image(&e), before);
    for field in ["$parent.owner", PARENT_DEADLINE, DEADLINE] {
        let mut input = rows(Value::Null);
        if let Value::Row(f) | Value::Map(f) = &mut input[0].1 {
            f.insert(field.into(), Value::Null);
        }
        assert_eq!(
            e.seed_at(input, 100).unwrap_err().code(),
            "E_RECORDED_FIELD"
        );
        assert_eq!(image(&e), before);
    }
}

#[test]
fn physical_children_block_reuse_until_child_first_sweep() {
    let mut e = engine(MODEL);
    e.seed_at(rows(Value::Int(200)), 100).unwrap();
    let attempt = |e: &mut Engine| {
        e.mutate(
            "parent",
            None,
            ctx(
                "alice",
                200,
                &[
                    ("id", id("p")),
                    ("owner", id("alice")),
                    ("until", Value::Null),
                ],
            ),
        )
        .unwrap()
    };
    assert!(matches!(attempt(&mut e).state, WriteState::Failed { .. }));
    assert_eq!(e.sweep_expired(200, 1).unwrap(), 1);
    assert!(e.store().rows("children").unwrap().is_empty());
    assert_eq!(e.store().rows("parents").unwrap().len(), 1);
    assert_eq!(e.sweep_expired(200, 1).unwrap(), 1);
    assert!(matches!(attempt(&mut e).state, WriteState::Sent { .. }));
}

#[test]
fn restore_recomputes_stale_instant_and_refuses_different_captures() {
    let mut e = engine(MODEL);
    let deadline = snapback4_core::now_ms() + 1_000_000;
    e.seed_at(rows(Value::Int(deadline)), 100).unwrap();
    let mut saved = image(&e);
    if let Value::Row(f) | Value::Map(f) = &mut saved[1].1 {
        f.insert(DEADLINE.into(), Value::Int(i64::MAX));
    }
    let mut restored = engine(MODEL);
    restored.load_trusted(saved.clone()).unwrap();
    assert_eq!(
        restored.store().rows("children").unwrap()[0]
            .field(DEADLINE)
            .unwrap(),
        &Value::Int(deadline)
    );
    let before = image(&restored);
    if let Value::Row(f) | Value::Map(f) = &mut saved[1].1 {
        f.insert("$parent.owner".into(), id("bob"));
    }
    assert!(
        restored
            .load_trusted(saved)
            .unwrap_err()
            .to_string()
            .contains("restored captures")
    );
    assert_eq!(image(&restored), before);
}

#[test]
fn adoption_disagreement_and_missing_parent_publish_nothing() {
    for bad in ["bob", "missing"] {
        let mut e = engine(&old_source());
        let mut input = old_rows(if bad == "bob" { "bob" } else { "alice" }, Value::Null);
        if bad == "missing" {
            input.pop();
        }
        e.load(input).unwrap();
        let before = image(&e);
        let generation = e.generation();
        let b = bound(MODEL);
        let error = e
            .adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 100)
            .unwrap_err();
        assert!(error.to_string().contains("1 child rows"), "{error}");
        assert_eq!(e.generation(), generation);
        assert_eq!(image(&e), before);
    }
}

#[test]
fn activation_retires_under_old_schema_and_reports_shortening() {
    let mut e = engine(&old_source());
    let mut input = old_rows("alice", Value::Int(200));
    e.load(input.clone()).unwrap();
    let b = bound(MODEL);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 100)
        .unwrap();
    assert_eq!(
        e.read_through_shortened().unwrap().get("children"),
        Some(&1)
    );
    let mut e = engine(&old_source());
    if let Value::Row(f) | Value::Map(f) = &mut input[0].1 {
        f.insert("until".into(), Value::Int(50));
    }
    e.load(input).unwrap();
    let b = bound(&MODEL.replace("expire at .until\n  read through", "read through"));
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 100)
        .unwrap();
    assert!(e.store().rows("children").unwrap().is_empty());
}

#[test]
fn three_level_deadline_crosses_middle_without_authored_expiry() {
    let source=MODEL.replace("table children:","table middle:\n  parent: parents\n  immutable parent\n  read through .parent\n  insert <- allow\ntable children:")
        .replace("parent: parents\n  body:","parent: middle\n  body:").replace("mutation child(id: id, parent: parents,","mutation child(id: id, parent: middle,");
    // Remove the parent-pinned page whose parameter now names the root.
    let source = source.split("query page").next().unwrap();
    let mut e = engine(source);
    let mut input = rows(Value::Int(200));
    if let Value::Row(f) | Value::Map(f) = &mut input[0].1 {
        f.insert("parent".into(), id("m"));
    }
    input.insert(
        1,
        (
            "middle".into(),
            object([("id", id("m")), ("parent", id("p"))]),
        ),
    );
    e.seed_at(input, 100).unwrap();
    for table in ["middle", "children"] {
        assert_eq!(
            e.store().rows(table).unwrap()[0].field(DEADLINE).unwrap(),
            &Value::Int(200)
        );
    }
    assert_eq!(
        e.query("childRow", ctx("alice", 200, &[("id", id("c"))]))
            .unwrap()
            .data,
        Value::Null
    );
    assert_eq!(e.sweep_expired(200, 1).unwrap(), 1);
    assert!(e.store().rows("children").unwrap().is_empty());
    assert_eq!(e.sweep_expired(200, 1).unwrap(), 1);
    assert!(e.store().rows("middle").unwrap().is_empty());
    assert_eq!(e.sweep_expired(200, 1).unwrap(), 1);
}

#[test]
fn refusal_worlds_and_reservation_ceilings_match_for_every_insert_arm() {
    let source = format!(
        "{}\nmutation put(id: id, parent: parents):\n  upsert children[id] {{ parent, body: 'hello', until: null }}\nmutation maybe(id: id, parent: parents):\n  insert children {{ id, parent, body: 'hello', until: null }} if absent\n",
        MODEL.replace("update <- allow", "update <- deny")
    );
    for op in ["child", "put", "maybe"] {
        for ceiling in [
            Ceilings::default(),
            Ceilings {
                examined: 0,
                ..Ceilings::default()
            },
            Ceilings {
                heap_bytes: 1000,
                ..Ceilings::default()
            },
        ] {
            let mut outcomes = Vec::new();
            // Same call in all worlds: hidden child+parent, hidden parent alone,
            // absent parent. No input-size difference can explain a meter match.
            for world in 0..3 {
                let mut e = engine(&source);
                if world < 2 {
                    let mut input = rows(Value::Null);
                    if world == 1 {
                        input.remove(0);
                    }
                    e.seed_at(input, 100).unwrap();
                }
                e.set_ceilings(ceiling);
                let args = if op == "child" {
                    vec![("id", id("c")), ("parent", id("p")), ("until", Value::Null)]
                } else {
                    vec![("id", id("c")), ("parent", id("p"))]
                };
                outcomes.push(e.mutate(op, None, ctx("bob", 100, &args)).unwrap());
            }
            for outcome in &outcomes[1..] {
                assert_eq!(outcome.state, outcomes[0].state, "{op}");
                assert_eq!(outcome.metered, outcomes[0].metered, "{op}");
            }
        }
    }
}

#[test]
fn memory_activation_and_restore_share_the_capture_barrier() {
    use snapback4_core::rows::Rows;
    use snapback4_device::{
        memory::MemoryStore,
        store::{DeviceStore, DeviceTx},
    };
    let old = bound(&old_source());
    let next = bound(MODEL);
    let mut m = MemoryStore::new();
    m.activate_server_at(old.schema, 100).unwrap();
    m.restore_server_at(old_rows("alice", Value::Int(200)), 100)
        .unwrap();
    m.activate_server_at(next.schema.clone(), 100).unwrap();
    let tx = m.transaction().unwrap();
    let parent = tx.get("parents", "p").unwrap().unwrap();
    let mut child = tx.get("children", "c").unwrap().unwrap();
    tx.rollback().unwrap();
    if let Value::Row(f) | Value::Map(f) = &mut child {
        f.insert(DEADLINE.into(), Value::Int(999));
    }
    m.restore_server_at(
        vec![("children".into(), child), ("parents".into(), parent)],
        100,
    )
    .unwrap();
    let tx = m.transaction().unwrap();
    assert_eq!(
        tx.get("children", "c")
            .unwrap()
            .unwrap()
            .field(DEADLINE)
            .unwrap(),
        &Value::Int(200)
    );
    tx.rollback().unwrap();
    let before = m.export();
    let mut raw = next.schema;
    raw.tables.get_mut("parents").unwrap().rules.read = snapback4_core::schema::RuleExpr::Deny;
    assert!(m.activate_server_at(raw, 100).is_err());
    assert_eq!(m.export(), before);
}

#[test]
fn cursors_and_dependencies_contain_no_captured_audience() {
    // Every sort value ties; only the complete continuation key can visit
    // each child once across the four pages.
    let source = MODEL.replace("first 20 after c", "first 7 by .body after c");
    let mut e = engine(&source);
    let mut batch = rows(Value::Int(200));
    batch.remove(0);
    for n in 0..25 {
        batch.push((
            "children".into(),
            object([
                ("id", id(&format!("c{n:02}"))),
                ("parent", id("p")),
                ("body", Value::String("hello".into())),
                ("until", Value::Null),
            ]),
        ));
    }
    e.seed_at(batch, 100).unwrap();
    let b = bound(&source);
    let page = e
        .query(
            "page",
            ctx("alice", 100, &[("id", id("p")), ("c", Value::Null)]),
        )
        .unwrap();
    let cursor =
        snapback4_core::cursor::decode_cursor(&b.schema, page.next.as_ref().unwrap()).unwrap();
    assert!(
        cursor.suffix.iter().all(|c| !c.name.starts_with('$')),
        "{cursor:?}"
    );
    assert!(cursor.values.iter().all(|v| v != &id("alice")));
    assert!(page.tables.contains(&"parents".into()));
    assert_eq!(page.next_expiry, Some(200));
    let mut ids = Vec::new();
    let mut page = page;
    let mut exhausted = false;
    for _ in 0..8 {
        ids.extend(page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()));
        let Some(next) = page.next else { assert!(page.complete); exhausted = true; break; };
        page = e.query("page", ctx("alice",100,&[("id",id("p")),("c",Value::String(next))])).unwrap();
    }
    assert!(exhausted,"the cursor chain must end");
    assert_eq!(ids,(0..25).map(|n|format!("c{n:02}")).collect::<Vec<_>>(),"all 25 tied-sort ids must appear exactly once through exhaustion");
    let mut outcomes = Vec::new();
    for hidden in [false, true] {
        let mut e = engine(MODEL);
        if hidden {
            e.seed_at(rows(Value::Null), 100).unwrap();
        }
        outcomes.push(
            e.query(
                "page",
                ctx("bob", 100, &[("id", id("p")), ("c", Value::Null)]),
            )
            .unwrap(),
        );
    }
    assert_eq!(outcomes[0].data, outcomes[1].data);
    assert_eq!(outcomes[0].metered, outcomes[1].metered);
    assert!(outcomes.iter().all(|o| o.complete));
}

#[test]
fn activation_recomputes_a_changed_leaf_expiry_without_recapturing() {
    let next = MODEL
        .replace("body: text <=100", "body: text <=100\n  other: time ?")
        .replace(
            "immutable parent\n  expire at .until",
            "immutable parent\n  expire at .other",
        );
    for at in [100, 160] {
        let mut e = engine(MODEL);
        let mut input = rows(Value::Int(200));
        if let Value::Row(f) | Value::Map(f) = &mut input[0].1 {
            f.insert("until".into(), Value::Int(150));
        }
        e.seed_at(input, 100).unwrap();
        let b = bound(&next);
        e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), at)
            .unwrap();
        let children = e.store().rows("children").unwrap();
        if at == 160 {
            assert!(children.is_empty());
        } else {
            assert_eq!(children[0].field(DEADLINE).unwrap(), &Value::Int(200));
        }
    }
}

#[test]
fn extra_rule_default_cycle_and_uncovered_aggregate_refusals() {
    for (source,code) in [
        (MODEL.replace("read through .parent","read through .parent\n  read <- allow"),"E_READ_THROUGH"),
        (MODEL.replace("  parent: parents\n","  parent: parents default 'p'\n"),"E_READ_THROUGH"),
        ("table a:\n  b: b\n  immutable b\n  read through .b\ntable b:\n  a: a\n  immutable a\n  read through .a\n".into(),"E_READ_THROUGH"),
        (format!("{MODEL}\nview missing: count children by .body\n"),"E_MAINTAIN_READ_RULE"),
    ]{let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.iter().any(|d|d.code==code),"{:?}",b.diagnostics);}
}

#[test]
fn memory_refusal_meters_match_hidden_and_absent_worlds() {
    use snapback4_core::{
        engine::runner::Runner,
        meter::{Cut, Meter},
    };
    use snapback4_device::{
        memory::MemoryStore,
        store::{DeviceStore, DeviceTx},
    };
    let source = format!(
        "{}\nmutation put(id: id, parent: parents):\n  upsert children[id] {{ parent, body: 'hello', until: null }}\nmutation maybe(id: id, parent: parents):\n  insert children {{ id, parent, body: 'hello', until: null }} if absent\n",
        MODEL.replace("update <- allow", "update <- deny")
    );
    for op in ["child", "put", "maybe"] {
        for ceiling in [
            Ceilings::default(),
            Ceilings {
                examined: 0,
                ..Ceilings::default()
            },
        ] {
            let mut outcomes = Vec::new();
            for world in 0..3 {
                let b = bound(&source);
                let mut store = MemoryStore::new();
                store.activate_server_at(b.schema.clone(), 100).unwrap();
                if world < 2 {
                    let mut sql = engine(&source);
                    let mut input = rows(Value::Null);
                    if world == 1 {
                        input.remove(0);
                    }
                    sql.seed_at(input, 100).unwrap();
                    store.restore_server_at(image(&sql), 100).unwrap();
                }
                let args = if op == "child" {
                    vec![("id", id("c")), ("parent", id("p")), ("until", Value::Null)]
                } else {
                    vec![("id", id("c")), ("parent", id("p"))]
                };
                let tx = store.transaction().unwrap();
                let mut runner = Runner::new(
                    &tx,
                    &b.schema,
                    ctx("bob", 100, &args),
                    Meter::new(ceiling, Cut::Abort),
                    0,
                );
                let error = runner
                    .run(
                        &b.programs
                            .iter()
                            .find(|p| p.program.name == op)
                            .unwrap()
                            .program,
                    )
                    .unwrap_err();
                outcomes.push((error.refusal(), runner.metered()));
                drop(runner);
                tx.rollback().unwrap();
            }
            for outcome in &outcomes[1..] {
                assert_eq!(outcome, &outcomes[0], "{op}");
            }
        }
    }
}

#[test]
fn memory_seed_sweep_and_reuse_use_the_same_lifetime_rules() {
    use snapback4_core::rows::Rows;
    use snapback4_device::{
        memory::MemoryStore,
        store::{DeviceStore, DeviceTx},
    };
    let b = bound(MODEL);
    let mut store = MemoryStore::new();
    store.activate_server_at(b.schema, 100).unwrap();
    store.seed_server_at(rows(Value::Int(200)), 100).unwrap();
    let mut changed = rows(Value::Int(200));
    changed.remove(0);
    if let Value::Row(f) | Value::Map(f) = &mut changed[0].1 {
        f.insert("owner".into(), id("bob"));
    }
    let before = store.export();
    assert!(store.seed_server_at(changed, 100).is_err());
    assert_eq!(store.export(), before);
    let parent = vec![rows(Value::Null).pop().unwrap()];
    assert!(store.seed_server_at(parent.clone(), 200).is_err());
    assert_eq!(store.sweep_server_at(200, 1).unwrap(), 1);
    let tx = store.transaction().unwrap();
    assert!(tx.get("children", "c").unwrap().is_none());
    assert!(tx.get("parents", "p").unwrap().is_some());
    tx.rollback().unwrap();
    assert_eq!(store.sweep_server_at(200, 1).unwrap(), 1);
    store.seed_server_at(parent, 200).unwrap();
}

#[test]
fn expired_unswept_child_delete_conflict_is_fail_closed() {
    let mut e = engine(MODEL);
    let mut input = rows(Value::Null);
    if let Value::Row(f) | Value::Map(f) = &mut input[0].1 {
        f.insert("until".into(), Value::Int(150));
    }
    e.seed_at(input, 100).unwrap();
    let outcome = e
        .mutate("erase", None, ctx("alice", 200, &[("id", id("p"))]))
        .unwrap();
    assert!(format!("{:?}", outcome.state).contains("E_PARENT_HAS_CHILDREN"));
    assert_eq!(e.store().rows("parents").unwrap().len(), 1);
    assert_eq!(e.sweep_expired(200, 10).unwrap(), 1);
    assert!(matches!(
        e.mutate("erase", None, ctx("alice", 200, &[("id", id("p"))]))
            .unwrap()
            .state,
        WriteState::Sent { .. }
    ));
}
