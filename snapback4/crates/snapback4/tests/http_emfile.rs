//! Exhaust only an isolated child process; preserve the test runner's limits.
#![cfg(unix)]
#[allow(dead_code)]
#[path = "../src/host_limits.rs"] mod host_limits;
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
        host_limits::prepare_tests();
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

// A parent keeps the backlog replenished without consuming the server child's
// descriptor slots. Measure the accept thread itself, not producer/test CPU.
#[cfg(target_os = "linux")]
static ACCEPT_CLOCK: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "linux")]
fn measured_intake_gate() {
    let mut clock = 0;
    assert_eq!(unsafe { libc::pthread_getcpuclockid(libc::pthread_self(), &mut clock) }, 0);
    ACCEPT_CLOCK.store(clock, Ordering::Release);
    intake_gate();
}
#[cfg(target_os = "linux")]
fn accept_cpu() -> Duration {
    let mut time: libc::timespec = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::clock_gettime(ACCEPT_CLOCK.load(Ordering::Acquire), &mut time) }, 0);
    Duration::new(time.tv_sec as u64, time.tv_nsec as u32)
}

#[cfg(target_os = "linux")]
#[test]
fn descriptor_exhaustion_backlog_backs_off_and_recovers() {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    const CHILD: &str = "SNAPBACK4_HTTP_BACKLOG_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let mut failures = Vec::new();
        for spare in 0..=3 {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "descriptor_exhaustion_backlog_backs_off_and_recovers", "--nocapture"])
                .env(CHILD, spare.to_string()).stdin(Stdio::piped()).stdout(Stdio::piped())
                .stderr(Stdio::piped()).spawn().unwrap();
            let mut stdout = BufReader::new(child.stdout.take().unwrap());
            let address = loop {
                let mut line = String::new();
                assert!(stdout.read_line(&mut line).unwrap() > 0, "child exited before publishing listener");
                if let Some(address) = line.trim().strip_prefix("FDL_ADDRESS=") { break address.parse().unwrap(); }
            };
            // A nonempty backlog exists before exhaustion begins; continuously
            // refill it, including while the child has no free descriptor.
            for _ in 0..32 { drop(TcpStream::connect(address).unwrap()); }
            writeln!(child.stdin.as_mut().unwrap(), "ready").unwrap();
            let deadline = Instant::now() + Duration::from_secs(15);
            while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
                drop(TcpStream::connect_timeout(&address, Duration::from_millis(20)));
            }
            if child.try_wait().unwrap().is_none() { child.kill().unwrap(); }
            let mut log = String::new(); stdout.read_to_string(&mut log).unwrap();
            let output = child.wait_with_output().unwrap();
            if !output.status.success() {
                failures.push(format!("spare={spare}: {log}\n{}", String::from_utf8_lossy(&output.stderr)));
            }
            print!("{log}");
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
        return;
    }
    host_limits::prepare_tests();
    let spare: usize = std::env::var(CHILD).unwrap().parse().unwrap();
    let server = tiny_http::Server::http_with_limits(("127.0.0.1", 0), tiny_http::ConnectionLimits {
        thread_start: Some(measured_intake_gate), ..Default::default()
    }).unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !STARTED.load(Ordering::Acquire) {
        assert!(Instant::now() < deadline, "accept thread did not start");
        std::thread::yield_now();
    }
    println!("FDL_ADDRESS={address}");
    let mut ready = String::new(); std::io::stdin().read_line(&mut ready).unwrap();
    assert_eq!(ready.trim(), "ready");
    let mut old = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut old) }, 0);
    let restore = Limit(old);
    let low = libc::rlimit { rlim_cur: 128.min(old.rlim_cur), rlim_max: old.rlim_max };
    assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &low) }, 0);
    let mut occupied = Vec::new();
    loop {
        match File::open("/dev/null") {
            Ok(file) => occupied.push(file),
            Err(error) => { assert_eq!(error.raw_os_error(), Some(libc::EMFILE)); break; }
        }
    }
    for _ in 0..spare { drop(occupied.pop().unwrap()); }
    let before = accept_cpu();
    let start = Instant::now();
    ACCEPT.store(true, Ordering::Release);
    std::thread::sleep(Duration::from_secs(1));
    let cpu = accept_cpu() - before;
    let wall = start.elapsed();
    let events = tiny_http::descriptor_exhaustions();
    let diagnostics = host_limits::diagnostics();
    let refusals = server.admission_refusals();
    // Always restore even if an assertion fails, so cleanup can wake accept.
    drop(restore);
    drop(occupied);
    println!("spare={spare}: accept CPU={cpu:?}, wall={wall:?}, descriptor exhaustions={events}");
    assert!((2..=32).contains(&events), "unpaced intake or no sustained pressure: {events}");
    assert!(cpu < Duration::from_millis(100), "accept consumed {cpu:?} during {wall:?}");
    assert_eq!(diagnostics["descriptorExhaustions"], events);
    assert!(diagnostics["description"].as_str().unwrap().contains(&format!("descriptor_exhaustions={events}")));
    assert_eq!(refusals.total(), 0, "exhaustion is a transport close");
    // Producer sockets send no request bytes. Only this recovered client can
    // enter the request queue, so an old listener error cannot masquerade as recovery.
    let mut healthy = TcpStream::connect(address).unwrap();
    healthy.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    healthy.write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
    server.recv_timeout(Duration::from_secs(3)).unwrap().expect("accept loop resumed")
        .respond(tiny_http::Response::from_string("recovered")).unwrap();
    let mut reply = String::new(); healthy.read_to_string(&mut reply).unwrap();
    assert!(reply.ends_with("recovered"), "{reply}");
}
