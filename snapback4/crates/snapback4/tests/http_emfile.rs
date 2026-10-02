//! Exhaust only an isolated child process; preserve the test runner's limits.
#![cfg(unix)]
use std::{fs::File, io::{Read, Write}, net::TcpStream, process::Command,
    sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};

static STARTED: AtomicBool = AtomicBool::new(false);
static ACCEPT: AtomicBool = AtomicBool::new(false);
fn intake_gate() {
    STARTED.store(true, Ordering::Release);
    while !ACCEPT.load(Ordering::Acquire) { std::thread::yield_now(); }
}

struct Limit(libc::rlimit);
impl Drop for Limit {
    fn drop(&mut self) { assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &self.0) }, 0); }
}

#[test]
fn clone_emfile_closes_the_connection_and_preserves_the_listener() {
    const CHILD: &str = "SNAPBACK4_HTTP_EMFILE_CHILD";
    if std::env::var_os(CHILD).is_none() {
        for spare in 1..=3 {
            let output = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "clone_emfile_closes_the_connection_and_preserves_the_listener", "--nocapture"])
                .env(CHILD, spare.to_string()).output().unwrap();
            assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        }
        return;
    }
    // 1 = ConnectionState's clone, 2 = read/write split, 3 = abort handle.
    {
        let spare: usize = std::env::var(CHILD).unwrap().parse().unwrap();
        STARTED.store(false, Ordering::Release);
        ACCEPT.store(false, Ordering::Release);
        let limits = tiny_http::ConnectionLimits { thread_start: Some(intake_gate), ..Default::default() };
        let server = tiny_http::Server::http_with_limits(("127.0.0.1", 0), limits).unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !STARTED.load(Ordering::Acquire) {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        // Handshake queues in the kernel while accept waits at the gate.
        let mut peer = TcpStream::connect(address).unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut old = unsafe { std::mem::zeroed() };
        assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut old) }, 0);
        let restore = Limit(old);
        let low = libc::rlimit { rlim_cur: old.rlim_cur.min(128), rlim_max: old.rlim_max };
        assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &low) }, 0);
        let mut occupied = Vec::new();
        loop {
            match File::open("/dev/null") {
                Ok(file) => occupied.push(file),
                Err(error) => { assert_eq!(error.raw_os_error(), Some(libc::EMFILE)); break; }
            }
        }
        for _ in 0..spare { drop(occupied.pop().unwrap()); }
        ACCEPT.store(true, Ordering::Release);
        let mut byte = [0];
        let closed = peer.read(&mut byte);
        drop(restore);
        drop(occupied);
        assert!(matches!(closed, Ok(0)) || closed.as_ref().err().is_some_and(|e| e.kind() == std::io::ErrorKind::ConnectionReset), "clone stage {spare}: {closed:?}");
        let deadline = Instant::now() + Duration::from_secs(3);
        while server.num_connections() != 0 {
            assert!(Instant::now() < deadline, "failed clone retained its lease");
            std::thread::yield_now();
        }
        assert!(server.recv_timeout(Duration::from_millis(10)).unwrap().is_none());
        let mut healthy = TcpStream::connect(address).unwrap();
        healthy.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        healthy.write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
        server.recv_timeout(Duration::from_secs(3)).unwrap().expect("accept loop survived")
            .respond(tiny_http::Response::from_string("alive")).unwrap();
        let mut reply = String::new();
        healthy.read_to_string(&mut reply).unwrap();
        assert!(reply.ends_with("alive"), "{reply}");
    }
}
