//! Generation refusals at real ingress, execution and handoff boundaries.
use super::*;
const GENERATION_SOURCE: &str = "use identity\nuse personas alice\nquery count(value: int):\n  return value\nmutation change(n: int):\n  return n\n";
fn host(pg: bool) -> (Host, ReaderTestDirectory, String) {
    let dir = ReaderTestDirectory::new();
    let namespace = format!("sb4_rt3b_generation_{:x}", snapback4_core::ids::seed());
    let store = if pg {
        #[cfg(feature = "postgres")]
        { snapback4_core::store_port::AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &namespace).unwrap() }
        #[cfg(not(feature = "postgres"))]
        { unreachable!() }
    } else { snapback4_core::store_port::AnyStore::open(&dir.0.join("generation.sqlite")).unwrap() };
    (Host::with_store(true, store, GENERATION_SOURCE), dir, namespace)
}
fn adopt(shared: &Shared, source: String) {
    shared.engine.call(move |engine, shared| {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let (generation, _) = adoption::adopt_candidate(shared, engine, &bound, || panic!("unexpected reopen")).unwrap();
        lock(&shared.readers).replace(engine, &bound.refusal_sites);
        *lock(&shared.bound) = bound;
        *lock(&shared.generation) = generation;
    }).unwrap();
}
pub(super) fn generation_reply(reply: &str) {
    refused(reply, "E_GENERATION");
    assert_eq!(status(reply), 503, "{reply}");
    assert_eq!(body(reply)["denied"]["retryable"], true, "{reply}");
    assert!(reply.to_ascii_lowercase().contains("retry-after: 1\r\n"), "{reply}");
    no_store_metadata(reply);
    assert!(!reply.to_ascii_lowercase().contains("x-snapback-dev-reset:"), "{reply}");
    for field in ["seq", "tables", "preserved", "ephemeral"] { assert!(body(reply).get(field).is_none(), "{reply}"); }
}
fn foreign(pg: bool, door: &str) {
    let (host, dir, namespace) = host(pg);
    let session = identity::open_session(lock(&host.shared.engine).store(), "guest:gen", "guest", host.shared.now()).unwrap();
    let store = if pg {
        #[cfg(feature = "postgres")]
        { snapback4_core::store_port::AnyStore::open_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &namespace).unwrap() }
        #[cfg(not(feature = "postgres"))]
        { unreachable!() }
    } else { snapback4_core::store_port::AnyStore::open(&dir.0.join("generation.sqlite")).unwrap() };
    let mut foreign = Engine::open_at(store, host.shared.now()).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), GENERATION_SOURCE.replace("return value", "return value + 1"))]);
    foreign.adopt(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let persona = door.starts_with("persona");
    let headers = if persona { "x-snapback-persona: alice\r\n".into() } else { headers(&session) };
    let query = door.ends_with("query");
    let payload = if query { json!({"args":{"value":7}}) } else if door.ends_with("keyed") && !door.ends_with("unkeyed") { json!({"id":"gen-write", "args":{"n":1}}) } else { json!({"args":{"n":1}}) };
    // A second request also refuses: a foreign activation never repairs this host.
    for _ in 0..2 { generation_reply(&host.request("POST", if query {"/q/count"} else {"/m/change"}, &headers, &payload.to_string())); }
    assert_eq!(foreign.seq().unwrap(), 0, "no write or receipt committed");
}
fn cap(pg: bool, bearer: bool) {
    let (host, _dir, _) = host(pg);
    *lock(&host.shared.dev_reset_store) = Some("unobserved-reset-store".into());
    let session = identity::open_session(lock(&host.shared.engine).store(), "guest:gen", "guest", host.shared.now()).unwrap();
    let observed = Arc::new(AtomicUsize::new(0)); let visits = observed.clone();
    let weak = Arc::downgrade(&host.shared);
    *lock(&host.shared.query_wait) = Some(Arc::new(move || {
        let n = visits.fetch_add(1, Ordering::AcqRel) + 1;
        adopt(&weak.upgrade().unwrap(), GENERATION_SOURCE.replace("return value", &format!("return value + {n}")));
    }));
    let reply = host.request("POST", "/q/count", &if bearer {headers(&session)} else {"x-snapback-persona: alice\r\n".into()}, r#"{"args":{"value":7}}"#);
    *lock(&host.shared.query_wait) = None;
    assert_eq!(observed.load(Ordering::Acquire), 3, "exactly two handoffs");
    generation_reply(&reply);
    assert_eq!(body(&host.request("POST", "/q/count", &headers(&session), r#"{"args":{"value":7}}"#))["data"], 10);
}
fn argument_handoff(pg: bool) {
    let (host, _dir, _) = host(pg);
    let visits = AtomicUsize::new(0);
    let restore = Arc::new(std::sync::atomic::AtomicBool::new(false)); let pending = restore.clone();
    let weak = Arc::downgrade(&host.shared);
    *lock(&host.shared.query_wait) = Some(Arc::new(move || {
        if visits.fetch_add(1, Ordering::AcqRel) == 0 {
            adopt(&weak.upgrade().unwrap(), GENERATION_SOURCE.replace("value: int", "value: text <=20"));
        } else { pending.store(true, Ordering::Release); }
    }));
    let weak = Arc::downgrade(&host.shared);
    *lock(&host.shared.reader_open) = Some(Arc::new(move || {
        if restore.swap(false, Ordering::AcqRel) { adopt(&weak.upgrade().unwrap(), GENERATION_SOURCE.into()); }
    }));
    let reply = host.request("POST", "/q/count", "x-snapback-persona: alice\r\n", r#"{"args":{"value":7}}"#);
    *lock(&host.shared.query_wait) = None; *lock(&host.shared.reader_open) = None;
    generation_reply(&reply);
    assert_eq!(body(&host.request("POST", "/q/count", "x-snapback-persona: alice\r\n", r#"{"args":{"value":7}}"#))["data"], 7);
}
macro_rules! witness {
    ($sqlite:ident, $postgres:ident, $run:expr) => {
        #[test] fn $sqlite() { ($run)(false); }
        #[cfg(feature = "postgres")] #[test] #[ignore = "requires private Postgres; scripts/test-postgres.sh"]
        fn $postgres() { ($run)(true); }
    };
}
witness!(rt3b_generation_bearer_query_sqlite, rt3b_generation_bearer_query_postgres, |pg| foreign(pg, "bearer-query"));
witness!(rt3b_generation_persona_query_sqlite, rt3b_generation_persona_query_postgres, |pg| foreign(pg, "persona-query"));
witness!(rt3b_generation_bearer_keyed_sqlite, rt3b_generation_bearer_keyed_postgres, |pg| foreign(pg, "bearer-keyed"));
witness!(rt3b_generation_bearer_unkeyed_sqlite, rt3b_generation_bearer_unkeyed_postgres, |pg| foreign(pg, "bearer-unkeyed"));
witness!(rt3b_generation_persona_keyed_sqlite, rt3b_generation_persona_keyed_postgres, |pg| foreign(pg, "persona-keyed"));
witness!(rt3b_generation_persona_unkeyed_sqlite, rt3b_generation_persona_unkeyed_postgres, |pg| foreign(pg, "persona-unkeyed"));
witness!(rt3b_generation_cap_bearer_sqlite, rt3b_generation_cap_bearer_postgres, |pg| cap(pg, true));
witness!(rt3b_generation_cap_persona_sqlite, rt3b_generation_cap_persona_postgres, |pg| cap(pg, false));
witness!(rt3b_generation_argument_handoff_sqlite, rt3b_generation_argument_handoff_postgres, argument_handoff);
