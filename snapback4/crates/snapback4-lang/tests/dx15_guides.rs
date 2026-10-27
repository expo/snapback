//! Reproduce guide discovery outputs for original day-two reading intents.
use std::{fs,process::Command,path::PathBuf};
#[test]
fn wave31_007_014_021_030_042_production_proof_is_in_one_default_card() {
    use snapback4_lang::guide::{card,piped};
    let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let scratch=PathBuf::from("/tmp/dx15-replay/reading");
    let before=scratch.join("before");let after=scratch.join("after");
    fs::create_dir_all(&before).unwrap();fs::create_dir_all(&after).unwrap();
    let mut before_bytes=0; let mut after_bytes=0;
    for name in ["production","staging","testing"] {
        let path=format!("snapback4/crates/snapback4-lang/src/guide/{name}.md");
        let out=Command::new("git").args(["show",&format!("a699f02b2c:{path}")]).current_dir(&root).output().unwrap();
        assert!(out.status.success());let mut old=String::from_utf8(out.stdout).unwrap();
        if name=="testing" {
            for file in ["testing_day_two.md","proof_api.md"] {
                let out=Command::new("git").args(["show",&format!("a699f02b2c:snapback4/crates/snapback4-lang/src/guide/{file}")]).current_dir(&root).output().unwrap();assert!(out.status.success());old.push_str(&String::from_utf8(out.stdout).unwrap());
            }
        }
        let new=card(name).unwrap();let preview=piped(name,new);
        fs::write(before.join(format!("{name}.md")),&old).unwrap();
        fs::write(before.join(format!("{name}-default.md")),piped(name,&old)).unwrap();
        fs::write(after.join(format!("{name}.md")),new).unwrap();
        fs::write(after.join(format!("{name}-default.md")),&preview).unwrap();
        if name=="production" {
            for required in ["provisionUsers","startStatic","serveUntilSignal","proof-accounts/default.json","expiresAt","serve-check"] {assert!(preview.contains(required),"default production card lacks {required}");}
            after_bytes=preview.len();
        }
        before_bytes+=old.len();
    }
    let metrics=serde_json::json!({"baseline":"a699f02b2c","intent":"discover complete production serve/roster/static/SIGTERM proof recipe", "before":{"commands":["guide production --full","guide staging --full","guide testing --full"],"toolTurns":3,"bytes":before_bytes},"after":{"commands":["guide production"],"toolTurns":1,"bytes":after_bytes},"claim":"scripted discovery outputs, not model input tokens"});
    fs::write(scratch.join("reading.json"),serde_json::to_string_pretty(&metrics).unwrap()).unwrap();
}
