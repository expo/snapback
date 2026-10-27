//! Wave-33 day-two reading and frozen-client module failures.
use std::{fs,process::Command};
const BIN:&str=env!("CARGO_BIN_EXE_snapback4");
#[test]
fn wave33_029_024_011_023_033_frozen_client_has_own_esm_api_and_inline_users() {
    let dir=std::env::temp_dir().join(format!("dx16-freeze-{}",std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();fs::create_dir_all(dir.join("tools")).unwrap();fs::create_dir_all(dir.join("helpers")).unwrap();
    fs::write(dir.join("snapback/schema.q"),"use identity password\ntable notes:\n  title: text <=80\n  public 'notes'\n  online only\nquery list():\n  return notes first 20 by .id\n").unwrap();
    fs::write(dir.join("package.json"),r#"{"scripts":{"client:calls":"node tools/client-calls.mjs"}}"#).unwrap();
    fs::write(dir.join("tools/client-calls.mjs"),"// Don't edit.\nimport {check} from '../helpers/check.mjs';\ncheck();\nimport {readFileSync,statSync} from 'node:fs';\nimport {api} from '../snapback/generated/api.ts';\nconst users=JSON.parse(readFileSync(process.env.CALLS_USERS));\nif(users.member[0].email!=='inline@example.test'||!api.list)throw Error('missing users or frozen handle');\nconsole.log(process.env.CALLS_USERS);\nconsole.log(statSync(process.env.CALLS_USERS).mode&511);\n").unwrap();
    fs::write(dir.join("helpers/check.mjs"),"export const check=()=>true;\n").unwrap();
    let run=|args:&[&str]|Command::new(BIN).current_dir(&dir).args(args).env("SNAPBACK4_INIT_INSTALL","0").output().unwrap();
    assert!(run(&["check"]).status.success()); // ordinary checked day-one app already has an imported API
    let preview=run(&["init","--adapt","--day2"]);assert!(preview.status.success(),"{}",String::from_utf8_lossy(&preview.stderr));assert!(!dir.join("v1").exists());assert!(!dir.join(".snapback4/guide-seen.json").exists());
    let result=run(&["init","--adapt","--day2","--apply"]);assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));assert!(String::from_utf8_lossy(&result.stdout).starts_with("# Day two:"));
    let package:serde_json::Value=serde_json::from_slice(&fs::read(dir.join("v1/package.json")).unwrap()).unwrap();assert_eq!(package["type"],"module");
    let frozen=fs::read(dir.join("v1/snapback/generated/api.ts")).unwrap();
    fs::write(dir.join("snapback/schema.q"),"table other:\n  title: text <=80\n  public 'other'\n  online only\n").unwrap();
    assert!(run(&["init","--adapt","--day2","--apply"]).status.success());assert_eq!(fs::read(dir.join("v1/snapback/generated/api.ts")).unwrap(),frozen);
    let child=Command::new("npm").args(["--prefix","v1","run","--silent","client:calls"]).current_dir(&dir).env("CALLS_USERS",r#"{"member":[{"email":"inline@example.test"}]}"#).output().unwrap();
    assert!(child.status.success(),"{}{}",String::from_utf8_lossy(&child.stdout),String::from_utf8_lossy(&child.stderr));let output=String::from_utf8(child.stdout).unwrap();let path=output.lines().next().unwrap();assert!(!std::path::Path::new(path).exists(),"private normalized users cleaned");assert!(output.lines().any(|l|l=="384"),"mode 0600");
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn wave33_001_022_011_021_full_lists_sections_and_repeats_delta() {
    let dir=std::env::temp_dir().join(format!("dx16-guide-{}",std::process::id()));fs::create_dir_all(dir.join("snapback")).unwrap();
    let run=|args:&[&str]|String::from_utf8(Command::new(BIN).current_dir(&dir).args(args).output().unwrap().stdout).unwrap();
    for name in ["deploy","production","evolution"] {let text=run(&["guide",name,"--full"]);assert!(text.len()<=8000);assert!(!text.contains("// day-two-production.mjs"));}
    let first=run(&["guide","deploy","--section","Keep v1 clients working"]);assert!(first.contains("baseline"));let again=run(&["guide","deploy","--section","Keep v1 clients working"]);assert!(again.contains("new: 0 blocks"));assert!(again.len()<first.len());
    assert_eq!(first,run(&["guide","deploy","--section","Keep v1 clients working","--repeat"]));
    let failed=Command::new(BIN).current_dir(&dir).args(["guide","deploy","--find","release NO_SUCH_WORD"]).output().unwrap();
    assert!(!failed.status.success());assert!(failed.stdout.len()<=8001);
    let opening=run(&["guide","deploy","--section","opening","--repeat"]);assert!(opening.contains("one durable store"));
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn wave33_muse_021_all_merges_retired_cells_and_narrowed_rows_across_retained_releases() {
    let dir=std::env::temp_dir().join(format!("dx16-retained-{}",std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let one="table notes:\n  title: text <=80\n  color: text <=20 ?\n  public 'notes'\n  online only\n";
    let two=one.replace("  color: text <=20 ?\n", "").replace("text <=80","text <=4");
    fs::write(dir.join("snapback/schema.q"),one).unwrap();
    let run=|args:&[&str]|{let result=Command::new(BIN).current_dir(&dir).args(args).output().unwrap();assert!(result.status.success(),"{}{}",String::from_utf8_lossy(&result.stdout),String::from_utf8_lossy(&result.stderr));result};
    run(&["deploy","production"]);
    let bound=snapback4_lang::compile(&[("schema.q".into(),one.into())]);
    let definition=bound.schema.table("notes").unwrap();
    let rows:Vec<_>=[serde_json::json!({"id":"fits","title":"tiny","color":"blue"}),serde_json::json!({"id":"wide","title":"historical wide value","color":"red"})].into_iter().map(|row|("notes".to_owned(),snapback4_core::wire::row_from_json(definition,&row).unwrap())).collect();
    let mut engine=snapback4_core::Engine::open(snapback4_core::Store::open(&dir.join("production/store.sqlite")).unwrap()).unwrap();engine.seed(rows).unwrap();drop(engine);
    fs::write(dir.join("snapback/schema.q"),&two).unwrap();run(&["deploy","production"]);
    let inspect=|| {let out=run(&["data","notes","--all","--release","production","--json"]);serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap()};
    let all=inspect();let rows=all["rows"].as_array().unwrap();assert_eq!(rows.len(),2);assert_eq!(rows[0]["title"],"tiny");assert_eq!(rows[0]["color"],"blue");assert_eq!(rows[1]["title"],"historical wide value");assert_eq!(rows[1]["color"],"red");
    run(&["rollback","production","--to","1"]);assert_eq!(inspect()["rows"],all["rows"]);
    run(&["rollback","production","--to","latest"]);assert_eq!(inspect()["rows"],all["rows"]);
    // A later incompatible scalar kind must not turn retained text into null.
    fs::write(dir.join("snapback/schema.q"),two.replace("title: text <=4","title: int")).unwrap();
    run(&["deploy","production"]);assert_eq!(inspect()["rows"],all["rows"]);

    fs::remove_dir_all(dir).unwrap();
}
