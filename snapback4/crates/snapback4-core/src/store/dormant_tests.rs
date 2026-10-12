//! Retention is tested through the ordinary engine and its persisted store.
use super::*;
use crate::engine::release::ReleaseActivation;
use crate::{Context, Engine, WriteState, wire};

const V1: &str = "table rows:\n  n: int\n  status: enum('active')\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nquery all():\n  return rows[] first 20 by byId\nmutation edit():\n  update rows['a'] {n: 99}\nmutation add():\n  return insert rows {n: 3, status: 'active'}\nmutation remove():\n  delete rows['gone']\n";
fn v2() -> String {
    V1.replace(
        "  n: int",
        "  extra: int default 7\n  by byExtra: extra, id\n  n: int",
    )
    .replace("enum('active')", "enum('active', 'new')")
        + "table newer:\n  n: int\n  read <- allow\n  sync public\nmutation newValue():\n  update rows['a'] {extra: 42}\nmutation badStatus():\n  update rows['a'] {status: 'new'}\nmutation repair():\n  update rows['a'] {status: 'active'}\n"
}
fn compile(source: &str) -> (Schema, Vec<crate::ir::Program>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (
        serde_json::from_str(&serde_json::to_string(&b.schema).unwrap()).unwrap(),
        b.programs
            .into_iter()
            .map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap())
            .collect(),
    )
}
fn engine(source: &str) -> Engine {
    let (s, p) = compile(source);
    Engine::new_release(Store::memory().unwrap(), s, p, 1, None).unwrap()
}
fn activate(e: &mut Engine, source: &str, n: u64) -> Result<u64, RuntimeError> {
    let (s, p) = compile(source);
    let previous = e
        .store()
        .meta("release")
        .unwrap()
        .and_then(|s| s.parse().ok());
    e.adopt_release(s, p, &ReleaseActivation::new(n, previous), false)
}
fn seed(e: &mut Engine, name: &str, json: serde_json::Value) {
    let row = wire::row_from_json(&e.schema().tables[name], &json).unwrap();
    e.seed([(name.into(), row)]).unwrap();
}
fn mutate(e: &mut Engine, name: &str, id: &str) {
    let out = e
        .mutate(
            name,
            Some(id),
            Context::new("alice", Default::default())
                .at(1000)
                .with_ids(["new".into()]),
        )
        .unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}

#[test]
fn additive_rollback_keeps_cells_tables_and_older_writes_without_disclosure() {
    let mut e = engine(V1);
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"a","n":1,"status":"active"}),
    );
    activate(&mut e, &v2(), 2).unwrap();
    mutate(&mut e, "newValue", "v2");
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"gone","n":2,"status":"active","extra":123}),
    );
    seed(&mut e, "newer", serde_json::json!({"id":"f","n":45}));
    let first = e.generation();
    activate(&mut e, V1, 1).unwrap();
    assert_eq!(e.generation(), first + 1);
    assert_eq!(e.store().count("newer").unwrap(), 0);
    assert!(
        e.store()
            .rows("rows")
            .unwrap()
            .iter()
            .all(|r| r.field("extra").is_err())
    );
    let snapshot = e.snapshot("alice").unwrap().0;
    assert!(snapshot.iter().all(|event| {
        event.table != "newer"
            && event
                .data
                .as_ref()
                .is_none_or(|r| r.field("extra").is_err())
    }));
    let inventory = e.store_mut().dormant_inventory(None, 100).unwrap();
    assert!(inventory.iter().any(|i| i.path == "newer" && i.rows == 1));
    mutate(&mut e, "edit", "edit-v1");
    mutate(&mut e, "add", "add-v1");
    mutate(&mut e, "remove", "delete-v1");
    activate(&mut e, &v2(), 2).unwrap();
    let rows = e
        .query("all", Context::new("alice", Default::default()))
        .unwrap()
        .data;
    let a = rows
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r.field("id").unwrap().as_str().unwrap() == "a")
        .unwrap();
    assert_eq!(a.field("extra").unwrap(), &Value::Int(42));
    assert_eq!(a.field("n").unwrap(), &Value::Int(99));
    let new = rows
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r.field("id").unwrap().as_str().unwrap() == "new")
        .unwrap();
    assert_eq!(new.field("extra").unwrap(), &Value::Int(7));
    assert_eq!(e.store().count("newer").unwrap(), 1);
    assert!(
        e.store()
            .rows("rows")
            .unwrap()
            .iter()
            .all(|r| r.field("id").unwrap().as_str().unwrap() != "gone")
    );
}

#[test]
fn enum_in_use_names_rows_and_values_and_rolls_back_dormancy() {
    let mut e = engine(V1);
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"a","n":1,"status":"active"}),
    );
    activate(&mut e, &v2(), 2).unwrap();
    mutate(&mut e, "badStatus", "bad");
    let generation = e.generation();
    let failure = activate(&mut e, V1, 1).unwrap_err().to_string();
    for text in ["E_ADOPT", "rows.status", "1 affected rows", "a", "new"] {
        assert!(failure.contains(text), "{failure}");
    }
    assert_eq!(e.generation(), generation);
    assert!(
        e.store_mut()
            .dormant_inventory(None, 100)
            .unwrap()
            .is_empty()
    );
    mutate(&mut e, "repair", "repair");
    activate(&mut e, V1, 1).unwrap();
    activate(&mut e, &v2(), 2).unwrap();
    assert_eq!(
        e.store().rows("rows").unwrap()[0].field("status").unwrap(),
        &Value::String("active".into())
    );
}

#[test]
fn partial_table_restoration_latest_cell_wins_and_prune_is_explicit() {
    let both = "table t:\n  a: int\n  b: int default 9\n  read <- allow\n  update <- allow\nmutation updateA():\n  update t['r'] {a: 77}\n";
    let one = "table t:\n  a: int\n  read <- allow\n  update <- allow\nmutation updateA():\n  update t['r'] {a: 77}\n";
    let absent = "query none():\n  return null\n";
    let mut e = engine(both);
    seed(&mut e, "t", serde_json::json!({"id":"r","a":1,"b":42}));
    activate(&mut e, absent, 2).unwrap();
    activate(&mut e, one, 3).unwrap();
    assert!(e.store().rows("t").unwrap()[0].field("b").is_err());
    mutate(&mut e, "updateA", "a77");
    activate(&mut e, absent, 4).unwrap();
    activate(&mut e, both, 1).unwrap();
    let row = &e.store().rows("t").unwrap()[0];
    assert_eq!(row.field("a").unwrap(), &Value::Int(77));
    assert_eq!(row.field("b").unwrap(), &Value::Int(42));
    activate(&mut e, absent, 5).unwrap();
    let before = e.generation();
    let preview = e.store_mut().prune_dormant(false, None).unwrap();
    assert_eq!(preview["pruned"], false);
    assert!(
        !e.store_mut()
            .dormant_inventory(None, 100)
            .unwrap()
            .is_empty()
    );
    let pruned = e.store_mut().prune_dormant(true, None).unwrap();
    assert_eq!(pruned["pruned"], true);
    assert_eq!(e.generation(), before);
    activate(&mut e, both, 1).unwrap();
    assert_eq!(e.store().count("t").unwrap(), 0);
}

#[test]
fn sparse_defaults_are_captured_and_defaultless_forward_refuses_new_rows() {
    let v2 = v2();
    let mut e = engine(&v2);
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"a","n":1,"status":"active"}),
    );
    // A stored omission represented 7, not the candidate's later 100.
    activate(&mut e, V1, 2).unwrap();
    mutate(&mut e, "add", "new");
    activate(&mut e, &v2.replace("default 7", "default 100"), 3).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(
        tx.get("rows", "a")
            .unwrap()
            .unwrap()
            .field("extra")
            .unwrap(),
        &Value::Int(7)
    );
    tx.rollback().unwrap();
    activate(&mut e, V1, 4).unwrap();
    // Delete the dormant values for one new row to model a required column
    // whose previous release had no default: restoration cannot invent it.
    e.store()
        .conn()
        .execute(
            "DELETE FROM _dormant_values WHERE id='new' AND column_name='extra'",
            [],
        )
        .unwrap();
    let failure = activate(
        &mut e,
        &v2.replace(" default 7", "").replace(
            "insert rows {n: 3, status: 'active'}",
            "insert rows {n: 3, status: 'active', extra: 1}",
        ),
        5,
    )
    .unwrap_err()
    .to_string();
    assert!(
        failure.contains("new") && failure.contains("bridge"),
        "{failure}"
    );
    assert_eq!(e.store().meta("release").unwrap().as_deref(), Some("4"));
}

#[test]
fn dormant_reference_cannot_attach_to_identical_reused_parent() {
    let parent = "table parents:\n  owner: principal\n  public\n  delete <- allow\nmutation remove():\n  delete parents['p']\n";
    let child = format!(
        "{parent}table children:\n  parent: parents\n  body: text <=100\n  immutable parent\n  read through .parent\n"
    );
    let mut e = engine(&child);
    seed(
        &mut e,
        "parents",
        serde_json::json!({"id":"p","owner":"alice"}),
    );
    seed(
        &mut e,
        "children",
        serde_json::json!({"id":"c","parent":"p","body":"secret"}),
    );
    activate(&mut e, parent, 2).unwrap();
    mutate(&mut e, "remove", "delete-parent");
    seed(
        &mut e,
        "parents",
        serde_json::json!({"id":"p","owner":"alice"}),
    );
    let failure = activate(&mut e, &child, 1).unwrap_err().to_string();
    assert!(
        failure.contains("c") && failure.contains("parent p") && failure.contains("lifetime"),
        "{failure}"
    );
    let invalid: i64 = e
        .store()
        .conn()
        .query_row("SELECT invalid FROM _dormant_refs WHERE id='c'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(invalid, 1);
}

#[test]
fn revision_fences_aba_equal_content_and_native_only_generations() {
    let mut e = engine(V1);
    let revision = e
        .store()
        .meta("release_revision")
        .unwrap()
        .unwrap()
        .parse()
        .unwrap();
    let stale = ReleaseActivation {
        expected_revision: Some(revision),
        ..ReleaseActivation::new(3, Some(1))
    };
    activate(&mut e, V1, 2).unwrap();
    let generation = e.generation();
    activate(&mut e, V1, 1).unwrap();
    assert_eq!(e.generation(), generation);
    let (s, p) = compile(V1);
    assert!(
        e.adopt_release(s, p, &stale, false)
            .unwrap_err()
            .to_string()
            .contains("revision")
    );
    let (s, p) = compile(V1);
    let options = ReleaseActivation {
        native_digest: Some("module-A".into()),
        ..ReleaseActivation::new(4, Some(1))
    };
    e.adopt_release(s, p, &options, false).unwrap();
    assert_eq!(e.generation(), generation + 1);
    let (s, p) = compile(V1);
    let options = ReleaseActivation {
        native_digest: Some("module-B".into()),
        ..ReleaseActivation::new(5, Some(4))
    };
    e.adopt_release(s, p, &options, false).unwrap();
    assert_eq!(e.generation(), generation + 2);
}

#[test]
fn dormant_unique_index_revalidates_older_writes_with_exact_population() {
    let next = v2().replace("by byExtra: extra, id", "unique byExtra: extra");
    let mut e = engine(&next);
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"a","n":1,"status":"active","extra":7}),
    );
    activate(&mut e, V1, 2).unwrap();
    mutate(&mut e, "add", "add-old");
    let failure = activate(&mut e, &next, 1).unwrap_err().to_string();
    for text in ["rows.byExtra", "2 affected rows", "a", "new", "7"] {
        assert!(failure.contains(text), "{failure}");
    }
    assert_eq!(e.store().meta("release").unwrap().as_deref(), Some("2"));
}

#[test]
fn dormant_assets_cannot_be_fetched_or_collected_until_explicit_prune() {
    let next = V1.replace("  n: int", "  photo: image <=1000 ?\n  n: int")
        + "mutation place(blob: image <=1000):\n  update rows['a'] {photo: blob}\n";
    let mut e = engine(&next);
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"a","n":1,"status":"active"}),
    );
    let bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let asset = e.store_asset("alice", bytes, 100).unwrap();
    let handle = Value::Map(
        std::collections::BTreeMap::from([("id".into(), Value::Id(asset.id.clone()))]).into(),
    );
    let context = Context::new(
        "alice",
        std::collections::BTreeMap::from([("blob".into(), handle)]),
    )
    .at(101);
    assert!(matches!(
        e.mutate("place", Some("place"), context).unwrap().state,
        WriteState::Sent { .. }
    ));
    assert!(e.asset_access("alice", &asset.id, 102).is_ok());
    activate(&mut e, V1, 2).unwrap();
    assert_eq!(
        e.asset_access("alice", &asset.id, 103).unwrap_err().code(),
        "E_ASSET_UNKNOWN"
    );
    let released: Option<i64> = e
        .store()
        .conn()
        .query_row(
            "SELECT released_at FROM _assets WHERE id=?1",
            [&asset.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(released, None);
    activate(&mut e, &next, 1).unwrap();
    assert!(e.asset_access("alice", &asset.id, 104).is_ok());
    activate(&mut e, V1, 3).unwrap();
    e.store_mut().prune_dormant(true, None).unwrap();
    let released: Option<i64> = e
        .store()
        .conn()
        .query_row(
            "SELECT released_at FROM _assets WHERE id=?1",
            [&asset.id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(released.is_some());
}
