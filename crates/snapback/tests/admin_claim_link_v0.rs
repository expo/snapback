//! Black-box planted-link proof for LLP 0017's terminal-to-browser handoff.

use serde_json::{Value, json};
use std::io::{BufRead as _, BufReader, Read as _};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn snapback() -> Command {
    Command::new(env!("CARGO_BIN_EXE_snapback"))
}

fn wait_for_ready(child: &mut Child, path: &std::path::Path) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Ok(text) = std::fs::read_to_string(path)
            && let Ok(value) = serde_json::from_str::<Value>(&text)
            && value["ready"] == true
        {
            return value;
        }
        if let Some(status) = child.try_wait().expect("poll snapback server") {
            panic!("snapback server exited before readiness: {status}");
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let mut stdout = String::new();
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stdout.take() {
                let _ = pipe.read_to_string(&mut stdout);
            }
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            panic!("snapback readiness timeout\nstdout:\n{stdout}\nstderr:\n{stderr}");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn claim_code(link: &str) -> &str {
    let (base, code) = link
        .trim()
        .split_once("#claim=")
        .expect("claim link fragment");
    assert!(base.ends_with("/_snapback/admin/"));
    assert!(!base.contains('?'), "claim must not enter an HTTP query");
    assert!(code.starts_with("sbcl_"));
    assert!(!code.contains(['?', '&', '/']));
    code
}

fn post_json(
    url: &str,
    body: Value,
    header: Option<(&str, &str)>,
) -> (u16, String, Option<String>) {
    let mut request = ureq::post(url);
    if let Some((name, value)) = header {
        request = request.set(name, value);
    }
    match request.send_json(body) {
        Ok(response) => {
            let status = response.status();
            let cache = response.header("cache-control").map(ToOwned::to_owned);
            let body = response.into_string().expect("read JSON response");
            (status, body, cache)
        }
        Err(ureq::Error::Status(status, response)) => {
            let cache = response.header("cache-control").map(ToOwned::to_owned);
            let body = response.into_string().expect("read diagnostic response");
            (status, body, cache)
        }
        Err(error) => panic!("HTTP request failed: {error}"),
    }
}

#[test]
fn planted_claim_link_redeems_once_and_attached_cli_reports_it() {
    let temp = tempfile::tempdir().expect("claim-link tempdir");
    let ready_file = temp.path().join("ready.json");
    let mut server = snapback()
        .args([
            "start",
            "--port",
            "0",
            "--memory",
            "--ready-file",
            ready_file.to_str().expect("UTF-8 ready path"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn snapback server");
    let ready = wait_for_ready(&mut server, &ready_file);
    let server_url = ready["serverUrl"].as_str().expect("server URL");

    let no_wait = snapback()
        .args([
            "admin",
            "link",
            "--no-wait",
            "--ready-file",
            ready_file.to_str().unwrap(),
        ])
        .output()
        .expect("mint no-wait claim link");
    assert!(
        no_wait.status.success(),
        "{}",
        String::from_utf8_lossy(&no_wait.stderr)
    );
    let link = String::from_utf8(no_wait.stdout).unwrap();
    let first_code = claim_code(&link).to_owned();
    let exchange_url = format!("{server_url}/_snapback/api/console/claim/exchange");
    assert!(!exchange_url.contains(&first_code));
    let (status, body, cache) = post_json(&exchange_url, json!({ "claimCode": first_code }), None);
    assert_eq!(status, 200);
    assert_eq!(cache.as_deref(), Some("no-store, private"));
    let exchanged: Value = serde_json::from_str(&body).unwrap();
    let credential = exchanged["credential"].as_str().unwrap();
    assert!(credential.starts_with("sbcc_"));
    assert_eq!(exchanged["provenance"], "operatorClaim");

    let (write_status, _, _) = post_json(
        &format!("{server_url}/_snapback/api/app/reset"),
        json!({}),
        Some(("x-snapback-console-credential", credential)),
    );
    assert_eq!(
        write_status, 200,
        "claim credential carries ordinary AdminWrite"
    );

    let (reused_status, reused_body, _) =
        post_json(&exchange_url, json!({ "claimCode": first_code }), None);
    let (invalid_status, invalid_body, _) = post_json(
        &exchange_url,
        json!({ "claimCode": "sbcl_00000000000000000000000000000000" }),
        None,
    );
    assert_eq!((reused_status, &reused_body), (401, &invalid_body));
    assert_eq!(invalid_status, 401);

    let status_output = snapback()
        .args([
            "admin",
            "link",
            "--status",
            &first_code,
            "--ready-file",
            ready_file.to_str().unwrap(),
        ])
        .output()
        .expect("reattach to claim status");
    assert!(status_output.status.success());
    let status_text = String::from_utf8(status_output.stdout).unwrap();
    let status_error = String::from_utf8(status_output.stderr).unwrap();
    assert!(status_text.contains("claim redeemed at"), "{status_text}");
    assert!(
        status_text.contains("directTransport peer"),
        "{status_text}"
    );
    assert!(
        !status_text.contains(credential) && !status_error.contains(credential),
        "status/resume output leaked the browser-only credential"
    );

    let revoke_output = snapback()
        .args([
            "admin",
            "link",
            "--revoke",
            &first_code,
            "--ready-file",
            ready_file.to_str().unwrap(),
        ])
        .output()
        .expect("revoke claim credential");
    assert!(revoke_output.status.success());
    assert!(
        String::from_utf8(revoke_output.stdout)
            .unwrap()
            .contains("revoked at")
    );
    let (revoked_status, _, _) = post_json(
        &format!("{server_url}/_snapback/api/app/reset"),
        json!({}),
        Some(("x-snapback-console-credential", credential)),
    );
    assert_eq!(revoked_status, 401);

    let mut attached = snapback()
        .args([
            "admin",
            "link",
            "--ready-file",
            ready_file.to_str().unwrap(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn attached claim CLI");
    let stdout = attached.stdout.take().unwrap();
    let (lines_tx, lines_rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if lines_tx.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let attached_link = lines_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("attached CLI flushes claim link");
    let attached_code = claim_code(&attached_link).to_owned();
    let (attached_exchange, attached_body, _) =
        post_json(&exchange_url, json!({ "claimCode": attached_code }), None);
    assert_eq!(attached_exchange, 200);
    let attached_exchange: Value = serde_json::from_str(&attached_body).unwrap();
    let attached_credential = attached_exchange["credential"].as_str().unwrap();
    assert!(attached_credential.starts_with("sbcc_"));
    let report = lines_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("attached CLI reports redemption");
    assert!(report.contains("claim redeemed at"), "{report}");
    assert!(
        !attached_link.contains(attached_credential) && !report.contains(attached_credential),
        "attached initiate/status output leaked the browser-only credential"
    );
    let attached_status = attached.wait().expect("wait attached CLI");
    assert!(attached_status.success());
    let mut attached_stderr = String::new();
    attached
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut attached_stderr)
        .unwrap();
    assert!(
        !attached_stderr.contains(attached_credential),
        "attached stderr leaked the browser-only credential"
    );
    reader.join().unwrap();

    server.kill().expect("stop snapback server");
    let _ = server.wait();
    let mut server_stdout = String::new();
    let mut server_stderr = String::new();
    server
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut server_stdout)
        .unwrap();
    server
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut server_stderr)
        .unwrap();
    for raw_code in [&first_code, &attached_code] {
        assert!(
            !server_stdout.contains(raw_code),
            "claim leaked to server stdout"
        );
        assert!(
            !server_stderr.contains(raw_code),
            "claim leaked to server stderr"
        );
    }
    for browser_credential in [credential, attached_credential] {
        assert!(
            !server_stdout.contains(browser_credential),
            "claim-derived credential leaked to server stdout"
        );
        assert!(
            !server_stderr.contains(browser_credential),
            "claim-derived credential leaked to server stderr"
        );
        assert!(
            !std::fs::read_to_string(&ready_file)
                .unwrap_or_default()
                .contains(browser_credential),
            "claim-derived credential leaked to the ready receipt"
        );
    }
}
