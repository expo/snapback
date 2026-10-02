//! Best-effort descriptor headroom, independent of HTTP admission.
// @ref LLP 3000#http-overload-diagnostics — raise the soft limit, never the hard limit or admission caps.
use std::sync::OnceLock;

const MAX_DESCRIPTORS: u64 = 65_536;
static STARTUP: OnceLock<Adjustment> = OnceLock::new();

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Adjustment {
    inherited_soft: Option<u64>,
    hard: Option<u64>,
    target: Option<u64>,
    soft: Option<u64>,
    error: Option<String>,
}

pub(crate) fn initialize() {
    STARTUP.get_or_init(|| {
        let result = raise();
        // Once per process, including a failed attempt. Startup always proceeds.
        snapback4_core::diagnostic!("snapback4 host: {}", describe_adjustment(&result));
        result
    });
}

#[cfg(unix)]
fn current() -> std::io::Result<libc::rlimit> {
    let mut limit = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(limit)
}

fn platform_ceiling() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // Darwin's <sys/syslimits.h> OPEN_MAX (not exported by libc).
        // sysconf(_SC_OPEN_MAX) reports the *current soft limit*, not this cap.
        const OPEN_MAX: u64 = 10_240;
        let mut maximum: libc::c_int = 0;
        let mut len = std::mem::size_of_val(&maximum);
        let ok = unsafe { libc::sysctlbyname(c"kern.maxfilesperproc".as_ptr(),
            (&mut maximum as *mut libc::c_int).cast(), &mut len,
            std::ptr::null_mut(), 0) } == 0;
        return if ok && len == std::mem::size_of_val(&maximum) && maximum > 0 {
            OPEN_MAX.min(maximum as u64)
        } else { OPEN_MAX };
    }
    #[cfg(not(target_os = "macos"))]
    MAX_DESCRIPTORS
}

#[cfg(unix)]
fn adjust(limit: libc::rlimit, ceiling: u64,
    set: impl FnOnce(&libc::rlimit) -> std::io::Result<()>) -> Adjustment {
    let soft = limit.rlim_cur as u64;
    let hard = limit.rlim_max as u64;
    // Preserve a pre-existing higher soft limit and leave the hard limit intact.
    let target = soft.max(hard.min(MAX_DESCRIPTORS).min(ceiling));
    let mut result = Adjustment { inherited_soft: Some(soft), hard: Some(hard),
        target: Some(target), soft: Some(soft), error: None };
    if target > soft {
        match set(&libc::rlimit { rlim_cur: target as libc::rlim_t, rlim_max: limit.rlim_max }) {
            Ok(()) => result.soft = Some(target),
            Err(error) => result.error = Some(format!("setrlimit(RLIMIT_NOFILE): {error}")),
        }
    }
    result
}

fn raise() -> Adjustment {
    #[cfg(unix)]
    {
        match current() {
            Ok(limit) => adjust(limit, platform_ceiling(), |next| {
                if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, next) } != 0 {
                    Err(std::io::Error::last_os_error())
                } else { Ok(()) }
            }),
            Err(error) => Adjustment { inherited_soft: None, hard: None, target: None,
                soft: None, error: Some(format!("getrlimit(RLIMIT_NOFILE): {error}")) },
        }
    }
    #[cfg(not(unix))]
    Adjustment { inherited_soft: None, hard: None, target: None, soft: None,
        error: Some("RLIMIT_NOFILE unavailable on this platform".into()) }
}

fn describe_adjustment(result: &Adjustment) -> String {
    let mut text = describe();
    if let (Some(before), Some(target)) = (result.inherited_soft, result.target) {
        text.push_str(&format!("; startup soft={before} target={target}"));
    }
    if let Some(error) = &result.error {
        text.push_str(&format!("; E_HTTP_LIMIT: could not raise descriptor limit: {error}; continuing with inherited limit"));
    }
    text
}

pub(crate) fn diagnostics() -> serde_json::Value {
    serde_json::json!({ "description": STARTUP.get().map(describe_adjustment).unwrap_or_else(describe),
        "startup": STARTUP.get() })
}

pub(crate) fn describe() -> String {
    let connections = tiny_http::ConnectionLimits::default().max_connections;
    let prefix = format!("HTTP connections={connections}; uploads=2; file descriptors (this process)");
    #[cfg(unix)]
    {
        let limit = match current() {
            Ok(limit) => limit,
            Err(error) => return format!("{prefix}: unavailable ({error})"),
        };
        let word = |value| if value == libc::RLIM_INFINITY { "unlimited".into() } else { format!("{value}") };
        let mut line = format!("{prefix}: soft={} hard={}", word(limit.rlim_cur), word(limit.rlim_max));
        if limit.rlim_cur < 1024 {
            line.push_str("; E_HTTP_LIMIT: low descriptor limit; dev/serve attempt to raise it at startup");
            if limit.rlim_max < 1024 { line.push_str("; raise the shell/container/service hard NOFILE limit to at least 1024 and restart"); }
        }
        line
    }
    #[cfg(not(unix))]
    format!("{prefix}: unavailable on this platform")
}

#[cfg(test)]
pub(crate) fn prepare_tests() {
    static BEFORE_SERVERS: std::sync::Once = std::sync::Once::new();
    BEFORE_SERVERS.call_once(initialize);
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn descriptor_policy_preserves_hard_and_higher_soft_limits() {
        for (soft, hard, cap, expected) in [
            (256, 4096, MAX_DESCRIPTORS, 4096),
            (1024, u64::MAX, MAX_DESCRIPTORS, MAX_DESCRIPTORS),
            (256, u64::MAX, 10_240, 10_240),
            (256, 512, MAX_DESCRIPTORS, 512),
            (100_000, 100_000, MAX_DESCRIPTORS, 100_000),
            (u64::MAX, u64::MAX, 10_240, u64::MAX),
        ] {
            let result = adjust(libc::rlimit { rlim_cur: soft as _, rlim_max: hard as _ }, cap, |limit| {
                assert!(expected > soft);
                assert_eq!(limit.rlim_max as u64, hard);
                assert_eq!(limit.rlim_cur as u64, expected);
                Ok(())
            });
            assert_eq!(result.soft, Some(expected));
            assert!(result.error.is_none());
        }
    }
    #[test]
    fn refused_raise_keeps_the_inherited_limit_and_reports_the_os_cause() {
        let result = adjust(libc::rlimit { rlim_cur: 256, rlim_max: 4096 }, MAX_DESCRIPTORS,
            |_| Err(std::io::Error::from_raw_os_error(libc::EPERM)));
        assert_eq!(result.soft, Some(256));
        assert_eq!(result.target, Some(4096));
        let line = describe_adjustment(&result);
        assert!(line.contains("E_HTTP_LIMIT") && line.contains("continuing with inherited limit"), "{line}");
        assert!(result.error.unwrap().contains("setrlimit(RLIMIT_NOFILE)"));
    }
}

pub(crate) fn listener_error(error: std::io::Error) -> String {
    let mut message = format!("E_HTTP_LISTENER: HTTP listener stopped: {error}");
    #[cfg(unix)]
    if matches!(error.raw_os_error(), Some(libc::EMFILE | libc::ENFILE)) {
        message.push_str("; descriptor exhaustion: run `snapback4 doctor`, reduce open connections/files or raise the shell/container/service NOFILE limit, then restart dev");
    }
    message
}
