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
    // A separate Sync prevents the division error from discarding the third
    // query. The protocol relay witness below separately proves wire overlap.
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
        panic!("TCP_NODELAY witness requires private TCP PG; socket-only input cannot qualify it");
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

#[test]
#[ignore = "private PG16; cached code keeps fresh snapshots, parameter types and a bounded session lifetime"]
fn pipeline_cached_statements_keep_fresh_facts_and_bounded_typed_code() {
    let (mut writer, pool, slot, name) = fixture(4);
    let connection = reader(&pool, &slot);
    let preparations = std::cell::Cell::new(0);
    let prepared = || preparations.set(preparations.get() + 1);
    for (viewer, live, head) in [("alice", true, 1), ("bob", false, 2)] {
        if !live { writer.batch_execute(&format!("UPDATE {name}.facts SET live=false,head=2")).unwrap(); }
        let rows = connection.independent_cached("SELECT live,head,$1::text FROM facts", &[(&viewer, Type::TEXT)], prepared).unwrap();
        assert_eq!((rows[0].get::<_,bool>(0),rows[0].get::<_,i64>(1),rows[0].get::<_,String>(2)),(live,head,viewer.into()));
    }
    assert_eq!(preparations.get(), 1, "fresh values must reuse only the prepared code");
    let plans = connection.independent("SELECT generic_plans,custom_plans FROM pg_prepared_statements WHERE statement='SELECT live,head,$1::text FROM facts'", &[]).unwrap();
    assert_eq!((plans[0].get::<_,i64>(0),plans[0].get::<_,i64>(1)),(2,0),"reader bindings must reuse plans as well as parsed code");
    for _ in 0..8 {
        let text = "viewer";
        let rows = connection.independent_cached("SELECT $1", &[(&text, Type::TEXT)], prepared).unwrap();
        assert_eq!(rows[0].get::<_,String>(0), text);
        let number = 17i64;
        let rows = connection.independent_cached("SELECT $1", &[(&number, Type::INT8)], prepared).unwrap();
        assert_eq!(rows[0].get::<_,i64>(0), number);
    }
    assert_eq!(preparations.get(), 3, "parameter types are part of code identity");
    for n in 0..64 {
        let rows=connection.independent_cached(&format!("SELECT {n}::bigint"), &[], prepared).unwrap();
        assert_eq!(rows[0].get::<_,i64>(0),n);
    }
    assert_eq!(runtime().block_on(slot.prepared.lock()).len(),32);
    let mut inspect=reader(&pool,&slot);
    let names=inspect.query_one("SELECT count(*) FROM pg_prepared_statements",&[]).unwrap().get::<_,i64>(0);
    assert!(names<=33,"eviction must reclaim code, not accumulate preparations: {names}");
    writer.batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();
}

// A frontend protocol relay counts complete Execute/Sync units only after
// forwarding their bytes to PG. Permits and task admission are not evidence of
// submission: a serialized custody lock cannot satisfy this barrier.
struct Wire {
    units: Arc<std::sync::atomic::AtomicUsize>,
    sockets: Vec<std::net::TcpStream>,
    relay: Option<std::thread::JoinHandle<()>>,
}
impl Wire {
    fn reaches(&self, count: usize) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.units.load(std::sync::atomic::Ordering::SeqCst) < count {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        true
    }
    fn count(&self) -> usize {
        self.units.load(std::sync::atomic::Ordering::SeqCst)
    }
}
impl Drop for Wire {
    fn drop(&mut self) {
        for socket in &self.sockets {
            let _ = socket.shutdown(std::net::Shutdown::Both);
        }
        self.relay.take().unwrap().join().unwrap();
    }
}
fn wire_fixture() -> (postgres::Client, Arc<Pool>, Arc<Slot>, String, Wire) {
    use std::io::{Read, Write};
    let config: postgres::Config = std::env::var("SNAPBACK4_EVAL_POSTGRES")
        .unwrap()
        .parse()
        .unwrap();
    let host = config
        .get_hosts()
        .iter()
        .find_map(|h| match h {
            postgres::config::Host::Tcp(h) => Some(h.clone()),
            _ => None,
        })
        .expect("on-wire witness requires private TCP PG16; socket-only input cannot qualify it");
    let upstream = (host, config.get_ports().first().copied().unwrap_or(5432));
    let (mut writer, _) = super::super::ownership::connect(config.clone()).unwrap();
    let name = format!("ff2_wire_{:x}", crate::ids::seed());
    writer.batch_execute(&format!("CREATE SCHEMA {name}; CREATE TABLE {name}.facts(live boolean,head bigint); INSERT INTO {name}.facts VALUES(true,1)")).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let units = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sent = units.clone();
    let (controls, receive) = std::sync::mpsc::sync_channel(1);
    let relay = std::thread::spawn(move || {
        let (mut front, _) = listener.accept().unwrap();
        let mut back = std::net::TcpStream::connect(upstream).unwrap();
        front.set_nodelay(true).unwrap();
        back.set_nodelay(true).unwrap();
        controls
            .send(vec![front.try_clone().unwrap(), back.try_clone().unwrap()])
            .unwrap();
        let mut replies = back.try_clone().unwrap();
        let mut client = front.try_clone().unwrap();
        let response = std::thread::spawn(move || {
            let _ = std::io::copy(&mut replies, &mut client);
            let _ = client.shutdown(std::net::Shutdown::Both);
        });
        let forward = (|| -> std::io::Result<()> {
            // SSL is disabled explicitly below: the first frame is Startup.
            let mut length = [0u8; 4];
            front.read_exact(&mut length)?;
            let n = u32::from_be_bytes(length) as usize;
            assert!((8..=16 * 1024 * 1024).contains(&n));
            let mut body = vec![0; n - 4];
            front.read_exact(&mut body)?;
            back.write_all(&length)?;
            back.write_all(&body)?;
            let mut executed = false;
            loop {
                let mut tag = [0u8; 1];
                front.read_exact(&mut tag)?;
                front.read_exact(&mut length)?;
                let n = u32::from_be_bytes(length) as usize;
                assert!((4..=16 * 1024 * 1024).contains(&n));
                let mut body = vec![0; n - 4];
                front.read_exact(&mut body)?;
                back.write_all(&tag)?;
                back.write_all(&length)?;
                back.write_all(&body)?;
                back.flush()?;
                if tag[0] == b'E' {
                    executed = true;
                }
                if tag[0] == b'S' && executed {
                    sent.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    executed = false;
                }
            }
        })();
        let _ = forward;
        let _ = back.shutdown(std::net::Shutdown::Both);
        let _ = front.shutdown(std::net::Shutdown::Both);
        response.join().unwrap();
    });
    let mut proxied = postgres::Config::new();
    proxied
        .host("127.0.0.1")
        .port(port)
        .ssl_mode(postgres::config::SslMode::Disable);
    if let Some(v) = config.get_user() {
        proxied.user(v);
    }
    if let Some(v) = config.get_dbname() {
        proxied.dbname(v);
    }
    if let Some(v) = config.get_password() {
        proxied.password(v);
    }
    let pool = Pool::with_depth(&proxied, &name, None, 4).unwrap();
    let slot = pool.slot().unwrap();
    let wire = Wire {
        units,
        sockets: receive.recv().unwrap(),
        relay: Some(relay),
    };
    (writer, pool, slot, name, wire)
}
#[test]
#[ignore = "private TCP PG16; actual frontend Execute/Sync submission barrier"]
fn pipeline_on_wire_overlap_precedes_release_and_backend_termination() {
    for cached in [false,true] {
    for terminate in [false, true] {
        let (mut writer, pool, slot, name, wire) = wire_fixture();
        let pid: i32 = reader(&pool, &slot)
            .independent("SELECT pg_backend_pid()", &[])
            .unwrap()[0]
            .get(0);
        let key = crate::ids::seed() as i64;
        let a = reader(&pool,&slot);
        let b = reader(&pool,&slot);
        let c = reader(&pool,&slot);
        let first_sql="SELECT live,head,pg_advisory_xact_lock($1) FROM facts";
        // Warm all three exact statements, including the statement-error case,
        // before taking the lock. The measured overlap must execute cached code.
        if cached {
            a.independent_cached(first_sql,&[(&key,Type::INT8)],||{}).unwrap();
            assert!(b.independent_cached("SELECT 1/0",&[],||{}).is_err());
            c.independent_cached("SELECT live,head FROM facts",&[],||{}).unwrap();
        }
        writer
            .query_one("SELECT pg_advisory_lock($1)", &[&key])
            .unwrap();
        let baseline = wire.count();
        let first = std::thread::spawn(move || {
            if cached {a.independent_cached(first_sql,&[(&key,Type::INT8)],||panic!("first statement was not warmed"))}
            else {a.independent(first_sql,&[(&key,Type::INT8)])}
        });
        wait(|| {
            writer
                .query_one(
                    "SELECT wait_event='advisory' FROM pg_stat_activity WHERE pid=$1",
                    &[&pid],
                )
                .unwrap()
                .get::<_, Option<bool>>(0)
                == Some(true)
        });
        let second = std::thread::spawn(move || if cached {b.independent_cached("SELECT 1/0",&[],||panic!("error statement was not warmed"))} else {b.independent("SELECT 1/0",&[])});
        let third = std::thread::spawn(move || if cached {c.independent_cached("SELECT live,head FROM facts",&[],||panic!("third statement was not warmed"))} else {c.independent("SELECT live,head FROM facts",&[])});
        let overlapped = wire.reaches(baseline + 3);
        let blocked = writer
            .query_one(
                "SELECT wait_event='advisory' FROM pg_stat_activity WHERE pid=$1",
                &[&pid],
            )
            .unwrap()
            .get::<_, Option<bool>>(0)
            == Some(true);
        if terminate {
            assert!(
                writer
                    .query_one("SELECT pg_terminate_backend($1)", &[&pid])
                    .unwrap()
                    .get::<_, bool>(0)
            );
        } else {
            writer
                .batch_execute(&format!("UPDATE {name}.facts SET live=false,head=2"))
                .unwrap();
        }
        writer
            .query_one("SELECT pg_advisory_unlock($1)", &[&key])
            .unwrap();
        let first = first.join().unwrap();
        let second = second.join().unwrap();
        let third = third.join().unwrap();
        drop(wire);
        writer
            .batch_execute(&format!("DROP SCHEMA {name} CASCADE"))
            .unwrap();
        assert!(
            overlapped && blocked,
            "three Execute/Sync units must reach PG while the first remains blocked (cached={cached}, terminate={terminate})"
        );
        if terminate {
            for result in [first, second, third] {
                assert!(result.unwrap_err().refusal().retryable);
            }
        } else {
            let first = first.unwrap();
            let third = third.unwrap();
            assert!(first[0].get::<_, bool>(0));
            assert_eq!(first[0].get::<_, i64>(1), 1);
            assert!(
                matches!(second,Err(RuntimeError::Postgres(e)) if e.code()==Some(&postgres::error::SqlState::DIVISION_BY_ZERO))
            );
            assert!(!third[0].get::<_, bool>(0));
            assert_eq!(third[0].get::<_, i64>(1), 2);
        }
    }
    }
}

#[cfg(target_os = "linux")]
#[test]
fn pipeline_tcp_nodelay_refuses_socket_only_qualification() {
    let output=std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--ignored","--exact","engine::postgres::pipeline::tests::pipeline_tcp_nodelay_on_reader_and_synchronous_writer","--nocapture"])
        .env("SNAPBACK4_EVAL_POSTGRES","host=/nonexistent-ff2-socket port=1 user=sb4_eval dbname=postgres")
        .output().unwrap();
    assert!(
        !output.status.success(),
        "socket-only TCP_NODELAY qualification passed vacuously: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("TCP_NODELAY witness requires private TCP PG")
    );
}

#[test]
#[ignore = "private PG16"]
fn r1_pool_construction_releases_global_slots_and_bounds_reservations() {
    let (_, pool, _, _) = fixture(4);
    let (entered, arrived) = std::sync::mpsc::channel();
    let (release, resumed) = std::sync::mpsc::channel();
    let building = pool.clone();
    let thread = std::thread::spawn(move || building.slot_with(|| {
        entered.send(()).unwrap(); resumed.recv().unwrap();
    }));
    arrived.recv_timeout(Duration::from_secs(10)).unwrap();
    let available = pool.slots.try_lock().is_ok();
    // Existing slots remain usable while a connect is parked indefinitely.
    let usable = if available { Some(reader(&pool, &pool.slots.lock().unwrap().ready[0]).independent("SELECT 42::bigint", &[]).unwrap()[0].get::<_, i64>(0)) } else { None };
    release.send(()).unwrap(); thread.join().unwrap().unwrap();
    assert!(available, "connect/qualification holds the global slots mutex");
    assert_eq!(usable, Some(42));
    let threads: Vec<_> = (0..64).map(|_| { let pool = pool.clone(); std::thread::spawn(move || pool.slot().unwrap()) }).collect();
    for thread in threads { thread.join().unwrap(); }
    let slots = pool.slots.lock().unwrap();
    assert_eq!(slots.opening, 0);
    assert!(slots.ready.len() <= CONNECTIONS);
}
