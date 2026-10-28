//! Phase telemetry is buffered; sink I/O happens after command completion.
pub(super) fn measure<T>(phase:&str,run:impl FnOnce()->T)->T {
    let started=snapback4_core::replay_profile::start();
    let result=run();
    if let Some(started)=started{snapback4_core::replay_profile::record(serde_json::json!({"phase":phase,"seconds":started.elapsed().as_secs_f64()}));}
    result
}
pub(crate) struct Trace(Option<std::time::Instant>);
impl Trace { pub(crate) fn new()->Self { Self(snapback4_core::replay_profile::start()) } }
impl Drop for Trace {
    fn drop(&mut self){
        if let Some(started)=self.0 { snapback4_core::replay_profile::record(serde_json::json!({"phase":"cli.total","seconds":started.elapsed().as_secs_f64()})); }
        let Some(path)=std::env::var_os("SNAPBACK4_LATENCY_TRACE")else{return;};
        let events=snapback4_core::replay_profile::take();if events.is_empty(){return;}
        let mut options=std::fs::OpenOptions::new();options.create(true).append(true);
        #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600).custom_flags(libc::O_NONBLOCK|libc::O_NOFOLLOW);}
        // FIFOs, devices, directories and symlinks are never trace sinks.
        if let Ok(mut file)=options.open(path){
            if !file.metadata().is_ok_and(|m|m.is_file()){return;}
            use std::io::Write;
            let mut bytes=Vec::new();for event in events{if serde_json::to_writer(&mut bytes,&event).is_ok(){bytes.push(b'\n');}}
            let _=file.write_all(&bytes);
        }
    }
}

/// Sequential wall-clock checkpoints; disabled unless the existing trace is enabled.
pub(super) struct Sequence(Option<std::time::Instant>);
impl Sequence {
    pub(super) fn new() -> Self { Self(snapback4_core::replay_profile::start()) }
    pub(super) fn step(&mut self, phase: &str) {
        if let Some(started) = &mut self.0 {
            snapback4_core::replay_profile::record(serde_json::json!({"phase":phase,"seconds":started.elapsed().as_secs_f64()}));
            *started = std::time::Instant::now();
        }
    }
}
