//! A detached page's position must describe the snapshot that supplied its rows.
use super::*;

#[test]
fn detached_sync_never_skips_a_commit_after_its_snapshot() {
    for stream in [false, true] {
        for iteration in 0..16 {
            let concurrent = if iteration % 2 == 0 { "aa-concurrent" } else { "zz-concurrent" };
            let directory = ReaderTestDirectory::new();
            let host = Host::with_store(true,
                snapback4_core::Store::open(&directory.0.join("sync.db")).unwrap(),
                "use personas alice\ntable items:\n  n: int\n  public 'snapshot race'\n  insert <- allow\n  sync public\nmutation add(id: id):\n  insert items {id, n: 1}\n");
            let add = |id: &str| body(&host.request("POST", "/m/add", PERSONA,
                &json!({"id": id, "args": {"id": id}}).to_string()));
            let mut before = add("before")["seq"].as_u64().unwrap();
            if !stream { before = add("z-before")["seq"].as_u64().unwrap(); }
            // read_head checks out and returns this loan before the page reads.
            // Pause on a row/log read, after read_transaction's identity SELECT
            // pinned the WAL snapshot, but before materializing the page.
            let (epoch, reader) = host.shared.reader().unwrap();
            let (entered, waiting) = mpsc::channel();
            let (resume, resumed) = mpsc::channel();
            let once = std::sync::atomic::AtomicBool::new(false);
            reader.store().conn().authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
                if matches!(ctx.action, rusqlite::hooks::AuthAction::Read { table_name, .. }
                    if table_name == if stream { "_log" } else { "r" })
                    && !once.swap(true, Ordering::SeqCst) {
                    entered.send(()).unwrap();
                    resumed.recv_timeout(Duration::from_secs(10)).unwrap();
                }
                rusqlite::hooks::Authorization::Allow
            })).unwrap();
            lock(&host.shared.readers).put(&epoch, reader.into_inner());
            let address = host.address;
            let page = thread::spawn(move || {
                let input = json!({"stream":stream,"limit":1,"pending":[concurrent]}).to_string();
                body(&exchange_held(address, Duration::from_secs(5) + CLIENT_TIMEOUT, &format!("POST /sync HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{PERSONA}Content-Length: {}\r\n\r\n{input}", input.len())))
            });
            waiting.recv_timeout(Duration::from_secs(5)).unwrap();
            let committed = add(concurrent)["seq"].as_u64().unwrap();
            assert!(committed > before);
            resume.send(()).unwrap();
            let first = page.join().unwrap();
            assert!(first.get("denied").is_none(), "{first}");
            assert_eq!(first["watermark"], before, "stream={stream} run={iteration}: {first}");
            if stream { assert_eq!(first["images_at"], before); }
            else { assert_eq!(first["events"][0]["id"], "z-before", "snapshot cursor starts at z-before: {first}"); }
            assert!(!first["events"].as_array().unwrap().iter().any(|e| e["id"] == concurrent));
            assert!(first["acknowledged"].get(concurrent).is_none(), "no ack beyond delivered position");
            assert!(first["committed_above"].get(concurrent).is_none(), "no ack beyond image snapshot");

            // A paged snapshot retains its first watermark even if the next
            // page sees newer rows. Catch-up must still include the concurrent
            // commit. Assert the actual first row above and the omitted-before
            // case below: sync public traverses byId descending here, so zz is
            // before z-before; aa is after. Both must arrive in catch-up.
            let mut next = first["next"].as_str().map(str::to_owned);
            while let Some(cursor) = next {
                let page = body(&host.request("POST", "/sync", PERSONA,
                    &json!({"after":cursor,"limit":1}).to_string()));
                assert_eq!(page["watermark"], before, "{page}");
                if !stream && concurrent == "zz-concurrent" {
                    assert!(!page["events"].as_array().unwrap().iter().any(|e| e["id"] == concurrent), "insertion before cursor must arrive through catch-up: {page}");
                }
                next = page["next"].as_str().map(str::to_owned);
            }
            let caught = body(&host.request("POST", "/sync", PERSONA,
                &json!({"from":before,"stream":true,"limit":1,"pending":[concurrent]}).to_string()));
            assert_eq!(caught["watermark"], committed, "{caught}");
            assert_eq!(caught["images_at"], committed);
            assert_eq!(caught["acknowledged"][concurrent], committed);
            assert!(caught["events"].as_array().unwrap().iter().any(|e| e["id"] == concurrent && e["kind"] == "put"), "{caught}");
        }
    }
}
