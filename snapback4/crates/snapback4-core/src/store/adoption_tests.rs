//! Compare the incremental index plan with the former whole-store activation.
use super::*;
use crate::{Context, Engine, value::object};
const BASE: &str = r#"
table posts:
  author: principal
  at: time
  parent: posts ?
  amount: int
  immutable author, at, parent
  public
  sync public
table likes:
  post: posts
  author: principal
  at: time
  immutable post, author, at
  public
  sync public
table unrelated:
  owner: principal
  n: int
  read <- .owner = viewer
  sync to .owner
query unrelated(owner: principal):
  return unrelated where .owner = owner first 10 by .id
"#;
const VIEWS: &str = r#"
view originalTotals: count posts where .parent = null by .author
view receivedLikes: count likes by .post.author
view receivedReplies: count posts where .parent != null by .parent.author
view dailyPosts: count posts where .parent = null by .author, day(.at)
view dailyLikes: count likes by .post.author, day(.at)
view sums: sum posts of .amount by .author
query total(owner: principal):
  return receivedLikes[owner]
"#;
struct Bound {
    schema: Schema,
    programs: Vec<crate::ir::Program>,
}
fn compile(s: &str) -> Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), s.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Bound {
        schema: serde_json::from_str(&serde_json::to_string(&b.schema).unwrap()).unwrap(),
        programs: b
            .programs
            .into_iter()
            .map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap())
            .collect(),
    }
}
fn engine(full: bool) -> Engine {
    let b = compile(BASE);
    let mut store = Store::memory().unwrap();
    store.full_adoption = full;
    let mut e = Engine::new_at(store, b.schema, b.programs, 10).unwrap();
    for n in 0..40 {
        e.seed_at(
            [(
                "posts".into(),
                object([
                    ("id", Value::Id(format!("p{n}"))),
                    ("author", Value::Id(format!("u{}", n % 3))),
                    ("at", Value::Int(n * 86_400_000 - 1)),
                    (
                        "parent",
                        if n % 2 == 0 {
                            Value::Null
                        } else {
                            Value::Id(format!("p{}", n - 1))
                        },
                    ),
                    ("amount", Value::Int(n - 20)),
                ]),
            )],
            10,
        )
        .unwrap();
        e.seed_at(
            [(
                "likes".into(),
                object([
                    ("id", Value::Id(format!("l{n}"))),
                    ("author", Value::Id("reader".into())),
                    ("post", Value::Id(format!("p{}", n + 1))),
                    ("at", Value::Int(n)),
                ]),
            )],
            10,
        )
        .unwrap();
    }
    e.seed_at(
        [(
            "unrelated".into(),
            object([
                ("id", Value::Id("other".into())),
                ("owner", Value::Id("private".into())),
                ("n", Value::Int(5)),
            ]),
        )],
        10,
    )
    .unwrap();
    e
}
fn rows(e: &Engine, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut stmt = e
        .store()
        .conn()
        .prepare(&format!("SELECT * FROM {table} ORDER BY 1,2,3"))
        .unwrap();
    let columns = stmt.column_count();
    stmt.query_map([], |r| (0..columns).map(|i| r.get(i)).collect())
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}
fn same(a: &Engine, b: &Engine) {
    assert_eq!(a.generation(), b.generation());
    assert_eq!(a.seq().unwrap(), b.seq().unwrap());
    for table in ["r", "i", "_log", "_commits"] {
        assert_eq!(rows(a, table), rows(b, table), "{table}");
    }
}
#[test]
fn optimized_activation_equals_full_rows_indexes_log_images_and_sequence() {
    let (mut optimized, mut full) = (engine(false), engine(true));
    same(&optimized, &full);
    for extra in [
        VIEWS.to_owned(),
        format!("{VIEWS}\nquery newest():\n  return unrelated last 10 by .n\n"),
        VIEWS.replace("day(.at)", "day(.at, 8h)"),
    ] {
        let b = compile(&format!("{BASE}{extra}"));
        for e in [&mut optimized, &mut full] {
            e.adopt_at(b.schema.clone(), b.programs.clone(), 20)
                .unwrap();
        }
        same(&optimized, &full);
    }
    // The captured fact belongs to the old source even if the target vanishes.
    for e in [&mut optimized, &mut full] {
        e.seed_delete("posts", "p1").unwrap();
    }
    let b = compile(&format!(
        "{BASE}{}",
        VIEWS.replace("count likes by", "count likes where .at > 5 by")
    ));
    for e in [&mut optimized, &mut full] {
        e.adopt_at(b.schema.clone(), b.programs.clone(), 30)
            .unwrap();
    }
    // seed_delete takes wall time; compare data/log and sequences, not its clock.
    for table in ["r", "i", "_log"] {
        assert_eq!(rows(&optimized, table), rows(&full, table), "{table}");
    }
    let result = optimized
        .query_at(
            "total",
            Context::new(
                "reader",
                BTreeMap::from([("owner".into(), Value::Id("u1".into()))]),
            )
            .at(30),
        )
        .0
        .unwrap();
    assert!(result.complete);
}

#[test]
fn an_added_view_does_not_touch_an_unrelated_index() {
    let mut e = engine(false);
    e.store().conn().execute_batch("CREATE TEMP TRIGGER forbid_unrelated_delete BEFORE DELETE ON i WHEN OLD.ti = (SELECT num FROM _catalog WHERE name = 'unrelated.byId') BEGIN SELECT RAISE(ABORT, 'unrelated index was rewritten'); END; CREATE TEMP TRIGGER forbid_unrelated_insert BEFORE INSERT ON i WHEN NEW.ti = (SELECT num FROM _catalog WHERE name = 'unrelated.byId') BEGIN SELECT RAISE(ABORT, 'unrelated index was rewritten'); END;").unwrap();
    let b = compile(&format!("{BASE}{VIEWS}"));
    e.adopt_at(b.schema, b.programs, 20).unwrap();
}

#[test]
fn changed_defaults_rebuild_unique_and_word_keys_from_legacy_absent_fields() {
    let old = "table notes:\n  label: text <=20 default 'old'\n  at: time default 0\n  unique label\n  search label\n  public\nquery page():\n  return notes matching 'new' first 10 by .at\n";
    let mut engines = Vec::new();
    for full in [false, true] {
        let b = compile(old);
        let mut store = Store::memory().unwrap();
        store.full_adoption = full;
        let mut engine = Engine::new_at(store, b.schema.clone(), b.programs, 1).unwrap();
        let tx = engine.store_mut().transaction().unwrap();
        tx.put(
            "notes",
            &b.schema.tables["notes"],
            &object([("id", Value::Id("n".into()))]),
            None,
        )
        .unwrap();
        tx.commit().unwrap();
        let next = compile(&old.replace("default 'old'", "default 'new'"));
        engine.adopt_at(next.schema, next.programs, 2).unwrap();
        engines.push(engine);
    }
    same(&engines[0], &engines[1]);
    let result = engines[0]
        .query("page", Context::new("reader", BTreeMap::new()))
        .unwrap();
    assert!(result.complete);
    assert!(canonical_json(&result.data).contains("new"));
}
