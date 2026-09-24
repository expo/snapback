use std::process::Command;

#[test]
fn witness_cli_refuses_missing_bundle_with_a_recipe() {
    let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["witness", "ios"]).output().unwrap();
    assert!(!output.status.success());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(error.contains("E_WITNESS_INPUT: --bundle-id is required"), "{error}");
}

#[test]
fn witness_card_is_published_under_builder_words() {
    for word in ["witness", "simulator", "offline proof"] {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["guide", word]).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
        assert!(String::from_utf8_lossy(&output.stdout).contains("snapback4 witness ios"));
    }
}

#[allow(dead_code)]
#[path = "../src/verbs/witness/protocol.rs"]
mod protocol;

#[test]
fn simulator_selection_is_explicit_and_platform_refusal_has_a_positive_control() {
    use serde_json::json;
    assert!(protocol::platform("linux").unwrap_err().starts_with("E_WITNESS_PLATFORM:"));
    assert!(protocol::platform("macos").is_ok());
    let mut list = json!({"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-5":[
        {"udid":"ours", "state":"Booted"}, {"udid":"theirs", "state":"Booted"}]}});
    assert_eq!(protocol::device(&list, None).unwrap_err(), "E_WITNESS_SIMULATOR: more than one iOS simulator is booted; --udid is required");
    assert_eq!(protocol::device(&list, Some("ours")).unwrap().0, "ours");
    assert!(protocol::device(&list, Some("booted")).is_err());
    list["devices"]["com.apple.CoreSimulator.SimRuntime.iOS-26-5"][1]["state"] = json!("Shutdown");
    assert_eq!(protocol::device(&list, None).unwrap().0, "ours");
}

#[test]
fn bound_port_is_refused_without_stopping_its_owner() {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    assert!(protocol::reserve(port).unwrap_err().starts_with("E_WITNESS_PORT:"));
    assert!(!protocol::refused(port).unwrap());
    drop(listener);
    // A shared host may reassign the just-released ephemeral port. The
    // positive reservation uses a new one; driver tests check real shutdown.
    assert!(protocol::reserve(0).is_ok());
}

#[test]
fn receipts_refuse_malformed_and_truncated_lines_and_preserve_app_objects() {
    let bytes = b"{\"arbitrary\": [1, null, {\"pass\": true}], \"witness\": {\"at\": \"2026-09-14T00:00:00.000Z\", \"step\": \"launched\"}}\n";
    assert_eq!(protocol::receipts(bytes, true).unwrap()[0]["arbitrary"][2]["pass"], true);
    assert!(protocol::receipts(b"not JSON\n", true).unwrap_err().contains("receipt line 1 is not JSON"));
    assert!(protocol::receipts(b"[]\n", true).unwrap_err().contains("not an object"));
    assert!(protocol::receipts(b"{}", true).is_err());
    assert!(protocol::receipts(b"", true).is_err());
    assert_eq!(protocol::receipts(&[bytes.as_slice(), b"{"].concat(), false).unwrap().len(), 1);
}

#[test]
fn artifacts_require_bytes_and_bind_the_digest() {
    let path = std::env::temp_dir().join(format!("sb4-witness-artifact-{}", std::process::id()));
    let _ = std::fs::remove_file(&path);
    assert!(protocol::artifact(&path).unwrap_err().contains("missing artifact"));
    std::fs::write(&path, "").unwrap();
    assert!(protocol::artifact(&path).unwrap_err().contains("empty artifact"));
    std::fs::write(&path, "abc").unwrap();
    let artifact = protocol::artifact(&path).unwrap();
    assert_eq!(artifact["bytes"], 3);
    assert_eq!(artifact["sha256"], "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    std::fs::remove_file(path).unwrap();
}

// The process choreography uses a fake simctl and a real `snapback4 dev`.
// It is a driver test, never native execution evidence.
#[cfg(target_os = "macos")]
mod driver {
    use super::*;
    use std::{fs, path::PathBuf, os::unix::fs::PermissionsExt, sync::atomic::{AtomicUsize, Ordering}};
    use serde_json::Value;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static SERIAL: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!("sb4-witness-driver-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(dir.join("app")).unwrap(); fs::create_dir_all(dir.join("data")).unwrap();
            fs::create_dir_all(dir.join("snapback")).unwrap();
            fs::write(dir.join("snapback/schema.q"), "use personas alice\ntable rows:\n  body: text <=40\n  public 'fixture'\nquery rows():\n  return rows first 10\n").unwrap();
            fs::write(dir.join("app/Info.plist"), r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.test</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundleExecutable</key><string>TestApp</string></dict></plist>"#).unwrap();
            fs::write(dir.join("app/TestApp"), "fake app for driver tests").unwrap();
            fs::write(dir.join("app/main.jsbundle"), "fake bundle for driver tests").unwrap();
            fs::write(dir.join("xcrun"), include_str!("fixtures/witness-simctl.py")).unwrap();
            fs::set_permissions(dir.join("xcrun"), fs::Permissions::from_mode(0o755)).unwrap();
            Self(dir)
        }
        fn command(&self, mode: &str, port: u16, artifacts: &std::path::Path) -> Command {
            let mut command = Command::new(env!("CARGO_BIN_EXE_snapback4"));
            command.args(["witness", "ios", "--bundle-id", "dev.test", "--port", &port.to_string(), "--timeout", "5"])
                .args(if mode.starts_with("smoke") { vec!["--smoke"] } else { vec!["--segment", "offline", "--prime"] })
                .arg("--artifacts").arg(artifacts)
                .args(if mode == "relaunch" { vec!["--relaunch"] } else { vec![] })
                .current_dir(&self.0).env("PATH", format!("{}:{}", self.0.display(), std::env::var("PATH").unwrap_or_default()))
                .env("WITNESS_TEST_DIR", &self.0).env("WITNESS_TEST_MODE", mode);
            command
        }
        fn run(&self, mode: &str, port: u16) -> std::process::Output {
            self.command(mode, port, std::path::Path::new("artifacts")).output().unwrap()
        }
        fn port() -> u16 { std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port() }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test]
    fn smoke_runs_three_cold_launches_and_a_broken_offline_run_fails() {
        for mode in ["smoke", "smoke-broken"] {
            let fixture = Fixture::new();
            let port = Fixture::port();
            let output = fixture.run(mode, port);
            assert_eq!(output.status.success(), mode == "smoke", "{}", String::from_utf8_lossy(&output.stderr));
            let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/smoke-ios-run.json")).unwrap()).unwrap();
            assert_eq!(manifest["segments"]["prime"]["status"], "passed");
            if mode == "smoke" {
                for segment in ["prime", "offline", "restart"] {
                    assert_eq!(manifest["segments"][segment]["status"], "passed");
                    assert!(manifest["artifacts"][format!("{segment}.png")]["bytes"].as_u64().unwrap() > 0);
                }
                assert!(manifest["segments"]["restart"]["receipt"]["watermark"].as_u64() > manifest["segments"]["prime"]["receipt"]["watermark"].as_u64());
                assert_eq!(fs::read_to_string(fixture.0.join("launch-count")).unwrap(), "3");
            } else {
                assert_eq!(manifest["segments"]["offline"]["status"], "failed");
                assert_eq!(manifest["segments"]["offline"]["receipt"]["errors"][0]["message"], "deliberate offline crash");
                assert_eq!(manifest["segments"]["restart"]["status"], "not-run");
            }
            assert!(protocol::refused(port).unwrap());
            assert!(!fixture.0.join("app-pid").exists());
        }
    }
    #[test]
    fn cli_missing_app_and_ambiguous_simulator_never_start_a_backend() {
        for (mode, code) in [("missing", "E_WITNESS_APP"), ("ambiguous", "E_WITNESS_SIMULATOR")] {
            let fixture = Fixture::new(); let output = fixture.run(mode, Fixture::port());
            assert!(!output.status.success()); let err = String::from_utf8_lossy(&output.stderr);
            assert!(err.contains(code), "{err}");
            if mode == "missing" { assert!(err.contains("npx expo run:ios --configuration Release --device dedicated"), "{err}"); }
            assert!(!fixture.0.join(".snapback4").exists());
        }
    }
    #[test]
    fn cli_cold_start_and_relaunch_capture_real_backend_refusal_and_bound_artifacts() {
        for mode in ["normal", "relaunch"] {
            let fixture = Fixture::new(); let port = Fixture::port(); let output = fixture.run(mode, port);
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
            assert_eq!(manifest["exitStatus"], 0);
            assert_eq!(manifest["udid"], "dedicated"); assert_eq!(manifest["appBuild"]["CFBundleVersion"], "1");
            assert_eq!(manifest["backend"]["port"], port);
            for suffix in ["screen.mp4", "receipts.jsonl", "device.log"] {
                let path = fixture.0.join(format!("artifacts/offline-ios-{suffix}"));
                assert_eq!(manifest["artifacts"][suffix]["sha256"], protocol::artifact(&path).unwrap()["sha256"]);
            }
            assert!(protocol::refused(port).unwrap());
            let events = manifest["events"].as_array().unwrap();
            assert!(events.iter().any(|e| e["step"] == "backend-refuses-connections"));
            assert_eq!(events.iter().filter(|e| e["step"] == "offline-relaunched").count(), usize::from(mode == "relaunch"));
        }
    }
    #[test]
    fn cli_invalid_receipts_missing_video_and_step_timeout_fail_and_stop_backend() {
        for (mode, code) in [("json", "E_WITNESS_RECEIPT"), ("empty-video", "E_WITNESS_ARTIFACT"), ("timeout", "E_WITNESS_TIMEOUT"), ("out-of-order", "E_WITNESS_STEP")] {
            let fixture = Fixture::new(); let port = Fixture::port(); let output = fixture.run(mode, port);
            assert!(!output.status.success()); let error = String::from_utf8_lossy(&output.stderr);
            assert!(error.contains(code), "{mode}: {error}");
            assert!(protocol::refused(port).unwrap());
            let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
            assert_eq!(manifest["exitStatus"], 1);
        }
    }
    fn invalid_protocol(mode: &str, code: &str) {
        let fixture = Fixture::new(); let output = fixture.run(mode, Fixture::port());
        assert!(!output.status.success(), "{mode} incorrectly passed");
        assert!(String::from_utf8_lossy(&output.stderr).contains(code), "{mode}: {}", String::from_utf8_lossy(&output.stderr));
        let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
        assert_eq!(manifest["exitStatus"], 1);
        if mode == "failed-batch" {
            assert!(!manifest["events"].as_array().unwrap().iter().any(|e| e["step"] == "reconnect-signaled"));
        }
    }
    #[test]
    fn cli_rejects_failure_in_the_milestone_batch() { invalid_protocol("failed-batch", "E_WITNESS_STEP"); }
    #[test]
    fn cli_rejects_failure_appended_after_done() { invalid_protocol("failed-after-done", "E_WITNESS_STEP"); }
    #[test]
    fn cli_rejects_milestone_appended_after_done() { invalid_protocol("reordered-after-done", "E_WITNESS_STEP"); }
    #[test]
    fn cli_rejects_step_change_appended_after_done() { invalid_protocol("step-after-done", "E_WITNESS_STEP"); }
    #[test]
    fn cli_rejects_malformed_envelope() { invalid_protocol("envelope", "E_WITNESS_RECEIPT"); }
    #[test]
    fn cli_refuses_an_existing_app_and_never_terminates_a_replacement() {
        let fixture = Fixture::new(); let output = fixture.run("running", Fixture::port());
        assert!(!output.status.success(), "existing app was taken over");
        assert!(String::from_utf8_lossy(&output.stderr).contains("E_WITNESS_APP: dev.test is already running on dedicated; quit it before starting the witness"));
        assert!(!fixture.0.join("process-events.jsonl").exists());
        assert!(!fixture.0.join(".snapback4").exists());
        let fixture = Fixture::new(); let output = fixture.run("replacement", Fixture::port());
        assert!(!output.status.success());
        assert_eq!(fs::read_to_string(fixture.0.join("app-pid")).unwrap(), "9999");
        let events = fs::read_to_string(fixture.0.join("process-events.jsonl")).unwrap();
        assert!(!events.contains("9999"));
    }
    #[test]
    fn cli_preserves_every_existing_output() {
        for suffix in ["run.json", "screen.mp4", "receipts.jsonl", "device.log", "video.log", "launch.log", "backend.log", "backend-stdout.log", "log-stderr.log"] {
            let fixture = Fixture::new(); fs::create_dir(fixture.0.join("artifacts")).unwrap();
            let path = fixture.0.join(format!("artifacts/offline-ios-{suffix}")); fs::write(&path, "previous run").unwrap();
            let output = fixture.run("normal", Fixture::port());
            assert!(!output.status.success(), "overwrote {suffix}");
            assert!(String::from_utf8_lossy(&output.stderr).contains("E_WITNESS_ARTIFACT"));
            assert_eq!(fs::read_to_string(path).unwrap(), "previous run");
            assert!(!fixture.0.join("process-events.jsonl").exists());
        }
    }
    #[test]
    fn cli_restart_and_relaunch_keep_logs_and_terminate_only_launched_pids() {
        let fixture = Fixture::new(); let port = Fixture::port(); let output = fixture.run("relaunch", port);
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let stdout = fs::read_to_string(fixture.0.join("artifacts/offline-ios-backend-stdout.log")).unwrap();
        assert_eq!(stdout.lines().filter(|s| *s == format!("http://127.0.0.1:{port}")).count(), 2);
        let launch = fs::read_to_string(fixture.0.join("artifacts/offline-ios-launch.log")).unwrap();
        for n in 1..=3 { assert!(launch.contains(&format!("launch-stderr-{n}"))); }
        let events: Vec<Value> = fs::read_to_string(fixture.0.join("process-events.jsonl")).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(events.len(), 6);
        for (i, pair) in events.chunks(2).enumerate() {
            assert_eq!(pair[0]["launch"], 7001 + i); assert_eq!(pair[1]["terminate"], 7001 + i);
            assert!(!pair[0]["args"].to_string().contains("--terminate-running-process"));
        }
    }

    #[test]
    fn cli_concurrent_runs_into_one_namespace_have_one_owner() {
        let first = Fixture::new(); let second = Fixture::new(); let artifacts = first.0.join("artifacts");
        let mut one = first.command("normal", Fixture::port(), &artifacts);
        let mut two = second.command("normal", Fixture::port(), &artifacts);
        two.env("WITNESS_TEST_UDID", "another-simulator");
        let one = one.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        let two = two.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        let outputs = [one.wait_with_output().unwrap(), two.wait_with_output().unwrap()];
        assert_eq!(outputs.iter().filter(|o| o.status.success()).count(), 1, "{:?}", outputs);
        let loser = outputs.iter().find(|o| !o.status.success()).unwrap();
        assert!(String::from_utf8_lossy(&loser.stderr).contains("E_WITNESS_ARTIFACT"));
        let manifest: Value = serde_json::from_slice(&fs::read(artifacts.join("offline-ios-run.json")).unwrap()).unwrap();
        assert_eq!(manifest["exitStatus"], 0);
        for suffix in ["receipts.jsonl", "screen.mp4", "device.log"] {
            assert_eq!(manifest["artifacts"][suffix]["sha256"], protocol::artifact(&artifacts.join(format!("offline-ios-{suffix}"))).unwrap()["sha256"]);
        }
        assert!(artifacts.join("offline-ios-reserved").is_file());
    }

}


#[test]
fn artifact_reservation_has_one_winner_before_any_output_exists() {
    use std::sync::{Arc, Barrier};
    let dir = std::env::temp_dir().join(format!("sb4-witness-reserve-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let gate = Arc::new(Barrier::new(2));
    let threads: Vec<_> = (0..2).map(|_| {
        let dir = dir.clone(); let gate = gate.clone();
        std::thread::spawn(move || { gate.wait(); protocol::reserve_artifacts(&dir, "same-segment") })
    }).collect();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1, "{results:?}");
    assert!(protocol::reserve_artifacts(&dir, "another-segment").is_ok());
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2); // markers only; no output can decide this race
    std::fs::remove_dir_all(dir).unwrap();
}
