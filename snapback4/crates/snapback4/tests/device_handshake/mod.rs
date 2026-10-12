use super::*;

#[test]
fn device_handshake_precedes_body_decoding_and_page_work_on_all_device_doors() {
    let host = Host::new(true);
    let old = snapback4_core::device_protocol::DeviceEngine { format: 1, version: "0.4.23".into(), capabilities: vec![] };
    let headers = format!("x-snapback-persona: alice\r\nx-snapback-device: {}\r\n", serde_json::to_string(&old).unwrap());
    for (method, path, input) in [("POST", "/sync", "not even JSON"), ("GET", "/schema", ""), ("GET", "/changes?since=0&wait=25", "")] {
        let response = host.request(method, path, &headers, input);
        assert_eq!(status(&response), 409, "{response}");
        let refusal = body(&response);
        assert_eq!(refusal["denied"]["code"], "E_DEVICE_VERSION");
        assert!(refusal["denied"]["message"].as_str().unwrap().contains("0.4.23"));
    }
    let response = host.request("POST", "/sync", "x-snapback-persona: alice\r\nx-snapback-device: {}\r\n", "{}");
    assert_eq!(body(&response)["denied"]["code"], "E_DEVICE_VERSION");
    let production = Host::new(false);
    assert_eq!(status(&production.request("POST", "/sync", "x-snapback-device: {}\r\n", "{}")), 401);
    let response = host.request("GET", "/schema", "x-snapback-persona: alice\r\n", "");
    assert_eq!(body(&response)["device_compatibility"]["minimum_version"], "0.4.24");
}

#[test]
fn headerless_legacy_sync_refuses_before_a_garbage_body_and_schema_auth_is_first() {
    let host = Host::new(true);
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream.set_read_timeout(Some(CLIENT_TIMEOUT)).unwrap();
    stream.write_all(b"POST /sync HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 7\r\n\r\ngarbage").unwrap();
    let mut reply = String::new(); stream.read_to_string(&mut reply).unwrap();
    assert_eq!(status(&reply),409); assert_eq!(body(&reply)["denied"]["code"],"E_DEVICE_VERSION");
    let production = Host::new(false);
    for token in ["unknown", "expired"] {
        let headers = format!("Authorization: Bearer {token}\r\nx-snapback-device: {{}}\r\n");
        assert_eq!(status(&production.request("GET","/schema",&headers,"")),401);
    }
}

#[test]
fn a_clock_jump_cannot_be_captured_as_the_revision_of_a_prejump_token() {
    use std::sync::atomic::AtomicBool;
    let dir = ReaderTestDirectory::new();
    std::fs::create_dir_all(dir.0.join("snapback")).unwrap();
    let entry = dir.0.join("snapback/worker.mjs");
    std::fs::write(&entry,"setInterval(()=>{},1000);").unwrap();
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("clock.sqlite")).unwrap(), SCHEMA);
    let project = crate::project::Project {root:dir.0.clone()};
    let mut worker = crate::dev_worker::DevWorker::start_source(&project,host.shared.clone(),format!("http://{}",host.address),entry,true).unwrap();
    let (entered, waiting) = mpsc::channel(); let (resume,resumed) = mpsc::channel();
    let resumed = Mutex::new(resumed); let once = AtomicBool::new(false);
    *lock(&host.shared.worker_minted)=Some(Arc::new(move||{
        if !once.swap(true,Ordering::AcqRel) { entered.send(()).unwrap(); lock(&resumed).recv_timeout(Duration::from_secs(10)).unwrap(); }
    }));
    let minting = thread::spawn(move||{worker.tick();worker});
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(host.shared.clock.try_lock().is_err(),"token time and revision remain under one clock guard");
    let changing=host.shared.clone();
    let advance=thread::spawn(move||{
        let mut engine=lock(&changing.engine);let mut clock=lock(&changing.clock);
        engine.advance_worker_leases_at(1,clock.now()).unwrap();clock.advance(1).unwrap();
    });
    resume.send(()).unwrap();let mut worker=minting.join().unwrap();advance.join().unwrap();
    let first=lock(&host.shared.engine).store().meta("worker:session-family").unwrap().unwrap();
    worker.tick();
    let second=lock(&host.shared.engine).store().meta("worker:session-family").unwrap().unwrap();
    assert_ne!(first,second,"a small deliberate jump must re-mint, even far from expiration");
    let state:Json=serde_json::from_str(&lock(&host.shared.engine).store().meta("worker:status").unwrap().unwrap()).unwrap();
    assert_eq!(state["starts"],2);drop(worker);
}
