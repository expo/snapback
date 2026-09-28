//! Bounded operator output: request/engine threads never wait for a reader.
//! @ref LLP 3000#http-overload-diagnostics — output failures cannot stop admission.
use std::{fmt::{self, Write as _}, io::Write as _, sync::{OnceLock, mpsc::{self, SyncSender}}};

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
    static SENDER: OnceLock<SyncSender<Line>> = OnceLock::new();
    let sender = SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel::<Line>(32);
        let _ = std::thread::Builder::new().name("diagnostics".into()).spawn(move || {
            for line in receiver {
                let bytes = &line.bytes[..line.len];
                if line.stdout { let _ = std::io::stdout().lock().write_all(bytes); }
                else { let _ = std::io::stderr().lock().write_all(bytes); }
            }
        });
        sender
    });
    let mut line = Line { bytes: [0; 4096], len: 0, stdout };
    let _ = line.write_fmt(args);
    line.bytes[line.len] = b'\n'; line.len += 1;
    sender.try_send(line).is_ok()
}

#[macro_export]
macro_rules! diagnostic { ($($arg:tt)*) => {{ let _ = $crate::diagnostics::emit(format_args!($($arg)*), false); }}; }
#[macro_export]
macro_rules! diagnostic_stdout { ($($arg:tt)*) => {{ let _ = $crate::diagnostics::emit(format_args!($($arg)*), true); }}; }
