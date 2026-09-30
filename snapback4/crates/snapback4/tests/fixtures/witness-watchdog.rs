//! Independent fixture guard: a broken driver deadline must fail, not hang.
use std::{fs::{self, File}, io, os::unix::process::{CommandExt, ExitStatusExt},
    path::{Path, PathBuf}, process::{Child, Command, ExitStatus, Output, Stdio},
    thread::sleep, time::{Duration, Instant}};

// Preparation has one 120-second driver step, plus 30 seconds of scheduling
// slack. Other scenarios include several steps and backend restarts.
pub const PREPARATION_GUARD: Duration = Duration::from_secs(150);
pub const SCENARIO_GUARD: Duration = Duration::from_secs(600);

pub struct Guarded {
    child: Child,
    stdout: PathBuf,
    stderr: PathBuf,
    end: Instant,
    reaped: bool,
}
impl Guarded {
    pub fn spawn(command: &mut Command, directory: &Path, budget: Duration) -> Self {
        let stdout = directory.join("driver-stdout.log");
        let stderr = directory.join("driver-stderr.log");
        // Files cannot hold wait_with_output open through an inherited pipe.
        let child = command.process_group(0).stdin(Stdio::null())
            .stdout(File::create(&stdout).unwrap()).stderr(File::create(&stderr).unwrap())
            .spawn().unwrap();
        Self { child, stdout, stderr, end: Instant::now() + budget, reaped: false }
    }

    fn status(&self) -> io::Result<Option<ExitStatus>> {
        // Keep the unreaped leader's PID reserved until group cleanup, so even
        // an early driver exit cannot let us signal a reused process group.
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        if unsafe { libc::waitid(libc::P_PID, self.child.id(), &mut info,
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) } != 0 {
            return Err(io::Error::last_os_error());
        }
        if unsafe { info.si_pid() } == 0 { return Ok(None); }
        let code = unsafe { info.si_status() };
        Ok(Some(ExitStatus::from_raw(if info.si_code == libc::CLD_EXITED { code << 8 } else { code })))
    }

    fn cleanup(&mut self) {
        if self.reaped { return; }
        // Let the real driver's interrupt path stop and reap Owned children.
        // This is independent of the simctl deadline tested by preparation.
        unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM); }
        let end = Instant::now() + Duration::from_secs(15);
        while matches!(self.status(), Ok(None)) && Instant::now() < end {
            sleep(Duration::from_millis(20));
        }
        // A broken interrupt/cleanup path also cannot leave a fixture child
        // running. All fixture executables inherit this dedicated group.
        unsafe { libc::kill(-(self.child.id() as i32), libc::SIGKILL); }
        self.child.wait().expect("reap fixture driver");
        self.reaped = true;
    }

    pub fn finish(&mut self) -> Output {
        let status = loop {
            if let Some(status) = self.status().expect("observe fixture driver") { break Some(status); }
            if Instant::now() >= self.end { break None; }
            sleep(Duration::from_millis(20));
        };
        // On ordinary exit, keep the group owned until the caller's assertions
        // finish. Killing a leaked backend here would hide a driver-cleanup
        // regression from the existing port-refusal assertions.
        if status.is_none() { self.cleanup(); }
        let stdout = fs::read(&self.stdout).unwrap();
        let stderr = fs::read(&self.stderr).unwrap();
        let status = status.unwrap_or_else(|| panic!(
            "WITNESS_FIXTURE_WATCHDOG: driver exceeded independent fixture deadline; owned group stopped and driver reaped\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&stdout), String::from_utf8_lossy(&stderr)));
        Output { status, stdout, stderr }
    }
}
impl Drop for Guarded { fn drop(&mut self) { self.cleanup(); } }
