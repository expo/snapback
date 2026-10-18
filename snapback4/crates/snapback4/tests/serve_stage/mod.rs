use super::*;

const SOURCE: &str = "use identity\ntable items:\n  n: int\n  public 'fixture'\n  update <- allow\njob mark():\n  for item in items:\n    update items[item] { n: 9 }\n";

fn close_doors(shared: &Shared, engine: &mut Engine) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.replace("use identity", "use identity password"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let next = engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    lock(&shared.readers).replace(engine, &bound.refusal_sites);
    *lock(&shared.bound) = bound;
    *lock(&shared.generation) = next;
}

#[test]
fn stage_slow_dev_bodies_cannot_retain_authority_after_password_adoption() {
    for (path, payload) in [("/seed", "[]"), ("/dev/reset", "{}"), ("/dev/clock/advance", r#"{"duration":"+1h"}"#), ("/dev/jobs/mark", "{}")] {
        let host = Host::with_default_doors(SOURCE);
        let before = host.shared.now();
        let mut stream = TcpStream::connect(host.address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", payload.len()).unwrap();
        let mut interim = [0; 128];
        let n = stream.read(&mut interim).unwrap();
        assert!(String::from_utf8_lossy(&interim[..n]).contains("100 Continue"), "passed the pre-body door fence");
        close_doors(&host.shared, &mut lock(&host.shared.engine));
        stream.write_all(payload.as_bytes()).unwrap();
        let mut response = String::new(); stream.read_to_string(&mut response).unwrap();
        assert_eq!(body(&response)["denied"]["code"], "E_AUTH", "{path}: {response}");
        assert!(host.shared.now() - before < 5000, "refused clock did not advance");
    }
}

#[test]
fn stage_queued_dev_requests_recheck_authority_at_the_writer() {
    for (path, payload) in [("/seed", "[]"), ("/dev/reset", "{}"), ("/dev/clock/advance", r#"{"duration":"+1h"}"#), ("/dev/jobs/mark", "{}")] {
        let host = Host::with_default_doors(SOURCE);
        let mut engine = lock(&host.shared.engine);
        let address = host.address;
        let task = thread::spawn(move || exchange_held(address, Duration::from_secs(10), &format!("POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{payload}", payload.len())));
        wait_until(|| host.shared.engine.waiting() > 0);
        close_doors(&host.shared, &mut engine);
        drop(engine);
        let response = task.join().unwrap();
        assert_eq!(body(&response)["denied"]["code"], "E_AUTH", "{path}: {response}");
    }
}

#[test]
fn stage_persona_cannot_acquire_a_replacement_password_only_reader() {
    for file in [false, true] {
        let dir = ReaderTestDirectory::new();
        let store = if file { snapback4_core::Store::open(&dir.0.join("store.sqlite")).unwrap() }
            else { snapback4_core::Store::memory().unwrap() };
        let source = "use identity\nuse personas alice\nquery secret():\n  return 1\n";
        let host = Host::with_default_doors_store(source, store);
        let (entered, waiting) = mpsc::channel();
        let barrier = Arc::new((Mutex::new(false), Condvar::new()));
        let held = barrier.clone();
        let once = std::sync::atomic::AtomicBool::new(false);
        *lock(&host.shared.reader_open) = Some(Arc::new(move || {
            if once.swap(true, Ordering::AcqRel) { return; }
            entered.send(()).unwrap();
            let (state, wake) = &*held;
            let mut ready = lock(state);
            while !*ready { ready = wake.wait(ready).unwrap(); }
        }));
        let address = host.address;
        let task = thread::spawn(move || exchange_held(address, Duration::from_secs(10),
            "POST /q/secret HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 11\r\n\r\n{\"args\":{}}"));
        waiting.recv_timeout(Duration::from_secs(5)).unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.replace("use identity", "use identity password").replace("return 1", "return 9876"))]);
        {
            let mut engine = lock(&host.shared.engine);
            let generation = engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
            lock(&host.shared.readers).replace(&engine, &bound.refusal_sites);
            *lock(&host.shared.bound) = bound;
            *lock(&host.shared.generation) = generation;
        }
        *lock(&barrier.0) = true; barrier.1.notify_all();
        let response = task.join().unwrap();
        assert_eq!(status(&response), 401, "file={file}: {response}");
        assert_eq!(body(&response)["denied"]["code"], "E_AUTH");
        assert!(body(&response).get("data").is_none(), "new result never crosses the closed persona door");
    }
}
