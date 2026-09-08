use super::*;
use crate::{Ceilings, Checker, Index, public_table};

fn public_count_schema() -> Schema {
    let source = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([(
            "byId".into(),
            Index {
                components: vec![IndexComponent::Column("id".into())],
                unique: true,
            },
        )]),
    );
    let counts = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec![IndexComponent::Column("id".into())],
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    components: vec![IndexComponent::Column("principal".into())],
                    unique: true,
                },
            ),
        ]),
    );
    Schema {
        tables: BTreeMap::from([("entries".into(), source), ("counts".into(), counts)]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "entries".into(),
            by: vec!["principal".into()],
            target: "counts".into(),
            readable: None,
        }],
        ..Schema::default()
    }
}

fn public_count_query() -> Program {
    Program {
        name: "counts.forAlice".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "count.group".into(),
            table: "counts".into(),
            index: "byPrincipal".into(),
            key: vec![Expr::Literal(Value::Id("alice".into()))],
            provenance: KeyProvenance::Const,
        }))],
    }
}

fn public_count_get(schema: &Schema, engine: &mut Engine) -> Execution {
    let query = public_count_query();
    let certificate = Checker::new(schema, Ceilings::default())
        .check(&query)
        .unwrap();
    assert!(
        certificate
            .indexes_required
            .contains(&"counts.byPrincipal".into())
    );
    assert!(
        certificate.indexes_required.contains(&"counts.byId".into()),
        "the separately probed primary index must be a certificate dependency"
    );
    let execution = engine
        .execute(
            &query,
            &certificate,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert!(execution.trace.examined <= certificate.max_examined);
    execution
}

fn count_primary_absence() -> (String, String, Vec<Value>) {
    (
        "counts".into(),
        "byId".into(),
        vec![Value::Id(canonical_json(&vec![Value::Id("alice".into())]))],
    )
}

#[test]
fn public_count_missing_group_acquires_a_separately_proved_primary_absence() {
    for rule in [
        RuleExpr::Public {
            reason: "count disclosure".into(),
        },
        RuleExpr::Allow,
    ] {
        let mut schema = public_count_schema();
        schema.tables.get_mut("counts").unwrap().rules.read = rule;
        let mut engine = Engine::memory(schema.clone()).unwrap();
        let execution = public_count_get(&schema, &mut engine);
        assert_eq!(execution.result, Value::Null);
        assert!(execution.receipt.rows.is_empty());
        assert!(
            execution
                .receipt
                .absences
                .contains(&count_primary_absence())
        );
        assert!(execution.trace.absences.contains(&count_primary_absence()));
        assert!(execution.receipt.absences.contains(&(
            "counts".into(),
            "byPrincipal".into(),
            vec![Value::Id("alice".into())]
        )));
        assert_eq!(
            execution.receipt.ranges,
            vec![ReceiptRange {
                site: "count.group".into(),
                table: "counts".into(),
                index: "byPrincipal".into(),
                prefix: vec![crate::search_key::IndexAtom::Scalar(Value::Id(
                    "alice".into()
                ))],
                order: Order::Asc,
                take: 1,
                after: None,
                before: None,
                gt: None,
                gte: None,
                lt: None,
                lte: None,
                rule_hash: schema.rule_hash(&schema.tables["counts"].rules.read),
                row_ids: Vec::new(),
                stop: StopReason::Exhausted,
                absence: true,
                halo: None,
                n2_suffix: None,
            }],
            "group coverage and primary absence are separately justified facts"
        );
        assert_eq!(execution.trace.examined, 0);
        assert!(
            execution.trace.ranges.is_empty(),
            "receipt coverage must not invent a range execution"
        );
        assert_eq!(
            execution.trace.points,
            vec![PointTrace {
                site: "count.group".into(),
                table: "counts".into(),
                index: "byPrincipal".into(),
                key: vec![Value::Id("alice".into())],
                examined: false,
                visible: false,
                digest: None,
            }],
            "the original point remains the live invalidation and OCC dependency"
        );
    }
}

#[test]
fn public_count_retained_noncanonical_row_preserves_group_value_without_primary_absence() {
    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — ordinary target survivors need not have canonical maintained IDs.
    let schema = public_count_schema();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    // Seed the exact retained-row state; successor admission is tested separately.
    engine
        .seed(
            "counts",
            crate::object([
                ("id", Value::Id("ordinary-survivor".into())),
                ("principal", Value::Id("alice".into())),
                ("value", Value::Int(7)),
            ]),
        )
        .unwrap();
    let execution = public_count_get(&schema, &mut engine);
    assert_eq!(execution.result.field("value").unwrap(), &Value::Int(7));
    assert_eq!(
        execution.result.field("id").unwrap(),
        &Value::Id("ordinary-survivor".into())
    );
    assert_eq!(execution.receipt.rows.len(), 1);
    assert!(execution.receipt.absences.is_empty());
    assert!(execution.receipt.ranges.is_empty());
    assert!(execution.trace.absences.is_empty());
    assert_eq!(execution.trace.examined, 1);
}

#[test]
fn public_count_noncanonical_key_tags_cannot_mint_wire_retagged_group_authority() {
    for (column, stored_key, probe_key) in [
        (
            ColumnType::Principal,
            Value::Id("alice".into()),
            Value::String("alice".into()),
        ),
        (
            ColumnType::Principal,
            Value::Id("alice".into()),
            Value::Null,
        ),
        (
            ColumnType::Text { max: 40 },
            Value::String("alice".into()),
            Value::Id("alice".into()),
        ),
    ] {
        let mut schema = public_count_schema();
        for table in ["entries", "counts"] {
            schema
                .tables
                .get_mut(table)
                .unwrap()
                .columns
                .insert("principal".into(), column.clone());
        }
        let mut engine = Engine::memory(schema.clone()).unwrap();
        engine
            .seed(
                "counts",
                crate::object([
                    ("id", Value::Id("ordinary-survivor".into())),
                    ("principal", stored_key.clone()),
                    ("value", Value::Int(7)),
                ]),
            )
            .unwrap();
        let query_for = |key: Value| {
            let mut query = public_count_query();
            if let Stmt::Return(Expr::Get(read)) = &mut query.body[0] {
                read.key = vec![Expr::Literal(key)];
            } else {
                panic!("count fixture lost its point read");
            }
            query
        };
        let query = query_for(probe_key.clone());
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&query)
            .unwrap();
        let execution = engine
            .execute(
                &query,
                &certificate,
                Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
            )
            .unwrap();
        assert_eq!(
            execution.result,
            Value::Null,
            "the native lookup still distinguishes key tags"
        );
        assert_eq!(
            execution.trace.points,
            vec![PointTrace {
                site: "count.group".into(),
                table: "counts".into(),
                index: "byPrincipal".into(),
                key: vec![probe_key.clone()],
                examined: false,
                visible: false,
                digest: None,
            }]
        );
        assert!(
            execution.receipt.ranges.is_empty(),
            "schema retagging must not turn a native miss into false group coverage"
        );
        assert!(execution.receipt.rows.is_empty());
        assert!(
            execution
                .receipt
                .absences
                .iter()
                .all(|(_, index, _)| index != "byId")
        );
        assert!(
            execution
                .trace
                .absences
                .iter()
                .all(|(_, index, _)| index != "byId")
        );
        assert!(
            execution
                .trace
                .constraint_inputs
                .iter()
                .all(|input| input.check != "public-count-absence"),
            "ineligible key tags must refuse optional proof production before the primary probe"
        );
        assert_eq!(
            execution.receipt.absences,
            vec![(
                "counts".into(),
                "byPrincipal".into(),
                vec![probe_key.clone()]
            )],
            "the existing point miss remains unchanged; only the new proof pair is omitted"
        );

        if probe_key != Value::Null {
            assert_eq!(
                crate::value_to_wire_json(&probe_key),
                crate::value_to_wire_json(&stored_key),
                "the String/Id counterexamples are indistinguishable after public untagging"
            );
        }
        let query = query_for(stored_key);
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&query)
            .unwrap();
        let matching = engine
            .execute(
                &query,
                &certificate,
                Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
            )
            .unwrap();
        assert_eq!(
            matching.result.field("value").unwrap(),
            &Value::Int(7),
            "the correctly tagged group still has its actual noncanonical survivor"
        );
        assert_eq!(
            matching.result.field("id").unwrap(),
            &Value::Id("ordinary-survivor".into())
        );
    }
}

#[test]
fn public_count_cross_group_canonical_id_hit_never_becomes_a_primary_absence() {
    let schema = public_count_schema();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let canonical_alice = canonical_json(&vec![Value::Id("alice".into())]);
    engine
        .seed(
            "counts",
            crate::object([
                ("id", Value::Id(canonical_alice)),
                ("principal", Value::Id("bob".into())),
                ("value", Value::Int(9)),
            ]),
        )
        .unwrap();
    let execution = public_count_get(&schema, &mut engine);
    assert_eq!(
        execution.result,
        Value::Null,
        "the group lookup remains authoritative"
    );
    assert!(
        execution.receipt.rows.is_empty(),
        "the evidence probe does not substitute Bob's row"
    );
    assert!(
        !execution
            .receipt
            .absences
            .contains(&count_primary_absence())
    );
    assert!(!execution.trace.absences.contains(&count_primary_absence()));
    assert_eq!(
        execution.receipt.absences,
        vec![(
            "counts".into(),
            "byPrincipal".into(),
            vec![Value::Id("alice".into())]
        )]
    );
    assert!(
        execution.receipt.ranges.is_empty(),
        "a primary collision cannot authorize prediction of a fresh aggregate"
    );
    assert_eq!(execution.trace.examined, 1, "the primary hit is charged");
}

#[test]
fn public_count_absence_eligibility_excludes_other_authority_and_aggregate_shapes() {
    let baseline = public_count_schema();
    let eligible =
        |schema: &Schema| crate::cap::public_count_probe(schema, "counts", "byPrincipal", 1);
    assert!(eligible(&baseline));
    for rule in [
        RuleExpr::Deny,
        RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer),
    ] {
        let mut schema = baseline.clone();
        schema.tables.get_mut("counts").unwrap().rules.read = rule;
        assert!(
            !eligible(&schema),
            "protected/nonuniform counts cannot gain public absence authority"
        );
    }
    let mut ordinary = baseline.clone();
    ordinary.maintains.clear();
    assert!(!eligible(&ordinary));
    let mut sum = baseline.clone();
    sum.maintains[0].kind = MaintainKind::Sum {
        of: "amount".into(),
    };
    assert!(!eligible(&sum));
    let mut nonunique = baseline.clone();
    nonunique
        .tables
        .get_mut("counts")
        .unwrap()
        .indexes
        .get_mut("byPrincipal")
        .unwrap()
        .unique = false;
    assert!(!eligible(&nonunique));
    let mut no_primary = baseline.clone();
    no_primary
        .tables
        .get_mut("counts")
        .unwrap()
        .indexes
        .remove("byId");
    assert!(!eligible(&no_primary));
    for column in [
        ColumnType::Json { max_bytes: 100 },
        ColumnType::List {
            of: Box::new(ColumnType::Principal),
            max: 2,
        },
        ColumnType::Image {
            max: 100,
            once: false,
        },
        ColumnType::Video { max: 100 },
    ] {
        for column in [column.clone(), ColumnType::Optional(Box::new(column))] {
            let mut schema = baseline.clone();
            for table in ["entries", "counts"] {
                schema
                    .tables
                    .get_mut(table)
                    .unwrap()
                    .columns
                    .insert("principal".into(), column.clone());
            }
            assert!(
                !eligible(&schema),
                "non-scalar groups cannot receive a scalar wire-retagged proof: {column:?}"
            );
        }
    }
    assert!(!crate::cap::public_count_probe(
        &baseline,
        "counts",
        "byPrincipal",
        0
    ));
    assert!(!crate::cap::public_count_probe(
        &baseline, "counts", "byId", 1
    ));
    assert!(!crate::cap::public_count_probe(
        &baseline,
        "missing",
        "byPrincipal",
        1
    ));
}

#[test]
fn public_count_extra_evidence_is_included_in_admission_costs() {
    let count = public_count_schema();
    let mut ordinary = count.clone();
    ordinary.maintains.clear();
    let query = public_count_query();
    let ordinary_cert = Checker::new(&ordinary, Ceilings::default())
        .check(&query)
        .unwrap();
    let count_cert = Checker::new(&count, Ceilings::default())
        .check(&query)
        .unwrap();
    assert!(
        count_cert.max_closure_bytes > ordinary_cert.max_closure_bytes,
        "an additional serialized absence requires admission space"
    );
    assert!(
        count_cert.max_steps > ordinary_cert.max_steps,
        "a second physical lookup must be charged even when the group misses"
    );
    assert!(
        !ordinary_cert
            .indexes_required
            .contains(&"counts.byId".into())
    );
    let tight = Ceilings {
        closure_bytes: ordinary_cert.max_closure_bytes,
        ..Ceilings::default()
    };
    assert!(Checker::new(&ordinary, tight.clone()).check(&query).is_ok());
    assert!(
        Checker::new(&count, tight).check(&query).is_err(),
        "a query that cannot admit its extra evidence must refuse before execution"
    );
}

#[test]
fn public_count_receipt_only_store_cannot_mint_group_coverage_or_primary_absence() {
    let schema = public_count_schema();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    // A physically empty replica may simply never have acquired this group.
    engine.install_receipt_authority(&ClosureReceipt::default());
    let execution = public_count_get(&schema, &mut engine);
    assert!(
        execution.receipt.ranges.is_empty(),
        "partial local storage cannot certify an empty group"
    );
    assert!(
        !execution
            .receipt
            .absences
            .contains(&count_primary_absence())
    );
    assert!(!execution.trace.absences.contains(&count_primary_absence()));
    assert!(
        execution
            .trace
            .constraint_inputs
            .iter()
            .all(|input| input.check != "public-count-absence"),
        "receipt-only evaluation must not perform the authority-only auxiliary probe"
    );
    assert_eq!(execution.trace.points.len(), 1);
    assert!(execution.trace.ranges.is_empty());
}

#[test]
fn public_count_denied_and_protected_hit_or_miss_never_gain_extra_absence_authority() {
    for rule in [
        RuleExpr::Deny,
        RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer),
    ] {
        for actor in ["alice", "bob"] {
            for hit in [false, true] {
                let mut schema = public_count_schema();
                schema.tables.get_mut("counts").unwrap().rules.read = rule.clone();
                let query = public_count_query();
                let certificate = Checker::new(&schema, Ceilings::default())
                    .check(&query)
                    .unwrap();
                let mut engine = Engine::memory(schema).unwrap();
                if hit {
                    engine
                        .seed(
                            "counts",
                            crate::object([
                                ("id", Value::Id("retained".into())),
                                ("principal", Value::Id("alice".into())),
                                ("value", Value::Int(7)),
                            ]),
                        )
                        .unwrap();
                }
                let execution = engine
                    .execute(
                        &query,
                        &certificate,
                        Context::query(Actor::user(actor).unwrap(), BTreeMap::new()),
                    )
                    .unwrap();
                let visible = hit && actor == "alice" && !matches!(rule, RuleExpr::Deny);
                if visible {
                    assert_eq!(execution.result.field("value").unwrap(), &Value::Int(7));
                } else {
                    assert_eq!(execution.result, Value::Null);
                }
                assert!(execution.receipt.ranges.is_empty());
                assert!(
                    !execution
                        .receipt
                        .absences
                        .contains(&count_primary_absence())
                );
                assert!(
                    execution
                        .trace
                        .constraint_inputs
                        .iter()
                        .all(|input| input.check != "public-count-absence")
                );
                if hit && !visible {
                    assert!(execution.receipt.rows.is_empty());
                    assert!(
                        execution.receipt.absences.is_empty(),
                        "hidden hits cannot disclose their existence"
                    );
                }
            }
        }
    }
}

#[test]
fn public_count_group_miss_still_conflicts_when_the_point_changes_before_replay() {
    let schema = public_count_schema();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let observed = public_count_get(&schema, &mut engine);
    let point = &observed.trace.points[0];
    let replay = crate::offline::ReplayCommit {
        grant: "count-grant".into(),
        offset: 0,
        count: 1,
        intent: "count-grant:0".into(),
        request_digest: "d".repeat(64),
        at: 5,
        trace: crate::offline::ReplayTrace {
            points: vec![crate::offline::ReplayTracePoint {
                table: point.table.clone(),
                index: point.index.clone(),
                key: point.key.clone(),
                digest: point.digest.clone(),
            }],
            verdicts: Vec::new(),
        },
    };
    engine
        .seed(
            "counts",
            crate::object([
                ("id", Value::Id("new-ordinary-group-row".into())),
                ("principal", Value::Id("alice".into())),
                ("value", Value::Int(1)),
            ]),
        )
        .unwrap();
    let mut mutation = public_count_query();
    mutation.kind = ProgramKind::Mutation;
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&mutation)
        .unwrap();
    let execution = engine
        .execute_replay(
            &mutation,
            &certificate,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
            &replay,
        )
        .unwrap();
    assert!(
        matches!(execution.state, ExecutionState::Rejected { ref code, .. } if code == "conflict"),
        "range coverage cannot erase the original absent-point OCC dependency: {:?}",
        execution.state
    );
    assert_eq!(
        engine.rows("counts").unwrap()[0].field("value").unwrap(),
        &Value::Int(1)
    );
}

#[test]
fn public_count_live_subscription_reruns_after_first_maintained_row_is_created() {
    let query = public_count_query();
    let insert = Program {
        name: "entries.add".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "entries".into(),
            row: Expr::Literal(crate::object([
                ("id", Value::Id("entry-1".into())),
                ("principal", Value::Id("alice".into())),
            ])),
        }],
    };
    let generation = crate::Generation::certify(
        &crate::ProjectJson {
            version: 1,
            schema: public_count_schema(),
            programs: vec![query.clone(), insert.clone()],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let (subscription, initial) = runtime
        .subscribe(
            &query.name,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(initial.result, Value::Null);
    assert_eq!(initial.trace.points.len(), 1);
    assert!(initial.trace.ranges.is_empty());
    let committed = runtime
        .execute(
            &insert.name,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    let commit = runtime
        .store()
        .commits_since(committed.seq - 1, 1)
        .unwrap()
        .remove(0);
    let invalidated = runtime.invalidated(&commit);
    assert!(
        invalidated.contains(&subscription),
        "first creation must invalidate the point subscription"
    );
    let deliveries = runtime.rerun(&invalidated);
    let delivery = deliveries
        .iter()
        .find(|item| item.id == subscription)
        .unwrap();
    assert!(delivery.changed);
    assert_eq!(
        delivery
            .execution
            .as_ref()
            .unwrap()
            .result
            .field("value")
            .unwrap(),
        &Value::Int(1)
    );
}

#[test]
fn public_count_invalid_oversized_key_cannot_mint_the_paired_extra_evidence() {
    let schema = public_count_schema();
    let key = vec![Value::Id("x".repeat(10_000))];
    assert!(
        crate::cap::count_absence_evidence(
            &schema,
            &PointTrace {
                site: "count.group".into(),
                table: "counts".into(),
                index: "byPrincipal".into(),
                key,
                examined: false,
                visible: false,
                digest: None,
            },
            "rule",
        )
        .is_none(),
        "an invalid oversized point key cannot mint either member of the proof pair"
    );
}

#[test]
fn public_count_derived_group_range_rejects_each_changed_authority_field() {
    let schema = public_count_schema();
    let query = public_count_query();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&query)
        .unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let transaction = engine.store.conn.transaction().unwrap();
    let hashes = hashes::PolicyHashes::new(&schema);
    let mut runner = Runner::new(
        &transaction,
        &schema,
        &hashes,
        &certificate,
        Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        &[],
        &[],
        RuleAuthority::StoreAuthoritative,
        0,
    );
    runner.statements(&query.body).unwrap();
    runner.assert_bounds().unwrap();
    assert_eq!(runner.receipt.ranges.len(), 1);
    let original = runner.receipt.ranges[0].clone();
    let corruptions: &[(&str, fn(&mut ReceiptRange))] = &[
        ("site", |range| range.site = "unexecuted".into()),
        ("table", |range| range.table = "entries".into()),
        ("index", |range| range.index = "byId".into()),
        ("prefix", |range| {
            range.prefix = vec![crate::search_key::IndexAtom::Scalar(Value::Id(
                "bob".into(),
            ))]
        }),
        ("order", |range| range.order = Order::Desc),
        ("take", |range| range.take = 2),
        ("after", |range| {
            range.after = Some(Value::Id("cursor".into()))
        }),
        ("before", |range| {
            range.before = Some(Value::Id("cursor".into()))
        }),
        ("gt", |range| range.gt = Some(Value::Id("bound".into()))),
        ("gte", |range| range.gte = Some(Value::Id("bound".into()))),
        ("lt", |range| range.lt = Some(Value::Id("bound".into()))),
        ("lte", |range| range.lte = Some(Value::Id("bound".into()))),
        ("policy", |range| range.rule_hash = "old-policy".into()),
        ("rows", |range| range.row_ids = vec!["unobserved".into()]),
        ("stop", |range| range.stop = StopReason::Limit),
        ("absence", |range| range.absence = false),
        ("halo", |range| {
            range.halo = Some(RowRef {
                table: "counts".into(),
                id: "unobserved".into(),
            })
        }),
        ("n2", |range| {
            range.n2_suffix = Some(vec![Value::Id("unobserved".into())])
        }),
    ];
    for (field, corrupt) in corruptions {
        runner.receipt.ranges[0] = original.clone();
        corrupt(&mut runner.receipt.ranges[0]);
        assert!(
            matches!(runner.assert_bounds(), Err(RuntimeError::TraceSubset(_))),
            "altering {field} must invalidate the exact derived empty-group proof"
        );
    }
    runner.receipt.ranges[0] = original;
    runner.trace.points[0].examined = true;
    assert!(
        matches!(runner.assert_bounds(), Err(RuntimeError::TraceSubset(_))),
        "a traced hit cannot justify the derived empty-group proof"
    );
}
