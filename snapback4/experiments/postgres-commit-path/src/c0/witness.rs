//! Focused harness witnesses; these do not qualify product recovery/readers.
// @ref LLP 3000.009.001.000.000.003#51-the-reader-rule — the old image is valid only on its stamped interval.
use super::*;
fn errcode(c: &mut Client, sql: &str, want: &str) {
    let e = c.simple_query(sql).unwrap_err();
    assert_eq!(e.code().unwrap().code(), want);
    c.batch_execute("ROLLBACK").unwrap();
}
pub fn run() {
    reset();
    let mut c = fixture::connect(true);
    c.batch_execute("SET extra_float_digits=3;SET bytea_output=hex")
        .unwrap();
    errcode(
        &mut c,
        &format!(
            "BEGIN;SET LOCAL bytea_output=escape;{}SELECT 123;COMMIT",
            sql::GUARD
        ),
        "S4001",
    );
    errcode(
        &mut c,
        &format!("BEGIN;{}COMMIT", sql::FENCE.replacen("(1::", "(2::", 1)),
        "S4002",
    );
    let mut image: Json = c
        .query_one(
            "SELECT data::jsonb FROM r WHERE t='counters' AND id='c0000'",
            &[],
        )
        .unwrap()
        .get(0);
    image["Row"]["n"]["Int"] = json!(1);
    let encoded = serde_json::to_string(&image).unwrap();
    c.execute("UPDATE r SET odata=data,data=$1,orev=1000001,owm=1000000 WHERE t='counters' AND id='c0000'",&[&encoded]).unwrap();
    let read = "SELECT CASE WHEN orev IS NULL OR orev<=$1 THEN data WHEN owm<=$1 THEN odata ELSE sb4_stale(orev) END FROM r WHERE t='counters' AND id='c0000'";
    for (v, want) in [(1000000i64, 0), (1000001, 1)] {
        let got: String = c.query_one(read, &[&v]).unwrap().get(0);
        let got: Json = serde_json::from_str(&got).unwrap();
        assert_eq!(got["Row"]["n"]["Int"], json!(want));
    }
    image["Row"]["n"]["Int"] = json!(2);
    c.execute("UPDATE r SET odata=data,data=$1,orev=1000002,owm=1000001 WHERE t='counters' AND id='c0000'",&[&serde_json::to_string(&image).unwrap()]).unwrap();
    let error = c.query(read, &[&1000000i64]).unwrap_err();
    assert_eq!(error.code().unwrap().code(), "S4004");
    // A later writer cannot overwrite the only old image while above W.
    let count=c.execute("UPDATE r SET odata=data WHERE t='counters' AND id='c0000' AND (orev IS NULL OR orev<=1000000)",&[]).unwrap();
    assert_eq!(count, 0);
    errcode(&mut c, "BEGIN;SELECT sb4_assert(false);COMMIT", "S4003");
    // The batch record is a live key race: one winner, including after a
    // recorded owner backend is terminated. No process is signalled by name.
    let mut owner = fixture::connect(true);
    let pid: i32 = owner
        .query_one("SELECT pg_backend_pid()", &[])
        .unwrap()
        .get(0);
    let start: String = c
        .query_one(
            "SELECT backend_start::text FROM pg_stat_activity WHERE pid=$1",
            &[&pid],
        )
        .unwrap()
        .get(0);
    if let Ok(path) = std::env::var("C0_BACKENDS") {
        let mut f = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .unwrap();
        writeln!(
            f,
            "{}",
            json!({"pid":pid,"backend_start":start,"kind":"owned-void-race"})
        )
        .unwrap();
        f.sync_data().unwrap();
    }
    owner.batch_execute("BEGIN;INSERT INTO _batches VALUES(2000001,2000001,2000001,2000001,'killed','committed',0)").unwrap();
    let terminated:bool=c.query_one("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start::text=$2",&[&pid,&start]).unwrap().get(0);
    assert!(terminated);
    let _ = owner.simple_query("COMMIT");
    drop(owner);
    c.batch_execute(
        "INSERT INTO _batches VALUES(2000001,2000001,2000001,2000001,'killed','void',0)",
    )
    .unwrap();
    errcode(
        &mut c,
        "INSERT INTO _batches VALUES(2000001,2000001,2000001,2000001,'late','committed',0)",
        "23505",
    );
    let mut owner = fixture::connect(true);
    owner.batch_execute("BEGIN;INSERT INTO _batches VALUES(2000002,2000002,2000002,2000002,'won','committed',0)").unwrap();
    let (tx, rx) = mpsc::channel();
    let other = thread::spawn(move || {
        let mut c = fixture::connect(true);
        tx.send(()).unwrap();
        c.batch_execute(
            "INSERT INTO _batches VALUES(2000002,2000002,2000002,2000002,'lost','void',0)",
        )
        .unwrap_err()
        .code()
        .unwrap()
        .code()
        .to_owned()
    });
    rx.recv().unwrap();
    delay(20.);
    owner.batch_execute("COMMIT").unwrap();
    assert_eq!(other.join().unwrap(), "23505");
    reset();
    println!(
        "{}",
        json!({"settings_guard":"S4001","owner_fence":"S4002","raising_count":"S4003","prefix_old_and_new":true,"stale_restart":"S4004","tripwire":true,"void_after_recorded_backend_kill":true,"late_commit_refused":true,"committed_key_beats_void":true,"product_recovery_qualification":false})
    );
}
