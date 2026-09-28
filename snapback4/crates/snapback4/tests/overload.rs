//! Admission must survive closed and saturated operator output pipes.
#![cfg(unix)]
use std::{fs::{self, File}, io::{BufRead, BufReader, Read, Write}, net::TcpStream, os::fd::{AsRawFd, FromRawFd}, process::{Child, Command, Stdio}, sync::mpsc, thread, time::Duration};
struct Host { child: Child, dir: std::path::PathBuf }
impl Drop for Host { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); let _ = fs::remove_dir_all(&self.dir); } }

#[test]
fn admission_survives_closed_stderr() { check(false); }
#[test]
fn admission_survives_full_stderr() { check(true); }
fn check(full: bool) {
        let dir = std::env::temp_dir().join(format!("sb4-overload-{}-{full}", std::process::id()));
        fs::create_dir_all(dir.join("snapback")).unwrap();
        fs::write(dir.join("snapback/schema.q"), "use personas alice\nquery hello():\n  return 1\n").unwrap();
        let mut fds = [0; 2]; assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        for fd in fds { assert_eq!(unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) }, 0); }
        let mut reader = unsafe { File::from_raw_fd(fds[0]) };
        let mut writer = unsafe { File::from_raw_fd(fds[1]) };
        let child = Command::new(std::env::var("SNAPBACK4_OVERLOAD_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_snapback4").into()))
            .args(["dev", "--fresh", "--replay", "--no-watch", "--port", "0"]).current_dir(&dir)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(writer.try_clone().unwrap()).spawn().unwrap();
        let mut host = Host { child, dir };
        let stdout = host.child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || { let mut line = String::new(); let _ = BufReader::new(stdout).read_line(&mut line); let _ = tx.send(line); });
        let url = rx.recv_timeout(Duration::from_secs(10)).expect("startup");
        let address = url.trim().strip_prefix("http://").expect("server URL");
        // Drain only startup diagnostics, then explicitly fault the same pipe.
        unsafe { libc::fcntl(reader.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK); }
        let mut buffer = [0; 4096]; while reader.read(&mut buffer).is_ok_and(|n| n > 0) {}
        if full {
            unsafe { libc::fcntl(writer.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK); }
            while writer.write(&buffer).is_ok() {}
            // The child's descriptor shares these flags. Restore blocking mode:
            // this is the original full-pipe failure, not a nonblocking fake.
            unsafe { libc::fcntl(writer.as_raw_fd(), libc::F_SETFL, 0); }
        } else { drop(reader); }
        let held: Vec<_> = (0..128).map(|_| TcpStream::connect(address).unwrap()).collect();
        thread::sleep(Duration::from_millis(100));
        for i in 0..9 {
            if i == 8 { thread::sleep(Duration::from_millis(1250)); } // summary writer has attempted the faulty pipe
            let mut extra = TcpStream::connect(address).unwrap();
            extra.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut reply = String::new();
            extra.read_to_string(&mut reply).expect("admission still answers with stderr unavailable");
            assert!(reply.contains("503 Service Unavailable"), "full={full}, exit={:?}: {reply}", host.child.try_wait().unwrap());
            assert!(reply.contains("\"retryable\":true"));
        }
        assert!(host.child.try_wait().unwrap().is_none(), "logging must not kill the server");
        drop(held);
        thread::sleep(Duration::from_millis(150));
        let mut recovered = TcpStream::connect(address).unwrap();
        recovered.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        recovered.write_all(b"GET /schema HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
        let mut reply = String::new(); recovered.read_to_string(&mut reply).unwrap();
        assert!(reply.contains("401 Unauthorized"), "admitted request still completes: {reply}");
}
