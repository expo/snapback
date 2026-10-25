//! Wave-28 decision commands, concise success and witness records.
use serde_json::Value;
use std::{fs, path::PathBuf, process::Command};
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn scratch() -> Scratch {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let root = std::env::temp_dir().join(format!(
        "sb4-dx11-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    fs::create_dir_all(root.join("snapback")).unwrap();
    Scratch(root)
}
fn run(p: &Scratch, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_snapback4"))
        .current_dir(&p.0)
        .args(args)
        .output()
        .unwrap()
}
#[test]
fn column_grant_is_named_only_in_developer_evidence() {
    let p = scratch();
    fs::write(p.0.join("snapback/schema.q"),"use personas alice, bob\ntable docs:\n  owner:principal\n  body:text <=100 write <- .owner = viewer\n  read <- allow\n  insert <- allow\n  online only\nmutation add(owner:principal,body:text <=100):\n  return insert docs {owner,body}\n").unwrap();
    let out = run(
        &p,
        &[
            "run",
            "add",
            "{\"owner\":\"dev:alice\",\"body\":\"hello\"}",
            "--as",
            "bob",
            "--json",
        ],
    );
    assert!(!out.status.success());
    let public = String::from_utf8_lossy(&out.stdout);
    let private = String::from_utf8_lossy(&out.stderr);
    assert!(public.contains("E_RULE"), "{public} {private}");
    assert!(
        !public.contains("column write grant") && !public.contains("write <-"),
        "{public}"
    );
    assert!(
        private.contains("column write grant body") && private.contains("body:text <=100 write <-"),
        "{private}"
    );
}
#[test]
fn hidden_query_rows_are_explained_only_to_the_local_developer() {
    let p = scratch();
    fs::write(p.0.join("snapback/schema.q"),"use personas alice, bob\ntable docs:\n  owner:principal\n  body:text <=100\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation add():\n  return insert docs {owner:viewer,body:'hello'}\nquery list():\n  return docs first 20 by .id\n").unwrap();
    assert!(
        run(&p, &["run", "add", "--as", "alice", "--json"])
            .status
            .success()
    );
    let out = run(&p, &["run", "list", "--as", "bob", "--json"]);
    assert!(out.status.success());
    let public: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(public["data"], serde_json::json!([]));
    assert!(public.get("hiddenRows").is_none());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("hidden"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
