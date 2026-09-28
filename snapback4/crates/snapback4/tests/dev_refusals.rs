//! Developer evidence is asynchronous and belongs to one live dev/store pair.
use serde_json::{Value, json};
use std::{fs, io::{BufRead,BufReader,Read,Write}, net::TcpStream, process::{Child,Command,Stdio,Output}, path::PathBuf, sync::{Arc,atomic::{AtomicUsize,Ordering}}, time::{Duration,Instant}};
const BIN: &str=env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str="use personas alice\ntable rows:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation add(owner: principal):\n  return insert rows {owner}\n";
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Project(PathBuf);
impl Drop for Project { fn drop(&mut self) { let _=fs::remove_dir_all(&self.0); } }
impl Project {
 fn new() -> Arc<Self> {
  let dir=std::env::temp_dir().join(format!("sb4-mp-refusal-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed)));
  fs::create_dir_all(dir.join("snapback")).unwrap();
  let mut source=SOURCE.to_owned();
  for n in 0..40 {source.push_str(&format!("mutation add{n}(owner: principal):\n  return insert rows {{owner}}\n"));}
  fs::write(dir.join("snapback/schema.q"),source).unwrap();Arc::new(Self(dir))
 }
 fn why(&self,args:&[&str])->Output {Command::new(BIN).current_dir(&self.0).args(["why","recent"]).args(args).output().unwrap()}
 fn record_path(&self,store:&str)->PathBuf {
  let legacy=self.0.join(".snapback4/dev-refusals.json");
  if legacy.exists() {return legacy;}
  fs::read_dir(self.0.join(".snapback4/dev-refusals").join(store)).unwrap().map(|e|e.unwrap().path()).find(|p|p.extension().and_then(|s|s.to_str())==Some("json")).unwrap()
 }
 fn wait_record(&self,store:&str,operation:&str)->Value {
  let deadline=Instant::now()+Duration::from_secs(10);
  loop {
   let path=self.record_path(store);
   let mut record:Value=serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
   if record.is_array() {record=json!({"records":record,"instance":"legacy"});}
   if record["records"].as_array().unwrap().last().is_some_and(|r|r["operation"]==operation) {return record;}
   assert!(Instant::now()<deadline,"writer did not persist {operation}: {record}");
   std::thread::sleep(Duration::from_millis(10));
  }
 }
}
struct Host { child: Child, project: Arc<Project>, address: String, stderr: PathBuf }
impl Drop for Host {fn drop(&mut self) {let _=self.child.kill();let _=self.child.wait();}}
impl Host {
 fn start(project:Arc<Project>,dev:bool,blocked_stderr:bool)->Self {
  if !dev {let out=Command::new(BIN).current_dir(&project.0).args(["deploy","release"]).output().unwrap();assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));}
  let stderr=project.0.join(format!("stderr-{}.log",NEXT.fetch_add(1,Ordering::Relaxed)));
  let sink=if blocked_stderr {Stdio::piped()} else {Stdio::from(fs::File::create(&stderr).unwrap())};
  let mut child=Command::new(BIN).current_dir(&project.0).args(if dev {vec!["dev","--fresh","--no-watch","--port","0"]} else {vec!["serve","release","--port","0"]}).stdout(Stdio::piped()).stderr(sink).spawn().unwrap();
  let mut line=String::new();BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
  assert!(line.starts_with("http://"),"{line}: {:?}",fs::read_to_string(&stderr));
  Self{child,project,address:line.trim().trim_start_matches("http://").into(),stderr}
 }
 fn request(&self,operation:&str,owner:&str,auth:&str)->Value {
  let body=json!({"args":{"owner":owner}}).to_string();let mut s=TcpStream::connect(&self.address).unwrap();s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
  write!(s,"POST /m/{operation} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{auth}\r\nContent-Length: {}\r\n\r\n{body}",body.len()).unwrap();
  let mut reply=String::new();s.read_to_string(&mut reply).unwrap();serde_json::from_str(reply.split_once("\r\n\r\n").unwrap().1).unwrap()
 }
 fn refuse(&self,operation:&str)->Value {
  let reply=self.request(operation,"bob","x-snapback-persona: alice");assert_eq!(reply["why"]["code"],"E_RULE","{reply}");reply
 }
}
#[test]
fn dev_reports_source_locally_and_production_keeps_the_same_caller_refusal() {
 let dev=Host::start(Project::new(),true,false);
 let reply=dev.refuse("add");
 let store=reply["store_id"].as_str().unwrap();
 let envelope=dev.project.wait_record(store,"add");
 let records=&envelope["records"];
 assert_eq!(records[0]["clause"],"insert rule");
 assert!(records[0]["site"].as_str().unwrap().ends_with("schema.q:5:3"),"{records}");
 assert!(records[0]["executionSite"].as_str().unwrap().starts_with("add:"),"{records}");
 assert!(!records.to_string().contains("bob"));
 #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;assert_eq!(fs::metadata(dev.project.record_path(store)).unwrap().permissions().mode()&0o777,0o600);}
 let why=dev.project.why(&[]);assert!(why.status.success(),"{}",String::from_utf8_lossy(&why.stderr));assert_eq!(serde_json::from_slice::<Value>(&why.stdout).unwrap(),envelope);
 let deadline=Instant::now()+Duration::from_secs(5);
 loop {let stderr=fs::read_to_string(&dev.stderr).unwrap();if stderr.contains("dev refusal: add: rows — insert rule at") {break;}assert!(Instant::now()<deadline,"{stderr}");std::thread::sleep(Duration::from_millis(10));}
 assert!(!reply.to_string().contains("schema.q"));
 let prod=Host::start(Project::new(),false,false);
 let minted=Command::new(BIN).current_dir(&prod.project.0).args(["token","--service","mp-test","--release","release"]).output().unwrap();
 assert!(minted.status.success(),"{}",String::from_utf8_lossy(&minted.stderr));
 let token=String::from_utf8(minted.stdout).unwrap();
 let production=prod.request("add","bob",&format!("Authorization: Bearer {}",token.trim()));
 assert_eq!(serde_json::to_vec(&reply["why"]).unwrap(),serde_json::to_vec(&production["why"]).unwrap(),"{production}");
 assert!(!prod.project.0.join(".snapback4/dev-refusals").exists());
 assert!(!prod.project.0.join("release/dev-refusals").exists());
 assert!(!fs::read_to_string(&prod.stderr).unwrap().contains("dev refusal"));
}
#[test]
fn simultaneous_fresh_instances_are_selected_and_stale_or_mismatched_records_rejected() {
 let project=Project::new();let mut a=Host::start(project.clone(),true,false);let b=Host::start(project.clone(),true,false);
 let refused=a.refuse("add");let store_a=refused["store_id"].as_str().unwrap();
 let record_a=project.wait_record(store_a,"add");let instance_a=record_a["instance"].as_str().unwrap();
 let success=b.request("add","dev:alice","x-snapback-persona: alice");let store_b=success["store_id"].as_str().unwrap();assert_ne!(store_a,store_b);
 let ambiguous=project.why(&[]);assert!(!ambiguous.status.success());assert!(String::from_utf8_lossy(&ambiguous.stderr).contains("Multiple live dev instances"));
 let own=project.why(&["--store",store_b]);assert!(own.status.success());let own:Value=serde_json::from_slice(&own.stdout).unwrap();assert_eq!(own["records"],json!([]));assert_ne!(own["instance"],instance_a);
 let selected=project.why(&["--instance",instance_a]);assert!(selected.status.success());assert_eq!(serde_json::from_slice::<Value>(&selected.stdout).unwrap(),record_a);
 assert!(!project.why(&["--instance",instance_a,"--store",store_b]).status.success());
 fs::write(project.record_path(store_b),record_a.to_string()).unwrap();
 let mismatched=project.why(&["--store",store_b]);assert!(!mismatched.status.success());assert!(String::from_utf8_lossy(&mismatched.stderr).contains("mismatched"));
 a.child.kill().unwrap();a.child.wait().unwrap();
 let stale=project.why(&["--instance",instance_a]);assert!(!stale.status.success());assert!(String::from_utf8_lossy(&stale.stderr).contains("stale"));
}
#[test]
fn writer_evicts_the_oldest_of_more_than_32_records() {
 let dev=Host::start(Project::new(),true,false);
 let mut last=Value::Null;
 for n in 0..40 {let op=format!("add{n}");let reply=dev.refuse(&op);last=dev.project.wait_record(reply["store_id"].as_str().unwrap(),&op);}
 let records=last["records"].as_array().unwrap();assert_eq!(records.len(),32);
 assert_eq!(records[0]["operation"],"add8");assert_eq!(records[31]["operation"],"add39");
}
#[test]
fn blocked_stderr_cannot_block_responses_or_later_mutations() {
 let dev=Host::start(Project::new(),true,true);
 #[cfg(target_os="linux")] {
  use std::os::fd::AsRawFd;
  // Pin capacity: this host can otherwise grant a pipe up to 1 MiB.
  let fd=dev.child.stderr.as_ref().unwrap().as_raw_fd();
  assert_eq!(unsafe {libc::fcntl(fd,libc::F_SETPIPE_SZ,4096)},4096);
 }
 // Keep the pipe unread: this exceeds its capacity even on hosts with 64 KiB
 // pipes. A synchronous logger blocks subsequent requests while holding Engine.
 for _ in 0..4096 {dev.refuse("add");}
 let reply=dev.request("add","dev:alice","x-snapback-persona: alice");assert_eq!(reply["state"],"sent","{reply}");
}
