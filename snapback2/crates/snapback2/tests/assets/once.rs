use super::*;

#[test]
fn image_once_is_per_principal_serial_durable_and_authorized() {
    let root = fixture_root();
    let schema = fs::read_to_string(root.join("snapback/schema.q"))
        .unwrap()
        .replace("photo: image <=5000000", "photo: image <=5000000 once")
        .replace(
            "read <- .visibleTo = viewer",
            "read <- .owner = viewer or .visibleTo = viewer",
        );
    fs::write(root.join("snapback/schema.q"), schema).unwrap();
    let programs = fs::read_to_string(root.join("snapback/media.q")).unwrap()
        + "\nmutation show(id: privateMedia, visibleTo: principal):\n  update privateMedia[id] { visibleTo }\n  return null\n";
    fs::write(root.join("snapback/media.q"), programs).unwrap();
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let alice = ("X-Snapback-As", "alice");
    let bob = ("X-Snapback-As", "bob");
    let image = upload(port, alice, &image_bytes("png", 512, 4));
    let saved = mutation(
        port,
        alice,
        "media.keepPhoto",
        json!({"photo": image, "visibleTo": "dev:bob"}),
    );
    assert_eq!(saved["state"], "committed", "{saved}");
    let row_id = saved["data"]["id"].as_str().unwrap();
    let path = format!("/api/asset/{}", image["id"].as_str().unwrap());
    assert_eq!(wire(port, "GET", &path, &[], &[]).status, 404);
    assert_eq!(
        mutation(port, alice, "media.revoke", json!({ "id": row_id }))["state"],
        "committed"
    );
    assert_eq!(wire(port, "GET", &path, &[bob], &[]).status, 404);
    assert_eq!(
        mutation(
            port,
            alice,
            "media.show",
            json!({ "id": row_id, "visibleTo": "dev:bob" })
        )["state"],
        "committed"
    );
    let head = wire(port, "HEAD", &path, &[bob], &[]);
    assert_eq!(head.status, 200);
    assert!(head.body.is_empty());
    let first = wire(
        port,
        "GET",
        &format!("{path}?w=1"),
        &[bob, ("Range", "bytes=0-1"), ("If-None-Match", "*")],
        &[],
    );
    assert_eq!(first.status, 200);
    assert_eq!(first.header("Cache-Control"), "private, no-store");
    assert_eq!(image::load_from_memory(&first.body).unwrap().width(), 512);
    for (suffix, extra) in [
        ("", ("Range", "bytes=0-1")),
        ("?w=1", ("If-None-Match", "*")),
        ("", ("If-None-Match", "*")),
    ] {
        let second = wire(port, "GET", &format!("{path}{suffix}"), &[bob, extra], &[]);
        assert_eq!(second.status, 410);
        assert_eq!(second.json()["code"], "E_ASSET_VIEWED");
        assert_eq!(second.json()["family"], "assets");
        assert!(second.json()["site"].is_string());
        assert!(second.json()["rewrite"].is_string());
    }
    // The same bytes, a different authorized recipient, two simultaneous requests.
    let barrier = Arc::new(Barrier::new(3));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let barrier = barrier.clone();
            let path = path.clone();
            thread::spawn(move || {
                barrier.wait();
                wire(port, "GET", &path, &[alice], &[]).status
            })
        })
        .collect();
    barrier.wait();
    let mut statuses: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    statuses.sort();
    assert_eq!(statuses, [200, 410]);
    let revoked = mutation(port, alice, "media.revoke", json!({"id": row_id}));
    assert_eq!(revoked["state"], "committed");
    assert_eq!(
        wire(port, "GET", &path, &[bob], &[]).status,
        404,
        "row authorization precedes the viewed refusal"
    );

    let public = upload(port, alice, &image_bytes("png", 8, 8));
    assert_eq!(
        mutation(port, alice, "media.keepPublic", json!({"photo": public}))["state"],
        "committed"
    );
    let public_path = format!("/api/asset/{}", public["id"].as_str().unwrap());
    assert_eq!(
        wire(port, "GET", &public_path, &[], &[]).status,
        404,
        "once public rows still require a principal"
    );
    let blob = root
        .join(".snapback/blobs")
        .join(public["id"].as_str().unwrap());
    let held_blob = blob.with_extension("held");
    fs::rename(&blob, &held_blob).unwrap();
    assert_eq!(
        wire(port, "GET", &public_path, &[bob], &[]).status,
        404,
        "failure before body begins is retryable"
    );
    fs::rename(&held_blob, &blob).unwrap();
    assert_eq!(wire(port, "GET", &public_path, &[bob], &[]).status, 200);
    // A stalled body occupies its HTTP worker, never the sole writer.
    let mut pixels = RgbImage::new(1200, 1200);
    let mut random = 7u32;
    for byte in pixels.as_mut() {
        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        *byte = random as u8;
    }
    let mut encoded = Vec::new();
    image::codecs::png::PngEncoder::new(&mut encoded)
        .write_image(pixels.as_raw(), 1200, 1200, ExtendedColorType::Rgb8)
        .unwrap();
    let slow_image = upload(port, alice, &encoded);
    assert_eq!(
        mutation(
            port,
            alice,
            "media.keepPublic",
            json!({"photo": slow_image})
        )["state"],
        "committed"
    );
    let mut socket = TcpStream::connect(("127.0.0.1", port)).unwrap();
    // A small advertised receive window makes the server block before completion.
    use std::os::fd::AsRawFd;
    let receive_bytes: libc::c_int = 1024;
    assert_eq!(
        unsafe {
            libc::setsockopt(
                socket.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_RCVBUF,
                (&receive_bytes as *const libc::c_int).cast(),
                std::mem::size_of_val(&receive_bytes) as libc::socklen_t,
            )
        },
        0
    );
    socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    write!(socket, "GET /api/asset/{} HTTP/1.1\r\nHost: localhost\r\nX-Snapback-As: alice\r\nConnection: close\r\n\r\n", slow_image["id"].as_str().unwrap()).unwrap();
    let mut stalled = BufReader::new(socket);
    let mut status = String::new();
    stalled.read_line(&mut status).unwrap();
    assert!(status.contains("200"), "{status}");
    loop {
        let mut line = String::new();
        stalled.read_line(&mut line).unwrap();
        if line == "\r\n" {
            break;
        }
        assert!(!line.is_empty(), "stream ended in headers");
    }
    let mut started = [0; 8];
    stalled.read_exact(&mut started).unwrap();
    let slow_path = format!("/api/asset/{}", slow_image["id"].as_str().unwrap());
    let concurrent_head = wire(port, "HEAD", &slow_path, &[alice], &[]);
    assert_eq!(
        concurrent_head.status, 200,
        "HEAD must not wait for or consume the in-flight GET"
    );
    assert!(concurrent_head.body.is_empty());
    let (send, receive) = std::sync::mpsc::channel();
    let row = row_id.to_owned();
    thread::spawn(move || {
        let _ = send.send(mutation(port, alice, "media.revoke", json!({"id":row})));
    });
    let progress = receive
        .recv_timeout(Duration::from_secs(5))
        .expect("slow body blocked the owner");
    assert_eq!(progress["state"], "committed");
    drop(stalled);
    // We observed body bytes: abort may burn the use, and this writer commits it.
    let retry = wire(port, "GET", &slow_path, &[alice], &[]);
    assert_eq!(
        retry.status, 410,
        "a started body was delivered a second time"
    );
    drop(owner);
    fs::remove_dir_all(root.join(".test-package")).unwrap();
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    assert_eq!(
        wire(port, "GET", &public_path, &[bob], &[]).status,
        410,
        "consumption survives restart"
    );
    assert_eq!(wire(port, "GET", &public_path, &[alice], &[]).status, 200);
    drop(owner);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn once_check_refusals_pin_the_complete_envelope() {
    let project = common::Project::new();
    fs::create_dir_all(project.path.join("snapback")).unwrap();
    for (kind, site, message, rewrite) in [
        (
            "video <=100 once",
            "snapback/schema.q:2:10",
            "once is only specified for image columns; video ranges are unspecified",
            "-- use photo: image <=10000000 once, or remove once from the video column until ranges are specified",
        ),
        (
            "video <=100 once ?",
            "snapback/schema.q:2:10",
            "once is only specified for image columns; video ranges are unspecified",
            "-- use photo: image <=10000000 once, or remove once from the video column until ranges are specified",
        ),
        (
            "[video <=100 once] <=4",
            "snapback/schema.q:2:11",
            "once is only specified for image columns; video ranges are unspecified",
            "-- use photo: image <=10000000 once, or remove once from the video column until ranges are specified",
        ),
        (
            "int once",
            "snapback/schema.q:2:10",
            "once is only specified for image columns",
            "-- remove once from this int column; use image <=10000000 once for one-use images",
        ),
        (
            "text <=100 once",
            "snapback/schema.q:2:10",
            "once is only specified for image columns",
            "-- remove once from this text column; use image <=10000000 once for one-use images",
        ),
    ] {
        fs::write(
            project.path.join("snapback/schema.q"),
            format!("table photos:\n  photo: {kind}\n  read <- public\n"),
        )
        .unwrap();
        let result = project.run(&["check", "--json"]);
        assert!(!result.status.success(), "{kind}");
        assert_eq!(
            common::json_stdout(&result),
            json!({"code":"E_QUARRY_SYNTAX", "family":"quarry", "site":site, "message":message, "rewrite":rewrite, "guide":"quarry/grammar"})
        );
    }
    fs::write(
        project.path.join("snapback/schema.q"),
        "table photos:\n  photo: image <=100 once ?\n  read <- public\n  insert <- allow\n",
    )
    .unwrap();
    for ty in ["image <=100 once", "[image <=100 once] <=4"] {
        fs::write(
            project.path.join("snapback/photos.q"),
            format!("mutation put(photo: {ty}):\n  return null\n"),
        )
        .unwrap();
        let result = project.run(&["check", "--json"]);
        assert!(!result.status.success());
        let refusal: Value = String::from_utf8(result.stdout)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .find(|item| item["code"] == "E_QUARRY_SYNTAX")
            .expect("once argument must refuse in the parser");
        assert_eq!(refusal["code"], "E_QUARRY_SYNTAX");
        assert_eq!(refusal["family"], "quarry");
        assert_eq!(
            refusal["site"],
            if ty.starts_with('[') {
                "snapback/photos.q:1:22"
            } else {
                "snapback/photos.q:1:21"
            }
        );
        assert_eq!(
            refusal["rewrite"],
            "-- remove once from this argument; declare image <=10000000 once on the owning table column"
        );
        assert_eq!(refusal["guide"], "quarry/grammar");
    }
}

#[test]
fn asset_head_is_headers_only_with_the_get_security_headers() {
    let root = fixture_root();
    let schema = fs::read_to_string(root.join("snapback/schema.q"))
        .unwrap()
        .replace("photo: image <=5000000", "photo: image <=5000000 once");
    fs::write(root.join("snapback/schema.q"), schema).unwrap();
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let alice = ("X-Snapback-As", "alice");
    // Once and ordinary images use separate HTTP branches.
    let image = upload(port, alice, &image_bytes("png", 8, 8));
    assert_eq!(
        mutation(port, alice, "media.keepPublic", json!({"photo":image}))["state"],
        "committed"
    );
    let path = format!("/api/asset/{}", image["id"].as_str().unwrap());
    let head = wire(port, "HEAD", &path, &[alice], &[]);
    assert_eq!(head.status, 200);
    assert!(head.body.is_empty());
    let get = wire(port, "GET", &path, &[alice], &[]);
    assert_eq!(get.status, 200);
    assert!(!get.body.is_empty());
    for key in [
        "Content-Type",
        "Content-Length",
        "Cache-Control",
        "Access-Control-Allow-Origin",
        "Referrer-Policy",
        "X-Content-Type-Options",
    ] {
        assert_eq!(head.header(key), get.header(key), "{key}");
    }
    let viewed = wire(port, "HEAD", &path, &[alice], &[]);
    assert_eq!(viewed.status, 410);
    assert!(viewed.body.is_empty());
    drop(owner);
    // Same fixture with ordinary image custody exercises the ordinary route on raw TCP.
    let schema = fs::read_to_string(root.join("snapback/schema.q"))
        .unwrap()
        .replace(" once", "");
    let ordinary = fixture_root();
    fs::write(ordinary.join("snapback/schema.q"), schema).unwrap();
    let mut owner = Owner::spawn(&ordinary, &helper);
    let port = owner.port();
    let image = upload(port, alice, &image_bytes("png", 8, 8));
    assert_eq!(
        mutation(
            port,
            alice,
            "media.keepPhoto",
            json!({"photo":image, "visibleTo":"dev:alice"})
        )["state"],
        "committed"
    );
    let path = format!("/api/asset/{}", image["id"].as_str().unwrap());
    let head = wire(port, "HEAD", &path, &[alice], &[]);
    let get = wire(port, "GET", &path, &[alice], &[]);
    assert_eq!(head.status, 200);
    assert!(head.body.is_empty());
    assert_eq!(get.status, 200);
    assert!(!get.body.is_empty());
    for key in [
        "Content-Type",
        "Content-Length",
        "Cache-Control",
        "ETag",
        "Access-Control-Allow-Origin",
        "Referrer-Policy",
        "X-Content-Type-Options",
    ] {
        assert_eq!(head.header(key), get.header(key), "{key}");
    }
    drop(owner);
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(ordinary).unwrap();
}

#[test]
fn once_first_selectors_each_deliver_full_original_and_reset_allows_new_asset() {
    let root = fixture_root();
    let schema = fs::read_to_string(root.join("snapback/schema.q"))
        .unwrap()
        .replace("photo: image <=5000000", "photo: image <=5000000 once");
    fs::write(root.join("snapback/schema.q"), schema).unwrap();
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let alice = ("X-Snapback-As", "alice");
    for (suffix, headers) in [
        ("?w=1", vec![alice]),
        ("", vec![alice, ("Range", "bytes=0-1")]),
        ("", vec![alice, ("If-None-Match", "*")]),
    ] {
        let original = image_bytes("png", 512, 4);
        let photo = upload(port, alice, &original);
        assert_eq!(
            mutation(port, alice, "media.keepPublic", json!({"photo":photo}))["state"],
            "committed"
        );
        let path = format!("/api/asset/{}{suffix}", photo["id"].as_str().unwrap());
        let first = wire(port, "GET", &path, &headers, &[]);
        assert_eq!(first.status, 200);
        assert_eq!(first.header("Cache-Control"), "private, no-store");
        // The uploaded image is normalized before custody; selectors must return that entire original.
        let stored = fs::read(
            root.join(".snapback/blobs")
                .join(photo["id"].as_str().unwrap()),
        )
        .unwrap();
        assert_eq!(first.body, stored);
        assert_eq!(image::load_from_memory(&first.body).unwrap().width(), 512);
        assert!(!first.headers.contains_key("content-range"));
        assert_eq!(wire(port, "GET", &path, &headers, &[]).status, 410);
    }
    let reset = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["reset", "--project"])
        .arg(&root)
        .arg("--json")
        .output()
        .unwrap();
    assert!(
        reset.status.success(),
        "{}",
        String::from_utf8_lossy(&reset.stdout)
    );
    let photo = upload(port, alice, &image_bytes("png", 8, 8));
    assert_eq!(
        mutation(port, alice, "media.keepPublic", json!({"photo":photo}))["state"],
        "committed"
    );
    assert_eq!(
        wire(
            port,
            "GET",
            &format!("/api/asset/{}", photo["id"].as_str().unwrap()),
            &[alice],
            &[]
        )
        .status,
        200
    );
    drop(owner);
    fs::remove_dir_all(root).unwrap();
}
