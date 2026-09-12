use super::*;
use std::io::Cursor;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::thread;

const REAL_KEY: &str = "s2id-0123456789abcdef0123456789abcdef-0000000000000001";
const PUT_KEY: &str = "s2id-0123456789abcdef0123456789abcdef-0000000000000002";

fn root() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "snapback2-blob-store-{}-{}",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(path.join(".snapback")).unwrap();
    path
}

fn enumerate_all(store: &dyn BlobStore, prefix: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut continuation = None;
    loop {
        continuation = store
            .enumerate_page(prefix, continuation.as_deref(), 8, &mut |key| {
                keys.push(key.to_owned());
                Ok(())
            })
            .unwrap();
        if continuation.is_none() {
            return keys;
        }
    }
}

#[test]
fn put_get_range_and_delete_are_streaming() {
    let root = root();
    let store = FileBlobStore::open(&root).unwrap();
    let key = REAL_KEY;
    assert_eq!(store.put(key, &mut &b"abcdef"[..]).unwrap(), 6);
    assert_eq!(
        store.put(key, &mut &b"replacement"[..]).unwrap_err().code,
        "E_OWNER_ASSET_IO"
    );
    let mut read = store
        .get(key, Some(ByteRange { start: 2, end: 4 }))
        .unwrap();
    let mut bytes = Vec::new();
    read.stream.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"cde");
    assert_eq!((read.length, read.total), (3, 6));
    store.delete(key).unwrap();
    assert!(store.get(key, None).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn enumerate_skips_publish_temporary_and_returns_real_blob() {
    let root = root();
    let store = FileBlobStore::open(&root).unwrap();
    store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
    let temporary = root
        .join(".snapback/blobs")
        .join(format!(".{PUT_KEY}.put-1-2.tmp"));
    fs::write(&temporary, b"in flight").unwrap();

    let keys = enumerate_all(&store, "");
    assert_eq!(keys, vec![REAL_KEY]);
    assert!(temporary.is_file());
    fs::remove_dir_all(root).unwrap();
}

struct PausingReader {
    source: Cursor<&'static [u8]>,
    started: Option<Sender<()>>,
    resume: Receiver<()>,
}

impl Read for PausingReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if let Some(started) = self.started.take() {
            started.send(()).unwrap();
            self.resume.recv().unwrap();
        }
        self.source.read(buffer)
    }
}

#[test]
fn sweep_during_in_flight_put_keeps_the_active_temporary() {
    let root = root();
    let store = Arc::new(FileBlobStore::open(&root).unwrap());
    store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
    let (started_tx, started_rx) = channel();
    let (resume_tx, resume_rx) = channel();
    let writer = {
        let store = store.clone();
        thread::spawn(move || {
            let mut source = PausingReader {
                source: Cursor::new(b"published"),
                started: Some(started_tx),
                resume: resume_rx,
            };
            store.put(PUT_KEY, &mut source)
        })
    };
    started_rx.recv().unwrap();
    let temporary = fs::read_dir(root.join(".snapback/blobs"))
        .unwrap()
        .map(Result::unwrap)
        .find(|entry| is_blob_temporary(entry.file_name().to_str().unwrap()))
        .unwrap()
        .path();

    File::options()
        .write(true)
        .open(&temporary)
        .unwrap()
        .set_times(
            fs::FileTimes::new()
                .set_modified(SystemTime::now() - BLOB_TEMP_STALE_AFTER - Duration::from_secs(1)),
        )
        .unwrap();
    crate::asset_gc::enumerate_blob_page(store.as_ref(), None, 8).unwrap();
    assert!(temporary.is_file());
    resume_tx.send(()).unwrap();
    assert_eq!(writer.join().unwrap().unwrap(), 9);
    assert!(store.path_for_key(PUT_KEY).unwrap().is_file());
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn failed_publish_cleanup_remains_scratch_charged_until_sweep() {
    let root = root();
    let store = Arc::new(FileBlobStore::open(&root).unwrap());
    let (started_tx, started_rx) = channel();
    let (resume_tx, resume_rx) = channel();
    let writer = {
        let store = store.clone();
        thread::spawn(move || {
            let mut source = PausingReader {
                source: Cursor::new(b"published"),
                started: Some(started_tx),
                resume: resume_rx,
            };
            store.put(PUT_KEY, &mut source)
        })
    };
    started_rx.recv().unwrap();
    let directory = root.join(".snapback/blobs");
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    resume_tx.send(()).unwrap();
    assert_eq!(writer.join().unwrap().unwrap_err().code, "E_OWNER_ASSET_IO");
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(store.publish_scratch_usage(), (9, 1));
    let temporary = fs::read_dir(&directory)
        .unwrap()
        .map(Result::unwrap)
        .find(|entry| is_blob_temporary(entry.file_name().to_str().unwrap()))
        .unwrap()
        .path();
    let old = SystemTime::now()
        .checked_sub(BLOB_TEMP_STALE_AFTER + Duration::from_secs(1))
        .unwrap();
    File::options()
        .write(true)
        .open(&temporary)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(old))
        .unwrap();
    crate::asset_gc::enumerate_blob_page(store.as_ref(), None, 8).unwrap();
    assert_eq!(store.publish_scratch_usage(), (0, 0));
    assert!(!temporary.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn enumerate_tolerates_put_completing_before_temporary_inspection() {
    let root = root();
    let store = Arc::new(FileBlobStore::open(&root).unwrap());
    store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
    let (started_tx, started_rx) = channel();
    let (resume_tx, resume_rx) = channel();
    let (completed_tx, completed_rx) = channel();
    let writer = {
        let store = store.clone();
        thread::spawn(move || {
            let mut source = PausingReader {
                source: Cursor::new(b"published"),
                started: Some(started_tx),
                resume: resume_rx,
            };
            let result = store.put(PUT_KEY, &mut source);
            completed_tx.send(()).unwrap();
            result
        })
    };
    started_rx.recv().unwrap();
    let temporary = fs::read_dir(root.join(".snapback/blobs"))
        .unwrap()
        .map(Result::unwrap)
        .find(|entry| is_blob_temporary(entry.file_name().to_str().unwrap()))
        .unwrap()
        .path();

    ENUMERATE_BEFORE_INSPECTION.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |entry| {
            if entry.path() != temporary {
                return false;
            }
            resume_tx.send(()).unwrap();
            completed_rx.recv().unwrap();
            true
        }));
    });
    let keys = enumerate_all(store.as_ref(), REAL_KEY);

    assert_eq!(writer.join().unwrap().unwrap(), 9);
    assert_eq!(keys, vec![REAL_KEY]);
    assert_eq!(
        fs::read(store.path_for_key(REAL_KEY).unwrap()).unwrap(),
        b"real"
    );
    assert_eq!(
        fs::read(store.path_for_key(PUT_KEY).unwrap()).unwrap(),
        b"published"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn periodic_sweep_removes_stale_untracked_publish_temporary() {
    let root = root();
    let store = FileBlobStore::open(&root).unwrap();
    store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
    let temporary = root
        .join(".snapback/blobs")
        .join(format!(".{PUT_KEY}.put-1-2.tmp"));
    fs::write(&temporary, b"crashed").unwrap();
    let old = SystemTime::now()
        .checked_sub(BLOB_TEMP_STALE_AFTER + Duration::from_secs(1))
        .unwrap();
    File::options()
        .write(true)
        .open(&temporary)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(old))
        .unwrap();

    crate::asset_gc::enumerate_blob_page(&store, None, 8).unwrap();
    assert!(!temporary.exists());
    assert!(store.path_for_key(REAL_KEY).unwrap().is_file());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn traversal_is_refused_as_typed_owner_io() {
    let root = root();
    let store = FileBlobStore::open(&root).unwrap();
    let refusal = store.put("../store.sqlite", &mut &b"x"[..]).unwrap_err();
    assert_eq!(refusal.code, "E_OWNER_ASSET_IO");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn startup_sweeps_only_type_checked_crash_temporaries() {
    let root = root();
    let blobs = root.join(".snapback/blobs");
    let staging = root.join(".snapback/staging");
    fs::create_dir_all(&blobs).unwrap();
    fs::create_dir_all(&staging).unwrap();
    let put = blobs.join(".s2id-dead.put-1-2.tmp");
    let upload = staging.join("upload-dead-1.stage");
    let strip = staging.join(".asset-strip-1-2.tmp");
    let helper = staging.join(".rung-dead.stage.snapback2-media-1-2.tmp");
    let unknown = staging.join("author-file.txt");
    for path in [&put, &upload, &strip, &helper, &unknown] {
        fs::write(path, b"stale").unwrap();
    }
    FileBlobStore::open(&root).unwrap();
    LocalStaging::open(&root).unwrap();
    for path in [&put, &upload, &strip, &helper] {
        assert!(!path.exists(), "{} survived startup sweep", path.display());
    }
    assert!(unknown.is_file());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reset_clear_waits_for_registered_finalizing_upload_custody() {
    let root = root();
    let staging = LocalStaging::open(&root).unwrap();
    let receiving = staging.create().unwrap();
    let custody = UploadCustody::new(receiving);
    staging.register_upload("upload-1".to_owned(), custody.clone());
    let finalizing = custody.finalize().unwrap();
    let finalizing_path = finalizing.path.clone();
    let marker = root.join(".snapback/staging/reset-order-probe.stage");
    fs::write(&marker, b"present before reset").unwrap();

    assert!(!staging.clear_after_reset().unwrap());
    assert!(finalizing_path.is_file());
    assert!(marker.is_file());

    custody.finish(Some(finalizing)).unwrap();
    staging.finish_upload("upload-1");
    assert!(staging.resume_reset_clear().unwrap());
    assert!(!finalizing_path.exists());
    assert!(!marker.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn scratch_reservations_include_concurrent_work_and_failed_unlinks() {
    let root = root();
    let staging = LocalStaging::open(&root).unwrap();
    let mut reserved = staging
        .create_reserved("source", SCRATCH_GLOBAL_BYTES, 1)
        .unwrap();
    assert_eq!(
        staging.create_reserved("source", 1, 1).unwrap_err().code,
        "E_ASSET_TOO_LARGE"
    );
    reserved.discard().unwrap();

    let mut retained = staging.create_for_upload(1).unwrap();
    retained.file_mut().write_all(b"x").unwrap();
    let retained_path = retained.path().to_owned();
    let directory = root.join(".snapback/staging");
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    assert_eq!(retained.discard().unwrap_err().code, "E_OWNER_ASSET_IO");
    drop(retained);
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(staging.scratch_usage().unwrap(), (1, 1));
    assert_eq!(
        staging
            .create_reserved("source", SCRATCH_GLOBAL_BYTES, 1)
            .unwrap_err()
            .code,
        "E_ASSET_TOO_LARGE"
    );
    fs::remove_file(retained_path).unwrap();
    assert_eq!(staging.scratch_usage().unwrap(), (0, 0));
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn scratch_cost_measurements() {
    let root = root();
    let store = FileBlobStore::open(&root).unwrap();
    for count in [1, 32] {
        let mut map = store.publish_scratch.lock().unwrap();
        map.entries.clear();
        map.bytes = 0;
        for i in 0..count {
            map.set(&format!("scratch-{i}"), 0);
        }
        drop(map);
        let mut file = File::create(root.join("writes")).unwrap();
        let mut writer = PublishScratchWriter {
            inner: &mut file,
            name: "scratch-0",
            scratch: &store.publish_scratch,
        };
        let start = std::time::Instant::now();
        for _ in 0..100_000 {
            writer.write_all(b"x").unwrap();
        }
        eprintln!(
            "scratch writes map={count} elapsed_us={}",
            start.elapsed().as_micros()
        );
    }
    let staging = LocalStaging::open(&root).unwrap();
    let start = std::time::Instant::now();
    for _ in 0..1000 {
        drop(staging.reserve_scratch(1024, 1).unwrap());
    }
    eprintln!(
        "scratch reservations=1000 elapsed_us={}",
        start.elapsed().as_micros()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn enumeration_io_and_visitors_do_not_hold_the_registry_lock() {
    let root = root();
    let store = FileBlobStore::open(&root).unwrap();
    store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
    let other = store.clone();
    ENUMERATE_BEFORE_INSPECTION.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move |_| {
            let start = std::time::Instant::now();
            let registry = other
                .enumerations
                .try_lock()
                .expect("disk inspection must not hold registry");
            drop(registry);
            eprintln!(
                "enumeration registry acquire during inspection ns={}",
                start.elapsed().as_nanos()
            );
            true
        }))
    });
    store
        .enumerate_page("", None, 8, &mut |_| {
            assert!(store.enumerations.try_lock().is_ok());
            Ok(())
        })
        .unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn poisoned_blob_locks_refuse_and_cleanup_does_not_panic() {
    let root = root();
    let store = FileBlobStore::open(&root).unwrap();
    let other = store.clone();
    assert!(
        thread::spawn(move || {
            let _guard = other.publish_scratch.lock().unwrap();
            panic!("injected");
        })
        .join()
        .is_err()
    );
    assert_eq!(
        store.put(REAL_KEY, &mut &b"real"[..]).unwrap_err().code,
        "E_OWNER_ASSET_IO"
    );
    assert!(store.active_puts.lock().unwrap().is_empty());
    let staging = LocalStaging::open(&root).unwrap();
    let permit = staging.reserve_scratch(1024, 1).unwrap();
    let other = staging.clone();
    assert!(
        thread::spawn(move || {
            let _guard = other.scratch.lock().unwrap();
            panic!("injected");
        })
        .join()
        .is_err()
    );
    assert_eq!(
        staging.reserve_scratch(1024, 1).unwrap_err().code,
        "E_OWNER_ASSET_IO"
    );
    drop(permit);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn scratch_inspection_does_not_hold_reservation_lock() {
    let root = root();
    let staging = LocalStaging::open(&root).unwrap();
    let other = staging.clone();
    SCRATCH_BEFORE_INSPECTION.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            assert!(
                other.scratch.try_lock().is_ok(),
                "disk scan must not hold reservation lock"
            );
        }))
    });
    drop(staging.reserve_scratch(1024, 1).unwrap());
    SCRATCH_BEFORE_INSPECTION.with(|hook| hook.borrow_mut().take());
    fs::remove_dir_all(root).unwrap();
}
