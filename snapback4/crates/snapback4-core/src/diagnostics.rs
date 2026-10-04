//! Bounded operator output: request/engine threads never wait for a reader.
//! @ref LLP 3000#http-overload-diagnostics — output failures cannot stop admission.
use std::{fmt::{self, Write as _}, sync::{OnceLock, mpsc::{self, SyncSender}}, time::{Duration, Instant}};

static THREAD_START: OnceLock<fn()> = OnceLock::new();
static SENDER: OnceLock<SyncSender<Output>> = OnceLock::new();
enum Output { Line(Line), Drain(SyncSender<()>) }
/// The host can supply a scheduling hint before its first diagnostic.
pub fn set_thread_start(start: fn()) { let _ = THREAD_START.set(start); }

struct Line { bytes: [u8; 4096], len: usize, stdout: bool }
impl fmt::Write for Line {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        let mut size = value.len().min(self.bytes.len() - 1 - self.len);
        while !value.is_char_boundary(size) { size -= 1; }
        self.bytes[self.len..self.len + size].copy_from_slice(&value.as_bytes()[..size]);
        self.len += size;
        Ok(())
    }
}

/// One writer and at most 32 fixed-size lines for the process. A full queue
/// drops output; a broken destination returns an error, never a print panic.
/// Cumulative admission counters live independently of this best-effort sink.
pub fn emit(args: fmt::Arguments<'_>, stdout: bool) -> bool {
    let sender = SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel(32);
        let _ = std::thread::Builder::new().name("diagnostics".into()).spawn(move || {
            if let Some(start) = THREAD_START.get() { start(); }
            write_output(receiver, std::io::stdout(), std::io::stderr());
        });
        sender
    });
    let mut line = Line { bytes: [0; 4096], len: 0, stdout };
    let _ = line.write_fmt(args);
    line.bytes[line.len] = b'\n'; line.len += 1;
    sender.try_send(Output::Line(line)).is_ok()
}

fn write_output(receiver: mpsc::Receiver<Output>, mut stdout: impl std::io::Write, mut stderr: impl std::io::Write) {
    for output in receiver {
        match output {
            Output::Line(line) => {
                let bytes = &line.bytes[..line.len];
                if line.stdout { let _ = stdout.write_all(bytes); }
                else { let _ = stderr.write_all(bytes); }
            }
            Output::Drain(ack) => {
                let _ = stdout.flush();
                let _ = stderr.flush();
                let _ = ack.try_send(());
            }
        }
    }
}

/// Lifecycle boundary only: attempt queued output before serving requests or
/// returning from a release command, after engine/lease custody has ended.
/// Queue admission and acknowledgement share one deadline. Full/stalled/broken
/// destinations remain best-effort; request and engine threads must never drain.
// @ref LLP 3000#contended-read-serving — bounded lifecycle ordering, without changing writer QoS.
pub fn drain(timeout: Duration) -> bool {
    SENDER.get().is_none_or(|sender| drain_sender(sender, timeout))
}

fn drain_sender(sender: &SyncSender<Output>, timeout: Duration) -> bool {
    let started = Instant::now();
    let (ack, received) = mpsc::sync_channel(1);
    let mut barrier = Output::Drain(ack);
    loop {
        match sender.try_send(barrier) {
            Ok(()) => return received.recv_timeout(timeout.saturating_sub(started.elapsed())).is_ok(),
            Err(mpsc::TrySendError::Disconnected(_)) => return false,
            Err(mpsc::TrySendError::Full(output)) => barrier = output,
        }
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() { return false; }
        std::thread::sleep(remaining.min(Duration::from_millis(1)));
    }
}

#[macro_export]
macro_rules! diagnostic { ($($arg:tt)*) => {{ let _ = $crate::diagnostics::emit(format_args!($($arg)*), false); }}; }
#[macro_export]
macro_rules! diagnostic_stdout { ($($arg:tt)*) => {{ let _ = $crate::diagnostics::emit(format_args!($($arg)*), true); }}; }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drain_orders_both_destinations_and_flushes_before_ack() {
        struct Sink(bool, mpsc::Sender<(bool, Vec<u8>)>);
        impl std::io::Write for Sink {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.1.send((self.0, bytes.to_vec())).unwrap(); Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { self.1.send((self.0, vec![])).unwrap(); Ok(()) }
        }
        let (sender, receiver) = mpsc::sync_channel(32);
        let (written, observed) = mpsc::channel();
        let writer = std::thread::spawn(move || write_output(receiver, Sink(true, written.clone()), Sink(false, written)));
        for stdout in [true, false] {
            let mut line = Line { bytes: [0; 4096], len: 0, stdout };
            line.write_str("banner\n").unwrap();
            sender.try_send(Output::Line(line)).ok().unwrap();
        }
        assert!(drain_sender(&sender, Duration::from_secs(3)));
        assert_eq!(observed.try_iter().collect::<Vec<_>>(), vec![(true, b"banner\n".to_vec()), (false, b"banner\n".to_vec()), (true, vec![]), (false, vec![])]);
        drop(sender); writer.join().unwrap();
    }
    #[test]
    fn drain_bounds_a_stalled_writer_and_a_full_queue() {
        let (sender, _receiver) = mpsc::sync_channel(1);
        for _ in 0..2 {
            let started = Instant::now();
            // First: queued barrier never acknowledged. Second: queue full.
            assert!(!drain_sender(&sender, Duration::from_millis(20)));
            assert!(started.elapsed() < Duration::from_secs(3));
        }
    }
    #[test]
    fn drain_does_not_wait_for_a_disconnected_writer() {
        let (sender, receiver) = mpsc::sync_channel(1);
        drop(receiver);
        assert!(!drain_sender(&sender, Duration::from_secs(3)));
    }
}
