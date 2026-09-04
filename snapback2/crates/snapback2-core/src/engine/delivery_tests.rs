use super::*;
use crate::{AssetKind, Ceilings, Checker};

#[test]
fn delivery_refuses_when_the_located_cell_no_longer_contains_the_asset_id() {
    let table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("photo".to_owned(), ColumnType::Image { max: 1_000 }),
        ]),
        BTreeMap::new(),
    );
    let schema = Schema {
        tables: BTreeMap::from([("media".to_owned(), table)]),
        ..Schema::default()
    };
    let program = Program {
        name: "media.insert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            ("asset".to_owned(), ArgType::Image { max: 1_000 }),
        ]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Insert {
            table: "media".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), Expr::Variable("rowId".to_owned())),
                ("photo".to_owned(), Expr::Variable("asset".to_owned())),
            ])),
        }],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let actor = Actor::user("alice").unwrap();
    let mut store = Store::memory().unwrap();
    let id = store.begin_asset(AssetKind::Image, actor.id(), 0).unwrap();
    store.asset_reserve_finalized_bytes(&id, 50).unwrap();
    store
        .asset_mark_ready(
            &id,
            &crate::AssetReadyFacts {
                media_type: "image/png".to_owned(),
                bytes: 50,
                width: 10,
                height: 20,
                duration: None,
            },
        )
        .unwrap();
    let asset = Value::Map(BTreeMap::from([
        ("id".to_owned(), Value::String(id.clone())),
        ("width".to_owned(), Value::Int(10)),
        ("height".to_owned(), Value::Int(20)),
    ]));
    let mut engine = Engine::new(store, schema.clone()).unwrap();
    engine
        .execute(
            &program,
            &certificate,
            Context::mutation(
                actor,
                BTreeMap::from([
                    ("rowId".to_owned(), Value::Id("row-1".to_owned())),
                    ("asset".to_owned(), asset),
                ]),
            ),
        )
        .unwrap();

    let mismatched = Value::Row(BTreeMap::from([
        ("id".to_owned(), Value::Id("row-1".to_owned())),
        (
            "photo".to_owned(),
            Value::Map(BTreeMap::from([
                (
                    "id".to_owned(),
                    Value::String(
                        "s2id-00000000000000000000000000000001-0000000000000002".to_owned(),
                    ),
                ),
                ("width".to_owned(), Value::Int(10)),
                ("height".to_owned(), Value::Int(20)),
            ])),
        ),
    ]));
    engine
        .store
        .conn
        .execute(
            "UPDATE rows SET data = ?3 WHERE table_name = ?1 AND row_id = ?2",
            params!["media", "row-1", canonical_json(&mismatched)],
        )
        .unwrap();
    assert!(engine.store.asset(&id).unwrap().unwrap().locator.is_some());

    let rule = schema.table("media").unwrap().rules.read.clone();
    let read_certificate = Checker::new(&schema, Ceilings::default())
        .check_rule(&rule)
        .unwrap();
    let error = engine
        .asset_delivery(
            &id,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
            &BTreeMap::from([("media".to_owned(), read_certificate)]),
        )
        .unwrap_err();
    assert_eq!(error.code(), "E_ASSET_NOT_READY");
}
