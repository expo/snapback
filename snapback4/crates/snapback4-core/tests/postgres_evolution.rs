//! The same release transitions run against both store adapters.
// @ref LLP 3000.009.001.000#3.5 — EV-1 conformance includes exact restoration and failed-activation rollback.
#![cfg(feature = "sqlite")]
use snapback4_core::{
    Engine, Program, Rows, RuntimeError, Schema, Value,
    engine::{Context, release::ReleaseActivation},
    store_port::AnyStore,
    value::object,
};
fn bound(source: &str) -> (Schema, Vec<Program>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (
        serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap(),
        b.programs
            .into_iter()
            .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
            .collect(),
    )
}
const V1: &str = "table notes:\n  n: int\n  memo: json <=100 ?\n  unique byN: n\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\ntable retired:\n  value: text <=100\n  public\n  insert <- allow\n  online only\nquery peek(key: id):\n  return notes[key]\nmutation erase(key: id):\n  delete notes[key]\n";
fn v2() -> String {
    V1.replace(
        "  memo: json <=100 ?\n",
        "  extra: text <=100 ?\n  count: int default 7\n",
    )
    .replace("  unique byN: n\n", "")
    .replace(
        "table retired:\n  value: text <=100\n  public\n  insert <- allow\n  online only\n",
        "table added:\n  n: int\n  public\n  insert <- allow\n  online only\n",
    )
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn seed(e: &mut Engine) {
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    for (name, row) in [
        (
            "notes",
            object([
                ("id", id("a")),
                ("n", Value::Int(1)),
                ("memo", Value::String("雪\0exact".into())),
            ]),
        ),
        (
            "notes",
            object([("id", id("b")), ("n", Value::Int(2)), ("memo", Value::Null)]),
        ),
        (
            "retired",
            object([
                ("id", id("z")),
                ("value", Value::String("retained row".into())),
            ]),
        ),
    ] {
        tx.put(name, &schema.tables[name], &row, None).unwrap();
    }
    tx.commit().unwrap();
}
fn release(e: &mut Engine, source: &str, n: u64, restore: bool) -> Result<u64, RuntimeError> {
    let (s, p) = bound(source);
    let mut options = ReleaseActivation::new(n, Some(n - 1));
    options.restore_dormant = restore;
    e.adopt_release_at(s, p, &options, false, 1000)
}
fn contract(store: AnyStore) {
    let (s, p) = bound(V1);
    let mut e = Engine::new_release(store, s, p, 1, None).unwrap();
    seed(&mut e);
    let notes = e.store().rows("notes").unwrap();
    let retired = e.store().rows("retired").unwrap();
    assert_eq!(release(&mut e, &v2(), 2, false).unwrap(), 2);
    let inventory = e.store_mut().dormant_inventory(None, usize::MAX).unwrap();
    assert_eq!(
        inventory
            .iter()
            .find(|i| i.key == "column:notes.memo")
            .unwrap()
            .rows,
        2
    );
    assert_eq!(
        inventory
            .iter()
            .find(|i| i.key == "table:retired")
            .unwrap()
            .rows,
        1
    );
    assert_eq!(
        inventory
            .iter()
            .find(|i| i.key == "index:notes.byN")
            .unwrap()
            .rows,
        2
    );
    let query = e
        .query(
            "peek",
            Context::new("alice", [("key".into(), id("a"))].into()).at(1000),
        )
        .unwrap();
    assert_eq!(query.data.field("count").unwrap(), &Value::Int(7));
    assert_eq!(query.data.field("extra").unwrap(), &Value::Null);
    // Defaults are interpreted, not eagerly written into the physical image.
    assert!(e.store().rows("notes").unwrap()[0].field("count").is_err());
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    tx.put(
        "added",
        &schema.tables["added"],
        &object([("id", id("new")), ("n", Value::Int(9))]),
        None,
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(release(&mut e, V1, 3, false).unwrap_err().code(), "E_ADOPT");
    assert_eq!(e.generation(), 2);
    assert_eq!(
        serde_json::to_value(e.store_mut().dormant_inventory(None, usize::MAX).unwrap()).unwrap(),
        serde_json::to_value(&inventory).unwrap()
    );
    assert_eq!(release(&mut e, V1, 3, true).unwrap(), 3);
    assert_eq!(e.store().rows("notes").unwrap(), notes);
    assert_eq!(e.store().rows("retired").unwrap(), retired);
    // Redefining a unique index fails after row/cell moves, with no partial state.
    release(&mut e, &v2(), 4, true).unwrap();
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    let old = tx.get("notes", "b").unwrap().unwrap();
    let mut duplicate = old.clone();
    if let Value::Row(fields) = &mut duplicate {
        fields.insert("n".into(), Value::Int(1));
    }
    tx.put("notes", &schema.tables["notes"], &duplicate, Some(&old))
        .unwrap();
    tx.commit().unwrap();
    let before = e.store().rows("notes").unwrap();
    let inventory = e.store_mut().dormant_inventory(None, usize::MAX).unwrap();
    let status = e.store_mut().release_status(0, None, None).unwrap();
    assert!(release(&mut e, V1, 5, true).is_err());
    assert_eq!(e.store_mut().release_status(0, None, None).unwrap(), status);
    assert_eq!(e.generation(), 4);
    assert_eq!(e.store().rows("notes").unwrap(), before);
    assert!(e.store().rows("retired").unwrap().is_empty());
    assert_eq!(
        serde_json::to_value(e.store_mut().dormant_inventory(None, usize::MAX).unwrap()).unwrap(),
        serde_json::to_value(&inventory).unwrap()
    );
    // Fix active data and restore; the failed candidate consumed no selection.
    let tx = e.store_mut().transaction().unwrap();
    tx.put("notes", &schema.tables["notes"], &old, Some(&duplicate))
        .unwrap();
    tx.commit().unwrap();
    release(&mut e, V1, 5, true).unwrap();
    assert_eq!(e.store().rows("notes").unwrap(), notes);
    // Partial table restoration keeps omitted cells, then a later column restore consumes them.
    let partial = V1.replace("  value: text <=100\n", "");
    release(&mut e, &v2(), 6, true).unwrap();
    let partial = partial.replace("  memo: json <=100 ?\n", "");
    release(&mut e, &partial, 7, true).unwrap();
    assert!(
        e.store().rows("retired").unwrap()[0]
            .field("value")
            .is_err()
    );
    release(&mut e, V1, 8, true).unwrap();
    let redefined = V1.replace("unique byN: n", "by byN: n, id");
    release(&mut e, &redefined, 9, true).unwrap();
    release(&mut e, V1, 10, true).unwrap();
    assert_eq!(e.store().rows("notes").unwrap(), notes);
}
#[test]
fn ev1_sqlite_release_contract() {
    contract(AnyStore::memory().unwrap());
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn ev1_postgres_release_contract() {
    let c = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    contract(
        AnyStore::create_postgres(&c, &format!("sb4_ev1_{:x}", snapback4_core::ids::seed()))
            .unwrap(),
    );
}

fn references(store: AnyStore) {
    let source = "table parents:\n  n: int\n  public\n  insert <- allow\n  delete <- allow\n  online only\ntable children:\n  parent: parents ?\n  public\n  insert <- allow\n  delete <- allow\n  online only\n";
    let (s, p) = bound(source);
    let mut e = Engine::new_release(store, s, p, 1, None).unwrap();
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    let parent = object([("id", id("p")), ("n", Value::Int(1))]);
    let child = object([("id", id("c")), ("parent", id("p"))]);
    tx.put("parents", &schema.tables["parents"], &parent, None)
        .unwrap();
    tx.put("children", &schema.tables["children"], &child, None)
        .unwrap();
    tx.commit().unwrap();
    let removed = source.replace("  parent: parents ?\n", "");
    release(&mut e, &removed, 2, false).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    tx.delete("parents", &schema.tables["parents"], &parent)
        .unwrap();
    tx.put("parents", &schema.tables["parents"], &parent, None)
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(
        release(&mut e, source, 3, true).unwrap_err().code(),
        "E_ADOPT"
    );
    // Deleting the child erases its retained cell/ref evidence; id reuse is fresh.
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    let old = tx.get("children", "c").unwrap().unwrap();
    tx.delete("children", &schema.tables["children"], &old)
        .unwrap();
    tx.put(
        "children",
        &schema.tables["children"],
        &object([("id", id("c"))]),
        None,
    )
    .unwrap();
    tx.commit().unwrap();
    release(&mut e, source, 3, true).unwrap();
    assert!(
        e.store().rows("children").unwrap()[0]
            .field("parent")
            .is_err()
    );
}
#[test]
fn ev1_sqlite_reference_lifetimes() {
    references(AnyStore::memory().unwrap());
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn ev1_postgres_reference_lifetimes() {
    let c = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    references(
        AnyStore::create_postgres(
            &c,
            &format!("sb4_ev1_refs_{:x}", snapback4_core::ids::seed()),
        )
        .unwrap(),
    );
}

fn stale(store: AnyStore, reopen: impl Fn() -> AnyStore, refusals: bool) {
    let (s, p) = bound(V1);
    let mut e = Engine::new_release(store, s, p, 1, None).unwrap();
    seed(&mut e);
    let mut old = Engine::open_at(reopen(), 1000).unwrap();
    release(&mut e, &v2(), 2, false).unwrap();
    let before = e.store().rows("notes").unwrap();
    let error = old
        .mutate(
            "erase",
            Some("stale"),
            Context::new("alice", [("key".into(), id("a"))].into()).at(1000),
        )
        .unwrap_err();
    assert_eq!(error.code(), "E_GENERATION");
    assert_eq!(e.store().rows("notes").unwrap(), before);
    if !refusals {
        return;
    }
    let (base, programs) = bound(&v2());
    for (case, family) in [
        (0, "evolution-narrowing"),
        (1, "evolution-required-column"),
        (2, "evolution-authority"),
        (3, "evolution-renames"),
    ] {
        let mut next = base.clone();
        match case {
            0 => {
                next.tables.get_mut("notes").unwrap().columns.insert(
                    "n".into(),
                    snapback4_core::schema::ColumnType::IntRange { min: 0, max: 1 },
                );
            }
            1 => {
                next.tables
                    .get_mut("notes")
                    .unwrap()
                    .columns
                    .insert("required".into(), snapback4_core::schema::ColumnType::Int);
            }
            2 => {
                next.tables.get_mut("notes").unwrap().rules.read =
                    snapback4_core::schema::RuleExpr::Deny
            }
            _ => {
                next.table_renames.insert("notes".into(), "moved".into());
            }
        }
        let before_inventory =
            serde_json::to_value(e.store_mut().dormant_inventory(None, usize::MAX).unwrap())
                .unwrap();
        let result = e.adopt_release_at(
            next,
            programs.clone(),
            &ReleaseActivation::new(3, Some(2)),
            false,
            1000,
        );
        // SQLite has a broader evolution contract; the capability refusals
        // belong specifically to the Postgres profile.
        assert!(
            matches!(result,Err(RuntimeError::StoreUnsupported{family:f}) if f==family),
            "{case}: {result:?}"
        );
        assert_eq!(e.generation(), 2);
        assert_eq!(e.store().rows("notes").unwrap(), before);
        assert_eq!(
            serde_json::to_value(e.store_mut().dormant_inventory(None, usize::MAX).unwrap())
                .unwrap(),
            before_inventory
        );
    }
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn ev1_postgres_generation_and_named_refusals() {
    let c = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let name = format!("sb4_ev1_stale_{:x}", snapback4_core::ids::seed());
    stale(
        AnyStore::create_postgres(&c, &name).unwrap(),
        || AnyStore::open_postgres(&c, &name).unwrap(),
        true,
    );
}

#[test]
fn ev1_sqlite_generation_fence() {
    let path =
        std::env::temp_dir().join(format!("sb4-ev1-stale-{:x}", snapback4_core::ids::seed()));
    std::fs::create_dir(&path).unwrap();
    let db = path.join("store.sqlite");
    stale(
        AnyStore::open(&db).unwrap(),
        || AnyStore::open(&db).unwrap(),
        false,
    );
    std::fs::remove_dir_all(path).unwrap();
}
