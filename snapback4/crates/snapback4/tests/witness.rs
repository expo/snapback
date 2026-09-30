use std::process::Command;

#[test]
fn witness_cli_refuses_missing_bundle_with_a_recipe() {
    let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["witness", "ios"]).output().unwrap();
    assert!(!output.status.success());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(error.contains("E_WITNESS_INPUT: --bundle-id is required"), "{error}");
}

#[test]
fn preparation_selectors_are_exclusive_and_repack_is_withdrawn() {
    for (flags, reason) in [
        (vec!["--bundle-id", "app.test", "--build", "."], "select exactly one"),
        (vec!["--repack=build.json"], "repack is withdrawn; use witness ios --build"),
        (vec!["--repack", "build.json", "--app-project", ".", "--smoke"], "repack is withdrawn; use witness ios --build"),
        (vec!["--repack", "build.json"], "repack is withdrawn; use witness ios --build"),
        (vec!["--build", ".", "--app-project", "."], "repack is withdrawn; use witness ios --build"),
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["witness", "ios"]).args(flags).output().unwrap();
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains(reason));
    }
}

#[cfg(target_os = "linux")]
#[test]
fn build_refuses_linux_before_any_native_helper_runs() {
    let dir = std::env::temp_dir().join(format!("witness-linux-{}", std::process::id()));
    let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["witness", "ios", "--build", ".", "--smoke", "--artifacts"]).arg(&dir).output().unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("E_WITNESS_PLATFORM"));
    assert!(!dir.join("prepare.mjs").exists());
    let _ = std::fs::remove_dir_all(dir);
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

// @ref LLP 3000#publication-suite-under-contention — a separate guard outlives the timeout under test and owns cleanup.
#[cfg(unix)]
#[allow(dead_code)] // Driver scenarios are Darwin-only; portable controls share this guard.
#[path = "fixtures/witness-watchdog.rs"]
mod watchdog;

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
    use std::{fs, path::PathBuf, os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt}, sync::atomic::{AtomicUsize, Ordering}};
    use serde_json::Value;
    struct Fixture(PathBuf, std::cell::RefCell<Vec<watchdog::Guarded>>);
    impl Fixture {
        fn new() -> Self {
            static SERIAL: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!("sb4-witness-driver-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
            for name in ["app", "data", "snapback"] {
                fs::DirBuilder::new().recursive(true).mode(0o700).create(dir.join(name)).unwrap();
            }
            fs::write(dir.join("snapback/schema.q"), "use personas alice\ntable rows:\n  body: text <=40\n  public 'fixture'\nquery rows():\n  return rows first 10\n").unwrap();
            fs::write(dir.join("app/Info.plist"), r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.test</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundleExecutable</key><string>TestApp</string></dict></plist>"#).unwrap();
            fs::write(dir.join("app/TestApp"), "fake app for driver tests").unwrap();
            fs::write(dir.join("app/main.jsbundle"), "fake bundle for driver tests").unwrap();
            fs::write(dir.join("xcrun"), include_str!("fixtures/witness-simctl.py")).unwrap();
            fs::set_permissions(dir.join("xcrun"), fs::Permissions::from_mode(0o755)).unwrap();
            let state = dir.with_extension("state").join("snapback4/witness/simulators");
            fs::DirBuilder::new().recursive(true).mode(0o700).create(&state).unwrap();
            for (id, runtime) in [(dir.file_name().unwrap().to_str().unwrap(), "26-5"), ("owned-old", "9-3"), ("owned-18", "18-0"), ("deleted-device", "99")] {
                use std::io::Write;
                let mut record = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(state.join(format!("{id}.json"))).unwrap();
                write!(record, "{}", serde_json::json!({"udid":id, "name":"snapback4-smoke-prior", "runtime":format!("com.apple.CoreSimulator.SimRuntime.iOS-{runtime}"), "prefix":"snapback4-smoke-"})).unwrap();
            }
            Self(dir, Default::default())
        }
        fn command(&self, mode: &str, port: u16, artifacts: &std::path::Path) -> Command {
            if mode.starts_with("auto-create") {
                // The fake create returns this fixture's UDID; do not seed a
                // creation record for that future device.
                fs::remove_file(self.0.with_extension("state").join(format!("snapback4/witness/simulators/{}.json", self.0.file_name().unwrap().to_str().unwrap()))).unwrap();
            }
            let mut command = Command::new(env!("CARGO_BIN_EXE_snapback4"));
            // Use the published per-step budget, including first-exec scanning
            // of the fake Python simctl. Intentional timeout cases below still
            // withhold progress and assert the exact failing phase and cleanup.
            command.args(["witness", "ios", "--bundle-id", "dev.test", "--port", &port.to_string(), "--timeout", "120"])
                .args(if mode.starts_with("smoke") { vec!["--smoke"] } else { vec!["--segment", "offline", "--prime"] })
                .arg("--artifacts").arg(artifacts)
                .args(if mode == "relaunch" { vec!["--relaunch"] } else { vec![] })
                .current_dir(&self.0).env("PATH", format!("{}:{}", self.0.display(), std::env::var("PATH").unwrap_or_default()))
                .env("XDG_STATE_HOME", self.0.with_extension("state")).env("WITNESS_TEST_PORT", port.to_string())
                .env("WITNESS_TEST_UDID", self.0.file_name().unwrap()).env("WITNESS_TEST_DIR", &self.0).env("WITNESS_TEST_MODE", mode);
            command
        }
        fn run(&self, mode: &str, port: u16) -> std::process::Output {
            let budget = if mode == "timeout-prepare" { watchdog::PREPARATION_GUARD } else { watchdog::SCENARIO_GUARD };
            self.run_command(&mut self.command(mode, port, std::path::Path::new("artifacts")), budget)
        }
        fn run_command(&self, command: &mut Command, budget: std::time::Duration) -> std::process::Output {
            let mut drivers = self.1.borrow_mut();
            drivers.push(watchdog::Guarded::spawn(command, &self.0, budget));
            drivers.last_mut().unwrap().finish()
        }
        fn port() -> u16 {
            // Avoid macOS's outbound ephemeral range: another test's HTTP
            // connection can take a just-probed ephemeral port before dev binds.
            static NEXT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);
            loop {
                let offset = NEXT.fetch_add(1, Ordering::Relaxed) as u32;
                let port = 30000 + ((std::process::id() + offset) % 15000) as u16;
                if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() { return port; }
            }
        }
    }
    impl Drop for Fixture { fn drop(&mut self) {
        self.1.get_mut().clear();
        let _ = fs::remove_dir_all(&self.0);
        let _ = fs::remove_dir_all(self.0.with_extension("state"));
    } }
    fn unsafe_simulator_record(mode: &str) {
            let fixture = Fixture::new();
            let state = fixture.0.with_extension("state").join("snapback4/witness/simulators");
            let original = state.join(format!("{}.json", fixture.0.file_name().unwrap().to_str().unwrap()));
            let mut record: Value = serde_json::from_slice(&fs::read(&original).unwrap()).unwrap();
            fs::remove_file(original).unwrap();
            record["udid"] = serde_json::json!("foreign");
            let path = state.join("foreign.json");
            use std::io::Write;
            let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path).unwrap();
            write!(file, "{record}").unwrap();
            drop(file);
            match mode {
                "symlink" => {
                    fs::rename(&path, fixture.0.join("foreign.json")).unwrap();
                    std::os::unix::fs::symlink(fixture.0.join("foreign.json"), &path).unwrap();
                },
                "world-write" => fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap(),
                "group-write" => fs::set_permissions(&path, fs::Permissions::from_mode(0o620)).unwrap(),
                "directory-symlink" => {
                    fs::rename(&state, fixture.0.join("records")).unwrap();
                    std::os::unix::fs::symlink(fixture.0.join("records"), &state).unwrap();
                },
                "directory-write" => fs::set_permissions(&state, fs::Permissions::from_mode(0o777)).unwrap(),
                _ => unreachable!(),
            }
            let output = fixture.run_command(fixture.command("normal", Fixture::port(), std::path::Path::new("artifacts"))
                .env("WITNESS_TEST_PRIOR_UDID", "foreign"), watchdog::SCENARIO_GUARD);
            let receipt: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
            assert_ne!(receipt["simulator"]["selection"], "reused", "{mode}: {receipt}");
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert_eq!(stderr.matches("warning: ignoring unsafe simulator ownership records").count(), 1, "{mode}: {stderr}");
            let calls: Vec<Value> = fs::read_to_string(fixture.0.join("simctl-calls.jsonl")).unwrap().lines().map(|s| serde_json::from_str(s).unwrap()).collect();
            assert!(!calls.iter().any(|c| c.as_array().unwrap().iter().any(|v| v == "foreign")), "{mode}: {calls:?}");
            if mode.starts_with("directory-") {
                assert_eq!(output.status.code(), Some(1));
                assert!(!calls.iter().any(|c| c[0] == "create"));
            } else {
                assert!(output.status.success(), "{mode}: {stderr}");
                assert_eq!(receipt["simulator"]["selection"], "created");
                use std::os::unix::fs::MetadataExt;
                let created = state.join(format!("{}.json", receipt["udid"].as_str().unwrap()));
                assert_eq!(fs::metadata(created).unwrap().mode() & 0o777, 0o600);
            }
    }
    #[test]
    fn symlinked_simulator_record_is_ignored() { unsafe_simulator_record("symlink"); }
    #[test]
    fn world_writable_simulator_record_is_ignored() { unsafe_simulator_record("world-write"); }
    #[test]
    fn group_writable_simulator_record_is_ignored() { unsafe_simulator_record("group-write"); }
    #[test]
    fn symlinked_simulator_directory_is_ignored() { unsafe_simulator_record("directory-symlink"); }
    #[test]
    fn writable_simulator_directory_is_ignored() { unsafe_simulator_record("directory-write"); }
    // A real stalled Node checker must not inherit the listening socket. It may
    // outlive dev during startup interruption, so assert port release BEFORE
    // cleaning up that exact recorded PID. No simulator or unrelated PID used.
    fn failed_startup_releases_listener(interrupt: bool) {
        use std::{time::{Duration, Instant}, thread::sleep};
        let fixture = Fixture::new();
        fs::write(fixture.0.join("snapback/server.ts"), "export default {};\n").unwrap();
        let node = Command::new("node").args(["-p", "process.execPath"]).output().unwrap();
        assert!(node.status.success());
        let node = String::from_utf8(node.stdout).unwrap();
        fs::write(fixture.0.join("stalled.mjs"), "import fs from 'node:fs'; fs.writeFileSync('checker-pid', String(process.pid)); setInterval(() => {}, 1000);\n").unwrap();
        // The real checker has its own 30-second deadline. Keep the Node
        // descendant and diagnostic pipes alive after its wrapper is reaped,
        // so only the witness's 120-second startup guard ends this scenario.
        fs::write(fixture.0.join("checker"), format!("#!/bin/sh\n'{}' '{}' &\nwait\n", node.trim(), fixture.0.join("stalled.mjs").display())).unwrap();
        fs::set_permissions(fixture.0.join("checker"), fs::Permissions::from_mode(0o755)).unwrap();
        let port = Fixture::port();
        let mut child = watchdog::Guarded::spawn(fixture.command("normal", port, std::path::Path::new("artifacts"))
            .env("SNAPBACK_NODE", fixture.0.join("checker")), &fixture.0, watchdog::SCENARIO_GUARD);
        let deadline = Instant::now() + Duration::from_secs(120);
        while !fixture.0.join("checker-pid").exists() && Instant::now() < deadline && child.is_running() { sleep(Duration::from_millis(20)); }
        let pid = fs::read_to_string(fixture.0.join("checker-pid")).unwrap().parse::<i32>().unwrap();
        struct Checker(i32);
        impl Drop for Checker { fn drop(&mut self) { unsafe { libc::kill(self.0, libc::SIGKILL); } } }
        let _checker = Checker(pid);
        if interrupt { assert_eq!(unsafe { libc::kill(child.id() as i32, libc::SIGINT) }, 0); }
        let output = child.finish();
        assert_eq!(output.status.code(), Some(1));
        let code = if interrupt { "E_WITNESS_INTERRUPTED" } else { "E_WITNESS_BACKEND: dev did not become ready before the step timeout" };
        assert!(String::from_utf8_lossy(&output.stderr).contains(code), "{}", String::from_utf8_lossy(&output.stderr));
        let receipt: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
        assert!(receipt["error"].as_str().unwrap().contains(code));
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok(), "stalled checker retained port {port} after {code}");
    }
    #[test]
    fn interrupted_startup_does_not_leak_listener_to_checker() { failed_startup_releases_listener(true); }
    #[test]
    fn timed_out_startup_does_not_leak_listener_to_checker() { failed_startup_releases_listener(false); }
    #[test]
    fn automatic_selection_reuses_only_its_prefix_or_creates_on_newest_runtime() {
        for (mode, prefix) in [("normal", "snapback4-smoke-"), ("auto-create", "snapback4-smoke-"), ("auto-create-lane", "sb4-ns-")] {
            let fixture = Fixture::new();
            let output = fixture.run_command(fixture.command(mode, Fixture::port(), std::path::Path::new("artifacts"))
                .env("SNAPBACK4_SMOKE_DEVICE_PREFIX", prefix), watchdog::SCENARIO_GUARD);
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
            assert!(manifest["simulator"]["name"].as_str().unwrap().starts_with(prefix));
            assert_eq!(manifest["simulator"]["selection"], if mode == "normal" { "reused" } else { "created" });
            assert!(String::from_utf8_lossy(&output.stderr).contains(manifest["udid"].as_str().unwrap()));
            let calls = fs::read_to_string(fixture.0.join("simctl-calls.jsonl")).unwrap();
            assert_eq!(calls.contains("\"create\""), mode != "normal");
            assert!(!calls.contains("someone-else") && !calls.contains("near-prefix") && !calls.contains("unavailable"));
        }
    }
    #[test]
    fn prefix_without_creation_record_is_ignored() {
        let fixture = Fixture::new();
        fs::remove_dir_all(fixture.0.with_extension("state")).unwrap();
        let output = fixture.run("normal", Fixture::port());
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let receipt: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
        assert_eq!(receipt["simulator"]["selection"], "created", "a matching name alone must not authorize reuse");
        let id = receipt["udid"].as_str().unwrap();
        let record: Value = serde_json::from_slice(&fs::read(fixture.0.with_extension("state").join(format!("snapback4/witness/simulators/{id}.json"))).unwrap()).unwrap();
        assert_eq!(record["udid"], receipt["udid"]);
    }
    #[test]
    fn owned_devices_use_numeric_runtime_order() {
        let fixture = Fixture::new();
        let output = fixture.run("reuse-order", Fixture::port());
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let receipt: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
        assert_eq!(receipt["runtime"], "com.apple.CoreSimulator.SimRuntime.iOS-26-5");
        assert_eq!(receipt["simulator"]["selection"], "reused");
    }
    #[test]
    fn created_device_type_is_current_not_last_listed() {
        for (models, expected) in [
            ("17,11", "17"),
            ("17e,16", "17e"),
            ("17-Pro,17e,16", "17-Pro"),
            ("17-Pro-Max,17-Pro,17e,16", "17-Pro-Max"),
            ("17-Pro-Max,17,17e,16", "17"),
            ("16,17e,Air", "Air"),
            ("16,Air,17-Pro,17-Pro-Max", "17-Pro-Max"),
        ] {
            let fixture = Fixture::new();
            let output = fixture.run_command(fixture.command("auto-create-types", Fixture::port(), std::path::Path::new("artifacts"))
                .env("WITNESS_TEST_DEVICE_TYPES", models), watchdog::SCENARIO_GUARD);
            assert!(output.status.success(), "{models}: {}", String::from_utf8_lossy(&output.stderr));
            let calls: Vec<Value> = fs::read_to_string(fixture.0.join("simctl-calls.jsonl")).unwrap().lines().map(|s| serde_json::from_str(s).unwrap()).collect();
            assert_eq!(calls.iter().find(|c| c[0] == "create").unwrap()[2], format!("com.apple.CoreSimulator.SimDeviceType.iPhone-{expected}"), "{models}");
        }
    }
    #[test]
    fn boot_failure_keeps_created_identity_in_receipt() {
        for mode in ["auto-create-boot-fails", "auto-create-bootstatus-fails"] {
            let fixture = Fixture::new();
            let output = fixture.run(mode, Fixture::port());
            assert_eq!(output.status.code(), Some(1));
            let receipt: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap()).unwrap();
            assert_eq!(receipt["simulator"]["selection"], "created");
            assert!(receipt["error"].as_str().unwrap().contains("simctl boot"));
            assert_eq!(receipt["udid"].as_str(), fixture.0.file_name().unwrap().to_str());
            assert_eq!(receipt["runtime"], "com.apple.CoreSimulator.SimRuntime.iOS-26-5");
            assert!(receipt["simulator"]["name"].as_str().unwrap().starts_with("snapback4-smoke-"));
        }
    }
    #[test]
    fn preparation_keeps_origin_port_owned_until_backend_startup() {
        let fixture = Fixture::new();
        let output = fixture.run("port-custody", Fixture::port());
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(!fixture.0.join("port-stolen").exists(), "origin became bindable between preparation and backend startup");
    }
    fn build_command(fixture: &Fixture) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_snapback4"));
        command.args(["witness", "ios", "--build", ".", "--smoke", "--artifacts", "artifacts"])
            .current_dir(&fixture.0).env("PATH", format!("{}:{}", fixture.0.display(), std::env::var("PATH").unwrap()))
            .env("XDG_STATE_HOME", fixture.0.with_extension("state"))
            .env("WITNESS_TEST_UDID", fixture.0.file_name().unwrap()).env("WITNESS_TEST_DIR", &fixture.0).env("WITNESS_TEST_MODE", "normal");
        command
    }
    #[test]
    fn missing_schema_uses_one_message_and_witness_exit_one() {
        for missing_schema in [true, false] {
            let fixture = Fixture::new();
            if missing_schema { fs::remove_file(fixture.0.join("snapback/schema.q")).unwrap(); }
            else { fs::write(fixture.0.join("snapback/generated"), "block codegen").unwrap(); }
            let output = fixture.run_command(&mut build_command(&fixture), watchdog::SCENARIO_GUARD);
            assert_eq!(output.status.code(), Some(1));
            let err = String::from_utf8_lossy(&output.stderr);
            if missing_schema {
                assert_eq!(err.lines().count(), 1, "{err}");
                assert!(err.contains("no snapback/schema.q"), "{err}");
            } else {
                assert!(err.contains("backend check failed"), "{err}");
                let path = fs::canonicalize(fixture.0.join("artifacts/check-stderr.log")).unwrap();
                assert!(err.contains(&format!("see {}", path.display())), "{err}");
                assert!(!err.contains("check-stdout.log"), "{err}");
                let log = fs::read_to_string(fixture.0.join("artifacts/check-stderr.log")).unwrap();
                assert!(log.contains("cannot write generated types"), "{log}");
                assert!(err.contains(log.lines().next().unwrap()), "{err}");
                assert!(!fs::read_to_string(fixture.0.join("simctl-calls.jsonl")).unwrap().contains("\"install\""));
            }
            assert!(fixture.0.join("artifacts/smoke-ios-run.json").exists());
        }
    }
    #[test]
    fn project_lease_precedes_check_generation() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.0.join(".snapback4-witness")).unwrap();
        let lock = fs::File::create(fixture.0.join(".snapback4-witness/owner.lock")).unwrap();
        lock.try_lock().unwrap();
        let output = fixture.run_command(&mut build_command(&fixture), watchdog::SCENARIO_GUARD);
        assert_eq!(output.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&output.stderr).contains("owner already holds"));
        assert!(!fixture.0.join("snapback/generated").exists(), "a second owner entered codegen before taking the lease");
    }
    #[test]
    fn missing_xcode_or_runtime_fails_once_before_build_or_backend() {
        for mode in ["no-xcode", "no-runtime"] {
            let fixture = Fixture::new();
            let output = fixture.run_command(Command::new(env!("CARGO_BIN_EXE_snapback4"))
                .args(["witness", "ios", "--build", ".", "--smoke"])
                .current_dir(&fixture.0).env("PATH", format!("{}:{}", fixture.0.display(), std::env::var("PATH").unwrap()))
                .env("WITNESS_TEST_DIR", &fixture.0).env("WITNESS_TEST_MODE", mode), watchdog::SCENARIO_GUARD);
            let err = String::from_utf8_lossy(&output.stderr);
            assert!(!output.status.success()); assert_eq!(err.lines().count(), 1, "{err}");
            assert!(err.contains("E_WITNESS_PLATFORM") && err.contains("Settings > Components"), "{err}");
            assert!(!err.contains("tool noise"));
            assert!(!fixture.0.join(".snapback4-witness").exists() && !fixture.0.join(".snapback4").exists());
            assert!(fixture.0.join("artifacts/native-smoke").exists());
            assert_eq!(fs::read_to_string(fixture.0.join("simctl-calls.jsonl")).unwrap().lines().count(), 1);
        }
    }
    #[test]
    fn smoke_facts_come_from_the_generation_served_after_a_source_edit() {
        let fixture = Fixture::new();
        let output = fixture.run("smoke-source-race", Fixture::port());
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/smoke-ios-run.json")).unwrap()).unwrap();
        assert_eq!(manifest["queryFacts"]["rows"]["runs"], "server");
        assert_eq!(manifest["queryGeneration"], 1);
        assert_eq!(manifest["segments"]["offline"]["receipt"]["queries"][0]["classification"], "online-only");
    }

    #[test]
    fn smoke_wrong_origin_marks_the_segment_failed() {
        let fixture = Fixture::new();
        let output = fixture.run("smoke-wrong-origin", Fixture::port());
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("E_WITNESS_ORIGIN"));
        let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/smoke-ios-run.json")).unwrap()).unwrap();
        assert_eq!(manifest["segments"]["prime"]["status"], "failed");
        assert_eq!(manifest["segments"]["offline"]["status"], "not-run");
    }
    #[test]
    fn smoke_wrong_generation_marks_the_segment_failed() {
        for field in ["queryGeneration", "generation"] {
            let fixture = Fixture::new();
            let output = fixture.run(&format!("smoke-wrong-{field}"), Fixture::port());
            assert!(!output.status.success());
            assert!(String::from_utf8_lossy(&output.stderr).contains("smoke receipt differs from the served query generation"));
            let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/smoke-ios-run.json")).unwrap()).unwrap();
            assert_eq!(manifest["exitStatus"], 1);
            assert_eq!(manifest["segments"]["prime"]["receipt"]["pass"], true);
            assert_ne!(manifest["segments"]["prime"]["receipt"][field], manifest["queryGeneration"]);
            assert_eq!(manifest["segments"]["prime"]["status"], "failed");
            assert!(manifest["segments"]["prime"]["error"].as_str().unwrap().contains("served query generation"));
            assert_eq!(manifest["segments"]["offline"]["status"], "not-run");
            assert_eq!(manifest["segments"]["restart"]["status"], "not-run");
        }
    }
    #[test]
    fn smoke_collection_revalidates_query_generation() {
        smoke_rejects_failure_after_receipt("smoke-collected-generation", "restart", "E_WITNESS_RECEIPT");
    }
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
    fn smoke_rejects_failure_after_receipt(mode: &str, segment: &str, code: &str) {
        let fixture = Fixture::new(); let port = Fixture::port(); let output = fixture.run(mode, port);
        assert!(!output.status.success(), "{mode} incorrectly passed");
        assert!(String::from_utf8_lossy(&output.stderr).contains(code), "{}", String::from_utf8_lossy(&output.stderr));
        let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/smoke-ios-run.json")).unwrap()).unwrap();
        assert_eq!(manifest["exitStatus"], 1);
        assert_eq!(manifest["segments"][segment]["status"], "failed");
        let receipt = &manifest["segments"][segment]["receipt"];
        assert_eq!(receipt["pass"], true, "failure is in driver validation, after app success");
        if segment == "restart" {
            assert!(receipt["watermark"].as_u64() > manifest["segments"]["prime"]["receipt"]["watermark"].as_u64());
        }
        if mode.starts_with("smoke-crash-after-done-") {
            let events = fs::read_to_string(fixture.0.join("process-events.jsonl")).unwrap();
            let index = ["prime", "offline", "restart"].iter().position(|s| *s == segment).unwrap();
            assert!(!events.contains(&format!("\"terminate\": {}", 7001 + index)), "crashed PID was not deliberately terminated");
            for later in ["prime", "offline", "restart"].iter().skip(index + 1) {
                assert_eq!(manifest["segments"][*later]["status"], "not-run");
            }
        }
        assert!(protocol::refused(port).unwrap());
        assert!(!fixture.0.join("app-pid").exists());
    }
    #[test]
    fn smoke_rejects_unconsumed_barrier_and_native_crash_after_done() {
        smoke_rejects_failure_after_receipt("smoke-stale-restart", "restart", "E_WITNESS_STEP");
        smoke_rejects_failure_after_receipt("smoke-crash-after-done-restart", "restart", "E_WITNESS_APP");
    }
    #[test]
    fn smoke_rejects_native_crash_after_prime() {
        smoke_rejects_failure_after_receipt("smoke-crash-after-done-prime", "prime", "E_WITNESS_APP");
    }
    #[test]
    fn smoke_rejects_native_crash_after_offline() {
        smoke_rejects_failure_after_receipt("smoke-crash-after-done-offline", "offline", "E_WITNESS_APP");
    }
    #[test]
    fn cli_missing_app_never_starts_a_backend() {
        for (mode, code) in [("missing", "E_WITNESS_APP")] {
            let fixture = Fixture::new(); let output = fixture.run(mode, Fixture::port());
            assert!(!output.status.success()); let err = String::from_utf8_lossy(&output.stderr);
            assert!(err.contains(code), "{err}");
            if mode == "missing" { assert!(err.contains("--device generic --no-bundler") && err.contains("simctl install"), "{err}"); }
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
            assert_eq!(manifest["udid"], fixture.0.file_name().unwrap().to_str().unwrap()); assert_eq!(manifest["appBuild"]["CFBundleVersion"], "1");
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
            let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).unwrap_or_else(|e| panic!("{mode}: missing failure manifest: {e}; stderr: {error}"))).unwrap();
            if mode == "timeout" {
                assert!(error.contains("app did not reach offline-done within 120 seconds"), "the receipt-step premise did not hold: {error}");
                assert!(manifest["events"].as_array().unwrap().iter().any(|event| event["step"] == "waiting-offline-done"));
            }
            eprintln!("{mode}: {error}");
            assert_eq!(manifest["exitStatus"], 1);
        }
    }
    #[test]
    fn cli_preparation_timeout_still_records_failure_manifest() {
        let fixture = Fixture::new();
        let port = Fixture::port();
        let output = fixture.run("timeout-prepare", port);
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(!output.status.success());
        assert!(error.contains("E_WITNESS_TIMEOUT: xcrun simctl list runtimes --json timed out"), "{error}");
        assert!(!fixture.0.join(".snapback4").exists(), "preparation must not start the backend");
        assert!(protocol::refused(port).unwrap());
        let manifest: Value = serde_json::from_slice(&fs::read(fixture.0.join("artifacts/offline-ios-run.json")).expect("preparation failure must have a manifest")).unwrap();
        assert_eq!(manifest["exitStatus"], 1);
        assert_eq!(manifest["phase"], "preparation");
        assert!(manifest["error"].as_str().unwrap().contains("E_WITNESS_TIMEOUT"));
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
        assert!(String::from_utf8_lossy(&output.stderr).contains("E_WITNESS_APP: dev.test is already running on "), "{}", String::from_utf8_lossy(&output.stderr));
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
        let mut one = watchdog::Guarded::spawn(&mut one, &first.0, watchdog::SCENARIO_GUARD);
        let mut two = watchdog::Guarded::spawn(&mut two, &second.0, watchdog::SCENARIO_GUARD);
        let outputs = [one.finish(), two.finish()];
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

#[path = "../src/witness_socket.rs"]
#[allow(dead_code)]
mod witness_socket;

#[test]
fn dev_accepts_the_still_owned_listener_without_a_rebind_gap() {
    use std::{fs, time::{Duration, Instant}, thread::sleep};
    let dir = std::env::temp_dir().join(format!("ns-listener-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::write(dir.join("snapback/schema.q"), "table rows:\n  body: text\n  public 'all'\n").unwrap();
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback4"));
    command.args(["dev", "--port", &port.to_string(), "--no-watch"]).env("SNAPBACK4_WITNESS_DRIVER", "1")
        .current_dir(&dir);
    witness_socket::inherit(&mut command, &listener);
    let child = watchdog::Guarded::spawn(&mut command, &dir, watchdog::SCENARIO_GUARD);
    let deadline = Instant::now() + Duration::from_secs(120);
    let ready = loop {
        let text = fs::read_to_string(dir.join("driver-stdout.log")).unwrap();
        if text.lines().any(|s| s == format!("http://127.0.0.1:{port}")) { break true; }
        if !child.is_running() || Instant::now() >= deadline { break false; }
        // A competing binder must fail throughout startup, including before ready.
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_err());
        sleep(Duration::from_millis(10));
    };
    drop(child);
    drop(listener);
    fs::remove_dir_all(dir).unwrap();
    assert!(ready, "dev must serve the inherited listener while the parent still owns it");
}
