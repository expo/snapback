//! The streaming host keeps write deadlines per frame and owns its request
//! until the terminator, including when another request is already pipelined.
#[allow(dead_code)]
#[path = "../src/host_limits.rs"] mod host_limits;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::thread;
use std::time::{Duration, Instant};
use tiny_http::{ConnectionLimits, Response, Server};

#[test]
fn heartbeat_frames_survive_waits_without_spending_the_next_write_deadline() {
    host_limits::prepare_tests();
    let limits = ConnectionLimits { write_timeout: Duration::from_millis(100), header_timeout: Duration::from_millis(100), ..ConnectionLimits::default() };
    let server = Server::http_with_limits(("127.0.0.1", 0), limits).unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let worker = thread::spawn(move || {
        let mut request = server.recv().unwrap();
        request.write_response_frame(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\n\n\r\n").unwrap();
        thread::sleep(Duration::from_millis(200));
        request.write_response_frame(b"1\r\n\n\r\n").unwrap();
        thread::sleep(Duration::from_millis(200));
        request.write_response_frame(b"2\r\n{}\r\n0\r\n\r\n").unwrap();
        request.finish_stream();
        server.recv().unwrap().respond(Response::from_string("next")).unwrap();
    });
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    client.write_all(b"GET /changes HTTP/1.1\r\nHost: localhost\r\n\r\nGET /next HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
    let mut answer = String::new();
    client.read_to_string(&mut answer).unwrap();
    worker.join().unwrap();
    assert!(answer.contains("1\r\n\n\r\n1\r\n\n\r\n2\r\n{}\r\n0\r\n\r\nHTTP/1.1 200"), "{answer}");
    assert!(answer.ends_with("next"));
}

#[test]
fn a_stalled_frame_retains_the_absolute_write_deadline_and_aborts_the_connection() {
    host_limits::prepare_tests();
    let limits = ConnectionLimits { write_timeout: Duration::from_millis(100), ..ConnectionLimits::default() };
    let server = Server::http_with_limits(("127.0.0.1", 0), limits).unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let worker = thread::spawn(move || {
        let mut request = server.recv().unwrap();
        request.write_response_frame(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\n\n\r\n").unwrap();
        thread::sleep(Duration::from_millis(200));
        let oversized_frame = vec![b'x'; 32 << 20];
        let start = Instant::now();
        assert!(request.write_response_frame(&oversized_frame).is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
        request.abort();
    });
    let mut client = TcpStream::connect(address).unwrap();
    client.write_all(b"GET /changes HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
    worker.join().unwrap(); // never read: the frame cannot drain into this peer
}
