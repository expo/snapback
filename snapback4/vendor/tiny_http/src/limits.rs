//! Optional host limits. The lease covers the socket, including request-owned
//! readers/writers, and deadlines cover a complete phase rather than one read.
use std::io::{self, ErrorKind};
use std::net::Shutdown;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::connection::Connection;

#[derive(Clone, Debug)]
pub struct ConnectionLimits {
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
            max_connections: 128,
            idle_timeout: Duration::from_secs(5),
            header_timeout: Duration::from_secs(5),
            body_timeout: Duration::from_secs(30),
            write_timeout: Duration::from_secs(5),
            max_header_bytes: 32 * 1024,
        }
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

    pub(crate) fn shutdown(&self) { let _ = self.socket.shutdown(Shutdown::Both); }
}
