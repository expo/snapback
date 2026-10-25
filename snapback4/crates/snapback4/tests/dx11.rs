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
fn json(p: &Scratch, args: &[&str]) -> Value {
    let out = run(p, &[&["check", "--json"][..], args].concat());
    serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stderr)))
}
const SOURCE: &str = "table docs:\n  owner:principal\n  body:text <=100\n  read <- allow\n  insert <- allow\n  online only\nmutation add(body:text <=100):\n  return insert docs {owner:viewer,body}\nquery unrelated():\n  return true\n";
#[test]
fn passing_check_hides_advisory_details_but_keeps_enforcement_and_next_command() {
    let p = scratch();
    fs::write(p.0.join("snapback/schema.q"), SOURCE).unwrap();
    let out = run(&p, &["check"]);
    assert!(out.status.success());
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(text.lines().count() <= 5, "{text}");
    assert!(
        text.contains("check --review") && text.contains("enforced by the language"),
        "{text}"
    );
    assert!(
        !text.contains("decision N_") && !text.contains("is this intended?"),
        "{text}"
    );
    let expanded = run(&p, &["check", "--review"]);
    let text = String::from_utf8_lossy(&expanded.stdout);
    assert!(expanded.status.success());
    assert!(
        text.contains("Intended: snapback4 check --ack-security"),
        "{text}"
    );
}
#[test]
fn every_json_id_accepts_atomic_repeated_and_comma_syntax_and_unrelated_edits() {
    let p = scratch();
    let source = p.0.join("snapback/schema.q");
    fs::write(&source, SOURCE).unwrap();
    let first = json(&p, &[]);
    let ids = first["securityReviews"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert!(ids.len() >= 2);
    let out = run(
        &p,
        &[
            "check",
            "--ack-security",
            &ids[0],
            "--ack-security",
            "unknown",
            "--reason",
            "explicit specification rationale",
        ],
    );
    assert_eq!(out.status.code(), Some(2));
    assert!(!p.0.join("snapback/security-reviews.json").exists());
    assert!(String::from_utf8_lossy(&out.stderr).contains("stale"));
    let comma = ids[1..].join(",");
    let out = run(
        &p,
        &[
            "check",
            "--ack-security",
            &ids[0],
            "--ack-security",
            &comma,
            "--reason",
            "explicit specification rationale",
        ],
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    fs::write(&source, SOURCE.replace("return true", "return false")).unwrap();
    let after = json(&p, &[]);
    assert!(
        after["securityReviews"]
            .as_array()
            .unwrap()
            .iter()
            .all(|d| d["acknowledged"] == true),
        "{after}"
    );
}
#[test]
fn wave28_false_premise_decisions_retain_the_concrete_witness() {
    for (source, codes) in [
        (
            include_str!("fixtures/dx11/011.q"),
            vec!["N_APPROVAL_NOT_ENFORCED", "N_ARGUMENT_GRANT"],
        ),
        (
            include_str!("fixtures/dx11/019.q"),
            vec!["N_INSERT_WRITE_INTENT"],
        ),
    ] {
        let p = scratch();
        fs::write(p.0.join("snapback/schema.q"), source).unwrap();
        let report = json(&p, &[]);
        for code in codes {
            let decision = report["securityReviews"]
                .as_array()
                .unwrap()
                .iter()
                .find(|d| {
                    d["code"] == code
                        && d["witness"].is_object()
                        && (code != "N_ARGUMENT_GRANT"
                            || d["witness"]["row"]["homeowner"].is_object())
                })
                .unwrap_or_else(|| panic!("missing witness for {code}"));
            let witness = &decision["witness"];
            if code == "N_APPROVAL_NOT_ENFORCED" {
                assert_eq!(witness["operation"], "recordInstallation");
                assert_eq!(witness["row"]["indoorMount"]["Bool"], true);
                assert_eq!(witness["row"]["indoorApproved"]["Bool"], false);
            }
            if code == "N_INSERT_WRITE_INTENT" {
                assert_eq!(witness["operation"], "setAccount");
                assert_eq!(witness["effect"], "update");
                assert!(witness["args"].get("balance").is_some());
                assert!(
                    witness["old"]["balance"]["Int"].as_i64().unwrap()
                        > witness["row"]["balance"]["Int"].as_i64().unwrap()
                );
            }
            let id = decision["id"].as_str().unwrap();
            let result = json(
                &p,
                &[
                    "--ack-security",
                    id,
                    "--reason",
                    "The specification explicitly permits this witnessed behavior",
                ],
            );
            assert_eq!(
                result["securityReviews"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|d| d["id"] == id)
                    .unwrap()["acknowledged"],
                true
            );
            let recorded: Value = serde_json::from_slice(
                &fs::read(p.0.join("snapback/security-reviews.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(recorded["entries"][id]["witness"], *witness);
        }
        // 019's result-exposure ID used to be listed by JSON and then refused.
        if source.contains("mutation setAccount") {
            let decision = report["securityReviews"]
                .as_array()
                .unwrap()
                .iter()
                .find(|d| d["code"] == "N_COLUMN_RESULT_EXPOSURE")
                .unwrap();
            let id = decision["id"].as_str().unwrap();
            let result = json(
                &p,
                &[
                    "--ack-security",
                    id,
                    "--reason",
                    "The specification admits the listed result/refusal audiences",
                ],
            );
            assert!(
                result["securityReviews"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|d| d["id"] == id && d["acknowledged"] == true)
            );
        }
    }
}
#[test]
fn authored_refutation_cannot_be_acknowledged_and_remains_in_default_output() {
    let p = scratch();
    fs::write(p.0.join("snapback/schema.q"),format!("{SOURCE}\nquery allDocs():\n  return docs first 20 by .id\ninvariant docs.read only .owner = viewer\n")).unwrap();
    let report = json(&p, &[]);
    let id = report["securityReviews"][0]["id"].as_str().unwrap();
    let out = run(
        &p,
        &[
            "check",
            "--ack-security",
            id,
            "--reason",
            "An advisory cannot clear an authored refutation",
        ],
    );
    assert_eq!(out.status.code(), Some(1));
    assert!(!p.0.join("snapback/security-reviews.json").exists());
    assert!(String::from_utf8_lossy(&out.stderr).contains("FIX"));
}
#[test]
fn schema_first_react_projects_get_the_pinned_starter_hint_on_the_verdict() {
    let p = scratch();
    fs::write(p.0.join("snapback/schema.q"), SOURCE).unwrap();
    fs::write(
        p.0.join("package.json"),
        r#"{"dependencies":{"react":"19.2.0"},"devDependencies":{"vite":"6.0.0"}}"#,
    )
    .unwrap();
    let out = run(&p, &["check"]);
    assert!(out.status.success());
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.lines().next().unwrap().contains("React setup:")
            && text.contains("init /tmp/my-starter --web"),
        "{text}"
    );
    assert_eq!(text.lines().count(), 2);
}
