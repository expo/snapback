//! Optional host limits. The lease covers the socket, including request-owned
//! readers/writers, and deadlines cover a complete phase rather than one read.
use std::io::{self, ErrorKind};
use std::net::Shutdown;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::connection::Connection;

// @ref LLP 3000#http-overload-diagnostics — descriptor exhaustion closes the
// transport; it is not an admission refusal. Count it once per failed attempt.
static DESCRIPTOR_EXHAUSTIONS: AtomicUsize = AtomicUsize::new(0);

/// Process-wide cumulative count of EMFILE/ENFILE from accept or socket clones.
pub fn descriptor_exhaustions() -> usize {
    DESCRIPTOR_EXHAUSTIONS.load(Ordering::Relaxed)
}

pub(crate) struct AcceptBackoff(Duration);
impl AcceptBackoff {
    pub(crate) fn new() -> Self { Self(Duration::from_millis(1)) }
    pub(crate) fn reset(&mut self) { *self = Self::new(); }
    pub(crate) fn exhausted(&mut self, error: &io::Error) -> bool {
        #[cfg(unix)]
        if matches!(error.raw_os_error(), Some(libc::EMFILE | libc::ENFILE)) {
            let _ = DESCRIPTOR_EXHAUSTIONS.fetch_update(Ordering::Relaxed, Ordering::Relaxed,
                |n| Some(n.saturating_add(1)));
            std::thread::sleep(self.0);
            self.0 = (self.0 * 2).min(Duration::from_millis(100));
            return true;
        }
        let _ = error;
        false
    }
}

// @ref LLP 3000#http-overload-diagnostics — refuse before allocating a parser or thread.
// A single nonblocking, fixed-size reply cannot park the accept loop behind a
// peer that does not read. Failure to deliver it remains a transport failure.
pub(crate) fn refuse_connection(socket: Connection) -> bool {
    const BODY: &str = r#"{"denied":{"code":"E_RATE_LIMIT","family":"limit","message":"HTTP connections or request workers are occupied; wait for pending writes to settle or reduce concurrent clients before retrying","retryable":true,"guide":"assets"}}"#;
    refuse_connection_with(socket, 1, BODY)
}

/// The same nonblocking 503 with a host-chosen JSON body and Retry-After, so a
/// host can name which bounded pool refused (for example a long-wait pool).
pub(crate) fn refuse_connection_with(mut socket: Connection, retry_after: u32, body: &str) -> bool {
    use std::io::Write;
    let delivered = if socket.set_nonblocking(true).is_ok() {
        let reply = format!("HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nRetry-After: {retry_after}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Retry-After\r\n\r\n{body}", body.len());
        socket.write_all(reply.as_bytes()).is_ok()
    } else { false };
    let _ = socket.shutdown(Shutdown::Both);
    delivered
}

/// Cumulative, saturating admission counters. HTTP writes are best-effort:
/// successful writes do not prove that the peer received the response.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AdmissionRefusals {
    pub http_written: usize,
    pub http_failed: usize,
    pub tls_closed: usize,
}
impl AdmissionRefusals {
    pub fn total(self) -> usize { self.http_written.saturating_add(self.http_failed).saturating_add(self.tls_closed) }
}
#[derive(Default)]
pub(crate) struct RefusalCounters {
    http_written: AtomicUsize,
    http_failed: AtomicUsize,
    tls_closed: AtomicUsize,
}
impl RefusalCounters {
    pub(crate) fn refuse(&self, socket: Connection, tls: bool) {
        let written = if !tls { refuse_connection(socket) }
            else { let _ = socket.shutdown(Shutdown::Both); false };
        self.record(tls, written);
    }
    pub(crate) fn record(&self, tls: bool, written: bool) {
        let counter = if tls { &self.tls_closed } else if written { &self.http_written } else { &self.http_failed };
        let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| Some(n.saturating_add(1)));
    }
    pub(crate) fn snapshot(&self) -> AdmissionRefusals {
        AdmissionRefusals { http_written: self.http_written.load(Ordering::Relaxed), http_failed: self.http_failed.load(Ordering::Relaxed), tls_closed: self.tls_closed.load(Ordering::Relaxed) }
    }
}

#[derive(Clone, Debug)]
pub struct ConnectionLimits {
    /// Optional host scheduling policy for accept and connection parser threads.
    pub thread_start: Option<fn()>,
    pub max_connections: usize,
    pub idle_timeout: Duration,
    pub header_timeout: Duration,
    pub body_timeout: Duration,
    pub write_timeout: Duration,
    pub max_header_bytes: usize,
}

impl Default for ConnectionLimits {
    fn default() -> Self {
        Self {
            thread_start: None,
            max_connections: 128,
            idle_timeout: Duration::from_secs(5),
            header_timeout: Duration::from_secs(5),
            body_timeout: Duration::from_secs(30),
            write_timeout: Duration::from_secs(5),
            max_header_bytes: 32 * 1024,
        }
    }
}

impl ConnectionLimits {
    // The next request must satisfy both limits. Round down so a peer never
    // gets a longer lease than the parser actually grants it.
    pub(crate) fn keep_alive_seconds(&self) -> u64 {
        self.idle_timeout.min(self.header_timeout).as_secs()
    }
}

pub(crate) struct ConnectionLease(Arc<AtomicUsize>);
impl ConnectionLease {
    pub(crate) fn acquire(count: &Arc<AtomicUsize>, limit: usize) -> Option<Self> {
        count.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < limit).then_some(n + 1)).ok()?;
        Some(Self(count.clone()))
    }
}
impl Drop for ConnectionLease {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::AcqRel); }
}

pub(crate) struct ConnectionState {
    pub(crate) limits: ConnectionLimits,
    socket: Connection,
    read_until: Mutex<Instant>,
    write_until: Mutex<Option<Instant>>,
    _lease: ConnectionLease,
}

impl ConnectionState {
    pub(crate) fn new(socket: &Connection, limits: ConnectionLimits, lease: ConnectionLease) -> io::Result<Arc<Self>> {
        socket.set_read_timeout(Some(limits.idle_timeout))?;
        socket.set_write_timeout(Some(limits.write_timeout))?;
        Ok(Arc::new(Self {
            socket: socket.try_clone()?,
            read_until: Mutex::new(Instant::now() + limits.header_timeout),
            write_until: Mutex::new(None),
            limits,
            _lease: lease,
        }))
    }

    pub(crate) fn headers(&self) {
        *self.read_until.lock().unwrap() = Instant::now() + self.limits.header_timeout;
        *self.write_until.lock().unwrap() = None;
    }

    pub(crate) fn body(&self) {
        *self.read_until.lock().unwrap() = Instant::now() + self.limits.body_timeout;
    }

    pub(crate) fn before_read(&self) -> io::Result<()> {
        let until = *self.read_until.lock().unwrap();
        self.socket.set_read_timeout(Some(self.remaining(until)?.min(self.limits.idle_timeout)))
    }

    pub(crate) fn before_write(&self) -> io::Result<()> {
        let until = *self.write_until.lock().unwrap().get_or_insert_with(|| Instant::now() + self.limits.write_timeout);
        self.socket.set_write_timeout(Some(self.remaining(until)?.min(self.limits.write_timeout)))
    }

    pub(crate) fn continued(&self) {
        // An interim 100 response and the final response are separate write
        // phases. Time spent receiving an admitted body belongs to neither.
        *self.write_until.lock().unwrap() = None;
    }

    fn remaining(&self, until: Instant) -> io::Result<Duration> {
        let remaining = until.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            self.shutdown();
            Err(io::Error::new(ErrorKind::TimedOut, "HTTP phase deadline exceeded"))
        } else { Ok(remaining) }
    }

    pub(crate) fn refuse(&self) -> bool {
        self.socket.try_clone().is_ok_and(refuse_connection)
    }

    pub(crate) fn refuse_with(&self, retry_after: u32, body: &str) -> bool {
        self.socket.try_clone().is_ok_and(|socket| refuse_connection_with(socket, retry_after, body))
    }

    pub(crate) fn shutdown(&self) { let _ = self.socket.shutdown(Shutdown::Both); }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Read;
    use std::os::unix::net::UnixStream;
    #[test]
    fn every_refusal_counts_even_failed_delivery_and_tls() {
        let counters = RefusalCounters::default();
        for i in 0..100 {
            let (socket, mut peer) = UnixStream::pair().unwrap();
            counters.refuse(socket.into(), false);
            let mut reply = String::new(); peer.read_to_string(&mut reply).unwrap();
            assert!(reply.contains("503 Service Unavailable"));
            assert!(reply.contains("\"retryable\":true"));
            assert!(!reply.contains("\"family\":\"auth\""));
            assert_eq!(counters.snapshot().total(), i + 1);
        }
        let (socket, peer) = UnixStream::pair().unwrap(); drop(peer);
        counters.refuse(socket.into(), false);
        let (socket, mut peer) = UnixStream::pair().unwrap();
        counters.refuse(socket.into(), true);
        let mut bytes = Vec::new(); peer.read_to_end(&mut bytes).unwrap();
        assert!(bytes.is_empty(), "TLS refusal sends no cleartext");
        assert_eq!(counters.snapshot(), AdmissionRefusals { http_written: 100, http_failed: 1, tls_closed: 1 });
    }
}
