// @ref LLP 1001#maintained-addresses — certified Runtime boundary regressions.
use super::*;

fn project(schema: Schema, programs: Vec<Program>) -> crate::ProjectJson {
    crate::ProjectJson {
        version: 1,
        schema,
        programs,
        effects: vec![],
        auth: crate::Auth::default(),
    }
}

#[test]
fn maximal_realm_receipt_fits_ordinary_point_certificate() {
    // Original R2 project/program, with a synthetic value at the declared 64-scalar realm maximum.
    let witness: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/evaluator/src/test-maintained-fixtures/roundtrip-3.json"
    ))
    .unwrap();
    let project: crate::ProjectJson = serde_json::from_value(witness["project"].clone()).unwrap();
    let generation = crate::Generation::certify(&project, Ceilings::default()).unwrap();
    let certificate = generation.programs()["counts.byAddress"].1.clone();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let principal = Value::Id("a".repeat(135));
    let realm = Value::String("😀".repeat(64));
    let address = Value::Id(canonical_json(&vec![principal.clone(), realm.clone()]));
    let source = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("maximal".into())),
            ("principal".into(), principal),
            ("realm".into(), realm),
        ])
        .into(),
    );
    runtime
        .seed(&[("memberships".into(), source.clone())])
        .unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let result = runtime.execute(
        "counts.byAddress",
        Context::query(
            Actor::user("alice").unwrap(),
            BTreeMap::from([("address".into(), address.clone())]),
        ),
    );
    println!(
        "maximal_input={}",
        canonical_json(
            &serde_json::json!({"project":project,"source":source,"address":address,"certificate":certificate})
        )
    );
    println!(
        "maximal_result={result:?} seq_before={before} seq_after={}",
        runtime.store().commit_seq().unwrap()
    );
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    let execution = result.unwrap();
    println!("maximal_execution={}", canonical_json(&execution));
    println!(
        "maximal_bytes={}",
        canonical_json(&serde_json::json!({
            "address":canonical_json(&address).len(),"row":canonical_json(&execution.result).len(),
            "receipt":canonical_json(&execution.receipt).len(),"maxClosure":certificate.max_closure_bytes,
            "maxOutput":certificate.max_output_bytes
        }))
    );
    assert!(canonical_json(&execution.result).len() as u64 <= certificate.max_output_bytes);
    assert!(canonical_json(&execution.receipt).len() as u64 <= certificate.max_closure_bytes);
    let mut held = crate::ClientStore::hydrate(project.schema.clone(), &execution.receipt).unwrap();
    let (state, replay) = held
        .reexecute(
            &project.programs[0],
            &certificate,
            Context::query(
                Actor::user("alice").unwrap(),
                BTreeMap::from([("address".into(), address)]),
            ),
        )
        .unwrap();
    assert_eq!(state, crate::LocalState::Fresh);
    assert_eq!(replay.result, execution.result);

    // A reduced result still discloses and retains the same complete first row image.
    let mut reduced = project.programs[0].clone();
    let Stmt::Return(Expr::Get(read)) = &reduced.body[0] else {
        panic!("original point witness must remain a Get");
    };
    reduced.body[0] = Stmt::Return(Expr::Exists(read.clone()));
    reduced.name = "counts.exists".into();
    let reduced_project = crate::ProjectJson {
        programs: vec![reduced.clone()],
        ..project
    };
    let generation = crate::Generation::certify(&reduced_project, Ceilings::default()).unwrap();
    let certificate = generation.programs()["counts.exists"].1.clone();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime.seed(&[("memberships".into(), source)]).unwrap();
    let context = Context::query(
        Actor::user("alice").unwrap(),
        BTreeMap::from([(
            "address".into(),
            execution.receipt.rows[0].row.field("id").unwrap().clone(),
        )]),
    );
    let execution = runtime.execute("counts.exists", context.clone()).unwrap();
    assert_eq!(execution.result, Value::Bool(true));
    assert_eq!(execution.receipt.rows.len(), 1);
    assert!(canonical_json(&execution.receipt).len() as u64 <= certificate.max_closure_bytes);
    assert!(canonical_json(&execution.result).len() as u64 <= certificate.max_output_bytes);
    let mut held = crate::ClientStore::hydrate(reduced_project.schema, &execution.receipt).unwrap();
    let (state, replay) = held.reexecute(&reduced, &certificate, context).unwrap();
    assert_eq!(state, crate::LocalState::Fresh);
    assert_eq!(replay.result, Value::Bool(true));
}

#[test]
fn cyclic_exists_refuses_custody_domain_but_unrelated_query_runs() {
    let mut schema = maintained_boundary_schema();
    for name in ["memberships", "membershipCounts"] {
        schema.tables.get_mut(name).unwrap().columns.insert(
            "principal".into(),
            ColumnType::Ref {
                table: "membershipCounts".into(),
            },
        );
    }
    let ordinary = Program {
        name: "ordinary".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Int(7)))],
    };
    let consumer = Program {
        name: "cyclic.exists".into(),
        args: BTreeMap::from([(
            "address".into(),
            ArgType::Ref {
                table: "membershipCounts".into(),
            },
        )]),
        body: vec![Stmt::Return(Expr::Exists(Read {
            site: "exists".into(),
            table: "membershipCounts".into(),
            index: "byId".into(),
            key: vec![Expr::Variable("address".into())],
            provenance: KeyProvenance::Arg,
        }))],
        ..ordinary.clone()
    };
    let consuming = project(schema.clone(), vec![consumer]);
    let checked = crate::Generation::certify(&consuming, Ceilings::default());
    println!("cyclic_exists_project={}", canonical_json(&consuming));
    let errors = match checked {
        Ok(generation) => {
            println!(
                "cyclic_exists_certificate={}",
                canonical_json(&generation.programs()["cyclic.exists"].1)
            );
            let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
            let source = Value::Row(
                BTreeMap::from([
                    ("id".into(), Value::Id("source".into())),
                    ("principal".into(), Value::Id("short".into())),
                ])
                .into(),
            );
            runtime.seed(&[("memberships".into(), source)]).unwrap();
            let address = Value::Id(canonical_json(&vec![Value::Id("short".into())]));
            let before = runtime.store().commit_seq().unwrap();
            let result = runtime.execute(
                "cyclic.exists",
                Context::query(
                    Actor::user("alice").unwrap(),
                    BTreeMap::from([("address".into(), address)]),
                ),
            );
            println!(
                "cyclic_exists_result={result:?} seq_before={before} seq_after={}",
                runtime.store().commit_seq().unwrap()
            );
            assert_eq!(runtime.store().commit_seq().unwrap(), before);
            None
        }
        Err(errors) => {
            println!("cyclic_exists_refusal={errors:?}");
            Some(errors)
        }
    };
    let generation =
        crate::Generation::certify(&project(schema, vec![ordinary]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    assert_eq!(
        runtime
            .execute(
                "ordinary",
                Context::query(Actor::user("alice").unwrap(), BTreeMap::new())
            )
            .unwrap()
            .result,
        Value::Int(7)
    );
    assert!(errors.is_some_and(|errors| errors.iter().any(|(_, error)| error.code == "E_BOUND")));
}

#[test]
fn removing_maintain_rebuilds_before_surviving_index_admission() {
    let schema = maintained_boundary_schema();
    let generation =
        crate::Generation::certify(&project(schema.clone(), vec![]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let source = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("source".into())),
            ("principal".into(), Value::Id("a".repeat(135))),
        ])
        .into(),
    );
    runtime.seed(&[("memberships".into(), source)]).unwrap();
    let old_rows = runtime.engine.rows("membershipCounts").unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let old_generation = runtime.generation().hash();
    let mut next = schema;
    next.maintains.clear();
    next.tables
        .get_mut("membershipCounts")
        .unwrap()
        .indexes
        .insert(
            "byValue".into(),
            Index {
                components: vec!["value".into(), "id".into()]
                    .into_iter()
                    .map(crate::search_key::IndexComponent::Column)
                    .collect(),
                unique: false,
            },
        );
    let next = crate::Generation::certify(&project(next, vec![]), Ceilings::default()).unwrap();
    let result = runtime.apply_successor_at(next, 0);
    println!(
        "remove_maintain_result={result:?} seq_before={before} seq_after={} old_generation={old_generation} current_generation={} rows={:?}",
        runtime.store().commit_seq().unwrap(),
        runtime.generation().hash(),
        runtime.engine.rows("membershipCounts")
    );
    if result.is_err() {
        assert_eq!(runtime.store().commit_seq().unwrap(), before);
        assert_eq!(runtime.generation().hash(), old_generation);
        assert_eq!(runtime.engine.rows("membershipCounts").unwrap(), old_rows);
    }
    assert!(
        result.is_ok(),
        "predecessor-owned projection should be removed before successor index inputs are admitted"
    );
    assert!(runtime.engine.rows("membershipCounts").unwrap().is_empty());
    assert_eq!(runtime.engine.rows("memberships").unwrap().len(), 1);
    assert!(
        runtime.generation().schema().tables["membershipCounts"]
            .indexes
            .contains_key("byValue")
    );
}

#[test]
fn removing_maintain_checks_survivors_and_rolls_back_before_lawful_rebuild() {
    let schema = maintained_boundary_schema();
    let generation =
        crate::Generation::certify(&project(schema.clone(), vec![]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let source = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("source".into())),
            ("principal".into(), Value::Id("a".repeat(135))),
        ])
        .into(),
    );
    runtime.seed(&[("memberships".into(), source)]).unwrap();
    // Synthetic legacy storage: this row is outside the predecessor projection's exact owned IDs.
    let mut legacy = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("manual".into())),
            ("principal".into(), Value::Id("ordinary".into())),
            (
                "value".into(),
                Value::String("invalid consumed integer".into()),
            ),
        ])
        .into(),
    );
    runtime
        .store()
        .conn
        .execute(
            "INSERT INTO rows (table_name,row_id,data) VALUES (?1,?2,?3)",
            rusqlite::params!["membershipCounts", "manual", canonical_json(&legacy)],
        )
        .unwrap();
    let mut next = schema;
    next.maintains.clear();
    next.tables
        .get_mut("membershipCounts")
        .unwrap()
        .indexes
        .insert(
            "byValue".into(),
            Index {
                components: vec![
                    crate::search_key::IndexComponent::Column("value".into()),
                    crate::search_key::IndexComponent::Column("id".into()),
                ],
                unique: false,
            },
        );
    let generation =
        crate::Generation::certify(&project(next, vec![]), Ceilings::default()).unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let hash = runtime.generation().hash();
    let rows = runtime.engine.rows("membershipCounts").unwrap();
    let refusal = runtime
        .apply_successor_at(generation.clone(), 0)
        .unwrap_err();
    println!("surviving_index_refusal={refusal:?}");
    assert_eq!(refusal.code, "E_SUCCESSOR_STORE");
    assert!(refusal.message.contains("value"));
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    assert_eq!(runtime.generation().hash(), hash);
    assert_eq!(runtime.engine.rows("membershipCounts").unwrap(), rows);
    let Value::Row(fields) = &mut legacy else {
        unreachable!()
    };
    fields.insert("value".into(), Value::Int(4));
    runtime
        .store()
        .conn
        .execute(
            "UPDATE rows SET data=?1 WHERE table_name=?2 AND row_id=?3",
            rusqlite::params![canonical_json(&legacy), "membershipCounts", "manual"],
        )
        .unwrap();
    runtime.apply_successor_at(generation, 0).unwrap();
    assert_eq!(
        runtime.engine.rows("membershipCounts").unwrap(),
        vec![legacy]
    );
    assert_eq!(runtime.engine.rows("memberships").unwrap().len(), 1);
}

#[test]
fn typed_reference_list_refusals_use_the_declared_target_before_fanout() {
    let mut schema = maintained_boundary_schema();
    let mut links = schema.tables["memberships"].clone();
    links.columns = BTreeMap::from([
        ("id".into(), ColumnType::Id),
        (
            "refs".into(),
            ColumnType::Optional(Box::new(ColumnType::List {
                of: Box::new(ColumnType::Optional(Box::new(ColumnType::Ref {
                    table: "membershipCounts".into(),
                }))),
                max: 1,
            })),
        ),
    ]);
    links.constraints.clear();
    links.indexes.retain(|name, _| name == "byId");
    schema.tables.insert("links".into(), links);
    let program = Program {
        name: "lists".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(
            "refs".into(),
            ArgType::List {
                of: Some(Box::new(ArgType::Ref {
                    table: "membershipCounts".into(),
                })),
                max: 1,
            },
        )]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Bool(true)))],
    };
    let generation =
        crate::Generation::certify(&project(schema, vec![program]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let long = Value::Id(canonical_json(&vec![Value::Id("a".repeat(135))]));
    let context = |refs| {
        Context::query(
            Actor::user("alice").unwrap(),
            BTreeMap::from([("refs".into(), Value::Array(refs))]),
        )
    };
    assert_eq!(
        runtime
            .execute("lists", context(vec![long.clone()]))
            .unwrap()
            .result,
        Value::Bool(true)
    );
    let before = runtime.store().commit_seq().unwrap();
    let short_error = runtime
        .execute("lists", context(vec![Value::Id("a".into()); 2]))
        .unwrap_err();
    let long_error = runtime
        .execute("lists", context(vec![long.clone(); 2]))
        .unwrap_err();
    println!("list_short_refusal={short_error:?} list_long_refusal={long_error:?}");
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    assert_eq!(short_error.code(), "E_FANOUT");
    assert_eq!(long_error.code(), "E_FANOUT");
    let reserved = runtime
        .execute(
            "lists",
            context(vec![long.clone(), Value::Id("system".into())]),
        )
        .unwrap_err();
    assert_eq!(reserved.code(), "E_INPUT");
    assert!(reserved.to_string().contains("reserved system principal"));
    let shape = runtime
        .execute("lists", context(vec![Value::Bool(true); 2]))
        .unwrap_err();
    assert_eq!(
        shape.code(),
        "E_FANOUT",
        "fanout precedes element type checks after identity preflight"
    );
    let row = |id: &str, refs| {
        Value::Row(
            BTreeMap::from([
                ("id".into(), Value::Id(id.into())),
                ("refs".into(), Value::Array(refs)),
            ])
            .into(),
        )
    };
    runtime
        .seed(&[("links".into(), row("valid", vec![long.clone()]))])
        .unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let rows = runtime.engine.rows("links").unwrap();
    let error = runtime
        .seed(&[("links".into(), row("oversize", vec![long; 2]))])
        .unwrap_err();
    println!("stored_optional_reference_list_refusal={error:?}");
    assert_eq!(error.code(), "E_INPUT");
    assert!(error.to_string().contains("violates Optional(List"));
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    assert_eq!(runtime.engine.rows("links").unwrap(), rows);
}
