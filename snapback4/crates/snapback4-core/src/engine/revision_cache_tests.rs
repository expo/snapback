use super::*;
use crate::engine::postgres::{WriteMode, tests::read_closure::engine_with_message_count};
use crate::{
    Context, RuntimeError, Value,
    identity::{self, SessionScope},
    round_trips::Scope,
};
use std::collections::BTreeMap;

fn fixture(pg: bool) -> (Engine, String, String) {
    engine_with_message_count(pg, false, false, 25)
}
fn args(name: &str) -> BTreeMap<String, Value> {
    match name {
        "W1" => [("message".into(), Value::Id("m0000-0".into()))].into(),
        "W2" => [("room".into(), Value::Id("r'\\\né".into()))].into(),
        _ => BTreeMap::new(),
    }
}
fn read(
    e: &mut Engine,
    digest: &str,
    viewer: &str,
    name: &str,
    enabled: bool,
    scope: SessionScope,
    now: i64,
) -> Result<QueryOutcome, Refusal> {
    let context = Context::new(viewer, args(name))
        .at(now)
        .with_request_credential("account")
        .with_revision_cache(enabled);
    let manifest = if scope == SessionScope::Read {
        DeliveryManifest::Skip
    } else {
        DeliveryManifest::Build
    };
    let generation = e.generation();
    let (result, cut, current) = e.query_materialized_search_with_request(
        name,
        context,
        None,
        manifest,
        digest,
        |snapshot, seq| {
            let fresh = snapshot
                .request_authority(
                    digest,
                    identity::ServiceSample {
                        now,
                        supervisor_revision: 0,
                    },
                )
                .map_err(|e| e.refusal())?;
            if fresh.capability != Some((viewer.to_owned(), "account".into(), scope)) {
                return Err(
                    RuntimeError::Auth("fresh request capability changed".into()).refusal(),
                );
            }
            assert_eq!(fresh.head, seq);
            assert_eq!(
                snapshot
                    .result_cache_facts()
                    .unwrap()
                    .backend_generation
                    .unwrap_or(generation as i64),
                generation as i64
            );
            Ok(())
        },
    );
    assert!(current.is_none());
    if let Ok(out) = &result {
        assert_eq!(cut, Some(out.seq));
    }
    result
}
fn warm(e: &mut Engine, d: &str, v: &str, name: &str, scope: SessionScope) -> QueryOutcome {
    let mut last = None;
    for _ in 0..4 {
        last = Some(read(e, d, v, name, true, scope, 1000).unwrap());
    }
    last.unwrap()
}
fn revision(e: &mut Engine) -> (i64, u64) {
    let store = e.store_mut().test_postgres_handle_mut().store.get_mut();
    let tx = store.transaction(None).unwrap();
    let row = tx
        .query("SELECT revision,seq FROM _head WHERE singleton", &[])
        .unwrap()
        .remove(0);
    let r = (row.get(0), row.get::<_, i64>(1) as u64);
    tx.rollback().unwrap();
    r
}
fn sql(e: &mut Engine, source: &'static str, params: &[&(dyn postgres::types::ToSql + Sync)]) {
    let tx = e
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    tx.execute(source, params).unwrap();
    tx.commit().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn g5_wire_meter_metadata_parity_and_one_flight() {
    let (mut pg, d, v) = fixture(true);
    let (mut sqlite, sd, sv) = fixture(false);
    let full = identity::open_session(pg.store(), &v, "account", 1000).unwrap();
    let sfull = identity::open_session(sqlite.store(), &sv, "account", 1000).unwrap();
    let ro = identity::narrow_session(pg.store_mut(), &full.token, || identity::ServiceSample {
        now: 1000,
        supervisor_revision: 0,
    })
    .unwrap();
    let sro = identity::narrow_session(sqlite.store_mut(), &sfull.token, || {
        identity::ServiceSample {
            now: 1000,
            supervisor_revision: 0,
        }
    })
    .unwrap();
    let mut reader = pg.reader().unwrap();
    for (scope, d, sd) in [
        (SessionScope::Full, d, sd),
        (
            SessionScope::Read,
            identity::session_digest(&ro.token),
            identity::session_digest(&sro.token),
        ),
    ] {
        for name in ["W1", "W2", "W3"] {
            let miss = read(&mut reader, &d, &v, name, false, scope, 1000).unwrap();
            assert_eq!(
                miss,
                read(&mut sqlite, &sd, &sv, name, true, scope, 1000).unwrap(),
                "SQLite {name} {scope:?}"
            );
            // Two ordinary observations admit the entry. This is its first
            // validation statement, so cold PREPARE cannot hide outside RT0.
            for _ in 0..2 {
                read(&mut reader, &d, &v, name, true, scope, 1000).unwrap();
            }
            let before = reader.revision_cache_stats();
            let trips = Scope::begin();
            let hit = read(&mut reader, &d, &v, name, true, scope, 1001).unwrap();
            let counts = trips.counts();
            drop(trips);
            assert_eq!(
                hit, miss,
                "complete outcome, cursor, delivery and logical meters: {name}"
            );
            assert_eq!(counts.postgres, 1, "warm {name}: {counts:?}");
            assert_eq!(
                reader.revision_cache_stats().hits,
                before.hits + 1,
                "{name} must actually reuse"
            );
            assert_eq!(reader.revision_cache_stats().misses, before.misses);
            eprintln!(
                "G5 {scope:?} {name}: hit=1 flight; logical meter={:?}",
                hit.metered
            );
            if scope == SessionScope::Read {
                assert!(hit.delivery.is_none() && hit.delivery_meter.is_none());
            }
            // Exercise serialized outcomes and the separate provenance mask,
            // whose source identity is intentionally absent from Value equality.
            let provenance = |e: &mut Engine, digest: &str, viewer: &str, enabled| {
                let store_id = e.store_id.clone();
                let context = Context::new(viewer, args(name))
                    .at(1000)
                    .with_request_credential("account")
                    .with_revision_cache(enabled)
                    .with_row_provenance();
                let manifest = if scope == SessionScope::Read {
                    DeliveryManifest::Skip
                } else {
                    DeliveryManifest::Build
                };
                e.query_materialized_search_with_request(
                    name,
                    context,
                    None,
                    manifest,
                    digest,
                    |snapshot, head| {
                        let facts = snapshot
                            .request_authority(
                                digest,
                                identity::ServiceSample {
                                    now: 1000,
                                    supervisor_revision: 0,
                                },
                            )
                            .map_err(|e| e.refusal())?;
                        assert_eq!(
                            facts.capability,
                            Some((viewer.to_owned(), "account".into(), scope))
                        );
                        assert_eq!(facts.store_id, store_id);
                        assert_eq!(facts.head, head);
                        Ok(())
                    },
                )
                .0
                .unwrap()
            };
            let ordinary = provenance(&mut reader, &d, &v, false);
            let sqlite = provenance(&mut sqlite, &sd, &sv, true);
            assert_eq!(
                serde_json::to_value(&ordinary).unwrap(),
                serde_json::to_value(&sqlite).unwrap()
            );
            assert_eq!(
                ordinary.data.retained_rows_mask(),
                sqlite.data.retained_rows_mask()
            );
            for _ in 0..2 {
                provenance(&mut reader, &d, &v, true);
            }
            let before = reader.revision_cache_stats().hits;
            let reused = provenance(&mut reader, &d, &v, true);
            assert_eq!(reader.revision_cache_stats().hits, before + 1);
            assert_eq!(
                serde_json::to_value(&ordinary).unwrap(),
                serde_json::to_value(&reused).unwrap()
            );
            assert_eq!(
                ordinary.data.retained_rows_mask(),
                reused.data.retained_rows_mask()
            );
        }
    }
    assert_eq!(
        sqlite.revision_cache_stats().hits,
        0,
        "SQLite explicitly bypasses"
    );
}

#[test]
#[ignore = "private PG16"]
fn g5_all_member_kinds_and_solo_family_commits_invalidate_without_public_seq() {
    use crate::engine::committer::{Committer, Kind, Member};
    let (mut writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    for kind in [Kind::Program, Kind::Engine, Kind::Publication, Kind::Direct] {
        warm(&mut reader, &d, &v, "W1", SessionScope::Full);
        let before = revision(&mut writer);
        let stats = reader.revision_cache_stats();
        Committer::run(writer.store_mut(), Member::new(kind, |tx| tx.complete(()))).unwrap();
        assert_eq!(revision(&mut writer), (before.0 + 1, before.1), "{kind:?}");
        read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
        assert_eq!(
            reader.revision_cache_stats().mismatches,
            stats.mismatches + 1,
            "{kind:?}"
        );
    }
    // One physical group counts only completed members. Its private revision
    // changes become visible with its receipts, never at a savepoint release.
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let before = revision(&mut writer);
    let stats = reader.revision_cache_stats();
    {
        let tx = writer
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .transaction(Some(WriteMode::Serialized))
            .unwrap();
        tx.enable_group_tail().unwrap();
        for (id, complete) in [
            ("g5-group-a", true),
            ("g5-group-aborted", false),
            ("g5-group-b", true),
        ] {
            tx.savepoint("member").unwrap();
            tx.execute(
                "INSERT INTO _ops(principal,id,seq,outcome,at) VALUES ('receipt',$1,0,'{}',1000)",
                &[&id],
            )
            .unwrap();
            if complete {
                tx.release("member").unwrap();
            } else {
                tx.rollback_to("member").unwrap();
            }
        }
        assert_eq!(
            revision(&mut reader),
            before,
            "member release is not physical publication"
        );
        tx.commit().unwrap();
    }
    assert_eq!(
        revision(&mut writer),
        (before.0 + 2, before.1),
        "two completed receipt members, one rolled back"
    );
    read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
    assert_eq!(
        reader.revision_cache_stats().mismatches,
        stats.mismatches + 1
    );
    {
        let tx = writer
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .transaction(None)
            .unwrap();
        assert_eq!(
            tx.query("SELECT id FROM _ops WHERE id='g5-group-aborted'", &[])
                .unwrap()
                .len(),
            0
        );
        tx.rollback().unwrap();
    }
    // These family writes deliberately publish no application seq. All use
    // the solo fenced transaction path, independent of a particular SQL family.
    for (family, statement) in [
        (
            "receipt-only",
            "INSERT INTO _ops(principal,id,seq,outcome,at) VALUES ('receipt','g5',0,'{}',1000)",
        ),
        (
            "worker marker",
            "INSERT INTO _meta(key,value) VALUES ('worker:status','g5') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        ),
        (
            "worker family",
            "INSERT INTO _meta(key,value) VALUES ('worker:family:g5','1') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        ),
        (
            "claim admission",
            "INSERT INTO _requests(id,name,args,principal,at,state) VALUES ('g5','g5','{}','other',1000,'queued')",
        ),
        (
            "claim",
            "UPDATE _requests SET state='running',lease_until=5000 WHERE id='g5'",
        ),
        (
            "clock pin",
            "INSERT INTO _meta(key,value) VALUES ('time_audience_clock','1001') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        ),
        (
            "asset",
            "INSERT INTO _assets(id,owner,kind,content_type,bytes,created_at) VALUES ('g5','other','image','image/png',1,1000)",
        ),
        (
            "asset release",
            "UPDATE _assets SET released_at=1001 WHERE id='g5'",
        ),
        (
            "principal generation",
            "INSERT INTO _principal_generations(principal,generation) VALUES ('other',1)",
        ),
    ] {
        warm(&mut reader, &d, &v, "W1", SessionScope::Full);
        let before = revision(&mut writer);
        let stats = reader.revision_cache_stats();
        sql(&mut writer, statement, &[]);
        assert_eq!(revision(&mut writer), (before.0 + 1, before.1), "{family}");
        read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
        assert_eq!(
            reader.revision_cache_stats().mismatches,
            stats.mismatches + 1,
            "{family}"
        );
    }
    for action in ["mint", "rotate", "revoke"] {
        warm(&mut reader, &d, &v, "W1", SessionScope::Full);
        let before = revision(&mut writer);
        let stats = reader.revision_cache_stats();
        let session = identity::open_session(writer.store(), "other", "account", 1000).unwrap();
        match action {
            "rotate" => {
                identity::rotate_session(writer.store(), &session.token, 1001)
                    .unwrap()
                    .unwrap();
            }
            "revoke" => identity::close_session(writer.store(), &session.token).unwrap(),
            _ => {}
        }
        assert!(revision(&mut writer).0 > before.0);
        assert_eq!(revision(&mut writer).1, before.1);
        read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
        assert_eq!(
            reader.revision_cache_stats().mismatches,
            stats.mismatches + 1,
            "{action}"
        );
    }
    // A data update must change the result, rather than merely increment a counter.
    let before = warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let mut row = before.data.clone();
    let Value::Row(fields) = &mut row else {
        panic!("row expected")
    };
    fields.insert("body".into(), Value::String("new ' \\ 雪".into()));
    sql(
        &mut writer,
        "UPDATE r SET data=$1 WHERE t='messages' AND id='m0000-0'",
        &[&crate::value::canonical_json(&row)],
    );
    let after = read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
    assert_ne!(before.data, after.data);
    assert_eq!(after.data, row);
}

#[test]
#[ignore = "private PG16"]
fn g5_fresh_authority_refuses_revocation_scope_kind_duplicates_and_expiry() {
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
        let (mut writer, _, v) = fixture(true);
        let full = identity::open_session(writer.store(), &v, "account", 1000).unwrap();
        let scope = if matches!(change, "generation" | "cap") {
            SessionScope::Read
        } else {
            SessionScope::Full
        };
        let session = if scope == SessionScope::Read {
            identity::narrow_session(writer.store_mut(), &full.token, || {
                identity::ServiceSample {
                    now: 1000,
                    supervisor_revision: 0,
                }
            })
            .unwrap()
        } else {
            full
        };
        let d = identity::session_digest(&session.token);
        let mut reader = writer.reader().unwrap();
        warm(&mut reader, &d, &v, "W1", scope);
        match change {
            "delete" => identity::close_session(writer.store(), &session.token).unwrap(),
            "expiry" => sql(
                &mut writer,
                "UPDATE _sessions SET expires_at=1000 WHERE token_digest=$1",
                &[&d],
            ),
            "kind" => sql(
                &mut writer,
                "UPDATE _sessions SET kind='action' WHERE token_digest=$1",
                &[&d],
            ),
            "scope" | "duplicate" => {
                sql(
                    &mut writer,
                    "INSERT INTO _read_sessions(token_digest,principal,kind,family,created_at,expires_at,cap_expires_at,principal_generation) SELECT token_digest,principal,kind,COALESCE(family,token_digest),created_at,expires_at,expires_at,0 FROM _sessions WHERE token_digest=$1",
                    &[&d],
                );
                if change == "scope" {
                    sql(
                        &mut writer,
                        "DELETE FROM _sessions WHERE token_digest=$1",
                        &[&d],
                    );
                }
            }
            "generation" => sql(
                &mut writer,
                "INSERT INTO _principal_generations(principal,generation) VALUES ($1,1) ON CONFLICT(principal) DO UPDATE SET generation=_principal_generations.generation+1",
                &[&v],
            ),
            "cap" => sql(
                &mut writer,
                "UPDATE _read_sessions SET cap_expires_at=1000 WHERE token_digest=$1",
                &[&d],
            ),
            "supervisor" => {
                sql(
                    &mut writer,
                    "INSERT INTO _meta(key,value) VALUES ('worker:session-family',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                    &[&d],
                );
                sql(
                    &mut writer,
                    "INSERT INTO _meta(key,value) VALUES ('worker:session-revision','1') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                    &[],
                );
            }
            "worker-family" => sql(
                &mut writer,
                "INSERT INTO _meta(key,value) VALUES ($1,'1') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                &[&format!("worker:family:{d}")],
            ),
            _ => unreachable!(),
        }
        let result = read(&mut reader, &d, &v, "W1", true, scope, 1000);
        assert!(result.is_err(), "{change} reused: {result:?}");
        let ordinary = read(&mut reader, &d, &v, "W1", false, scope, 1000);
        assert_eq!(result, ordinary, "{change} refusal parity");
    }
    let (mut writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let rev = revision(&mut writer);
    let expires = writer
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one(
            "SELECT expires_at FROM _sessions WHERE token_digest=$1",
            &[&d],
        )
        .unwrap()
        .get::<_, i64>(0);
    assert!(read(&mut reader, &d, &v, "W1", true, SessionScope::Full, expires).is_err());
    assert_eq!(
        revision(&mut writer),
        rev,
        "wall-clock expiry requires no commit"
    );
}

#[test]
#[ignore = "private PG16"]
fn g5_nul_and_encoding_keep_ordinary_results_and_pre_sql_refusal() {
    let (writer, d, v) = engine_with_message_count(true, true, true, 25);
    let mut reader = writer.reader().unwrap();
    let ordinary = read(&mut reader, &d, &v, "W1", false, SessionScope::Full, 1000).unwrap();
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    assert_eq!(
        ordinary,
        read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap()
    );
    assert!(crate::value::canonical_json(&ordinary.data).contains("\\u0000"));
    let calls = Scope::begin();
    assert!(
        read(
            &mut reader,
            "bad\0digest",
            &v,
            "W1",
            true,
            SessionScope::Full,
            1000
        )
        .is_err()
    );
    assert_eq!(calls.counts().postgres, 0);
}

fn synthetic() -> QueryOutcome {
    serde_json::from_value(serde_json::json!({"data":{"Int":1},"seq":0,"complete":true,"unavailable":false,"cut":null,"metered":crate::meter::Metered::default(),"tables":[]})).unwrap()
}
fn stamp() -> Stamp {
    Stamp {
        revision: 1,
        head: 0,
        store: "store".into(),
        generation: 1,
        schema: "schema".into(),
        code: "code".into(),
    }
}

#[test]
fn g5_memory_bounds_eviction_one_shot_admission_and_retained_responses() {
    let cache = Arc::new(Cache::new(Limits {
        bytes: 128 << 10,
        entries: 2,
        per_principal: 1,
        fills: 1,
        entry_bytes: 32 << 10,
    }));
    let budget = cache.budget.clone();
    let (candidate, admit) = cache.lookup([1; 32]);
    assert!(candidate.is_none() && !admit);
    assert!(
        cache.lookup([1; 32]).1,
        "only the second observation admits a fill"
    );
    let a = cache.fill([1; 32]).unwrap();
    assert!(cache.fill([2; 32]).is_none(), "in-flight fill cap");
    let fill_response = a.install([1; 32], [1; 32], stamp(), &synthetic(), Default::default(), None);
    assert!(cache.fill([1; 32]).is_none(), "per-principal admission cap");
    let held = cache.lookup([1; 32]).0.unwrap();
    let mut response = held.outcome.clone();
    response.cache_lifetime = held.lifetime.clone();
    cache
        .fill([2; 32])
        .unwrap()
        .install([2; 32], [2; 32], stamp(), &synthetic(), Default::default(), None);
    for key in 3..20 {
        assert!(cache.lookup([key; 32]).0.is_none());
    }
    assert_eq!(
        cache.stats().entries,
        2,
        "one-shot traffic cannot evict payloads"
    );
    cache
        .fill([3; 32])
        .unwrap()
        .install([3; 32], [3; 32], stamp(), &synthetic(), Default::default(), None);
    assert_eq!(cache.stats().entries, 2);
    assert_eq!(cache.stats().evictions, 1);
    assert!(!cache.state.lock().unwrap().entries.contains_key(&[1; 32]));
    let retained = budget.used.load(Ordering::Acquire);
    drop(held);
    assert_eq!(
        budget.used.load(Ordering::Acquire),
        retained,
        "response owns the evicted payload reservation"
    );
    drop(cache);
    assert!(
        budget.used.load(Ordering::Acquire) > 0,
        "response survives directory eviction/drop"
    );
    drop(response);
    assert!(
        budget.used.load(Ordering::Acquire) > 0,
        "fill response owns its original shared image too"
    );
    drop(fill_response);
    assert_eq!(budget.used.load(Ordering::Acquire), 0);
}

#[test]
fn g5_oversize_and_process_budget_bypass_without_partial_entries() {
    let cache = Arc::new(Cache::new(Limits {
        bytes: 64 << 10,
        entries: 2,
        per_principal: 2,
        fills: 1,
        entry_bytes: 8 << 10,
    }));
    cache.lookup([1; 32]);
    cache.lookup([1; 32]);
    let mut out = synthetic();
    out.data = Value::String("x".repeat(9000));
    cache
        .fill([1; 32])
        .unwrap()
        .install([1; 32], [1; 32], stamp(), &out, Default::default(), None);
    assert_eq!(cache.stats().entries, 0);
    assert_eq!(cache.stats().fills, 0);
    let mut small = synthetic();
    let mut fields = crate::value::ObjectFields::default();
    fields.set_source(&"t".repeat(9000), &"i".repeat(9000));
    small.data = Value::Row(fields);
    cache
        .fill([1; 32])
        .unwrap()
        .install([2; 32], [1; 32], stamp(), &small, Default::default(), None);
    assert_eq!(
        cache.stats().entries,
        0,
        "small wire values cannot hide oversized provenance backing"
    );
    let impossible = Arc::new(Budget {
        used: AtomicUsize::new(0),
        fills: AtomicUsize::new(0),
        limit: usize::MAX,
    });
    assert!(impossible.reserve(PROCESS_BYTES + 1).is_none());
    assert_eq!(impossible.used.load(Ordering::Acquire), 0);
    assert!(PROCESS_USED.load(Ordering::Acquire) <= PROCESS_BYTES);
}

#[test]
#[ignore = "private PG16"]
fn g5_fill_keeps_its_snapshot_revision_across_a_commit_in_authority_callback() {
    let (mut writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    let old = read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap(); // probation
    let mut edited = old.data.clone();
    let Value::Row(fields) = &mut edited else {
        panic!("row expected")
    };
    fields.insert("body".into(), Value::String("after coherent fill".into()));
    let encoded = crate::value::canonical_json(&edited);
    let before = revision(&mut writer);
    let (filled, _, _) = reader.query_materialized_search_with_request(
        "W1",
        Context::new(&v, args("W1"))
            .at(1000)
            .with_request_credential("account")
            .with_revision_cache(true),
        None,
        DeliveryManifest::Build,
        &d,
        |snapshot, _| {
            assert!(
                snapshot
                    .request_authority(
                        &d,
                        identity::ServiceSample {
                            now: 1000,
                            supervisor_revision: 0
                        }
                    )
                    .unwrap()
                    .capability
                    .is_some()
            );
            sql(
                &mut writer,
                "UPDATE r SET data=$1 WHERE t='messages' AND id='m0000-0'",
                &[&encoded],
            );
            Ok(())
        },
    );
    assert_eq!(
        filled.unwrap(),
        old,
        "interpreter reads the original coherent statement facts"
    );
    assert_eq!(revision(&mut writer).0, before.0 + 1);
    let stats = reader.revision_cache_stats();
    assert_eq!(stats.entries, 1, "the old result was actually filled");
    let fresh = read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
    assert_eq!(
        fresh.data, edited,
        "a fresh unrelated head must not relabel old bytes"
    );
    assert_ne!(fresh.data, old.data);
    assert_eq!(
        reader.revision_cache_stats().mismatches,
        stats.mismatches + 1
    );
}

#[test]
#[ignore = "private PG16"]
fn g5_administrative_activation_and_foreign_takeover_cannot_reuse_old_state() {
    use crate::store_port::{AnyStore, LeasePolicy, StoreLease};
    let (mut writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let old = revision(&mut writer);
    let namespace: String = writer
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut reopened = Engine::new_at(
        AnyStore::open_postgres(&connection, &namespace).unwrap(),
        writer.schema().clone(),
        writer.programs.values().cloned(),
        1000,
    )
    .unwrap();
    assert_eq!(reopened.generation(), writer.generation());
    assert!(revision(&mut reopened).0 > old.0);
    let stats = reader.revision_cache_stats();
    read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000).unwrap();
    assert_eq!(
        reader.revision_cache_stats().mismatches,
        stats.mismatches + 1
    );
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let id = writer.store_id.clone();
    let mut lease = StoreLease::connect(
        &connection,
        &namespace,
        &id,
        "7777",
        LeasePolicy {
            lease: std::time::Duration::from_secs(30),
            ..LeasePolicy::default()
        },
    )
    .unwrap();
    // Record the exact private namespace's backend identities before the product
    // takeover protocol terminates obsolete, tagged connections.
    let recorded=writer.store_mut().test_postgres_handle_mut().store.get_mut().client.query("SELECT pid,backend_start::text FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE $1",&[&format!("%{id}%")]).unwrap();
    for row in recorded {
        eprintln!(
            "G5 takeover owned backend PID {} start {}",
            row.get::<_, i32>(0),
            row.get::<_, String>(1)
        );
    }
    assert!(lease.acquire().unwrap().is_some());
    let mut winner = Engine::open_at(
        AnyStore::open_postgres_owned(&connection, &namespace, &lease).unwrap(),
        1000,
    )
    .unwrap();
    let before_renew = revision(&mut winner);
    assert!(lease.renew().unwrap());
    assert_eq!(
        revision(&mut winner),
        before_renew,
        "ownership-lease traffic is explicitly outside the application revision stream"
    );
    sql(
        &mut winner,
        "DELETE FROM _sessions WHERE token_digest=$1",
        &[&d],
    );
    let result = read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000);
    assert!(
        result.is_err(),
        "old owner reused a revoked answer after takeover: {result:?}"
    );
    assert!(lease.release().unwrap());
}

#[test]
#[ignore = "private PG16"]
fn g5_maintains_and_generation_changes_invalidate_the_complete_answer() {
    let (mut writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    let before = warm(&mut reader, &d, &v, "W3", SessionScope::Full);
    let r = revision(&mut writer);
    writer
        .mutate(
            "post",
            None,
            Context::new(
                &v,
                [
                    ("room".into(), Value::Id("r'\\\né".into())),
                    ("body".into(), Value::String("new maintained source".into())),
                ]
                .into(),
            )
            .at(1001),
        )
        .unwrap();
    let after = read(&mut reader, &d, &v, "W3", true, SessionScope::Full, 1001).unwrap();
    assert_ne!(before.data, after.data);
    assert!(revision(&mut writer).0 > r.0);
    assert_eq!(
        after,
        read(&mut reader, &d, &v, "W3", false, SessionScope::Full, 1001).unwrap()
    );
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let namespace: String = writer
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let mut programs = writer.programs.clone();
    programs.get_mut("W1").unwrap().body = vec![crate::ir::Stmt::Return(crate::ir::Expr::Literal(
        Value::Int(7),
    ))];
    let replacement = Engine::new_at(
        crate::store_port::AnyStore::open_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &namespace,
        )
        .unwrap(),
        writer.schema().clone(),
        programs.into_values(),
        1002,
    )
    .unwrap();
    assert!(replacement.generation() > reader.generation());
    let denied = read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1002).unwrap_err();
    assert_eq!(denied.code, "E_GENERATION");
}

#[test]
#[ignore = "private PG16"]
fn g5_expiry_time_presence_exclusions_and_unadmitted_publication() {
    let source = "use identity\ntable timed:\n  opens: time ?\n  until: time ?\n  value: int\n  not before .opens\n  expire at .until\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\nquery timedRead():\n  return timed first 10\nquery clockRead():\n  return now\nquery presenceRead():\n  return connected[viewer]\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let rejected: crate::Schema =
        serde_json::from_value(serde_json::to_value(&b.schema).unwrap()).unwrap();
    assert!(
        matches!(
            super::super::postgres::profile::admit(&rejected, &BTreeMap::new()),
            Err(RuntimeError::StoreUnsupported {
                family: "time-publication"
            })
        ),
        "the existing PG public profile refuses timed publication before writes"
    );
    let b = snapback4_lang::compile(&[(
        "schema.q".into(),
        source.replace("  not before .opens\n", ""),
    )]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = b
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let mut writer = Engine::new_at(
        crate::store_port::AnyStore::create_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &format!("g5_time_{:x}", crate::ids::seed()),
        )
        .unwrap(),
        schema,
        programs,
        1000,
    )
    .unwrap();
    writer
        .seed_at(
            [(
                "timed".into(),
                crate::value::object([
                    ("id", Value::Id("x".into())),
                    ("opens", Value::Int(2000)),
                    ("until", Value::Int(3000)),
                    ("value", Value::Int(1)),
                ]),
            )],
            1000,
        )
        .unwrap();
    let token = identity::open_session(writer.store(), "alice", "account", 1000).unwrap();
    let d = identity::session_digest(&token.token);
    let mut reader = writer.reader().unwrap();
    for name in ["timedRead", "clockRead", "presenceRead"] {
        for _ in 0..4 {
            read(
                &mut reader,
                &d,
                "alice",
                name,
                true,
                SessionScope::Full,
                1000,
            )
            .unwrap();
        }
        assert_eq!(
            reader.revision_cache_stats().entries,
            0,
            "{name} is ineligible"
        );
    }
    assert_eq!(
        read(
            &mut reader,
            &d,
            "alice",
            "clockRead",
            true,
            SessionScope::Full,
            1001
        )
        .unwrap()
        .data,
        Value::Int(1001)
    );
    let published = revision(&mut writer);
    assert_eq!(writer.sweep_expired(3000, 100).unwrap(), 1);
    let expired = revision(&mut writer);
    assert!(
        expired.0 > published.0 && expired.1 > published.1,
        "physical expiry is versioned"
    );
    assert!(
        read(
            &mut reader,
            &d,
            "alice",
            "timedRead",
            true,
            SessionScope::Full,
            3000
        )
        .unwrap()
        .data
        .as_array()
        .unwrap()
        .is_empty()
    );
    assert_eq!(reader.revision_cache_stats().hits, 0);

    // A separate admitted schema has no lifetime anywhere: the durable control
    // really hits while clock, presence and ephemeral reads independently bypass.
    let source = source
        .replace("  not before .opens\n", "")
        .replace("  expire at .until\n", "")
        + "\ntable pulses:\n  owner: principal\n  value: int\n  unique owner\n  cap 1 by owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  delete <- .owner = viewer\n  ephemeral 4s\nmutation pulse():\n  upsert pulses[viewer] { value: 1 }\nquery ephemeralRead():\n  return pulses[viewer]\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = b
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let mut writer = Engine::new_at(
        crate::store_port::AnyStore::create_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &format!("g5_pure_{:x}", crate::ids::seed()),
        )
        .unwrap(),
        schema,
        programs,
        1000,
    )
    .unwrap();
    let token = identity::open_session(writer.store(), "alice", "account", 1000).unwrap();
    let d = identity::session_digest(&token.token);
    let mut reader = writer.reader().unwrap();
    warm(&mut reader, &d, "alice", "timedRead", SessionScope::Full);
    let control = reader.revision_cache_stats().hits;
    assert!(control > 0);
    for name in ["clockRead", "presenceRead", "ephemeralRead"] {
        warm(&mut reader, &d, "alice", name, SessionScope::Full);
        assert_eq!(
            reader.revision_cache_stats().hits,
            control,
            "{name} must bypass beside a working durable cache"
        );
    }
    assert_eq!(
        read(
            &mut reader,
            &d,
            "alice",
            "clockRead",
            true,
            SessionScope::Full,
            1001
        )
        .unwrap()
        .data,
        Value::Int(1001)
    );
    writer
        .mutate(
            "pulse",
            None,
            Context::new("alice", BTreeMap::new()).at(1001),
        )
        .unwrap();
    assert_ne!(
        read(
            &mut reader,
            &d,
            "alice",
            "ephemeralRead",
            true,
            SessionScope::Full,
            1001
        )
        .unwrap()
        .data,
        Value::Null
    );
}

#[test]
#[ignore = "private PG16"]
fn g5_keys_separate_args_viewers_credentials_scope_policy_and_provenance() {
    let (mut e, d, v) = fixture(true);
    let base = Context::new(&v, args("W1"))
        .with_request_credential("account")
        .with_revision_cache(true);
    let key = e
        .cache_key("W1", &mut base.clone(), None, DeliveryManifest::Build, &d)
        .unwrap()
        .0;
    let mut changed = base.clone();
    changed
        .args
        .insert("message".into(), Value::Id("m0000-1".into()));
    assert_ne!(
        e.cache_key("W1", &mut changed, None, DeliveryManifest::Build, &d)
            .unwrap()
            .0,
        key
    );
    let mut changed = base.clone();
    changed.viewer = "another".into();
    assert_ne!(
        e.cache_key("W1", &mut changed, None, DeliveryManifest::Build, &d)
            .unwrap()
            .0,
        key
    );
    assert_ne!(
        e.cache_key(
            "W1",
            &mut base.clone(),
            None,
            DeliveryManifest::Build,
            "another-digest"
        )
        .unwrap()
        .0,
        key
    );
    assert_ne!(
        e.cache_key("W1", &mut base.clone(), None, DeliveryManifest::Skip, &d)
            .unwrap()
            .0,
        key
    );
    assert_ne!(
        e.cache_key(
            "W1",
            &mut base.clone().with_row_provenance(),
            None,
            DeliveryManifest::Build,
            &d
        )
        .unwrap()
        .0,
        key
    );
    e.ceilings.output_bytes -= 1;
    assert_ne!(
        e.cache_key("W1", &mut base.clone(), None, DeliveryManifest::Build, &d)
            .unwrap()
            .0,
        key
    );
    // A structured core input can carry source/delivery backing absent from its
    // serde identity. JSON arguments remain legal, but are outside this cache.
    let mut structured = base.clone();
    let row = Value::Row([("value".into(), Value::Int(1))].into_iter().collect());
    e.programs
        .get_mut("W1")
        .unwrap()
        .args
        .insert("extra".into(), crate::ir::ArgType::Json { max_bytes: 4096 });
    structured.args.insert("extra".into(), row);
    super::super::validate::validate_inputs(e.schema(), &e.programs["W1"], &mut structured.args)
        .unwrap();
    assert!(
        e.cache_key("W1", &structured, None, DeliveryManifest::Build, &d)
            .is_none()
    );
    e.programs.get_mut("W1").unwrap().args.remove("extra");
    let mut custom = base.clone().with_request_credential("custom");
    assert!(
        e.cache_key("W1", &mut custom, None, DeliveryManifest::Build, &d)
            .is_none()
    );
    assert!(
        e.cache_key(
            "W1",
            &mut base.clone(),
            Some(&[]),
            DeliveryManifest::Build,
            &d
        )
        .is_none()
    );
}

#[test]
#[ignore = "private PG16"]
fn g5_validation_encoding_guard_precedes_cached_result_and_fact_decoding() {
    let (writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let before = reader.revision_cache_stats().hits;
    reader
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .batch_execute("SET client_encoding='SQL_ASCII'")
        .unwrap();
    let result = read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000);
    reader
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .batch_execute("SET client_encoding='UTF8'")
        .unwrap();
    assert!(result.is_err(), "a drifted reader reused bytes: {result:?}");
    assert_eq!(reader.revision_cache_stats().hits, before);
}

#[test]
#[ignore = "private PG16"]
fn g5_alias_ambiguity_preserves_the_ordinary_authorized_refusal() {
    let (mut writer, d, v) = fixture(true);
    let namespace: String = writer
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let mut programs = writer.programs.clone();
    programs
        .get_mut("W1")
        .unwrap()
        .arg_aliases
        .insert("legacy".into(), "message".into());
    let schema = writer.schema().clone();
    let mut e = Engine::new_at(
        crate::store_port::AnyStore::open_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &namespace,
        )
        .unwrap(),
        schema,
        programs.into_values(),
        1000,
    )
    .unwrap()
    .reader()
    .unwrap();
    let attempt = |e: &mut Engine, enabled| {
        let context = Context::new(
            &v,
            [
                ("message".into(), Value::Id("m0000-0".into())),
                ("legacy".into(), Value::Id("m0000-1".into())),
            ]
            .into(),
        )
        .at(1000)
        .with_request_credential("account")
        .with_revision_cache(enabled);
        e.query_materialized_search_with_request(
            "W1",
            context,
            None,
            DeliveryManifest::Build,
            &d,
            |snap, _| {
                assert!(
                    snap.request_authority(
                        &d,
                        identity::ServiceSample {
                            now: 1000,
                            supervisor_revision: 0
                        }
                    )
                    .unwrap()
                    .capability
                    .is_some()
                );
                Ok(())
            },
        )
        .0
    };
    let ordinary = attempt(&mut e, false);
    assert!(ordinary.is_err());
    assert_eq!(
        attempt(&mut e, true),
        ordinary,
        "key planning must leave refused inputs untouched"
    );
}

#[test]
#[ignore = "private PG16"]
fn g5_deployed_native_marker_and_local_activation_keep_a_working_code_identity() {
    let (mut writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    for (i, marker) in [
        "",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ]
    .into_iter()
    .enumerate()
    {
        let schema = writer.schema().clone();
        let programs: Vec<_> = writer.programs.values().cloned().collect();
        let options = crate::engine::release::ReleaseActivation {
            native_digest: Some(marker.into()),
            ..crate::engine::release::ReleaseActivation::new(
                i as u64 + 1,
                if i == 0 { None } else { Some(i as u64) },
            )
        };
        writer
            .adopt_release_at(schema, programs, &options, true, 1001)
            .unwrap();
        let mut reader = writer.reader().unwrap();
        let before = reader.revision_cache_stats().hits;
        warm(&mut reader, &d, &v, "W1", SessionScope::Full);
        assert!(
            reader.revision_cache_stats().hits > before,
            "a deployed native marker must bind the reader's actual code identity"
        );
    }
    let schema = writer.schema().clone();
    let mut programs = writer.programs.clone();
    programs
        .get_mut("W1")
        .unwrap()
        .arg_aliases
        .insert("legacy".into(), "message".into());
    writer
        .adopt_at(schema, programs.into_values(), 1002)
        .unwrap();
    let mut reader = writer.reader().unwrap();
    warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    assert!(
        reader.revision_cache_stats().hits > 0,
        "ordinary local adoption must retire the old code epoch too"
    );
}

#[test]
#[ignore = "private PG16"]
fn g5_failed_revision_update_cannot_commit_unversioned_solo_data() {
    let (mut writer, d, v) = fixture(true);
    let mut reader = writer.reader().unwrap();
    let before = warm(&mut reader, &d, &v, "W1", SessionScope::Full);
    let rev = revision(&mut writer);
    // Test-only schema corruption: suppress only revision updates. The real
    // durable family transaction must fail before it can commit application data.
    writer.store_mut().test_postgres_handle_mut().store.get_mut().client.batch_execute(
        "CREATE FUNCTION g5_skip_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER g5_skip_revision BEFORE UPDATE ON _head FOR EACH ROW WHEN (NEW.revision IS DISTINCT FROM OLD.revision) EXECUTE FUNCTION g5_skip_revision()"
    ).unwrap();
    let mut changed = before.data.clone();
    let Value::Row(fields) = &mut changed else {
        panic!("row expected")
    };
    fields.insert("body".into(), Value::String("must roll back".into()));
    let image = crate::value::canonical_json(&changed);
    let result = {
        let tx = writer
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .transaction(Some(WriteMode::Serialized))
            .unwrap();
        tx.execute(
            "UPDATE r SET data=$1 WHERE t='messages' AND id='m0000-0'",
            &[&image],
        )
        .unwrap();
        tx.commit()
    };
    assert!(
        result.is_err(),
        "a missing revision update was acknowledged"
    );
    assert_eq!(revision(&mut writer), rev);
    assert_eq!(
        read(&mut reader, &d, &v, "W1", false, SessionScope::Full, 1000)
            .unwrap()
            .data,
        before.data,
        "an error after COMMIT is too late to protect revision equality"
    );
    let hits = reader.revision_cache_stats().hits;
    assert_eq!(
        read(&mut reader, &d, &v, "W1", true, SessionScope::Full, 1000)
            .unwrap()
            .data,
        before.data
    );
    assert_eq!(
        reader.revision_cache_stats().hits,
        hits + 1,
        "rollback leaves the earlier revision valid"
    );
}

#[path="revision_cache_grant_tests.rs"]
mod grant;

#[test]
fn sqlite_owned_g5_fills_hits_invalidates_data_and_rechecks_revocation() {
    let source = "use identity\ntable counters:\n  n: int\n  public\n  insert <- allow\n  update <- allow\nquery W1(message: counters):\n  return counters[message] ! else NOT_FOUND\nmutation bump(message: counters):\n  old = counters[message] ! else NOT_FOUND\n  update counters[message] { n: old.n + 1 }\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: crate::Schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = b.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    let dir = std::env::temp_dir().join(format!("sqw-g5-{}-{:x}", std::process::id(), crate::ids::seed()));
    std::fs::create_dir(&dir).unwrap();
    let mut store = crate::store::Store::open(&dir.join("store.sqlite")).unwrap();
    let owner = crate::private_fs::owner_file(&dir.join("store.sqlite")).unwrap();
    let identity = { use std::os::unix::fs::MetadataExt; let m = std::fs::metadata(dir.join("store.sqlite")).unwrap(); (m.dev(), m.ino()) };
    owner.try_lock().unwrap(); store.retain_exclusive_ownership(std::sync::Arc::new(owner), identity).unwrap();
    let mut writer = Engine::new_at(store, schema, programs, 1000).unwrap();
    writer.seed_at([("counters".into(), crate::value::object([("id", Value::Id("m0000-0".into())), ("n", Value::Int(0))]))], 1000).unwrap();
    let session = identity::open_session(writer.store(), "alice", "account", 1000).unwrap();
    let digest = identity::session_digest(&session.token);
    let mut reader = writer.reader().unwrap();
    let before = warm(&mut reader, &digest, "alice", "W1", SessionScope::Full);
    assert!(reader.revision_cache_stats().hits > 0);
    assert!(reader.revision_cache_stats().sqlite_hits > 0);
    assert!(read(&mut reader, &digest, "alice", "W1", true, SessionScope::Full, session.expires_at).is_err());
    writer.mutate("bump", None, Context::new("alice", args("W1")).at(1000)).unwrap();
    let after = read(&mut reader, &digest, "alice", "W1", true, SessionScope::Full, 1000).unwrap();
    assert_ne!(before.data, after.data);
    assert_eq!(after, read(&mut reader, &digest, "alice", "W1", false, SessionScope::Full, 1000).unwrap());
    warm(&mut reader, &digest, "alice", "W1", SessionScope::Full);
    let hits = reader.revision_cache_stats().hits;
    identity::close_session(writer.store(), &session.token).unwrap();
    assert!(read(&mut reader, &digest, "alice", "W1", true, SessionScope::Full, 1000).is_err());
    assert_eq!(hits, reader.revision_cache_stats().hits);
    drop((reader, writer)); std::fs::remove_dir_all(dir).unwrap();
}
