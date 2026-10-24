//! Private-cluster transport witnesses, including overlapping requests on one
//! physical connection. No test uses or stops a pre-existing cluster.
use super::*;
use crate::RuntimeError;
use postgres::types::Type;
use std::{
    sync::{Arc, Barrier},
    time::{Duration, Instant},
};

fn fixture(depth: usize) -> (postgres::Client, Arc<Pool>, Arc<Slot>, String) {
    let config: postgres::Config = std::env::var("SNAPBACK4_EVAL_POSTGRES")
        .unwrap()
        .parse()
        .unwrap();
    let (mut writer, _) = super::super::ownership::connect(config.clone()).unwrap();
    let name = format!("pipe_{:x}", crate::ids::seed());
    writer.batch_execute(&format!("CREATE SCHEMA {name}; CREATE TABLE {name}.facts (live boolean, head bigint); INSERT INTO {name}.facts VALUES (true,1)" )).unwrap();
    let pool = Pool::with_depth(&config, &name, None, depth).unwrap();
    let slot = pool.slot().unwrap();
    (writer, pool, slot, name)
}
fn reader(pool: &Arc<Pool>, slot: &Arc<Slot>) -> Connection {
    Connection::Reader {
        slot: slot.clone(),
        _pool: pool.clone(),
        session: false,
        lease: None,
    }
}
fn wait(mut condition: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(Instant::now() < until, "pipeline rendezvous timed out");
        std::thread::sleep(Duration::from_millis(2));
    }
}
#[test]
#[ignore = "private PG16"]
fn pipeline_snapshots_authority_and_statement_errors_are_independent() {
    let (mut writer, pool, slot, name) = fixture(4);
    let pid: i32 = reader(&pool, &slot)
        .independent("SELECT pg_backend_pid()", &[])
        .unwrap()[0]
        .get(0);
    let a = reader(&pool, &slot);
    let first =
        std::thread::spawn(move || a.independent("SELECT live,head,pg_sleep(0.3) FROM facts", &[]));
    wait(|| {
        writer
            .query_one(
                "SELECT wait_event='PgSleep' FROM pg_stat_activity WHERE pid=$1",
                &[&pid],
            )
            .unwrap()
            .get::<_, Option<bool>>(0)
            == Some(true)
    });
    let b = reader(&pool, &slot);
    let second = std::thread::spawn(move || b.independent("SELECT live,head FROM facts", &[]));
    wait(|| slot.permits.available_permits() == 2);
    writer
        .batch_execute(&format!("UPDATE {name}.facts SET live=false,head=2"))
        .unwrap();
    let first = first.join().unwrap().unwrap();
    let second = second.join().unwrap().unwrap();
    assert!(first[0].get::<_, bool>(0));
    assert_eq!(first[0].get::<_, i64>(1), 1);
    assert!(!second[0].get::<_, bool>(0));
    assert_eq!(second[0].get::<_, i64>(1), 2);
    // All three are in flight before the first query completes. A separate
    // Sync prevents the division error from discarding the third query.
    let a = reader(&pool, &slot);
    let good1 = std::thread::spawn(move || a.independent("SELECT 11::bigint,pg_sleep(0.2)", &[]));
    wait(|| slot.permits.available_permits() == 3);
    let b = reader(&pool, &slot);
    let bad = std::thread::spawn(move || b.independent("SELECT 1/0", &[]));
    wait(|| slot.permits.available_permits() == 2);
    let c = reader(&pool, &slot);
    let good2 = std::thread::spawn(move || c.independent("SELECT 33::bigint", &[]));
    wait(|| slot.permits.available_permits() == 1);
    assert_eq!(good1.join().unwrap().unwrap()[0].get::<_, i64>(0), 11);
    assert!(
        matches!(bad.join().unwrap(),Err(RuntimeError::Postgres(e)) if e.code()==Some(&postgres::error::SqlState::DIVISION_BY_ZERO))
    );
    assert_eq!(good2.join().unwrap().unwrap()[0].get::<_, i64>(0), 33);
    let settings=reader(&pool,&slot).independent("SELECT current_setting('client_encoding'),current_setting('extra_float_digits'),current_setting('bytea_output'),current_setting('default_transaction_read_only')",&[]).unwrap();
    assert_eq!(
        (
            settings[0].get::<_, &str>(0),
            settings[0].get::<_, &str>(1),
            settings[0].get::<_, &str>(2),
            settings[0].get::<_, &str>(3)
        ),
        ("UTF8", "3", "hex", "on")
    );
    writer
        .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
        .unwrap();
}
#[test]
#[ignore = "private PG16"]
fn pipeline_loss_fails_exactly_outstanding_requests_and_recovers_on_new_handle() {
    let (mut writer, pool, slot, name) = fixture(4);
    let completed = reader(&pool, &slot)
        .independent("SELECT 7::bigint,pg_backend_pid()", &[])
        .unwrap();
    let pid: i32 = completed[0].get(1);
    let healthy = Connection::reader(pool.clone()).unwrap();
    let unaffected =
        std::thread::spawn(move || healthy.independent("SELECT 8::bigint,pg_sleep(0.2)", &[]));
    let barrier = Arc::new(Barrier::new(4));
    let requests: Vec<_> = (0..3)
        .map(|_| {
            let c = reader(&pool, &slot);
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                c.independent("SELECT pg_sleep(2)", &[])
            })
        })
        .collect();
    barrier.wait();
    wait(|| slot.permits.available_permits() == 1);
    assert!(
        writer
            .query_one("SELECT pg_terminate_backend($1)", &[&pid])
            .unwrap()
            .get::<_, bool>(0)
    );
    for request in requests {
        let error = request.join().unwrap().unwrap_err();
        assert!(error.refusal().retryable, "{error}");
    }
    assert_eq!(completed[0].get::<_, i64>(0), 7);
    assert_eq!(unaffected.join().unwrap().unwrap()[0].get::<_, i64>(0), 8);
    let replacement = Connection::reader(pool.clone()).unwrap();
    assert_eq!(
        replacement.independent("SELECT 9::bigint", &[]).unwrap()[0].get::<_, i64>(0),
        9
    );
    writer
        .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
        .unwrap();
}
#[test]
#[ignore = "private PG16"]
fn pipeline_depth_bounds_and_fallback_has_exclusive_snapshot_custody() {
    let (mut writer, pool, slot, name) = fixture(1);
    let mut fallback = reader(&pool, &slot);
    fallback.begin();
    fallback
        .batch_execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .unwrap();
    let old: i64 = fallback
        .query_one("SELECT head FROM facts", &[])
        .unwrap()
        .get(0);
    writer
        .batch_execute(&format!("UPDATE {name}.facts SET head=2"))
        .unwrap();
    let c = reader(&pool, &slot);
    let query = std::thread::spawn(move || c.independent("SELECT head FROM facts", &[]));
    wait(|| slot.permits.available_permits() == 0);
    assert_eq!(
        fallback
            .query_one("SELECT head FROM facts", &[])
            .unwrap()
            .get::<_, i64>(0),
        old
    );
    assert!(!query.is_finished());
    fallback.batch_execute("ROLLBACK").unwrap();
    fallback.finish();
    assert_eq!(query.join().unwrap().unwrap()[0].get::<_, i64>(0), 2);
    // Binary Bind still uses the same text admission as the serving codec.
    assert!(super::super::literal::parameter(&"a\0b", &Type::TEXT).is_err());
    writer
        .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
        .unwrap();
}

#[test]
#[ignore = "private TCP PG16; Linux socket-option witness"]
#[cfg(target_os = "linux")]
fn pipeline_tcp_nodelay_on_reader_and_synchronous_writer() {
    let config: postgres::Config = std::env::var("SNAPBACK4_EVAL_POSTGRES")
        .unwrap()
        .parse()
        .unwrap();
    if !config
        .get_hosts()
        .iter()
        .any(|h| matches!(h, postgres::config::Host::Tcp(_)))
    {
        eprintln!(
            "TCP_NODELAY witness requires private TCP PG; socket-only cluster has no TCP sockets"
        );
        return;
    }
    if std::env::var_os("SNAPBACK4_PIPELINE_NODELAY_CHILD").is_some() {
        let (mut writer, _pool, _slot, name) = fixture(4);
        writer
            .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
            .unwrap();
        return;
    }
    let trace = std::env::temp_dir().join(format!("sb4-pipe-nodelay-{}.txt", crate::ids::seed()));
    let mut child=std::process::Command::new("strace").args(["-f","-e","trace=setsockopt","-o"])
        .arg(&trace).arg(std::env::current_exe().unwrap())
        .args(["--ignored","--exact","engine::postgres::pipeline::tests::pipeline_tcp_nodelay_on_reader_and_synchronous_writer"])
        .env("SNAPBACK4_PIPELINE_NODELAY_CHILD","1").spawn().expect("Linux TCP witness needs strace");
    eprintln!("TCP_NODELAY witness recorded child PID {}", child.id());
    assert!(child.wait().unwrap().success());
    let text = std::fs::read_to_string(&trace).unwrap();
    let enabled = text
        .lines()
        .filter(|l| l.contains("TCP_NODELAY, [1]") && l.ends_with("= 0"))
        .count();
    assert!(
        enabled >= 2,
        "both reader and synchronous writer must set TCP_NODELAY: {text}"
    );
    assert!(!text.contains("TCP_NODELAY, [0]"));
    eprintln!("TCP_NODELAY=1 witnessed on {enabled} reader/writer sockets; child exited");
    std::fs::remove_file(trace).unwrap();
}

#[test]
#[ignore = "private PG16; pooled SQL PREPARE lifetime and neighbour isolation"]
fn pipeline_retiring_logical_readers_reclaims_only_their_prepared_names() {
    let (mut writer, pool, slot, name) = fixture(4);
    let mut inspect = reader(&pool, &slot);
    let mut count = || {
        inspect
            .query_one(
                "SELECT count(*) FROM pg_prepared_statements WHERE name LIKE 'sb4_rt6_%'",
                &[],
            )
            .unwrap()
            .get::<_, i64>(0)
    };
    let baseline = count();
    for _ in 0..16 {
        let mut a = reader(&pool, &slot);
        let mut b = reader(&pool, &slot);
        let sql = "SELECT head FROM facts";
        let bind = a.prepare(sql).unwrap();
        let first = super::super::literal::Prepared::from_bind(
            &mut a,
            &super::super::literal::serving_name(),
            sql,
            bind,
        )
        .unwrap();
        let bind = b.prepare(sql).unwrap();
        let second = super::super::literal::Prepared::from_bind(
            &mut b,
            &super::super::literal::serving_name(),
            sql,
            bind,
        )
        .unwrap();
        assert_eq!(count(), baseline + 2);
        drop(first);
        drop(a);
        let until = Instant::now() + Duration::from_secs(5);
        while count() != baseline + 1 {
            assert!(
                Instant::now() < until,
                "retired reader's SQL PREPARE survived on its pooled connection; count={}",
                count()
            );
            std::thread::sleep(Duration::from_millis(2));
        }
        let rows = second
            .rows(&b.simple_query(&second.command(&[]).unwrap()).unwrap())
            .unwrap();
        assert_eq!(
            rows[0][0],
            super::super::literal::Datum::Int(1),
            "another reader's prepared name was reclaimed"
        );
        drop(second);
        drop(b);
        let until = Instant::now() + Duration::from_secs(5);
        while count() != baseline {
            assert!(
                Instant::now() < until,
                "retired prepared names accumulated; count={}",
                count()
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    writer
        .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
        .unwrap();
}
