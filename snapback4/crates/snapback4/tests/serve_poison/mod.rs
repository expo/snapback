use super::*;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};

#[test]
fn a_request_after_engine_poison_still_serves() {
    let engine = Engine::memory(Default::default(), Vec::<snapback4_core::ir::Program>::new()).unwrap();
    let clock = Arc::new(Mutex::new(crate::dev_clock::Clock::new(true, 0).unwrap()));
    let shared = Arc::new(Shared {
        project: std::env::current_dir().unwrap(), temporary: true,
        refusals: dev_refusals::Recent::default(),
        latency: Arc::new(latency::Registry::new(&snapback4_lang::compile(&[]))),
        ephemeral: ephemeral::hub(&engine), ephemeral_rate: ephemeral::Rate::default(),
        wake: Mutex::new(ephemeral::Wake::new(&engine)), polls: Condvar::new(),
        adoption: Mutex::new(adoption::Status::new(String::new())),
        readers: Mutex::new(QueryReaders::new(&engine, &Default::default())),
        engine: FairMutex::new(engine), read_cuts: Mutex::new(read_cost::ReadCuts::default()),
        bound: Mutex::new(Bound { refusal_sites: Default::default(), view_types: Default::default(), server: false, schema: Default::default(), programs: Vec::new(), personas: Vec::new(), diagnostics: Vec::new(), notes: Vec::new() }),
        generation: Mutex::new(1),
        worker_revision: AtomicUsize::new(0),
        committed: Condvar::new(),
        seq: Mutex::new(0),
        personas: true,
        hold_effects: false,
        hold_schedules: false,
        clock: clock.clone(), maintenance: Mutex::new(()),
        entropy: Mutex::new(1),
        presence: Arc::new(Live::new(clock)),
        asset_transfers: AssetTransfers::default(),
        native: Mutex::new(None),
        auth: crate::auth::Admission::default(),
        uploads: AtomicUsize::new(0),
        route_verification: routes::Verification::default(), owner: None,
        auth_work: Mutex::new(None),
        request_work: Mutex::new(None),
        upload_work: Mutex::new(None),
        effect_wait: Mutex::new(None),
        poll_wait: Mutex::new(None),
        query_wait: Mutex::new(None), reader_open: Mutex::new(None), changes_refresh: Mutex::new(None),
        mutation_wait: Mutex::new(None),
    });
    shared.install_ephemeral_wake();
    let poisoned = shared.clone();
    assert!(std::thread::spawn(move || {
        let _engine = poisoned.engine.lock().unwrap();
        panic!("request panic while the engine is locked");
    }).join().is_err());
    assert!(shared.engine.is_poisoned());

    let server = tiny_http::Server::http(("127.0.0.1", 0)).unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let serving = shared.clone();
    let worker = std::thread::spawn(move || {
        let request = server.recv_timeout(Duration::from_secs(5)).unwrap().expect("request");
        handle(request, &serving);
    });
    let mut stream = TcpStream::connect(address).unwrap();
    stream.write_all(b"POST /seed HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 2\r\n\r\n[]").unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut answer = String::new();
    stream.read_to_string(&mut answer).unwrap();
    worker.join().unwrap();

    assert!(answer.starts_with("HTTP/1.1 200 "), "{answer}");
    assert!(answer.contains("\"seeded\":0"), "{answer}");
    assert!(!shared.engine.is_poisoned());
}
