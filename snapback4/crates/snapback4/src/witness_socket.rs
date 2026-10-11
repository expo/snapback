//! @ref LLP 3000.030#13 — the origin's socket stays owned from preparation through dev startup.
use std::{net::TcpListener, os::fd::{AsRawFd, FromRawFd, OwnedFd}, os::unix::process::CommandExt, process::Command};

const FD: &str = "SNAPBACK4_WITNESS_LISTEN_FD";

pub fn inherit(command: &mut Command, listener: &TcpListener) {
    let fd = listener.as_raw_fd();
    command.env(FD, fd.to_string());
    // Only the forked child clears CLOEXEC; concurrent parent spawns cannot
    // accidentally inherit this listener. The parent keeps it until spawn succeeds.
    unsafe { command.pre_exec(move || {
        if libc::fcntl(fd, libc::F_SETFD, 0) == -1 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }); }
}

// Called at process entry, before dispatch can spawn a checker or any other child.
// Own the descriptor even on validation failures so every return closes it.
pub fn take(verb: &str) -> Result<Option<TcpListener>, String> {
    if let Some(raw) = std::env::var_os(FD) {
        // Process entry is single-threaded. Descendants must not see a stale
        // descriptor number after exec closes the socket.
        unsafe { std::env::remove_var(FD); }
        let fd = raw.to_str().and_then(|s| s.parse::<i32>().ok()).filter(|fd| *fd > 2)
            .ok_or("invalid inherited witness listener descriptor")?;
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags == -1 { return Err(std::io::Error::last_os_error().to_string()); }
        let owned = unsafe { OwnedFd::from_raw_fd(fd) };
        if unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } == -1 { return Err(std::io::Error::last_os_error().to_string()); }
        if verb != "dev" || std::env::var("SNAPBACK4_WITNESS_DRIVER").as_deref() != Ok("1") {
            return Err("inherited witness listener is only valid for the witness's dev child".into());
        }
        let mut socket_type: libc::c_int = 0;
        let mut size = std::mem::size_of_val(&socket_type) as libc::socklen_t;
        if unsafe { libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_TYPE, (&mut socket_type as *mut libc::c_int).cast(), &mut size) } != 0 || socket_type != libc::SOCK_STREAM {
            return Err("inherited witness descriptor is not a TCP socket".into());
        }
        Ok(Some(owned.into()))
    } else { Ok(None) }
}

pub fn server(bind: &str, port: u16, inherited: Option<TcpListener>, max_connections: usize, verb: &str) -> Result<tiny_http::Server, String> {
    crate::thread_priority::request_parent()?;
    // @ref LLP 3000.036#6-idle-live-clients-must-not-cost-a-thread — a held wait is a connection too; the cap grows with the long-wait pools.
    let limits = tiny_http::ConnectionLimits { thread_start: Some(crate::thread_priority::dispatcher), max_connections, ..Default::default() };
    let result = if let Some(listener) = inherited {
        let fd = listener.as_raw_fd();
        let expected = format!("{bind}:{port}").parse::<std::net::SocketAddr>().map_err(|e| e.to_string())?;
        if !expected.ip().is_loopback() || listener.local_addr().map_err(|e| e.to_string())? != expected {
            return Err("inherited witness listener does not match the loopback origin".into());
        }
        // Darwin does not expose SO_ACCEPTCONN via getsockopt. listen is
        // idempotent on our already-listening TCP socket and never unbinds it.
        if unsafe { libc::listen(fd, 128) } != 0 { return Err(std::io::Error::last_os_error().to_string()); }
        tiny_http::Server::from_listener_with_limits(listener.into(), None, Some(limits))
    } else {
        tiny_http::Server::http_with_limits((bind, port), limits)
    };
    result.map_err(|e| match e.downcast_ref::<std::io::Error>() {
        Some(error) if error.kind() == std::io::ErrorKind::AddrInUse => crate::listen_refusal::in_use(bind, port, verb),
        _ => format!("cannot listen on {bind}:{port}: {e}"),
    })
}
