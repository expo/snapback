//! One writer/pruning contract through both enum adapters.
// @ref LLP 3000.009.001.000#9.1 — shared inputs, ordered bounded reads and real snapshots.
use crate::{Engine, Schema, Value, rows::Rows,
    revocation::{self, ChangeEvidence}, store_port::{AnyStore, AnyTx}, value::{object, canonical_json}};

const SOURCE: &str = "table notes:\n  body: text\n  owner: principal\n  read <- .owner = viewer\n  insert <- allow\n  update <- allow\n  sync to .owner\nmutation put(key: id, body: text):\n  upsert notes[key] {body, owner: viewer}\n  return body\nmutation refused(key: id):\n  upsert notes[key] {body: 'refused', owner: viewer}\n  require false else NO\n";
pub(crate) fn engine(pg: bool) -> Engine {
    let store = if pg {
        #[cfg(feature = "postgres")]
        { AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &format!("sb4_ce_{:x}", crate::ids::seed())).unwrap() }
        #[cfg(not(feature = "postgres"))]
        { unreachable!() }
    } else { AnyStore::memory().unwrap() };
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = bound.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    Engine::new(store, schema, programs).unwrap()
}
fn row(owner: &str, body: &str) -> Value {
    object([("id", Value::Id("id".into())), ("owner", Value::Id(owner.into())), ("body", Value::String(body.into()))])
}
fn complete(tx: &AnyTx<'_>, seq: u64, touched: &[String]) {
    tx.record_commit(seq, 100, "test", "alice", "mutation", touched, touched.len() as u64).unwrap();
    tx.release("member").unwrap();
}
fn begin(tx: &AnyTx<'_>) -> u64 {
    tx.begin_member_evidence(); tx.savepoint("member").unwrap(); tx.next_seq().unwrap()
}
fn writer(pg: bool) {
    let mut e = engine(pg); let schema = e.schema().clone();
    let table = &schema.tables["notes"];
    let tx = e.store_mut().transaction().unwrap();
    let mut old = None;
    // NUL is JSON-escaped, never bound as Postgres TEXT. Net images, changed
    // rule columns, deletions and uncovered writes match SQLite exactly.
    for (seq, new) in [(1, Some(row("alice", "a\0b"))), (2, Some(row("alice", "after"))), (3, Some(row("bob", "after"))), (4, None)] {
        assert_eq!(begin(&tx), seq);
        if let Some(new) = &new { tx.put("notes", table, new, old.as_ref()).unwrap(); }
        else { tx.delete("notes", table, old.as_ref().unwrap()).unwrap(); }
        let expected = canonical_json(&tx.change_footprint());
        complete(&tx, seq, &["notes".into()]);
        let mut actual = Vec::new();
        tx.change_evidence(seq-1, seq, |r| { actual.push(r.footprint.unwrap()); Some(()) }).unwrap();
        assert_eq!(actual, [expected]);
        assert_eq!(revocation::preserved_between(&tx, &schema, seq-1, seq), Some(if seq <= 2 { vec!["notes".into()] } else { vec![] }));
        old = new;
    }
    assert_eq!(begin(&tx), 5);
    complete(&tx, 5, &["notes".into()]);
    assert!(revocation::preserved_between(&tx, &schema, 4, 5).is_none(), "uncovered writes widen");
    tx.commit().unwrap();
    assert_eq!(e.store().preserved_between(&schema, 0, 2), Some(vec!["notes".into()]));
    assert!(e.store().preserved_between(&schema, 5, 6).is_none(), "missing commit cannot certify empty");
    let tx = e.store_mut().transaction().unwrap();
    let seq = begin(&tx);
    tx.put("notes", table, &row("alice", "rollback"), None).unwrap();
    complete(&tx, seq, &["notes".into()]);
    tx.rollback().unwrap();
    assert!(e.store().footprint_between(5, 6).is_none(), "physical rollback removes evidence");
    let refused = e.mutate("refused", Some("refused-id"), crate::engine::Context::new("alice", std::collections::BTreeMap::from([("key".into(), Value::Id("refused".into()))]))).unwrap();
    assert_eq!(serde_json::to_value(&refused).unwrap()["state"], "failed");
    assert_eq!(e.seq().unwrap(), 5);
    assert!(e.store().footprint_between(5, 6).is_none(), "refused member leaves no evidence");
    for (viewer, id, code) in [("bad\0viewer", "valid", "E_AUTH"), ("alice", "bad\0id", "E_INPUT")] {
        let ctx = crate::engine::Context::new(viewer, Default::default()).at(100);
        assert_eq!(e.mutate("put", Some(id), ctx).unwrap_err().code(), code);
        assert_eq!(e.seq().unwrap(), 5, "NUL admission publishes no sequence");
        assert!(e.store().footprint_between(5, 6).is_none());
    }
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(begin(&tx), 6);
    tx.savepoint("program").unwrap();
    tx.put("notes", table, &row("alice", "transient"), None).unwrap();
    tx.rollback_to("program").unwrap();
    complete(&tx, 6, &[]);
    let footprint = revocation::footprint_between(&tx, 5, 6).unwrap();
    assert!(footprint.unknown && footprint.tables.is_empty(), "recovered rollback matches SQLite's conservative footprint");
    tx.rollback().unwrap();
}
fn prune(pg: bool) {
    let mut e = engine(pg);
    let tx = e.store_mut().transaction().unwrap();
    for seq in 1..=1001 {
        assert_eq!(begin(&tx), seq);
        complete(&tx, seq, &[]);
        if seq == 1000 { assert!(revocation::footprint_between(&tx, 0, 1).is_some(), "exactly 1000 retains the first sequence"); }
    }
    assert!(revocation::footprint_between(&tx, 0, 1).is_none(), "1001 prunes sequence 1");
    assert!(revocation::footprint_between(&tx, 1, 2).is_some());
    assert!(revocation::footprint_between(&tx, 501, 1001).is_some(), "exactly 500 commits certify");
    assert!(revocation::footprint_between(&tx, 500, 1001).is_none(), "501 commits widen");
    tx.rollback().unwrap();
    assert_eq!(e.seq().unwrap(), 0);
    assert!(e.store().footprint_between(1000, 1001).is_none(), "pruning and evidence roll back together");
}
#[test] fn change_evidence_writer_sqlite() { writer(false); }
#[test] fn change_evidence_prune_sqlite() { prune(false); }
#[cfg(feature = "postgres")]
#[test] #[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn change_evidence_writer_postgres() { writer(true); }
#[cfg(feature = "postgres")]
#[test] #[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn change_evidence_prune_postgres() { prune(true); }
