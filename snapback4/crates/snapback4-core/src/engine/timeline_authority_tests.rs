use super::*;
use crate::{Context, Ceilings, Value, Store, ir::{Expr, Read, KeyProvenance}, meter::{Meter, Cut},
    schema::{Schema, Table, ColumnType, Index, Rules, RuleExpr, timeline::{Timeline, OWNED_SUFFIXES}}, value::object};

pub(in crate::engine) fn schema() -> Schema {
    let t = Timeline { name: "feed".into(), version: 2, filter: None, authors: ["profiles", "principal"].map(String::from),
        posts: ["posts", "authorId", "at", "removed"].map(String::from),
        reposts: ["reposts", "actorId", "postId", "at"].map(String::from),
        edges: ["follows", "followerId", "followedId"].map(String::from), author_cap: 1000, edge_cap: 100000, followed_index: "byFollowed".into(),
        purge: "feedPurgeRemoved".into(), owned: OWNED_SUFFIXES.iter().map(|s| format!("feed{s}")).collect(),
        mapped: ["posts", "reposts", "follows"].map(String::from).into() };
    let table = Table { sequences: Default::default(), written_by: Default::default(), update_transition: false, recorded: Default::default(), maintained: Default::default(), residency: Default::default(), defaults: Default::default(),
        columns: [("id".into(), ColumnType::Id), ("value".into(), ColumnType::Int)].into(),
        indexes: [("byId".into(), Index::of(&["id"], true))].into(),
        rules: Rules { read: RuleExpr::Allow, ..Rules::deny() }, constraints: vec![], leave: Default::default(), sync: None, expire: None };
    Schema { tables: t.owned.iter().chain(&t.mapped).map(|name| (name.clone(), table.clone())).collect(), timelines: vec![t], ..Schema::default() }
}
fn row(id: &str) -> Value { object([("id", Value::Id(id.into())), ("value", Value::Int(1))]) }

fn column_schema(parent: &str, source: &str) -> (Schema, crate::schema::Maintain) {
    use crate::schema::{columns::{ColumnOwner, GROUP}, Maintain, MaintainKind, Residency, public_table};
    let mut schema = schema();
    let owner = ColumnOwner { table: parent.into(), column: "value".into() };
    let m = Maintain { target: owner.target(), source: source.into(), by: vec!["parentId".into()],
        kind: MaintainKind::Count, private: Some(owner), filter: None, computed: Default::default(),
        residency: Residency { online_only: true, ..Default::default() }, readable: None };
    let mut parent_table = schema.tables["feedFeed"].clone();
    parent_table.maintained.insert("value".into(), m.derivation_identity());
    schema.tables.insert(parent.into(), parent_table);
    let reference = ColumnType::Ref { table: parent.into() };
    schema.tables.insert(source.into(), public_table(
        [("id".into(), ColumnType::Id), ("parentId".into(), reference.clone())].into(),
        [("byId".into(), Index::of(&["id"], true))].into()));
    let mut private = public_table(
        [("id".into(), ColumnType::Id), (GROUP.into(), reference), ("value".into(), ColumnType::Int)].into(),
        [("byId".into(), Index::of(&["id"], true)), ("byGroup".into(), Index::of(&[GROUP], true))].into());
    private.rules = Rules::deny();
    private.residency.online_only = true;
    schema.tables.insert(m.target.clone(), private);
    schema.maintains.push(m.clone());
    (schema, m)
}

#[test]
fn raw_columns_reject_timeline_owned_parents_and_sources_and_admit_mapped_ones() {
    let timeline = schema().timelines.remove(0);
    for table in timeline.owned.iter().chain(&timeline.mapped) {
        for (role, parent, source) in [("parent", table.as_str(), "ordinarySources"), ("source", "ordinaryParents", table.as_str())] {
            let (raw, m) = column_schema(parent, source);
            let mut ordinary = raw.clone();
            ordinary.timelines.clear();
            assert!(crate::schema::validate(&ordinary).is_empty(), "ordinary control: {:?}", crate::schema::validate(&ordinary));
            if timeline.maps(table) {
                assert!(crate::schema::validate(&raw).is_empty(), "mapped {role} {table}: {:?}", crate::schema::validate(&raw));
                crate::Engine::memory(raw, []).unwrap_or_else(|e| panic!("mapped {role} {table}: {e}"));
                continue;
            }
            let issues = crate::schema::validate(&raw);
            assert!(issues.iter().any(|i| i.message.contains(&format!("timeline-owned {role} {table}"))), "{issues:?}");
            let error = crate::Engine::memory(raw, []).err().expect("timeline column admitted");
            assert_eq!(error.code(), "E_MAINTAINED_COLUMN", "{error}");
            assert!(error.to_string().contains("use a table it maps"));
            assert!(!error.to_string().contains(&m.target));
        }
    }
}

#[test]
fn column_mirror_requires_timeline_authority_even_when_validation_is_bypassed() {
    let (mut schema, m) = column_schema("feedFeed", "ordinarySources");
    schema.prepare_contribution_indexes();
    let mut store = Store::memory().unwrap();
    store.install(&schema).unwrap(); // Hand-built state, deliberately bypassing Engine admission.
    let tx = store.transaction().unwrap();
    tx.put("feedFeed", &schema.tables["feedFeed"], &row("existing"), None).unwrap();
    tx.commit().unwrap();
    let tx = store.transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::system().at(1), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    for key in ["existing", "missing"] {
        let meter = runner.meter.used.clone();
        assert_eq!(runner.mirror_column(&m, &[Value::Id(key.into())], 2).unwrap_err().code(), "E_TIMELINE_OWNED");
        assert_eq!(runner.meter.used, meter, "refuse before looking up a parent");
    }
    // The ordinary source write also reaches the guarded mirror via apply_aggregate.
    let source = object([("id", Value::Id("s".into())), ("parentId", Value::Id("existing".into()))]);
    let source = runner.expr_input(&crate::ir::Expr::Literal(source)).unwrap();
    assert_eq!(runner.insert("ordinarySources", source).unwrap_err().code(), "E_TIMELINE_OWNED");
    assert_eq!(tx.get("feedFeed", "existing").unwrap(), Some(row("existing")));
    drop(runner);
    tx.rollback().unwrap();
    assert!(store.rows("ordinarySources").unwrap().is_empty());
    assert!(store.rows(&m.target).unwrap().is_empty());
    let tx = store.transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::system().at(1), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    runner.timeline_scope(Authority::Transition("feed".into())).mirror_column(&m, &[Value::Id("existing".into())], 2).unwrap();
    assert_eq!(tx.get("feedFeed", "existing").unwrap().unwrap().field("value").unwrap(), &Value::Int(2));
}

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
        let input = guard.expr_input(&crate::ir::Expr::Literal(row(key))).unwrap();
        assert_eq!(guard.upsert("feedFeed", &id, input).unwrap_err().code(), "E_TIMELINE_OWNED");
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
            let input = guard.expr_input(&crate::ir::Expr::Literal(row("new"))).unwrap();
            assert_eq!(guard.insert(table, input).unwrap_err().code(), "E_TIMELINE_OWNED");
            let input = guard.expr_input(&crate::ir::Expr::Literal(row("copy-0"))).unwrap();
            assert_eq!(guard.insert_if_absent(table, input).unwrap_err().code(), "E_TIMELINE_OWNED");
            let input = guard.expr_input(&crate::ir::Expr::Literal(object([("value", Value::Int(2))]))).unwrap();
            assert_eq!(guard.update(table, &Value::Id("copy-0".into()), input).unwrap_err().code(), "E_TIMELINE_OWNED");
            let input = guard.expr_input(&crate::ir::Expr::Literal(row("copy-0"))).unwrap();
            assert_eq!(guard.upsert(table, &Value::Id("copy-0".into()), input).unwrap_err().code(), "E_TIMELINE_OWNED");
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
