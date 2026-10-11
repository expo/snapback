//! CLI behaviour agents scripted against (wave 1 friction): piping output,
//! per-verb help, a taken port, the dev PID, undeclared personas, and the
//! fixture exit code. Real subprocesses of the built binary.
use std::fs;
use std::io::{BufRead, BufReader};
use std::os::unix::process::ExitStatusExt;
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
static SERIAL: AtomicUsize = AtomicUsize::new(0);

struct Project(PathBuf);
impl Project {
    fn new(schema: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("sb4-cli-friction-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("snapback")).unwrap();
        fs::write(dir.join("snapback/schema.q"), schema).unwrap();
        Project(dir)
    }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
    fn write(&self, path: &str, text: &str) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    /// `dev --fresh --no-watch` on `port`; returns the child and its URL.
    fn dev(&self, port: u16) -> (Dev, String) {
        let mut child = Command::new(BIN).current_dir(&self.0)
            .args(["dev", "--port", &port.to_string(), "--fresh", "--no-watch"])
            .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let dev = Dev(child);
        assert!(line.starts_with("http://"), "dev's first stdout line is its URL: {line:?}");
        (dev, line.trim().to_owned())
    }
}
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

struct Dev(Child);
impl Drop for Dev { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }

fn text(output: &Output) -> String { format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)) }

fn http(url: &str, method: &str, path: &str, persona: Option<&str>, body: &str) -> (u16, serde_json::Value) {
    use std::io::{Read, Write};
    let address = url.strip_prefix("http://").unwrap();
    let mut stream = std::net::TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let persona = persona.map(|p| format!("x-snapback-persona: {p}\r\n")).unwrap_or_default();
    write!(stream, "{method} {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Type: application/json\r\n{persona}Content-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut reply = String::new();
    stream.read_to_string(&mut reply).unwrap();
    let status = reply.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = reply.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
    // Chunked or not, the JSON object is the outermost braces.
    let json = body.find('{').and_then(|start| body.rfind('}').map(|end| &body[start..=end])).unwrap_or("null");
    (status, serde_json::from_str(json).unwrap_or(serde_json::Value::Null))
}

/// `snapback4 test | head` used to panic on EPIPE, and the production build
/// (panic = abort) dumped core. A closed reader now ends a one-shot verb quietly.
#[test]
fn a_closed_pipe_ends_a_one_shot_verb_without_a_panic() {
    let project = Project::new("use personas alice\nquery alive():\n  return true\n");
    for args in [&["guide", "language"][..], &["--help"], &["check"], &["test"]] {
        let mut child = Command::new(BIN).current_dir(&project.0).args(args)
            .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        // Close the read end before the verb writes (or while it does).
        drop(child.stdout.take());
        let output = child.wait_with_output().unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(!stderr.contains("panicked") && !stderr.contains("Broken pipe"), "{args:?}: {stderr}");
        assert_ne!(output.status.code(), Some(101), "{args:?}: {stderr}");
        assert!(output.status.success() || output.status.signal() == Some(libc::SIGPIPE), "{args:?}: {:?} {stderr}", output.status);
    }
}
