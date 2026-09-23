use super::*;
use crate::{Context, Ceilings, Value, Store, ir::{Expr, Read, KeyProvenance}, meter::{Meter, Cut},
    schema::{Schema, Table, ColumnType, Index, Rules, RuleExpr, timeline::{Timeline, OWNED_SUFFIXES}}, value::object};

pub(in crate::engine) fn schema() -> Schema {
    let t = Timeline { name: "feed".into(), authors: ["profiles", "principal"].map(String::from),
        posts: ["posts", "authorId", "at", "removed"].map(String::from),
        reposts: ["reposts", "actorId", "postId", "at"].map(String::from),
        edges: ["follows", "followerId", "followedId"].map(String::from), followed_index: "byFollowed".into(),
        purge: "feedPurgeRemoved".into(), owned: OWNED_SUFFIXES.iter().map(|s| format!("feed{s}")).collect(),
        mapped: ["profiles", "posts", "reposts", "follows"].map(String::from).into() };
    let table = Table { residency: Default::default(), defaults: Default::default(),
        columns: [("id".into(), ColumnType::Id), ("value".into(), ColumnType::Int)].into(),
        indexes: [("byId".into(), Index::of(&["id"], true))].into(),
        rules: Rules { read: RuleExpr::Allow, ..Rules::deny() }, constraints: vec![], leave: Default::default(), sync: None, expire: None };
    Schema { tables: t.owned.iter().chain(&t.mapped).map(|name| (name.clone(), table.clone())).collect(), timelines: vec![t], ..Schema::default() }
}
fn row(id: &str) -> Value { object([("id", Value::Id(id.into())), ("value", Value::Int(1))]) }

#[test]
fn upsert_needs_insert_and_update_grants_on_both_addressing_paths() {
    let schema = schema(); let mut store = Store::memory().unwrap(); store.install(&schema).unwrap();
    let tx = store.transaction().unwrap();
    tx.put("feedFeed", &schema.tables["feedFeed"], &row("existing"), None).unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::system().at(1), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    let mut guard = runner.timeline_scope(Authority::UpdateOnly("feed".into()));
    assert!(guard.timeline_may_write("feedFeed", Effect::Update));
    assert!(!guard.timeline_may_write("feedFeed", Effect::Insert));
    for key in ["existing", "missing"] {
        let id = Value::Id(key.into());
        assert_eq!(guard.upsert("feedFeed", &id, row(key)).unwrap_err().code(), "E_TIMELINE_OWNED");
        let target = Read { site: "test".into(), table: "feedFeed".into(), index: "byId".into(), key: vec![Expr::Literal(id)], provenance: KeyProvenance::Const };
        assert_eq!(guard.write_target(&target, &Expr::Literal(object([("value", Value::Int(2))])), true, None, false).unwrap_err().code(), "E_TIMELINE_OWNED");
    }
    assert_eq!(guard.rows_written, 0);
    assert_eq!(tx.get("feedFeed", "existing").unwrap(), Some(row("existing")));
    assert!(tx.get("feedFeed", "missing").unwrap().is_none());
}

#[test]
fn purge_gates_actual_writes_charges_deletes_and_never_refuses_reads() {
    let schema = schema(); let mut store = Store::memory().unwrap(); store.install(&schema).unwrap();
    let tx = store.transaction().unwrap();
    for n in 0..1002 { tx.put("feedFeed", &schema.tables["feedFeed"], &row(&format!("copy-{n}")), None).unwrap(); }
    for n in 0..2 { tx.put("feedRemovedEvents", &schema.tables["feedRemovedEvents"], &row(&format!("removed-{n}")), None).unwrap(); }
    let mut runner = Runner::new(&tx, &schema, Context::system().at(1), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    {
        let mut guard = runner.timeline_scope(Authority::purge(&schema, "feedPurgeRemoved"));
        for table in ["feedFeed", "feedRemovedEvents", "profiles"] {
            guard.refuse_timeline_purge_write(table, Effect::Read).unwrap();
            assert!(guard.check_rule(table, Effect::Read, None, &row("copy-0")).unwrap());
            assert_eq!(guard.insert(table, row("new")).unwrap_err().code(), "E_TIMELINE_OWNED");
            assert_eq!(guard.insert_if_absent(table, row("copy-0")).unwrap_err().code(), "E_TIMELINE_OWNED");
            assert_eq!(guard.update(table, &Value::Id("copy-0".into()), object([("value", Value::Int(2))])).unwrap_err().code(), "E_TIMELINE_OWNED");
            assert_eq!(guard.upsert(table, &Value::Id("copy-0".into()), row("copy-0")).unwrap_err().code(), "E_TIMELINE_OWNED");
        }
        for n in 0..1001 { guard.delete("feedFeed", &format!("copy-{n}")).unwrap(); }
        guard.delete("feedRemovedEvents", "removed-0").unwrap();
        let meter = guard.meter.used.clone();
        for key in ["copy-1001", "missing"] { assert_eq!(guard.delete("feedFeed", key).unwrap_err().code(), "E_TIMELINE_OWNED"); }
        assert_eq!(guard.delete("feedRemovedEvents", "removed-1").unwrap_err().code(), "E_TIMELINE_OWNED");
        assert_eq!(guard.meter.used, meter);
        assert_eq!(guard.rows_written, 1002);
        assert!(tx.get("feedFeed", "copy-1001").unwrap().is_some());
    }
    assert!(runner.timeline_authority.is_none());
    assert_eq!(runner.delete("feedFeed", "copy-1001").unwrap_err().code(), "E_TIMELINE_OWNED");
}
