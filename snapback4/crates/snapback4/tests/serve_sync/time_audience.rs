use super::*;

// @ref LLP 3000.036.003#5 — a compact opening join may need paged snapshot recovery.
#[test]
fn a_timed_join_over_the_wire_limit_recovers_with_paged_snapshots() {
    let source = "use personas alice\ntable members:\n  group: text <=8\n  principal: principal\n  opensAt: time\n  unique group, principal\n  cap 1 by group\n  by byOpening: opensAt\n  read <- .principal = viewer\n  not before .opensAt\n  sync\ntable documents:\n  group: text <=8\n  body: text <=4000\n  read <- exists members[.group, viewer]\n  sync\n";
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), source);
    let opening = host.shared.now() + 10_000;
    let count = 5_000;
    {
        let mut engine = lock(&host.shared.engine);
        let definition = &engine.schema().tables["documents"];
        let body = "x".repeat(4_000);
        let mut rows: Vec<_> = (0..count).map(|n| ("documents".into(),
            snapback4_core::wire::row_from_json(definition,
                &json!({"id":format!("d{n:05}"),"group":"g","body":body})).unwrap())).collect();
        rows.push(("members".into(), snapback4_core::wire::row_from_json(
            &engine.schema().tables["members"],
            &json!({"id":"m","group":"g","principal":"dev:alice","opensAt":opening})).unwrap()));
        engine.load(rows).unwrap();
    }
    let before = response_json(&host.request("POST", "/sync", PERSONA, r#"{"limit":1}"#));
    assert!(before["events"].as_array().unwrap().is_empty(), "future authority stays absent");
    let watermark = before["watermark"].as_u64().unwrap();
    host.request("POST", "/dev/clock/advance", "", r#"{"duration":"11s"}"#);
    let overflow = response_json(&host.request("POST", "/sync", PERSONA,
        &json!({"stream":true,"from":watermark,"limit":1}).to_string()));
    assert_eq!(overflow["denied"]["code"], "E_BOUND", "{overflow}");
    assert_eq!(overflow["snapshot"], true, "an indivisible acquisition names snapshot recovery");
    assert_eq!(overflow["watermark"], watermark, "a refused acquisition cannot advance the device");
    assert!(overflow["generation"].is_number() && overflow["store_id"].is_string(), "repair keeps sync identity: {overflow}");
    assert!(overflow.get("events").is_none(), "no partial acquisition may publish");
    assert!(overflow.to_string().len() < 4_096);

    let mut after = Json::Null;
    let mut ids = std::collections::BTreeSet::new();
    let mut pages = 0;
    loop {
        let page = response_json(&host.request("POST", "/sync", PERSONA,
            &json!({"from":0,"stream":false,"limit":1_000,"after":after}).to_string()));
        assert!(page.get("denied").is_none(), "{page}");
        for event in page["events"].as_array().unwrap() {
            if event["table"] == "documents" {
                assert!(ids.insert(event["id"].as_str().unwrap().to_owned()));
                assert_eq!(event["data"]["body"].as_str().unwrap().len(), 4_000);
            }
        }
        pages += 1;
        assert!(pages <= 7, "snapshot must make bounded progress");
        if page["more"] == false { break; }
        after = page["next"].clone();
        assert!(after.is_string());
    }
    assert_eq!(ids.len(), count);
    assert!(pages > 1);
}

fn response_json(response: &str) -> Json {
    let (headers, mut wire) = response.split_once("\r\n\r\n").unwrap();
    if !headers.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        return serde_json::from_str(wire).unwrap();
    }
    let mut bytes = Vec::new();
    loop {
        let (length, rest) = wire.split_once("\r\n").unwrap();
        let length = usize::from_str_radix(length.split(';').next().unwrap(), 16).unwrap();
        if length == 0 { break; }
        bytes.extend_from_slice(&rest.as_bytes()[..length]);
        wire = &rest[length + 2..];
    }
    serde_json::from_slice(&bytes).unwrap()
}
