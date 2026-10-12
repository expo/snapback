use super::*;

const SOURCE: &str = r#"
use personas alice, bob, mallory
use server
table posts:
  owner: principal
  recipient: principal
  photos: [image <=10000000] <=4
  read <- .recipient = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
mutation post(photos: [image <=10000000] <=4):
  return insert posts { owner: viewer, recipient: 'dev:bob', photos }
mutation edit(post: posts, photos: [image <=10000000] <=4):
  update posts[post] { photos }
mutation remove(post: posts):
  delete posts[post]
"#;

fn upload(host: &Host) -> Json {
    let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let mut wire = format!("POST /assets HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\nContent-Length: {}\r\n\r\n", png.len()).into_bytes();
    wire.extend_from_slice(png);
    let reply = exchange_bytes(host.address, &wire);
    assert_eq!(status(&reply), 200, "{reply}");
    let asset = body(&reply)["asset"].clone();
    assert!(asset["id"].is_string(), "{reply}");
    json!({ "id": asset["id"] })
}

fn mutate(host: &Host, op: &str, args: Json) -> Json {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let write_id = format!("asset-list-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let reply = body(&host.request("POST", &format!("/m/{op}"), "x-snapback-persona: alice\r\n", &json!({"id":write_id,"args":args}).to_string()));
    assert_eq!(reply["state"], "sent", "{op}: {reply}");
    reply["result"].clone()
}

fn fetch(host: &Host, asset: &Json, who: &str, expected: u16) {
    let reply = host.request("GET", &format!("/assets/{}", asset["id"].as_str().unwrap()), &format!("x-snapback-persona: {who}\r\n"), "");
    assert_eq!(status(&reply), expected, "{who}: {reply}");
    if expected == 404 { assert_eq!(body(&reply)["denied"]["code"], "E_ASSET_UNKNOWN"); }
    if expected == 410 { assert_eq!(body(&reply)["denied"]["code"], "E_ASSET_VIEWED"); }
    if expected == 200 { assert!(reply.to_ascii_lowercase().contains("content-type: image/png"), "{reply}"); }
}

#[test]
fn image_list_http_placement_reorder_removal_and_delete() { lifecycle(SOURCE); }

#[test]
fn image_list_http_regression_with_scalar_upload_admission() {
    lifecycle(&SOURCE.replace("  photos:", "  scalar: image <=10000000 ?\n  photos:"));
}

fn lifecycle(source: &str) {
    // No scalar asset column: upload admission must see the list's element kind.
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), source);
    let (a, b) = (upload(&host), upload(&host));
    let row = mutate(&host, "post", json!({ "photos": [a, b] }));
    for asset in [&a, &b] { fetch(&host, asset, "bob", 200); fetch(&host, asset, "mallory", 404); }
    let id = row["id"].clone();
    mutate(&host, "edit", json!({"post":id,"photos":[b,a]}));
    for asset in [&a, &b] { fetch(&host, asset, "bob", 200); }
    mutate(&host, "edit", json!({"post":id,"photos":[b]}));
    fetch(&host, &a, "bob", 404);
    fetch(&host, &a, "alice", 404); // released, no longer the uploader's preview
    fetch(&host, &b, "bob", 200);
    mutate(&host, "remove", json!({"post":id}));
    for asset in [&a, &b] { fetch(&host, asset, "bob", 404); }
    // Separate two-element row proves delete releases both in one change.
    let (c, d) = (upload(&host), upload(&host));
    let row = mutate(&host, "post", json!({"photos":[c,d]}));
    mutate(&host, "remove", json!({"post":row["id"]}));
    for asset in [&c, &d] { fetch(&host, asset, "bob", 404); fetch(&host, asset, "alice", 404); }
}

#[test]
fn image_list_http_once_is_per_element_and_survives_reorder() {
    let source = SOURCE.replace("photos: [image <=10000000] <=4\n  read", "photos: [image <=10000000 once] <=4\n  read");
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    let (a, b) = (upload(&host), upload(&host));
    let row = mutate(&host, "post", json!({"photos":[a,b]}));
    fetch(&host, &a, "mallory", 404);
    let range = host.request("GET", &format!("/assets/{}", a["id"].as_str().unwrap()), "x-snapback-persona: bob\r\nRange: bytes=0-1\r\n", "");
    assert_eq!(status(&range), 416);
    assert_eq!(body(&range)["denied"]["code"], "E_ASSET_RANGE");
    fetch(&host, &a, "bob", 200);
    mutate(&host, "edit", json!({"post":row["id"],"photos":[b,a]}));
    fetch(&host, &a, "bob", 410);
    fetch(&host, &b, "bob", 200);
    fetch(&host, &b, "bob", 410);
}

mod files;
