use super::owner_support::*;
use super::*;

#[test]
fn dev_start_and_control_apply_preserve_every_refusal() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let refusing = write_worker(
        &root,
        "refusing-compiler.mjs",
        r#"import { createInterface } from "node:readline";
const diagnostic = (code) => ({ code, family: "op", message: code, site: "snapback/broken.ts:1:1", rewrite: "fix it", guide: "op/compiler" });
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: request.id, ok: false, diagnostics: [diagnostic("E_FIRST"), diagnostic("E_SECOND")] }) + "\n");
}
"#,
    );
    let refused = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["dev", "--project"])
        .arg(&root)
        .arg("--json")
        .env("SNAPBACK2_COMPILER", refusing)
        .output()
        .unwrap();
    assert_eq!(refused.status.code(), Some(1));
    let output = String::from_utf8_lossy(&refused.stdout);
    assert!(output.contains("E_FIRST"), "{output}");
    assert!(output.contains("E_SECOND"), "{output}");

    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();
    let mut project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    let duplicate = project["programs"][0].clone();
    project["programs"]
        .as_array_mut()
        .unwrap()
        .push(duplicate.clone());
    project["programs"].as_array_mut().unwrap().push(duplicate);
    let applied = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", secret)],
        json!({ "project": project }),
    );
    assert_eq!(applied.status, 400, "{}", applied.body);
    assert!(
        applied.body["refusals"]
            .as_array()
            .is_some_and(|items| items.len() >= 2),
        "{}",
        applied.body
    );

    fs::write(
        root.join("snapback/watch-broken.ts"),
        r#"import { query } from "snapback2";
export const first = query({}, () => unknownOne);
export const second = query({}, () => unknownTwo);
"#,
    )
    .unwrap();
    let watched = wait_for(Duration::from_secs(6), || {
        let value = status(port, secret);
        value["status"]["refused"]
            .as_array()
            .is_some_and(|refusals| refusals.len() >= 2)
            .then_some(value)
    });
    let status_refusals = watched["status"]["refused"].as_array().unwrap().clone();
    let logged_refusals = fs::read_to_string(root.join(".snapback/log.jsonl"))
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|line| line["successor"] == "refused")
        .map(|line| line["refusal"].clone())
        .collect::<Vec<_>>();
    assert_eq!(status_refusals, logged_refusals);
    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "multi-refusal test" }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    owner.wait();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn measure_regression_self_test_covers_failed_step_scoring_and_summary() {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/measure.mjs");
    let output = Command::new("node")
        .arg(script)
        .arg("--self-test")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("measure self-test ok"));
}
