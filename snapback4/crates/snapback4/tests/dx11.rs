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
                            || d["witness"]["row"]["homeowner"].is_string())
                })
                .unwrap_or_else(|| panic!("missing witness for {code}"));
            let witness = &decision["witness"];
            if code == "N_APPROVAL_NOT_ENFORCED" {
                assert_eq!(witness["operation"], "recordInstallation");
                assert_eq!(witness["row"]["indoorMount"], true);
                assert_eq!(witness["row"]["indoorApproved"], false);
            }
            if code == "N_INSERT_WRITE_INTENT" {
                assert_eq!(witness["operation"], "setAccount");
                assert_eq!(witness["effect"], "update");
                assert!(witness["args"].get("balance").is_some());
                assert!(
                    witness["old"]["balance"].as_i64().unwrap()
                        > witness["row"]["balance"].as_i64().unwrap()
                );
            }
            let id = decision["id"].as_str().unwrap();
            let refused=json(&p,&["--ack-security",id,"--reason","one decision"]);
            assert_eq!(refused["ok"],false,"a witnessed question cannot accept filler");
            assert_eq!(refused["problems"][0]["code"],"E_SECURITY_NOTES");
            let answer=if matches!(witness["effect"].as_str(),Some("insert"|"upsert")){"audience: the listed caller is intentionally admitted"}else{"intended effect: the listed effect is deliberate"};
            let reason=format!("witness {}; permit {} as {}; {}; operation {} is intended by this test specification",witness["id"].as_str().unwrap(),witness["operation"].as_str().unwrap(),witness["viewer"].as_str().unwrap(),answer,witness["operation"].as_str().unwrap());
            let result=json(&p,&["--ack-security",id,"--reason",&reason]);
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
            let current=result["securityReviews"].as_array().unwrap().iter().find(|d|d["id"]==id).unwrap();
            assert_eq!(recorded["entries"][id]["witness"],current["witness"],"persist the exact witness replayed by the acknowledgment command");
            assert_eq!(current["witness"]["id"],witness["id"],"fresh minted row ids preserve the canonical witness");
            assert_eq!(current["witness"]["operation"],witness["operation"]);
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

#[test]
fn wave29_image_arguments_obtain_a_creation_witness_without_a_blind_gate() {
    let p=scratch();let source=include_str!("../../snapback4-lang/tests/security/sec10-shipping/w29-016.q");fs::write(p.0.join("snapback/schema.q"),source).unwrap();
    let report=json(&p,&[]);let ds=report["securityReviews"].as_array().unwrap();
    let d=ds.iter().find(|d|d["code"]=="N_INSERT_WRITE_INTENT"&&d["witness"]["operation"]=="logTractor"&&d["witness"]["effect"]=="insert").expect("three typed image arguments must reach the actual inline album creation");
    assert_eq!(d["gated"],false,"the low-precision initial/edit code is advisory");
    assert!(d["witness"]["history"].as_array().is_some_and(|h|!h.is_empty()));
    let out=json(&p,&["--ack-security",d["id"].as_str().unwrap(),"--reason","one decision"]);assert_eq!(out["problems"][0]["code"],"E_SECURITY_NOTES");
    let reason=format!("witness {}; permit logTractor as {}; audience: logTractor deliberately allows barn owners and intake managers for initial albums",d["witness"]["id"].as_str().unwrap(),d["witness"]["viewer"].as_str().unwrap());
    let out=json(&p,&["--ack-security",d["id"].as_str().unwrap(),"--reason",&reason]);assert!(out["securityReviews"].as_array().unwrap().iter().any(|n|n["id"]==d["id"]&&n["acknowledged"]==true));
}
#[test]
fn wave30_approval_witness_names_the_actual_workflow_effect() {
    let p=scratch();fs::write(p.0.join("snapback/schema.q"),include_str!("../../snapback4-lang/tests/security/sec10-shipping/w30-033.q")).unwrap();
    let report=json(&p,&[]);let d=report["securityReviews"].as_array().unwrap().iter().find(|d|d["code"]=="N_APPROVAL_NOT_ENFORCED").unwrap();
    assert_eq!(d["witness"]["operation"],"advanceJob","the quote acceptance is not the coating effect: {d}");assert_eq!(d["gated"],true);
    let out=run(&p,&["check"]);let text=String::from_utf8(out.stdout).unwrap();assert!(text.contains("via advanceJob"),"{text}");assert!(!text.contains("modeled acceptQuote effect"),"{text}");
}

#[test]
fn a_deploys_derived_decision_is_accepted_by_its_real_cli_command() {
 let p=scratch();let source="table docs:\n  value: int\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(value: int):\n  return insert docs {value}\nmutation approve(doc: docs):\n  require viewer = 'service:reviewer' else NOT_REVIEWER\n  d = docs[doc] ! else MISSING\n  require d.value >= 0 else NEGATIVE\n  update docs[doc] {approved:true}\nmutation edit(doc: docs,value: int):\n  update docs[doc] {value}\n";fs::write(p.0.join("snapback/schema.q"),source).unwrap();
 let refused=run(&p,&["deploy","deployment","--json"]);assert_eq!(refused.status.code(),Some(1));let refused:Value=serde_json::from_slice(&refused.stdout).unwrap();
 let decision=refused["security"]["securityReviews"].as_array().unwrap().iter().find(|d|d["code"]=="N_DERIVED_WRITE_AUTHORITY"&&d["witness"].is_object()).expect("production reports its actual derived witness");
 let ordinary=run(&p,&["deploy","deployment"]);assert_eq!(ordinary.status.code(),Some(1));
 let printed=format!("{}\n{}",String::from_utf8_lossy(&ordinary.stdout),String::from_utf8_lossy(&ordinary.stderr));
 let command=printed.lines().filter_map(|line|line.trim().strip_prefix("Intended: snapback4 check --ack-security ")).find(|command|command.starts_with(&format!("{} --reason",decision["id"].as_str().unwrap()))).expect("ordinary deploy must print the blocking derived decision command");
 let (printed_id,template)=command.split_once(" --reason '").unwrap();assert_eq!(printed_id,decision["id"].as_str().unwrap());
 assert!(template.contains(&format!("witness {}; permit {} as {}",decision["witness"]["id"].as_str().unwrap(),decision["witness"]["operation"].as_str().unwrap(),decision["witness"]["viewer"].as_str().unwrap())),"{printed}");
 let checked=json(&p,&[]);assert!(checked["securityReviews"].as_array().unwrap().iter().any(|d|d["id"]==decision["id"]),"deploy decision must exist in the prescribed check command");
 let witness=&decision["witness"];let reason=format!("witness {}; permit {} as {}; intended effect: this test specification deliberately allows edits without invalidating the validation flag",witness["id"].as_str().unwrap(),witness["operation"].as_str().unwrap(),witness["viewer"].as_str().unwrap());
 let ack=run(&p,&["check","--ack-security",printed_id,"--reason",&reason]);assert!(ack.status.success(),"{}",String::from_utf8_lossy(&ack.stderr));
 let deployed=run(&p,&["deploy","deployment","--json"]);assert!(deployed.status.success(),"{} {}",String::from_utf8_lossy(&deployed.stdout),String::from_utf8_lossy(&deployed.stderr));
}
#[test]
fn fresh_gate_replays_preserve_ids_and_changed_witnesses_show_no_old_rationale() {
 let p=scratch();let source=include_str!("../../snapback4-lang/tests/security/sec10-shipping/w30-033.q");fs::write(p.0.join("snapback/schema.q"),source).unwrap();
 let first=json(&p,&[]);let decision=first["securityReviews"].as_array().unwrap().iter().find(|d|d["code"]=="N_APPROVAL_NOT_ENFORCED"&&d["witness"].is_object()).unwrap();
 let again=json(&p,&[]);assert!(again["securityReviews"].as_array().unwrap().iter().any(|d|d["id"]==decision["id"]),"fresh random fixture ids must not change the witness identity");
 let reason=format!("witness {}; permit advanceJob as {}; intended effect: advanceJob is deliberately independent under this explicit test specification",decision["witness"]["id"].as_str().unwrap(),decision["witness"]["viewer"].as_str().unwrap());
 let recorded=json(&p,&["--ack-security",decision["id"].as_str().unwrap(),"--reason",&reason]);assert!(recorded["securityReviews"].as_array().unwrap().iter().any(|d|d["id"]==decision["id"]&&d["acknowledged"]==true));
 fs::write(p.0.join("snapback/schema.q"),format!("-- independent comment\n{source}")).unwrap();let unchanged=json(&p,&[]);assert!(unchanged["securityReviews"].as_array().unwrap().iter().any(|d|d["id"]==decision["id"]&&d["acknowledged"]==true));
 let independent=format!("{source}\ntable independentNotes:\n  label: text <= 20\n  read <- allow\n  insert <- allow\n  online only\n");
 fs::write(p.0.join("snapback/schema.q"),&independent).unwrap();let unrelated=json(&p,&[]);assert!(unrelated["securityReviews"].as_array().unwrap().iter().any(|d|d["id"]==decision["id"]&&d["acknowledged"]==true),"an unused table cannot change a current witness");
 fs::write(p.0.join("snapback/schema.q"),source.replace("advanceJob","progressJob")).unwrap();let changed=json(&p,&[]);let next=changed["securityReviews"].as_array().unwrap().iter().find(|d|d["code"]=="N_APPROVAL_NOT_ENFORCED").unwrap();
 assert_ne!(next["id"],decision["id"]);assert_eq!(next["acknowledged"],false);assert!(next["reason"].is_null());assert_eq!(next["witness"]["operation"],"progressJob");
}

#[test]
fn unresolved_approval_applicability_is_advice_even_with_cached_examples(){
 for source in [include_str!("../../snapback4-lang/tests/security/wave24/011.q"),include_str!("../../snapback4-lang/tests/security/wave26/020.q")]{
  let p=scratch();fs::write(p.0.join("snapback/schema.q"),source).unwrap();let report=json(&p,&[]);
  assert!(report["securityReviews"].as_array().unwrap().iter().any(|d|d["code"]=="N_APPROVAL_NOT_ENFORCED"));
  assert!(report["securityReviews"].as_array().unwrap().iter().filter(|d|d["code"]=="N_APPROVAL_NOT_ENFORCED").all(|d|d["gated"]==false),"an unconditional guessed requirement must not gate: {report}");
  let path=p.0.join("snapback/generated/security-witnesses.json");let mut cache:Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
  for value in cache["values"].as_array_mut().unwrap(){if value.is_object(){value["advisory"]=false.into();}}
  fs::write(&path,serde_json::to_vec(&cache).unwrap()).unwrap();let cached=json(&p,&[]);
  assert!(cached["securityReviews"].as_array().unwrap().iter().filter(|d|d["code"]=="N_APPROVAL_NOT_ENFORCED").all(|d|d["gated"]==false),"an editable presentation cache cannot establish applicability");
 }
}
