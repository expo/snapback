//! @ref LLP 3000#7 — one full read starts with a durable view, before bytes.
use super::*;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
const BOB: &str = "x-snapback-persona: bob\r\n";

#[test]
fn view_once_starts_before_bytes_memory() {
    witness(snapback4_core::Store::memory().unwrap().into());
}

#[test]
fn view_once_starts_before_bytes_sqlite() {
    let directory = ReaderTestDirectory::new();
    witness(snapback4_core::Store::open(&directory.0.join("once.sqlite")).unwrap().into());
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; SNAPBACK4_EVAL_POSTGRES"]
fn view_once_ledger_commit_postgres() {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private Postgres cluster");
    let namespace = format!("sb4_once_{:x}", snapback4_core::ids::seed());
    // @ref LLP 3000.009.001.000#3.4 — PG has the ledger, but public asset
    // schemas/blob delivery remain P1b. Exercise its real common-engine commit
    // and a new connection's duplicate refusal without bypassing that fence.
    let store = snapback4_core::store_port::AnyStore::create_postgres(&connection, &namespace).unwrap();
    let mut engine = Engine::new(store, Default::default(), []).unwrap();
    engine.store().record_asset(&snapback4_core::assets::Asset {
        id: "once".into(), owner: "dev:bob".into(),
        kind: snapback4_core::assets::AssetKind::Image,
        content_type: "image/png".into(), bytes: PNG.len() as u64,
        width: Some(1), height: Some(1), duration: None,
        created_at: 1, home: None, released_at: None, name: None,
    }).unwrap();
    engine.record_asset_view("dev:bob", "once", 1).unwrap();
    drop(engine);
    let store = snapback4_core::store_port::AnyStore::open_postgres(&connection, &namespace).unwrap();
    let mut reopened = Engine::open(store).unwrap();
    assert_eq!(reopened.record_asset_view("dev:bob", "once", 2).unwrap_err().refusal().code, "E_ASSET_VIEWED");
    reopened.record_asset_view("dev:alice", "once", 2).unwrap();
}

fn witness(store: snapback4_core::store_port::AnyStore) {
    let source = SOURCE.replace("photos: [image <=10000000] <=4\n  read", "photos: [image <=10000000 once] <=4\n  read");
    let host = Host::with_store(true, store, &source);
    let asset = upload(&host);
    mutate(&host, "post", json!({"photos":[asset]}));
    let id = asset["id"].as_str().unwrap();
    let path = format!("/assets/{id}");

    // Every Range header is a probe, including selectors that ordinary assets ignore.
    for selector in ["bytes=0-0", "bytes=999-", "garbage"] {
        let response = host.request("GET", &path, &format!("{BOB}Range: {selector}\r\n"), "");
        assert_eq!(status(&response), 416, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_ASSET_RANGE");
        assert!(lock(&host.shared.engine).asset_access("dev:bob", id, host.shared.now()).is_ok());
    }

    // An earlier response can abort a parsed pipelined request before its admission.
    // Use the transport's actual shared abort state, without timing a socket close.
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut socket = TcpStream::connect(server.server_addr().to_ip().unwrap()).unwrap();
    socket.set_read_timeout(Some(CLIENT_TIMEOUT)).unwrap();
    write!(socket, "GET /barrier HTTP/1.1\r\nHost: localhost\r\n\r\nGET {path} HTTP/1.1\r\nHost: localhost\r\n{BOB}Connection: close\r\n\r\n").unwrap();
    let first = server.recv_timeout(CLIENT_TIMEOUT).unwrap().unwrap();
    let aborted = server.recv_timeout(CLIENT_TIMEOUT).unwrap().unwrap();
    first.abort();
    assert!(aborted.is_aborted());
    crate::assets::serve(aborted, id, &host.shared);
    let mut response = Vec::new();
    socket.read_to_end(&mut response).unwrap();
    assert!(response.is_empty());
    assert!(lock(&host.shared.engine).asset_access("dev:bob", id, host.shared.now()).is_ok());

    // Stop the door after the durable commit but before it can send even headers.
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let resume = Mutex::new(resume);
    *lock(&host.shared.asset_delivery) = Some(Arc::new(move || {
        entered.send(()).unwrap();
        lock(&resume).recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    let mut socket = TcpStream::connect(host.address).unwrap();
    socket.set_read_timeout(Some(CLIENT_TIMEOUT)).unwrap();
    write!(socket, "GET {path} HTTP/1.1\r\nHost: localhost\r\n{BOB}Connection: close\r\n\r\n").unwrap();
    started.recv_timeout(CLIENT_TIMEOUT).unwrap();
    let viewed = lock(&host.shared.engine).asset_access("dev:bob", id, host.shared.now()).unwrap_err();
    assert_eq!(viewed.refusal().code, "E_ASSET_VIEWED", "committed before delivery");
    socket.set_nonblocking(true).unwrap();
    let before_delivery = socket.peek(&mut [0u8; 1]);
    socket.set_nonblocking(false).unwrap();
    release.send(()).unwrap();
    *lock(&host.shared.asset_delivery) = None;
    assert_eq!(before_delivery.unwrap_err().kind(), std::io::ErrorKind::WouldBlock, "no response bytes precede commit acknowledgement");
    let mut response = Vec::new();
    socket.read_to_end(&mut response).unwrap();
    let header_end = response.windows(4).position(|bytes| bytes == b"\r\n\r\n").unwrap() + 4;
    let headers = std::str::from_utf8(&response[..header_end]).unwrap();
    assert_eq!(status(headers), 200, "{headers}");
    assert!(headers.to_ascii_lowercase().contains(&format!("content-length: {}\r\n", PNG.len())));
    assert_eq!(&response[header_end..], PNG);
    fetch(&host, &asset, "bob", 410);
    // The home rule still admits only Bob; upload ownership cannot bypass it.
    fetch(&host, &asset, "alice", 404);
}
