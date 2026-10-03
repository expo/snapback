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

fn schema_version(store: &Store) -> i64 {
    store.conn().query_row("PRAGMA schema_version", [], |row| row.get(0)).unwrap()
}

fn evidence_exists(store: &Store) -> bool {
    store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_change_evidence')", [], |row| row.get(0)).unwrap()
}

fn check_commits_reuse_plans(store: &mut Store, schema: &Schema) {
    use rusqlite::StatementStatus::{RePrepare, Run};
    let version = schema_version(store);
    let sql = "SELECT count(*) FROM r";
    store.conn().prepare_cached(sql).unwrap().query_row([], |row| row.get::<_, i64>(0)).unwrap();
    for n in 1..=1002 {
        // Include the first commit, the pruning boundary, and a rollback.
        write(store, schema, n, n != 1002);
        assert_eq!(schema_version(store), version, "commit {n} changed the SQLite schema");
        let mut statement = store.conn().prepare_cached(sql).unwrap();
        assert_eq!(statement.query_row([], |row| row.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(statement.get_status(RePrepare), 0, "commit {n} invalidated a cached statement");
        assert_eq!(statement.get_status(Run), n as i32 + 1, "the assertion must observe the same cached statement");
    }
    assert_eq!(stats(store).0, 1000);
}

#[test]
fn commits_preserve_schema_and_cached_statements() {
    let schema = schema();
    let dir = std::env::temp_dir().join(format!("rv-commit-schema-{}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    for mut store in [Store::memory().unwrap(), Store::open(&dir.join("store.sqlite")).unwrap()] {
        store.install(&schema).unwrap();
        check_commits_reuse_plans(&mut store, &schema);
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn server_open_migrates_evidence_before_commits() {
    let schema = schema();
    let dir = std::env::temp_dir().join(format!("rv-open-evidence-{}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let mut store = Store::open(&path).unwrap();
    store.install(&schema).unwrap();
    write(&mut store, &schema, 0, true);
    // Model the pre-RV layout without relying on a database artifact.
    store.conn().execute_batch("DROP TABLE IF EXISTS _change_evidence").unwrap();
    let version = schema_version(&store);
    drop(store);
    let inspection = Store::open_read_only(&path).unwrap();
    assert!(!evidence_exists(&inspection));
    assert_eq!(schema_version(&inspection), version);
    drop(inspection);
    #[cfg(unix)]
    {
        let device = Store::open_shared(&path).unwrap();
        assert!(!evidence_exists(&device), "opening an old native device must not add evidence metadata");
        assert_eq!(schema_version(&device), version);
    }
    let mut store = Store::open(&path).unwrap();
    assert!(evidence_exists(&store), "server open must migrate before returning the store");
    assert_eq!(stats(&store).0, 0);
    assert!(preserved_between(store.conn(), &schema, 0, 1).is_empty());
    check_commits_reuse_plans(&mut store, &schema);
    let version = schema_version(&store);
    drop(store);
    let store = Store::open(&path).unwrap();
    assert_eq!(schema_version(&store), version, "server reopen must be idempotent");
    assert_eq!(stats(&store).0, 1000);
    assert_eq!(preserved_between(store.conn(), &schema, 501, 1001), vec!["docs"]);
    drop(store);
    std::fs::remove_dir_all(dir).unwrap();
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
