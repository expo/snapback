use super::*;

#[test]
fn media_flights_expose_their_asset_ids_until_their_permits_drop() {
    let jobs = MediaJobs::default();
    let rung = jobs
        .rung("s2id-asset-one.w256")
        .unwrap()
        .expect("first rung owns its flight");
    let once = jobs.once("s2id-asset-two", "alice").unwrap();
    assert_eq!(
        jobs.active_asset_ids(),
        std::collections::BTreeSet::from([
            "s2id-asset-one".to_owned(),
            "s2id-asset-two".to_owned(),
        ])
    );
    drop(rung);
    assert_eq!(
        jobs.active_asset_ids(),
        std::collections::BTreeSet::from(["s2id-asset-two".to_owned()])
    );
    drop(once);
    assert!(jobs.active_asset_ids().is_empty());
}
use crate::blob_store::BlobRead;
use std::collections::BTreeMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

#[test]
fn completion_writer_counts_one_and_two_byte_bodies_before_finishing() {
    use std::io::{Read, Write};
    for body in [b"x".as_slice(), b"xy".as_slice()] {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let client = std::thread::spawn(move || {
            let mut socket = std::net::TcpStream::connect(address).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            socket
                .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .unwrap();
            let mut bytes = Vec::new();
            socket.read_to_end(&mut bytes).unwrap();
            bytes
        });
        let delivery = serde_json::json!({"type":"image/png"});
        let (consumed, finish) = write_once_body(
            server.recv().unwrap(),
            BlobRead {
                stream: Box::new(Cursor::new(body.to_vec())),
                length: body.len() as u64,
                total: body.len() as u64,
                range: None,
            },
            &delivery,
            "dev",
        );
        assert!(
            consumed,
            "{}-byte body must claim before publishing its tail",
            body.len()
        );
        finish();
        let response = client.join().unwrap();
        let start = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        assert_eq!(&response[start..], body);
    }
}

#[test]
fn once_read_failure_with_only_a_held_body_byte_does_not_consume() {
    use std::io::{Read, Write};
    struct FailedRead;
    impl Read for FailedRead {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("blob failed after its first byte"))
        }
    }
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let client = std::thread::spawn(move || {
        let mut socket = std::net::TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut bytes = Vec::new();
        socket.read_to_end(&mut bytes).unwrap();
        bytes
    });
    let delivery = serde_json::json!({"type":"image/png"});
    let (consumed, finish) = write_once_body(
        server.recv().unwrap(),
        BlobRead {
            stream: Box::new(Cursor::new(b"x".to_vec()).chain(FailedRead)),
            length: 2,
            total: 2,
            range: None,
        },
        &delivery,
        "dev",
    );
    assert!(
        !consumed,
        "no body byte moved and the held byte cannot be published"
    );
    finish();
    let response = client.join().unwrap();
    let start = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    assert!(response[start..].is_empty());
}

#[derive(Default)]
struct MemoryBlobStore(Mutex<BTreeMap<String, Vec<u8>>>);

impl BlobStore for MemoryBlobStore {
    fn put(&self, key: &str, source: &mut dyn Read) -> Result<u64, Refusal> {
        let mut bytes = Vec::new();
        source.read_to_end(&mut bytes).map_err(asset_file_io)?;
        let mut blobs = self.0.lock().unwrap();
        if blobs.contains_key(key) {
            return Err(asset_type("immutable key already exists"));
        }
        let length = bytes.len() as u64;
        blobs.insert(key.to_owned(), bytes);
        Ok(length)
    }

    fn get(&self, key: &str, range: Option<ByteRange>) -> Result<BlobRead, Refusal> {
        let blobs = self.0.lock().unwrap();
        let bytes = blobs.get(key).cloned().ok_or_else(asset_not_ready)?;
        let total = bytes.len() as u64;
        let (bytes, selected) = match range {
            Some(range) => (
                bytes[range.start as usize..=range.end as usize].to_vec(),
                Some(range),
            ),
            None => (bytes, None),
        };
        Ok(BlobRead {
            length: bytes.len() as u64,
            total,
            range: selected,
            stream: Box::new(Cursor::new(bytes)),
        })
    }

    fn delete(&self, key: &str) -> Result<(), Refusal> {
        self.0.lock().unwrap().remove(key);
        Ok(())
    }

    fn enumerate_page(
        &self,
        prefix: &str,
        continuation: Option<&str>,
        limit: usize,
        visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
    ) -> Result<Option<String>, Refusal> {
        let mut keys = self
            .0
            .lock()
            .unwrap()
            .keys()
            .filter(|key| {
                key.starts_with(prefix) && continuation.is_none_or(|after| key.as_str() > after)
            })
            .take(limit.saturating_add(1))
            .cloned()
            .collect::<Vec<_>>();
        let next = (keys.len() > limit).then(|| keys[limit - 1].clone());
        keys.truncate(limit);
        for key in &keys {
            visitor(&key)?;
        }
        Ok(next)
    }
}

#[test]
fn ranges_are_exact_and_multi_or_malformed_are_unsatisfiable() {
    assert!(matches!(parse_range(None, 10), RangeRequest::Full));
    assert!(matches!(
        parse_range(Some("bytes=2-5"), 10),
        RangeRequest::Partial(ByteRange { start: 2, end: 5 })
    ));
    assert!(matches!(
        parse_range(Some("bytes=-3"), 10),
        RangeRequest::Partial(ByteRange { start: 7, end: 9 })
    ));
    for invalid in ["bytes=10-", "bytes=5-2", "items=0-1", "bytes=0-1,4-5"] {
        assert!(matches!(
            parse_range(Some(invalid), 10),
            RangeRequest::Unsatisfiable
        ));
    }
}

#[test]
fn widths_snap_up_and_never_upscale() {
    assert_eq!(snap_width(300, 4_000), 512);
    assert_eq!(snap_width(8_000, 4_000), 4_000);
    assert_eq!(snap_width(u32::MAX, 10_000), 10_000);
}

#[test]
fn concurrent_first_rung_requests_spawn_one_helper_and_all_succeed() {
    const ID: &str = "s2id-0123456789abcdef0123456789abcdef-0000000000000001";
    let key = format!("{ID}.w256");
    let store = Arc::new(MemoryBlobStore::default());
    store
        .0
        .lock()
        .unwrap()
        .insert(ID.to_owned(), b"source-bytes".to_vec());
    let root = std::env::temp_dir().join(format!(
        "snapback2-rung-flight-{}-{}",
        std::process::id(),
        crate::writer_util::unix_millis()
    ));
    fs::create_dir_all(root.join(".snapback")).unwrap();
    let staging = Arc::new(LocalStaging::open(&root).unwrap());
    let jobs = MediaJobs::default();
    let spawns = Arc::new(AtomicUsize::new(0));
    let threads = (0..16)
        .map(|_| {
            let store = store.clone();
            let staging = staging.clone();
            let jobs = jobs.clone();
            let spawns = spawns.clone();
            let key = key.clone();
            std::thread::spawn(move || {
                ensure_rung_with(
                    store.as_ref(),
                    &staging,
                    &jobs,
                    ID,
                    &key,
                    256,
                    12,
                    &|_, output, width| {
                        spawns.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(50));
                        fs::write(output, b"\xff\xd8\xffrendered!").map_err(asset_file_io)?;
                        Ok(media_helper::RenderResult {
                            format: media_helper::MediaFormat::Jpeg,
                            width,
                            height: 128,
                        })
                    },
                )
            })
        })
        .collect::<Vec<_>>();
    for thread in threads {
        assert_eq!(thread.join().unwrap().unwrap(), "image/jpeg");
    }
    assert_eq!(spawns.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn poisoned_media_admission_refuses_and_permit_drop_does_not_panic() {
    let jobs = MediaJobs::default();
    let permit = jobs.helper().unwrap();
    let other = jobs.clone();
    assert!(
        std::thread::spawn(move || {
            let _guard = other.0.state.lock().unwrap();
            panic!("injected");
        })
        .join()
        .is_err()
    );
    assert_eq!(jobs.helper().err().unwrap().code, "E_OWNER_ASSET_IO");
    assert!(jobs.rung("asset.w256").is_err());
    assert!(jobs.once("asset", "alice").is_err());
    drop(permit);
}

#[test]
#[cfg(target_pointer_width = "32")]
fn once_response_refuses_a_length_larger_than_the_platform() {
    use std::io::{Read, Write};
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let client = std::thread::spawn(move || {
        let mut socket = std::net::TcpStream::connect(address).unwrap();
        socket
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        socket.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 500"));
    });
    let blob = BlobRead {
        stream: Box::new(Cursor::new(b"x")),
        length: u64::from(u32::MAX) + 1,
        total: u64::from(u32::MAX) + 1,
        range: None,
    };
    let (consumed, finish) = write_once_body(
        server.recv().unwrap(),
        blob,
        &serde_json::json!({"type": "image/jpeg"}),
        "serve",
    );
    assert!(!consumed);
    finish();
    client.join().unwrap();
}
