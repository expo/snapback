use snapback4_core::{
    engine::{Context, WriteState, postgres::PostgresEngine},
    value::Value,
};
use snapback4_postgres_evaluation::{connect, namespace};
#[path = "../../../crates/snapback4-lang/tests/read_through/scenarios.rs"]
mod scenarios;

struct Pg {
    engine: PostgresEngine,
    queries: std::collections::BTreeSet<String>,
}
impl scenarios::Backend for Pg {
    fn run(&mut self, operation: &str, context: Context) -> Result<Value, String> {
        if self.queries.contains(operation) {
            self.engine
                .query(operation, context)
                .map(|r| r.data)
                .map_err(|e| e.to_string())
        } else {
            match self
                .engine
                .mutate(operation, None, context)
                .map_err(|e| e.to_string())?
                .state
            {
                WriteState::Sent { result, .. } => Ok(result),
                other => Err(format!("{other:?}")),
            }
        }
    }
}
fn factory(source: &str) -> Box<dyn scenarios::Backend> {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.is_empty(), "{:?}", b.notes);
    let queries = b
        .programs
        .iter()
        .filter(|p| p.program.kind == snapback4_core::ir::ProgramKind::Query)
        .map(|p| p.program.name.clone())
        .collect();
    Box::new(Pg {
        engine: PostgresEngine::create(
            connect(),
            &namespace("through"),
            b.schema,
            b.programs.into_iter().map(|p| p.program),
        )
        .unwrap(),
        queries,
    })
}
#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn four_level_chains() {
    scenarios::chain(factory);
}
#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn clique() {
    scenarios::clique(factory);
}
#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn issue_tracker() {
    scenarios::issues(factory);
}

const MODEL: &str = include_str!("../../../crates/snapback4-lang/tests/read_through/lifetime.q");
fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn pair(source: &str) -> (String, PostgresEngine, snapback4_core::Engine) {
    let b = compile(source);
    let name = namespace("through_parity");
    let programs: Vec<_> = b.programs.into_iter().map(|p| p.program).collect();
    let pg = PostgresEngine::create(connect(), &name, b.schema.clone(), programs.clone()).unwrap();
    (
        name,
        pg,
        snapback4_core::Engine::memory(b.schema, programs).unwrap(),
    )
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn rows(until: Value) -> Vec<(String, Value)> {
    use snapback4_core::value::object;
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
fn stored(name: &str) -> Vec<(String, Value)> {
    connect()
        .query(&format!("SELECT t,data FROM {name}.r ORDER BY t,id"), &[])
        .unwrap()
        .into_iter()
        .map(|r| {
            (
                r.get(0),
                serde_json::from_str(&r.get::<_, String>(1)).unwrap(),
            )
        })
        .collect()
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn lifetime_restore_reuse_and_import_match_sqlite() {
    use scenarios::context;
    use snapback4_core::schema::through::DEADLINE;
    let (name, mut pg, mut sqlite) = pair(MODEL);
    let deadline = snapback4_core::now_ms() + 1_000_000;
    assert_eq!(
        pg.seed_at(rows(Value::Int(deadline)), 100).unwrap(),
        sqlite.seed_at(rows(Value::Int(deadline)), 100).unwrap()
    );
    for (op, args) in [
        ("erase", vec![("id", id("p"))]),
        (
            "extend",
            vec![("id", id("c")), ("until", Value::Int(i64::MAX))],
        ),
    ] {
        assert_eq!(
            pg.mutate(op, None, context("alice", 100, &args)).unwrap(),
            sqlite
                .mutate(op, None, context("alice", 100, &args))
                .unwrap()
        );
    }
    let mut images = stored(&name);
    for (n, row) in &mut images {
        if n == "children" {
            if let Value::Row(f) | Value::Map(f) = row {
                f.insert(DEADLINE.into(), Value::Int(i64::MAX));
            }
        }
    }
    pg.load_trusted(images.clone(), 100).unwrap();
    sqlite.load_trusted(images).unwrap();
    assert_eq!(
        stored(&name)
            .iter()
            .find(|(n, _)| n == "children")
            .unwrap()
            .1
            .field(DEADLINE)
            .unwrap(),
        &Value::Int(deadline)
    );
    let mut replacement = rows(Value::Int(deadline));
    replacement.remove(0);
    if let Value::Row(f) | Value::Map(f) = &mut replacement[0].1 {
        f.insert("owner".into(), id("bob"));
    }
    assert!(pg.load(replacement.clone()).is_err());
    assert!(sqlite.load(replacement).is_err());
    let args = [
        ("id", id("p")),
        ("owner", id("alice")),
        ("until", Value::Null),
    ];
    assert_eq!(
        pg.mutate("parent", None, context("alice", deadline, &args))
            .unwrap(),
        sqlite
            .mutate("parent", None, context("alice", deadline, &args))
            .unwrap()
    );
    assert_eq!(
        pg.sweep_expired(deadline, 1).unwrap(),
        sqlite.sweep_expired(deadline, 1).unwrap()
    );
    assert!(stored(&name).iter().all(|(n, _)| n != "children"));
    assert_eq!(
        pg.sweep_expired(deadline, 1).unwrap(),
        sqlite.sweep_expired(deadline, 1).unwrap()
    );
    assert_eq!(
        pg.mutate("parent", None, context("alice", deadline, &args))
            .unwrap(),
        sqlite
            .mutate("parent", None, context("alice", deadline, &args))
            .unwrap()
    );
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn activation_is_atomic_and_old_connections_cannot_write_the_new_generation() {
    let old = MODEL
        .replace(
            "read through .parent",
            "ownerCopy: principal\n  read <- .ownerCopy = viewer",
        )
        .replace(
            "body: 'hello', until",
            "body: 'hello', until, ownerCopy: viewer",
        );
    for owner in ["alice", "bob"] {
        let (name, mut pg, mut sqlite) = pair(&old);
        let mut input = rows(Value::Int(200));
        if let Value::Row(f) | Value::Map(f) = &mut input[0].1 {
            f.insert("ownerCopy".into(), id(owner));
        }
        pg.load(input.clone()).unwrap();
        sqlite.load(input).unwrap();
        let before = stored(&name);
        let generation = pg.generation();
        let mut stale = PostgresEngine::open(connect(), &name).unwrap();
        let b = compile(MODEL);
        let programs: Vec<_> = b.programs.into_iter().map(|p| p.program).collect();
        let actual = pg.adopt_at(b.schema.clone(), programs.clone(), 100);
        let expected = sqlite.adopt_at(b.schema, programs, 100);
        assert_eq!(
            actual.is_ok(),
            expected.is_ok(),
            "{actual:?} vs {expected:?}"
        );
        if owner == "bob" {
            assert_eq!(pg.generation(), generation);
            assert_eq!(stored(&name), before);
        } else {
            assert_eq!(
                pg.read_through_shortened().unwrap(),
                sqlite.read_through_shortened().unwrap()
            );
            assert!(
                stale
                    .query(
                        "childRow",
                        scenarios::context("alice", 100, &[("id", id("c"))])
                    )
                    .is_err()
            );
            assert_eq!(
                pg.query(
                    "childRow",
                    scenarios::context("alice", 100, &[("id", id("c"))])
                ),
                sqlite.query(
                    "childRow",
                    scenarios::context("alice", 100, &[("id", id("c"))])
                )
            );
        }
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn refusal_codes_and_meters_match_sqlite_above_and_below_reservation() {
    use snapback4_core::meter::Ceilings;
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
                let (_, mut pg, mut sqlite) = pair(&source);
                if world < 2 {
                    let mut input = rows(Value::Null);
                    if world == 1 {
                        input.remove(0);
                    }
                    pg.seed_at(input.clone(), 100).unwrap();
                    sqlite.seed_at(input, 100).unwrap();
                }
                pg.set_ceilings(ceiling);
                sqlite.set_ceilings(ceiling);
                let args = if op == "child" {
                    vec![("id", id("c")), ("parent", id("p")), ("until", Value::Null)]
                } else {
                    vec![("id", id("c")), ("parent", id("p"))]
                };
                let actual = pg
                    .mutate(op, None, scenarios::context("bob", 100, &args))
                    .unwrap();
                assert_eq!(
                    actual,
                    sqlite
                        .mutate(op, None, scenarios::context("bob", 100, &args))
                        .unwrap()
                );
                outcomes.push(actual);
            }
            for actual in &outcomes[1..] {
                assert_eq!(actual.state, outcomes[0].state);
                assert_eq!(actual.metered, outcomes[0].metered);
            }
        }
    }
}
