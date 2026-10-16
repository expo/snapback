//! Execute exact shipped sources as CLI fixtures and over HTTP.
use serde_json::{Value, json};
use snapback4_lang::{compile, guide};
use std::{collections::BTreeMap, fs, io::{BufRead, BufReader, Read, Write}, net::TcpStream,
    path::PathBuf, process::{Child, Command, Stdio}, time::Duration};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
struct Project(PathBuf);
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
impl Project {
    fn new(name: &str, source: &str) -> Self {
        let path = std::env::temp_dir().join(format!("sb4-rules3-{}-{name}", std::process::id()));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(path.join("snapback/schema.q"), source).unwrap(); Self(path)
    }
    fn start(&self) -> Host {
        let mut child = Command::new(BIN).current_dir(&self.0)
            .args(["dev", "--memory", "--no-watch", "--hold-schedules", "--port", "0"])
            .stdout(Stdio::piped()).stderr(Stdio::from(fs::File::create(self.0.join("dev.log")).unwrap())).spawn().unwrap();
        let mut line = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        assert!(line.starts_with("http://"), "{line}: {}", fs::read_to_string(self.0.join("dev.log")).unwrap());
        Host { child, address: line.trim().trim_start_matches("http://").into() }
    }
}
struct Host { child: Child, address: String }
impl Drop for Host { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
impl Host {
    fn post(&self, path: &str, who: &str, body: Value) -> Value {
        let method = if path == "/schema" { "GET" } else { "POST" };
        let device = if path == "/sync" { format!("x-snapback-device: {}\r\n", serde_json::to_string(&snapback4_core::device_protocol::DeviceEngine::current()).unwrap()) } else { String::new() };
        let body = body.to_string(); let mut stream = TcpStream::connect(&self.address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        write!(stream, "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: {who}\r\n{device}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
        serde_json::from_str(answer.split_once("\r\n\r\n").expect(&answer).1).expect(&answer)
    }
}
fn source(marker: &str) -> String {
    guide::quarry(guide::card("rule-recipes").unwrap()).into_iter().find(|b| b.contains(marker)).unwrap()
}
fn expand(value: &mut Value, aliases: &BTreeMap<String, Value>, now: i64) {
    match value {
        Value::String(s) if s.starts_with('$') => {
            let mut path = s[1..].split('.'); let mut found = &aliases[path.next().unwrap()];
            for key in path { found = &found[key]; }
            *value = if !s.contains('.') && found.is_object() { found["id"].clone() } else { found.clone() };
        }
        Value::String(s) if s == "now+1h" => *value = json!(now + 3_600_000),
        Value::Array(items) => for item in items { expand(item, aliases, now); },
        Value::Object(fields) => for item in fields.values_mut() { expand(item, aliases, now); }, _ => {}
    }
}
fn subset(actual: &Value, wanted: &Value) -> bool {
    if let Value::Object(fields) = wanted { return fields.iter().all(|(k,v)| subset(&actual[k],v)); } actual == wanted
}
fn exercise(name: &str, marker: &str) {
    let source = source(marker); let b = compile(&[("schema.q".into(), source.clone())]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{name}: {:?} {:?}", b.diagnostics, b.notes);
    let p = Project::new(name, &format!("{source}\nquery rules3Clock():\n  return now\n"));
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rules3").join(name);
    let out = Command::new(BIN).current_dir(&p.0).args(["test", "--as", "alice", "--fixture"]).arg(&fixtures).output().unwrap();
    assert!(out.status.success(), "{name} fixture:\n{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let host = p.start();
    let now = host.post("/q/rules3Clock", "alice", json!({"args":{}}))["data"].as_i64().unwrap();
    let mut rows = Vec::new();
    for entry in fs::read_dir(&fixtures).unwrap() {
        let path = entry.unwrap().path(); let table = path.file_stem().unwrap().to_str().unwrap();
        if table == "test.cases" { continue; }
        for line in fs::read_to_string(&path).unwrap().lines() {
            let mut row: Value = serde_json::from_str(line).unwrap(); expand(&mut row, &BTreeMap::new(), now);
            rows.push(json!({"table":table,"row":row}));
        }
    }
    let seeded = host.post("/seed", "alice", json!(rows));
    assert_eq!(seeded["seeded"], rows.len(), "{name}: {seeded}");
    let mut aliases = BTreeMap::new();
    for (i,line) in fs::read_to_string(fixtures.join("test.cases.jsonl")).unwrap().lines().enumerate() {
        let mut case: Value = serde_json::from_str(line).unwrap(); expand(&mut case["args"], &aliases, now);
        let op = case["op"].as_str().unwrap(); let who = case["as"].as_str().unwrap();
        let query = b.programs.iter().find(|p| p.program.name == op).unwrap().program.kind == snapback4_core::ir::ProgramKind::Query;
        let reply = host.post(&format!("/{}/{op}", if query { "q" } else { "m" }), who,
            json!({"id":format!("case-{i}"),"args":case["args"]}));
        if let Some(code) = case.get("expect").and_then(Value::as_str) {
            let why = if reply.get("why").is_some() { &reply["why"] } else { &reply["denied"] };
            assert_eq!(why["code"], code, "{name} case {} {op}: {reply}", i+1); continue;
        }
        let data = if query {
            assert_eq!(reply["complete"], true, "{name} case {} {op}: {reply}", i+1); reply["data"].clone()
        } else {
            assert_eq!(reply["state"], "sent", "{name} case {} {op}: {reply}", i+1); reply["result"].clone()
        };
        if let Some(count) = case.get("count") { assert_eq!(data.as_array().unwrap().len(),count.as_u64().unwrap() as usize,"{op}: {reply}"); }
        if let Some(expected) = case.get("data") { assert_eq!(&data, expected,"{op}: {reply}"); }
        if let Some(expected) = case.get("match") { assert!(subset(&data,expected),"{op}: {data} vs {expected}"); }
        if let Some(alias) = case.get("save").and_then(Value::as_str) { aliases.insert(alias.into(), data); }
        if name == "source-publication" && op == "publicClip" && !reply["data"].is_null() {
            assert!(reply["data"].get("privateNote").is_none(),"private production notes leaked: {reply}");
        }
    }
    if name == "offline-roster" {
        let backend: snapback4_device::device::Backend = serde_json::from_value(host.post("/schema", "bob", Value::Null)).unwrap();
        let snapshot = host.post("/sync", "bob", json!({"from":0}));
        let mut memory = snapback4_device::device::Device::open_store(snapback4_device::memory::MemoryStore::new(), Some(backend.clone())).unwrap();
        let mut sqlite = snapback4_device::device::Device::open(&p.0.join("device.sqlite"), Some(backend)).unwrap();
        offline_read(&mut memory,&snapshot,true,true);
        offline_read(&mut sqlite,&snapshot,true,true);
        let removed=host.post("/m/unassignField","bob",json!({"id":"leave-bob","args":{"precinct":"p","who":"dev:bob"}}));
        assert_eq!(removed["state"],"sent","{removed}");
        let stream=host.post("/sync","bob",json!({"from":snapshot["watermark"],"stream":true}));
        offline_read(&mut memory,&stream,false,false);
        offline_read(&mut sqlite,&stream,false,false);
    }
    if name == "owner-now" {
        host.post("/dev/clock/advance","alice",json!({"duration":"1h"}));
        let peer = host.post("/q/peerWords","bob",json!({"args":{"sprint":"s","writer":"dev:alice"}}));
        assert_eq!(peer["data"]["words"],42,"{peer}");
        let total = host.post("/q/finalWords","bob",json!({"args":{"sprint":"s"}})); assert_eq!(total["data"],42,"{total}");
        let late = host.post("/m/reportWords","alice",json!({"id":"late","args":{"sprint":"s","words":99}}));
        assert_eq!(late["why"]["code"],"SPRINT_ENDED","{late}");
    }
    if name == "grant-expiry" {
        host.post("/dev/clock/advance","alice",json!({"duration":"1h"}));
        for who in ["alice","bob"] {
            let grant=host.post("/q/liveGrant",who,json!({"args":{"ledger":"l","accountant":"dev:bob"}})); assert!(grant["data"].is_null(),"{grant}");
        }
        let owner=host.post("/q/ledgerById","alice",json!({"args":{"ledger":"l"}})); assert_eq!(owner["data"]["owner"],"dev:alice","{owner}");
        let peer=host.post("/q/ledgerById","bob",json!({"args":{"ledger":"l"}})); assert!(peer["data"].is_null(),"{peer}");
        let audit=host.post("/q/grantHistory","alice",json!({"args":{}})); assert_eq!(audit["data"].as_array().unwrap().len(),1,"{audit}");
    }
}
#[test] fn offline_roster_fixtures_and_http() { exercise("offline-roster","table supervisors:"); }
#[test] fn quantified_consent_fixtures_and_http() { exercise("quantified-consent","table photoStaff:"); }
#[test] fn mutable_workflow_fixtures_and_http() { exercise("mutable-workflow","table conferences:"); }
#[test] fn source_publication_fixtures_and_http() { exercise("source-publication","table sourceClips:"); }
#[test] fn owner_now_fixtures_and_http() { exercise("owner-now","table ownCounts:"); }
#[test] fn grant_expiry_fixtures_and_http() { exercise("grant-expiry","table ledgerGrants:"); }
#[test] fn role_workflow_fixtures_and_http() { exercise("role-workflow","table workflowStaff:"); }

#[test]
fn refusal_ladder_and_developer_image_evidence_over_http() {
    let p=Project::new("ladder",include_str!("fixtures/rules3/ladder.q"));
    let host=p.start();
    assert_eq!(host.post("/seed","alice",json!([
        {"table":"ladderRows","row":{"id":"p","owner":"dev:alice","state":"pending","body":"original"}},
        {"table":"ladderRows","row":{"id":"w","owner":"dev:alice","state":"withdrawn","body":"closed"}}
    ]))["seeded"],2);
    for (op,who,args,code) in [
        ("ladder","bob",json!({"row":"p"}),"E_INPUT"),
        ("ladder","bob",json!({"row":"p","body":"valid"}),"NOT_FOUND"),
        ("ladder","alice",json!({"row":"p","body":"valid"}),"E_RULE"),
        ("oldImage","alice",json!({"row":"w"}),"E_RULE"),
        ("oldImage","bob",json!({"row":"p"}),"NOT_FOUND"),
        ("firstRequire","bob",json!({"row":"p"}),"EARLY"),
        ("lastRequire","alice",json!({"row":"p"}),"LATE"),
    ] {
        let reply=host.post(&format!("/m/{op}"),who,json!({"id":format!("{op}-{who}-{code}"),"args":args}));
        let why=if reply.get("why").is_some(){&reply["why"]}else{&reply["denied"]};
        assert_eq!(why["code"],code,"{reply}");
        assert!(why.get("phase").is_none() && why.get("clause").is_none(),"{reply}");
        if code=="E_RULE" {
            assert!(why["message"].as_str().unwrap().contains("table authorization layer"),"{reply}");
            let image=if op=="oldImage" {"old image"} else {"next image"};
            let deadline=std::time::Instant::now()+Duration::from_secs(10);
            loop {
                let out=Command::new(BIN).current_dir(&p.0).args(["why","recent"]).output().unwrap();
                if let Ok(record)=serde_json::from_slice::<Value>(&out.stdout) {
                    if let Some(records)=record["records"].as_array() {
                        if records.iter().any(|r|r["operation"]==op && r["phase"].as_str().is_some_and(|p|p.contains(image))) { break; }
                    }
                }
                assert!(std::time::Instant::now()<deadline,"missing {image}: {}",String::from_utf8_lossy(&out.stdout));
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    let r=host.post("/q/ladderRow","alice",json!({"args":{"row":"p"}}));
    assert_eq!(r["data"]["body"],"original","later require must roll back: {r}");
    let hidden=host.post("/q/ladderRow","bob",json!({"args":{"row":"p"}}));
    assert_eq!(hidden["data"],Value::Null,"nullable hidden lookup: {hidden}");
    let empty=host.post("/q/hiddenRows","carol",json!({"args":{"owner":"dev:alice"}}));
    assert_eq!(empty["data"],json!([])); assert_eq!(empty["complete"],true,"{empty}");
}

fn offline_read<S: snapback4_device::store::DeviceStore>(device: &mut snapback4_device::device::Device<S>, page: &Value, first: bool, visible: bool) {
    use snapback4_device::call::call;
    let applied=call(device,json!({"op":"apply","page":page,"first":first}));
    assert!(applied.get("denied").is_none(),"{applied}");
    let read=call(device,json!({"op":"query","name":"fieldList","viewer":"dev:bob","args":{"precinct":"p"},"now":page["now"]}));
    if visible {
        assert_eq!(read["ok"]["complete"],true,"{read}");
        assert_eq!(read["ok"]["data"][0]["name"],"North voter","{read}");
    } else {
        assert!(read["ok"]["data"].as_array().is_none_or(|rows|rows.is_empty()),"revoked offline audience: {read}");
    }
}
