use super::*;

impl Host {
    fn raw(&self, method: &str, path: &str, persona: &str, body: &[u8]) -> (u16, Vec<u8>) {
        let mut socket = TcpStream::connect(&self.address).unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(15))).unwrap();
        write!(socket, "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: {persona}\r\nContent-Length: {}\r\n\r\n", body.len()).unwrap();
        socket.write_all(body).unwrap();
        let mut reply = Vec::new(); socket.read_to_end(&mut reply).unwrap();
        let end = reply.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let status = std::str::from_utf8(&reply[..end]).unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, reply[end + 4..].to_vec())
    }
}

fn why(project: &Project) -> Value {
    let output = project.why(&[]);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}
fn last(envelope: &Value) -> &Value { envelope["records"].as_array().unwrap().last().unwrap() }

#[test]
fn owner_only_asset_refusal_replaces_an_earlier_mutation_cause() {
    let project = Project::new();
    let source = format!("{}\ntable photos:\n  owner: principal\n  photo: image <=1000\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation photo(photo: image <=1000):\n  return insert photos {{owner: viewer, photo}}\n", SOURCE.replace("personas alice", "personas alice, bob"));
    fs::write(project.0.join("snapback/schema.q"), source).unwrap();
    let dev = Host::start(project, true, false);
    let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let (status, bytes) = dev.raw("POST", "/assets", "alice", png);
    assert_eq!(status, 200);
    let upload: Value = serde_json::from_slice(&bytes).unwrap();
    let id = upload["asset"]["id"].as_str().unwrap();
    let placed = dev.post("/m/photo", json!({"args":{"photo":{"id":id}}}));
    assert_eq!(placed["state"], "sent", "{placed}");
    let path = format!("/assets/{id}");
    let owner = dev.raw("GET", &path, "alice", b"");
    assert_eq!(owner, (200, png.to_vec()));
    let previous = dev.refuse("add");
    let store = previous["store_id"].as_str().unwrap();
    let before = dev.project.wait_record(store, "add");
    assert_eq!(last(&before)["clause"], "insert rule");
    let (status, bytes) = dev.raw("GET", &path, "bob", b"");
    assert_eq!(status, 404);
    let denied: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(denied["denied"]["code"], "E_ASSET_UNKNOWN");
    let after = dev.project.wait_record(store, &path);
    assert_eq!(last(&after)["code"], "E_ASSET_UNKNOWN");
    assert_eq!(last(&after)["clause"], "cause not instrumented");
    assert!(last(&after)["requestId"].as_u64() > last(&before)["requestId"].as_u64());
    assert!(last(&after)["responseSequence"].as_u64() > last(&before)["responseSequence"].as_u64());
    assert!(last(&after)["at"].as_i64() >= last(&before)["at"].as_i64());
    assert_eq!(why(&dev.project), after);
}

#[test]
fn scheduled_parked_job_replaces_an_earlier_request_in_the_same_stream() {
    let project = Project::new();
    fs::write(project.0.join("snapback/schema.q"), format!("{SOURCE}\njob refusingJob():\n  chunk row in rows first 10 by byId:\n    require false else NOT_FOUND\nschedule refusalSchedule every 1h: refusingJob\n")).unwrap();
    let dev = Host::start(project, true, false);
    assert_eq!(dev.post("/seed", json!([{"table":"rows","row":{"id":"row","owner":"dev:alice"}}]))["seeded"], 1);
    let previous = dev.refuse("add");
    let store = previous["store_id"].as_str().unwrap();
    let before = dev.project.wait_record(store, "add");
    let advanced = dev.post("/dev/clock/advance", json!({"duration":"+2h"}));
    assert_eq!(advanced["work"]["parked"], 1, "{advanced}");
    let after = dev.project.wait_record(store, "refusingJob");
    let record = last(&after);
    assert_eq!(record["code"], "NOT_FOUND");
    assert_eq!(record["clause"], "cause not instrumented");
    assert!(!record["jobId"].as_str().unwrap().is_empty());
    assert!(record["requestId"].is_null(), "a job is not the clock request");
    assert!(record["at"].as_i64() >= last(&before)["at"].as_i64());
    assert!(record["responseSequence"].as_u64() > last(&before)["responseSequence"].as_u64());
    assert_eq!(why(&dev.project), after);
    // A request after a job shares ordering, but retains its own identity.
    dev.refuse("add");
    let newest = dev.project.wait_record(store, "add");
    assert!(last(&newest)["responseSequence"].as_u64() > record["responseSequence"].as_u64());
    assert!(last(&newest)["jobId"].is_null());
    assert_eq!(why(&dev.project), newest);
}

#[test]
fn filtered_sync_and_reads_keep_the_named_timed_refusal_and_explain_scope() {
    let project = Project::new();
    let source = SOURCE.replace("personas alice", "personas alice, bob").replace("online only", "sync to .owner");
    fs::write(project.0.join("snapback/schema.q"), format!("{source}\nquery page():\n  return rows first 5 by .id\nquery point():\n  return rows['private']\n")).unwrap();
    let dev = Host::start(project, true, false);
    let seed = dev.post("/seed", json!([{"table":"rows","row":{"id":"private","owner":"dev:alice"}}]));
    assert_eq!(seed["seeded"], 1);
    let refused = dev.refuse("add");
    let before = dev.project.wait_record(refused["store_id"].as_str().unwrap(), "add");
    let request = last(&before)["requestId"].as_u64().unwrap();
    let at = last(&before)["at"].as_i64().unwrap();
    assert!(request > 0 && at > 0);
    let (status, bytes) = dev.raw("POST", "/sync", "bob", b"{}");
    assert_eq!(status, 200);
    let sync: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(sync["events"], json!([])); assert_eq!(sync["held"], json!({}));
    for op in ["page", "point"] {
        let (status, bytes) = dev.raw("POST", &format!("/q/{op}"), "bob", b"{}");
        assert_eq!(status, 200);
        let read: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(read["data"], if op == "page" { json!([]) } else { Value::Null });
    }
    let after = why(&dev.project);
    assert_eq!(after, before);
    assert_eq!(last(&after)["operation"], "add");
    assert_eq!(last(&after)["at"], at);
    assert_eq!(last(&after)["requestId"], request);
    let scope = after["scope"].as_str().unwrap();
    for text in ["mutations, queries, asset requests and jobs", "Visibility filtering in sync and reads is not recorded", "snapback4 why TABLE", "snapback4 guide rules", "Unix time in milliseconds"] {
        assert!(scope.contains(text), "{scope}");
    }
}

#[test]
fn composed_missing_row_replaces_a_known_refusal_with_explicit_unknown_cause() {
    let project = Project::new();
    fs::write(project.0.join("snapback/schema.q"), format!("{SOURCE}\nquery composed():\n  return {{outer: {{row: rows['absent']}}}}\n")).unwrap();
    let dev = Host::start_with(project, true, false, &["--trace-empty"]);
    let previous = dev.refuse("add");
    let store = previous["store_id"].as_str().unwrap();
    let before = dev.project.wait_record(store, "add");
    let reply = dev.post("/q/composed", json!({}));
    assert_eq!(reply["data"], json!({"outer":{"row":null}}));
    let after = dev.project.wait_record(store, "composed");
    let record = last(&after);
    assert_eq!(record["code"], "EMPTY_READ");
    assert_eq!(record["clause"], "cause not instrumented");
    assert!(record["site"].is_null());
    assert!(record["requestId"].as_u64() > last(&before)["requestId"].as_u64());
    assert!(record["at"].as_i64() >= last(&before)["at"].as_i64());
    assert_eq!(why(&dev.project), after);
}
