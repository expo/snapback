//! A userspace TCP delay proxy standing in for `tc netem` (no root on the
//! host). Each accepted connection gets one reader and one writer thread per
//! direction. The reader stamps every chunk it receives with
//! `arrival + one_way` and hands it to the writer in order; the writer waits
//! until that deadline and forwards it. Ordering is preserved per direction,
//! and chunks pipeline (a later chunk is not delayed by an earlier one's wait).
//! A zero delay keeps the same path, so the zero-delay cell measures the
//! proxy's own overhead. Writer threads set a 1 ns timer slack (the default
//! 50 µs slack is added to every sleep), sleep until ~100 µs before the
//! deadline and spin the remainder, because `thread::sleep` still overshoots.
use std::{
    io::{Read, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

pub struct Proxy {
    pub port: u16,
    pub one_way: Duration,
}

impl Proxy {
    /// Listen on 127.0.0.1 at an ephemeral port and forward to `upstream`.
    /// Threads are detached; the process exit ends them.
    pub fn start(upstream: SocketAddr, one_way: Duration) -> Proxy {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind proxy");
        let port = listener.local_addr().unwrap().port();
        thread::Builder::new()
            .name("proxy-accept".into())
            .spawn(move || {
                for client in listener.incoming() {
                    let Ok(client) = client else { continue };
                    let Ok(server) = TcpStream::connect(upstream) else {
                        let _ = client.shutdown(Shutdown::Both);
                        continue;
                    };
                    client.set_nodelay(true).unwrap();
                    server.set_nodelay(true).unwrap();
                    pump(client.try_clone().unwrap(), server.try_clone().unwrap(), one_way);
                    pump(server, client, one_way);
                }
            })
            .unwrap();
        Proxy { port, one_way }
    }

    pub fn url(&self) -> String {
        format!("host=127.0.0.1 port={} user=sb4_eval dbname=postgres", self.port)
    }
}

fn wait_until(deadline: Instant) {
    let now = Instant::now();
    if deadline <= now {
        return;
    }
    let left = deadline - now;
    if left > Duration::from_micros(100) {
        thread::sleep(left - Duration::from_micros(100));
    }
    while Instant::now() < deadline {
        std::hint::spin_loop();
    }
}

fn pump(mut from: TcpStream, mut to: TcpStream, one_way: Duration) {
    let (tx, rx) = mpsc::channel::<(Instant, Vec<u8>)>();
    thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match from.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send((Instant::now() + one_way, buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });
    thread::spawn(move || {
        // SAFETY: prctl(PR_SET_TIMERSLACK) only changes this thread's slack.
        unsafe { libc::prctl(libc::PR_SET_TIMERSLACK, 1 as libc::c_ulong, 0, 0, 0) };
        while let Ok((deadline, chunk)) = rx.recv() {
            wait_until(deadline);
            if to.write_all(&chunk).is_err() {
                break;
            }
        }
        let _ = to.shutdown(Shutdown::Write);
    });
}
