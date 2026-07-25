// Deterministic upstream stream source for the single-instance-container-vm.v1
// remote drill (LLP 0075 protocol fixture; LLP 0076 decision 7).
//
// This is the machine-local twin of the Node source embedded in
// tests/acceptance/local-streaming.mjs: the drill instrument runs off-box, so
// the deterministic upstream must live inside the Fly Machine where the
// snapback action executor can reach it. It binds loopback only — it is never
// exposed through the Fly proxy — and the instrument passes its loopback URL
// as ordinary action-argument data.
//
// Endpoints (byte-for-byte the local fixture's semantics):
//   GET /stream    16 chunks "chunk-NN\n" (9 bytes each), 80 ms apart, EOF.
//   GET /slow      headers immediately, 6 s silence, then "late", EOF.
//   *   /failed    read the request head, then close without responding.
//   *   /ambiguous read the request head, then close without responding.
//
// std-only; compiled with a bare `rustc -O` in the drill Dockerfile.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

fn main() {
    let port: u16 = std::env::var("DRILL_SOURCE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(4488);
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap_or_else(|error| {
        panic!(
            "drill stream source failed to bind loopback:{}: {}",
            port, error
        )
    });
    eprintln!("[drill-stream-source] listening on 127.0.0.1:{}", port);
    for stream in listener.incoming() {
        match stream {
            Ok(socket) => {
                thread::spawn(move || {
                    let _ = handle(socket);
                });
            }
            Err(error) => eprintln!("[drill-stream-source] accept failed: {}", error),
        }
    }
}

fn handle(mut socket: TcpStream) -> std::io::Result<()> {
    socket.set_read_timeout(Some(Duration::from_secs(10)))?;
    let path = read_request_path(&mut socket)?;
    match path.as_str() {
        "/stream" => {
            write_chunked_head(&mut socket)?;
            for index in 0..16 {
                let body = format!("chunk-{index:02}\n");
                write_chunk(&mut socket, body.as_bytes())?;
                thread::sleep(Duration::from_millis(80));
            }
            finish_chunked(&mut socket)
        }
        "/slow" => {
            write_chunked_head(&mut socket)?;
            thread::sleep(Duration::from_secs(6));
            write_chunk(&mut socket, b"late")?;
            finish_chunked(&mut socket)
        }
        "/failed" | "/ambiguous" => {
            // Close without any response bytes: the upstream request was
            // received (initiation is host-provable) but transport is lost
            // before a status line exists.
            Ok(())
        }
        _ => {
            socket.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
        }
    }
}

/// Read until the end of the request head and return the request-line path.
fn read_request_path(socket: &mut TcpStream) -> std::io::Result<String> {
    let mut head = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 512];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
        if head.len() > 16 * 1024 {
            break;
        }
        let read = socket.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        head.extend_from_slice(&buffer[..read]);
    }
    let text = String::from_utf8_lossy(&head);
    let path = text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/")
        .to_owned();
    Ok(path)
}

fn write_chunked_head(socket: &mut TcpStream) -> std::io::Result<()> {
    socket.set_nodelay(true)?;
    socket.write_all(
        b"HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n",
    )?;
    socket.flush()
}

fn write_chunk(socket: &mut TcpStream, body: &[u8]) -> std::io::Result<()> {
    socket.write_all(format!("{:x}\r\n", body.len()).as_bytes())?;
    socket.write_all(body)?;
    socket.write_all(b"\r\n")?;
    socket.flush()
}

fn finish_chunked(socket: &mut TcpStream) -> std::io::Result<()> {
    socket.write_all(b"0\r\n\r\n")?;
    socket.flush()
}
