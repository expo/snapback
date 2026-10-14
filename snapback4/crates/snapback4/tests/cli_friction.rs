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
    for args in [&["guide", "language", "--full"][..], &["--help"], &["check"], &["test"]] {
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

/// A taken port fails the start at once, names the port, the holder and the
/// way out; a holder that is a dev is named by its PID, which `/dev/status`
/// reports too, so a script can prove it owns the server it polls.
#[test]
fn dev_refuses_a_taken_port_and_names_the_holder() {
    let project = Project::new("use personas alice\nquery alive():\n  return true\n");
    // A stranger on the port.
    let stranger = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = stranger.local_addr().unwrap().port();
    let started = Instant::now();
    let output = project.run(&["dev", "--port", &port.to_string(), "--fresh", "--no-watch"]);
    let log = text(&output);
    assert!(!output.status.success(), "{log}");
    assert!(started.elapsed() < Duration::from_secs(20), "a taken port is refused immediately: {log}");
    assert!(log.contains(&format!("E_ADDRINUSE at 127.0.0.1:{port}")), "{log}");
    assert!(log.contains("does not answer GET /dev/status") && log.contains(&format!("snapback4 dev --port {}", port + 1)) && log.contains("--port 0"), "{log}");
    assert!(!String::from_utf8_lossy(&output.stdout).contains("http://"), "a refused start prints no URL: {log}");
    drop(stranger);

    // A dev on the port: its PID is in /dev/status and in the second dev's refusal.
    let (first, url) = project.dev(0);
    let (status, body) = http(&url, "GET", "/dev/status", None, "");
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["pid"].as_u64(), Some(u64::from(first.0.id())), "{body}");
    let port = url.rsplit(':').next().unwrap();
    let output = project.run(&["dev", "--port", port, "--fresh", "--no-watch"]);
    let log = text(&output);
    assert!(!output.status.success(), "{log}");
    assert!(log.contains("E_ADDRINUSE") && log.contains(&format!("a running snapback4 dev (pid {})", first.0.id())) && log.contains(&format!("kill {}", first.0.id())), "{log}");
}

/// Wave 3: scripts that read stdout and stderr through one handler waited on
/// "line 1" and met host diagnostics. stdout's first line stays the URL; the
/// tagged `SNAPBACK4_READY` line on stderr carries the URL and PID for a merged
/// reader. A process that launches the binary as the npm wrapper does names
/// itself in SNAPBACK4_SUPERVISOR_PID; a SIGKILL to it stops the server too.
#[test]
fn dev_prints_a_tagged_ready_line_and_stops_with_a_killed_supervisor() {
    use std::io::Read;
    let project = Project::new("use personas alice\nquery alive():\n  return true\n");
    let ready = |stderr: &mut dyn BufRead| -> String {
        let mut line = String::new();
        loop {
            line.clear();
            assert!(stderr.read_line(&mut line).unwrap() > 0, "stderr ended before SNAPBACK4_READY");
            if line.starts_with("SNAPBACK4_READY ") { return line.trim().to_owned(); }
        }
    };
    // Without a wrapper: no wrapperPid anywhere.
    let mut child = Command::new(BIN).current_dir(&project.0).args(["dev", "--port", "0", "--fresh", "--no-watch"])
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    let url = url.trim().to_owned();
    let line = ready(&mut BufReader::new(child.stderr.take().unwrap()));
    let dev = Dev(child);
    assert_eq!(line, format!("SNAPBACK4_READY verb=dev generation=1 url={url} pid={}", dev.0.id()));
    let (_, body) = http(&url, "GET", "/dev/status", None, "");
    assert!(body["wrapperPid"].is_null() && body["pid"].as_u64() == Some(u64::from(dev.0.id())), "{body}");
    drop(dev);

    // Under a supervising shell: both PIDs, and the server dies with it.
    let mut shell = Command::new("sh").current_dir(&project.0)
        .args(["-c", "SNAPBACK4_SUPERVISOR_PID=$$ \"$0\" dev --port 0 --fresh --no-watch; :", BIN])
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut stdout = BufReader::new(shell.stdout.take().unwrap());
    let mut url = String::new();
    stdout.read_line(&mut url).unwrap();
    let url = url.trim().to_owned();
    let mut stderr = BufReader::new(shell.stderr.take().unwrap());
    let line = ready(&mut stderr);
    let (_, body) = http(&url, "GET", "/dev/status", None, "");
    let server = body["pid"].as_u64().unwrap();
    assert_eq!(body["wrapperPid"].as_u64(), Some(u64::from(shell.id())), "{body}");
    assert_eq!(line, format!("SNAPBACK4_READY verb=dev generation=1 url={url} pid={server} wrapperPid={}", shell.id()));
    shell.kill().unwrap();
    shell.wait().unwrap();
    // The server held the only other end of these pipes: they close when it exits.
    let (done, ended) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut rest = String::new();
        let _ = stderr.read_to_string(&mut rest);
        let _ = stdout.read_to_string(&mut String::new());
        let _ = done.send(rest);
    });
    let rest = match ended.recv_timeout(Duration::from_secs(30)) {
        Ok(rest) => rest,
        Err(_) => { unsafe { libc::kill(server as i32, libc::SIGKILL); } panic!("the server {server} outlived its SIGKILLed supervisor"); }
    };
    assert!(rest.contains("SNAPBACK4_SIGNAL verb=dev generation=1 reason=SIGTERM"), "{rest}");
    assert!(std::net::TcpStream::connect(url.strip_prefix("http://").unwrap()).is_err(), "{url} still answers");
}

/// A stale SNAPBACK4_SUPERVISOR_PID naming a live process that is not this
/// process's parent is ignored: only the launching wrapper supervises.
#[test]
fn a_supervisor_pid_that_is_not_the_parent_is_ignored() {
    let project = Project::new("use personas alice\nquery alive():\n  return true\n");
    let mut stranger = Command::new("sleep").arg("60").spawn().unwrap();
    let mut child = Command::new(BIN).current_dir(&project.0).args(["dev", "--port", "0", "--fresh", "--no-watch"])
        .env("SNAPBACK4_SUPERVISOR_PID", stranger.id().to_string())
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    let dev = Dev(child);
    let (status, body) = http(url.trim(), "GET", "/dev/status", None, "");
    assert_eq!(status, 200, "{body}");
    assert!(body["wrapperPid"].is_null(), "{body}");
    let _ = stranger.kill();
    let _ = stranger.wait();
    drop(dev);
}

/// `snapback4 test --help` is about test (lane 054): its columns, its states,
/// its exit codes and where the testing card is; every verb gets its own page.
#[test]
fn each_verb_has_its_own_help() {
    let help = |args: &[&str]| {
        let output = Command::new(BIN).args(args).output().unwrap();
        assert!(output.status.success(), "{args:?}: {output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    let full = help(&["--help"]);
    let test = help(&["test", "--help"]);
    assert_ne!(test, full);
    for term in ["examined", "entries", "probes", "capped", "complete: false", "on derived arguments", "not run", "Exit 1", "guide testing"] {
        assert!(test.contains(term), "test --help explains {term}:\n{test}");
    }
    let dev = help(&["dev", "--help"]);
    for term in ["/dev/status", "pid", "E_ADDRINUSE", "--port 0", "--fresh", "--memory", "E_STORE_BUSY", "use personas", "SIGTERM"] {
        assert!(dev.contains(term), "dev --help explains {term}:\n{dev}");
    }
    let run = help(&["run", "--help"]);
    assert!(run.contains("--port N") && run.contains("dev --fresh"), "{run}");
    let check = help(&["check", "--help"]);
    assert!(check.contains("advisory") && check.contains("by design") && check.contains("Exit 0"), "{check}");
    assert!(help(&["init", "--help"]).contains("without overwriting"));
    // Verbs without a page print their own lines from the full help.
    let data = help(&["data", "--help"]);
    assert!(data.starts_with("  data <table>") && !data.contains("  dev ["), "{data}");
    assert!(full.contains("snapback4 <verb> --help"), "{full}");
}

/// `use personas` is the cast: dev refuses an undeclared persona with 401
/// E_AUTH naming the declaration (lane 035 expected exactly this), and a
/// schema without the declaration still admits any well-formed name.
#[test]
fn dev_refuses_an_undeclared_persona() {
    let project = Project::new("use personas alice, bob\nquery whoAmI():\n  return viewer\n");
    let (_dev, url) = project.dev(0);
    let (status, body) = http(&url, "POST", "/q/whoAmI", Some("alice"), "{}");
    assert_eq!((status, body["data"].as_str()), (200, Some("dev:alice")), "{body}");
    let (status, body) = http(&url, "POST", "/q/whoAmI", Some("intruder"), "{}");
    assert_eq!(status, 401, "{body}");
    assert_eq!(body["denied"]["code"], "E_AUTH", "{body}");
    let message = body["denied"]["message"].as_str().unwrap();
    assert!(message.contains("persona intruder is not declared") && message.contains("use personas alice, bob"), "{message}");
    let (status, body) = http(&url, "POST", "/m/nothing", Some("intruder"), "{}");
    assert_eq!((status, &body["denied"]["code"]), (401, &serde_json::json!("E_AUTH")), "{body}");

    let open = Project::new("query whoAmI():\n  return viewer\n");
    let (_dev, url) = open.dev(0);
    let (status, body) = http(&url, "POST", "/q/whoAmI", Some("anyone"), "{}");
    assert_eq!((status, body["data"].as_str()), (200, Some("dev:anyone")), "{body}");
}

const FIXTURE_SCHEMA: &str = "use personas alice, bob

table lists:
  owner: principal
  title: text 1..80
  done: bool default false
  n: int default 7
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  cap 50 by owner
  sync to .owner

table items:
  list: lists
  pos: sequence by list
  text: text 1..80
  immutable list
  read through .list
  insert <- .list.owner = viewer
  cap 50 by list

query flags(list: lists):
  l = lists[list] ! else NOT_FOUND
  return { done: l.done, n: l.n }

query kids(list: lists):
  return items where .list = list first 50 by .pos
";

/// Fixture rows load as inserts do: column defaults filled, sequences
/// assigned in file order. Anything that keeps the fixture from loading
/// (a supplied sequence, a bare principal, a file naming no table) exits
/// non-zero with nothing run (lane 050 saw an error and exit 0).
#[test]
fn fixture_rows_load_as_inserts_and_a_bad_fixture_fails_the_run() {
    let project = Project::new(FIXTURE_SCHEMA);
    project.write("fx/lists.jsonl", "{\"id\":\"L1\",\"owner\":\"dev:alice\",\"title\":\"Home\"}\n");
    project.write("fx/items.jsonl", "{\"id\":\"I1\",\"list\":\"L1\",\"text\":\"a\"}\n{\"id\":\"I2\",\"list\":\"L1\",\"text\":\"b\"}\n");
    project.write("fx/test.cases.jsonl", concat!(
        "{\"as\":\"alice\",\"op\":\"flags\",\"args\":{\"list\":\"L1\"},\"data\":{\"done\":false,\"n\":7}}\n",
        "{\"as\":\"alice\",\"op\":\"kids\",\"args\":{\"list\":\"L1\"},\"data\":[{\"id\":\"I1\",\"list\":\"L1\",\"pos\":1,\"text\":\"a\"},{\"id\":\"I2\",\"list\":\"L1\",\"pos\":2,\"text\":\"b\"}]}\n"));
    let output = project.run(&["test", "--fixture", "fx", "--as", "alice"]);
    assert!(output.status.success(), "{}", text(&output));
    assert!(text(&output).contains("cases: 2 passed, 0 failed"), "{}", text(&output));

    for (file, row, expect) in [
        ("fx/items.jsonl", "{\"id\":\"I1\",\"list\":\"L1\",\"text\":\"a\",\"pos\":4}\n", "E_SEQUENCE_SUPPLIED"),
        ("fx/lists.jsonl", "{\"id\":\"L1\",\"owner\":\"alice\",\"title\":\"Home\"}\n", "is not a principal"),
        ("fx/list.jsonl", "{\"id\":\"L2\",\"owner\":\"dev:alice\",\"title\":\"Typo\"}\n", "list.jsonl names no table"),
    ] {
        let bad = Project::new(FIXTURE_SCHEMA);
        bad.write("fx/lists.jsonl", "{\"id\":\"L1\",\"owner\":\"dev:alice\",\"title\":\"Home\"}\n");
        bad.write(file, row);
        for args in [&["test", "--fixture", "fx"][..], &["test", "--fixture", "fx", "--residency"], &["check", "--residency", "--fixture", "fx", "--as", "alice"]] {
            let output = bad.run(args);
            assert_eq!(output.status.code(), Some(1), "{args:?} with {file}: {}", text(&output));
            assert!(text(&output).contains(expect), "{args:?}: {}", text(&output));
        }
    }
}

/// `/seed` is an upsert by id: a reseed updates mutable columns, and a changed
/// immutable column says so instead of reading like a rule problem (lane 094).
#[test]
fn seed_upserts_by_id_and_names_an_immutable_change() {
    let project = Project::new(FIXTURE_SCHEMA);
    let (_dev, url) = project.dev(0);
    let seed = |rows: &str| http(&url, "POST", "/seed", None, rows);
    assert_eq!(seed("{\"table\":\"lists\"}").0, 400);
    let (status, body) = seed("[{\"table\":\"lists\",\"row\":{\"id\":\"L1\",\"owner\":\"dev:alice\",\"title\":\"Home\"}},{\"table\":\"items\",\"row\":{\"id\":\"I1\",\"list\":\"L1\",\"text\":\"a\"}}]");
    assert_eq!((status, &body["seeded"]), (200, &serde_json::json!(2)), "{body}");
    let (status, body) = seed("[{\"table\":\"lists\",\"row\":{\"id\":\"L1\",\"owner\":\"dev:alice\",\"title\":\"Renamed\"}}]");
    assert_eq!((status, &body["seeded"]), (200, &serde_json::json!(1)), "{body}");
    let (_, flags) = http(&url, "POST", "/q/flags", Some("alice"), "{\"args\":{\"list\":\"L1\"}}");
    assert_eq!(flags["data"], serde_json::json!({"done": false, "n": 7}), "defaults apply to seeded rows: {flags}");
    let (status, body) = seed("[{\"table\":\"lists\",\"row\":{\"id\":\"L1\",\"owner\":\"dev:bob\",\"title\":\"Home\"}}]");
    assert_eq!((status, &body["denied"]["code"]), (200, &serde_json::json!("E_CONSTRAINT")), "{body}");
    let message = body["denied"]["message"].as_str().unwrap();
    assert!(message.contains("lists.owner is immutable") && message.contains("upsert by id"), "{message}");
}

/// `run` beside a `dev --fresh` would read the on-disk store; `--port N`
/// reaches that dev's own temporary store, and a local run says which store answered.
#[test]
fn run_port_reaches_a_fresh_dev_and_a_local_run_names_its_store() {
    let project = Project::new("use personas alice, bob\nquery whoAmI():\n  return viewer\n");
    let (_dev, url) = project.dev(0);
    let port = url.rsplit(':').next().unwrap();
    let output = project.run(&["run", "whoAmI", "--as", "bob", "--port", port, "--json"]);
    assert!(output.status.success(), "{}", text(&output));
    assert!(String::from_utf8_lossy(&output.stderr).contains(&format!("--port: the snapback4 dev at {url}; forwarding to POST /q/whoAmI as x-snapback-persona: bob")), "{}", text(&output));
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()["data"], "dev:bob");
    let local = project.run(&["run", "whoAmI", "--json"]);
    assert!(local.status.success() && String::from_utf8_lossy(&local.stderr).contains("run: on the local store .snapback4/store.sqlite"), "{}", text(&local));
}

const PARITY_SCHEMA: &str = "use personas alice, bob

table items:
  owner: principal
  qty: int
  done: bool default false
  n: int default 7
  at: time default now
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  cap 50 by owner

table seats:
  slot: int
  who: principal
  unique slot else SEAT_TAKEN
  read <- .who = viewer
  insert <- .who = viewer
  cap 5 by who

view qtyByOwner: sum items of .qty by .owner
  read <- allow

view countByOwner: count items by .owner
  read <- allow

query item(item: items):
  i = items[item] ! else NOT_FOUND
  return { done: i.done, n: i.n, stamped: i.at > 0 }

query totals(owner: principal):
  return { qty: qtyByOwner[owner], count: countByOwner[owner] }

mutation setQty(item: items, qty: int):
  i = items[item] ! else NOT_FOUND
  require i.owner = viewer else NOT_YOURS
  return update items[item] { qty }

mutation drop(item: items):
  delete items[item]
  return true

mutation book(slot: int):
  return insert seats { slot, who: viewer }
";

/// Fixture rows and `/seed` take one insert path (wave 2, R2 and R4): the same
/// rows answer the same in `test --fixture` and over a dev's `/seed` — omitted
/// columns take their defaults, maintained views count the loaded rows and
/// follow later updates and deletes (no negative group), and a duplicate
/// `unique` refuses with the author's code instead of loading.
#[test]
fn fixture_rows_and_seed_rows_answer_alike() {
    let items = [r#"{"id":"I1","owner":"dev:alice","qty":2}"#, r#"{"id":"I2","owner":"dev:alice","qty":3}"#];
    let seats = r#"{"id":"S1","slot":1,"who":"dev:alice"}"#;
    // (persona, operation, args, the answer both paths must give)
    let steps: [(&str, &str, &str, serde_json::Value); 7] = [
        ("alice", "item", r#"{"item":"I1"}"#, serde_json::json!({"done": false, "n": 7, "stamped": true})),
        ("alice", "totals", r#"{"owner":"dev:alice"}"#, serde_json::json!({"qty": 5, "count": 2})),
        ("alice", "setQty", r#"{"item":"I1","qty":10}"#, serde_json::Value::Null),
        ("alice", "totals", r#"{"owner":"dev:alice"}"#, serde_json::json!({"qty": 13, "count": 2})),
        ("alice", "drop", r#"{"item":"I2"}"#, serde_json::json!(true)),
        ("alice", "totals", r#"{"owner":"dev:alice"}"#, serde_json::json!({"qty": 10, "count": 1})),
        ("alice", "totals", r#"{"owner":"dev:bob"}"#, serde_json::json!({"qty": 0, "count": 0})),
    ];
    let project = Project::new(PARITY_SCHEMA);
    project.write("fx/items.jsonl", &format!("{}\n{}\n", items[0], items[1]));
    project.write("fx/seats.jsonl", &format!("{seats}\n"));
    let cases: String = steps.iter().map(|(who, op, args, data)| {
        let data = if data.is_null() { String::new() } else { format!(",\"data\":{data}") };
        format!("{{\"as\":\"{who}\",\"op\":\"{op}\",\"args\":{args}{data}}}\n")
    }).collect();
    project.write("fx/test.cases.jsonl", &cases);
    let output = project.run(&["test", "--fixture", "fx", "--as", "alice"]);
    assert!(output.status.success(), "{}", text(&output));
    assert!(text(&output).contains("cases: 7 passed, 0 failed"), "{}", text(&output));

    let (_dev, url) = project.dev(0);
    let rows: Vec<String> = items.iter().map(|row| format!("{{\"table\":\"items\",\"row\":{row}}}")).chain([format!("{{\"table\":\"seats\",\"row\":{seats}}}")]).collect();
    let (status, body) = http(&url, "POST", "/seed", None, &format!("[{}]", rows.join(",")));
    assert_eq!((status, &body["seeded"]), (200, &serde_json::json!(3)), "{body}");
    for (who, op, args, data) in &steps {
        let route = if matches!(*op, "item" | "totals") { format!("/q/{op}") } else { format!("/m/{op}") };
        let (status, body) = http(&url, "POST", &route, Some(who), &format!("{{\"args\":{args}}}"));
        assert_eq!(status, 200, "{op}: {body}");
        let answer = if route.starts_with("/q/") { &body["data"] } else { assert_eq!(body["state"], "sent", "{op}: {body}"); &body["result"] };
        if !data.is_null() { assert_eq!(answer, data, "{op} {args} over /seed answers as the fixture run did"); }
    }

    // A duplicate unique key refuses with the author's code on both paths.
    let duplicate = r#"{"id":"S2","slot":1,"who":"dev:bob"}"#;
    let bad = Project::new(PARITY_SCHEMA);
    bad.write("fx/seats.jsonl", &format!("{seats}\n{duplicate}\n"));
    let output = bad.run(&["test", "--fixture", "fx"]);
    assert_eq!(output.status.code(), Some(1), "{}", text(&output));
    assert!(text(&output).contains("SEAT_TAKEN"), "{}", text(&output));
    let (_dev, url) = bad.dev(0);
    let (status, body) = http(&url, "POST", "/seed", None, &format!("[{{\"table\":\"seats\",\"row\":{seats}}},{{\"table\":\"seats\",\"row\":{duplicate}}}]"));
    assert_eq!((status, &body["denied"]["code"]), (200, &serde_json::json!("SEAT_TAKEN")), "{body}");
}

/// `test.cases.jsonl` (wave 2): a query that `check` notes is never complete
/// passes capped by default and says why; an explicit "complete" fails with a
/// hint naming the note. A refused case names the refusing layer: a lookup
/// whose row the read rule hid (the later `require` never ran), or a unique key
/// held by a row the viewer cannot read. `test` and `run` refuse an undeclared
/// persona as dev does (R10).
#[test]
fn cases_follow_check_verdicts_name_refusing_layers_and_refuse_undeclared_personas() {
    let schema = format!("{PARITY_SCHEMA}\nquery page(c: cursor ?):\n  return items first 20 by .id after c\n");
    let project = Project::new(&schema);
    let check = project.run(&["check", "--verbose"]);
    assert!(text(&check).contains("N_NEVER_COMPLETE"), "{}", text(&check));
    project.write("fx/items.jsonl", "{\"id\":\"I1\",\"owner\":\"dev:alice\",\"qty\":2}\n");
    project.write("fx/seats.jsonl", "{\"id\":\"S1\",\"slot\":1,\"who\":\"dev:alice\"}\n");
    project.write("fx/test.cases.jsonl", concat!(
        "{\"as\":\"alice\",\"op\":\"page\",\"count\":1}\n",
        "{\"as\":\"alice\",\"op\":\"page\",\"count\":1,\"expect\":\"complete\"}\n",
        "{\"as\":\"bob\",\"op\":\"setQty\",\"args\":{\"item\":\"I1\",\"qty\":1},\"expect\":\"NOT_YOURS\"}\n",
        "{\"as\":\"bob\",\"op\":\"book\",\"args\":{\"slot\":1},\"expect\":\"SEAT_TAKEN\"}\n",
        "{\"as\":\"eve\",\"op\":\"page\",\"expect\":\"E_AUTH\"}\n",
        "{\"as\":\"eve\",\"op\":\"page\"}\n",
        "{\"as\":\"bob\",\"op\":\"drop\",\"args\":{\"item\":\"I1\"},\"expect\":\"sent\"}\n"));
    let output = project.run(&["test", "--fixture", "fx", "--as", "alice"]);
    let out = text(&output);
    assert_eq!(output.status.code(), Some(1), "{out}");
    assert!(out.contains("cases: 2 passed, 5 failed"), "{out}");
    assert!(out.contains("ok   test.cases.jsonl:1 page (alice) → capped") && out.contains("capped is this query's check verdict: page:") && out.contains("is never `complete`") && out.contains("(N_NEVER_COMPLETE at schema.q:"), "{out}");
    assert!(out.contains("FAIL test.cases.jsonl:2 page (alice) → capped: expected complete, got capped") && out.contains("add \"expect\":\"capped\""), "{out}");
    assert!(out.contains("NOT_FOUND is the program's own refusal at `i = items[item] ! else NOT_FOUND` (schema.q:")
        && out.contains("the items read rule `read <- .owner = viewer`") && out.contains("a later `require … else NOT_YOURS` never ran"), "{out}");
    assert!(out.contains("seats refused it: unique slot, at `unique slot else SEAT_TAKEN` (schema.q:") && out.contains("a row with this `unique slot` key exists that this viewer cannot read"), "{out}");
    assert!(out.contains("ok   test.cases.jsonl:5 page (eve) → E_AUTH"), "{out}");
    // Wave 5 (I4): a write target's NOT_FOUND is not "the program's own refusal" when the program names no NOT_FOUND there.
    assert!(out.contains("NOT_FOUND is the write target's answer at `delete items[item]` (schema.q:") && !out.contains("own refusal at drop"), "{out}");
    assert!(out.contains("FAIL test.cases.jsonl:6 page (eve) → E_AUTH") && out.contains("persona eve is not declared; `use personas alice, bob`"), "{out}");

    for args in [&["test", "--fixture", "fx", "--as", "eve"][..], &["test", "--fixture", "fx", "--as", "dev:eve"]] {
        let output = project.run(args);
        assert_eq!(output.status.code(), Some(1), "{args:?}: {}", text(&output));
        assert!(text(&output).contains("persona eve is not declared") && !text(&output).contains("cases:"), "{args:?}: {}", text(&output));
    }
    // A local run keeps taking principal ids, and says a bare undeclared name is not dev:<name>.
    let run = project.run(&["run", "page", "--as", "eve", "--json"]);
    assert!(run.status.success(), "{}", text(&run));
    assert!(String::from_utf8_lossy(&run.stderr).contains("run --as eve: not a declared persona (`use personas alice, bob`), so this local run acts as the principal id \"eve\", not dev:eve"), "{}", text(&run));

    // Dev's refusal record names the same hidden-lookup layer; a missing row does not.
    let (_dev, url) = project.dev(0);
    let (_, body) = http(&url, "POST", "/seed", None, "[{\"table\":\"items\",\"row\":{\"id\":\"I1\",\"owner\":\"dev:alice\",\"qty\":2}}]");
    assert_eq!(body["seeded"], 1, "{body}");
    for (item, hidden) in [("I1", true), ("I9", false)] {
        let (_, body) = http(&url, "POST", "/m/setQty", Some("bob"), &format!("{{\"args\":{{\"item\":\"{item}\",\"qty\":1}}}}"));
        assert_eq!(body["why"]["code"], "NOT_FOUND", "{body}");
        let deadline = Instant::now() + Duration::from_secs(10);
        let record = loop {
            let why = project.run(&["why", "recent"]);
            let recent: serde_json::Value = serde_json::from_slice(&why.stdout).unwrap_or_default();
            let found = recent["records"].as_array().into_iter().flatten().filter(|r| r["operation"] == "setQty").count();
            if found == if hidden { 1 } else { 2 } { break recent["records"].as_array().unwrap().iter().rev().find(|r| r["operation"] == "setQty").unwrap().clone(); }
            assert!(Instant::now() < deadline, "{recent}");
            std::thread::sleep(Duration::from_millis(20));
        };
        assert_eq!(record["clause"], "program refusal", "{record}");
        assert_eq!(record["hiddenBy"]["table"].as_str(), hidden.then_some("items"), "{record}");
    }
}

/// Wave 5 lane 017 (LLP 3000.036 §15.11): `test` reports the search `exists`
/// over a per-row rule as it answers: `true` for the owner of a readable
/// match, and for another persona no value, said as such rather than `null`.
#[test]
fn a_search_exists_case_reports_a_readable_match_and_an_unavailable_answer() {
    let project = Project::new("use personas amy, bob\ntable applications:\n  owner: principal\n  status: enum('draft', 'submitted')\n  read <- .owner = viewer\n  online only\nquery plain():\n  return exists applications where .status = 'submitted'\n");
    project.write("fx/applications.jsonl", "{\"id\":\"a1\",\"owner\":\"dev:amy\",\"status\":\"submitted\"}\n");
    project.write("fx/test.cases.jsonl", concat!(
        "{\"as\":\"amy\",\"op\":\"plain\",\"data\":true}\n",
        "{\"as\":\"bob\",\"op\":\"plain\",\"data\":false}\n"));
    let output = project.run(&["test", "--fixture", "fx"]);
    let out = text(&output);
    assert!(out.contains("ok   test.cases.jsonl:1 plain (amy) → capped"), "{out}");
    assert!(out.contains("FAIL test.cases.jsonl:2 plain (bob) → capped: data differs: got null")
        && out.contains("null here is no answer (a client shows `loading`), not a null value"), "{out}");
    assert!(out.contains("cases: 1 passed, 1 failed"), "{out}");
}

/// Wave 5 (lane 059): an argument-free query refused by its own `require` was
/// `denied` and failed the run, while the same body with `c: cursor ?` was
/// "refused on derived arguments" and passed. Both are the program's gate.
/// And an unknown case key (`"rows":0`) passed silently against one row: every
/// line is now checked before any runs, naming the eight valid keys.
#[test]
fn an_argument_free_require_is_reported_like_a_derived_one_and_unknown_case_keys_refuse() {
    let schema = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n\
table notes:\n  owner: principal\n  read <- .owner = viewer or exists staff[viewer]\n  online only\n\
query report():\n  require exists staff[viewer] else NOT_STAFF\n  return staff[viewer]\n\
query reportPage(c: cursor ?):\n  require exists staff[viewer] else NOT_STAFF\n  return notes first 20 by .id after c\n";
    let project = Project::new(schema);
    project.write("fx/staff.jsonl", "{\"id\":\"S1\",\"principal\":\"dev:alice\"}\n");
    project.write("fx/notes.jsonl", "{\"id\":\"N1\",\"owner\":\"dev:bob\"}\n");
    let output = project.run(&["test", "--fixture", "fx", "--as", "bob"]);
    let out = text(&output);
    assert_eq!(output.status.code(), Some(0), "the program's own gate is not a failure:\n{out}");
    assert!(out.contains("report (bob)") && out.contains("refused NOT_STAFF by its own require") && out.contains("\"expect\":\"NOT_STAFF\""), "{out}");
    assert!(out.contains("reportPage (bob)") && out.contains("refused NOT_STAFF on derived arguments"), "{out}");
    assert!(out.contains("2 refused by their own require") && out.contains("0 denied"), "{out}");
    let output = project.run(&["test", "--fixture", "fx", "--as", "alice"]);
    assert_eq!(output.status.code(), Some(0), "{}", text(&output));
    assert!(text(&output).contains("0 refused by their own require"), "{}", text(&output));

    project.write("fx/test.cases.jsonl", concat!(
        "{\"as\":\"bob\",\"op\":\"report\",\"expect\":\"NOT_STAFF\"}\n",
        "{\"as\":\"alice\",\"op\":\"reportPage\",\"rows\":0}\n"));
    let output = project.run(&["test", "--fixture", "fx", "--as", "alice"]);
    let out = text(&output);
    assert_eq!(output.status.code(), Some(1), "{out}");
    assert!(out.contains("test.cases.jsonl:2: unknown key `rows` (did you mean `count`?); a case takes only `as`, `op`, `args`, `expect`, `data`, `count`, `save`, `label`"), "{out}");
    assert!(!out.contains("ok   test.cases.jsonl:1"), "no line runs before every line is valid:\n{out}");
    project.write("fx/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"reportPage\",\"expect\":{\"data\":[]}}\n");
    let out = text(&project.run(&["test", "--fixture", "fx", "--as", "alice"]));
    assert!(out.contains("test.cases.jsonl:1: `expect` is a string") && out.contains("`data`"), "{out}");
    project.write("fx/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"reportPage\",\"count\":1,\"label\":\"staff sees bob's note\"}\n");
    let output = project.run(&["test", "--fixture", "fx", "--as", "alice"]);
    assert_eq!(output.status.code(), Some(0), "{}", text(&output));
    assert!(text(&output).contains("cases: 1 passed, 0 failed"), "{}", text(&output));
}

/// Wave 5 (#8, #26): a farm assigns each builder a port range, and agents
/// wrote their own scanners (two hung). `dev --port A-B` binds the first free
/// port of the range and prints it as stdout's first line.
#[test]
fn dev_binds_the_first_free_port_of_a_range() {
    let project = Project::new("table notes:\n  owner: principal\n  read <- .owner = viewer\n  online only\n");
    let held = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let taken = held.local_addr().unwrap().port();
    let high = taken.saturating_add(30);
    let mut child = Command::new(BIN).current_dir(&project.0)
        .args(["dev", "--port", &format!("{taken}-{high}"), "--fresh", "--no-watch"])
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    let _dev = Dev(child);
    let port: u16 = line.trim().rsplit(':').next().unwrap().parse().unwrap_or_else(|_| panic!("{line:?}"));
    assert!(port > taken && port <= high, "the first free port after the taken one: {line:?}");
    let (status, body) = http(line.trim(), "GET", "/dev/status", None, "");
    assert_eq!(status, 200, "{body}");
    // Every port taken: E_ADDRINUSE at once, naming the range.
    let output = project.run(&["dev", "--port", &format!("{taken}-{taken}"), "--fresh", "--no-watch"]);
    assert!(!output.status.success() && text(&output).contains(&format!("every port in {taken}-{taken}")), "{}", text(&output));
}

/// Wave 7 (`test` tool, 20 lanes): with an explicit case expecting STAFF_ONLY
/// passing, the sweep still printed "refused STAFF_ONLY on derived arguments —
/// give it yours" (082, 059 fix-first); and a reference argument was the
/// table's first row, often another persona's hidden row, so the sweep tested
/// nothing (026 092 fix-first). The sweep now runs a persona's own case
/// arguments, labels a refusal its case expects, prefers a row whose answer is
/// not empty, and ends its summary in pass or FAIL.
#[test]
fn the_sweep_uses_a_personas_case_and_a_readable_row_and_labels_expected_refusals() {
    let schema = "use personas alice, bob, carol\n\
table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n\
table notes:\n  owner: principal\n  body: text <=100\n  read <- .owner = viewer or exists staff[viewer]\n  online only\n\
query note(id: notes):\n  return notes[id]\n\
query staffNotes(c: cursor ?):\n  require exists staff[viewer] else NOT_STAFF\n  return notes first 20 by .id after c\n";
    let project = Project::new(schema);
    project.write("fx/staff.jsonl", "{\"id\":\"S1\",\"principal\":\"dev:carol\"}\n");
    project.write("fx/notes.jsonl", "{\"id\":\"N1\",\"owner\":\"dev:bob\",\"body\":\"b\"}\n{\"id\":\"N2\",\"owner\":\"dev:alice\",\"body\":\"a\"}\n");
    project.write("fx/test.cases.jsonl", concat!(
        "{\"as\":\"alice\",\"op\":\"staffNotes\",\"expect\":\"NOT_STAFF\"}\n",
        "{\"as\":\"carol\",\"op\":\"staffNotes\",\"count\":2}\n",
        "{\"as\":\"bob\",\"op\":\"note\",\"args\":{\"id\":\"N1\"},\"data\":{\"id\":\"N1\",\"owner\":\"dev:bob\",\"body\":\"b\"}}\n"));
    let output = project.run(&["test", "--fixture", "fx"]);
    let out = text(&output);
    assert_eq!(output.status.code(), Some(0), "{out}");
    // N1 is bob's and hidden from alice: alice's derived id is her own N2.
    let alice = out.lines().find(|line| line.contains("note (alice)")).unwrap();
    assert!(alice.contains("complete") && alice.contains("{\"id\":\"N2\"}"), "{out}");
    assert!(out.lines().any(|line| line.contains("note (bob)") && line.contains("(from test.cases.jsonl:3)")), "{out}");
    let expected = out.lines().find(|line| line.contains("staffNotes (alice)")).unwrap();
    assert!(expected.contains("refused NOT_STAFF as expected (test.cases.jsonl:1)") && !expected.contains("give it yours") && !expected.contains("(from "), "{out}");
    assert!(out.lines().any(|line| line.contains("staffNotes (bob)") && line.contains("refused NOT_STAFF on derived arguments")), "{out}");
    assert!(out.contains("1 refused as your cases expect, 1 refused by their own require") && out.contains("cases: 3 passed, 0 failed — pass"), "{out}");
    // A failing case makes the summary say FAIL beside exit 1.
    project.write("fx/test.cases.jsonl", "{\"as\":\"carol\",\"op\":\"staffNotes\",\"count\":5}\n");
    let output = project.run(&["test", "--fixture", "fx"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(text(&output).contains("cases: 0 passed, 1 failed — FAIL"), "{}", text(&output));
}

/// Wave 7 (HTTP acceptance, 11 lanes): the guide's script handles both refusal
/// envelopes in one helper (002), shows the literal ready line (016 097), and
/// wraps the server lifecycle once (064 099); the platform binary names the npm
/// wrapper for `web-shell` instead of "unknown verb" (060).
#[test]
fn the_acceptance_recipe_reads_both_refusal_envelopes_and_web_shell_names_its_wrapper() {
    let guide = Command::new(BIN).args(["guide", "testing", "--section", "acceptance"]).output().unwrap();
    let guide = text(&guide);
    for term in ["const refusal = body => body.denied?.code ?? (body.state === \"failed\" ? body.why.code : undefined)", "async function startDev(", "exactly `http://127.0.0.1:41234` (no trailing slash", "\"NOT_OWNER\"", "web-shell dist"] {
        assert!(guide.contains(term), "guide testing's acceptance section names {term}:\n{guide}");
    }
    let output = Command::new(BIN).args(["web-shell", "dist"]).output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("web-shell is the npm wrapper's verb") && stderr.contains("node_modules/.bin/snapback4 web-shell dist") && !stderr.contains("unknown verb"), "{stderr}");
}

#[test]
fn serve_checks_port_input_and_prints_its_actual_listener_and_ready_line() {
    let project = Project::new("use identity password\nquery alive():\n  return true\n");
    for bad in ["junk", "65536", "-1", "0-2", "20-10", "1-2-3", ""] {
        let output = project.run(&["serve", "missing-release", "--port", bad]);
        assert!(!output.status.success(), "{bad}: {}", text(&output));
        assert!(text(&output).contains("E_INPUT: serve --port"), "{bad}: {}", text(&output));
        assert!(!project.0.join("missing-release").exists(), "invalid input must not create a deployment");
    }
    let help = text(&project.run(&["rollback", "--help"]));
    assert!(help.contains("--to N") && help.contains("dormant per row") && help.contains("--check"), "{help}");
    let output = project.run(&["deploy", "deployment"]);
    assert!(output.status.success(), "{}", text(&output));
    let record: serde_json::Value = serde_json::from_slice(&fs::read(project.0.join("deployment/releases/1/device-compatibility.json")).unwrap()).unwrap();
    assert_eq!(record["minimum_version"], "0.4.24");
    assert_eq!(record["server_version"], env!("CARGO_PKG_VERSION"));
    assert!(record["capabilities"].as_array().unwrap().iter().any(|c| c == "sync-generation-v1"));
    let held = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let taken = held.local_addr().unwrap().port();
    for port in ["0".to_owned(), format!("{taken}-{}", taken + 20)] {
        let child = Command::new(BIN).current_dir(&project.0)
            .args(["serve", "deployment", &format!("--port={port}")])
            .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let mut server = Dev(child);
        let stdout = server.0.stdout.take().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
            let _ = send.send(result);
        });
        let line = receive.recv_timeout(Duration::from_secs(20)).expect("serve URL deadline").unwrap();
        let url = line.trim();
        assert!(url.starts_with("http://127.0.0.1:"), "{line:?}");
        let actual: u16 = url.rsplit(':').next().unwrap().parse().unwrap();
        assert_ne!(actual, 0);
        if port != "0" { assert!(actual > taken && actual <= taken + 20); }
        assert!(std::net::TcpListener::bind(("127.0.0.1", actual)).is_err(), "the printed listener is held");
        let stderr = server.0.stderr.take().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut logs = BufReader::new(stderr);
            loop {
                let mut line = String::new();
                match logs.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) if line.contains("SNAPBACK4_READY") => { let _ = send.send(line); break; }
                    _ => {},
                }
            }
        });
        let ready = receive.recv_timeout(Duration::from_secs(20)).expect("serve ready deadline");
        assert!(ready.contains("verb=serve") && ready.contains(&format!("url={url}")) && ready.contains(&format!("pid={}", server.0.id())), "{ready}");
        assert_eq!(http(url, "GET", "/schema", None, "").0, 401);
        drop(server);
    }
}

#[test]
fn test_uses_default_fixtures_and_explicit_fixture_overrides_them() {
    let project = Project::new("use personas alice\ntable notes:\n  body: text <=20\n  public\nquery all():\n  return notes first 10 by .id\n");
    project.write("fixtures/notes.jsonl", "{\"id\":\"one\",\"body\":\"seeded\"}\n");
    project.write("fixtures/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"all\",\"count\":2}\n");
    let output = project.run(&["test"]);
    assert!(!output.status.success(), "the default case must fail: {}", text(&output));
    assert!(text(&output).contains("default fixture directory"), "{}", text(&output));
    assert!(!project.0.join(".snapback4/store.sqlite").exists(), "default fixtures must not create or mutate the dev store");
    project.write("override/notes.jsonl", "{\"id\":\"other\",\"body\":\"explicit\"}\n");
    project.write("override/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"all\",\"count\":1}\n");
    let output = project.run(&["test", "--fixture", "override"]);
    assert!(output.status.success(), "{}", text(&output));
    assert!(!text(&output).contains("default fixture directory"));
    project.write("fixtures/notes.jsonl", "bad json\n");
    assert!(!project.run(&["test"]).status.success());
}

#[test]
fn check_warns_about_installed_expo_core_version_mismatch() {
    let project = Project::new("query alive():\n  return true\n");
    project.write("node_modules/snapback4/package.json", r#"{"version":"0.4.23"}"#);
    project.write("node_modules/snapback4-expo/package.json", r#"{"version":"0.4.22"}"#);
    for flags in [&["check"][..], &["check", "--json"]] {
        let output = project.run(flags);
        assert!(output.status.success(), "{}", text(&output));
        let warning = String::from_utf8_lossy(&output.stderr);
        assert!(warning.contains("snapback4 0.4.23") && warning.contains("snapback4-expo 0.4.22") && warning.contains("snapback4 upgrade"), "{warning}");
        if flags.contains(&"--json") { serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap(); }
    }
    project.write("node_modules/snapback4-expo/package.json", r#"{"version":"0.4.23"}"#);
    assert!(!text(&project.run(&["check"])).contains("WARNING"));
}

#[test]
fn unknown_flags_refuse_every_public_verb_before_project_or_store_work() {
    let project = Project::new("use personas alice, bob\nquery who():\n  return viewer\n");
    for verb in ["init", "new", "check", "types", "dev", "deploy", "rollback", "prune", "releases", "serve", "run", "clock", "reset", "test", "why", "guide", "data", "sql", "token", "doctor", "witness", "device", "upgrade", "version", "web-shell"] {
        let output = project.run(&[verb, "--hand-unknown"]);
        assert_eq!(output.status.code(), Some(2), "{verb}: {}", text(&output));
        if verb == "witness" {
            assert!(text(&output).contains("E_INPUT: witness has an unknown flag"), "{}", text(&output));
            assert!(!text(&output).contains("hand-unknown"));
        } else {
            assert!(text(&output).contains(&format!("E_INPUT: {verb} takes no --hand-unknown")), "{}", text(&output));
        }
        assert!(!project.0.join(".snapback4").exists(), "{verb} touched a store");
        assert!(!project.0.join("snapback/generated").exists(), "{verb} generated output");
    }
    assert!(text(&project.run(&["deploy", "deployment", "--dry-run"])).contains("E_INPUT: deploy takes no --dry-run"));
    assert!(!project.0.join("deployment").exists());
}

#[test]
fn persona_lists_and_repeated_flags_run_each_requested_persona() {
    let project = Project::new("use personas alice, bob\nquery who():\n  return viewer\n");
    for args in [&["test", "--as", "alice,bob"][..], &["test", "--as", "alice", "--as", "bob"]] {
        let output = project.run(args);
        assert!(output.status.success(), "{}", text(&output));
        let out = text(&output);
        assert!(out.contains("alice") && out.contains("bob"), "{out}");
        assert!(out.contains("2 complete"), "{out}");
    }
}

#[test]
fn literal_guide_find_and_sql_object_envelope() {
    let project = Project::new("query who():\n  return viewer\n");
    for needle in ["--json-objects", "{", "'"] {
        let output = project.run(&["guide", "deploy", "--find", needle]);
        let out = text(&output);
        assert!(!out.contains("E_INPUT:"), "{out}");
        assert!(out.contains(needle), "literal search was lost: {out}");
    }
    let out = text(&project.run(&["sql", "--help"]));
    for field in ["columns", "header", "limit", "more", "rows", "ruleFiltered"] { assert!(out.contains(field), "{out}"); }
}

#[test]
fn not_run_probes_make_the_summary_incomplete() {
    let project = Project::new("use personas alice\nquery missing(id: id):\n  return id\n");
    let output = project.run(&["test"]);
    assert!(output.status.success(), "{}", text(&output));
    let out = text(&output);
    assert!(out.contains("1 not run") && out.contains("— incomplete"), "{out}");
    assert!(!out.contains("— pass"));
}

fn stamped_wasm(stamp: &serde_json::Value) -> Vec<u8> {
    fn leb(mut n: usize) -> Vec<u8> { let mut b = Vec::new(); loop { let low = (n & 127) as u8; n >>= 7; b.push(low | if n > 0 { 128 } else { 0 }); if n == 0 { return b; } } }
    let name = b"snapback4.engine";
    let mut section = leb(name.len()); section.extend(name); let engine: snapback4_core::device_protocol::DeviceEngine = serde_json::from_value(stamp.clone()).unwrap(); section.extend(serde_json::to_vec(&engine).unwrap());
    let mut wasm = b"\0asm\x01\0\0\0".to_vec(); wasm.push(0); wasm.extend(leb(section.len())); wasm.extend(section); wasm
}
#[test]
fn check_and_doctor_refuse_a_mounted_exact_device_before_generated_output() {
    let project = Project::new("use personas alice\nquery who():\n  return viewer\n");
    project.write("app/app.json", r#"{"typescript":{"sources":{"snapback4":"../../exact2/snapback4/ts","backend":"../snapback/generated"}}}"#);
    let missing = project.run(&["check"]);
    assert!(!missing.status.success() && text(&missing).contains("E_DEVICE_VERSION"), "{}", text(&missing));
    assert!(text(&missing).contains("file is missing") && text(&missing).contains("bun exact.mjs snapback --rebuild"), "{}", text(&missing));
    assert!(!text(&missing).contains("unstamped"));
    project.write("app/assets/snapback4.wasm", "old unstamped bytes");
    let output = project.run(&["check"]);
    assert!(!output.status.success(), "{}", text(&output));
    assert!(text(&output).contains("E_DEVICE_VERSION"), "{}", text(&output));
    assert!(text(&output).contains("unknown (unstamped)"), "{}", text(&output));
    assert!(text(&output).contains("no valid build stamp"), "{}", text(&output));
    assert!(!project.0.join("snapback/generated").exists());
    let output = project.run(&["doctor"]);
    assert!(!output.status.success() && text(&output).contains("E_DEVICE_VERSION"), "{}", text(&output));
    let current: serde_json::Value = serde_json::from_slice(&project.run(&["device", "--engine-info"]).stdout).unwrap();
    fs::write(project.0.join("app/assets/snapback4.wasm"), stamped_wasm(&current)).unwrap();
    assert!(project.run(&["check"]).status.success());
    let mut old = current; old["version"] = "0.4.23".into();
    fs::write(project.0.join("app/assets/snapback4.wasm"), stamped_wasm(&old)).unwrap();
    let output = project.run(&["check", "--json"]);
    assert!(!output.status.success());
    assert!(text(&output).contains("E_DEVICE_VERSION") && text(&output).contains("0.4.23"));
    assert!(text(&output).contains("build stamp present, but engine predates the floor"), "{}", text(&output));
    let output = project.run(&["doctor"]);
    assert!(text(&output).contains("build stamp present, but engine predates the floor"), "{}", text(&output));
}

#[test]
fn generated_mounts_do_not_imply_a_device_and_custom_artifacts_are_identified_by_content() {
    let project = Project::new("use personas alice\nquery who():\n  return viewer\n");
    let initialized = project.run(&["test", "--residency"]);
    assert!(initialized.status.success(), "{}", text(&initialized));
    for adapter in [None, Some("../../exact2/snapback4/online")] {
        let mut sources = serde_json::json!({"backend":"../snapback/generated"});
        if let Some(adapter) = adapter { sources["snapback4"] = adapter.into(); }
        project.write("app/app.json", &serde_json::json!({"typescript":{"sources":sources}}).to_string());
        project.write("app/assets/snapback4.wasm", "leftover unstamped bytes");
        for command in ["check", "doctor"] {
            let output = project.run(&[command]);
            assert!(output.status.success(), "{command}: {}", text(&output));
        }
    }
    // An explicit device declaration survives a readable entry with a broken import.
    project.write("app/app.json", r#"{"typescript":{"sources":{"backend":"../snapback/generated","snapback4":"../snapback4/ts"}}}"#);
    project.write("snapback4/ts/snapback.ts", "export { Snapback } from './driver.ts';");
    let output = project.run(&["check"]);
    assert!(!output.status.success() && text(&output).contains("E_DEVICE_VERSION"), "{}", text(&output));
    // A renamed adapter is still a device consumer, independent of its path.
    project.write("app/app.json", r#"{"typescript":{"sources":{"backend":"../snapback/generated","replica":"../renamed"}}}"#);
    project.write("renamed/snapback.ts", "const documentation = './web.ts';");
    project.write("renamed/web.ts", "const documentation = './generated/device.ts';");
    assert!(project.run(&["check"]).status.success());
    for entry in ["import type { webDevice } from './web.ts';", "import { type webDevice } from './web.ts';", "export type { webDevice } from './web.ts';", "import { type DeviceType as webDevice } from './web.ts';"] {
        project.write("renamed/snapback.ts", entry);
        project.write("renamed/web.ts", "import { type CoreType as WebSnapback } from './generated/device.ts';");
        for command in ["check", "doctor"] {
            let output = project.run(&[command]);
            assert!(output.status.success(), "{command}: {}", text(&output));
        }
    }
    project.write("renamed/snapback.d.ts", "import { webDevice } from './web.ts';");
    project.write("renamed/web.ts", "import { WebSnapback } from './generated/device.ts';");
    project.write("app/app.json", r#"{"typescript":{"sources":{"backend":"../snapback/generated","types":"../renamed/snapback.d.ts"}}}"#);
    for command in ["check", "doctor"] {
        let output = project.run(&[command]);
        assert!(output.status.success(), "{command}: {}", text(&output));
    }
    project.write("app/app.json", r#"{"typescript":{"sources":{"backend":"../snapback/generated","replica":"../renamed"}}}"#);
    project.write("renamed/snapback.ts", "import { webDevice } from './web.ts';");
    project.write("renamed/web.ts", "import { initSync, WebSnapback } from './generated/device.ts';");
    let output = project.run(&["check"]);
    assert!(!output.status.success() && text(&output).contains("E_DEVICE_VERSION"), "{}", text(&output));
    for (entry, web) in [
        ("import * as web from './web.ts'; export const use = web.webDevice;", "import * as gen from './generated/device.ts'; export const use = gen.WebSnapback;"),
        ("import web from './web.ts'; export const use = web;", "import gen from './generated/device.ts'; export default gen;"),
        ("export { webDevice } from './web.ts';", "export { WebSnapback } from './generated/device.ts';"),
        ("export * from './web.ts';", "export * from './generated/device.ts';"),
        ("import './web.ts';", "import './generated/device.ts';"),
        ("import {} from './web.ts';", "import { WebSnapback } from './generated/device.ts';"),
        ("import { webDevice } from './web.ts';", "import {} from './generated/device.ts';"),
        ("import {} from './web.ts';", "import {} from './generated/device.ts';"),
        ("export const web = import('./web.ts');", "export const gen = import(`./generated/device.ts`);"),
        ("import web = require('./web.ts'); export const use = web;", "import gen = require('./generated/device.ts'); export const use = gen;"),
    ] {
        project.write("renamed/snapback.ts", entry); project.write("renamed/web.ts", web);
        for command in ["check", "doctor"] {
            let output = project.run(&[command]);
            assert!(!output.status.success() && text(&output).contains("E_DEVICE_VERSION"), "{command} {entry}: {}", text(&output));
        }
    }
    // An unrelated backend isn't this project's consumer.
    project.write("app/app.json", r#"{"typescript":{"sources":{"backend":"../other/generated","replica":"../renamed"}}}"#);
    project.write("other/generated/.keep", "");
    assert!(project.run(&["check"]).status.success());
    project.write("app/app.json", r#"{"typescript":{"sources":{"backend":"../snapback/generated"}}}"#);
    project.write("app/app.ts", "const wasm = '/assets/custom.bin';");
    let current: serde_json::Value = serde_json::from_slice(&project.run(&["device", "--engine-info"]).stdout).unwrap();
    project.write("app/assets/custom.bin", "unrelated artifact");
    assert!(project.run(&["check"]).status.success());
    let mut old = current.clone(); old["version"] = "0.4.23".into();
    fs::write(project.0.join("app/assets/custom.bin"), stamped_wasm(&old)).unwrap();
    let output = project.run(&["check"]);
    assert!(!output.status.success() && text(&output).contains("custom.bin"), "{}", text(&output));
    for source in [
        "const quote = /'/; const device = openDevice('/assets/custom.bin');",
        "let n = 4; const ratio = n++ / 2; const device = openDevice('/assets/custom.bin');",
        "if (enabled) /'/.test(text); const device = openDevice('/assets/custom.bin');",
        "const ratio = ({}) / 2; const device = openDevice('/assets/custom.bin');",
        "const ratio = {} / 2; const device = openDevice('/assets/custom.bin');",
        "const n: number | null = 4; const ratio = n! / 2; const device = openDevice('/assets/custom.bin');",
        "import type { T } from './types.ts'\nvar device = openDevice('/assets/custom.bin');",
        "import type { T } from './types.ts'\nopenDevice('/assets/custom.bin');",
        r"const device = openDevice('/assets\/custom.bin');",
        "const device = openDevice('/assets/custom.bin?v=1#stamp');",
        "const device = openDevice('./assets/custom.bin?v=1#stamp');",
        "const device = openDevice('/assets/%63ustom.bin');",
        r"const device = openDevice('/assets/\u0063ustom.bin');",
    ] {
        project.write("app/app.ts", source);
        for command in ["check", "doctor"] {
            let output = project.run(&[command]);
            assert!(!output.status.success() && text(&output).contains("custom.bin") && text(&output).contains("E_DEVICE_VERSION"), "{command} {source}: {}", text(&output));
        }
    }
    // URL escapes resolve once: %2563 requests a literal %63, not a c.
    project.write("app/app.ts", "const device = openDevice('/assets/%2563ustom.bin');");
    for command in ["check", "doctor"] {
        let output = project.run(&[command]);
        assert!(output.status.success(), "{command}: {}", text(&output));
    }
    fs::write(project.0.join("app/assets/%63ustom.bin"), stamped_wasm(&old)).unwrap();
    for command in ["check", "doctor"] {
        let output = project.run(&[command]);
        assert!(!output.status.success() && text(&output).contains("E_DEVICE_VERSION") && text(&output).contains("%63ustom.bin"), "{command}: {}", text(&output));
    }
    // Erased type literal paths don't load a custom device either.
    project.write("app/app.ts", "type Artifact = '/assets/custom.bin';");
    assert!(project.run(&["check"]).status.success());
    for erased in [
        "interface AssetTypes { '/assets/custom.bin': ArrayBuffer }",
        "declare const wasm = '/assets/custom.bin';",
        "export default interface AssetTypes { '/assets/custom.bin': ArrayBuffer }",
        "declare namespace Assets { const wasm = '/assets/custom.bin'; }",
        "abstract class Assets { declare ['/assets/custom.bin']: ArrayBuffer; }",
        "abstract class Assets { abstract ['/assets/custom.bin'](): ArrayBuffer; }",
        "abstract class Assets { abstract accessor ['/assets/custom.bin']: ArrayBuffer; }",
    ] {
        project.write("app/app.ts", erased);
        for command in ["check", "doctor"] {
            let output = project.run(&[command]);
            assert!(output.status.success(), "{command} {erased}: {}", text(&output));
        }
    }
    // Comments and unreferenced files cannot declare a custom consumer.
    project.write("app/app.ts", "// const wasm = '/assets/custom.bin';\n/* '/assets/custom.bin' */");
    assert!(project.run(&["check"]).status.success());
    project.write("app/app.ts", "const wasm = '/assets/custom.bin';");
    let mut missing = current.clone(); missing["capabilities"] = serde_json::json!([]);
    fs::write(project.0.join("app/assets/custom.bin"), stamped_wasm(&missing)).unwrap();
    let output = project.run(&["check"]);
    assert!(!output.status.success() && text(&output).contains("E_DEVICE_VERSION"), "{}", text(&output));
    fs::write(project.0.join("app/assets/custom.bin"), stamped_wasm(&current)).unwrap();
    assert!(project.run(&["check"]).status.success());
    // A recognized section with corrupt JSON must still be gated.
    let mut corrupt = stamped_wasm(&current); *corrupt.last_mut().unwrap() = b'!';
    fs::write(project.0.join("app/assets/custom.bin"), corrupt).unwrap();
    let output = project.run(&["check"]);
    assert!(!output.status.success() && text(&output).contains("E_DEVICE_VERSION"), "{}", text(&output));
}

#[test]
fn guide_find_without_a_card_searches_punctuation_and_reports_literal_misses() {
    let project=Project::new("query who():\n  return viewer\n");
    let output=project.run(&["guide","--find","sum("]);
    assert!(output.status.success(),"{}",text(&output));
    assert!(text(&output).contains("sum(") && text(&output).contains("guide "));
    for needle in ["--hand-no-such-option"] {
        let output=project.run(&["guide","--find",needle]);
        assert_eq!(output.status.code(),Some(1),"{}",text(&output));
        assert!(text(&output).contains(needle) && text(&output).contains("no line of any guide card"),"{}",text(&output));
    }
}

#[test]
fn help_as_a_guide_search_term_does_not_select_the_cli_help_page() {
    let project=Project::new("query who():\n  return viewer\n");
    let output=project.run(&["guide","--find","--help"]);
    assert_ne!(output.status.code(),Some(2));
    assert!(!text(&output).starts_with("snapback4 guide ["),"{}",text(&output));
    assert!(text(&output).contains("--help"));
}

#[test]
fn mutation_reply_omits_unrequested_id_and_keeps_result_id() {
    let project = Project::new("use personas alice\ntable notes:\n  title: text 1..80\n  public\n  insert <- allow\nmutation add(title: text 1..80):\n  return insert notes { title }\nmutation refuse():\n  require false else NO_PROOF\n  return null\n");
    let (_dev, url) = project.dev(0);
    for path in ["/m/add", "/m/refuse"] {
        let args = if path.ends_with("add") { r#"{"args":{"title":"first"}}"# } else { r#"{"args":{}}"# };
        let (_, reply) = http(&url, "POST", path, Some("alice"), args);
        assert!(!reply.as_object().unwrap().contains_key("id"), "{reply}");
        if path.ends_with("add") { assert!(reply["result"]["id"].is_string(), "{reply}"); }
    }
    let (_, sent) = http(&url, "POST", "/m/add", Some("alice"), r#"{"id":"proof-write","args":{"title":"second"}}"#);
    assert_eq!(sent["id"], "proof-write");
    let (_, replay) = http(&url, "POST", "/m/add", Some("alice"), r#"{"id":"proof-write","args":{"title":"second"}}"#);
    assert_eq!(replay["replayed"], true); assert!(replay.get("result").is_none());
}

#[test]
fn inspection_selects_release_explicitly_and_names_misplaced_sql_flags() {
    let project = Project::new("use identity password\ntable notes:\n  body: text <=100\n  public 'public notes'\n  online only\nquery alive():\n  return true\n");
    let deployed = project.run(&["deploy", "deployment"]);
    assert!(deployed.status.success(), "{}", text(&deployed));
    assert!(!project.0.join(".snapback4/store.sqlite").exists());
    for args in [&["sql", "SELECT id FROM notes"][..], &["data", "notes"]] {
        let output = project.run(args);
        assert!(!output.status.success());
        let error = text(&output);
        assert!(error.contains("--release <dir>") && error.contains("deployment"), "{error}");
        assert!(!project.0.join(".snapback4/store.sqlite").exists());
    }
    for flag in ["--release deployment", "--limit 10", "--json", "--json-objects"] {
        let output = project.run(&["sql", &format!("SELECT id FROM notes {flag}")]);
        assert!(!output.status.success());
        let error = text(&output);
        assert!(error.contains("inside the SQL argument") && error.contains("closing quote"), "{error}");
    }
    let output = project.run(&["sql", "SELECT '--release deployment' AS literal", "--release", "deployment", "--json-objects"]);
    assert!(output.status.success(), "{}", text(&output));
    let answer: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(answer["rows"][0]["literal"], "--release deployment");
    let output = project.run(&["data", "notes", "--release", "deployment"]);
    assert!(output.status.success(), "{}", text(&output));
    assert_eq!(output.stdout, b"");
    // Explicit release inspection also works outside an application's source tree.
    let output = Command::new(BIN).current_dir(std::env::temp_dir()).args(["data", "notes", "--release"])
        .arg(project.0.join("deployment")).output().unwrap();
    assert!(output.status.success(), "{}", text(&output));
}
