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
        "{SOURCE}\ntable notes:\n  owner: principal\n  picture: image <=10000\n  document: file <=10000 ('text/plain')\n  dueAt: time\n  waivedBy: principal ? default null\n  reason: text <=100 default ''\n  read <- .owner = viewer or exists roles[viewer, role = 'admin']\n  insert <- .owner = viewer\n  update <- .owner = viewer or exists roles[viewer, role = 'admin']\n  online only\nmutation add(picture: image <=10000, document: file <=10000):\n  require exists roles[viewer] else NOT_MEMBER\n  return insert notes {{owner: viewer, picture, document, dueAt: now + 1d}}\nmutation approve(note: notes, reason: text 1..100):\n  require exists roles[viewer, role = 'admin'] else NOT_ADMIN\n  r = notes[note] ! else NOT_FOUND\n  update notes[note] {{waivedBy: viewer, reason}}\nmutation finish(note: notes):\n  r = notes[note] ! else NOT_FOUND\n  clock = now\n  require clock < r.dueAt else DEADLINE\n  return null\n"
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
    assert_eq!(approve["approvals"][0]["by"], "waivedBy");
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

#[test]
fn insert_provisioning_and_business_enums_keep_distinct_meanings() {
    let p = Project::new("insert-roles");
    fs::write(
        p.0.join("snapback/schema.q"),
        SOURCE.replace(
            "return upsert roles[principal] { principal, role }",
            "return insert roles { principal, role }",
        ),
    )
    .unwrap();
    assert!(p.check().status.success());
    let text = fs::read_to_string(p.file("cases.mjs")).unwrap();
    assert!(
        text.contains("\"admin\":2") && text.contains("\"member\":2"),
        "{text}"
    );
    let p = Project::new("business-enum");
    fs::write(p.0.join("snapback/schema.q"),"use identity password\ntable items:\n  principal: principal\n  status: enum('draft','published')\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  online only\nmutation setStatus(principal: principal, status: enum('draft','published')):\n  return upsert items[principal] {principal,status}\n").unwrap();
    assert!(p.check().status.success());
    let facts: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(p.file("schema.json")).unwrap()).unwrap();
    assert_eq!(facts["roles"], serde_json::json!(["users"]));
    assert!(
        fs::read_to_string(p.file("cases.mjs"))
            .unwrap()
            .contains("accountPlan = { users: 2 }")
    );
}
#[cfg(unix)]
#[test]
fn dangling_manifest_symlink_is_not_created_or_followed() {
    use std::os::unix::fs::symlink;
    let p = Project::new("dangling-manifest");
    fs::write(p.0.join("snapback/schema.q"), SOURCE).unwrap();
    fs::create_dir_all(p.file("")).unwrap();
    symlink(p.0.join("must-not-exist"), p.file(".generated-hashes.json")).unwrap();
    assert!(p.check().status.success());
    assert!(!p.0.join("must-not-exist").exists());
}

#[test]
fn custom_argument_mapping_suppresses_undeclared_defaults_and_multiwrite_inference_stops() {
    let p = Project::new("custom-args");
    let source = SOURCE
        .replace(
            "provision(principal: principal, role:",
            "provision(member: principal, level:",
        )
        .replace(
            "roles[principal] { principal, role }",
            "roles[member] { principal: member, role: level }",
        );
    fs::write(p.0.join("snapback/schema.q"), source).unwrap();
    assert!(p.check().status.success());
    let cases = fs::read_to_string(p.file("cases.mjs")).unwrap();
    assert!(
        cases.contains("\"principal\": undefined") && cases.contains("\"role\": undefined"),
        "{cases}"
    );
    assert!(
        cases.contains("\"member\": account.principal")
            && cases.contains("\"level\": account.role")
    );
    let p = Project::new("multiwrite-roles");
    let source=SOURCE.replace("return upsert roles[principal] { principal, role }","upsert roles[principal] { principal, role }\n  update roles[principal] {role:'admin'}\n  return null");
    fs::write(p.0.join("snapback/schema.q"),format!("{source}\nmutation adminOnly():\n  require exists roles[viewer, role = 'admin'] else NOT_ADMIN\n  return null\n")).unwrap();
    assert!(p.check().status.success());
    let cases = fs::read_to_string(p.file("cases.mjs")).unwrap();
    let case = cases
        .split("  { op: \"adminOnly\", role: \"member\"")
        .nth(1)
        .unwrap()
        .split("  { op:")
        .next()
        .unwrap();
    assert!(
        !case.contains("code: \"NOT_ADMIN\""),
        "must not infer the intermediate roster: {case}"
    );
}

#[test]
fn reassignment_does_not_produce_an_intermediate_role_and_marker_names_parse() {
    let p = Project::new("assigned-roles");
    let source=SOURCE.replace("return upsert roles[principal] { principal, role }","assigned = role\n  assigned = 'admin'\n  return upsert roles[principal] { principal, role: assigned }");
    fs::write(p.0.join("snapback/schema.q"),format!("{source}\nmutation adminOnly():\n  require exists roles[viewer, role = 'admin'] else NOT_ADMIN\n  return null\nquery TIME_CASES():\n  return 1\nquery OPERATION_CASES():\n  return 2\nquery ACCOUNT_PLAN():\n  return 3\n")).unwrap();
    fs::write(
        p.0.join("snapback/team.v1.q"),
        "query ping():\n  return 'pong'\n",
    )
    .unwrap();
    let out = p.check();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
    let cases = fs::read_to_string(p.file("cases.mjs")).unwrap();
    let case = cases
        .split("  { op: \"adminOnly\", role: \"member\"")
        .nth(1)
        .unwrap()
        .split("  { op:")
        .next()
        .unwrap();
    assert!(
        !case.contains("code: \"NOT_ADMIN\""),
        "must not infer a stale assigned value: {case}"
    );
    for name in [
        "TIME_CASES",
        "OPERATION_CASES",
        "ACCOUNT_PLAN",
        "team.v1.ping",
    ] {
        assert!(cases.contains(&format!("op: \"{name}\"")), "{name}");
    }
    let out = Command::new("node")
        .arg("--check")
        .arg(p.file("cases.mjs"))
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn ephemeral_mutations_have_signal_expectations() {
    let p = Project::new("signals");
    fs::write(p.0.join("snapback/schema.q"),format!("{SOURCE}\ntable pulses:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  ephemeral 4s\nmutation pulse():\n  upsert pulses[viewer] {{principal:viewer}}\n")).unwrap();
    let out = p.check();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
    let cases = fs::read_to_string(p.file("cases.mjs")).unwrap();
    let case = cases
        .split("  { op: \"pulse\", role: \"member\"")
        .nth(1)
        .unwrap()
        .split("  { op:")
        .next()
        .unwrap();
    assert!(case.contains("ok: true"), "{case}");
}
