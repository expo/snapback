use super::*;

#[test]
fn failed_candidate_clears_pending_names_and_allows_a_later_adoption() {
    let dir = ReaderTestDirectory::new();
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("failure.db")).unwrap(), reads::SOURCE);
    let persona = "x-snapback-persona: alice\r\n";
    assert_eq!(body(&host.request("POST", "/m/add", persona, r#"{"args":{"id":"before"}}"#))["state"], "sent");
    let old_generation = *lock(&host.shared.generation);
    let old_seq = lock(&host.shared.engine).seq().unwrap();
    let candidate = snapback4_lang::compile(&[("schema.q".into(),format!("{}{}",reads::SOURCE,reads::VIEWS))]);
    let (entered, waiting) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    let shared = host.shared.clone();
    let failed = thread::spawn(move || {
        let mut engine = lock(&shared.engine);
        let once = std::sync::atomic::AtomicBool::new(false);
        engine.store().conn().authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
            if matches!(ctx.action,rusqlite::hooks::AuthAction::Insert {table_name:"i"}) && !once.swap(true,Ordering::SeqCst) {
                entered.send(()).unwrap();
                resumed.recv_timeout(Duration::from_secs(10)).unwrap();
                return rusqlite::hooks::Authorization::Deny;
            }
            rusqlite::hooks::Authorization::Allow
        })).unwrap();
        let error = adoption::adopt_candidate(&shared, &mut engine, &candidate, || panic!("not a generation refusal")).unwrap_err();
        engine.store().conn().authorizer(None::<fn(rusqlite::hooks::AuthContext<'_>)->rusqlite::hooks::Authorization>).unwrap();
        error
    });
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    let pending = body(&host.request("POST", "/q/total", persona, "{}"));
    assert_eq!(pending["loading"],true);
    assert_eq!(pending["complete"],false);
    assert_eq!(body(&host.request("POST", "/q/who", persona, "{}"))["data"],"dev:alice");
    resume.send(()).unwrap();
    assert!(failed.join().unwrap().to_string().contains("authorized"));
    assert_eq!(*lock(&host.shared.generation),old_generation);
    assert_eq!(lock(&host.shared.engine).seq().unwrap(),old_seq);
    assert_eq!(body(&host.request("POST", "/q/item", persona, r#"{"args":{"id":"before"}}"#))["data"]["n"],1);
    let rejected = body(&host.request("POST", "/q/total", persona, "{}"));
    assert_eq!(rejected["denied"]["code"],"E_OP","{rejected}");
    assert!(rejected.get("loading").is_none(),"{rejected}");
    let candidate = snapback4_lang::compile(&[("schema.q".into(),format!("{}{}",reads::SOURCE,reads::VIEWS))]);
    {
        let mut engine = lock(&host.shared.engine);
        lock(&host.shared.readers).begin_adoption(&candidate);
        let next = engine.adopt(candidate.schema.clone(),candidate.programs.iter().map(|p|p.program.clone())).unwrap();
        lock(&host.shared.readers).replace(&engine);
        *lock(&host.shared.bound) = candidate;
        *lock(&host.shared.generation) = next;
    }
    let complete = body(&host.request("POST", "/q/total", persona, "{}"));
    assert_eq!(complete["data"],1,"{complete}");
    assert_eq!(complete["complete"],true);
}
