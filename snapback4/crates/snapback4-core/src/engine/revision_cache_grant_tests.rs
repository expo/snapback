//! G6 witnesses use real owned PostgreSQL stores. G5 remains the no-grant oracle.
// @ref LLP 3000.009.001.000.002#4.2 — every grant failure returns to database validation; foreign writers honor persisted expiry.
use super::*;
use crate::store_port::{AnyStore, LeasePolicy, ReadClockBounds, StoreLease};
use std::{sync::mpsc, time::Duration};

fn owned(duration: Duration) -> (Engine, String, String, StoreLease, postgres::Client) {
    let (mut bootstrap, d, v) = fixture(true);
    let ns: String = bootstrap
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let id = bootstrap.store_id.clone();
    drop(bootstrap);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut control = postgres::Client::connect(&url, postgres::NoTls).unwrap();
    control
        .batch_execute(&format!("SET search_path=\"{ns}\",pg_catalog"))
        .unwrap();
    let mut lease = StoreLease::connect(
        &url,
        &ns,
        &id,
        "6666",
        LeasePolicy {
            lease: duration,
            ..Default::default()
        },
    )
    .unwrap();
    record(&mut control);
    assert!(lease.acquire().unwrap().is_some());
    lease
        .enable_read_grant(ReadClockBounds {
            rate_ppm: 1000,
            forward_jump: Duration::from_millis(10),
        })
        .unwrap();
    let engine = Engine::open_at(
        AnyStore::open_postgres_owned(&url, &ns, &lease).unwrap(),
        1000,
    )
    .unwrap();
    (engine, d, v, lease, control)
}
fn record(c: &mut postgres::Client) {
    for row in c.query("SELECT pid,backend_start::text FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'sb:%'",&[]).unwrap() {
        eprintln!("G6 owned backend PID {} start {}",row.get::<_,i32>(0),row.get::<_,String>(1));
    }
}
fn fixture_owned() -> (Engine, String, String, StoreLease, postgres::Client) {
    owned(Duration::from_secs(30))
}
fn actual_hit(r: &mut Engine, d: &str, v: &str, name: &str, scope: SessionScope) -> QueryOutcome {
    let out = warm(r, d, v, name, scope);
    let before = r.revision_cache_stats();
    let trips = Scope::begin();
    let next = read(r, d, v, name, true, scope, 1001).unwrap();
    assert_eq!(
        trips.counts().postgres,
        0,
        "G6 must use zero flights including first use"
    );
    drop(trips);
    assert_eq!(r.revision_cache_stats().g6_hits, before.g6_hits + 1);
    assert_eq!(out, next);
    next
}

#[test]
#[ignore = "private PG16"]
fn g6_zero_flights_wire_meters_identity_and_first_hit() {
    let (mut writer, d, v, mut lease, _) = fixture_owned();
    let (mut sqlite, sd, sv) = fixture(false);
    let full = identity::open_session(writer.store(), &v, "account", 1000).unwrap();
    let sf = identity::open_session(sqlite.store(), &sv, "account", 1000).unwrap();
    let ro = identity::narrow_session(writer.store_mut(), &full.token, || {
        identity::ServiceSample {
            now: 1000,
            supervisor_revision: 0,
        }
    })
    .unwrap();
    let sr = identity::narrow_session(sqlite.store_mut(), &sf.token, || identity::ServiceSample {
        now: 1000,
        supervisor_revision: 0,
    })
    .unwrap();
    let mut r = writer.reader().unwrap();
    for (scope, d, sd) in [
        (SessionScope::Full, d, sd),
        (
            SessionScope::Read,
            identity::session_digest(&ro.token),
            identity::session_digest(&sr.token),
        ),
    ] {
        for name in ["W1", "W2", "W3"] {
            let miss = read(&mut r, &d, &v, name, false, scope, 1000).unwrap();
            assert_eq!(
                miss,
                read(&mut sqlite, &sd, &sv, name, true, scope, 1000).unwrap()
            );
            for _ in 0..2 {
                read(&mut r, &d, &v, name, true, scope, 1000).unwrap();
            }
            let before = r.revision_cache_stats();
            let trips = Scope::begin();
            let hit = read(&mut r, &d, &v, name, true, scope, 1001).unwrap();
            assert_eq!(trips.counts().postgres, 0, "first G6 {name} {scope:?}");
            drop(trips);
            assert_eq!(r.revision_cache_stats().g6_hits, before.g6_hits + 1);
            assert_eq!(
                hit, miss,
                "full outcome, meter, cursor and metadata at this head"
            );
            assert!(hit.cache_lifetime.encoded_data().is_some());
            assert_eq!(
                serde_json::to_vec(&crate::wire::QueryData(&hit)).unwrap(),
                serde_json::to_vec(&crate::wire::Plain(&miss.data)).unwrap()
            );
        }
    }
    assert!(lease.release().unwrap());
}

#[test]
#[ignore = "private PG16"]
fn g6_revision_authority_changes_refuse_after_real_hits() {
    for change in [
        "delete",
        "expiry",
        "kind",
        "scope",
        "duplicate",
        "generation",
        "cap",
        "supervisor",
        "worker-family",
    ] {
        let (mut w, _, v, mut lease, _) = fixture_owned();
        let full = identity::open_session(w.store(), &v, "account", 1000).unwrap();
        let scope = if matches!(change, "generation" | "cap") {
            SessionScope::Read
        } else {
            SessionScope::Full
        };
        let session = if scope == SessionScope::Read {
            identity::narrow_session(w.store_mut(), &full.token, || identity::ServiceSample {
                now: 1000,
                supervisor_revision: 0,
            })
            .unwrap()
        } else {
            full
        };
        let d = identity::session_digest(&session.token);
        let mut r = w.reader().unwrap();
        actual_hit(&mut r, &d, &v, "W1", scope);
        let before = r.revision_cache_stats().g6_hits;
        match change {
            "delete" => identity::close_session(w.store(), &session.token).unwrap(),
            "expiry" => sql(
                &mut w,
                "UPDATE _sessions SET expires_at=1000 WHERE token_digest=$1",
                &[&d],
            ),
            "kind" => sql(
                &mut w,
                "UPDATE _sessions SET kind='action' WHERE token_digest=$1",
                &[&d],
            ),
            "scope" | "duplicate" => {
                sql(
                    &mut w,
                    "INSERT INTO _read_sessions(token_digest,principal,kind,family,created_at,expires_at,cap_expires_at,principal_generation) SELECT token_digest,principal,kind,COALESCE(family,token_digest),created_at,expires_at,expires_at,0 FROM _sessions WHERE token_digest=$1",
                    &[&d],
                );
                if change == "scope" {
                    sql(&mut w, "DELETE FROM _sessions WHERE token_digest=$1", &[&d]);
                }
            }
            "generation" => sql(
                &mut w,
                "INSERT INTO _principal_generations(principal,generation) VALUES($1,1) ON CONFLICT(principal) DO UPDATE SET generation=_principal_generations.generation+1",
                &[&v],
            ),
            "cap" => sql(
                &mut w,
                "UPDATE _read_sessions SET cap_expires_at=1000 WHERE token_digest=$1",
                &[&d],
            ),
            "supervisor" => {
                sql(
                    &mut w,
                    "INSERT INTO _meta(key,value) VALUES('worker:session-family',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                    &[&d],
                );
                sql(
                    &mut w,
                    "INSERT INTO _meta(key,value) VALUES('worker:session-revision','1') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                    &[],
                );
            }
            "worker-family" => sql(
                &mut w,
                "INSERT INTO _meta(key,value) VALUES($1,'1') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                &[&format!("worker:family:{d}")],
            ),
            _ => unreachable!(),
        }
        let cached = read(&mut r, &d, &v, "W1", true, scope, 1000);
        assert!(
            cached.is_err(),
            "{change} reused stale authority: {cached:?}"
        );
        assert_eq!(cached, read(&mut r, &d, &v, "W1", false, scope, 1000));
        assert_eq!(r.revision_cache_stats().g6_hits, before, "{change}");
        assert!(lease.release().unwrap());
    }
}

#[test]
#[ignore = "private PG16"]
fn g6_fresh_clock_expiry_without_any_revision_change() {
    let (mut w, d, v, mut lease, mut c) = fixture_owned();
    let mut r = w.reader().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    let before = revision(&mut w);
    let expires: i64 = c
        .query_one(
            "SELECT expires_at FROM _sessions WHERE token_digest=$1",
            &[&d],
        )
        .unwrap()
        .get(0);
    let trips = Scope::begin();
    let result = read(&mut r, &d, &v, "W1", true, SessionScope::Full, expires);
    assert!(result.is_err());
    assert_eq!(trips.counts().postgres, 0);
    drop(trips);
    assert_eq!(revision(&mut w), before);
    let full = identity::open_session(w.store(), &v, "account", 1000).unwrap();
    let ro = identity::narrow_session(w.store_mut(), &full.token, || identity::ServiceSample {
        now: 1000,
        supervisor_revision: 0,
    })
    .unwrap();
    let d = identity::session_digest(&ro.token);
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Read);
    let cap: i64 = c
        .query_one(
            "SELECT cap_expires_at FROM _read_sessions WHERE token_digest=$1",
            &[&d],
        )
        .unwrap()
        .get(0);
    assert!(read(&mut r, &d, &v, "W1", true, SessionScope::Read, cap).is_err());
    lease.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_every_local_commit_misses_without_cross_revision_promotion() {
    for change in [
        "receipt-only",
        "family",
        "activation",
        "generation",
        "store",
    ] {
        let (mut w, d, v, mut lease, _) = fixture_owned();
        let mut r = w.reader().unwrap();
        actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
        let before = r.revision_cache_stats();
        match change {
            "receipt-only" => sql(
                &mut w,
                "UPDATE _meta SET value=value WHERE key='generation'",
                &[],
            ),
            "family" => sql(
                &mut w,
                "INSERT INTO _meta(key,value) VALUES('g6:unrelated','1') ON CONFLICT(key) DO UPDATE SET value='1'",
                &[],
            ),
            "activation" => sql(
                &mut w,
                "UPDATE _meta SET value=value||'changed' WHERE key='activation_hash'",
                &[],
            ),
            "generation" => sql(
                &mut w,
                "UPDATE _backend SET generation=generation+1 WHERE singleton",
                &[],
            ),
            "store" => sql(
                &mut w,
                "UPDATE _meta SET value='11111111111111111111111111111111' WHERE key='store_id'",
                &[],
            ),
            _ => unreachable!(),
        }
        let result = read(&mut r, &d, &v, "W1", true, SessionScope::Full, 1000);
        assert_eq!(r.revision_cache_stats().g6_hits, before.g6_hits, "{change}");
        assert_eq!(
            result,
            read(&mut r, &d, &v, "W1", false, SessionScope::Full, 1000)
        );
        lease.release().unwrap();
    }
}

fn standby(c: &mut postgres::Client, lease: &StoreLease, duration: Duration) -> StoreLease {
    let ns: String = c.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    StoreLease::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        &ns,
        lease.store_id(),
        "7777",
        LeasePolicy {
            lease: duration,
            ..Default::default()
        },
    )
    .unwrap()
}
#[test]
#[ignore = "private PG16"]
fn g6_short_writer_lease_cannot_shorten_read_grant_or_serve_after_takeover() {
    let (w, d, v, mut lease, mut c) = owned(Duration::from_secs(3));
    let mut r = w.reader().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    c.batch_execute("UPDATE _owner SET lease_until='-infinity'")
        .unwrap();
    let mut next = standby(&mut c, &lease, Duration::from_secs(30));
    record(&mut c);
    assert!(
        next.acquire().unwrap().is_none(),
        "claim cannot act before persisted grant expiry"
    );
    std::thread::sleep(Duration::from_millis(3100));
    let before = r.revision_cache_stats().g6_hits;
    let trips = Scope::begin();
    read(&mut r, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
    assert_eq!(trips.counts().postgres, 1, "expired grant falls back to G5");
    drop(trips);
    assert_eq!(r.revision_cache_stats().g6_hits, before);
    record(&mut c);
    assert!(next.acquire().unwrap().is_some());
    let ns: String = c.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let mut winner = Engine::open_at(
        AnyStore::open_postgres_owned(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &ns,
            &next,
        )
        .unwrap(),
        1000,
    )
    .unwrap();
    sql(
        &mut winner,
        "DELETE FROM _sessions WHERE token_digest=$1",
        &[&d],
    );
    assert!(read(&mut r, &d, &v, "W1", true, SessionScope::Full, 1000).is_err());
    assert_eq!(r.revision_cache_stats().g6_hits, before);
    assert!(!lease.renew().unwrap_or(false));
    next.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_renewal_wins_between_poll_and_conditional_claim() {
    let (w, d, v, lease, mut c) = owned(Duration::from_secs(2));
    let mut r = w.reader().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    c.batch_execute("UPDATE _owner SET lease_until='-infinity'")
        .unwrap();
    let mut next = standby(&mut c, &lease, Duration::from_secs(30));
    let (send, receive) = mpsc::channel();
    crate::engine::postgres::ownership::test_hooks::set(
        crate::engine::postgres::ownership::test_hooks::Point::AfterPoll,
        move || {
            let mut lease = lease;
            assert!(lease.renew().unwrap());
            send.send(lease).unwrap();
        },
    );
    record(&mut c);
    assert!(next.acquire().unwrap().is_none());
    let mut lease = receive.recv().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    lease.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_unknown_commit_keeps_gate_closed_and_pauses_writer_admission() {
    let (mut w, d, v, mut lease, mut c) = fixture_owned();
    let mut r = w.reader().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    c.batch_execute("CREATE FUNCTION g6_unknown() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE WARNING 'test unknown commit' USING ERRCODE='57014'; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER g6_unknown AFTER UPDATE ON _head DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION g6_unknown()").unwrap();
    let tx = w
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    tx.execute("DELETE FROM _sessions WHERE token_digest=$1", &[&d])
        .unwrap();
    assert!(matches!(
        tx.commit(),
        Err(RuntimeError::CommitOutcomeUnknown(_))
    ));
    let stats = r.revision_cache_stats();
    assert!(stats.gate.uncertain);
    assert!(
        c.query_opt(
            "SELECT token_digest FROM _sessions WHERE token_digest=$1",
            &[&d]
        )
        .unwrap()
        .is_none(),
        "COMMIT actually became durable"
    );
    assert!(read(&mut r, &d, &v, "W1", true, SessionScope::Full, 1000).is_err());
    assert_eq!(
        r.revision_cache_stats().hits,
        stats.hits,
        "no cache hit after unknown COMMIT"
    );
    assert!(
        w.store_mut().transaction().is_err(),
        "no new writer transaction admitted"
    );
    let q = crate::engine::command::Queue::start(w, 8).unwrap();
    assert!(matches!(
        q.submit(crate::engine::command::Command::new(|_| ())),
        Err(crate::engine::command::SubmitError::OwnershipLost)
    ));
    drop(q);
    lease.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_real_commit_stalls_hit_until_publication_and_records_gate_cost() {
    let (mut w, d, v, mut lease, mut c) = fixture_owned();
    let mut r = w.reader().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    let before = r.revision_cache_stats();
    let key = (crate::ids::seed() & i64::MAX as u64) as i64;
    c.query_one("SELECT pg_advisory_lock($1)", &[&key]).unwrap();
    c.batch_execute(&format!("CREATE FUNCTION g6_stall() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock({key}); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER g6_stall AFTER UPDATE ON _head DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION g6_stall()")).unwrap();
    let writer = std::thread::spawn(move || {
        sql(
            &mut w,
            "UPDATE _meta SET value=value WHERE key='generation'",
            &[],
        );
        w
    });
    let start = std::time::Instant::now();
    loop {
        if c.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND pid<>pg_backend_pid())",&[]).unwrap().get::<_,bool>(0){break;}
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(5));
    }
    let (send, receive) = mpsc::channel();
    let (rd, rv) = (d.clone(), v.clone());
    let hit = std::thread::spawn(move || {
        let result = read(&mut r, &rd, &rv, "W1", true, SessionScope::Full, 1001);
        send.send((r, result)).unwrap();
    });
    assert!(
        receive.recv_timeout(Duration::from_millis(70)).is_err(),
        "CPU hit crossed durable commit/install gap"
    );
    c.query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
    let (mut r, result) = receive.recv_timeout(Duration::from_secs(5)).unwrap();
    hit.join().unwrap();
    let mut w = writer.join().unwrap();
    result.unwrap();
    let stats = r.revision_cache_stats();
    assert_eq!(stats.g6_hits, before.g6_hits);
    assert!(stats.gate.closed_ns > 50_000_000);
    assert!(stats.gate.hit_stall_ns > 50_000_000);
    assert!(stats.gate.hit_waits > 0);
    assert_eq!(
        read(&mut r, &d, &v, "W1", false, SessionScope::Full, 1000)
            .unwrap()
            .seq,
        revision(&mut w).1
    );
    lease.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_late_or_ambiguous_renewal_cannot_reopen_epoch() {
    let (w, d, v, mut lease, mut c) = owned(Duration::from_secs(3));
    let mut r = w.reader().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    c.batch_execute("CREATE FUNCTION g6_late() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(3.1); RETURN NEW; END $$; CREATE TRIGGER g6_late BEFORE UPDATE ON _read_grant FOR EACH ROW EXECUTE FUNCTION g6_late()").unwrap();
    assert!(lease.renew().unwrap());
    assert!(lease.read_grant.revoked.load(Ordering::Acquire));
    c.batch_execute("DROP TRIGGER g6_late ON _read_grant")
        .unwrap();
    assert!(lease.renew().unwrap());
    let before = r.revision_cache_stats().g6_hits;
    let trips = Scope::begin();
    read(&mut r, &d, &v, "W1", true, SessionScope::Full, 1001).unwrap();
    assert_eq!(trips.counts().postgres, 1);
    drop(trips);
    assert_eq!(r.revision_cache_stats().g6_hits, before);
    lease.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_real_maintain_and_code_activation_publish_identity_head() {
    let (mut w, d, v, mut lease, _) = fixture_owned();
    let mut r = w.reader().unwrap();
    let old = actual_hit(&mut r, &d, &v, "W3", SessionScope::Full);
    let before = r.revision_cache_stats().g6_hits;
    w.mutate(
        "post",
        None,
        Context::new(
            &v,
            [
                ("room".into(), Value::Id("r'\\\né".into())),
                ("body".into(), Value::String("g6 maintained source".into())),
            ]
            .into(),
        )
        .at(1001),
    )
    .unwrap();
    let new = read(&mut r, &d, &v, "W3", true, SessionScope::Full, 1001).unwrap();
    assert_ne!(new.data, old.data);
    assert!(new.seq > old.seq);
    assert_eq!(
        new,
        read(&mut r, &d, &v, "W3", false, SessionScope::Full, 1001).unwrap()
    );
    assert_eq!(r.revision_cache_stats().g6_hits, before);
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    let mut programs = w.programs.clone();
    programs.get_mut("W1").unwrap().body = vec![crate::ir::Stmt::Return(crate::ir::Expr::Literal(
        Value::Int(7),
    ))];
    let ns: String = w
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let replacement = Engine::new_at(
        AnyStore::open_postgres_owned(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &ns,
            &lease,
        )
        .unwrap(),
        w.schema().clone(),
        programs.into_values(),
        1002,
    )
    .unwrap();
    assert!(replacement.generation() > r.generation());
    let before = r.revision_cache_stats().g6_hits;
    assert_eq!(
        read(&mut r, &d, &v, "W1", true, SessionScope::Full, 1002)
            .unwrap_err()
            .code,
        "E_GENERATION"
    );
    assert_eq!(r.revision_cache_stats().g6_hits, before);
    lease.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_known_commit_abort_reopens_only_the_old_publication() {
    let (mut w, d, v, mut lease, mut c) = fixture_owned();
    let mut r = w.reader().unwrap();
    let old = actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    c.batch_execute("CREATE FUNCTION g6_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'known rollback' USING ERRCODE='23514'; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER g6_abort AFTER UPDATE ON _head DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION g6_abort()").unwrap();
    let tx = w
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    tx.execute("DELETE FROM _sessions WHERE token_digest=$1", &[&d])
        .unwrap();
    assert!(
        matches!(tx.commit(),Err(RuntimeError::Postgres(e)) if e.code()==Some(&postgres::error::SqlState::CHECK_VIOLATION))
    );
    assert!(!r.revision_cache_stats().gate.uncertain);
    assert_eq!(actual_hit(&mut r, &d, &v, "W1", SessionScope::Full), old);
    lease.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_release_drains_reads_before_shortening_the_persisted_epoch() {
    let (w, d, v, mut lease, mut c) = fixture_owned();
    let mut r = w.reader().unwrap();
    actual_hit(&mut r, &d, &v, "W1", SessionScope::Full);
    let mut next = standby(&mut c, &lease, Duration::from_secs(30));
    let (entered, inside) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let (rd, rv) = (d.clone(), v.clone());
    let reader = std::thread::spawn(move || {
        let context = Context::new(&rv, args("W1"))
            .at(1001)
            .with_request_credential("account")
            .with_revision_cache(true);
        r.query_materialized_search_with_request(
            "W1",
            context,
            None,
            DeliveryManifest::Build,
            &rd,
            |snapshot, _| {
                entered.send(()).unwrap();
                blocked.recv().unwrap();
                // Release may have revoked the grant while this callback was parked.
                // The final synchronous check must then use G5 with fresh facts.
                let a = snapshot
                    .request_authority(
                        &rd,
                        identity::ServiceSample {
                            now: 1001,
                            supervisor_revision: 0,
                        },
                    )
                    .unwrap();
                assert!(a.capability.is_some());
                Ok(())
            },
        )
        .0
    });
    inside.recv_timeout(Duration::from_secs(5)).unwrap();
    let releaser = std::thread::spawn(move || {
        let result = lease.release();
        done.send(result).unwrap();
    });
    assert!(finished.recv_timeout(Duration::from_millis(60)).is_err());
    assert!(
        c.query_one(
            "SELECT valid_until>clock_timestamp() FROM _read_grant WHERE singleton",
            &[]
        )
        .unwrap()
        .get::<_, bool>(0)
    );
    record(&mut c);
    assert!(next.acquire().unwrap().is_none());
    // Callback can run a second time on the deliberate ordinary fallback.
    release.send(()).unwrap();
    release.send(()).unwrap();
    reader.join().unwrap().unwrap();
    assert!(
        finished
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap()
    );
    releaser.join().unwrap();
    record(&mut c);
    assert!(next.acquire().unwrap().is_some());
    next.release().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g6_enable_after_opening_an_owned_handle_refuses() {
    let (mut bootstrap, _, _) = fixture(true);
    let ns: String = bootstrap
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let id = bootstrap.store_id.clone();
    drop(bootstrap);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut lease = StoreLease::connect(
        &url,
        &ns,
        &id,
        "6666",
        LeasePolicy {
            lease: Duration::from_secs(30),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(lease.acquire().unwrap().is_some());
    let handle = AnyStore::open_postgres_owned(&url, &ns, &lease).unwrap();
    assert!(
        lease
            .enable_read_grant(ReadClockBounds {
                rate_ppm: 1000,
                forward_jump: Duration::from_millis(10)
            })
            .is_err(),
        "an already-open writer could have captured an ungated COMMIT"
    );
    drop(handle);
    lease.release().unwrap();
}

#[test]
fn g6_preencoding_bounds_escaped_data_by_the_reserved_bytes() {
    let data = Value::String("\0".repeat(2000));
    assert!(
        encode_data(&data, 10_000).is_none(),
        "JSON escaping must fit before retention"
    );
    let encoded = encode_data(&data, 13_000).unwrap();
    assert_eq!(encoded.get().len(), 12_002);
    assert_eq!(
        encoded.get().as_bytes(),
        serde_json::to_vec(&crate::wire::Plain(&data)).unwrap()
    );
}

#[test] #[ignore="private PG16"]
fn g6_ordinary_miss_never_waits_for_the_commit_gate() {
    let (w,d,v,mut lease,_)=fixture_owned();let mut r=w.reader().unwrap();
    let grant=w.store().read_grant().unwrap();
    let closed=grant.state.write().unwrap();
    let before=grant.stats().hit_waits;
    read(&mut r,&d,&v,"W2",true,SessionScope::Full,1001).unwrap();
    assert_eq!(grant.stats().hit_waits,before,"an ordinary miss must use its own DB read point without a gate wait");
    drop(closed);lease.release().unwrap();
}

#[test] #[ignore="private PG16"]
fn g6_paused_reader_checks_deadline_after_foreign_revocation() {
    let (w,d,v,lease,mut c)=owned(Duration::from_secs(3));let mut r=w.reader().unwrap();
    actual_hit(&mut r,&d,&v,"W1",SessionScope::Full);let before=r.revision_cache_stats().g6_hits;
    let mut next=standby(&mut c,&lease,Duration::from_secs(30));
    // No renewal thread and NO old-owner request between the pause and the
    // successor's COMMIT: no callback can pre-revoke this local epoch for us.
    std::thread::sleep(Duration::from_millis(3100));record(&mut c);assert!(next.acquire().unwrap().is_some());
    let ns:String=c.query_one("SELECT current_schema()",&[]).unwrap().get(0);
    let mut winner=Engine::open_at(AnyStore::open_postgres_owned(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),&ns,&next).unwrap(),1000).unwrap();
    sql(&mut winner,"DELETE FROM _sessions WHERE token_digest=$1",&[&d]);
    assert!(!lease.read_grant.revoked.load(Ordering::Acquire),"the safety witness must reach the synchronous check with an unrevoked local epoch");
    assert!(read(&mut r,&d,&v,"W1",true,SessionScope::Full,1001).is_err(),"paused old owner served revoked authority after the successor committed");
    assert_eq!(r.revision_cache_stats().g6_hits,before);next.release().unwrap();
}

#[test] #[ignore="private PG16"]
fn g6_already_admitted_writer_rolls_back_if_gate_refuses_dispatch() {
    let (mut w,d,v,mut lease,mut c)=fixture_owned();let mut r=w.reader().unwrap();actual_hit(&mut r,&d,&v,"W1",SessionScope::Full);
    let grant=w.store().read_grant().unwrap();
    let tx=w.store_mut().test_postgres_handle_mut().store.get_mut().transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute("DELETE FROM _sessions WHERE token_digest=$1",&[&d]).unwrap();
    // A preceding unknown outcome can close admission after this writer began.
    grant.uncertain.store(true,Ordering::Release);
    assert!(matches!(tx.commit(),Err(RuntimeError::StoreOwnership(_))));
    let mut fence=c.transaction().unwrap();
    fence.query_one("SELECT token FROM _owner WHERE singleton FOR UPDATE NOWAIT",&[]).expect("a refusal before dispatch must ROLLBACK, not retain its first-lock fence");fence.rollback().unwrap();
    assert!(read(&mut r,&d,&v,"W1",true,SessionScope::Full,1001).is_ok());assert!(r.revision_cache_stats().gate.uncertain);
    lease.release().unwrap();
}
