//! Server summary retention is atomic with its commit; missing intervals widen.
use snapback4_core::{Store, Value, schema::Schema, revocation::preserved_between, value::object};

fn schema() -> Schema {
    let b = snapback4_lang::compile(&[("schema.q".into(), "table docs:\n  body: int\n  public\n  sync public\n".into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b.schema
}
fn write(store: &mut Store, schema: &Schema, n: u64, commit: bool) {
    let tx = store.transaction().unwrap();
    let old = tx.get("docs", "row").unwrap();
    tx.put("docs", &schema.tables["docs"], &object([("id",Value::Id("row".into())),("body",Value::Int(n as i64))]),old.as_ref()).unwrap();
    let seq = tx.next_seq().unwrap();
    tx.record_commit(seq,n as i64,"update","alice","mutation", &["docs".into()],1).unwrap();
    if commit { tx.commit().unwrap(); } else { tx.rollback().unwrap(); }
}
fn stats(store: &Store) -> (i64,i64,i64) {
    store.conn().query_row("SELECT count(*), coalesce(sum(length(footprint)),0), coalesce((SELECT sum(pgsize) FROM dbstat WHERE name='_change_evidence'),0) FROM _change_evidence",[],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap()
}
#[test]
fn pruning_is_atomic_and_old_or_missing_intervals_widen() {
    let schema = schema();
    let mut store = Store::memory().unwrap();
    store.install(&schema).unwrap();
    for n in 1..=1001 { write(&mut store,&schema,n,true); }
    assert_eq!(stats(&store).0,1000);
    assert!(preserved_between(store.conn(),&schema,0,1).is_empty());
    assert!(preserved_between(store.conn(),&schema,500,1001).is_empty());
    assert_eq!(preserved_between(store.conn(),&schema,501,1001),vec!["docs"]);
    assert_eq!(preserved_between(store.conn(),&schema,1,2),vec!["docs"]);
    let before = stats(&store);
    write(&mut store,&schema,1002,false);
    assert_eq!(stats(&store),before);
    assert_eq!(preserved_between(store.conn(),&schema,1,2),vec!["docs"]);
    write(&mut store,&schema,1002,true);
    assert!(preserved_between(store.conn(),&schema,1,2).is_empty());
    // A backend without summaries (including Postgres) cannot certify a commit.
    store.conn().execute("DROP TABLE _change_evidence",[]).unwrap();
    assert!(preserved_between(store.conn(),&schema,1001,1002).is_empty());
}

#[test]
#[ignore = "explicit before/after write-cost and steady-state measurement"]
fn measure_history() {
    let schema = schema();
    for trial in 0..3 {
        let dir = std::env::temp_dir().join(format!("rv-history-{}-{trial}",std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut store = Store::open(&dir.join("store.sqlite")).unwrap();
        store.install(&schema).unwrap();
        let mut start = std::time::Instant::now();
        let mut last = 0;
        for n in 1..=20000 {
            write(&mut store,&schema,n,true);
            if [1000,10000,20000].contains(&n) {
                let micros = start.elapsed().as_secs_f64()*1e6/(n-last) as f64;
                let (rows,json,pages) = stats(&store);
                println!("RV history: trial={trial} commits={n} segment_us_per_commit={micros:.3} summaries={rows} json_bytes={json} evidence_sqlite_bytes={pages}");
                last = n; start = std::time::Instant::now();
            }
        }
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
