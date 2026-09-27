use super::*;

fn timing(reply: &str) -> Option<BTreeMap<String, f64>> {
    let header = reply.split("\r\n\r\n").next().unwrap().lines()
        .find_map(|line| line.split_once(':').filter(|(name, _)| name.eq_ignore_ascii_case("server-timing")).map(|(_, value)| value))?;
    Some(header.split(',').map(|metric| {
        let (name, duration) = metric.trim().split_once(";dur=").unwrap();
        let duration: f64 = duration.parse().unwrap();
        assert!(duration.is_finite() && duration >= 0.0);
        (name.into(), duration)
    }).collect())
}

#[test]
fn dev_headers_cover_operations_and_refusals_without_data_and_respect_the_fence() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    for (method, path, payload) in [
        ("POST", "/q/read", "{}"), ("POST", "/q/missing", "{}"),
        ("POST", "/m/put", r#"{"id":"ok","args":{"n":1}}"#),
        ("POST", "/m/put", r#"{"id":"no","args":{"n":-1}}"#),
        ("POST", "/a/echo?wait=0", r#"{"id":"echo","args":{}}"#),
        ("POST", "/sync", "{}"), ("GET", "/changes?wait=0", ""),
        ("POST", "/assets", ""), ("GET", "/assets/missing", ""),
        ("GET", "/probe", ""), ("GET", "/schema", ""),
        ("GET", "/dev/latency", ""), ("OPTIONS", "/q/read", ""),
    ] {
        let reply = host.request(method, path, PERSONA, payload);
        let metrics = timing(&reply).unwrap_or_else(|| panic!("missing timing: {reply}"));
        let keys: Vec<_> = metrics.keys().map(String::as_str).collect();
        assert_eq!(keys, ["cpu", "engine", "total", "wait"]);
        assert!(metrics["engine"] <= metrics["total"] + 0.001, "{metrics:?}");
        assert!(metrics["wait"] <= metrics["total"] + 0.001, "{metrics:?}");
        assert!(reply.to_ascii_lowercase().contains("access-control-expose-headers: server-timing"));
    }
    for origin in ["Origin: https://evil.example\r\n", "Origin: http://localhost.evil:4400\r\n"] {
        let reply = host.request("POST", "/q/read", &format!("{PERSONA}{origin}"), "{}");
        assert_eq!(status(&reply), 403);
        assert!(timing(&reply).is_none());
    }
    let release = Host::with_store(false, snapback4_core::Store::memory().unwrap(), SOURCE);
    for (method, path, payload) in [("GET", "/probe", ""), ("POST", "/q/read", "{}"), ("POST", "/auth/guest", "{}")] {
        assert!(timing(&release.request(method, path, "", payload)).is_none());
    }
    let session = { let engine = lock(&release.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "worker", release.shared.now(), 1).unwrap() };
    let auth = format!("Authorization: Bearer {}\r\n", session.token);
    let reply = release.request("POST", "/q/read", &auth, "{}");
    assert_eq!(body(&reply)["data"]["state"], "failed");
    assert!(timing(&reply).is_none());
}

#[test]
fn reader_header_attributes_engine_sleep_without_waiting_for_a_held_writer() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
    // Keep the writer locked for the entire HTTP exchange: a read that waits
    // behind it fails the socket timeout, independent of scheduler speed.
    let writer = lock(&host.shared.engine);
    *lock(&host.shared.query_wait) = Some(Arc::new(|| thread::sleep(Duration::from_millis(150))));
    let reply = host.request("POST", "/q/read", PERSONA, "{}");
    drop(writer);
    let sample = timing(&reply).unwrap();
    assert!(sample["engine"] >= 150.0, "{sample:?}");
    assert!(sample["total"] >= sample["engine"], "{sample:?}");
    assert!(sample["engine"] - sample["cpu"] >= 120.0, "off-CPU sleep missing: {sample:?}");
    let snapshot = counted(&host, "/q/read", 1);
    let op = &snapshot["operations"]["/q/read"];
    for metric in ["total", "engine", "cpu"] {
        assert!(op[metric]["max"].as_f64().unwrap() + 0.001 >= sample[metric], "{op}");
    }
    assert_eq!(op["cpu_n"], 1);
}

#[test]
fn thread_cpu_excludes_another_busy_thread_and_records_own_work() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
    *lock(&host.shared.query_wait) = Some(Arc::new(|| {
        let start = latency::thread_cpu().unwrap();
        while latency::thread_cpu().unwrap() - start < Duration::from_millis(20) { std::hint::spin_loop(); }
        // A process clock would wrongly charge the child thread to this read.
        thread::spawn(|| {
            let start = latency::thread_cpu().unwrap();
            while latency::thread_cpu().unwrap() - start < Duration::from_millis(100) { std::hint::spin_loop(); }
        }).join().unwrap();
    }));
    let sample = timing(&host.request("POST", "/q/read", PERSONA, "{}")).unwrap();
    assert!(sample["cpu"] >= 20.0, "{sample:?}");
    assert!(sample["engine"] - sample["cpu"] >= 80.0, "CPU must be request-thread only: {sample:?}");
}
