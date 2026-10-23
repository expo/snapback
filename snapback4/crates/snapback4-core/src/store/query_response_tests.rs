//! The envelope and data share one read snapshot while a writer commits.
// @ref LLP 3000.009.001.000.001#7 — concurrent commits and adoption cannot mix snapshot identities, cuts and rows.
use crate::{Context, Engine, Program, QueryOutcome, Refusal, Schema, Value, store_port::AnyStore};
use crate::engine::DeliveryManifest;
const SOURCE: &str = "table notes:\n  n: int\n  public\n  insert <- allow\n  update <- allow\n  sync public\nmutation put(key: id, n: int):\n  upsert notes[key] { n }\n  return n\nquery peek(key: id):\n  return notes[key]\nquery must(key: id):\n  return notes[key] ! else MISSING\n";
fn bound(source: &str) -> (Schema, Vec<Program>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap(), b.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect())
}
fn read_context(key: &str) -> Context { Context::new("alice", [("key".into(), Value::Id(key.into()))].into()).at(1000) }
fn write_context(n: i64) -> Context { let mut c = read_context("n1"); c.args.insert("n".into(), Value::Int(n)); c }
fn observed(engine: &mut Engine, name: &str, key: &str) -> (Result<QueryOutcome, Refusal>, Option<u64>, Option<(String, u64)>) {
    let mut head = None;
    let (outcome, cut, _) = engine.query_materialized_search_with_snapshot(name, read_context(key), None, DeliveryManifest::Build, |snapshot, seq| {
        head = Some((snapshot.store_id()?, seq));
        assert_eq!(snapshot.next_seq()? - 1, seq);
        Ok(())
    });
    (outcome, cut, head)
}
pub(crate) fn check_store(store: AnyStore) {
    let (schema, programs) = bound(SOURCE);
    let mut writer = Engine::new_at(store, schema, programs, 1000).unwrap();
    writer.mutate("put", Some("before"), write_context(1)).unwrap();
    let mut reader = writer.reader().unwrap();
    let identity = writer.store().store_identity().unwrap().unwrap();
    let mut head = None;
    let (outcome, cut, _) = reader.query_materialized_search_with_snapshot("peek", read_context("n1"), None, DeliveryManifest::Build, |snapshot, seq| {
        head = Some((snapshot.store_id()?, seq));
        assert_eq!(snapshot.next_seq()? - 1, seq);
        let ack = writer.mutate_acknowledged("put", Some("during"), write_context(2)).unwrap();
        assert_eq!(ack.publication.unwrap().head, seq + 1);
        // Re-read within the borrowed snapshot even after the competing COMMIT.
        assert_eq!(snapshot.store_id()?, identity);
        assert_eq!(snapshot.next_seq()? - 1, seq);
        Ok(())
    });
    let outcome = outcome.unwrap();
    assert_eq!(outcome.data.field("n").unwrap(), &Value::Int(1));
    assert_eq!(outcome.seq, 1); assert_eq!(cut, Some(1));
    assert_eq!(head, Some((identity.clone(), 1)));
    assert_eq!(writer.seq().unwrap(), 2);
    // A query begun after acknowledgement sees that write and its new head.
    let (outcome, cut, head) = observed(&mut reader, "peek", "n1");
    let outcome = outcome.unwrap();
    assert_eq!(outcome.data.field("n").unwrap(), &Value::Int(2));
    assert_eq!(outcome.seq, 2); assert_eq!(cut, Some(2));
    assert_eq!(head, Some((identity.clone(), 2)));
    let (outcome, cut, head) = observed(&mut reader, "must", "absent");
    assert_eq!(outcome.unwrap_err().code, "MISSING");
    assert_eq!(cut, Some(2)); assert_eq!(head, Some((identity.clone(), 2)));
    let generation = reader.generation();
    let (schema, programs) = bound(&SOURCE.replace("return n\n", "return n + 1\n"));
    writer.adopt_at(schema, programs, 1000).unwrap();
    assert!(writer.generation() > generation);
    let (outcome, _, head) = observed(&mut reader, "peek", "n1");
    assert_eq!(outcome.unwrap_err().code, "E_GENERATION");
    assert!(head.is_none(), "obsolete readers cannot supply response metadata");
    let mut reader = writer.reader().unwrap();
    let (outcome, cut, head) = observed(&mut reader, "peek", "n1");
    assert_eq!(outcome.unwrap().data.field("n").unwrap(), &Value::Int(2));
    assert_eq!(cut, Some(writer.seq().unwrap()));
    assert_eq!(head, Some((identity, writer.seq().unwrap())));
    assert_eq!(reader.generation(), writer.generation());
}
#[test]
fn response_head_sqlite_borrows_the_query_snapshot_across_commit_and_adoption() {
    struct Directory(std::path::PathBuf);
    impl Drop for Directory { fn drop(&mut self) { std::fs::remove_dir_all(&self.0).unwrap(); } }
    let directory = Directory(std::env::temp_dir().join(format!("sb4-rt2-head-{:x}", crate::ids::seed())));
    std::fs::create_dir(&directory.0).unwrap();
    check_store(AnyStore::open(&directory.0.join("store.db")).unwrap());
}
