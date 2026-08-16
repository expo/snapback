//! Explicitly enabled JSONL trace for executed `ctx.db.elevated` reads.
//!
//! The trace is fact-only: it records the handler/member/table/mode tuple at
//! the trusted host boundary and makes no policy or review judgment.
//!
//! @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated — the explicit bypass is
//!   observable at execution without changing its narrow runtime semantics.

use serde::Serialize;
use serde_json::json;
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const TRACE_ENV: &str = "SNAPBACK_ELEVATED_READ_TRACE";

struct ElevatedReadTrace {
    started: Instant,
    writer: Mutex<BufWriter<File>>,
}

static TRACE: OnceLock<Option<ElevatedReadTrace>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct ElevatedReadTraceEvent {
    event: &'static str,
    pub(crate) function: String,
    pub(crate) member: String,
    pub(crate) table: String,
    pub(crate) mode: &'static str,
    pub(crate) correlation: Option<String>,
}

#[cfg(test)]
thread_local! {
    static TEST_TRACE_CAPTURES: std::cell::RefCell<Vec<Vec<ElevatedReadTraceEvent>>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

fn configured_path(value: Option<OsString>) -> Option<PathBuf> {
    value.filter(|value| !value.is_empty()).map(PathBuf::from)
}

fn trace() -> Option<&'static ElevatedReadTrace> {
    TRACE
        .get_or_init(|| {
            let path = configured_path(std::env::var_os(TRACE_ENV))?;
            match OpenOptions::new().create(true).append(true).open(&path) {
                Ok(file) => Some(ElevatedReadTrace {
                    started: Instant::now(),
                    writer: Mutex::new(BufWriter::new(file)),
                }),
                Err(error) => {
                    eprintln!(
                        "snapback elevated-read trace disabled; could not append {}: {error}",
                        path.display()
                    );
                    None
                }
            }
        })
        .as_ref()
}

pub(crate) fn emit(
    function: &str,
    member: &str,
    table: &str,
    mode: &'static str,
    correlation: Option<&str>,
) {
    let event = ElevatedReadTraceEvent {
        event: "elevated_read",
        function: function.to_owned(),
        member: member.to_owned(),
        table: table.to_owned(),
        mode,
        correlation: correlation.map(str::to_owned),
    };

    #[cfg(test)]
    if TEST_TRACE_CAPTURES.with(|captures| {
        let mut captures = captures.borrow_mut();
        captures.last_mut().is_some_and(|events| {
            events.push(event.clone());
            true
        })
    }) {
        return;
    }

    let Some(trace) = trace() else {
        return;
    };
    let payload = json!({
        "timestamp_ms": trace.started.elapsed().as_secs_f64() * 1_000.0,
        "event": event.event,
        "function": event.function,
        "member": event.member,
        "table": event.table,
        "mode": event.mode,
        "correlation": event.correlation,
    });
    let Ok(mut line) = serde_json::to_vec(&payload) else {
        return;
    };
    line.push(b'\n');
    let mut writer = trace
        .writer
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if writer.write_all(&line).is_ok() {
        let _ = writer.flush();
    }
}

#[cfg(test)]
pub(crate) fn with_captured<T>(run: impl FnOnce() -> T) -> (T, Vec<ElevatedReadTraceEvent>) {
    TEST_TRACE_CAPTURES.with(|captures| captures.borrow_mut().push(Vec::new()));
    let result = run();
    let events = TEST_TRACE_CAPTURES.with(|captures| {
        captures
            .borrow_mut()
            .pop()
            .expect("elevated-read trace capture stack")
    });
    (result, events)
}

#[cfg(test)]
mod tests {
    use super::configured_path;
    use std::ffi::OsString;
    use std::path::PathBuf;

    #[test]
    fn trace_path_requires_explicit_nonempty_opt_in() {
        assert_eq!(configured_path(None), None);
        assert_eq!(configured_path(Some(OsString::new())), None);
        assert_eq!(
            configured_path(Some(OsString::from("elevated.jsonl"))),
            Some(PathBuf::from("elevated.jsonl"))
        );
    }
}
