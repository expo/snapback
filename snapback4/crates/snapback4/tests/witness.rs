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
    let bytes = b"{\"arbitrary\": [1, null, {\"pass\": true}]}\n";
    assert_eq!(protocol::receipts(bytes, true).unwrap()[0]["arbitrary"][2]["pass"], true);
    assert!(protocol::receipts(b"not JSON\n", true).unwrap_err().contains("receipt line 1 is not JSON"));
    assert!(protocol::receipts(b"[]\n", true).unwrap_err().contains("not an object"));
    assert!(protocol::receipts(b"{}", true).is_err());
    assert!(protocol::receipts(b"", true).is_err());
    assert_eq!(protocol::receipts(b"{}\n{", false).unwrap().len(), 1);
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
            fs::write(dir.join("xcrun"), include_str!("fixtures/witness-simctl.py")).unwrap();
            fs::set_permissions(dir.join("xcrun"), fs::Permissions::from_mode(0o755)).unwrap();
            Self(dir)
        }
        fn run(&self, mode: &str, port: u16) -> std::process::Output {
            Command::new(env!("CARGO_BIN_EXE_snapback4"))
                .args(["witness", "ios", "--bundle-id", "dev.test", "--segment", "offline", "--artifacts", "artifacts", "--port", &port.to_string(), "--timeout", "5", "--prime"])
                .args(if mode == "relaunch" { vec!["--relaunch"] } else { vec![] })
                .current_dir(&self.0).env("PATH", format!("{}:{}", self.0.display(), std::env::var("PATH").unwrap_or_default()))
                .env("WITNESS_TEST_DIR", &self.0).env("WITNESS_TEST_MODE", mode).output().unwrap()
        }
        fn port() -> u16 { std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port() }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
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
}
