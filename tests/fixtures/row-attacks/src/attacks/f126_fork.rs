#[cfg(unix)]
use snapback_kernel::process_bound_identity::ProcessBoundIdentity;
#[cfg(unix)]
use snapback_kernel::storage::LocalDatabase;
use snapback_row_attack_fixtures::report_observation;

#[cfg(unix)]
const ATTACK_ACCEPTED: i32 = 42;
#[cfg(unix)]
const PRIMITIVE_FAILED_OPEN: i32 = 43;

#[cfg(unix)]
fn main() -> Result<(), String> {
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

#[cfg(not(unix))]
fn main() {
    report_observation(
        "F126",
        Err("POSIX fork witness is not applicable on this target".to_owned()),
    );
}
