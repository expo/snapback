//! Wave-30 campaign/fixture status and exact-clock CLI replays.
use std::{fs, path::PathBuf, process::{Command, Output}, sync::atomic::{AtomicUsize,Ordering}};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
static SERIAL: AtomicUsize = AtomicUsize::new(0);
struct App(PathBuf);
impl App {
    fn new(source: &str) -> Self {
        let dir=std::env::temp_dir().join(format!("dx14-output-{}-{}",std::process::id(),SERIAL.fetch_add(1,Ordering::Relaxed)));
        fs::create_dir_all(dir.join("snapback")).unwrap();
        fs::write(dir.join("snapback/schema.q"),source).unwrap();
        Self(dir)
    }
    fn run(&self,args: &[&str])->Output {Command::new(BIN).current_dir(&self.0).args(args).output().unwrap()}
}
impl Drop for App {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn text(out:&Output)->String {format!("{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr))}

#[test]
fn wave30_024e_049r_050r_campaign_completion_does_not_inherit_probe_gaps() {
    let app=App::new("use personas alice\ntable notes:\n  title: text <=80\n  owner: principal\n  read <- .owner = viewer\n  online only\nquery note(row: notes):\n  return notes[row]\n");
    let out=app.run(&["test","--explain"]);let text=text(&out);
    assert!(out.status.success(),"{text}");
    assert!(text.contains("security campaign: completed"),"{text}");
    assert!(text.contains("authored cases: not provided"),"{text}");
    assert!(text.contains("query probes:")&&text.contains("1 not run"),"{text}");
    assert!(text.lines().any(|l|l.starts_with("test: no failing observations")),"{text}");
    assert!(!text.lines().any(|l|l.starts_with("security campaign:")&&l.contains("incomplete")),"{text}");
}

#[test]
fn wave30_008r_020e_exact_deadline_runs_are_independent_of_a_live_staging_clock() {
    let app=App::new("mutation attempt(deadline: time, status: enum('open','closed')):\n  require now < deadline else DEADLINE\n  require status = 'open' else CLOSED\n  return null\n");
    for (now,status,expected) in [("99","open",None),("100","open",Some("DEADLINE")),("101","closed",Some("DEADLINE")),("99","closed",Some("CLOSED"))] {
        let args=format!("{{\"deadline\":100,\"status\":\"{status}\"}}");
        let out=app.run(&["run","attempt",&args,"--now",now]);let text=text(&out);
        if let Some(code)=expected {assert!(text.contains(code),"{now} {status}: {text}");}
        else {assert!(out.status.success(),"{now}: {text}");}
    }
}

#[test]
fn wave30_audit_json_is_pretty_and_still_one_parseable_document() {
    let app=App::new("query alive():\n  return true\n");
    let out=app.run(&["audit","--json"]);let text=String::from_utf8(out.stdout).unwrap();
    assert!(out.status.success(),"{text}");
    let value:serde_json::Value=serde_json::from_str(&text).unwrap();
    assert!(value["securityReviews"].is_array());
    assert!(text.lines().count()>3,"{text}");
}
