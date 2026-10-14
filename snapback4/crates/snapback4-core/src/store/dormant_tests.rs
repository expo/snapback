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
fn enum_in_use_is_hidden_on_rollback_and_restored_verbatim() {
    let mut e = engine(V1);
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"a","n":1,"status":"active"}),
    );
    activate(&mut e, &v2(), 2).unwrap();
    mutate(&mut e, "badStatus", "bad");
    let generation = e.generation();
    activate(&mut e, V1, 1).unwrap();
    assert_eq!(e.generation(), generation+1);
    assert_eq!(e.store().count("rows").unwrap(),0);
    assert!(e.snapshot("alice").unwrap().0.iter().all(|event|event.table!="rows"));
    let items=e.store_mut().dormant_inventory(None,100).unwrap();
    assert!(items.iter().any(|i|i.key=="rows:rows" && i.rows==1));
    activate(&mut e, &v2(), 2).unwrap();
    assert_eq!(e.store().rows("rows").unwrap()[0].field("status").unwrap(),&Value::String("new".into()));

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

#[test]
fn activation_expiry_invalidates_parent_lifetime_and_failed_commit_undoes_it() {
    let parent = "table roots:\n  public\ntable parents:\n  root: roots\n  until: time default 10\n  immutable root, until\n  read through .root\n  expire at .until\n";
    let child = format!(
        "{parent}table children:\n  parent: parents\n  body: text <=100\n  immutable parent\n  read through .parent\n"
    );
    let mut e = engine(&child);
    let row =
        wire::row_from_json(&e.schema().tables["roots"], &serde_json::json!({"id":"r"})).unwrap();
    e.seed_at([("roots".into(), row)], 0).unwrap();
    let row = wire::row_from_json(
        &e.schema().tables["parents"],
        &serde_json::json!({"id":"p","root":"r","until":1}),
    )
    .unwrap();
    e.seed_at([("parents".into(), row)], 0).unwrap();
    let row = wire::row_from_json(
        &e.schema().tables["children"],
        &serde_json::json!({"id":"c","parent":"p","body":"old"}),
    )
    .unwrap();
    e.seed_at([("children".into(), row)], 0).unwrap();
    let older = parent.replace("default 10", "default 20");
    e.store().conn().commit_hook(Some(|| true)).unwrap();
    assert!(activate(&mut e, &older, 2).is_err());
    e.store().conn().commit_hook(None::<fn() -> bool>).unwrap();
    assert_eq!(e.store().count("parents").unwrap(), 1);
    assert!(
        e.store_mut()
            .dormant_inventory(None, 100)
            .unwrap()
            .is_empty()
    );
    activate(&mut e, &older, 2).unwrap();
    assert_eq!(e.store().count("parents").unwrap(), 0);
    let invalid: i64 = e
        .store()
        .conn()
        .query_row("SELECT invalid FROM _dormant_refs WHERE id='c'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(invalid, 1);
    let row = wire::row_from_json(
        &e.schema().tables["parents"],
        &serde_json::json!({"id":"p","root":"r","until":1}),
    )
    .unwrap();
    e.seed_at([("parents".into(), row)], 0).unwrap();
    let error = activate(&mut e, &child, 1).unwrap_err().to_string();
    assert!(error.contains("lifetime") && error.contains("c"), "{error}");
}

#[test]
fn audit_pages_distinguish_same_named_column_and_index() {
    let next = v2().replace(
        "  extra: int default 7",
        "  byExtra: int default 11\n  extra: int default 7",
    );
    let mut e = engine(&next);
    seed(
        &mut e,
        "rows",
        serde_json::json!({"id":"a","n":1,"status":"active","extra":42,"byExtra":99}),
    );
    activate(&mut e, V1, 2).unwrap();
    let mut keys = std::collections::BTreeSet::new();
    let mut after = None;
    loop {
        let page = e
            .store_mut()
            .dormant_inventory(after.as_deref(), 1)
            .unwrap();
        if page.is_empty() {
            break;
        }
        after = Some(page[0].key.clone());
        assert!(keys.insert(page[0].key.clone()));
    }
    assert!(keys.contains("column:rows.byExtra"));
    assert!(keys.contains("index:rows.byExtra"));
    let events = e.store_mut().release_status(0, None, None).unwrap();
    let id = events["events"].as_array().unwrap().last().unwrap()["id"]
        .as_u64()
        .unwrap();
    let items = e.store_mut().release_status(0, None, Some(id)).unwrap();
    assert_eq!(items["items"].as_array().unwrap().len(), keys.len());
    activate(&mut e, &next, 1).unwrap();
    assert_eq!(
        e.store().rows("rows").unwrap()[0].field("byExtra").unwrap(),
        &Value::Int(99)
    );
}

#[test]
fn release_refuses_durable_to_ephemeral_or_derived_ownership_with_population() {
    let original = "table rows:\n  n: int\n  public\n";
    let mut e = engine(original);
    seed(&mut e, "rows", serde_json::json!({"id":"owned","n":7}));
    for candidate in [
        "table rows:\n  n: int\n  public\n  ephemeral 4s\n",
        "table source:\n  n: int\n  public\nview rows: sum source of .n by .n\n",
    ] {
        let error = activate(&mut e, candidate, 2).unwrap_err().to_string();
        for detail in [
            "rows",
            "1 affected rows",
            "owned",
            "prune <dir> --allow-destructive",
        ] {
            assert!(error.contains(detail), "{error}");
        }
        assert_eq!(e.store().count("rows").unwrap(), 1);
        assert_eq!(e.store().meta("release").unwrap().as_deref(), Some("1"));
    }
}

#[test]
fn release_internal_names_refuse_and_development_keeps_legacy_format() {
    let (s, p) = compile(V1);
    let e = Engine::new(Store::memory().unwrap(), s.clone(), p.clone()).unwrap();
    assert_eq!(
        e.store().meta("version").unwrap().as_deref(),
        Some("snapback4-store-1")
    );
    let mut injected = s;
    let table = injected.tables["rows"].clone();
    injected.tables.insert("_dormant_rows".into(), table);
    let issues = crate::schema::validate(&injected);
    assert!(
        issues.iter().any(|i| i.message.contains("reserved")),
        "{issues:?}"
    );
    assert!(Engine::new_release(Store::memory().unwrap(), injected, p, 1, None).is_err());
}

#[test]
fn joint_parent_child_retirement_preserves_lifetimes_in_both_name_orders() {
    for (parent, child) in [("parents", "zchildren"), ("zparents", "children")] {
        let source = format!(
            "table {parent}:\n  n: int\n  public\ntable {child}:\n  parent: {parent}\n  body: text <=100\n  immutable parent\n  read through .parent\n  sync public\n"
        );
        let mut e = engine(&source);
        seed(&mut e, parent, serde_json::json!({"id":"p","n":7}));
        seed(
            &mut e,
            child,
            serde_json::json!({"id":"c","parent":"p","body":"kept"}),
        );
        activate(&mut e, "query noop():\n  return 1\n", 2).unwrap();
        let invalid: i64 = e
            .store()
            .conn()
            .query_row(
                "SELECT COALESCE(SUM(invalid),0) FROM _dormant_refs",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(invalid, 0);
        activate(&mut e, &source, 1).unwrap();
        assert_eq!(
            e.store().rows(child).unwrap()[0].field("body").unwrap(),
            &Value::String("kept".into())
        );
    }
}

#[test]
fn restored_through_deadline_recomputes_before_queries_sync_and_asset_reads() {
    let future = crate::now_ms() + 86_400_000;
    let parent = "table parents:\n  until: time\n  immutable until\n  public\n  expire at .until\n";
    let full = format!(
        "{parent}table children:\n  parent: parents\n  body: text <=100\n  photo: image <=1000 ?\n  immutable parent\n  update <- allow\n  read through .parent\n  sync public\nquery all():\n  return children[] first 20 by byId\nmutation place(blob: image <=1000):\n  update children['c'] {{photo: blob}}\n"
    );
    let mut e = engine(&full);
    seed(
        &mut e,
        "parents",
        serde_json::json!({"id":"p","until":future}),
    );
    seed(
        &mut e,
        "children",
        serde_json::json!({"id":"c","parent":"p","body":"kept"}),
    );
    let bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let asset = e.store_asset("alice", bytes, 100).unwrap();
    let handle = Value::Map(
        std::collections::BTreeMap::from([("id".into(), Value::Id(asset.id.clone()))]).into(),
    );
    e.mutate(
        "place",
        Some("asset-home"),
        Context::new(
            "alice",
            std::collections::BTreeMap::from([("blob".into(), handle)]),
        )
        .at(101),
    )
    .unwrap();
    assert!(e.asset_access("alice", &asset.id, 102).is_ok());
    activate(&mut e, parent, 2).unwrap();
    let expired = full.replace(
        "  immutable parent",
        "  cutoff: time default 0\n  expire at .cutoff\n  immutable parent, cutoff",
    );
    activate(&mut e, &expired, 1).unwrap();
    let row = e.store().rows("children").unwrap().remove(0);
    assert_eq!(
        row.field(crate::schema::through::DEADLINE).unwrap(),
        &Value::Int(0)
    );
    let read = e
        .query("all", Context::new("alice", Default::default()).at(1000))
        .unwrap();
    assert!(read.data.as_array().unwrap().is_empty());
    assert!(
        e.snapshot("alice")
            .unwrap()
            .0
            .iter()
            .all(|event| event.table != "children")
    );
    assert!(e.asset_access("alice", &asset.id, 1000).is_err());
}

#[test]
fn restored_recorded_attribution_preserves_values_and_nulls_before_aggregate_rebuild() {
    let future = crate::now_ms() + 86_400_000;
    let parent = "table targets:\n  owner: principal\n  until: time\n  immutable owner, until\n  public\n  expire at .until\n";
    let full = format!(
        "{parent}table events:\n  parent: targets\n  immutable parent\n  public\nview totals: count events by .parent.owner\n"
    );
    let mut e = engine(&full);
    for (id, owner, until) in [
        ("p", serde_json::json!("alice"), 1),
        ("q", serde_json::json!("bob"), future),
    ] {
        let row = wire::row_from_json(
            &e.schema().tables["targets"],
            &serde_json::json!({"id":id,"owner":owner,"until":until}),
        )
        .unwrap();
        e.seed_at([("targets".into(), row)], 0).unwrap();
        let row = wire::row_from_json(
            &e.schema().tables["events"],
            &serde_json::json!({"id":id,"parent":id}),
        )
        .unwrap();
        e.seed_at(
            [("events".into(), row)],
            if id == "q" { future + 1 } else { 0 },
        )
        .unwrap();
    }
    let before = e.store().rows("events").unwrap();
    assert_eq!(
        before[0].field("parent.owner").unwrap(),
        &Value::Id("alice".into())
    );
    assert_eq!(before[1].field("parent.owner").unwrap(), &Value::Null);
    activate(&mut e, parent, 2).unwrap();
    activate(&mut e, &full, 1).unwrap();
    assert_eq!(e.store().rows("events").unwrap(), before);
    let totals = e.store().rows("totals").unwrap();
    assert_eq!(totals.len(), 2, "{totals:?}");
    assert!(totals.iter().any(|row| {
        row.as_object()
            .unwrap()
            .values()
            .any(|v| v == &Value::Id("alice".into()))
    }));
}

#[test]
fn dormant_through_captures_keep_parent_lifetime_when_reference_stays_active() {
    let full = "table parents:\n  n: int\n  public\n  delete <- allow\ntable children:\n  parent: parents\n  body: text <=100\n  immutable parent\n  read through .parent\nmutation remove():\n  delete parents['p']\n";
    let older = full.replace("  read through .parent", "  public")
        .replace("  parent: parents\n", "  parent: parents on delete keep\n");
    let mut e = engine(full);
    seed(&mut e, "parents", serde_json::json!({"id":"p","n":7}));
    seed(
        &mut e,
        "children",
        serde_json::json!({"id":"c","parent":"p","body":"kept"}),
    );
    activate(&mut e, &older, 2).unwrap();
    mutate(&mut e, "remove", "end-parent-lifetime");
    seed(&mut e, "parents", serde_json::json!({"id":"p","n":7}));
    let error = activate(&mut e, full, 1).unwrap_err().to_string();
    assert!(error.contains("lifetime") && error.contains("c"), "{error}");
}

#[test]
fn refusal_for_a_new_through_capture_names_missing_parent_and_child() {
    let old = "table parents:\n  public\ntable children:\n  parent: parents\n  immutable parent\n  public\n";
    let mut e = engine(old);
    seed(
        &mut e,
        "children",
        serde_json::json!({"id":"broken-child","parent":"missing-parent"}),
    );
    let next = old.replace(
        "  immutable parent\n  public",
        "  immutable parent\n  read through .parent",
    );
    let error = activate(&mut e, &next, 2).unwrap_err().to_string();
    for item in [
        "children",
        "parent",
        "parents",
        "1 child rows",
        "broken-child",
        "missing-parent",
        "snapback4 deploy <dir>",
    ] {
        assert!(error.contains(item), "{error}");
    }
}
#[test]
fn maintain_refusal_names_its_selected_source_population_and_values() {
    let old = "table amounts:\n  n: int\n  public\n";
    let mut e = engine(old);
    for id in ["a", "b"] {
        seed(
            &mut e,
            "amounts",
            serde_json::json!({"id":id,"n":crate::value::I53_MAX}),
        );
    }
    let next = format!("{old}view totals: sum amounts of .n by .n\n");
    let error = activate(&mut e, &next, 2).unwrap_err().to_string();
    for item in [
        "amounts",
        "2 selected source rows",
        "a",
        "b",
        "9007199254740991",
        "snapback4 deploy <dir>",
    ] {
        assert!(error.contains(item), "{error}");
    }
}

#[test]
fn dormant_through_deadline_refuses_retargeted_parent_reference() {
    let future = crate::now_ms() + 86_400_000;
    let full = "table parents:\n  until: time\n  immutable until\n  public\n  expire at .until\ntable children:\n  parent: parents\n  body: text <=100\n  immutable parent\n  update <- allow\n  read through .parent\n";
    let older = full
        .replace("  immutable parent\n", "")
        .replace("  read through .parent", "  public")
        + "mutation retarget():\n  update children['c'] {parent: 'q'}\n";
    let mut e = engine(full);
    for (id, until) in [("p", future), ("q", 1)] {
        let row = wire::row_from_json(
            &e.schema().tables["parents"],
            &serde_json::json!({"id":id,"until":until}),
        )
        .unwrap();
        e.seed_at([("parents".into(), row)], 0).unwrap();
    }
    let row = wire::row_from_json(
        &e.schema().tables["children"],
        &serde_json::json!({"id":"c","parent":"p","body":"kept"}),
    )
    .unwrap();
    e.seed_at([("children".into(), row)], 0).unwrap();
    activate(&mut e, &older, 2).unwrap();
    mutate(&mut e, "retarget", "older-retarget");
    let error = activate(&mut e, full, 1).unwrap_err().to_string();
    for detail in [
        "children.parent",
        "1 affected rows",
        "c",
        "p",
        "q",
        "rollback <dir> --to",
    ] {
        assert!(error.contains(detail), "{error}");
    }
    assert_eq!(e.store().meta("release").unwrap().as_deref(), Some("2"));
}

#[test]
fn rollback_runs_only_active_actions_and_deleted_parents_block_dormant_restoration() {
    let old = "table parents:\n  n: int\n  read <- allow\n  delete <- allow\n  sync public\nmutation drop():\n  delete parents['p']\n";
    for action in ["cascade", "restrict"] {
        let next = format!("{old}table children:\n  parent: parents on delete {action}\n  cap 4 by parent\n  read <- allow\n  sync public\n");
        let mut e = engine(old);
        seed(&mut e, "parents", serde_json::json!({"id":"p","n":1}));
        activate(&mut e, &next, 2).unwrap();
        seed(&mut e, "children", serde_json::json!({"id":"c","parent":"p"}));
        activate(&mut e, old, 1).unwrap();
        mutate(&mut e, "drop", "old-delete");
        assert_eq!(e.store().count("parents").unwrap(), 0);
        assert!(e.store_mut().dormant_inventory(None, 100).unwrap().iter().any(|i| i.path == "children" && i.rows == 1));
        // Reusing exactly the same id/value does not restore the old lifetime.
        seed(&mut e, "parents", serde_json::json!({"id":"p","n":1}));
        let generation = e.generation();
        let error = activate(&mut e, &next, 2).unwrap_err();
        assert_eq!(error.code(), "E_ADOPT");
        assert!(error.to_string().contains("parent lifetime"), "{error}");
        assert_eq!(e.generation(), generation);
        assert_eq!(e.store().count("children").unwrap(), 0);
        e.store_mut().prune_dormant(true, None).unwrap();
        activate(&mut e, &next, 2).unwrap();
        assert_eq!(e.store().count("children").unwrap(), 0);
    }
}

#[test]
fn rollback_replaces_newer_actions_on_a_reference_that_stays_active() {
    let base = "table parents:\n  n: int\n  read <- allow\n  delete <- allow\n  sync public\nmutation drop():\n  delete parents['p']\ntable children:\n  parent: parents on delete keep\n  cap 4 by parent\n  read <- allow\n  sync public\n";
    for action in ["cascade", "restrict"] {
        let next = base.replace("on delete keep", &format!("on delete {action}"));
        let mut e = engine(base);
        seed(&mut e, "parents", serde_json::json!({"id":"p","n":1}));
        seed(&mut e, "children", serde_json::json!({"id":"c","parent":"p"}));
        activate(&mut e, &next, 2).unwrap();
        activate(&mut e, base, 1).unwrap();
        mutate(&mut e, "drop", "selected-keep");
        assert_eq!(e.store().count("parents").unwrap(), 0);
        assert_eq!(e.store().count("children").unwrap(), 1);
    }
    let old = base.replace("on delete keep", "on delete restrict");
    let mut e = engine(&old);
    seed(&mut e, "parents", serde_json::json!({"id":"p","n":1}));
    seed(&mut e, "children", serde_json::json!({"id":"c","parent":"p"}));
    activate(&mut e, &base.replace("on delete keep", "on delete cascade"), 2).unwrap();
    activate(&mut e, &old, 1).unwrap();
    let out = e.mutate("drop", Some("selected-restrict"), Context::new("alice", Default::default()).at(1000)).unwrap();
    assert!(matches!(out.state, WriteState::Failed { .. }));
    assert_eq!(e.store().count("parents").unwrap(), 1);
    assert_eq!(e.store().count("children").unwrap(), 1);
}

#[test]
fn narrowing_hides_reference_closure_and_rebuilds_unchanged_counts_and_indexes() {
    let wide="table parents:\n  status: enum('live', 'new')\n  public\n  sync public\ntable children:\n  parent: parents\n  immutable parent\n  public\n  sync public\ntable leaves:\n  child: children\n  immutable child\n  public\n  sync public\nview counts: count children by .parent\nquery total(p: parents):\n  return counts[p]\n";
    let old=wide.replace("enum('live', 'new')","enum('live')");
    let mut e=engine(wide);
    seed(&mut e,"parents",serde_json::json!({"id":"p","status":"new"}));
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"p"}));
    seed(&mut e,"leaves",serde_json::json!({"id":"l","child":"c"}));
    let total=|e:&mut Engine|e.query("total",Context::new("alice",[("p".into(),Value::Id("p".into()))].into())).unwrap().data;
    assert_eq!(total(&mut e),Value::Int(1));
    activate(&mut e,&old,2).unwrap();
    for table in ["parents","children","leaves"] {assert_eq!(e.store().count(table).unwrap(),0, "{table}");}
    assert_eq!(total(&mut e),Value::Int(0));
    assert!(e.snapshot("alice").unwrap().0.iter().all(|event| !["parents","children","leaves"].contains(&event.table.as_str())));
    activate(&mut e,wide,3).unwrap();
    for table in ["parents","children","leaves"] {assert_eq!(e.store().count(table).unwrap(),1, "{table}");}
    assert_eq!(total(&mut e),Value::Int(1));
    let status=e.store_mut().release_status(0,None,None).unwrap();
    assert_eq!(status["events"][1]["summary"]["narrowed_retained"],3);
    assert_eq!(status["events"][2]["summary"]["narrowed_restored"],3);
}

#[test]
fn too_short_old_writes_are_dormant_on_forward_and_restored_on_rollback() {
    let loose="table codes:\n  code: text 4..12\n  unique code\n  public\n  sync public\n";
    let tight=loose.replace("4..12","6..12");
    let mut e=engine(loose);
    seed(&mut e,"codes",serde_json::json!({"id":"short","code":"four"}));
    seed(&mut e,"codes",serde_json::json!({"id":"long","code":"longer"}));
    activate(&mut e,&tight,2).unwrap();
    assert_eq!(e.store().count("codes").unwrap(),1);
    // Primary identity and references cannot overwrite or acquire hidden rows.
    let result=e.seed([("codes".into(),wire::row_from_json(&e.schema().tables["codes"],&serde_json::json!({"id":"short","code":"newer"})).unwrap())]);
    assert!(matches!(result.unwrap_err().code().as_str(),"E_RULE"|"E_CONSTRAINT"));
    activate(&mut e,loose,1).unwrap();
    let rows=e.store().rows("codes").unwrap();
    assert_eq!(rows.len(),2);
    assert!(rows.iter().any(|r|r.field("code").unwrap()==&Value::String("four".into())));
    activate(&mut e,&tight,2).unwrap();
    let preview=e.store_mut().prune_dormant(false,None).unwrap();
    assert!(preview["items"].as_array().unwrap().iter().any(|i|i["key"]=="rows:codes"));
    e.store_mut().prune_dormant(true,None).unwrap();
    activate(&mut e,loose,1).unwrap();
    assert_eq!(e.store().count("codes").unwrap(),1);
}

#[test]
fn dormant_row_reference_never_recaptures_a_deleted_parent_lifetime() {
    let wide="table parents:\n  public\ntable children:\n  parent: parents\n  status: enum('live','new')\n  public\n";
    let old=wide.replace("enum('live','new')","enum('live')");
    let mut e=engine(wide);
    seed(&mut e,"parents",serde_json::json!({"id":"p"}));
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"p","status":"new"}));
    activate(&mut e,&old,2).unwrap();
    {let table=e.schema().tables["parents"].clone();let tx=e.store_mut().transaction().unwrap();let row=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&row).unwrap();tx.commit().unwrap();}
    seed(&mut e,"parents",serde_json::json!({"id":"p"}));
    activate(&mut e,wide,3).unwrap();
    assert_eq!(e.store().count("children").unwrap(),0);
    assert_eq!(e.store_mut().dormant_inventory(None,100).unwrap().iter().find(|i|i.key=="rows:children").unwrap().rows,1);
}

#[test]
fn narrowing_preserves_legally_dangling_keep_references_and_omitted_invalid_cells() {
    let wide="table parents:\n  public\ntable children:\n  parent: parents on delete keep\n  status: enum('live','new')\n  public\n";
    let old=wide.replace("enum('live','new')","enum('live')");
    let mut e=engine(wide);
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"already-gone","status":"new"}));
    activate(&mut e,&old,2).unwrap();activate(&mut e,wide,3).unwrap();
    assert_eq!(e.store().count("children").unwrap(),1);
    seed(&mut e,"parents",serde_json::json!({"id":"p"}));
    seed(&mut e,"children",serde_json::json!({"id":"other","parent":"p","status":"new"}));
    activate(&mut e,&old,2).unwrap();
    let table=e.schema().tables["parents"].clone();
    {let tx=e.store_mut().transaction().unwrap();let row=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&row).unwrap();tx.commit().unwrap();}
    let without_ref=wide.replace("  parent: parents on delete keep\n","");
    activate(&mut e,&without_ref,4).unwrap();
    assert_eq!(e.store().count("children").unwrap(),2,"omitted invalid reference must not hide compatible visible fields");
    assert!(e.store_mut().dormant_inventory(None,100).unwrap().iter().any(|i|i.key=="column:children.parent" && i.rows==2));
}

#[test]
fn combined_narrowing_and_lifetime_removal_never_resurrects_expired_children() {
    let wide="table parents:\n  public\ntable children:\n  parent: parents\n  immutable parent\n  until: time\n  expire at .until\n  status: enum('live','new')\n  read through .parent\n";
    let mut e=engine(wide);
    let parent=wire::row_from_json(&e.schema().tables["parents"],&serde_json::json!({"id":"p"})).unwrap();
    let child=wire::row_from_json(&e.schema().tables["children"],&serde_json::json!({"id":"c","parent":"p","until":50,"status":"new"})).unwrap();
    e.seed_at([("parents".into(),parent),("children".into(),child)],0).unwrap();
    let old=wide.replace("enum('live','new')","enum('live')").replace("  expire at .until\n","").replace("  read through .parent","  public");
    activate(&mut e,&old,2).unwrap();
    assert_eq!(e.store().count("children").unwrap(),0);
    assert!(e.store_mut().dormant_inventory(None,100).unwrap().iter().all(|i|i.key!="rows:children"));
    activate(&mut e,&old.replace("enum('live')","enum('live','new')"),3).unwrap();
    assert_eq!(e.store().count("children").unwrap(),0);
}

#[test]
fn partial_restoration_prunes_only_dormant_asset_homes() {
    let wide="table rows:\n  status: enum('live','new')\n  photo: image <=1000 ?\n  public\n";
    let hidden=wide.replace("enum('live','new')","enum('live')").replace("  photo: image <=1000 ?\n","");
    let mixed=wide.replace("enum('live','new')","enum('live')");
    let mut e=engine(wide);
    let bytes=b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let active=e.store_asset("alice",bytes,100).unwrap();
    let dormant=e.store_asset("alice",bytes,100).unwrap();
    for (id,status,asset) in [("a","live",&active),("b","new",&dormant)] {
        let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":id,"status":status,"photo":{"id":asset.id}})).unwrap();
        e.seed_at([("rows".into(),row)],101).unwrap();
    }
    activate(&mut e,&hidden,2).unwrap();
    activate(&mut e,&mixed,3).unwrap();
    assert!(e.asset_access("alice",&active.id,102).is_ok());
    let inventory=e.store_mut().dormant_inventory(None,100).unwrap();
    assert_eq!(inventory.iter().find(|i|i.key=="column:rows.photo").unwrap().asset_bytes,dormant.bytes);
    e.store_mut().prune_dormant(true,None).unwrap();
    assert!(e.asset_access("alice",&active.id,103).is_ok(),"prune cannot release the active row's restored asset");
    let released=|e:&Engine,id:&str|e.store().conn().query_row("SELECT released_at FROM _assets WHERE id=?1",[id],|r|r.get::<_,Option<i64>>(0)).unwrap();
    assert_eq!(released(&e,&active.id),None);
    assert!(released(&e,&dormant.id).is_some());
}

#[test]
fn release_store_2_keeps_deletion_evidence_before_its_next_upgrade() {
    let wide="table parents:\n  public\ntable children:\n  parent: parents on delete keep\n  public\n";
    let old=wide.replace("table children:\n  parent: parents on delete keep\n  public\n","");
    let mut e=engine(wide);
    seed(&mut e,"parents",serde_json::json!({"id":"p"}));
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"p"}));
    activate(&mut e,&old,2).unwrap();
    e.store().conn().execute_batch("DROP TABLE _dormant_narrow_rows; UPDATE _meta SET value='snapback4-release-store-2' WHERE key='version';").unwrap();
    let table=e.schema().tables["parents"].clone();
    {let tx=e.store_mut().transaction().unwrap();let row=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&row).unwrap();tx.commit().unwrap();}
    seed(&mut e,"parents",serde_json::json!({"id":"p"}));
    assert!(activate(&mut e,wide,3).unwrap_err().to_string().contains("lifetime"));
    assert_eq!(e.store().meta("version").unwrap().as_deref(),Some("snapback4-release-store-2"),"failed upgrade must keep the old marker");
}

#[test]
fn equal_schema_activation_closes_new_nominal_references_and_replaces_generation() {
    let wide="table parents:\n  status: enum('live','new')\n  public\ntable children:\n  parent: parents\n  public\n";
    let old=wide.replace("enum('live','new')","enum('live')");
    let mut e=engine(wide);
    seed(&mut e,"parents",serde_json::json!({"id":"p","status":"new"}));
    activate(&mut e,&old,2).unwrap();
    // Nominal references remain legal without an existence oracle.
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"p"}));
    assert_eq!(e.store().count("children").unwrap(),1);
    let generation=e.generation();
    activate(&mut e,&old,2).unwrap();
    assert_eq!(e.generation(),generation+1);
    assert_eq!(e.store().count("children").unwrap(),0);
    activate(&mut e,wide,3).unwrap();
    assert_eq!(e.store().count("children").unwrap(),1);
}

#[test]
fn restoration_into_a_narrower_table_or_column_retains_source_values_and_definition() {
    let wide="table rows:\n  status: enum('live','new') default 'live'\n  public\nquery version():\n  return 1\n";
    let narrow=wide.replace("enum('live','new')","enum('live')");
    for retired in ["query version():\n  return 1\n".to_string(),wide.replace("  status: enum('live','new') default 'live'\n","")] {
        let mut e=engine(wide);
        seed(&mut e,"rows",serde_json::json!({"id":"r","status":"new"}));
        activate(&mut e,&retired,2).unwrap();
        activate(&mut e,&narrow,3).unwrap();
        assert_eq!(e.store().count("rows").unwrap(),0);
        let status=e.store_mut().release_status(0,None,None).unwrap();let event=status["events"].as_array().unwrap().last().unwrap();
        let items=e.store_mut().release_status(0,None,event["id"].as_u64()).unwrap();
        let restored=items["items"].as_array().unwrap().iter().find(|i|i["key"]==if retired.contains("table rows") {"column:rows.status"} else {"table:rows"}).unwrap();
        assert_eq!(restored["restored_rows"],0);
        assert_ne!(restored["action"],"restored");
        // Whole-table reintroduction also restores its byId index definition.
        assert_eq!(event["summary"]["restored_items"],if retired.contains("table rows") {0} else {1});
        // Retiring the field again must preserve the original stored type/value.
        activate(&mut e,&retired,4).unwrap();
        activate(&mut e,wide,5).unwrap();
        assert_eq!(e.store().rows("rows").unwrap()[0].field("status").unwrap(),&Value::String("new".into()));
    }
}

#[test]
fn tentative_restoration_with_no_visibility_delta_keeps_generation_and_cursors() {
    let wide="table parents:\n  status: enum('live','new')\n  public\ntable children:\n  parent: parents\n  public\n";
    let old=wide.replace("enum('live','new')","enum('live')");
    let mut e=engine(wide);
    seed(&mut e,"parents",serde_json::json!({"id":"p","status":"new"}));
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"p"}));
    activate(&mut e,&old,2).unwrap();
    let generation=e.generation();
    activate(&mut e,&old,2).unwrap();
    assert_eq!(e.generation(),generation);
    assert_eq!(e.store().count("parents").unwrap(),0);
    assert_eq!(e.store().count("children").unwrap(),0);
}

#[test]
fn narrowing_restored_storage_keeps_deleted_parent_evidence_even_after_id_reuse() {
    let wide="table parents:\n  public\ntable children:\n  parent: parents on delete keep\n  status: enum('live','new')\n  public\n";
    let narrow=wide.replace("enum('live','new')","enum('live')");
    for retired in ["table parents:\n  public\n".to_string(),wide.replace("  parent: parents on delete keep\n","")] {
        let mut e=engine(wide);
        seed(&mut e,"parents",serde_json::json!({"id":"p"}));
        seed(&mut e,"children",serde_json::json!({"id":"c","parent":"p","status":"new"}));
        activate(&mut e,&retired,2).unwrap();
        let table=e.schema().tables["parents"].clone();
        {let tx=e.store_mut().transaction().unwrap();let row=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&row).unwrap();tx.commit().unwrap();}
        seed(&mut e,"parents",serde_json::json!({"id":"p"}));
        activate(&mut e,&narrow,3).unwrap();
        assert_eq!(e.store().count("children").unwrap(),0);
        let invalid:i64=e.store().conn().query_row("SELECT invalid FROM _dormant_refs WHERE id='c' AND column_name='parent'",[],|r|r.get(0)).unwrap();
        assert_eq!(invalid,1,"moving retained data into narrowed dormancy must not recapture the reused parent");
        activate(&mut e,wide,4).unwrap();
        assert_eq!(e.store().count("children").unwrap(),0);
    }
}

#[test]
fn audit_keeps_before_after_and_partial_restoration_counts() {
    let wide="table rows:\n  status: enum('live','new')\n  extra: int default 7\n  public\n";
    let retired=wide.replace("  extra: int default 7\n","");
    let mixed=wide.replace("enum('live','new')","enum('live')");
    let mut e=engine(wide);
    seed(&mut e,"rows",serde_json::json!({"id":"a","status":"live","extra":42}));
    seed(&mut e,"rows",serde_json::json!({"id":"b","status":"new","extra":99}));
    activate(&mut e,&retired,2).unwrap();activate(&mut e,&mixed,3).unwrap();
    let status=e.store_mut().release_status(0,None,None).unwrap();
    let event=status["events"].as_array().unwrap().last().unwrap();
    assert!(event["summary"]["restored_items"].as_u64().unwrap()>0);
    let items=e.store_mut().release_status(0,None,event["id"].as_u64()).unwrap();
    let item=items["items"].as_array().unwrap().iter().find(|i|i["key"]=="column:rows.extra").unwrap();
    assert_eq!(item["before_rows"],2);assert_eq!(item["after_rows"],1);assert_eq!(item["restored_rows"],1);
    assert_eq!(item["action"],"partially restored");
}

#[test]
fn expiry_of_an_active_row_does_not_audit_its_dormant_cells_as_restored() {
    let wide="table parents:\n  public\ntable rows:\n  parent: parents\n  immutable parent\n  until: time\n  expire at .until\n  extra: int default 7\n  read through .parent\n";
    for reintroduce in [false,true] {
    let mut e=engine(wide);
    let parent=wire::row_from_json(&e.schema().tables["parents"],&serde_json::json!({"id":"p"})).unwrap();
    let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"r","parent":"p","until":50,"extra":42})).unwrap();
    e.seed_at([("parents".into(),parent),("rows".into(),row)],0).unwrap();
    let retired=wide.replace("  extra: int default 7\n","");
    // First activation keeps the same lifetime, so the unswept expired image and its cell remain stored.
    activate(&mut e,&retired,2).unwrap();
    let changed=retired.replace("  read through .parent","  public").replace("  expire at .until\n","");
    let changed=if reintroduce {changed.replace("  public", "  extra: int default 7\n  public")} else {changed};
    activate(&mut e,&changed,3).unwrap();
    let status=e.store_mut().release_status(0,None,None).unwrap();let event=status["events"].as_array().unwrap().last().unwrap();
    let items=e.store_mut().release_status(0,None,event["id"].as_u64()).unwrap();
    let item=items["items"].as_array().unwrap().iter().find(|i|i["key"]=="column:rows.extra").unwrap();
    assert_eq!(item["before_rows"],1);assert_eq!(item["after_rows"],0);assert_eq!(item["restored_rows"],0);
    assert_ne!(item["action"],"partially restored");
    assert_ne!(item["action"],"restored");
    assert_eq!(event["summary"]["restored_items"],0);
    }
}

#[test]
fn late_readthrough_retirement_is_not_a_narrowed_restoration_in_audit() {
    let wide="table parents:\n  public\ntable rows:\n  parent: parents\n  immutable parent\n  until: time default 50\n  expire at .until\n  status: enum('live','new')\n  extra: int default 7\n  read through .parent\n";
    let mut e=engine(wide);
    let parent=wire::row_from_json(&e.schema().tables["parents"],&serde_json::json!({"id":"p"})).unwrap();
    let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"r","parent":"p","until":50,"status":"new","extra":42})).unwrap();
    e.seed_at([("parents".into(),parent),("rows".into(),row)],0).unwrap();
    let narrow=wide.replace("enum('live','new')","enum('live')").replace("  extra: int default 7\n","");
    activate(&mut e,&narrow,2).unwrap();
    assert_eq!(e.store().count("rows").unwrap(),0);
    activate(&mut e,&wide.replace("default 50","default 60"),3).unwrap();
    assert_eq!(e.store().count("rows").unwrap(),0);
    let status=e.store_mut().release_status(0,None,None).unwrap();let event=status["events"].as_array().unwrap().last().unwrap();
    assert_eq!(event["summary"]["narrowed_restored"],0);
    assert_eq!(event["summary"]["restored_items"],0);
    let items=e.store_mut().release_status(0,None,event["id"].as_u64()).unwrap();
    for key in ["rows:rows","column:rows.extra"] {
        let item=items["items"].as_array().unwrap().iter().find(|i|i["key"]==key).unwrap();
        assert_eq!(item["restored_rows"],0);assert_eq!(item["action"],"removed without restoration");
    }
}

#[test]
fn initially_dangling_keep_reference_restores_after_table_then_type_dormancy() {
    let wide="table parents:\n  public\ntable children:\n  parent: parents on delete keep\n  status: enum('live','new')\n  public\n";
    let mut e=engine(wide);
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"never-existed","status":"new"}));
    activate(&mut e,"table parents:\n  public\n",2).unwrap();
    activate(&mut e,&wide.replace("enum('live','new')","enum('live')"),3).unwrap();
    activate(&mut e,wide,4).unwrap();
    assert_eq!(e.store().count("children").unwrap(),1);
    assert_eq!(e.store().rows("children").unwrap()[0].field("parent").unwrap(),&Value::Id("never-existed".into()));
}

#[test]
fn removing_readthrough_cannot_revive_an_expired_narrowed_source_lifetime() {
    let wide="table parents:\n  public\ntable rows:\n  parent: parents\n  immutable parent\n  until: time default 50\n  expire at .until\n  status: enum('live','new')\n  read through .parent\n";
    let mut e=engine(wide);
    let parent=wire::row_from_json(&e.schema().tables["parents"],&serde_json::json!({"id":"p"})).unwrap();
    let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"r","parent":"p","until":50,"status":"new"})).unwrap();
    e.seed_at([("parents".into(),parent),("rows".into(),row)],0).unwrap();
    activate(&mut e,&wide.replace("enum('live','new')","enum('live')"),2).unwrap();
    activate(&mut e,&wide.replace("  read through .parent","  public").replace("  expire at .until\n",""),3).unwrap();
    assert_eq!(e.store().count("rows").unwrap(),0);
    assert_eq!(e.store().conn().query_row("SELECT COUNT(*) FROM _dormant_narrow_rows",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    let status=e.store_mut().release_status(0,None,None).unwrap();let event=status["events"].as_array().unwrap().last().unwrap();
    assert_eq!(event["summary"]["narrowed_restored"],0);
}

#[test]
fn true_format_two_store_allows_deletion_before_its_first_upgrade() {
    let mut e=engine(V1);
    seed(&mut e,"rows",serde_json::json!({"id":"gone","n":1,"status":"active"}));
    e.store().conn().execute_batch("UPDATE _meta SET value='snapback4-release-store-2' WHERE key='version'; DROP TABLE _dormant_narrow_rows;").unwrap();
    mutate(&mut e,"remove","legacy-delete");
    assert_eq!(e.store().count("rows").unwrap(),0);
    assert_eq!(e.store().meta("version").unwrap().as_deref(),Some("snapback4-release-store-2"));
    activate(&mut e,V1,1).unwrap();
    assert_eq!(e.store().meta("version").unwrap().as_deref(),Some(dormant::VERSION));
}

#[test]
fn direct_expiry_removal_cannot_revive_a_narrowed_source_lifetime() {
    let wide="table rows:\n  until: time default 50\n  expire at .until\n  status: enum('live','new')\n  public\n";
    let mut e=engine(wide);
    let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"r","until":50,"status":"new"})).unwrap();
    e.seed_at([("rows".into(),row)],0).unwrap();
    activate(&mut e,&wide.replace("enum('live','new')","enum('live')"),2).unwrap();
    activate(&mut e,&wide.replace("  expire at .until\n",""),3).unwrap();
    assert_eq!(e.store().count("rows").unwrap(),0);
    assert_eq!(e.store().conn().query_row("SELECT COUNT(*) FROM _dormant_narrow_rows",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}

#[test]
fn whole_table_transfer_preserves_full_source_lifetime_until_classification() {
    let wide="table parents:\n  public\ntable rows:\n  parent: parents\n  immutable parent\n  until: time default 50\n  expire at .until\n  status: enum('live','new')\n  read through .parent\n";
    for until in [50,crate::now_ms()+3_600_000] {
        let mut e=engine(wide);
        let parent=wire::row_from_json(&e.schema().tables["parents"],&serde_json::json!({"id":"p"})).unwrap();
        let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"r","parent":"p","until":until,"status":"new"})).unwrap();
        e.seed_at([("parents".into(),parent),("rows".into(),row)],0).unwrap();
        activate(&mut e,"table parents:\n  public\n",2).unwrap();
        let narrow=wide.replace("enum('live','new')","enum('live')").replace("  until: time default 50\n","").replace("  expire at .until\n","").replace("  read through .parent","  public");
        activate(&mut e,&narrow,3).unwrap();
        if until>50 {
            let data:String=e.store().conn().query_row("SELECT data FROM _dormant_narrow_rows WHERE id='r'",[],|r|r.get(0)).unwrap();
            let image:Value=serde_json::from_str(&data).unwrap();
            assert_eq!(image.field("until").unwrap(),&Value::Int(until));
            assert_eq!(image.field(crate::schema::through::DEADLINE).unwrap(),&Value::Int(until));
        }
        activate(&mut e,wide,4).unwrap();
        assert_eq!(e.store().count("rows").unwrap(),if until==50 {0} else {1});
        if until>50 {assert_eq!(e.store().rows("rows").unwrap()[0].field("until").unwrap(),&Value::Int(until));}
    }
}

#[test]
fn asset_byte_narrowing_hides_and_restores_scalar_optional_and_list_rows() {
    let bytes=b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    for kind in ["image <=1000","image <=1000 ?","[image <=1000] <=4","[image <=1000] <=4 ?"] {
        let wide=format!("table rows:\n  status: enum('live','new')\n  photo: {kind}\n  public\n");
        let mut e=engine(&wide);let asset=e.store_asset("alice",bytes,100).unwrap();
        let handle=serde_json::json!({"id":asset.id});
        let value=if kind.starts_with('[') {serde_json::json!([handle])} else {handle};
        let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"r","status":"new","photo":value})).unwrap();
        e.seed_at([("rows".into(),row)],101).unwrap();
        let control=kind.ends_with('?') || kind.starts_with('[');
        if control {
            let value=if kind.ends_with('?') {serde_json::Value::Null} else {serde_json::json!([])};
            let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"control","status":"live","photo":value})).unwrap();
            e.seed_at([("rows".into(),row)],101).unwrap();
        }
        let visible=usize::from(control) as u64;
        assert!(e.asset_access("alice",&asset.id,102).is_ok());
        let narrow=wide.replace("<=1000","<=10");activate(&mut e,&narrow,2).unwrap();
        assert_eq!(e.store().count("rows").unwrap(),visible);
        assert_eq!(e.asset_access("alice",&asset.id,103).unwrap_err().code(),"E_ASSET_UNKNOWN");
        assert_eq!(e.store().asset(&asset.id).unwrap().unwrap().released_at,None);
        assert_eq!(e.sweep_assets(4_000_000).unwrap(),0,"claimed dormant assets outlive the unclaimed TTL");
        activate(&mut e,&wide,3).unwrap();assert_eq!(e.store().count("rows").unwrap(),visible+1);
        // An already dormant image must remain hidden when another incompatible type is selected.
        activate(&mut e,&wide.replace("enum('live','new')","enum('live')"),4).unwrap();
        activate(&mut e,&narrow,5).unwrap();assert_eq!(e.store().count("rows").unwrap(),visible);
        activate(&mut e,&wide,6).unwrap();assert!(e.asset_access("alice",&asset.id,104).is_ok());
    }
}

#[test]
fn file_allowlist_and_kind_narrowing_preserve_retained_asset_facts() {
    let wide="table rows:\n  document: file <=1000 ('application/pdf','text/plain') ?\n  public\n";
    let mut e=engine(wide);let asset=e.store_file("alice",b"a plain document",Some("text/plain"),"note.txt",100).unwrap();
    let row=wire::row_from_json(&e.schema().tables["rows"],&serde_json::json!({"id":"r","document":{"id":asset.id}})).unwrap();
    e.seed_at([("rows".into(),row)],101).unwrap();
    for (n,narrow) in [wide.replace("('application/pdf','text/plain')","('application/pdf')"),wide.replace("file <=1000 ('application/pdf','text/plain')","image <=1000")].iter().enumerate() {
        activate(&mut e,narrow,2+(n as u64)*2).unwrap();assert_eq!(e.store().count("rows").unwrap(),0);
        assert_eq!(e.store().asset(&asset.id).unwrap().unwrap().released_at,None);
        activate(&mut e,wide,3+(n as u64)*2).unwrap();
        assert_eq!(e.store().count("rows").unwrap(),1);assert!(e.asset_access("alice",&asset.id,102).is_ok());
        assert_eq!(e.store().rows("rows").unwrap()[0].field("document").unwrap().field("name").unwrap(),&Value::String("note.txt".into()));
    }
}

#[test]
fn restoring_null_exempt_caps_matches_runtime_and_successor_assessment() {
    for action in ["set null","keep"] {
        let wide=format!("table parents:\n  public\ntable children:\n  parent: parents ? on delete {action}\n  status: enum('live','new')\n  cap 2 by parent\n  public\n");
        let tight=wide.replace("cap 2","cap 1");
        let mut e=engine(&wide);
        for id in ["a","b"] {seed(&mut e,"children",serde_json::json!({"id":id,"parent":null,"status":"new"}));}
        let (schema,_)=compile(&tight);
        let steps=e.store_mut().successor(&schema).unwrap();
        let cap=steps.iter().find(|s|s.path=="tables.children.constraints").unwrap();
        assert_eq!(cap.change,if action=="set null" {crate::successor::Change::Additive} else {crate::successor::Change::Narrowing});
        activate(&mut e,&wide.replace("enum('live','new')","enum('live')"),2).unwrap();
        if action=="set null" {
            activate(&mut e,&tight,3).unwrap();assert_eq!(e.store().count("children").unwrap(),2);
        } else {
            assert_eq!(activate(&mut e,&tight,3).unwrap_err().code(),"E_ADOPT");
            assert_eq!(e.store().count("children").unwrap(),0);activate(&mut e,&wide,4).unwrap();
            assert_eq!(e.store().count("children").unwrap(),2);
        }
    }
}

#[test]
fn historical_through_captures_restore_after_public_rule_widening() {
    let full="table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- allow\ntable children:\n  parent: parents\n  body: text <=100\n  immutable parent\n  read through .parent\n";
    let broad=full.replace("  read through .parent","  read <- allow");
    let mut e=engine(full);
    seed(&mut e,"parents",serde_json::json!({"id":"p","owner":"alice"}));
    seed(&mut e,"children",serde_json::json!({"id":"c","parent":"p","body":"kept"}));
    let original=e.store().rows("children").unwrap();
    activate(&mut e,&broad,2).unwrap();
    activate(&mut e,full,1).unwrap();
    assert_eq!(e.store().rows("children").unwrap(),original);
    activate(&mut e,&broad,2).unwrap();
    seed(&mut e,"children",serde_json::json!({"id":"new","parent":"p","body":"new"}));
    let error=activate(&mut e,full,1).unwrap_err().to_string();
    assert!(error.contains("E_READ_THROUGH_ADOPT") && error.contains("new"),"{error}");
}

#[test]
fn narr_counts_column_values_not_population_and_word_entries_not_rows() {
    let source = "table docs:\n  title: text <=100\n  status: enum('draft') default 'draft'\n  public\n  insert <- allow\n  update <- allow\n  online only\n";
    let wide = source.replace("enum('draft')", "enum('draft', 'archived')").replace("  title: text", "  by search: words(title), id\n  title: text");
    let mut e = engine(&wide);
    for (id, title, status) in [("a", "red blue red", "archived"), ("b", "green", "draft"), ("c", "", "draft")] {
        seed(&mut e, "docs", serde_json::json!({"id":id,"title":title,"status":status}));
    }
    let (target, _) = compile(source);
    let (count, values) = e.store().rollback_incompatible_values(e.schema(), &target, "docs", "status").unwrap();
    assert_eq!(count, 1); assert_eq!(values, ["'archived'"]);
    activate(&mut e, source, 2).unwrap();
    let items = e.store_mut().dormant_inventory(None, usize::MAX).unwrap();
    let index = items.iter().find(|i| i.kind == "index" && i.path == "docs.search").unwrap();
    assert_eq!(index.rows, 3, "two distinct tokens plus one token; the narrowed image also contributes");
    assert_eq!(index.sample_ids, ["a", "b"]);
    assert_eq!(index.unit(), "entries");
    assert!(crate::store::adoption_report::AdoptionReport::dormant(&items).contains("1 row, 0 cells, 3 index entries dormant"));
}

#[test]
fn narr_text_constraints_and_literal_default_counts_share_activation_predicate() {
    let source = "table docs:\n  code: text <=10 default 'x'\n  public\n  online only\n";
    let mut e = engine(source);
    seed(&mut e, "docs", serde_json::json!({"id":"a","code":"long"}));
    seed(&mut e, "docs", serde_json::json!({"id":"b","code":"x"}));
    let (target, _) = compile(&source.replace("text <=10", "text 2..10").replace("default 'x'", "default 'xx'"));
    let (count, _) = e.store().rollback_incompatible_values(e.schema(), &target, "docs", "code").unwrap();
    assert_eq!(count, 1);
    let (same, _) = compile(source);
    assert_eq!(e.store().rollback_incompatible_values(e.schema(), &same, "docs", "code").unwrap().0, 0);
}

#[test]
fn narr_separate_cells_remain_counted_under_a_dormant_table() {
    let mut e = engine(&v2());
    for id in ["a", "b", "c"] { seed(&mut e, "rows", serde_json::json!({"id":id,"n":1,"status":"active","extra":42})); }
    activate(&mut e, V1, 2).unwrap();
    let before = e.store_mut().dormant_inventory(None, usize::MAX).unwrap();
    assert_eq!(before.iter().filter(|i|i.kind == "column").map(|i|i.rows).sum::<u64>(), 3);
    activate(&mut e, "query value():\n  return 1\n", 3).unwrap();
    let after = e.store_mut().dormant_inventory(None, usize::MAX).unwrap();
    assert_eq!(after.iter().filter(|i|i.kind == "column").map(|i|i.rows).sum::<u64>(), 3);
    assert!(crate::store::adoption_report::AdoptionReport::dormant(&after).contains("3 rows, 3 cells"));
    let actual:i64 = e.store().conn().query_row("SELECT COALESCE(SUM(octet_length(id)+octet_length(data)),0) FROM _dormant_rows", [], |r|r.get(0)).unwrap();
    assert_eq!(after.iter().filter(|i|i.kind == "table").map(|i|i.bytes).sum::<u64>(), actual as u64);
    activate(&mut e, &v2(), 1).unwrap();
    assert_eq!(e.store().count("rows").unwrap(), 3);
    assert!(e.store_mut().dormant_inventory(None, usize::MAX).unwrap().is_empty());
}
