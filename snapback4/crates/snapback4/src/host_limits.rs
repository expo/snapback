//! Startup diagnostics; report inherited limits without changing them.
// @ref LLP 3000#http-overload-diagnostics — distinguish host limits from HTTP admission.

pub(crate) fn describe() -> String {
    let connections = tiny_http::ConnectionLimits::default().max_connections;
    let prefix = format!("HTTP connections={connections}; uploads=2; file descriptors (this process)");
    #[cfg(unix)]
    {
        let mut limit: libc::rlimit = unsafe { std::mem::zeroed() };
        if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } != 0 {
            return format!("{prefix}: unavailable ({})", std::io::Error::last_os_error());
        }
        let word = |value| if value == libc::RLIM_INFINITY { "unlimited".into() } else { format!("{value}") };
        let mut line = format!("{prefix}: soft={} hard={}", word(limit.rlim_cur), word(limit.rlim_max));
        // Each admitted socket owns several descriptors; SQLite readers and
        // workers also need headroom. This is advice, not a raised product cap.
        if limit.rlim_cur < 1024 {
            line.push_str("; E_HTTP_LIMIT: low descriptor limit; before a scale run use `ulimit -n 1024` and restart dev");
            if limit.rlim_max < 1024 { line.push_str("; raise the shell/container/service hard NOFILE limit to at least 1024 first"); }
        }
        line
    }
    #[cfg(not(unix))]
    format!("{prefix}: unavailable on this platform")
}

pub(crate) fn listener_error(error: std::io::Error) -> String {
    let mut message = format!("E_HTTP_LISTENER: HTTP listener stopped: {error}");
    #[cfg(unix)]
    if matches!(error.raw_os_error(), Some(libc::EMFILE | libc::ENFILE)) {
        message.push_str("; descriptor exhaustion: run `snapback4 doctor`, reduce open connections/files or raise the shell/container/service NOFILE limit, then restart dev");
    }
    message
}
