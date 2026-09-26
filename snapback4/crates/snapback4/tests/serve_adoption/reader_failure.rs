use super::*;

#[test]
fn failed_file_reader_refuses_without_waiting_for_the_writer() {
    // Each checkout site must refuse independently: bearer resolution, query,
    // pending-query head, sync head, snapshot and stream. The last case covers
    // an unavailable factory, not just opening another reader from a factory.
    for (bearer, path, payload, after, missing_source) in [
        (true, "/q/who", "{}", 0, false),
        (false, "/q/who", "{}", 0, false),
        (false, "/q/total", "{}", 0, false),
        (false, "/sync", "{}", 0, false),
        (false, "/sync", "{}", 1, false),
        (false, "/sync", r#"{"stream":true}"#, 1, false),
        (true, "/q/who", "{}", 0, true),
    ] {
        let dir = ReaderTestDirectory::new();
        let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("reader.db")).unwrap(), reads::SOURCE);
        let session = body(&host.request("POST", "/auth/guest", "", "{}"));
        let headers = if bearer { format!("Authorization: Bearer {}\r\n", session["session"]["token"].as_str().unwrap()) }
            else { "x-snapback-persona: alice\r\n".into() };
        let engine = lock(&host.shared.engine);
        {
            let mut readers = lock(&host.shared.readers);
            let candidate = snapback4_lang::compile(&[("schema.q".into(), format!("{}{}", reads::SOURCE, reads::VIEWS))]);
            readers.begin_adoption(&candidate);
            readers.idle.clear();
            if missing_source { readers.source = None; }
            else { readers.fail_open_after = Some(after); }
        }
        let start = Instant::now();
        let response = host.request("POST", path, &headers, payload);
        assert_eq!(status(&response), 503, "{path} checkout {after}: {response}");
        let reply = body(&response);
        assert_eq!(reply["denied"]["code"], "E_STORE");
        assert_eq!(reply["denied"]["retryable"], true);
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(host.shared.engine.waiting(), 0, "refusal must not queue for the writer");
        let operation = if path == "/q/total" { "/q/<unknown>" } else { path };
        wait_until(|| host.shared.latency.snapshot(false).operations[operation].n == 1);
        let sample = host.shared.latency.snapshot(false);
        let sample = &sample.operations[operation];
        assert_eq!(sample.refused, 1, "reader refusals must be counted once");
        assert!(sample.total.max > 0.0);
        assert!(sample.total.max >= sample.wait.max);
        assert_eq!(sample.wait.max == 0.0, after == 0, "only a successful checkout ends wait");
        {
            let mut readers = lock(&host.shared.readers);
            readers.fail_open_after = None;
            readers.replace(&engine);
        }
        drop(engine);
        assert_eq!(status(&host.request("POST", "/q/who", &headers, "{}")), 200);
    }
}
