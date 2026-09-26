//! Opt-in HTTP measurement over the prepared core scale fixture.
use super::*;

#[test]
#[ignore = "requires SNAPBACK4_ADOPTION_HTTP_DB pointing at the prepared M7 fixture"]
fn scale_changes_waits_for_durable_adoption_while_query_and_sync_read() {
    let source = include_str!("../../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/schema.q");
    let windows = include_str!("../../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/windows.q");
    let m7 = format!("{}{}",source.split("view originalTotals:").next().unwrap(),&source[source.find("query trending():").unwrap()..]);
    let compile = |source:&str| {
        let b=snapback4_lang::compile(&[("schema.q".into(),source.into()),("windows.q".into(),windows.into())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
    };
    let directory=ReaderTestDirectory::new();
    let path=directory.0.join("scale.db");
    std::fs::copy(std::env::var("SNAPBACK4_ADOPTION_HTTP_DB").unwrap(),&path).unwrap();
    let host=Host::new(false);
    let b=compile(&m7);
    let headers={
        let mut engine=lock(&host.shared.engine);
        *engine=Engine::new(snapback4_core::Store::open(&path).unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
        engine.set_presence(Some(host.shared.presence.clone()));
        lock(&host.shared.readers).replace(&engine);
        *lock(&host.shared.bound)=b;
        *lock(&host.shared.generation)=engine.generation();
        host.shared.publish_engine(&engine);
        let session=snapback4_core::identity::custom_session(engine.store(),"u0000","scale",host.shared.now(),1).unwrap();
        format!("Authorization: Bearer {}\r\n",session.token)
    };
    let candidate=compile(source);
    let (entered,waiting)=mpsc::channel();
    let (resume,resumed)=mpsc::channel();
    let shared=host.shared.clone();
    let adoption=thread::spawn(move||{
        let mut engine=lock(&shared.engine);
        lock(&shared.readers).begin_adoption(&candidate);
        let once=std::sync::atomic::AtomicBool::new(false);
        engine.store().conn().authorizer(Some(move|ctx:rusqlite::hooks::AuthContext<'_>|{
            if matches!(ctx.action,rusqlite::hooks::AuthAction::Read{table_name:"_meta",..}) && !once.swap(true,Ordering::SeqCst) {
                entered.send(()).unwrap();resumed.recv_timeout(Duration::from_secs(10)).unwrap();
            }
            rusqlite::hooks::Authorization::Allow
        })).unwrap();
        let started=Instant::now();
        let next=engine.adopt(candidate.schema.clone(),candidate.programs.iter().map(|p|p.program.clone())).unwrap();
        let elapsed=started.elapsed();
        lock(&shared.readers).replace(&engine);
        *lock(&shared.bound)=candidate;
        *lock(&shared.generation)=next;
        shared.publish_engine(&engine);
        elapsed
    });
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    let address=host.address;
    let h=headers.clone();
    let changes=thread::spawn(move||{
        let mut socket=TcpStream::connect(address).unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(60))).unwrap();
        let started=Instant::now();
        socket.write_all(format!("GET /changes?since=0&wait=0 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{h}\r\n").as_bytes()).unwrap();
        let mut response=String::new();socket.read_to_string(&mut response).unwrap();
        (response,started.elapsed())
    });
    wait_until(|| host.shared.engine.waiting()>0);
    let started=Instant::now();
    let query=body(&host.request("POST","/q/myProfile",&headers,"{}"));
    assert_eq!(query["complete"],true,"{query}");
    assert_eq!(query["data"]["principal"],"u0000","{query}");
    let query_wait=started.elapsed();
    let started=Instant::now();
    let sync=body(&host.request("POST","/sync",&headers,r#"{"limit":1}"#));
    assert!(sync.get("denied").is_none(),"{sync}");
    let sync_wait=started.elapsed();
    assert!(query_wait<Duration::from_secs(2) && sync_wait<Duration::from_secs(2));
    assert!(!changes.is_finished(),"durable reconnect must wait for its writer");
    resume.send(()).unwrap();
    let adoption_wait=adoption.join().unwrap();
    let (response,changes_wait)=changes.join().unwrap();
    assert_eq!(status(&response),200,"{response}");
    eprintln!("http_scale adoption_ms={} changes_wait_ms={} query_us={} sync_us={}",adoption_wait.as_millis(),changes_wait.as_millis(),query_wait.as_micros(),sync_wait.as_micros());
}
