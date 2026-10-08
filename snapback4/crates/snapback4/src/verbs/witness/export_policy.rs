//! @ref LLP 3000.030#15 — production yields to the Mac; debug fixtures test queue semantics separately.
use std::{path::Path, process::Command};

// Private fixture seam, not a user setting. Release builds neither read this
// variable nor permit normal-priority Darwin launches through command_for.
#[cfg(any(debug_assertions, test))]
fn enabled(value: Option<&std::ffi::OsStr>) -> bool {
    cfg!(debug_assertions) && value == Some(std::ffi::OsStr::new("1"))
}
fn normal_fixture_priority() -> bool {
    #[cfg(debug_assertions)]
    { enabled(std::env::var_os("SNAPBACK4_TEST_EXPORT_NORMAL_PRIORITY").as_deref()) }
    #[cfg(not(debug_assertions))]
    { false }
}

pub(super) fn command(executable: &Path) -> Command {
    command_for(executable, cfg!(target_os = "macos"), normal_fixture_priority())
}
fn command_for(executable: &Path, darwin: bool, normal: bool) -> Command {
    if darwin && !(cfg!(debug_assertions) && normal) {
        let mut command = Command::new("/usr/sbin/taskpolicy");
        command.args(["-b", "-c", "background"]).arg(executable);
        command
    } else {
        // Inherit the fixture runner's ordinary policy. Never raise priority
        // in an already backgrounded tree; the proof entry checks and Darwin
        // policy regression refuse that fixture precondition.
        Command::new(executable)
    }
}
#[cfg(any(target_os = "macos", test))]
pub(super) fn expected() -> i32 { if normal_fixture_priority() { 0 } else { 1 } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_policy_fixture_override_requires_debug_and_exact_opt_in() {
        for value in [None, Some(""), Some("0"), Some("true"), Some("1 ")] {
            assert!(!enabled(value.map(std::ffi::OsStr::new)));
        }
        assert_eq!(enabled(Some(std::ffi::OsStr::new("1"))), cfg!(debug_assertions));
        let requested = cfg!(debug_assertions) && std::env::var_os("SNAPBACK4_TEST_EXPORT_NORMAL_PRIORITY").as_deref() == Some(std::ffi::OsStr::new("1"));
        assert_eq!(normal_fixture_priority(), requested);
        assert_eq!(expected(), if requested { 0 } else { 1 });
    }
    #[test]
    fn export_policy_preserves_both_darwin_flags_and_direct_linux_launch() {
        let executable = Path::new("/fixture/snapback4");
        for darwin in [false, true] { for normal in [false, true] {
            let command = command_for(executable, darwin, normal);
            if darwin && !(cfg!(debug_assertions) && normal) {
                assert_eq!(command.get_program(), "/usr/sbin/taskpolicy");
                assert_eq!(command.get_args().collect::<Vec<_>>(), ["-b", "-c", "background", "/fixture/snapback4"]);
            } else {
                assert_eq!(command.get_program(), executable);
                assert_eq!(command.get_args().count(), 0);
            }
        } }
        let command = command(executable);
        assert_eq!(command.get_program(), if cfg!(target_os = "macos") && !normal_fixture_priority() { Path::new("/usr/sbin/taskpolicy") } else { executable });
    }
}
