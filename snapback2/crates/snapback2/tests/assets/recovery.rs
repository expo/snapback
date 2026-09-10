use super::*;

#[test]
fn recent_uploads_are_private_discoverable_after_restart_and_discardable_without_reset() {
    let root = fixture_root();
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let alice = ("X-Snapback-As", "alice");
    let bob = ("X-Snapback-As", "bob");
    let bytes = image_bytes("jpeg", 1, 1);
    let mut ids = Vec::new();
    for _ in 0..snapback2_core::STAGING_PER_PRINCIPAL_OBJECTS {
        ids.push(
            upload(port, alice, &bytes)["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let bob_photo = upload(port, bob, &bytes);
    let blocked = wire(port, "POST", "/api/upload", &[alice], &bytes);
    assert_eq!(blocked.status, 422);
    assert_eq!(blocked.json()["code"], "E_ASSET_TOO_LARGE");
    assert!(
        blocked.json()["message"]
            .as_str()
            .unwrap()
            .contains("20 / 20 objects")
    );
    assert!(
        blocked.json()["rewrite"]
            .as_str()
            .unwrap()
            .contains("discardUpload")
    );
    assert_ne!(wire(port, "GET", "/api/uploads", &[], &[]).status, 200);
    assert_ne!(
        json_request(
            port,
            "POST",
            "/api/uploads/discard",
            &[],
            json!({ "id": ids[0] })
        )
        .status,
        200
    );
    let bob_list = wire(port, "GET", "/api/uploads", &[bob], &[]).json();
    assert_eq!(bob_list["uploads"].as_array().unwrap().len(), 1);
    assert_eq!(bob_list["uploads"][0]["id"], bob_photo["id"]);
    assert_eq!(
        json_request(
            port,
            "POST",
            "/api/uploads/discard",
            &[bob],
            json!({ "id": ids[0] })
        )
        .json(),
        json!({ "discarded": false })
    );

    drop(owner);
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let listing = wire(port, "GET", "/api/uploads", &[alice], &[]).json();
    assert_eq!(listing["usage"]["objects"], 20);
    assert_eq!(listing["limits"]["objects"], 20);
    assert_eq!(listing["uploads"].as_array().unwrap().len(), 20);
    assert!(
        listing["uploads"]
            .as_array()
            .unwrap()
            .iter()
            .all(|upload| ids.contains(&upload["id"].as_str().unwrap().to_owned()))
    );
    for id in &ids {
        let response = json_request(
            port,
            "POST",
            "/api/uploads/discard",
            &[alice],
            json!({ "id": id }),
        );
        assert_eq!(response.status, 200);
        assert_eq!(response.json()["discarded"], true);
    }
    assert_eq!(
        wire(port, "GET", "/api/uploads", &[alice], &[]).json()["usage"]["objects"],
        0
    );
    let fresh = upload(port, alice, &bytes);
    assert!(!ids.contains(&fresh["id"].as_str().unwrap().to_owned()));
    assert_eq!(
        wire(port, "GET", "/api/uploads", &[bob], &[]).json()["uploads"][0]["id"],
        bob_photo["id"]
    );
    let claimed = mutation(port, bob, "media.keepPublic", json!({ "photo": bob_photo }));
    assert_eq!(claimed["state"], "committed");
    let refused = json_request(
        port,
        "POST",
        "/api/uploads/discard",
        &[bob],
        json!({ "id": bob_photo["id"] }),
    );
    assert_eq!(refused.json()["code"], "E_ASSET_IN_USE");
    assert_eq!(
        wire(
            port,
            "GET",
            &format!("/api/asset/{}", bob_photo["id"].as_str().unwrap()),
            &[bob],
            &[]
        )
        .status,
        200
    );
    // A second restart finishes the discarded tombstones, even before 24 hours.
    drop(owner);
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    assert_eq!(
        wire(port, "GET", "/api/uploads", &[alice], &[]).json()["usage"]["objects"],
        1
    );
    for id in &ids {
        assert!(!root.join(".snapback/blobs").join(id).exists());
    }
    drop(owner);
    fs::remove_dir_all(root).unwrap();
}

fn staging_bytes(root: &Path) -> u64 {
    fs::read_dir(root.join(".snapback/staging"))
        .unwrap()
        .map(|entry| entry.unwrap().metadata().unwrap().len())
        .sum()
}

#[test]
fn discarding_a_paused_body_closes_bytes_before_releasing_quota_and_prevents_late_writes() {
    let root = fixture_root();
    make_video_only(&root);
    for leaf in ["snapback/schema.q", "snapback/media.q"] {
        let path = root.join(leaf);
        fs::write(
            &path,
            fs::read_to_string(&path)
                .unwrap()
                .replace("50000000", "268435456"),
        )
        .unwrap();
    }
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let alice = ("X-Snapback-As", "alice");
    let mut sockets = Vec::new();
    for _ in 0..3 {
        let mut socket = TcpStream::connect(("127.0.0.1", port)).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(socket, "POST /api/upload HTTP/1.1\r\nHost: localhost\r\nX-Snapback-As: alice\r\nContent-Length: 268435456\r\nConnection: close\r\n\r\n").unwrap();
        // A supported ftyp followed by a partial body. Finalization is never
        // reached, so the fixture need not contain a complete encoded video.
        let mut prefix = vec![0_u8; 1024 * 1024];
        prefix[..24].copy_from_slice(b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42");
        socket.write_all(&prefix).unwrap();
        socket.flush().unwrap();
        wait_for(Duration::from_secs(5), || {
            (staging_bytes(&root) >= prefix.len() as u64).then_some(())
        });
        let listed = wire(port, "GET", "/api/uploads", &[alice], &[]).json();
        assert_eq!(listed["usage"]["bytes"], 268435456_u64);
        let id = listed["uploads"][0]["id"].as_str().unwrap();
        let blocked = wire(
            port,
            "POST",
            "/api/upload",
            &[alice, ("Content-Length", "268435456")],
            &[],
        );
        assert_eq!(blocked.status, 422);
        assert_eq!(blocked.json()["code"], "E_ASSET_TOO_LARGE");
        let disposed = json_request(
            port,
            "POST",
            "/api/uploads/discard",
            &[alice],
            json!({ "id": id }),
        );
        assert_eq!(disposed.status, 200);
        assert_eq!(
            staging_bytes(&root),
            0,
            "closed/unlinked before quota is released"
        );
        assert_eq!(
            wire(port, "GET", "/api/uploads", &[alice], &[]).json()["usage"]["bytes"],
            0
        );
        sockets.push(socket);
    }
    // All three old sockets remain paused as later uploads are admitted. A
    // late body chunk cannot recreate a file or turn a discarded id ready.
    for mut socket in sockets {
        let _ = socket.write_all(&vec![0_u8; 128 * 1024]);
        let _ = socket.shutdown(std::net::Shutdown::Write);
        let response = read_response(socket);
        assert_ne!(response.status, 200);
    }
    assert_eq!(staging_bytes(&root), 0);
    assert_eq!(
        wire(port, "GET", "/api/uploads", &[alice], &[]).json()["uploads"],
        json!([])
    );
    drop(owner);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn seven_photo_retries_rollback_restart_and_physical_cleanup() {
    let root = fixture_root();
    let mut source = fs::read_to_string(root.join("snapback/media.q")).unwrap();
    source.push_str(
        r#"
mutation sendPhoto(id: id, photo: image <=5000000, reject: bool):
  require reject = false else ROLLBACK
  existing = publicMedia[id]
  if existing != null:
    return existing
  return insert publicMedia { id, owner: viewer, photo }
"#,
    );
    fs::write(root.join("snapback/media.q"), source).unwrap();
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let mut owner = Owner::spawn(&root, &helper);
    let mut port = owner.port();
    let alice = ("X-Snapback-As", "alice");
    let bytes = image_bytes("jpeg", 10, 10);
    let mut original = Value::Null;
    let mut discarded = Vec::new();
    for attempt in 1..=7 {
        let photo = upload(port, alice, &bytes);
        if attempt == 1 {
            original = photo.clone();
        } else {
            discarded.push(photo["id"].as_str().unwrap().to_owned());
        }
        let args = json!({"id":"same-message", "photo":photo, "reject":false});
        if attempt == 7 {
            let mut refused_args = args.clone();
            refused_args["reject"] = json!(true);
            let rejected = mutation(port, alice, "media.sendPhoto", refused_args);
            assert_eq!(rejected["state"], "rejected", "{rejected}");
            let usage = wire(port, "GET", "/api/uploads", &[alice], &[]).json()["usage"].clone();
            assert_eq!(usage["objects"], 1);
            assert!(usage["bytes"].as_u64().unwrap() > 0);
            drop(owner);
            owner = Owner::spawn(&root, &helper);
            port = owner.port();
            assert_eq!(
                wire(port, "GET", "/api/uploads", &[alice], &[]).json()["usage"],
                usage
            );
        }
        let sent = mutation(port, alice, "media.sendPhoto", args);
        assert_eq!(sent["state"], "committed", "{sent}");
        assert_eq!(sent["data"]["photo"], original);
        assert_eq!(
            wire(port, "GET", "/api/uploads", &[alice], &[]).json()["usage"],
            json!({"objects":0, "bytes":0})
        );
    }
    drop(owner);
    owner = Owner::spawn(&root, &helper);
    port = owner.port();
    assert_eq!(
        wire(port, "GET", "/api/uploads", &[alice], &[]).json()["usage"],
        json!({"objects":0, "bytes":0})
    );
    for id in discarded {
        assert!(!root.join(".snapback/blobs").join(id).exists());
    }
    let original_id = original["id"].as_str().unwrap();
    assert!(root.join(".snapback/blobs").join(original_id).is_file());
    assert_eq!(
        wire(
            port,
            "GET",
            &format!("/api/asset/{original_id}"),
            &[alice],
            &[]
        )
        .status,
        200
    );
    drop(owner);
    fs::remove_dir_all(root).unwrap();
}
