#[cfg(unix)]
use snapback_kernel::process_bound_identity::ProcessBoundIdentity;
#[cfg(unix)]
use snapback_kernel::storage::LocalDatabase;
use snapback_row_attack_fixtures::report_observation;
#[cfg(unix)]
use std::path::Path;

#[cfg(unix)]
const ATTACK_ACCEPTED: i32 = 42;
#[cfg(unix)]
const PRIMITIVE_FAILED_OPEN: i32 = 43;

#[cfg(unix)]
fn main() -> Result<(), String> {
    let mut arguments = std::env::args_os();
    let _executable = arguments.next();
    if arguments.next().as_deref() == Some(std::ffi::OsStr::new("--restart-child")) {
        let path = arguments
            .next()
            .ok_or_else(|| "restart child did not receive a database path".to_owned())?;
        return verify_restart_child(Path::new(&path));
    }

    verify_reopen_and_restart()?;

    let database = LocalDatabase::memory().map_err(|error| format!("setup database: {error:?}"))?;
    let inherited = database.binding();
    if inherited != database.binding() {
        return Err("setup refused a legitimate same-process database binding".to_owned());
    }
    let process_identity = ProcessBoundIdentity::new();
    let inherited_process_identity = process_identity.clone();
    if process_identity != inherited_process_identity {
        return Err("setup refused a legitimate same-process primitive clone".to_owned());
    }

    // SAFETY: this fixture is deliberately single-threaded and the child only
    // compares inherited in-memory identity before calling `_exit`.
    let child = unsafe { libc::fork() };
    if child < 0 {
        return Err(format!(
            "fork setup failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    if child == 0 {
        if process_identity == inherited_process_identity {
            // SAFETY: see the `_exit` justification below.
            unsafe { libc::_exit(PRIMITIVE_FAILED_OPEN) };
        }
        // @attack
        let accepted = inherited == database.binding();
        // SAFETY: `_exit` terminates the child without running inherited Rust
        // destructors or touching potentially fork-unsafe buffered I/O state.
        unsafe { libc::_exit(if accepted { ATTACK_ACCEPTED } else { 0 }) };
    }

    let mut status = 0;
    // SAFETY: `child` is the positive PID returned by `fork`, and `status`
    // points to writable storage for this synchronous wait.
    let waited = unsafe { libc::waitpid(child, &mut status, 0) };
    if waited != child {
        return Err(format!(
            "waitpid setup failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    if !libc::WIFEXITED(status) {
        return Err(format!("child failed before reporting the attack: status={status}"));
    }
    if inherited != database.binding() {
        return Err("parent refused its own binding after the child forked".to_owned());
    }

    let result = match libc::WEXITSTATUS(status) {
        ATTACK_ACCEPTED => Ok(
            "forked child reached DatabaseBinding equality and inherited allocation identity was accepted"
                .to_owned(),
        ),
        0 => Err(
            "forked child reached DatabaseBinding equality and inherited identity was refused"
                .to_owned(),
        ),
        PRIMITIVE_FAILED_OPEN => {
            return Err("process-bound identity setup failed open in the forked child".to_owned());
        }
        code => return Err(format!("child returned unexpected attack status {code}")),
    };
    report_observation("F126", result);
    Ok(())
}

#[cfg(unix)]
fn verify_reopen_and_restart() -> Result<(), String> {
    let directory = tempfile::tempdir().map_err(|error| format!("reopen tempdir: {error}"))?;
    let path = directory.path().join("fork-identity.sqlite3");

    let first = LocalDatabase::open(&path).map_err(|error| format!("first open: {error:?}"))?;
    let first_binding = first.binding();
    if first_binding != first.binding() {
        return Err("first open refused a legitimate same-process binding clone".to_owned());
    }
    drop(first);

    let reopened = LocalDatabase::open(&path).map_err(|error| format!("reopen: {error:?}"))?;
    let reopened_binding = reopened.binding();
    if reopened_binding != reopened.binding() {
        return Err("reopen refused its legitimate same-process binding clone".to_owned());
    }
    if first_binding == reopened_binding {
        return Err("database reopen retained the predecessor allocation identity".to_owned());
    }
    drop(reopened);

    let output = std::process::Command::new(
        std::env::current_exe().map_err(|error| format!("restart executable: {error}"))?,
    )
    .arg("--restart-child")
    .arg(&path)
    .output()
    .map_err(|error| format!("restart child: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "restart child failed during setup: status={} stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn verify_restart_child(path: &Path) -> Result<(), String> {
    let restarted = LocalDatabase::open(path).map_err(|error| format!("restart open: {error:?}"))?;
    let binding = restarted.binding();
    if binding != restarted.binding() {
        return Err("restart refused its legitimate same-process binding clone".to_owned());
    }
    Ok(())
}

#[cfg(not(unix))]
fn main() {
    report_observation(
        "F126",
        Err("POSIX fork witness is not applicable on this target".to_owned()),
    );
}
