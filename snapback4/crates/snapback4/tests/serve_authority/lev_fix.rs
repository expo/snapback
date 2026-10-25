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
        assert_eq!(status(&reply), 401, "preserve cold-ingress store replacement refusal: {reply}");
        assert_eq!(f.count(), 0, "an unkeyed request without store_id must not write the replacement store");
    }
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
#[test] fn rt3b_lev_custom_durable_sqlite() { custom_kind(false, false); }
#[test] fn rt3b_lev_custom_ephemeral_sqlite() { custom_kind(false, true); }
#[test] fn rt3b_lev_retired_observation_sqlite() { retired_observation(false); }
#[test] fn rt3b_lev_ownership_sqlite() { ownership(false); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_store_binding_postgres() { store_binding(true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_custom_durable_postgres() { custom_kind(true, false); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_custom_ephemeral_postgres() { custom_kind(true, true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_retired_observation_postgres() { retired_observation(true); }
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn rt3b_lev_ownership_postgres() { ownership(true); }
