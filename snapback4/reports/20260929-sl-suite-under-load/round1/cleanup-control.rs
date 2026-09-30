//! Linux control: normal completion must leave a leaked backend visible to
//! the caller's assertions, then fixture destruction must stop its owned group.
#![allow(dead_code)]
#[path = "../../../crates/snapback4/tests/fixtures/witness-watchdog.rs"]
mod watchdog;
use std::{fs, net::TcpStream, path::PathBuf, process::Command, time::Duration};

fn main() {
    // Adopt this control's deliberate orphan so we can prove it is reaped,
    // without relying on this container's PID 1. No other process is touched.
    assert_eq!(unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) }, 0);
    let dir = PathBuf::from(std::env::args().nth(1).unwrap());
    let mut command = Command::new("python3");
    command.args(["-c", r#"
import os, signal, socket, sys, time
from pathlib import Path
ready = Path(sys.argv[1]) / 'leak'
pid = os.fork()
if pid == 0:
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    listener.listen()
    ready.write_text(str(os.getpid()) + ' ' + str(listener.getsockname()[1]))
    while True:
        signal.pause()
while not ready.exists():
    time.sleep(.01)
os._exit(0)
"#]).arg(&dir);
    let mut guard = watchdog::Guarded::spawn(&mut command, &dir, Duration::from_secs(60));
    assert!(guard.finish().status.success());
    let record = fs::read_to_string(dir.join("leak")).unwrap();
    let fields: Vec<_> = record.split_whitespace().collect();
    let pid: i32 = fields[0].parse().unwrap();
    let address = format!("127.0.0.1:{}", fields[1]);
    assert!(TcpStream::connect(&address).is_ok(), "cleanup must not hide the leak before assertions");
    println!("leaked backend {pid} remains observable after driver exit");
    drop(guard);
    let mut status = 0;
    assert_eq!(unsafe { libc::waitpid(pid, &mut status, 0) }, pid);
    assert_eq!(libc::WTERMSIG(status), libc::SIGKILL);
    assert!(TcpStream::connect(address).is_err());
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    assert_eq!(std::io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
    println!("fixture destruction stopped the group; adopted backend reaped");
}
