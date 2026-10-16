//! DAY4 proof-case accounting and saved-fixture drift regressions.
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str = "use personas alice\ntable notes:\n  title: text <=80\n  public 'test'\n  online only\nquery list():\n  return notes first 20 by .id\nquery echo(n: int):\n  return n\nmutation refuse():\n  require false else NO_PROOF\n  return null\n";
static NEXT: AtomicUsize = AtomicUsize::new(0);

struct App(PathBuf);
impl App {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "sb4-day4-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(BIN)
            .args(args)
            .current_dir(&self.0)
            .output()
            .unwrap()
    }
}
impl Drop for App {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn machine_summary_counts_only_business_cases_and_names_skipped_fallback_cases() {
    let app = App::new();
    app.write("snapback/schema.q", SOURCE);
    app.write("versions/v1/schema.q", SOURCE);
    app.write(
        "versions/v1/fixtures/notes.jsonl",
        "{\"id\":\"one\",\"title\":\"hello\"}\n",
    );

    let sweep_only = app.run(&["test", "--source", "versions/v1"]);
    assert!(sweep_only.status.success(), "{sweep_only:?}");
    let stdout = String::from_utf8_lossy(&sweep_only.stdout);
    assert!(
        stdout.contains("complete")
            && stdout.contains("SNAPBACK4_TEST_CASES {\"run\":0,\"skipped\":0}"),
        "{stdout}"
    );

    app.write(
        "versions/v1/fixtures/test.cases.jsonl",
        "{\"op\":\"list\",\"count\":1}\n",
    );
    let one = app.run(&["test", "--source", "versions/v1"]);
    assert!(one.status.success(), "{one:?}");
    assert!(
        String::from_utf8_lossy(&one.stdout)
            .contains("SNAPBACK4_TEST_CASES {\"run\":1,\"skipped\":0}")
    );

    fs::remove_dir_all(app.0.join("versions/v1/fixtures")).unwrap();
    app.write(
        "fixtures/notes.jsonl",
        "{\"id\":\"one\",\"title\":\"hello\"}\n",
    );
    app.write("fixtures/test.cases.jsonl", "// application cases\n{\"op\":\"list\",\"count\":1}\n\n{\"op\":\"echo\",\"args\":{\"n\":1}}\n");
    let fallback = app.run(&["test", "--source", "versions/v1"]);
    assert!(fallback.status.success(), "{fallback:?}");
    assert!(
        String::from_utf8_lossy(&fallback.stdout)
            .contains("SNAPBACK4_TEST_CASES {\"run\":0,\"skipped\":2}")
    );
}

#[test]
fn check_warns_about_saved_fixture_shape_without_running_or_rewriting_it() {
    let app = App::new();
    app.write("snapback/schema.q", SOURCE);
    app.write("versions/v1/schema.q", SOURCE);
    app.write(
        "versions/v1/fixtures/notes.jsonl",
        "{\"id\":\"one\",\"title\":\"hello\",\"later\":true}\n",
    );
    app.write("versions/v1/fixtures/removed.jsonl", "{\"id\":\"x\"}\n");
    let cases = concat!(
        "{\"op\":\"gone\",\"args\":{}}\n",
        "{\"op\":\"echo\",\"args\":{\"wrong\":1}}\n",
        "{\"op\":\"echo\",\"args\":{\"n\":\"wrong\"}}\n",
        "{\"op\":\"echo\",\"args\":{\"n\":\"$saved.id\"}}\n",
        "{\"op\":\"refuse\",\"expect\":\"sent\"}\n"
    );
    app.write("versions/v1/fixtures/test.cases.jsonl", cases);
    let before_rows = fs::read(app.0.join("versions/v1/fixtures/notes.jsonl")).unwrap();
    let before_cases = fs::read(app.0.join("versions/v1/fixtures/test.cases.jsonl")).unwrap();

    let checked = app.run(&["check"]);
    assert!(checked.status.success(), "{checked:?}");
    let stderr = String::from_utf8_lossy(&checked.stderr);
    for text in [
        "saved fixture drift",
        "no field `later`",
        "no table `removed`",
        "no operation `gone`",
        "takes no argument `wrong`",
        "missing argument `n`",
        "does not match the saved schema",
    ] {
        assert!(stderr.contains(text), "missing {text:?}: {stderr}");
    }
    assert!(
        !stderr.contains("NO_PROOF"),
        "check must not execute saved cases: {stderr}"
    );
    assert_eq!(
        fs::read(app.0.join("versions/v1/fixtures/notes.jsonl")).unwrap(),
        before_rows
    );
    assert_eq!(
        fs::read(app.0.join("versions/v1/fixtures/test.cases.jsonl")).unwrap(),
        before_cases
    );
}

#[test]
fn check_distinguishes_required_columns_from_seed_supplied_columns() {
    let app = App::new();
    let source = "table requireds:\n  title: text <=80\n  public 'requireds'\n  online only\ntable defaulteds:\n  at: time default now\n  public 'defaulteds'\n  online only\ntable optionals:\n  detail: text <=80 ?\n  public 'optionals'\n  online only\ntable posts:\n  likeCount: count likes by postId\n  public 'posts'\n  online only\ntable likes:\n  postId: posts\n  public 'likes'\n  online only\n";
    app.write("snapback/schema.q", source);
    app.write("versions/v1/schema.q", source);
    app.write("versions/v1/fixtures/requireds.jsonl", "{\"id\":\"one\"}\n");
    app.write(
        "versions/v1/fixtures/defaulteds.jsonl",
        "{\"id\":\"one\"}\n",
    );
    app.write("versions/v1/fixtures/optionals.jsonl", "{\"id\":\"one\"}\n");
    app.write("versions/v1/fixtures/posts.jsonl", "{\"id\":\"one\"}\n");

    let checked = app.run(&["check"]);
    assert!(checked.status.success(), "{checked:?}");
    let stderr = String::from_utf8_lossy(&checked.stderr);
    let drift = stderr
        .lines()
        .filter(|line| line.contains("saved fixture drift"))
        .collect::<Vec<_>>();
    assert_eq!(drift.len(), 1, "{stderr}");
    assert!(
        drift[0].contains("requireds.jsonl:1") && drift[0].contains("requireds.title is required"),
        "{stderr}"
    );
    for accepted in ["defaulteds.jsonl", "optionals.jsonl", "posts.jsonl"] {
        assert!(!stderr.contains(accepted), "{accepted}: {stderr}");
    }
}

#[test]
fn check_accepts_omitted_sequences_and_warns_when_fixture_supplies_them() {
    let app = App::new();
    let source = "table lists:\n  itemCount: count items by list\n  public 'lists'\n  online only\ntable items:\n  list: lists\n  pos: sequence by list\n  public 'items'\n  online only\n";
    app.write("snapback/schema.q", source);
    app.write("versions/v1/schema.q", source);
    app.write(
        "versions/v1/fixtures/lists.jsonl",
        "{\"id\":\"list\"}\n{\"id\":\"maintained\",\"itemCount\":1}\n",
    );
    app.write(
        "versions/v1/fixtures/items.jsonl",
        "{\"id\":\"assigned\",\"list\":\"list\"}\n{\"id\":\"supplied\",\"list\":\"list\",\"pos\":7}\n",
    );

    let checked = app.run(&["check"]);
    assert!(checked.status.success(), "{checked:?}");
    let stderr = String::from_utf8_lossy(&checked.stderr);
    let drift = stderr
        .lines()
        .filter(|line| line.contains("saved fixture drift"))
        .collect::<Vec<_>>();
    assert_eq!(drift.len(), 2, "{stderr}");
    assert!(
        drift
            .iter()
            .any(|line| line.contains("items.jsonl:2") && line.contains("E_SEQUENCE_SUPPLIED")),
        "{stderr}"
    );
    assert!(
        drift
            .iter()
            .any(|line| line.contains("lists.jsonl:2") && line.contains("E_MAINTAINED_COLUMN")),
        "{stderr}"
    );
    assert!(!stderr.contains("items.jsonl:1"), "{stderr}");
    assert!(!stderr.contains("lists.jsonl:1"), "{stderr}");
}
