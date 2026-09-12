use super::*;

#[test]
fn maintained_backfill_bypasses_target_rules_but_enforces_constraints() {
    fn setup(counts: Table) -> (Runtime, BTreeMap<String, Table>) {
        let cards = table(
            &[("id", ColumnType::Id), ("group", ColumnType::Id)],
            &[("byId", &["id"])],
        );
        let tables = BTreeMap::from([("cards".to_owned(), cards), ("counts".to_owned(), counts)]);
        let base = generation(
            schema(tables.clone(), Vec::new()),
            vec![get_program("counts.get", "counts", "byGroup", "group")],
        );
        let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
        runtime
            .seed(&[
                (
                    "cards".to_owned(),
                    object([
                        ("id", Value::Id("c1".to_owned())),
                        ("group", Value::Id("g1".to_owned())),
                    ]),
                ),
                (
                    "cards".to_owned(),
                    object([
                        ("id", Value::Id("c2".to_owned())),
                        ("group", Value::Id("g2".to_owned())),
                    ]),
                ),
            ])
            .unwrap();
        (runtime, tables)
    }

    fn successor(tables: BTreeMap<String, Table>) -> Generation {
        generation(
            schema(
                tables,
                vec![Maintain {
                    kind: MaintainKind::Count,
                    source: "cards".to_owned(),
                    by: vec!["group".to_owned()],
                    target: "counts".to_owned(),
                    readable: None,
                }],
            ),
            vec![get_program("counts.get", "counts", "byGroup", "group")],
        )
    }

    fn assert_empty(runtime: &mut Runtime) {
        let execution = runtime
            .execute(
                "counts.get",
                Context::query(
                    Actor::user("u1").unwrap(),
                    BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
                ),
            )
            .unwrap();
        assert_eq!(execution.result, Value::Null);
    }

    let mut denied_counts = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byGroup", &["group"])],
    );
    denied_counts.rules.insert = RuleExpr::Deny;
    let (mut denied, denied_tables) = setup(denied_counts);
    let report = denied
        .apply_successor(successor(denied_tables))
        .expect("engine-owned aggregate writes bypass target insert rules");
    assert_eq!(report.backfilled_maintains, 1);
    let aggregate = denied
        .execute(
            "counts.get",
            Context::query(
                Actor::user("u1").unwrap(),
                BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(aggregate.result.field("value").unwrap(), &Value::Int(1));

    let mut capped_counts = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byGroup", &["group"])],
    );
    capped_counts.constraints.push(Constraint::Cap {
        by: vec!["group".to_owned()],
        max: 1,
    });
    let (mut capped, capped_tables) = setup(capped_counts);
    let capped_hash = capped.generation().hash();
    // LLP 1017 rejects caps on engine-owned maintained targets at admission.
    let errors = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema(
                capped_tables,
                vec![Maintain {
                    kind: MaintainKind::Count,
                    source: "cards".to_owned(),
                    by: vec!["group".to_owned()],
                    target: "counts".to_owned(),
                    readable: None,
                }],
            ),
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap_err();
    assert!(errors.iter().any(|(_, e)| e.code == "E_SCHEMA_CONSTRAINT"
        && e.message.contains("maintained targets are engine-owned")));
    assert_eq!(capped.generation().hash(), capped_hash);
    assert_empty(&mut capped);
}
