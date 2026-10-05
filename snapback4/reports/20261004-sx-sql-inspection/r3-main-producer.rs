use snapback4_core::{Engine, Store, wire};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let source = std::fs::read_to_string(&args[1]).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.schema.required_capabilities().is_empty());
    let mut engine = Engine::new(Store::open(std::path::Path::new(&args[2])).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let post = wire::row_from_json(&engine.schema().tables["posts"], &serde_json::json!({"id":"post1","authorId":"dev:alice"})).unwrap();
    let like = wire::row_from_json(&engine.schema().tables["likes"], &serde_json::json!({"id":"like1","postId":"post1","principal":"dev:alice"})).unwrap();
    engine.seed([("posts".into(), post), ("likes".into(), like)]).unwrap();
    let schema: String = engine.store().conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation')", [], |r| r.get(0)).unwrap();
    std::fs::write(&args[3], schema).unwrap();
    engine.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
}
