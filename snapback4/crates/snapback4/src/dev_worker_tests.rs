use crate::{dev_worker::DevWorker, project::Project};
use crate::serve::tests::{Host, ReaderTestDirectory, status};
use snapback4_core::identity;
use std::sync::{atomic::Ordering, mpsc};
use std::time::Duration;

#[test]
fn inner_unknown_mint_through_queue_fences_the_orphan_before_replacement() {
    for named in [false, true] {
        let directory = ReaderTestDirectory::new();
        let entry = directory.0.join(if named { "snapback/workers/push.mjs" } else { "worker.mjs" });
        std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
        std::fs::write(&entry, "import {writeFileSync,renameSync} from 'node:fs';\nwriteFileSync('ready.tmp', process.env.SNAPBACK_SERVICE_TOKEN);\nrenameSync('ready.tmp','ready');\nsetInterval(()=>{},1000);\n").unwrap();
        let project = Project { root: directory.0.clone() };
        let host = Host::with_store(false, snapback4_core::Store::open(&directory.0.join("mint.sqlite")).unwrap(),
            "effect notify\nquery who():\n  return viewer\n");
        let mut worker = if named {
            DevWorker::start_named(&project, host.shared.clone(), format!("http://{}", host.address), entry, true, "push".into())
        } else {
            DevWorker::start_source(&project, host.shared.clone(), format!("http://{}", host.address), entry, true)
        }.unwrap();
        let revision = host.shared.worker_revision.load(Ordering::Acquire);
        let (sent, received) = mpsc::channel();
        worker.mint_unknown = Some(sent);
        worker.tick();
        // The mint really committed on the worker; only its inner result was
        // replaced by unknown. The queue's outer acknowledgement succeeded.
        let orphan = received.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(host.shared.worker_revision.load(Ordering::Acquire), revision + 1);
        let token = orphan.clone();
        assert!(host.shared.engine.attempt(move |engine, shared| identity::resolve_supervised(engine.store(), &token,
            identity::ServiceSample { now: shared.now(), supervisor_revision: revision })).unwrap().is_some(),
            "the durable orphan is live under its original revision");
        let headers = format!("Authorization: Bearer {orphan}\r\n");
        assert_eq!(status(&host.request("POST", "/q/who", &headers, "{}")), 401);
        assert!(!directory.0.join("ready").exists(), "unknown mint cannot launch a child");
        if !named {
            host.shared.engine.call(|engine, _| engine.store().test_support_conn()
                .busy_timeout(Duration::from_millis(5))).unwrap().unwrap();
            let holder = rusqlite::Connection::open(directory.0.join("mint.sqlite")).unwrap();
            holder.execute_batch("BEGIN IMMEDIATE").unwrap();
            std::thread::sleep(Duration::from_millis(300));
            worker.tick();
            assert!(!directory.0.join("ready").exists(), "failed retirement must suspend replacement");
            assert_eq!(host.shared.worker_revision.load(Ordering::Acquire), revision + 1);
            assert_eq!(status(&host.request("POST", "/q/who", &headers, "{}")), 401);
            holder.execute_batch("ROLLBACK").unwrap();
        }
        // Exercise the real next tick, including retirement custody for the
        // conventional worker's single family marker before it is replaced.
        std::thread::sleep(Duration::from_millis(300));
        worker.tick();
        let until = std::time::Instant::now() + Duration::from_secs(10);
        while !directory.0.join("ready").exists() && std::time::Instant::now() < until { worker.tick(); std::thread::sleep(Duration::from_millis(10)); }
        let replacement = std::fs::read_to_string(directory.0.join("ready")).unwrap();
        let headers = format!("Authorization: Bearer {replacement}\r\n");
        assert_eq!(status(&host.request("POST", "/q/who", &headers, "{}")), 200);
        assert_eq!(status(&host.request("POST", "/q/who", &format!("Authorization: Bearer {orphan}\r\n"), "{}")), 401);
    }
}
