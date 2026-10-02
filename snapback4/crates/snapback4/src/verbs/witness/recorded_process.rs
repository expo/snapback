//! @ref LLP 3000.030#15 — recorded-process recovery; parent-owned children use Owned.
use super::*;

fn gone_or_error() -> Result<()> {
    let e = std::io::Error::last_os_error();
    if e.raw_os_error() == Some(libc::ESRCH) { Ok(()) } else { Err(error("E_WITNESS_PROCESS", e)) }
}
#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::os::fd::{AsRawFd, FromRawFd};
    pub(super) struct Process(File);
    impl Process {
        pub(super) fn open(pid: u32) -> Result<Option<Self>> {
            let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::pid_t, 0) } as i32;
            if fd < 0 { gone_or_error()?; return Ok(None); }
            Ok(Some(Self(unsafe { File::from_raw_fd(fd) })))
        }
        fn running(&self) -> Result<bool> {
            let mut poll = libc::pollfd { fd: self.0.as_raw_fd(), events: libc::POLLIN, revents: 0 };
            let result = unsafe { libc::poll(&mut poll, 1, 0) };
            if result < 0 { return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error())); }
            Ok(result == 0)
        }
        pub(super) fn matches(&self, record: &Value) -> Result<bool> {
            // fdinfo binds the numeric proc lookup to THIS handle. Check liveness
            // after reading birth identity: a recycled /proc PID cannot validate
            // a handle whose original process exited during that read.
            let info = fs::read_to_string(format!("/proc/self/fdinfo/{}", self.0.as_raw_fd())).map_err(|e| error("E_WITNESS_PROCESS", e))?;
            let pid = info.lines().find_map(|l| l.strip_prefix("Pid:").and_then(|s| s.trim().parse::<u32>().ok()));
            Ok(pid.is_some() && pid.map(u64::from) == record["pid"].as_u64() && pid.and_then(recovery::identity).as_ref() == Some(record) && self.running()?)
        }
        pub(super) fn signal(&self, signal: i32) -> Result<()> {
            if unsafe { libc::syscall(libc::SYS_pidfd_send_signal, self.0.as_raw_fd(), signal, std::ptr::null::<libc::siginfo_t>(), 0) } < 0 { gone_or_error()?; }
            Ok(())
        }
    }
    pub(super) fn stop(record: &Value, signal: i32) -> Result<()> {
        let Some(pid) = record["pid"].as_u64().and_then(|p| u32::try_from(p).ok()).filter(|p| *p > 0) else { return Ok(()); };
        let Some(process) = Process::open(pid)? else { return Ok(()); };
        if !process.matches(record)? { return Ok(()); }
        process.signal(signal)?;
        let end = Instant::now() + Duration::from_secs(10);
        while process.running()? && Instant::now() < end { sleep(Duration::from_millis(20)); }
        if process.running()? { process.signal(libc::SIGKILL)?; }
        let end = Instant::now() + Duration::from_secs(2);
        while process.running()? && Instant::now() < end { sleep(Duration::from_millis(20)); }
        if process.running()? { return Err(error("E_WITNESS_PROCESS", "recorded process survived pidfd kill")); }
        Ok(())
    }
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy)]
enum Observation { NotOurs, Running, Stopped }
#[cfg(any(target_os = "macos", test))]
fn stopped_sequence(mut inspect: impl FnMut() -> Observation, mut signal: impl FnMut(i32) -> Result<()>) -> Result<()> {
    if matches!(inspect(), Observation::NotOurs) { return Ok(()); }
    signal(libc::SIGSTOP)?;
    let end = Instant::now() + Duration::from_secs(2);
    loop {
        match inspect() {
            Observation::NotOurs => return Ok(()), // no further signal, including CONT
            Observation::Stopped => return signal(libc::SIGKILL),
            Observation::Running if Instant::now() < end => sleep(Duration::from_millis(10)),
            _ => return Err(error("E_WITNESS_PROCESS", "recorded process did not enter stopped state")),
        }
    }
}

pub(super) fn stop(record: &Value, signal: i32) -> Result<()> {
    #[cfg(target_os = "linux")]
    { linux::stop(record, signal) }
    #[cfg(target_os = "macos")]
    {
        let _ = signal; // non-parent recovery freezes and kills; Owned keeps graceful termination.
        let Some(pid) = record["pid"].as_u64().and_then(|p| i32::try_from(p).ok()).filter(|p| *p > 0) else { return Ok(()); };
        stopped_sequence(|| {
            let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
            let size = std::mem::size_of_val(&info) as i32;
            if unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut _, size) } != size || info.pbi_status == 5 ||
                record != &json!({ "pid": pid, "start": [info.pbi_start_tvsec, info.pbi_start_tvusec] }) { return Observation::NotOurs; }
            if info.pbi_status == 4 { Observation::Stopped } else { Observation::Running }
        }, |signal| {
            if unsafe { libc::kill(pid, signal) } < 0 { gone_or_error()?; }
            Ok(())
        })?;
        let end = Instant::now() + Duration::from_secs(2);
        while recovery::identity(pid as u32).as_ref() == Some(record) {
            if Instant::now() >= end { return Err(error("E_WITNESS_PROCESS", "recorded process survived stopped kill")); }
            sleep(Duration::from_millis(20));
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { let _ = (record, signal); Err(error("E_WITNESS_PROCESS", "recorded process recovery is unsupported on this platform")) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn witness_stopped_identity_mismatch_at_each_observation_never_authorizes_kill() {
        for observations in [vec![Observation::NotOurs], vec![Observation::Running, Observation::NotOurs], vec![Observation::Running, Observation::Running, Observation::NotOurs]] {
            let initial = observations.len(); let mut observations = observations.into_iter(); let mut signals = Vec::new();
            stopped_sequence(|| observations.next().unwrap(), |s| { signals.push(s); Ok(()) }).unwrap();
            assert_eq!(signals, if initial == 1 { vec![] } else { vec![libc::SIGSTOP] });
        }
        let mut observations = [Observation::Running, Observation::Stopped].into_iter(); let mut signals = Vec::new();
        stopped_sequence(|| observations.next().unwrap(), |s| { signals.push(s); Ok(()) }).unwrap();
        assert_eq!(signals, vec![libc::SIGSTOP, libc::SIGKILL]);
    }
    #[test]
    fn witness_recorded_birth_mismatch_spares_real_process_then_matching_record_stops_it() {
        let mut child = Owned::spawn(Command::new("sleep").arg("60")).unwrap();
        let record = recovery::identity(child.0.id()).unwrap(); let mut mismatch = record.clone(); mismatch["start"] = json!([0,0]);
        stop(&mismatch, libc::SIGTERM).unwrap(); assert!(child.status().unwrap().is_none());
        stop(&record, libc::SIGTERM).unwrap(); assert!(child.0.wait().unwrap().code() != Some(0));
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn witness_pidfd_rejects_wrong_birth_wrong_handle_and_exit_after_verification() {
        let mut child = Owned::spawn(Command::new("sleep").arg("60")).unwrap();
        let mut other = Owned::spawn(Command::new("sleep").arg("60")).unwrap();
        let record = recovery::identity(child.0.id()).unwrap();
        let handle = linux::Process::open(child.0.id()).unwrap().unwrap();
        assert!(handle.matches(&record).unwrap());
        let mut bad = record.clone(); bad["start"] = json!([0,0]);
        assert!(!handle.matches(&bad).unwrap());
        assert!(!handle.matches(&recovery::identity(other.0.id()).unwrap()).unwrap());
        child.stop(libc::SIGKILL).unwrap(); // original identity verified, now gone/reaped
        assert!(!handle.matches(&record).unwrap());
        handle.signal(libc::SIGKILL).unwrap(); // ESRCH, never a numeric PID fallback
        assert!(other.status().unwrap().is_none());
    }
}
