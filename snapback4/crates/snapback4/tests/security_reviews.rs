//! Public check gates are individual dispositions, independent of proof verdicts.
use std::{fs,path::PathBuf,process::Command};
use serde_json::Value;
struct Scratch(PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn scratch()->Scratch{let p=std::env::temp_dir().join(format!("sb4-sec7-cli-{}-{}",std::process::id(),{static NEXT:std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)}));fs::create_dir_all(p.join("snapback")).unwrap();Scratch(p)}
const SOURCE:&str="table docs:\n  photo: image <=10000 ?\n  other: image <=10000 ?\n  read <- allow\n  insert <- deny\n  online only\ninvariant docs always .photo != null and .other != null\nmutation add(photo: image <=10000 ?, other: image <=10000 ?):\n  return insert docs {photo,other}\n";
fn check(p:&Scratch,args:&[&str])->(i32,Value){let r=Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check","--json"]).args(args).current_dir(&p.0).output().unwrap();let j=serde_json::from_slice(&r.stdout).unwrap_or_else(|_|panic!("{}",String::from_utf8_lossy(&r.stdout)));(r.status.code().unwrap_or(-1),j)}
#[test]fn unreachable_media_questions_are_advice_with_individual_atomic_decisions(){
 let p=scratch();let source=p.0.join("snapback/schema.q");fs::write(&source,SOURCE).unwrap();
 let (code,j)=check(&p,&[]);assert_eq!(code,0,"{j}");assert_eq!(j["security"]["invariants"].as_array().unwrap().len(),1);
 assert!(!j["securityReviews"].as_array().unwrap().iter().any(|d|d["gated"]==true));
 let ids=j["securityReviews"].as_array().unwrap().iter().filter(|d|d["code"]=="N_OPTIONAL_UPLOAD_CREATE").map(|d|d["id"].as_str().unwrap().to_owned()).collect::<Vec<_>>();assert_eq!(ids.len(),2);assert_ne!(ids[0],ids[1]);
 assert_eq!(check(&p,&["--ack-notes"]).0,0);assert!(!p.0.join("snapback/security-reviews.json").exists());
 let bad=format!("{},unknown",ids[0]);assert_eq!(check(&p,&["--ack-security",&bad,"--reason","the unreachable helper remains advisory"]).0,2);assert!(!p.0.join("snapback/security-reviews.json").exists());
 std::thread::scope(|scope|{let a=scope.spawn(||check(&p,&["--ack-security",&ids[0],"--reason","first unreachable draft helper"]));let b=scope.spawn(||check(&p,&["--ack-security",&ids[1],"--reason","second unreachable draft helper"]));assert_eq!(a.join().unwrap().0,0);assert_eq!(b.join().unwrap().0,0);});
 let (_,after)=check(&p,&[]);for id in &ids{assert!(after["securityReviews"].as_array().unwrap().iter().any(|d|d["id"]==*id&&d["acknowledged"]==true));}
 let path=p.0.join("snapback/security-reviews.json");let bytes=fs::read(&path).unwrap();
 fs::write(&source,format!("{SOURCE}\n-- only a comment\n")).unwrap();let (_,after)=check(&p,&[]);for id in &ids{assert!(after["securityReviews"].as_array().unwrap().iter().any(|d|d["id"]==*id&&d["acknowledged"]==true));}
 fs::write(&source,"not valid Quarry\n").unwrap();assert_eq!(check(&p,&["--ack-security",&ids[0],"--reason","cannot override compile error"]).0,1);assert_eq!(fs::read(path).unwrap(),bytes);
}

#[test]fn social_optional_attachments_need_no_review_even_after_edits(){
 let p=scratch();let result=Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["init","--template","social"]).current_dir(&p.0).output().unwrap();assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));
 let (code,j)=check(&p,&[]);assert_eq!(code,0,"{j}");assert!(!j["securityReviews"].as_array().unwrap().iter().any(|d|d["code"]=="N_OPTIONAL_UPLOAD_CREATE"&&d["gated"]==true));assert!(!p.0.join("snapback/security-reviews.json").exists());
 let schema=p.0.join("snapback/schema.q");let text=fs::read_to_string(&schema).unwrap();fs::write(schema,format!("{text}\n-- app-specific edit\n")).unwrap();assert_eq!(check(&p,&[]).0,0);
}
#[test]fn wave23_lockout_and_loosened_uploads_check_without_acknowledgment(){
 let p=scratch();fs::write(p.0.join("snapback/schema.q"),include_str!("../../snapback4-lang/tests/security/wave23/003.q")).unwrap();let (code,j)=check(&p,&[]);assert_eq!(code,0,"{j}");assert!(!j["securityReviews"].as_array().unwrap().iter().any(|d|d["code"]=="N_OPTIONAL_UPLOAD_CREATE"));
}

#[test]fn repeated_unreachable_media_sites_remain_individual_advice(){
 let p=scratch();let source="table first:\n  photo:image <=10000 ?\n  read <- allow\n  insert <- deny\n  online only\ntable second:\n  photo:image <=10000 ?\n  read <- allow\n  insert <- deny\n  online only\ninvariant first always .photo != null\ninvariant second always .photo != null\nmutation add(photo:image <=10000 ?):\n  insert first {photo}\n  insert second {photo}\n  return null\n";fs::write(p.0.join("snapback/schema.q"),source).unwrap();
 let (code,j)=check(&p,&[]);assert_eq!(code,0,"{j}");let ds=j["securityReviews"].as_array().unwrap();assert!(!ds.iter().any(|d|d["gated"]==true));let ids=ds.iter().filter(|d|d["code"]=="N_OPTIONAL_UPLOAD_CREATE").map(|d|d["id"].as_str().unwrap()).collect::<Vec<_>>();assert_eq!(ids.len(),2);assert_ne!(ids[0],ids[1]);
}

#[cfg(unix)]
#[test]fn phase_trace_refuses_nonregular_sinks_and_keeps_the_verdict(){
    use std::{process::Stdio,time::{Duration,Instant}};
    let p=scratch();fs::write(p.0.join("snapback/schema.q"),"table docs:\n  owner: principal\n  read <- .owner = viewer\n  online only\n").unwrap();
    let (_,baseline)=check(&p,&[]);
    let fifo=p.0.join("trace.fifo");assert!(Command::new("mkfifo").arg(&fifo).status().unwrap().success());
    let target=p.0.join("unchanged");fs::write(&target,b"unchanged").unwrap();let link=p.0.join("trace.link");std::os::unix::fs::symlink(&target,&link).unwrap();
    let regular=p.0.join("trace.jsonl");
    for sink in [&fifo,&link,&regular]{
        let mut child=Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check","--json"]).env("SNAPBACK4_LATENCY_TRACE",sink).current_dir(&p.0).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        // The spawned child is the only process this guard may stop.
        let deadline=Instant::now()+Duration::from_secs(120);
        loop{if child.try_wait().unwrap().is_some(){break;}if Instant::now()>=deadline{let _=child.kill();let _=child.wait();panic!("trace sink blocked command completion");}std::thread::sleep(Duration::from_millis(10));}
        let output=child.wait_with_output().unwrap();assert!(output.status.success());let value:Value=serde_json::from_slice(&output.stdout).unwrap();
        for key in ["ok","security","securityReviews"]{assert_eq!(value[key],baseline[key],"trace changed {key}");}
    }
    assert_eq!(fs::read(&target).unwrap(),b"unchanged");
    let events=fs::read_to_string(regular).unwrap().lines().map(|line|serde_json::from_str::<Value>(line).unwrap()).collect::<Vec<_>>();assert!(events.iter().any(|v|v["phase"]=="check.bind"));
}

#[test]fn declared_design_scan_edit_intent_allows_production_without_a_false_freeze_refusal(){
 let p=scratch();fs::write(p.0.join("snapback/schema.q"),include_str!("../../snapback4-lang/tests/security/sec13/w33-036.q")).unwrap();
 let result=Command::new(env!("CARGO_BIN_EXE_snapback4")).arg("deploy").arg(p.0.join("deployment")).arg("--json").current_dir(&p.0).output().unwrap();
 assert!(result.status.success(),"production refused declared edit intent: stdout={} stderr={}",String::from_utf8_lossy(&result.stdout),String::from_utf8_lossy(&result.stderr));
 let value:Value=serde_json::from_slice(&result.stdout).unwrap();assert_eq!(value["release"],1);
}

#[test]fn explicit_scan_intent_keeps_its_authored_refutation_blocking(){
 let p=scratch();let source=include_str!("../../snapback4-lang/tests/security/sec13/w33-036.q");let guarded="mutation setDesignScan(order: orders, designScan: image <=10000000):\n  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR\n";
 assert!(source.contains(guarded));let source=source.replace(guarded,"mutation setDesignScan(order: orders, designScan: image <=10000000):\n");fs::write(p.0.join("snapback/schema.q"),source).unwrap();
 let result=Command::new(env!("CARGO_BIN_EXE_snapback4")).arg("deploy").arg(p.0.join("deployment")).arg("--json").current_dir(&p.0).output().unwrap();assert_eq!(result.status.code(),Some(1));let value:Value=serde_json::from_slice(&result.stdout).unwrap();let security=if let Some(s)=value["security"].as_str(){serde_json::from_str::<Value>(s).unwrap()}else{value["security"].clone()};
 assert!(security["report"]["invariants"].as_array().unwrap().iter().any(|v|v["invariant"]["site"]["file"]=="schema.q"&&v["invariant"]["column"]=="designScan"&&v["invariant"]["target"]=="update"&&!v["counterexample"].is_null()),"authored update intent lost its current refutation: {value}");
}
