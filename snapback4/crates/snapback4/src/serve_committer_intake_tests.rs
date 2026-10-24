//! Real HTTP body age, grouped abort and named-member fallback witnesses.
use super::*;
use std::{
    io::{Read, Write},
    net::TcpStream,
};

const SOURCE: &str = "use personas alice\ntable rows:\n  n: int\n  public\n  insert <- allow\n  sync public\nmutation add(n: int):\n  return insert rows { n }\n";

fn sql(namespace: &str, statement: &str) -> String {
    let out = std::process::Command::new("psql")
        .args([
            "-XqAt",
            "-v",
            "ON_ERROR_STOP=1",
            "--dbname",
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            "-c",
            &format!("SET search_path={namespace},pg_catalog; {statement}"),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}
fn waiting_body(host: &Host) -> TcpStream {
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    stream.write_all(b"POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nExpect: 100-continue\r\nContent-Length: 17\r\n\r\n").unwrap();
    // The server has constructed Request (and its accepted_at timestamp),
    // entered the HTTP handler and asked for the still-unavailable body.
    let mut interim = Vec::new();
    while !interim.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        stream.read_exact(&mut byte).unwrap();
        interim.push(byte[0]);
        assert!(interim.len() < 4096);
    }
    assert!(interim.starts_with(b"HTTP/1.1 100 Continue\r\n"));
    stream
}
fn intake(grouped: bool, named: bool, age: Duration) {
    let namespace = format!("sb4_ff1_intake_{:x}", snapback4_core::ids::seed());
    let store = snapback4_core::store_port::AnyStore::create_postgres(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16"),
        &namespace,
    )
    .unwrap();
    let host = Host::with_store(true, store, SOURCE);
    {
        let abort = if named {
            "IF NEW.data::jsonb#>>'{Row,n,Int}'='-1' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='named intake abort'; END IF;"
        } else {
            ""
        };
        sql(
            &namespace,
            &format!(
                "CREATE SEQUENCE intake_attempts; CREATE SEQUENCE intake_commits; CREATE FUNCTION intake_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('intake_attempts'); {abort} RETURN NEW; END $$; CREATE TRIGGER intake_attempt BEFORE INSERT ON r FOR EACH ROW EXECUTE FUNCTION intake_attempt(); CREATE FUNCTION intake_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('intake_commits')=1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='conclusive intake COMMIT abort'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER intake_commit AFTER INSERT ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION intake_commit()"
            ),
        );
        if named {
            sql(&namespace, "DROP TRIGGER intake_commit ON r");
        }
    }
    let n = if grouped { 3 } else { 1 };
    let mut streams = (0..n).map(|_| waiting_body(&host)).collect::<Vec<_>>();
    std::thread::sleep(age);
    let (release, held) = if grouped {
        let (entered, started) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let held = host
            .shared
            .engine
            .queue
            .submit(Command::new(move |_| {
                entered.send(()).unwrap();
                resume.recv_timeout(Duration::from_secs(10)).unwrap();
            }))
            .unwrap();
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        (Some(release), Some(held))
    } else {
        (None, None)
    };
    for (i, stream) in streams.iter_mut().enumerate() {
        let payload = if named && i == 1 {
            "{\"args\":{\"n\":-1}}"
        } else {
            "{\"args\":{\"n\":1}} "
        };
        assert_eq!(payload.len(), 17);
        stream.write_all(payload.as_bytes()).unwrap();
        if grouped {
            let until = Instant::now() + Duration::from_secs(5);
            while host.shared.engine.queued.load(Ordering::Acquire) < i + 1 {
                assert!(Instant::now() < until, "HTTP member did not reach queue");
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }
    if let Some(release) = release {
        release.send(()).unwrap();
        held.unwrap().wait().unwrap();
    }
    let mut replies = Vec::new();
    for mut stream in streams {
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        replies.push(body(&response));
    }
    let (head, rows) = host
        .shared
        .engine
        .call(|engine, _| {
            let head = engine.seq().unwrap();
            let rows = engine.store().count("rows").unwrap();
            (head, rows)
        })
        .unwrap();
    let attempts: i64 = sql(&namespace, "SELECT last_value FROM intake_attempts")
        .trim()
        .parse()
        .unwrap();
    eprintln!(
        "HTTP intake grouped={grouped} named={named} age={age:?}: head={head},rows={rows},attempts={attempts},replies={replies:?}"
    );
    if age >= Duration::from_millis(100) {
        assert!(
            replies.iter().all(|r| r["state"] != "sent"),
            "aged HTTP members gained a fresh retry: {replies:?}"
        );
        assert_eq!(
            (head, rows, attempts),
            (0, 0, if named { 2 } else { n as i64 })
        );
    } else {
        assert_eq!(
            replies[0]["state"], "sent",
            "remaining intake budget must allow retry"
        );
        assert_eq!((head, rows, attempts), (1, 1, 2));
    }
    if grouped {
        assert_eq!(
            host.shared.engine.queue.batch_stats().fills.get(3),
            Some(&1),
            "must exercise a physical group"
        );
    }
    let next = body(&host.request(
        "POST",
        "/m/add",
        "x-snapback-persona: alice\r\n",
        r#"{"args":{"n":2}}"#,
    ));
    assert_eq!(
        next["state"], "sent",
        "queue must progress after abort: {next}"
    );
}

#[test]
#[ignore = "private PG16; scripts/test-postgres.sh round_trips_postgres scope"]
fn round_trips_postgres_http_intake_expired_and_remaining_budget() {
    intake(false, false, Duration::from_millis(150));
    intake(false, false, Duration::from_millis(45));
}
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh round_trips_postgres scope"]
fn round_trips_postgres_http_intake_aged_group() {
    intake(true, false, Duration::from_millis(150));
}
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh round_trips_postgres scope"]
fn round_trips_postgres_http_intake_aged_named_fallback() {
    intake(true, true, Duration::from_millis(150));
}
