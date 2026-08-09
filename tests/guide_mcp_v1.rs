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
        json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/templates/list", "params": {} }),
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "resources/read",
            "params": { "uri": "snapback-guide://manifest" }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "resources/read",
            "params": { "uri": "snapback-guide://symbol/SnapbackClient.query" }
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
    assert_eq!(responses.len(), 5, "notification must have no response");
    assert_eq!(responses[0]["result"]["protocolVersion"], "2025-06-18");
    assert!(
        responses[0]["result"]["capabilities"]
            .get("tools")
            .is_none()
    );

    let manifest: Value = serde_json::from_str(
        responses[3]["result"]["contents"][0]["text"]
            .as_str()
            .unwrap(),
    )
    .expect("embedded guide manifest");
    let resources = responses[1]["result"]["resources"].as_array().unwrap();
    let mut expected_uris = vec![
        "snapback-guide://manifest".to_owned(),
        "snapback-guide://flat".to_owned(),
    ];
    expected_uris.extend(
        manifest["flatProjections"]["sections"]
            .as_object()
            .expect("embedded guide manifest section projections")
            .values()
            .filter_map(|projection| projection.get("uri").and_then(Value::as_str))
            .map(str::to_owned),
    );
    expected_uris.extend(
        manifest["pages"]
            .as_object()
            .expect("embedded guide manifest pages")
            .keys()
            .map(|id| format!("snapback-guide://page/{id}")),
    );
    expected_uris.extend(
        manifest["resources"]
            .as_object()
            .expect("embedded guide manifest resources")
            .values()
            .filter(|resource| {
                resource
                    .pointer("/projections/mcp")
                    .and_then(Value::as_bool)
                    == Some(true)
            })
            .filter_map(|resource| resource.get("uri").and_then(Value::as_str))
            .map(str::to_owned),
    );
    expected_uris.sort();
    let mut actual_uris = resources
        .iter()
        .filter_map(|resource| resource.get("uri").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    actual_uris.sort();
    assert_eq!(actual_uris, expected_uris, "manifest-derived MCP resources");
    assert!(
        actual_uris.contains(&"snapback-guide://reference/registry".to_owned()),
        "registry resource projection"
    );
    assert!(
        actual_uris.contains(&"snapback-guide://reference/diagnostics".to_owned()),
        "diagnostics registry resource projection"
    );
    assert_eq!(
        responses[2]["result"]["resourceTemplates"][0]["uriTemplate"],
        "snapback-guide://symbol/{name}{?slice}"
    );
    let identity = &responses[1]["result"]["_meta"];
    assert!(
        resources
            .iter()
            .all(|resource| resource["_meta"] == *identity)
    );
    assert_eq!(responses[2]["result"]["_meta"], *identity);
    assert_eq!(responses[3]["result"]["_meta"], *identity);
    assert_eq!(responses[3]["result"]["contents"][0]["_meta"], *identity);
    assert_eq!(responses[4]["result"]["_meta"], *identity);

    let lookup: Value = serde_json::from_str(
        responses[4]["result"]["contents"][0]["text"]
            .as_str()
            .unwrap(),
    )
    .expect("exact symbol lookup JSON");
    assert_eq!(lookup["schemaVersion"], "snapback.guide-symbol-lookup.v1");
    assert_eq!(lookup["match"], "member");
    assert_eq!(lookup["query"], "SnapbackClient.query");
    assert!(
        responses[4]["result"]["contents"][0]["text"]
            .as_str()
            .unwrap()
            .len()
            <= 16_384
    );

    assert_eq!(
        manifest["contentHash"],
        identity["snapback/guideContentHash"]
    );
    assert_eq!(
        manifest["buildIdentity"]["commit"],
        identity["snapback/buildCommit"]
    );
}
