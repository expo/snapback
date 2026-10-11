use super::*;

fn shutdown_flushes(signal: i32, worker: bool) {
    let project = Project::new();
    if worker {
        fs::write(project.0.join("snapback/worker.mjs"), "import {writeFileSync} from 'node:fs'; writeFileSync('worker-ready', 'yes'); setInterval(() => {}, 1000);\n").unwrap();
    }
    // `--verbose` keeps the full record line this test reads (count, instance).
    let mut dev = Host::start_with(project, true, false, &["--verbose"]);
    if worker {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !dev.project.0.join("worker-ready").exists() {
            assert!(Instant::now() < deadline, "worker never started");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    // An initial whitespace heartbeat proves this request entered the held
    // poll; keep its socket and sender clone alive across process shutdown.
    let mut poll = TcpStream::connect(&dev.address).unwrap();
    poll.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(poll, "GET /changes?since=0&wait=25&heartbeat=1 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\n\r\n").unwrap();
    let mut poll = BufReader::new(poll);
    let mut headers = String::new();
    loop {
        let mut line = String::new();
        assert!(poll.read_line(&mut line).unwrap() > 0);
        headers.push_str(&line);
        if line == "\r\n" { break; }
    }
    assert!(headers.contains("Transfer-Encoding: chunked"), "not a held poll: {headers}");
    let mut heartbeat = [0; 6];
    poll.read_exact(&mut heartbeat).unwrap();
    assert_eq!(&heartbeat, b"1\r\n\n\r\n");
    let began = Instant::now();
    let mut store = String::new();
    for _ in 0..8 { store = dev.refuse("add")["store_id"].as_str().unwrap().into(); }
    // Refused writes do not advance the change head. The poll is still held.
    assert!(began.elapsed() < Duration::from_millis(700), "burst missed the aggregation window");
    assert!(!fs::read_to_string(&dev.stderr).unwrap().contains("dev refusal:"));
    assert_eq!(unsafe { libc::kill(dev.child.id() as i32, signal) }, 0);
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = dev.child.try_wait().unwrap() { break status; }
        assert!(Instant::now() < deadline, "shutdown waited for a 25-second held poll");
        std::thread::sleep(Duration::from_millis(10));
    };
    let text = fs::read_to_string(&dev.stderr).unwrap();
    let lines: Vec<_> = text.lines().filter(|line| line.starts_with("dev refusal:")).collect();
    assert_eq!(lines.len(), 1, "signal {signal}, worker {worker}: {text}");
    assert!(lines[0].contains("code \"E_RULE\"; count 8; window 1s;"), "{text}");
    assert_eq!(status.code(), Some(128 + signal));
    let records: Value = serde_json::from_slice(&fs::read(dev.project.record_path(&store)).unwrap()).unwrap();
    assert_eq!(records["records"].as_array().unwrap().len(), 8);
    assert_eq!(records["dropped"], 0);
    assert!(lines[0].contains(records["instance"].as_str().unwrap()));
    assert!(!dev.project.why(&[]).status.success(), "stopped evidence must not appear live");
}

#[test]
fn sigterm_with_worker_flushes_refusals_while_a_poll_is_held() { shutdown_flushes(libc::SIGTERM, true); }
#[test]
fn sigint_with_worker_flushes_refusals_while_a_poll_is_held() { shutdown_flushes(libc::SIGINT, true); }
#[test]
fn sigint_without_worker_flushes_refusals_while_a_poll_is_held() { shutdown_flushes(libc::SIGINT, false); }
#[test]
fn sigterm_without_worker_flushes_refusals_while_a_poll_is_held() { shutdown_flushes(libc::SIGTERM, false); }
