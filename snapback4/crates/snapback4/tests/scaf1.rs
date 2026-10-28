//! Executable generated recipes and custody, rather than template string snapshots.
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
};
struct Project(PathBuf);
impl Project {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("scaf1-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("snapback")).unwrap();
        Self(dir)
    }
    fn check(&self) -> Output {
        Command::new(env!("CARGO_BIN_EXE_snapback4"))
            .arg("check")
            .arg("--json")
            .current_dir(&self.0)
            .output()
            .unwrap()
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join("scripts/proof-scaffold").join(name)
    }
}
impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
const SOURCE: &str = "use identity password\ntable roles:\n  principal: principal\n  role: enum('admin', 'member')\n  unique principal\n  read <- .principal = viewer or viewer = 'service:operator'\n  insert <- viewer = 'service:operator'\n  update <- viewer = 'service:operator'\n  online only\nmutation provision(principal: principal, role: enum('admin', 'member')):\n  require viewer = 'service:operator' else NOT_OPERATOR\n  return upsert roles[principal] { principal, role }\nquery hello():\n  return 'hello'\n";
#[test]
fn green_check_generates_parsable_packet_and_preserves_edits_during_schema_growth() {
    let p = Project::new("custody");
    fs::write(p.0.join("snapback/schema.q"), SOURCE).unwrap();
    let out = p.check();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap()["ok"] == true);
    assert_eq!(
        String::from_utf8_lossy(&out.stderr)
            .lines()
            .filter(|l| l.starts_with("proof scaffold:"))
            .count(),
        1
    );
    for name in [
        "cases.mjs",
        "host.mjs",
        "acceptance.mjs",
        "frontend-proof.mjs",
        "probe-serve.mjs",
    ] {
        let out = Command::new("node")
            .arg("--check")
            .arg(p.file(name))
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let cases = fs::read_to_string(p.file("cases.mjs")).unwrap();
    assert!(cases.contains("NOT_OPERATOR"));
    assert!(cases.contains("\"admin\":2"));
    fs::write(p.file("cases.mjs"), format!("{cases}\n// BUILDER EDIT\n")).unwrap();
    fs::write(
        p.0.join("snapback/schema.q"),
        format!("{SOURCE}\nquery extra():\n  return 2\n"),
    )
    .unwrap();
    let out = p.check();
    assert!(out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("1 edited files kept"));
    assert!(
        fs::read_to_string(p.file("cases.mjs"))
            .unwrap()
            .ends_with("// BUILDER EDIT\n")
    );
    assert!(
        fs::read_to_string(p.file("schema.json"))
            .unwrap()
            .contains("extra")
    );
    fs::remove_file(p.file("cases.mjs")).unwrap();
    assert!(p.check().status.success());
    assert!(
        fs::read_to_string(p.file("cases.mjs"))
            .unwrap()
            .contains("extra")
    );
}
#[test]
fn red_check_and_collisions_never_take_file_custody() {
    let p = Project::new("red");
    fs::write(
        p.0.join("snapback/schema.q"),
        "query broken():\n  return unknown\n",
    )
    .unwrap();
    assert!(!p.check().status.success());
    assert!(!p.file("cases.mjs").exists());
    fs::write(p.0.join("snapback/schema.q"), SOURCE).unwrap();
    fs::create_dir_all(p.file("")).unwrap();
    fs::write(p.file("cases.mjs"), "// existing app file").unwrap();
    assert!(p.check().status.success());
    assert_eq!(
        fs::read_to_string(p.file("cases.mjs")).unwrap(),
        "// existing app file"
    );
}
#[cfg(unix)]
#[test]
fn symlinks_are_never_followed() {
    use std::os::unix::fs::symlink;
    let p = Project::new("links");
    fs::write(p.0.join("snapback/schema.q"), SOURCE).unwrap();
    fs::write(p.0.join("outside"), "leave alone").unwrap();
    fs::create_dir_all(p.file("")).unwrap();
    symlink(p.0.join("outside"), p.file("cases.mjs")).unwrap();
    symlink(p.0.join("outside"), p.file(".generated-hashes.json")).unwrap();
    assert!(p.check().status.success());
    assert_eq!(
        fs::read_to_string(p.0.join("outside")).unwrap(),
        "leave alone"
    );
}

#[test]
fn role_guards_refusals_uploads_clock_and_approval_are_bound_to_the_schema() {
    let p = Project::new("facts");
    let source = format!(
        "{SOURCE}\ntable notes:\n  owner: principal\n  picture: image <=10000\n  document: file <=10000 ('text/plain')\n  dueAt: time\n  approvedBy: principal ? default null\n  reason: text <=100 default ''\n  read <- .owner = viewer or exists roles[viewer, role = 'admin']\n  insert <- .owner = viewer\n  update <- .owner = viewer or exists roles[viewer, role = 'admin']\n  online only\nmutation add(picture: image <=10000, document: file <=10000):\n  require exists roles[viewer] else NOT_MEMBER\n  return insert notes {{owner: viewer, picture, document, dueAt: now + 1d}}\nmutation approve(note: notes, reason: text 1..100):\n  require exists roles[viewer, role = 'admin'] else NOT_ADMIN\n  r = notes[note] ! else NOT_FOUND\n  update notes[note] {{approvedBy: viewer, reason}}\nmutation finish(note: notes):\n  r = notes[note] ! else NOT_FOUND\n  require now < r.dueAt else DEADLINE\n  return null\n"
    );
    fs::write(p.0.join("snapback/schema.q"), source).unwrap();
    let out = p.check();
    assert!(
        out.status.success(),
        "{} {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let facts: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(p.file("schema.json")).unwrap()).unwrap();
    let operations = facts["operations"].as_array().unwrap();
    let approve = operations.iter().find(|o| o["name"] == "approve").unwrap();
    assert_eq!(approve["approvals"][0]["by"], "approvedBy");
    assert_eq!(approve["approvals"][0]["why"], "reason");
    let finish = operations.iter().find(|o| o["name"] == "finish").unwrap();
    assert!(
        finish["guards"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g["code"] == "DEADLINE" && g["clock"] == true)
    );
    assert_eq!(facts["uploads"].as_array().unwrap().len(), 2);
    let cases = fs::read_to_string(p.file("cases.mjs")).unwrap();
    let lookup = "  { op: \"approve\", role: \"member\"";
    let case = cases
        .split(lookup)
        .nth(1)
        .unwrap()
        .split("  { op:")
        .next()
        .unwrap();
    assert!(case.contains("code: \"NOT_ADMIN\""), "{case}");
    let case = cases
        .split("  { op: \"add\", role: \"users\"")
        .nth(1)
        .unwrap()
        .split("  { op:")
        .next()
        .unwrap();
    assert!(case.contains("code: \"NOT_MEMBER\""), "{case}");
}
