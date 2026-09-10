use super::*;
use crate::Actor;
use crate::schema::{ColumnType, Index, RuleTerm, Rules, Table};

#[test]
fn once_disclosures_preserve_existing_schema_disclosures() {
    let case: serde_json::Value =
        serde_json::from_str(include_str!("../../../corpus/asset-once-image-insert.json")).unwrap();
    let schema: Schema = serde_json::from_value(case["schema"].clone()).unwrap();
    let mut certificate = serde_json::json!({"disclosures":["existing fact"], "schedules":[]});
    disclose_once_assets(&mut certificate, &schema);
    assert_eq!(
        certificate["disclosures"],
        serde_json::json!([
            "existing fact",
            "media.photo: one image delivery per authenticated principal; owning row read rule; no device byte cache"
        ])
    );
    assert_eq!(certificate["schedules"], serde_json::json!([]));
}

#[test]
fn adhoc_execution_does_not_install_a_program_or_change_the_generation() {
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema::default(),
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let before = generation.clone();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let program = Program {
        name: "__owner.inspect".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Int(42)))],
    };

    let execution = runtime
        .execute_adhoc(
            &program,
            Context::query(Actor::persona("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();

    assert_eq!(execution.result, Value::Int(42));
    assert_eq!(runtime.generation(), &before);
    assert_eq!(
        runtime.store().meta("generation").unwrap(),
        Some(before.hash())
    );
}

#[test]
fn read_rule_verdicts_are_engine_evaluated_over_every_stored_row() {
    let schema = Schema {
        tables: BTreeMap::from([(
            "todos".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("ownerId".to_owned(), ColumnType::Principal),
                ]),
                indexes: BTreeMap::from([(
                    "byId".to_owned(),
                    Index {
                        components: (vec!["id".to_owned()])
                            .into_iter()
                            .map(crate::search_key::IndexComponent::Column)
                            .collect(),
                        unique: true,
                    },
                )]),
                rules: Rules {
                    read: RuleExpr::Eq(RuleTerm::Field("ownerId".to_owned()), RuleTerm::Viewer),
                    insert: RuleExpr::Allow,
                    update: RuleExpr::Allow,
                    delete: RuleExpr::Allow,
                },
                constraints: Vec::new(),
                retain: Default::default(),
                tombstones: Vec::new(),
                deliver: None,
            },
        )]),
        ..Schema::default()
    };
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime
        .seed(&[
            (
                "todos".to_owned(),
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("seed".to_owned())),
                        ("ownerId".to_owned(), Value::Id("dev:alice".to_owned())),
                    ])
                    .into(),
                ),
            ),
            (
                "todos".to_owned(),
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("ghost".to_owned())),
                        ("ownerId".to_owned(), Value::Id("dev:alice".to_owned())),
                    ])
                    .into(),
                ),
            ),
            (
                "todos".to_owned(),
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("denied".to_owned())),
                        ("ownerId".to_owned(), Value::Id("dev:bob".to_owned())),
                    ])
                    .into(),
                ),
            ),
        ])
        .unwrap();
    let context = Context::query(Actor::persona("alice").unwrap(), BTreeMap::new());

    let verdicts = runtime.read_rule_verdicts("todos", context).unwrap();
    let admitted = verdicts
        .iter()
        .filter(|verdict| verdict.admitted)
        .map(|verdict| verdict.id.as_str())
        .collect::<BTreeSet<_>>();

    assert_eq!(verdicts.len(), 3);
    assert_eq!(admitted, BTreeSet::from(["ghost", "seed"]));
}
