use super::*;

fn project() -> Arc<Project> {
    let project = Project::new();
    fs::write(project.0.join("snapback/schema.q"), format!("{SOURCE}\nquery page():\n  return rows first 5 by .id\nquery point():\n  return rows['absent']\nquery composed():\n  return {{outer: {{row: rows['absent']}}}}\nquery refused():\n  require false else EMPTY_READ\n  return 1\n")).unwrap();
    project
}
fn snapshot(dev: &Host) -> Value {
    let output = dev.project.why(&[]);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}
fn wait_console(dev: &Host, needle: &str) -> String {
    let end = Instant::now() + Duration::from_secs(10);
    loop {
        let text = fs::read_to_string(&dev.stderr).unwrap();
        if text.contains(needle) { return text; }
        assert!(Instant::now() < end, "missing {needle}: {text}");
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn many_empty_reads_are_silent_and_do_not_advance_evidence() {
    let dev = Host::start(project(), true, false);
    let empty = snapshot(&dev);
    assert_eq!(empty["traceEmpty"], false);
    assert_eq!(empty["records"], json!([]));
    for _ in 0..200 {
        for (op, data) in [("page", json!([])), ("point", Value::Null), ("composed", json!({"outer":{"row":null}}))] {
            assert_eq!(dev.post(&format!("/q/{op}"), json!({}))["data"], data);
        }
    }
    assert_eq!(snapshot(&dev), empty);
    // The writer has no queued work or pending watermark to hide later output.
    assert!(!fs::read_to_string(&dev.stderr).unwrap().contains("dev refusal:"));
    let refusal = dev.refuse("add");
    let before = dev.project.wait_record(refusal["store_id"].as_str().unwrap(), "add");
    dev.post("/q/page", json!({}));
    assert_eq!(snapshot(&dev), before, "an empty success is not newer refusal evidence");
}
#[test]
fn tracing_records_unknown_empties_without_console_noise() {
    let dev = Host::start_with(project(), true, false, &["--trace-empty"]);
    assert_eq!(snapshot(&dev)["traceEmpty"], true);
    for op in ["page", "point", "composed"] {
        let reply = dev.post(&format!("/q/{op}"), json!({}));
        assert!(reply.get("denied").is_none());
        assert!(!reply.to_string().contains("EMPTY_READ"));
        let store = snapshot_store(&dev);
        let envelope = dev.project.wait_record(&store, op);
        let last = envelope["records"].as_array().unwrap().last().unwrap();
        assert_eq!(last["code"], "EMPTY_READ");
        assert_eq!(last["emptyRead"], true);
        assert_eq!(last["clause"], "cause not instrumented");
    }
    // A real refusal is still printed, even if an application picked this code.
    assert_eq!(dev.post("/q/refused", json!({}))["denied"]["code"], "EMPTY_READ");
    let text = wait_console(&dev, "dev refusal: refused:");
    assert_eq!(text.lines().filter(|line| line.starts_with("dev refusal:")).count(), 1);
}
fn snapshot_store(dev: &Host) -> String {
    fs::read_dir(dev.project.0.join(".snapback4/dev-refusals")).unwrap()
        .next().unwrap().unwrap().file_name().into_string().unwrap()
}
#[test]
fn real_refusals_keep_individual_records_and_print_one_counted_line() {
    let dev = Host::start(Project::new(), true, false);
    let store = snapshot_store(&dev);
    for _ in 0..8 { dev.refuse("add"); }
    let end = Instant::now() + Duration::from_secs(10);
    loop {
        let output = dev.project.why(&[]);
        if output.status.success() {
            let records: Value = serde_json::from_slice(&output.stdout).unwrap();
            if records["records"].as_array().unwrap().len() == 8 {
                assert_eq!(records["dropped"], 0);
                assert!(records["records"].as_array().unwrap().iter().all(|r| r["code"] == "E_RULE" && r["clause"] == "insert rule"));
                break;
            }
        }
        assert!(Instant::now() < end);
        std::thread::sleep(Duration::from_millis(10));
    }
    let text = wait_console(&dev, "count 8; window 1s");
    assert_eq!(text.lines().filter(|line| line.starts_with("dev refusal:")).count(), 1);
    assert!(text.contains(&store));
    dev.refuse("add");
    wait_console(&dev, "count 1; window 1s");
}
#[test]
fn empty_read_card_is_served_by_both_verbs() {
    let why = Command::new(BIN).args(["why", "EMPTY_READ"]).output().unwrap();
    let guide = Command::new(BIN).args(["guide", "EMPTY_READ"]).output().unwrap();
    assert!(why.status.success()); assert!(guide.status.success());
    assert_eq!(why.stdout, guide.stdout);
    let text = String::from_utf8(why.stdout).unwrap();
    for command in ["snapback4 dev --trace-empty", "snapback4 why recent", "snapback4 why OPERATION", "snapback4 why TABLE", "snapback4 check --residency", "snapback4 test --fixture DIR --as alice --residency --verbose", "snapback4 guide sync"] {
        assert!(text.contains(command), "missing {command}: {text}");
    }
    assert!(text.contains("does not prove denial"));
}
