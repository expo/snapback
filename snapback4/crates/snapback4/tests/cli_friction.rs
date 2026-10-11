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
        "{\"as\":\"eve\",\"op\":\"page\"}\n"));
    let output = project.run(&["test", "--fixture", "fx", "--as", "alice"]);
    let out = text(&output);
    assert_eq!(output.status.code(), Some(1), "{out}");
    assert!(out.contains("cases: 2 passed, 4 failed"), "{out}");
    assert!(out.contains("ok   test.cases.jsonl:1 page (alice) → capped") && out.contains("capped is this query's check verdict: page is never complete (N_NEVER_COMPLETE at schema.q:"), "{out}");
    assert!(out.contains("FAIL test.cases.jsonl:2 page (alice) → capped: expected complete, got capped") && out.contains("add \"expect\":\"capped\""), "{out}");
    assert!(out.contains("NOT_FOUND is the program's own refusal at `i = items[item] ! else NOT_FOUND` (schema.q:")
        && out.contains("the items read rule `read <- .owner = viewer`") && out.contains("a later `require … else NOT_YOURS` never ran"), "{out}");
    assert!(out.contains("seats refused it: unique slot, at `unique slot else SEAT_TAKEN` (schema.q:") && out.contains("a row with this `unique slot` key exists that this viewer cannot read"), "{out}");
    assert!(out.contains("ok   test.cases.jsonl:5 page (eve) → E_AUTH"), "{out}");
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
