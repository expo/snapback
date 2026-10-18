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
