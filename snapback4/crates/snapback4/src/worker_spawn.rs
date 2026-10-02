//! Darwin's child task clamp must be applied at exec, not to the watchdog pthread.
// @ref LLP 3000#contended-read-serving — supervised Node and its threads run at utility.
#[cfg(not(target_os = "macos"))]
pub(super) fn spawn(program: &str, script: &str) -> std::io::Result<std::process::Child> {
    use std::os::unix::process::CommandExt;
    std::process::Command::new(program).arg(script).process_group(0)
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).spawn()
}

#[cfg(target_os = "macos")]
pub(super) use darwin::spawn;
#[cfg(target_os = "macos")]
mod darwin {
    use std::{ffi::CString, fs::File, io, os::{fd::{AsRawFd, FromRawFd, OwnedFd}, unix::process::ExitStatusExt}, process::ExitStatus};
    pub(crate) struct Child { pid: libc::pid_t, pub(crate) stdout: Option<File> }
    impl Child {
        pub(crate) fn id(&self) -> u32 { self.pid as u32 }
        pub(crate) fn wait(&mut self) -> io::Result<ExitStatus> {
            let mut status = 0;
            loop {
                if unsafe { libc::waitpid(self.pid, &mut status, 0) } >= 0 { return Ok(ExitStatus::from_raw(status)); }
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted { return Err(error); }
            }
        }
    }
    fn check(error: i32) -> io::Result<()> { if error == 0 { Ok(()) } else { Err(io::Error::from_raw_os_error(error)) } }
    struct Attr(libc::posix_spawnattr_t);
    impl Drop for Attr { fn drop(&mut self) { unsafe { libc::posix_spawnattr_destroy(&mut self.0); } } }
    struct Actions(libc::posix_spawn_file_actions_t);
    impl Drop for Actions { fn drop(&mut self) { unsafe { libc::posix_spawn_file_actions_destroy(&mut self.0); } } }
    pub(crate) fn spawn(program: &str, script: &str) -> io::Result<Child> {
        let program = CString::new(program)?;
        let script = CString::new(script)?;
        let mut argv = [program.as_ptr().cast_mut(), script.as_ptr().cast_mut(), std::ptr::null_mut()];
        let input = File::open("/dev/null")?;
        let mut pipe = [0; 2];
        if unsafe { libc::pipe(pipe.as_mut_ptr()) } != 0 { return Err(io::Error::last_os_error()); }
        let (read, write) = unsafe { (OwnedFd::from_raw_fd(pipe[0]), OwnedFd::from_raw_fd(pipe[1])) };
        unsafe {
            let mut attr = std::mem::zeroed();
            check(libc::posix_spawnattr_init(&mut attr))?;
            let mut attr = Attr(attr);
            check(libc::posix_spawnattr_set_qos_class_np(&mut attr.0, libc::qos_class_t::QOS_CLASS_UTILITY))?;
            check(libc::posix_spawnattr_setpgroup(&mut attr.0, 0))?;
            let mut defaults = std::mem::zeroed();
            libc::sigemptyset(&mut defaults);
            libc::sigaddset(&mut defaults, libc::SIGPIPE);
            check(libc::posix_spawnattr_setsigdefault(&mut attr.0, &defaults))?;
            check(libc::posix_spawnattr_setflags(&mut attr.0, (libc::POSIX_SPAWN_SETPGROUP | libc::POSIX_SPAWN_SETSIGDEF | libc::POSIX_SPAWN_CLOEXEC_DEFAULT) as i16))?;
            let mut actions = std::mem::zeroed();
            check(libc::posix_spawn_file_actions_init(&mut actions))?;
            let mut actions = Actions(actions);
            check(libc::posix_spawn_file_actions_adddup2(&mut actions.0, input.as_raw_fd(), 0))?;
            check(libc::posix_spawn_file_actions_adddup2(&mut actions.0, write.as_raw_fd(), 1))?;
            check(libc::posix_spawn_file_actions_adddup2(&mut actions.0, 2, 2))?;
            unsafe extern "C" { fn _NSGetEnviron() -> *mut *mut *mut libc::c_char; }
            let mut pid = 0;
            check(libc::posix_spawnp(&mut pid, program.as_ptr(), &actions.0, &attr.0, argv.as_mut_ptr(), *_NSGetEnviron()))?;
            Ok(Child { pid, stdout: Some(File::from(read)) })
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn executed_node_and_its_threads_have_utility_task_priority() {
        use std::{io::Read, process::Command};
        let dir = std::env::temp_dir().join(format!("snapback4-node-qos-{}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/qos/node_readback.rs");
        let addon = dir.join("readback.node");
        assert!(Command::new("rustc").args(["--edition=2024", "--crate-type=cdylib", "-C", "link-arg=-undefined", "-C", "link-arg=dynamic_lookup"])
            .arg(source).arg("-o").arg(&addon).status().unwrap().success());
        let script = dir.join("probe.cjs");
        std::fs::write(&script, format!(r#"
const {{ Worker }} = require('node:worker_threads');
const {{ pbkdf2 }} = require('node:crypto');
for(let i=0;i<2;i++) new Worker('setInterval(()=>{{}},1000)', {{eval:true}});
for(let i=0;i<4;i++) pbkdf2('a','b',500000,32,'sha256',()=>{{}});
setTimeout(()=>{{console.log(require({:?}));process.exit(0)}},250);
setTimeout(()=>process.exit(2),10000);
"#, addon.to_str().unwrap())).unwrap();
        // Effective Mach base priorities, not pthread's requested class (which
        // cannot report a task clamp). Darwin utility is priority 20. Cover
        // main, V8, libuv and two explicitly created JS worker threads.
        let baseline = Command::new("node").arg(&script).output().unwrap();
        assert!(baseline.status.success());
        let before: Vec<i32> = serde_json::from_slice(&baseline.stdout).unwrap();
        assert!(before.iter().any(|p| *p > 20), "control was already demoted: {before:?}");
        let mut child = super::spawn("node", script.to_str().unwrap()).unwrap();
        let mut output = String::new();
        child.stdout.take().unwrap().read_to_string(&mut output).unwrap();
        assert!(child.wait().unwrap().success(), "{output}");
        let after: Vec<i32> = serde_json::from_str(&output).unwrap();
        assert!(after.len() >= 8, "did not cover Node's threads: {after:?}");
        assert!(after.iter().all(|p| *p == 20), "child must be utility, including no background clamp: {after:?}");
        eprintln!("executed Node thread base priorities: control={before:?}, utility={after:?}");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
