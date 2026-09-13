//! Process-local memory policy for the isolated helper.
//!
//! Linux receives a hard address-space/data limit before any fixture probe or
//! attacker-controlled decode. Darwin's rlimits are not an enforceable RSS
//! ceiling on the supported host, so the parent must retain a sampled direct-
//! child RSS watchdog; that sampled control is intentionally not described as
//! a hard ceiling.

use crate::protocol::Refusal;

pub const HELPER_MEMORY_BYTES: u64 = 512 * 1024 * 1024;

// @ref LLP 1006#14a-codecs-live-in-a-separate-executable-the-type-does-not —
// decoder allocation is process-isolated and receives a hard platform limit
// where the host exposes one; Darwin still requires the parent's RSS sampler.
pub fn install() -> Result<(), Refusal> {
    install_platform().map_err(|error| {
        Refusal::new(
            "E_OWNER_MEDIA_MEMORY_POLICY",
            "owner",
            format!("could not install the media helper memory policy: {error}"),
            "run the helper on a supported host with process memory limits",
            "assets/helper",
        )
    })
}

#[cfg(target_os = "linux")]
fn install_platform() -> std::io::Result<()> {
    let install_resource = |resource| {
        let mut existing = std::mem::MaybeUninit::<libc::rlimit>::uninit();
        if unsafe { libc::getrlimit(resource, existing.as_mut_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        let existing = unsafe { existing.assume_init() };
        let ceiling = (HELPER_MEMORY_BYTES as libc::rlim_t).min(existing.rlim_max);
        let limit = libc::rlimit {
            rlim_cur: ceiling,
            rlim_max: ceiling,
        };
        if unsafe { libc::setrlimit(resource, &limit) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    };
    let mut installed = false;
    let mut last_error = None;
    for resource in [libc::RLIMIT_AS, libc::RLIMIT_DATA] {
        match install_resource(resource) {
            Ok(()) => installed = true,
            Err(error) => last_error = Some(error),
        }
    }
    installed.then_some(()).ok_or_else(|| {
        last_error.unwrap_or_else(|| std::io::Error::other("no memory rlimit is available"))
    })
}

#[cfg(target_os = "macos")]
fn install_platform() -> std::io::Result<()> {
    // Darwin 25 accepts RLIMIT_AS while preventing dyld startup under useful
    // values and returns EINVAL for RLIMIT_DATA on the qualified host. A
    // best-effort data limit may become useful on another Darwin revision, but
    // callers must continue to treat the parent RSS sampler as the protection.
    let limit = libc::rlimit {
        rlim_cur: HELPER_MEMORY_BYTES as libc::rlim_t,
        rlim_max: HELPER_MEMORY_BYTES as libc::rlim_t,
    };
    let _ = unsafe { libc::setrlimit(libc::RLIMIT_DATA, &limit) };
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn install_platform() -> std::io::Result<()> {
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::process::Command;

    const CHILD: &str = "SNAPBACK3_MEDIA_MEMORY_POLICY_CHILD";

    #[test]
    fn memory_policy_child_probe() {
        if std::env::var_os(CHILD).is_none() {
            return;
        }
        install().unwrap();
        let mut hard_limits = 0;
        for resource in [libc::RLIMIT_AS, libc::RLIMIT_DATA] {
            let mut limit = std::mem::MaybeUninit::<libc::rlimit>::uninit();
            if unsafe { libc::getrlimit(resource, limit.as_mut_ptr()) } == 0 {
                let limit = unsafe { limit.assume_init() };
                if limit.rlim_max <= HELPER_MEMORY_BYTES as libc::rlim_t {
                    assert!(limit.rlim_cur <= limit.rlim_max);
                    hard_limits += 1;
                }
            }
        }
        assert!(hard_limits > 0);
    }

    #[test]
    fn linux_hard_limit_is_installed_in_a_disposable_process() {
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "memory::tests::memory_policy_child_probe"])
            .env(CHILD, "1")
            .status()
            .unwrap();
        assert!(status.success());
    }
}
