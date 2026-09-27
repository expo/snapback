//! Independent wire fixture: builds HMAC transcripts without calling production protocol code.
use super::*;
use hmac::{Hmac, Mac};
use std::os::unix::{ffi::OsStrExt, fs::MetadataExt};
pub const CLIENT: &str = "x-snapback-token-client-nonce";
pub const SERVER: &str = "x-snapback-token-server-nonce";
pub const PROOF: &str = "x-snapback-token-proof";
pub fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }
pub fn decode(s: &str) -> Vec<u8> { s.as_bytes().chunks_exact(2).map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap()).collect() }
pub fn body(p: &Project) -> Value {
    let store = p.store().canonicalize().unwrap(); let meta = fs::metadata(&store).unwrap();
    let identity = serde_json::to_vec(&(hex(store.as_os_str().as_bytes()), meta.dev(), meta.ino())).unwrap();
    json!({"service":"ranker", "days":2, "store":hex(&Sha256::digest(identity))})
}
pub fn binding(body: &Value) -> Vec<u8> { serde_json::to_vec(&(1, &body["service"], &body["days"], &body["store"])).unwrap() }
pub fn tag(key: &str, domain: &str, first: &str, second: &str, body: &Value) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes()).unwrap();
    mac.update(domain.as_bytes()); mac.update(&decode(first)); mac.update(&decode(second)); mac.update(&binding(body));
    hex(&mac.finalize().into_bytes())
}
pub fn challenge(address: SocketAddr, body: &Value) -> (String, Value) {
    let mut bytes = [0; 32]; fs::File::open("/dev/urandom").unwrap().read_exact(&mut bytes).unwrap();
    let client = hex(&bytes);
    let (status, reply) = request(address, address, "/dev/token", &format!("{CLIENT}: {client}\r\n"), &body.to_string());
    assert_eq!(status, 200, "{reply}");
    (client, reply)
}
pub fn headers(key: &str, client: &str, server: &str, body: &Value) -> String {
    let proof = tag(key, "snapback4-token-client", server, client, body);
    format!("{CLIENT}: {client}\r\n{SERVER}: {server}\r\n{PROOF}: {proof}\r\n")
}
pub fn read_http(socket: &mut TcpStream) -> String {
    socket.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let mut request = Vec::new(); let mut byte = [0];
    while !request.ends_with(b"\r\n\r\n") { socket.read_exact(&mut byte).unwrap(); request.push(byte[0]); assert!(request.len() < 8192); }
    let head = String::from_utf8(request.clone()).unwrap();
    let len: usize = head.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|n| n.trim().parse().unwrap())).unwrap();
    let mut body = vec![0; len]; socket.read_exact(&mut body).unwrap(); request.extend(body);
    String::from_utf8(request).unwrap()
}
pub fn wire_header<'a>(wire: &'a str, name: &str) -> &'a str {
    wire.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.trim())).unwrap()
}
pub fn send_raw(address: SocketAddr, wire: &str) -> String {
    let mut socket = TcpStream::connect(address).unwrap(); socket.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    socket.write_all(wire.as_bytes()).unwrap(); let mut reply = String::new(); socket.read_to_string(&mut reply).unwrap(); reply
}
pub fn forward_request(wire: &str, address: SocketAddr) -> String {
    let (head, body) = wire.split_once("\r\n\r\n").unwrap();
    let head = head.lines().map(|line| if line.to_ascii_lowercase().starts_with("host:") { format!("Host: {address}") } else { line.into() }).collect::<Vec<_>>().join("\r\n");
    format!("{head}\r\n\r\n{body}")
}
