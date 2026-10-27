//! Exercise output custody and histories through the actual binary and store.
use std::{fs, path::PathBuf, process::{Command,Output}};
struct App(PathBuf);
impl App {
    fn new() -> Self {
        static N:std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);
        let root=std::env::temp_dir().join(format!("tok2-output-{}-{}",std::process::id(),N.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));
        fs::create_dir_all(root.join("snapback")).unwrap();
        let app=Self(root);app.source(80);app
    }
    fn source(&self,max:u32) {fs::write(self.0.join("snapback/schema.q"),format!("use personas alice\ntable notes:\n  title: text <={max}\n  public 'budget fixture'\n  online only\nquery list():\n  return notes first 20 by .id\n")).unwrap();}
    fn run(&self,args:&[&str])->Output {Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&self.0).output().unwrap()}
    fn ok(&self,args:&[&str],budget:usize)->String {
        let o=self.run(args);let text=format!("{}{}",String::from_utf8_lossy(&o.stdout),String::from_utf8_lossy(&o.stderr));
        assert!(o.status.success(),"{args:?}: {text}");assert!(text.lines().count()<=budget,"{args:?}: {text}");text
    }
    fn detail(&self,verb:&str)->String {fs::read_to_string(self.0.join(format!(".snapback4/last/{verb}.txt"))).unwrap()}
}
impl Drop for App {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
#[test]
fn release_budgets_complete_evidence_and_disposable_delta_history() {
    let a=App::new();
    for args in [&["deploy","production"][..], &["deploy","staging","--staging"][..]] {let t=a.ok(args,3);assert!(t.contains("release 1 current")&&t.contains(".snapback4/last/deploy.txt"),"{t}");}
    assert!(a.detail("deploy").contains("security"));
    let first=a.ok(&["releases","production"],3);assert!(first.contains("current 1"));
    let repeat=a.ok(&["releases","production"],1);assert!(repeat.contains("unchanged"));
    let json=a.ok(&["releases","production","--json"],usize::MAX);
    let v:serde_json::Value=serde_json::from_str(&json).unwrap();assert!(v["live"].is_object()&&v["events"].is_array());
    a.ok(&["deploy","production","--check"],3);
    assert!(a.ok(&["deploy","production","--check"],1).contains("unchanged"));
    a.source(160);
    let changed=a.ok(&["deploy","production","--check"],3);assert!(!changed.contains("deploy: unchanged;"),"{changed}");
    assert!(a.detail("deploy").contains("\"hazards\""));
    assert!(a.ok(&["deploy","production","--check"],1).contains("unchanged"),"synthetic preview timestamps do not make a changed candidate change again");
    assert!(changed.contains("WARNING")&&changed.contains("RESULT REVIEW"),"{changed}");
    a.ok(&["deploy","production"],3);
    a.ok(&["rollback","production","--to","1","--check"],3);
    a.ok(&["rollback","production","--to","1"],3);
    let detail=a.detail("rollback");assert!(detail.contains("generation"));
    let full=a.ok(&["releases","production","--explain"],usize::MAX);assert!(full.contains("\"events\""));
    let fail=a.run(&["rollback","production","--to","999"]);
    let t=format!("{}{}",String::from_utf8_lossy(&fail.stdout),String::from_utf8_lossy(&fail.stderr));
    assert!(!fail.status.success()&&t.lines().count()<=9&&t.contains("999"),"{t}");
    assert!(a.detail("rollback").contains("999"));
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;assert_eq!(fs::metadata(a.0.join(".snapback4/last/rollback.txt")).unwrap().permissions().mode()&0o777,0o600);}
}
#[test]
fn data_deltas_and_test_json_keep_the_entire_machine_report() {
    let a=App::new();a.ok(&["deploy","production"],3);
    a.ok(&["data","notes","--release","production"],3);
    assert!(a.ok(&["data","notes","--release","production"],1).contains("unchanged"));
    assert!(a.detail("data").contains("\"rows\""));
    assert!(a.ok(&["data","notes","--release","production","--explain"],usize::MAX).contains("details:"));
    let out=a.ok(&["test","--fixture-only"],3);
    assert!(out.contains("authored cases")&&out.contains("finite, not proof"),"{out}");
    let out=a.ok(&["test","--fixture-only","--json"],usize::MAX);
    let v:serde_json::Value=serde_json::from_str(&out).unwrap();assert_eq!(v["ok"],true);
    assert!(v["evidence"].as_array().unwrap().iter().any(|v|v["cases"]["passed"].is_number()&&v["security"].is_object()));
    assert!(v["report"].as_str().unwrap().contains("query probes:"));
}
#[cfg(unix)]
#[test]
fn lost_detail_custody_reprints_evidence_without_reversing_a_commit() {
    use std::os::unix::fs::symlink;
    let a=App::new();let elsewhere=a.0.join("elsewhere");fs::create_dir(&elsewhere).unwrap();symlink(&elsewhere,a.0.join(".snapback4")).unwrap();
    let o=a.run(&["deploy","production"]);let t=format!("{}{}",String::from_utf8_lossy(&o.stdout),String::from_utf8_lossy(&o.stderr));
    assert!(o.status.success()&&t.contains("details unavailable")&&t.contains("release 1 is current"),"{t}");
    assert!(!elsewhere.join("last/deploy.txt").exists());
}

#[test]
fn ephemeral_inspection_reports_skipped_instead_of_complete() {
    let a=App::new();fs::write(a.0.join("snapback/schema.q"),"use personas alice\ntable pulses:\n  owner: principal\n  unique owner\n  read <- allow\n  insert <- .owner = viewer\n  ephemeral 4s\n").unwrap();
    a.ok(&["deploy","staging","--staging"],3);
    let t=a.ok(&["data","pulses","--release","staging"],3);
    assert!(t.contains("skipped: live serving memory only")&&!t.contains("; complete"),"{t}");
}
#[cfg(unix)]
#[test]
fn serve_startup_keeps_url_readiness_clock_and_full_details_in_three_lines() {
    use std::{io::{BufRead,BufReader},process::Stdio,sync::mpsc,time::{Duration,Instant}};
    struct Host(std::process::Child);
    impl Drop for Host{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
    fn startup(a:&App,verbose:bool)->String {
        let mut command=Command::new(env!("CARGO_BIN_EXE_snapback4"));command.current_dir(&a.0).args(["serve","staging","--port","0"]);
        if verbose{command.arg("--explain");}
        let mut host=Host(command.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap());
        let (send,recv)=mpsc::channel();let mut readers=Vec::new();
        let stdout=host.0.stdout.take().unwrap();let stderr=host.0.stderr.take().unwrap();
        let s=send.clone();readers.push(std::thread::spawn(move||for l in BufReader::new(stdout).lines().map_while(Result::ok){let _=s.send(l);}));
        readers.push(std::thread::spawn(move||for l in BufReader::new(stderr).lines().map_while(Result::ok){let _=send.send(l);}));
        let deadline=Instant::now()+Duration::from_secs(15);let mut lines=Vec::new();
        loop {
            assert!(Instant::now()<deadline,"startup timed out: {lines:?}");
            if let Ok(line)=recv.recv_timeout(Duration::from_millis(100)){lines.push(line);}
            let url=lines.iter().any(|l|l.starts_with("http://"));
            let ready=lines.iter().any(|l|l.starts_with("SNAPBACK4_READY verb=serve "));
            let done=lines.iter().any(|l|l.starts_with(if verbose{"snapback4 serve:"}else{"serve: tokens only;"}));
            if url&&ready&&done{break;}
            assert!(host.0.try_wait().unwrap().is_none(),"serve exited: {lines:?}");
        }
        let out=lines.join("\n");
        assert!(Command::new("kill").args(["-TERM",&host.0.id().to_string()]).status().unwrap().success());
        let deadline=Instant::now()+Duration::from_secs(10);
        while host.0.try_wait().unwrap().is_none(){assert!(Instant::now()<deadline,"shutdown deadline");std::thread::sleep(Duration::from_millis(20));}
        for reader in readers{reader.join().unwrap();}
        out
    }
    let a=App::new();a.ok(&["deploy","staging","--staging"],3);
    let text=startup(&a,false);assert_eq!(text.lines().count(),3,"{text}");
    assert!(text.contains("pid=")&&!text.contains("clock     staging"),"{text}");
    assert!(text.contains("staging store offset"),"{text}");
    assert!(a.detail("serve").contains("active schema")&&a.detail("serve").contains("clock     staging")&&a.detail("serve").contains("file descriptors")&&a.detail("serve").contains("HTTP connections="));
    let full=startup(&a,true);assert!(full.contains("snapback4 serve:")&&full.contains("active schema")&&full.contains("clock     staging"),"{full}");
}

#[test]
fn staging_fixes_qualification_and_residency_explanations_remain_honest() {
    let a=App::new();
    fs::write(a.0.join("snapback/schema.q"),"use identity guests\ntable docs:\n  owner: principal\n  read <- allow\n  insert <- allow\n  online only\ninvariant docs.read only .owner = viewer\nmutation add():\n  return insert docs {owner:viewer}\nquery list():\n  return docs first 10 by .id\n").unwrap();
    let text=a.ok(&["deploy","staging","--staging"],3);
    assert!(text.contains("FIX")&&text.contains("NEVER RECORDED"),"{text}");
    let b=App::new();
    for extra in [false,true] {
        let mut args=vec!["test","--residency","--fixture-only","--json"];
        if extra{args.push("--explain");}
        let out=b.ok(&args,usize::MAX);let value:serde_json::Value=serde_json::from_str(&out).unwrap();
        assert_eq!(value["evidence"][0]["residency"],true);
        assert!(!value["report"].as_str().unwrap().contains("running full finite campaigns"));
        assert_eq!(value["evidence"][0]["cases"]["passed"],0);
    }
}

#[test]
fn complete_case_clauses_and_successful_campaign_warnings_survive_capture() {
    let a=App::new();
    fs::create_dir_all(a.0.join("snapback/generated/security-test.json")).unwrap();
    let record=a.ok(&["test","--fixture-only"],3);
    assert!(record.contains("campaign record unavailable")&&record.contains("check cannot reuse these refutations"),"{record}");
    let b=App::new();let marker="denied value with  two spaces λ ".repeat(16);
    fs::write(b.0.join("snapback/schema.q"),format!("use personas alice\ntable notes:\n  title: text <=2000\n  public 'fixture'\n  online only\nmutation edit(row: notes):\n  require false else CLOSED '{marker}'\n  return true\n")).unwrap();
    fs::create_dir(b.0.join("fixtures")).unwrap();
    fs::write(b.0.join("fixtures/notes.jsonl"),"{\"id\":\"N\",\"title\":\"one\"}\n").unwrap();
    fs::write(b.0.join("fixtures/test.cases.jsonl"),"{\"op\":\"edit\",\"as\":\"alice\",\"args\":{\"row\":\"N\"},\"data\":true}\n").unwrap();
    for json in [false,true] {
        let args=if json{vec!["test","--json"]}else{vec!["test"]};let out=b.run(&args);
        assert!(!out.status.success());
        if json {let v:serde_json::Value=serde_json::from_slice(&out.stdout).unwrap();assert!(v["report"].as_str().unwrap().contains(&marker),"{v}");}
        else {assert!(b.detail("test").contains(&marker));let t=format!("{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));assert!(t.lines().count()<=9&&t.contains(&marker),"{t}");}
    }
    let c=App::new();fs::write(c.0.join("snapback/schema.q"),"use personas alice\ntable docs:\n  owner: principal\n  read <- allow\n  online only\ninvariant docs.read only .owner = viewer\nquery list():\n  return docs first 10 by .id\n").unwrap();
    let t=c.ok(&["test","--fixture-only"],3);
    assert!(t.contains("seed/synthetic observations need authored replay"),"{t}");
}
