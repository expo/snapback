use serde_json::{Value, json};
use std::io::Write as _;
use std::process::{Command, Stdio};

#[test]
fn cli_mcp_serves_manifest_derived_read_only_resources_with_one_identity() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_snapback"))
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn snapback mcp");
    let requests = [
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "acceptance", "version": "1" }
            }
        }),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/list", "params": {} }),
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "resources/read",
            "params": { "uri": "snapback-guide://manifest" }
        }),
    ];
    {
        let stdin = child.stdin.as_mut().expect("MCP stdin");
        for request in requests {
            serde_json::to_writer(&mut *stdin, &request).expect("encode request");
            stdin.write_all(b"\n").expect("terminate request");
        }
    }
    drop(child.stdin.take());
    let output = child.wait_with_output().expect("wait for MCP server");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty(), "MCP stderr was not empty");
    let responses = String::from_utf8(output.stdout)
        .expect("UTF-8 MCP stdout")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("JSON-RPC response"))
        .collect::<Vec<_>>();
    assert_eq!(responses.len(), 3, "notification must have no response");
    assert_eq!(responses[0]["result"]["protocolVersion"], "2025-06-18");
    assert!(
        responses[0]["result"]["capabilities"]
            .get("tools")
            .is_none()
    );

    let resources = responses[1]["result"]["resources"].as_array().unwrap();
    assert_eq!(resources.len(), 29, "manifest + flat + 27 pages");
    let identity = &responses[1]["result"]["_meta"];
    assert!(
        resources
            .iter()
            .all(|resource| resource["_meta"] == *identity)
    );
    assert_eq!(responses[2]["result"]["_meta"], *identity);
    assert_eq!(responses[2]["result"]["contents"][0]["_meta"], *identity);

    let manifest: Value = serde_json::from_str(
        responses[2]["result"]["contents"][0]["text"]
            .as_str()
            .unwrap(),
    )
    .expect("embedded guide manifest");
    assert_eq!(
        manifest["contentHash"],
        identity["snapback/guideContentHash"]
    );
    assert_eq!(
        manifest["buildIdentity"]["commit"],
        identity["snapback/buildCommit"]
    );
}
