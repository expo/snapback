//! `POST /dev/reset`: per-test isolation against one running dev.
use super::*;

const SOURCE: &str = "use personas alice, bob
table lists:
  owner: principal
  title: text <=40
  photo: image <=10000000 ?
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  sync to .owner
table items:
  list: lists
  n: sequence by list
  text: text <=40
  unique list, text
  read through .list
  insert <- .list.owner = viewer
view itemCount: count items by .list
mutation addList(id: id, title: text <=40):
  return insert lists { id, owner: viewer, title, photo: null }
mutation addItem(list: lists, text: text <=40):
  return insert items { list, text }
mutation setPhoto(list: lists, photo: image <=10000000 ?):
  update lists[list] { photo }
query mine():
  return lists where .owner = viewer first 100
query count(list: lists):
  return itemCount[list]
";
const ALICE: &str = "x-snapback-persona: alice\r\n";

fn hosts() -> Vec<(Host, Option<ReaderTestDirectory>)> {
    let directory = ReaderTestDirectory::new();
    let file = snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap();
    vec![
        (Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE), None),
        (Host::with_store(true, file, SOURCE), Some(directory)),
    ]
}

fn post(host: &Host, path: &str, headers: &str, payload: Json) -> Json {
    let reply = host.request("POST", path, headers, &payload.to_string());
    assert_eq!(status(&reply), 200, "{path}: {reply}");
    body(&reply)
}

fn reset(host: &Host, payload: &str) -> Json {
    let reply = host.request("POST", "/dev/reset", "", payload);
    assert_eq!(status(&reply), 200, "{reply}");
    body(&reply)
}

fn list_row(id: &str, title: &str) -> Json {
    json!({"table": "lists", "row": {"id": id, "owner": "dev:alice", "title": title}})
}

fn upload(host: &Host) -> String {
    let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let mut wire = format!("POST /assets HTTP/1.1\r\nHost: localhost\r\n{ALICE}Connection: close\r\nContent-Length: {}\r\n\r\n", png.len()).into_bytes();
    wire.extend_from_slice(png);
    let reply = exchange_bytes(host.address, &wire);
    assert_eq!(status(&reply), 200, "{reply}");
    body(&reply)["asset"]["id"].as_str().unwrap().to_owned()
}

fn titles(host: &Host) -> Vec<Json> {
    post(host, "/q/mine", ALICE, json!({"args": {}}))["data"].as_array().unwrap().iter().map(|row| row["title"].clone()).collect()
}

#[test]
fn reset_empties_rows_views_sequences_and_assets_under_a_new_identity() {
    for (host, _directory) in hosts() {
        assert_eq!(post(&host, "/m/addList", ALICE, json!({"id": "w1", "args": {"id": "L1", "title": "Home"}}))["state"], "sent");
        for text in ["a", "b"] { post(&host, "/m/addItem", ALICE, json!({"args": {"list": "L1", "text": text}})); }
        let asset = upload(&host);
        assert_eq!(post(&host, "/m/setPhoto", ALICE, json!({"args": {"list": "L1", "photo": {"id": asset}}}))["state"], "sent");
        let path = lock(&host.shared.engine).store().asset_path(&asset);
        assert!(path.exists());
        assert_eq!(post(&host, "/q/count", ALICE, json!({"args": {"list": "L1"}}))["data"], 2);
        let before = body(&host.request("GET", "/dev/status", "", ""));
        let previous = body(&host.request("GET", "/probe", ALICE, ""))["store_id"].clone();
        let head = lock(&host.shared.engine).seq().unwrap();

        let reply = reset(&host, "");
        assert_eq!(reply["reset"], true, "{reply}");
        assert_eq!(reply["seeded"], 0);
        assert_eq!(reply["previousStoreId"], previous);
        assert_ne!(reply["storeId"], previous, "{reply}");
        assert_eq!(reply["generation"], before["generation"], "the schema generation is unchanged");
        assert_eq!(reply["head"], head + 1, "the head keeps counting: the reset is a commit");
        assert_eq!(reply["assetsRemoved"], 1);
        assert!(!path.exists(), "the asset's bytes are gone");
        let status_after = body(&host.request("GET", "/dev/status", "", ""));
        assert_eq!(status_after["storeId"], reply["storeId"]);
        assert_eq!(body(&host.request("GET", "/probe", ALICE, ""))["store_id"], reply["storeId"]);

        assert_eq!(titles(&host), Vec::<Json>::new());
        // The view, the unique key and the sequence restart with the rows.
        assert_eq!(post(&host, "/m/addList", ALICE, json!({"id": "w1", "args": {"id": "L1", "title": "Again"}}))["state"], "sent",
            "an old write id is not replayed after a reset");
        assert_eq!(post(&host, "/q/count", ALICE, json!({"args": {"list": "L1"}}))["data"], 0);
        assert_eq!(post(&host, "/m/addItem", ALICE, json!({"args": {"list": "L1", "text": "a"}}))["result"]["n"], 1);
        assert_eq!(post(&host, "/q/count", ALICE, json!({"args": {"list": "L1"}}))["data"], 1);
        let missing = host.request("GET", &format!("/assets/{asset}"), ALICE, "");
        assert_eq!(status(&missing), 404, "{missing}");
        assert!(reply["ms"].as_u64().unwrap() < 1000, "{reply}");
    }
}

#[test]
fn reset_reseeds_in_the_same_transaction_and_a_refused_row_keeps_the_store() {
    for (host, _directory) in hosts() {
        assert_eq!(body(&host.request("POST", "/seed", "", &json!([list_row("L1", "Old")]).to_string()))["seeded"], 1);
        let reply = reset(&host, &json!([list_row("L2", "Array")]).to_string());
        assert_eq!(reply["seeded"], 1, "{reply}");
        assert_eq!(titles(&host), [json!("Array")]);
        let reply = reset(&host, &json!({"seed": [list_row("L3", "Object"), list_row("L4", "Second")]}).to_string());
        assert_eq!(reply["seeded"], 2, "{reply}");
        assert_eq!(titles(&host), [json!("Object"), json!("Second")]);

        // The seed is checked before anything is emptied, as /seed checks it.
        let identity = body(&host.request("GET", "/dev/status", "", ""))["storeId"].clone();
        for (payload, code) in [
            (json!([{"table": "nope", "row": {"id": "x"}}]).to_string(), "E_INPUT"),
            (json!([{"table": "lists", "row": {"title": "no id", "owner": "dev:alice"}}]).to_string(), "E_FIELD"),
            (json!({"seed": [], "extra": 1}).to_string(), "E_INPUT"),
            (json!({"clock": "rewind"}).to_string(), "E_CLOCK_INPUT"),
            ("not json".to_owned(), "E_INPUT"),
        ] {
            let refused = host.request("POST", "/dev/reset", "", &payload);
            assert_eq!(status(&refused), 400, "{payload}: {refused}");
            assert_eq!(body(&refused)["denied"]["code"], code, "{payload}: {refused}");
        }
        // A row the engine refuses rolls the whole reset back.
        let item = |id: &str| json!({"table": "items", "row": {"id": id, "list": "L3", "text": "same"}});
        let refused = reset(&host, &json!([list_row("L3", "Object"), item("I1"), item("I2")]).to_string());
        assert!(refused["denied"]["code"].is_string(), "{refused}");
        assert_eq!(body(&host.request("GET", "/dev/status", "", ""))["storeId"], identity, "nothing was reset");
        assert_eq!(titles(&host), [json!("Object"), json!("Second")]);
    }
}

#[test]
fn a_held_change_poll_and_a_device_sync_see_the_new_store() {
    for (host, _directory) in hosts() {
        assert_eq!(body(&host.request("POST", "/seed", "", &json!([list_row("L1", "Old")]).to_string()))["seeded"], 1);
        let sync = |payload: Json| post(&host, "/sync", ALICE, payload);
        let first = sync(json!({"from": 0, "limit": 100}));
        let (old, watermark) = (first["store_id"].clone(), first["watermark"].as_u64().unwrap());
        assert!(first.to_string().contains("\"L1\""), "{first}");

        let held = {
            let (address, old) = (host.address, old.clone());
            thread::spawn(move || exchange_held(address, Duration::from_secs(10),
                format!("GET /changes?since={watermark}&wait=25&store_id={} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{ALICE}\r\n", old.as_str().unwrap())))
        };
        thread::sleep(Duration::from_millis(200));
        let started = Instant::now();
        let reply = reset(&host, &json!([list_row("L2", "New")]).to_string());
        let polled = held.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5), "the held poll returned at the reset, not its deadline");
        let polled = body(&polled);
        assert_eq!(polled["store_id"], reply["storeId"], "{polled}");

        // A device following the old store learns the new identity and re-acquires from a snapshot.
        let stream = sync(json!({"from": watermark, "limit": 100, "stream": true, "store_id": old}));
        assert_eq!(stream["store_id"], reply["storeId"], "{stream}");
        let snapshot = sync(json!({"from": 0, "limit": 100, "store_id": reply["storeId"]}));
        assert_eq!(snapshot["store_id"], reply["storeId"]);
        assert!(snapshot.to_string().contains("\"L2\"") && !snapshot.to_string().contains("\"L1\""), "{snapshot}");
        // An online write still bound to the old store is refused, not applied to the new one.
        let stale = post(&host, "/m/addList", ALICE, json!({"id": "stale", "args": {"id": "L9", "title": "Late"}, "store_id": old}));
        assert_eq!(stale["why"]["code"], "E_STORE_REPLACED", "{stale}");
        assert_eq!(titles(&host), [json!("New")]);
    }
}

#[test]
fn reset_keeps_the_dev_clock_unless_asked() {
    let (host, _directory) = hosts().remove(0);
    let advanced = post(&host, "/dev/clock/advance", "", json!({"duration": "+2h"}));
    assert!(advanced["offsetMs"].as_i64().unwrap() >= 7_200_000 - 1000, "{advanced}");
    let kept = reset(&host, "{}");
    assert!(kept["clockOffsetMs"].as_i64().unwrap() >= 7_200_000 - 1000, "{kept}");
    let back = reset(&host, r#"{"clock":"reset"}"#);
    assert!(back["clockOffsetMs"].as_i64().unwrap().abs() < 1000, "{back}");
    assert!(body(&host.request("GET", "/dev/status", "", ""))["clockOffsetMs"].as_i64().unwrap().abs() < 1000);
}

#[test]
fn accounts_and_sessions_are_reset_but_personas_keep_working() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), super::SCHEMA);
    let guest = body(&host.request("POST", "/auth/guest", "", "{}"));
    let bearer = format!("Authorization: Bearer {}\r\n", guest["session"]["token"].as_str().unwrap());
    assert_eq!(status(&host.request("POST", "/q/who", &bearer, r#"{"args":{}}"#)), 200);
    reset(&host, "");
    let refused = host.request("POST", "/q/who", &bearer, r#"{"args":{}}"#);
    assert_eq!(status(&refused), 401, "the guest account is gone: {refused}");
    assert_eq!(post(&host, "/q/who", ALICE, json!({"args": {}}))["data"], "dev:alice");
}

#[test]
fn release_and_foreign_origins_cannot_reset() {
    let release = Host::with_store(false, snapback4_core::Store::memory().unwrap(), SOURCE);
    let refused = release.request("POST", "/dev/reset", "", "");
    assert_eq!(status(&refused), 403, "{refused}");
    assert_eq!(body(&refused)["denied"]["code"], "E_AUTH");
    let dev = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    for headers in ["Origin: https://attacker.example\r\n", "Origin: null\r\n"] {
        assert_eq!(status(&dev.request("POST", "/dev/reset", headers, "")), 403, "{headers}");
    }
    let rebound = exchange(dev.address, "POST /dev/reset HTTP/1.1\r\nHost: attacker.example\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    assert_eq!(status(&rebound), 403, "{rebound}");
    assert_eq!(status(&dev.request("POST", "/dev/reset", "Origin: http://localhost:5173\r\n", "")), 200);
}
