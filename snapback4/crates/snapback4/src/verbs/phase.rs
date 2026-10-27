//! Opt-in phase timings written separately from command verdicts.
pub(super) fn measure<T>(phase: &str, run: impl FnOnce() -> T) -> T {
    let Some(path) = std::env::var_os("SNAPBACK4_LATENCY_TRACE") else { return run(); };
    let started = std::time::Instant::now();
    let result = run();
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", serde_json::json!({"pid":std::process::id(),"phase":phase,"seconds":started.elapsed().as_secs_f64()}));
    }
    result
}
