//! LEV round 1: hints preserve observation boundaries and cannot strand retries.
use super::*;

fn store_binding(pg: bool) {
    let f = Fixture::new(pg); let session = f.session(false);
    assert_eq!(body(&f.host.request("POST", "/q/count", &headers(&session), "{}"))["data"], 0);
    let serving = lock(&f.host.shared.wake).store_id.clone();
    lock(&f.host.shared.engine).store_mut().test_request_store_id("replacement").unwrap();
    assert_eq!(lock(&f.host.shared.wake).store_id, serving, "fixture must leave the serving binding unchanged");
    for _ in 0..2 {
        let reply = f.host.request("POST", "/m/change", &headers(&session), r#"{"args":{"n":1}}"#);
        refused(&reply, "E_STORE_REPLACED"); no_store_metadata(&reply);
        assert_eq!(status(&reply), 409, "preserve cold-ingress store replacement refusal: {reply}");
        assert_eq!(f.count(), 0, "an unkeyed request without store_id must not write the replacement store");
    }
}

fn query_store_binding(pg: bool) {
    let f = Fixture::new(pg); let session = f.session(false);
    assert_eq!(body(&f.host.request("POST", "/q/count", &headers(&session), "{}"))["data"], 0);
    lock(&f.host.shared.engine).store_mut().test_request_store_id("replacement").unwrap();
    for _ in 0..2 {
        let reply = f.host.request("POST", "/q/count", &headers(&session), "{}");
        refused(&reply, "E_STORE_REPLACED"); no_store_metadata(&reply);
        assert_eq!(status(&reply), 409, "warm query must preserve cold-ingress status: {reply}");
    }
}

fn ephemeral_scope_retries(pg: bool) {
    let f = Fixture::new(pg); let session = f.session(false);
    adopt_ephemeral(&f, &mut lock(&f.host.shared.engine));
    assert_eq!(body(&f.host.request("POST", "/q/count", &headers(&session), "{}"))["data"], 0);
    assert_eq!(lock(&f.host.shared.carried).len(), 1);
    let before = f.host.shared.ephemeral.snapshot().unwrap().version;
    change_capability(&f, &session, "scope");
    for attempt in 0..4 {
        let reply = f.host.request("POST", "/m/change", &headers(&session), r#"{"args":{"n":1}}"#);
        assert_eq!(status(&reply), 200, "ephemeral refusal envelope: {reply}");
        refused(&reply, if attempt == 0 {"E_AUTH"} else {"E_READ_ONLY"});
        no_store_metadata(&reply);
        assert!(body(&reply).get("ephemeral").is_none(), "{reply}");
        assert_eq!(f.host.shared.ephemeral.snapshot().unwrap().version, before);
        assert_eq!(lock(&f.host.shared.wake).eph.version, before);
    }
    assert_eq!(f.count(), 0);
}

// The third mutation_wait visit is after ephemeral preflight and immediately
// before final reader checkout. Args only proves this is the unkeyed path.
fn warm_ephemeral_final(pg: bool) {
    for change in ["revoke", "scope", "kind", "unchanged"] {
        let f = Fixture::new(pg); let session = f.session(false);
        adopt_ephemeral(&f, &mut lock(&f.host.shared.engine));
        assert_eq!(body(&f.host.request("POST", "/q/count", &headers(&session), "{}"))["data"], 0);
        assert_eq!(lock(&f.host.shared.carried).len(), 1);
        let before = f.host.shared.ephemeral.snapshot().unwrap().version;
        let (gate, _release) = park(&f.host, 3);
        let address = f.host.address;
        let request = wire("/m/change", &session, &json!({"args":{"n":1}}));
        let task = thread::spawn(move || exchange_held(address, 2*WAIT_TIMEOUT, request));
        wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
        if change == "revoke" { identity::close_session(lock(&f.host.shared.engine).store(), &session.token).unwrap(); }
        else { change_capability(&f, &session, change); }
        gate.release(); let reply = task.join().unwrap();
        assert_eq!(status(&reply), 200, "{reply}");
        let after = f.host.shared.ephemeral.snapshot().unwrap().version;
        if change == "unchanged" {
            assert_eq!(body(&reply)["state"], "sent", "{reply}");
            assert_eq!(after.epoch, before.epoch + 1);
        } else {
            refused(&reply, "E_AUTH"); no_store_metadata(&reply);
            assert!(body(&reply).get("ephemeral").is_none(), "{reply}");
            assert_eq!(after, before, "{change}: stale effects reached the hub");
            assert_eq!(lock(&f.host.shared.wake).eph.version, before, "no wake publication");
        }
        assert_eq!(f.count(), 0);
    }
}

fn action_kind(pg: bool, ephemeral: bool) {
    let f = Fixture::new(pg); let session = f.session(false);
    if ephemeral { adopt_ephemeral(&f, &mut lock(&f.host.shared.engine)); }
    assert_eq!(body(&f.host.request("POST", "/q/count", &headers(&session), "{}"))["data"], 0);
    assert_eq!(lock(&f.host.shared.carried).len(), 1);
    lock(&f.host.shared.engine).store_mut().test_request_action_claim(&session.token, f.host.shared.now(), true).unwrap();
    let input = r#"{"args":{"n":1}}"#;
    let reply = f.host.request("POST", "/m/change", &headers(&session), input);
    refused(&reply, "E_AUTH"); no_store_metadata(&reply);
    let value = body(&reply);
    assert_eq!(value.get("denied").or_else(|| value.get("why")).unwrap()["retryable"], true);
    assert!(lock(&f.host.shared.carried).is_empty(), "action authority evicts the ordinary hint");
    for _ in 0..2 {
        assert_eq!(body(&f.host.request("POST", "/m/change", &headers(&session), input))["state"], "sent");
        assert!(lock(&f.host.shared.carried).is_empty());
    }
    let before = f.host.shared.ephemeral.snapshot().unwrap().version;
    // Pause after ephemeral preflight (or after cold durable discovery) and
    // invalidate the live claim before final execution resolves it again.
    let (gate, _release) = park(&f.host, 3);
    let address = f.host.address;
    let request = wire("/m/change", &session, &json!({"args":{"n":1}}));
    let task = thread::spawn(move || exchange_held(address, 2*WAIT_TIMEOUT, request));
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
    lock(&f.host.shared.engine).store_mut().test_request_action_claim(&session.token, f.host.shared.now(), false).unwrap();
    gate.release(); let reply = task.join().unwrap();
    refused(&reply, "E_AUTH"); no_store_metadata(&reply);
    assert_eq!(status(&reply), if ephemeral {200} else {401});
    assert_eq!(f.host.shared.ephemeral.snapshot().unwrap().version, before);
    assert_eq!(lock(&f.host.shared.wake).eph.version, before);
    *lock(&f.host.shared.mutation_wait) = None;
    for _ in 0..2 {
        let reply = f.host.request("POST", "/m/change", &headers(&session), input);
        refused(&reply, "E_AUTH"); no_store_metadata(&reply);
    }
    assert_eq!(f.count(), if ephemeral {0} else {2});
}

fn custom_kind(pg: bool, ephemeral: bool) {
    let f = Fixture::new(pg); let session = f.session(false);
    if ephemeral { adopt_ephemeral(&f, &mut lock(&f.host.shared.engine)); }
    assert_eq!(body(&f.host.request("POST", "/q/count", &headers(&session), "{}"))["data"], 0);
    assert_eq!(lock(&f.host.shared.carried).len(), 1);
    lock(&f.host.shared.engine).store_mut().test_request_kind(&session.token, "customer").unwrap();
    let input = r#"{"args":{"n":1}}"#;
    let reply = f.host.request("POST", "/m/change", &headers(&session), input);
    refused(&reply, "E_AUTH"); no_store_metadata(&reply);
    let value = body(&reply);
    assert_eq!(value.get("denied").or_else(|| value.get("why")).unwrap()["retryable"], true);
    for _ in 0..3 {
        let reply = f.host.request("POST", "/m/change", &headers(&session), input);
        assert_eq!(body(&reply)["state"], "sent", "unkeyed retries must discover the non-cacheable kind: {reply}");
        assert!(lock(&f.host.shared.carried).is_empty(), "custom authority must evict the old ordinary hint");
    }
    assert_eq!(f.count(), if ephemeral {0} else {3});
}

struct Bearer(Vec<Header>);
impl RequestInfo for Bearer {
    fn method(&self) -> &Method { &Method::Post }
    fn url(&self) -> &str { "/m/change" }
    fn headers(&self) -> &[Header] { &self.0 }
    fn remote_addr(&self) -> Option<&std::net::SocketAddr> { None }
}

fn retired_observation(pg: bool) {
    let f = Fixture::new(pg); let session = f.session(true);
    let request = Bearer(vec![Header::from_bytes("Authorization", format!("Bearer {}", session.token)).unwrap()]);
    let admission = session_identity::Admission::capture(&request, &f.host.shared).unwrap();
    let observed_revision = admission.sample(&f.host.shared).supervisor_revision;
    let store = lock(&f.host.shared.wake).store_id.clone().unwrap();
    let generation = *lock(&f.host.shared.generation);
    let capability = admission.resolve_detached(&f.host.shared, &lock(&f.host.shared.engine)).unwrap();
    // Resolve at R, then pause insertion until retirement has published R+1.
    f.host.shared.worker_revision.fetch_add(1, Ordering::AcqRel);
    admission.remember(&f.host.shared, &capability, &store, generation, observed_revision);
    let gate = Arc::new(WorkGate::default()); let release = ReleaseGate(gate.clone()); let hook = gate.clone();
    let shared = f.host.shared.clone();
    let held = thread::spawn(move || shared.engine.submit(move |_, _| hook.park()));
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
    let (sent, received) = mpsc::channel(); let address = f.host.address;
    let request = wire("/m/change", &session, &json!({"args":{"n":1}}));
    let task = thread::spawn(move || { let reply = exchange_held(address, 2*WAIT_TIMEOUT, request); sent.send(reply).unwrap(); });
    let immediate = received.recv_timeout(Duration::from_secs(2));
    drop(release); held.join().unwrap().unwrap(); task.join().unwrap();
    let reply = immediate.expect("a retired credential must refuse while the writer remains blocked");
    refused(&reply, "E_AUTH"); assert_eq!(status(&reply), 401); no_store_metadata(&reply);
    assert_eq!(f.count(), 0);
}

fn ownership(pg: bool) {
    for durable in [false, true] {
        if durable && !pg { continue; }
        let f = Fixture::new(pg); let session = f.session(false);
        assert_eq!(f.call(&session, &json!({"args":{"n":1}}))["state"], "sent");
        assert_eq!(lock(&f.host.shared.carried).len(), 1);
        if durable {
            #[cfg(feature="postgres")]
            lock(&f.host.shared.engine).store_mut().test_request_owner_loss().unwrap();
        } else { f.host.shared.engine.test_ownership_loss(); }
        for _ in 0..2 {
            let reply = f.host.request("POST", "/m/change", &headers(&session), r#"{"args":{"n":1}}"#);
            refused(&reply, "E_STORE_OWNERSHIP"); no_store_metadata(&reply);
        }
        assert_eq!(f.count(), 1, "a warm hint cannot bypass ownership loss");
    }
}

#[test] fn rt3b_lev_store_binding_sqlite() { store_binding(false); }
#[test] fn rt3b_lev_query_store_binding_sqlite() { query_store_binding(false); }
#[test] fn rt3b_lev_ephemeral_scope_retries_sqlite() { ephemeral_scope_retries(false); }
#[test] fn rt3b_lev_warm_ephemeral_final_sqlite() { warm_ephemeral_final(false); }
#[test] fn rt3b_lev_action_durable_sqlite() { action_kind(false, false); }
#[test] fn rt3b_lev_action_ephemeral_sqlite() { action_kind(false, true); }
#[test] fn rt3b_lev_custom_durable_sqlite() { custom_kind(false, false); }
#[test] fn rt3b_lev_custom_ephemeral_sqlite() { custom_kind(false, true); }
#[test] fn rt3b_lev_retired_observation_sqlite() { retired_observation(false); }
#[test] fn rt3b_lev_ownership_sqlite() { ownership(false); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_store_binding_postgres() { store_binding(true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_query_store_binding_postgres() { query_store_binding(true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_ephemeral_scope_retries_postgres() { ephemeral_scope_retries(true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_warm_ephemeral_final_postgres() { warm_ephemeral_final(true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_action_durable_postgres() { action_kind(true, false); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_action_ephemeral_postgres() { action_kind(true, true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_custom_durable_postgres() { custom_kind(true, false); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_custom_ephemeral_postgres() { custom_kind(true, true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_retired_observation_postgres() { retired_observation(true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_ownership_postgres() { ownership(true); }

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn rt3b_lev_pipeline_successor_warm_unkeyed_authority_postgres() {
    for change in ["scope-stale", "scope-read", "store"] {
        // Use G3b's admitted explicit point-read/update form.
        let source=SOURCE.replace("  update counters[\"c\"] { n: (counters[\"c\"].n ?? 0) + n }",
            "  c = counters[\"c\"] ! else NOT_FOUND\n  update counters[c.id] { n: c.n + n }");
        let f = Fixture::with_source(true, &source);
        let first = f.session(false);
        let successor = f.session(false);
        for session in [&first, &successor] {
            assert_eq!(body(&f.host.request("POST", "/q/count", &headers(session), "{}"))["data"], 0);
        }
        if change.starts_with("scope") {
            change_capability(&f, &successor, "scope");
            if change == "scope-read" {
                let reply = f.host.request("POST", "/m/change", &headers(&successor), r#"{"args":{"n":1}}"#);
                refused(&reply, "E_AUTH"); no_store_metadata(&reply);
                // The next batch plans from a matching Read hint. It must
                // still independently require fresh Full mutation scope.
            }
        }
        let pair = || {
            // Park collection itself so both members reach its next FIFO fill.
            let gate=Arc::new(WorkGate::default()); let release=ReleaseGate(gate.clone()); let hook=gate.clone();
            let shared=f.host.shared.clone();
            let parked=thread::spawn(move || shared.engine.submit(move |_,_|hook.park()));
            wait_until(|| gate.entered.load(Ordering::Acquire)==1);
            let mut tasks = Vec::new();
            for n in 1..=2 {
                let address=f.host.address; let request=wire("/m/change", &first, &json!({"args":{"n":1}}));
                tasks.push(thread::spawn(move || exchange_held(address, 2*WAIT_TIMEOUT, request)));
                wait_until(|| f.host.shared.engine.queued() >= n+1);
            }
            drop(release); parked.join().unwrap().unwrap(); tasks
        };
        // Initialize both real writer slots before installing the deliberate
        // foreign trigger. FF3 correctly refuses it during a fresh slot attach.
        for task in pair() { assert_eq!(body(&task.join().unwrap())["state"], "sent"); }
        let hinted=lock(&f.host.shared.carried).get(&identity::session_digest(&successor.token)).cloned().expect("successor must retain a warm ordinary hint");
        assert_eq!(hinted.1.2, if change=="scope-read" { identity::SessionScope::Read } else { identity::SessionScope::Full });
        let original = lock(&f.host.shared.wake).store_id.clone().unwrap();
        let mut hold = lock(&f.host.shared.engine).store_mut().test_request_pipeline_hold().unwrap();
        let first_tasks = pair();
        wait_until(|| hold.waiting().unwrap());
        if change == "store" { hold.replace_store_id("replacement").unwrap(); }
        // A single successor is eligible only because it has a pipeline
        // predecessor; this also witnesses the chain.is_some() admission arm.
        let (checked, observed)=mpsc::channel();
        *lock(&f.host.shared.mutation_authority_checked)=Some(Arc::new(move || { checked.send(()).unwrap(); }));
        let address=f.host.address; let request=wire("/m/change", &successor, &json!({"args":{"n":1}}));
        let successors=vec![thread::spawn(move || exchange_held(address, 2*WAIT_TIMEOUT, request))];
        let overlapped=observed.recv_timeout(WAIT_TIMEOUT).is_ok();
        let held=hold.waiting().unwrap();
        assert!(first_tasks.iter().chain(&successors).all(|t| !t.is_finished()), "no early HTTP publication");
        if change == "store" { hold.replace_store_id(&original).unwrap(); }
        hold.release().unwrap();
        for task in first_tasks { assert_eq!(body(&task.join().unwrap())["state"], "sent"); }
        for task in successors {
            let reply=task.join().unwrap();
            let (code, http) = match change { "scope-stale" => ("E_AUTH",503), "scope-read" => ("E_READ_ONLY",403), _ => ("E_STORE_REPLACED",409) };
            refused(&reply,code); no_store_metadata(&reply); assert_eq!(status(&reply),http,"{change}: {reply}");
        }
        assert!(held && (overlapped || change=="store"), "{change}: the chained successor must check fresh authority while its predecessor's COMMIT is held; stats={:?}",f.host.shared.engine.batch_stats());
        assert_eq!(f.count(),4,"{change}: successor authority must publish no write");
    }
}
