//! Black-box acceptance for LLP 0184 Phase 4's secret-safe config.set CLI.
//!
//! @ref LLP 0184#product-contract-what-agent-accessible-means — stdin/fd are
//!   the only v1 value carriers and every success/refusal projection is
//!   value-free.
//! @ref LLP 0036#operations-and-projections-llp-0024 — the CLI reuses the
//!   ordinary admin-gated route, `source: cli`, and ConfigWriteOutcome.

use serde_json::Value;
use snapback::manifest::{ConfigEntryDefinition, FunctionManifest};
use std::io::{Read as _, Seek as _, Write as _};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

const ADMIN_TOKEN: &str = "phase4-config-set-admin";
const ENTRY: &str = "providerApiKey";

fn snapback() -> Command {
    Command::new(env!("CARGO_BIN_EXE_snapback"))
}

struct Server {
    child: Child,
    ready_file: std::path::PathBuf,
    url: String,
}

impl Server {
    fn start(directory: &std::path::Path, host: &str) -> Self {
        let ready_file = directory.join(format!("{}.ready.json", host.replace('.', "-")));
        let mut command = snapback();
        command
            .args([
                "start",
                "--host",
                host,
                "--port",
                "0",
                "--memory",
                "--ready-file",
            ])
            .arg(&ready_file)
            .env("SNAPBACK_ADMIN_TOKEN", ADMIN_TOKEN)
            .env("SNAPBACK_PROFILE", "test")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if host != "127.0.0.1" {
            command.arg("--allow-insecure-dev-auth");
        }
        let mut child = command.spawn().expect("spawn config-set server");
        let deadline = Instant::now() + Duration::from_secs(30);
        let ready = loop {
            if let Ok(bytes) = std::fs::read(&ready_file)
                && let Ok(ready) = serde_json::from_slice::<Value>(&bytes)
                && ready["ready"] == true
            {
                break ready;
            }
            if let Some(status) = child.try_wait().expect("poll config-set server") {
                let mut startup_output = String::new();
                child
                    .stdout
                    .take()
                    .unwrap()
                    .read_to_string(&mut startup_output)
                    .unwrap();
                child
                    .stderr
                    .take()
                    .unwrap()
                    .read_to_string(&mut startup_output)
                    .unwrap();
                panic!("config-set server exited before readiness: {status}\n{startup_output}");
            }
            assert!(Instant::now() < deadline, "config-set readiness timed out");
            std::thread::sleep(Duration::from_millis(25));
        };
        let advertised = ready["serverUrl"]
            .as_str()
            .expect("ready descriptor serverUrl");
        let url = advertised.replace("0.0.0.0", "127.0.0.1");
        Self {
            child,
            ready_file,
            url,
        }
    }

    fn install_config_declaration(&self, directory: &std::path::Path) {
        let manifest_path = directory.join("functions.manifest.json");
        let manifest = FunctionManifest {
            config: vec![ConfigEntryDefinition {
                name: ENTRY.to_owned(),
                description: Some("Phase 4 carrier fixture".to_owned()),
                purpose: None,
                secret: true,
                required: true,
                pool: false,
                probe: None,
                how_to_get: None,
                acquisition: None,
                default: None,
                source_span: None,
            }],
            ..FunctionManifest::default()
        };
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .expect("write config manifest");
        let output = snapback()
            .args(["load", "--functions"])
            .arg(&manifest_path)
            .args(["--url", &self.url, "--token", ADMIN_TOKEN])
            .env_remove("SNAPBACK_ADMIN_TOKEN")
            .output()
            .expect("load config declaration");
        assert!(output.status.success(), "config declaration load failed");
    }

    fn finish(mut self) -> String {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let mut logs = String::new();
        if let Some(mut stdout) = self.child.stdout.take() {
            stdout.read_to_string(&mut logs).unwrap();
        }
        if let Some(mut stderr) = self.child.stderr.take() {
            stderr.read_to_string(&mut logs).unwrap();
        }
        logs.push_str(&String::from_utf8_lossy(
            &std::fs::read(&self.ready_file).unwrap_or_default(),
        ));
        logs
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn secret(label: &str) -> String {
    format!("phase4-{label}-{}", uuid::Uuid::new_v4().simple())
}

fn combined(output: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn assert_absent(haystack: &str, value: &str, channel: &str) {
    assert!(
        !haystack.contains(value),
        "{channel} contained protected config value"
    );
}

fn config_set_stdin(url: &str, token: &str, value: &[u8], append: bool) -> Output {
    let mut command = snapback();
    command
        .args(["config", "set", "--entry", ENTRY, "--value-stdin"])
        .args(["--url", url, "--token", token])
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if append {
        command.arg("--append");
    }
    let mut child = command.spawn().expect("spawn stdin config set");
    child
        .stdin
        .take()
        .expect("config-set stdin")
        .write_all(value)
        .expect("write config-set stdin");
    child.wait_with_output().expect("wait stdin config set")
}

#[cfg(unix)]
fn config_set_fd(url: &str, value: &[u8]) -> Output {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::process::CommandExt as _;

    const CHILD_FD: i32 = 198;
    let mut carrier = tempfile::tempfile().expect("config-set fd carrier");
    carrier.write_all(value).expect("write fd carrier");
    carrier.rewind().expect("rewind fd carrier");
    let source_fd = carrier.as_raw_fd();
    let mut command = snapback();
    command
        .args([
            "config",
            "set",
            "--entry",
            ENTRY,
            "--value-fd",
            "198",
            "--url",
            url,
            "--token",
            ADMIN_TOKEN,
        ])
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // SAFETY: the closure performs only dup2 between two live descriptors in
    // the post-fork child. CHILD_FD is then inherited across exec and the
    // parent retains ownership of source_fd.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(source_fd, CHILD_FD) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command.output().expect("run fd config set")
}

fn value_free_observation(url: &str) -> String {
    let status = snapback()
        .args(["config", "status", "--url", url, "--token", ADMIN_TOKEN])
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .expect("config status");
    assert!(status.status.success(), "config status failed");
    let inspect = snapback()
        .args(["inspect", "--url", url, "--token", ADMIN_TOKEN])
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .expect("admin inspect");
    assert!(inspect.status.success(), "admin inspect failed");
    format!("{}{}", combined(&status), combined(&inspect))
}

#[test]
fn config_set_stdin_and_fd_never_leak_on_success_or_refusal() {
    let parser_attack_value = secret("unexpected-argv");
    let parser_refusal = snapback()
        .args([
            "config",
            "set",
            "--entry",
            ENTRY,
            "--value",
            &parser_attack_value,
        ])
        .output()
        .expect("run config-set parser refusal");
    assert!(!parser_refusal.status.success());
    let parser_output = combined(&parser_refusal);
    assert!(parser_output.contains("SNAPBACK_CONFIG_SET_USAGE_INVALID"));
    assert_absent(
        &parser_output,
        &parser_attack_value,
        "config-set parse refusal",
    );

    let directory = tempfile::tempdir().expect("config-set fixture");
    let loopback = Server::start(directory.path(), "127.0.0.1");
    loopback.install_config_declaration(directory.path());

    let stdin_value = secret("stdin-success");
    let stdin = config_set_stdin(&loopback.url, ADMIN_TOKEN, stdin_value.as_bytes(), false);
    assert!(stdin.status.success(), "stdin config set failed");
    let stdin_receipt = combined(&stdin);
    assert_absent(&stdin_receipt, &stdin_value, "stdin success receipt");
    let receipt: Value = serde_json::from_slice(&stdin.stdout).expect("typed config write receipt");
    assert_eq!(receipt["entry"], ENTRY);
    assert_eq!(receipt["applyState"], "applied");
    assert_eq!(receipt["valueChanged"], true);

    #[cfg(unix)]
    let fd_value = {
        let fd_value = secret("fd-success");
        let fd = config_set_fd(&loopback.url, fd_value.as_bytes());
        assert!(fd.status.success(), "fd config set failed");
        assert_absent(&combined(&fd), &fd_value, "fd success receipt");
        fd_value
    };

    let invalid_value = secret("schema-invalid");
    let invalid = config_set_stdin(&loopback.url, ADMIN_TOKEN, invalid_value.as_bytes(), true);
    assert!(
        !invalid.status.success(),
        "non-pool append unexpectedly succeeded"
    );
    let invalid_output = combined(&invalid);
    assert!(invalid_output.contains("SNAPBACK_CONFIG_VALUE_INVALID"));
    assert_absent(&invalid_output, &invalid_value, "schema-invalid refusal");

    let bad_credential_value = secret("bad-credential");
    let bad_credential = config_set_stdin(
        &loopback.url,
        "wrong-admin-token",
        bad_credential_value.as_bytes(),
        false,
    );
    assert!(
        !bad_credential.status.success(),
        "bad credential unexpectedly succeeded"
    );
    assert_absent(
        &combined(&bad_credential),
        &bad_credential_value,
        "bad-credential refusal",
    );

    let observation = value_free_observation(&loopback.url);
    for value in [&stdin_value, &invalid_value, &bad_credential_value] {
        assert_absent(&observation, value, "status/inspect observation");
    }
    #[cfg(unix)]
    assert_absent(&observation, &fd_value, "status/inspect observation");

    let loopback_logs = loopback.finish();
    for value in [&stdin_value, &invalid_value, &bad_credential_value] {
        assert_absent(&loopback_logs, value, "loopback server logs/ready receipt");
    }
    #[cfg(unix)]
    assert_absent(
        &loopback_logs,
        &fd_value,
        "loopback server logs/ready receipt",
    );

    let exposed = Server::start(directory.path(), "0.0.0.0");
    exposed.install_config_declaration(directory.path());
    let refused_value = secret("transit-refused");
    let refused = config_set_stdin(&exposed.url, ADMIN_TOKEN, refused_value.as_bytes(), false);
    assert!(
        !refused.status.success(),
        "non-loopback value write unexpectedly succeeded"
    );
    let refused_output = combined(&refused);
    assert!(refused_output.contains("SNAPBACK_CONFIG_TRANSIT_RULE"));
    assert_absent(&refused_output, &refused_value, "transit-rule refusal");
    assert_absent(
        &value_free_observation(&exposed.url),
        &refused_value,
        "refused-target observation",
    );
    assert_absent(
        &exposed.finish(),
        &refused_value,
        "refused-target server logs/ready receipt",
    );
}
