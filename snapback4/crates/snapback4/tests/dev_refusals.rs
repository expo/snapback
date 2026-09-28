//! The developer's local cause and the caller's deliberately ambiguous refusal.
use serde_json::{Value, json};
use std::{fs, io::{BufRead,BufReader,Read,Write}, net::TcpStream, process::{Child,Command,Stdio}, path::PathBuf, time::Duration};
const BIN: &str=env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str="use personas alice\ntable rows:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation add(owner: principal):\n  return insert rows {owner}\n";
struct Host { child: Child, dir: PathBuf, address: String }
impl Drop for Host {fn drop(&mut self) {let _=self.child.kill();let _=self.child.wait();let _=fs::remove_dir_all(&self.dir);}}
impl Host {
 fn start(dev: bool) -> Self {
  let dir=std::env::temp_dir().join(format!("sb4-mp-refusal-{}-{dev}",std::process::id()));
  fs::create_dir_all(dir.join("snapback")).unwrap();fs::write(dir.join("snapback/schema.q"),SOURCE).unwrap();
  if !dev {let out=Command::new(BIN).current_dir(&dir).args(["deploy","release"]).output().unwrap();assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));}
  let stderr=fs::File::create(dir.join("stderr.log")).unwrap();
  let mut child=Command::new(BIN).current_dir(&dir).args(if dev {vec!["dev","--no-watch","--port","0"]} else {vec!["serve","release","--port","0"]}).stdout(Stdio::piped()).stderr(stderr).spawn().unwrap();
  let mut line=String::new();BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
  assert!(line.starts_with("http://"),"{line}: {}",fs::read_to_string(dir.join("stderr.log")).unwrap());
  Self{child,dir,address:line.trim().trim_start_matches("http://").into()}
 }
 fn request(&self,path:&str,body:Value,auth:&str)->(String,Value) {
  let body=body.to_string();let mut s=TcpStream::connect(&self.address).unwrap();s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
  write!(s,"POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{auth}\r\nContent-Length: {}\r\n\r\n{body}",body.len()).unwrap();
  let mut reply=String::new();s.read_to_string(&mut reply).unwrap();let (headers,body)=reply.split_once("\r\n\r\n").unwrap();(headers.into(),serde_json::from_str(body).unwrap())
 }
}
#[test]
fn dev_reports_source_locally_and_production_keeps_the_same_caller_refusal() {
 let dev=Host::start(true);
 let (_,reply)=dev.request("/m/add",json!({"args":{"owner":"bob"}}),"x-snapback-persona: alice");
 assert_eq!(reply["why"]["code"],"E_RULE","{reply}");
 let file=dev.dir.join(".snapback4/dev-refusals.json");
 let records:Value=serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
 assert_eq!(records[0]["clause"],"insert rule");
 assert!(records[0]["site"].as_str().unwrap().ends_with("schema.q:5:3"),"{records}");
 assert!(records[0]["executionSite"].as_str().unwrap().starts_with("add:"),"{records}");
 assert!(!serde_json::to_string(&records).unwrap().contains("bob"));
 #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;assert_eq!(fs::metadata(file).unwrap().permissions().mode()&0o777,0o600);}
 let why=Command::new(BIN).current_dir(&dev.dir).args(["why","recent"]).output().unwrap();assert!(why.status.success());assert_eq!(serde_json::from_slice::<Value>(&why.stdout).unwrap(),records);
 let stderr=fs::read_to_string(dev.dir.join("stderr.log")).unwrap();assert!(stderr.contains("dev refusal: add: rows — insert rule at"),"{stderr}");
 assert!(!reply.to_string().contains("schema.q"));
 let prod=Host::start(false);
 let minted=Command::new(BIN).current_dir(&prod.dir).args(["token","--service","mp-test","--release","release"]).output().unwrap();
 assert!(minted.status.success(),"{}",String::from_utf8_lossy(&minted.stderr));
 let token=String::from_utf8(minted.stdout).unwrap(); let token=token.trim();
 let (_,production)=prod.request("/m/add",json!({"args":{"owner":"bob"}}),&format!("Authorization: Bearer {token}"));
 assert_eq!(serde_json::to_vec(&reply["why"]).unwrap(),serde_json::to_vec(&production["why"]).unwrap(),"{production}");
 assert!(!prod.dir.join(".snapback4/dev-refusals.json").exists());
 assert!(!prod.dir.join("release/dev-refusals.json").exists());
 assert!(!fs::read_to_string(prod.dir.join("stderr.log")).unwrap().contains("dev refusal"));
}
