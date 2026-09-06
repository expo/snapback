use image::{ExtendedColorType, ImageEncoder, Rgb, RgbImage};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

mod common;
#[path = "assets/once.rs"]
mod once;

static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

struct Owner {
    child: Child,
    stdout: BufReader<std::process::ChildStdout>,
}

impl Owner {
    fn spawn(root: &Path, helper: &Path) -> Self {
        let compiler = common::isolated_compiler(&root.join(".test-package"));
        let binary = env!("CARGO_BIN_EXE_snapback2");
        let mut child = Command::new(binary)
            .args(["dev", "--project"])
            .arg(root)
            .arg("--foreground")
            .env("SNAPBACK2_COMPILER", compiler)
            .env("SNAPBACK2_MEDIA", helper)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdout }
    }

    fn port(&mut self) -> u16 {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        line.trim()
            .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
            .unwrap_or_else(|| panic!("owner did not become ready: {line:?}"))
            .parse()
            .unwrap()
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

struct WireResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

impl WireResponse {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }

    fn header(&self, name: &str) -> &str {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
            .unwrap_or_else(|| panic!("missing {name} in {:?}", self.headers))
    }
}

fn wire(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> WireResponse {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n"
    )
    .unwrap();
    if !headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("Content-Length"))
    {
        write!(stream, "Content-Length: {}\r\n", body.len()).unwrap();
    }
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    stream.write_all(b"\r\n").unwrap();
    stream.write_all(body).unwrap();
    stream.flush().unwrap();
    read_response(stream)
}

fn wire_without_length(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
) -> WireResponse {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n"
    )
    .unwrap();
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    stream.write_all(b"\r\n").unwrap();
    stream.flush().unwrap();
    read_response(stream)
}

fn read_response(mut stream: TcpStream) -> WireResponse {
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).unwrap();
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap();
    let head = String::from_utf8_lossy(&bytes[..split]);
    let status = head
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let headers = head
        .lines()
        .skip(1)
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    WireResponse {
        status,
        headers,
        body: bytes[split + 4..].to_vec(),
    }
}

fn json_request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    value: Value,
) -> WireResponse {
    let bytes = serde_json::to_vec(&value).unwrap();
    let mut headers = headers.to_vec();
    headers.push(("Content-Type", "application/json"));
    wire(port, method, path, &headers, &bytes)
}

fn upload(port: u16, authority: (&str, &str), bytes: &[u8]) -> Value {
    let response = wire(port, "POST", "/api/upload", &[authority], bytes);
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    response.json()
}

fn mutation(port: u16, authority: (&str, &str), op: &str, args: Value) -> Value {
    let response = json_request(
        port,
        "POST",
        "/api/mutation",
        &[authority],
        json!({ "op": op, "args": args }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    response.json()
}

fn wait_for<T>(timeout: Duration, mut check: impl FnMut() -> Option<T>) -> T {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(value) = check() {
            return value;
        }
        thread::sleep(Duration::from_millis(100));
    }
    panic!("condition did not become true in {timeout:?}");
}

fn fixture_root() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "snapback2-assets-test-{}-{}-{stamp}",
        std::process::id(),
        NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        r#"use identity

table privateMedia:
  owner: principal
  visibleTo: principal
  photo: image <=5000000 ?
  clip: video <=50000000 ?
  read <- .visibleTo = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer

table publicMedia:
  owner: principal
  photo: image <=5000000
  public 'asset integration fixture'
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
"#,
    )
    .unwrap();
    fs::write(
        root.join("snapback/media.q"),
        r#"mutation keepPhoto(photo: image <=5000000, visibleTo: principal):
  return insert privateMedia { owner: viewer, visibleTo, photo, clip: null }

mutation keepVideo(clip: video <=50000000, visibleTo: principal):
  return insert privateMedia { owner: viewer, visibleTo, photo: null, clip }

mutation keepPublic(photo: image <=5000000):
  return insert publicMedia { owner: viewer, photo }

mutation revoke(id: privateMedia):
  update privateMedia[id] { visibleTo: viewer }
  return null

query privateOne(id: privateMedia):
  return privateMedia[id]

query publicOne(id: publicMedia):
  return publicMedia[id]
"#,
    )
    .unwrap();
    fs::write(
        root.join("snapback/seed.ts"),
        r#"import { seed } from "snapback2";
export default seed({ personas: ["alice", "bob"], rows: { privateMedia: [], publicMedia: [] } });
"#,
    )
    .unwrap();
    root
}

fn make_video_only(root: &Path) {
    fs::write(
        root.join("snapback/schema.q"),
        r#"use identity

table videos:
  owner: principal
  clip: video <=50000000
  public 'video-only helper boot fixture'
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
"#,
    )
    .unwrap();
    fs::write(
        root.join("snapback/media.q"),
        "query inspect(clip: video <=50000000):\n  return clip.duration\n",
    )
    .unwrap();
    fs::write(
        root.join("snapback/seed.ts"),
        r#"import { seed } from "snapback2";
export default seed({ personas: [], rows: { videos: [] } });
"#,
    )
    .unwrap();
}

fn image_bytes(format: &str, width: u32, height: u32) -> Vec<u8> {
    let image = RgbImage::from_fn(width, height, |x, y| {
        Rgb([(x % 251) as u8, (y % 241) as u8, ((x + y) % 239) as u8])
    });
    let mut bytes = Vec::new();
    match format {
        "jpeg" => image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 85)
            .write_image(image.as_raw(), width, height, ExtendedColorType::Rgb8)
            .unwrap(),
        "png" => image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(image.as_raw(), width, height, ExtendedColorType::Rgb8)
            .unwrap(),
        "webp" => image::codecs::webp::WebPEncoder::new_lossless(&mut bytes)
            .write_image(image.as_raw(), width, height, ExtendedColorType::Rgb8)
            .unwrap(),
        _ => unreachable!(),
    }
    bytes
}

fn exif_with_gps(orientation: u8) -> Vec<u8> {
    let mut tiff = b"II".to_vec();
    tiff.extend_from_slice(&42_u16.to_le_bytes());
    tiff.extend_from_slice(&8_u32.to_le_bytes());
    tiff.extend_from_slice(&2_u16.to_le_bytes());
    tiff.extend_from_slice(&0x8825_u16.to_le_bytes());
    tiff.extend_from_slice(&4_u16.to_le_bytes());
    tiff.extend_from_slice(&1_u32.to_le_bytes());
    tiff.extend_from_slice(&38_u32.to_le_bytes());
    tiff.extend_from_slice(&0x0112_u16.to_le_bytes());
    tiff.extend_from_slice(&3_u16.to_le_bytes());
    tiff.extend_from_slice(&1_u32.to_le_bytes());
    tiff.extend_from_slice(&u16::from(orientation).to_le_bytes());
    tiff.extend_from_slice(&0_u16.to_le_bytes());
    tiff.extend_from_slice(&0_u32.to_le_bytes());
    tiff.extend_from_slice(&0_u16.to_le_bytes());
    let mut payload = b"Exif\0\0".to_vec();
    payload.extend_from_slice(&tiff);
    payload
}

fn jpeg_with_private_metadata(orientation: u8) -> Vec<u8> {
    let jpeg = image_bytes("jpeg", 4, 2);
    let payload = exif_with_gps(orientation);
    let mut result = jpeg[..2].to_vec();
    result.extend_from_slice(&[0xff, 0xe1]);
    result.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
    result.extend_from_slice(&payload);
    result.extend_from_slice(&jpeg[2..]);
    result
}

fn assert_one_orientation_tag(jpeg: &[u8], orientation: u8) {
    assert_eq!(&jpeg[..4], b"\xff\xd8\xff\xe1");
    let length = usize::from(u16::from_be_bytes([jpeg[4], jpeg[5]]));
    let payload = &jpeg[6..6 + length - 2];
    assert_eq!(&payload[..6], b"Exif\0\0");
    let tiff = &payload[6..];
    assert_eq!(u16::from_le_bytes([tiff[8], tiff[9]]), 1);
    assert_eq!(u16::from_le_bytes([tiff[10], tiff[11]]), 0x0112);
    assert_eq!(
        u16::from_le_bytes([tiff[18], tiff[19]]),
        u16::from(orientation)
    );
    assert!(!payload.windows(2).any(|window| window == [0x25, 0x88]));
}

fn assert_png_has_no_text(bytes: &[u8]) {
    let mut at = 8;
    while at + 12 <= bytes.len() {
        let length = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let kind = &bytes[at + 4..at + 8];
        assert!(!matches!(kind, b"tEXt" | b"iTXt" | b"zTXt"));
        at += 12 + length;
        if kind == b"IEND" {
            return;
        }
    }
    panic!("PNG has no complete IEND");
}

fn assert_webp_has_one_exif_and_no_xmp(bytes: &[u8]) {
    let mut at = 12;
    let mut exif = 0;
    while at + 8 <= bytes.len() {
        let kind = &bytes[at..at + 4];
        let length = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        exif += usize::from(kind == b"EXIF");
        assert_ne!(kind, b"XMP ");
        at += 8 + length + (length & 1);
    }
    assert_eq!(at, bytes.len());
    assert_eq!(exif, 1);
}

#[test]
fn asset_server_upload_delivery_carrier_revoke_and_reset_round_trip() {
    let root = fixture_root();
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    assert!(
        helper.is_file(),
        "build the snapback2-media workspace binary"
    );
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();

    let over_bound = wire(
        port,
        "POST",
        "/api/upload",
        &[("X-Snapback-As", "alice"), ("Content-Length", "50000001")],
        &[],
    );
    assert_eq!(
        over_bound.status,
        422,
        "{}",
        String::from_utf8_lossy(&over_bound.body)
    );
    assert_eq!(over_bound.json()["code"], "E_ASSET_TOO_LARGE");
    let missing_length =
        wire_without_length(port, "POST", "/api/upload", &[("X-Snapback-As", "alice")]);
    assert_eq!(missing_length.status, 422);
    assert_eq!(missing_length.json()["code"], "E_ASSET_TYPE");

    for invalid in [
        b"<svg xmlns='http://www.w3.org/2000/svg'/>".as_slice(),
        b"<html>private</html>".as_slice(),
        b"javascript:alert(1)".as_slice(),
    ] {
        let response = wire(
            port,
            "POST",
            "/api/upload",
            &[("X-Snapback-As", "alice")],
            invalid,
        );
        assert_eq!(response.status, 422);
        assert_eq!(response.json()["code"], "E_ASSET_TYPE");
    }

    let mut jpeg = None;
    let mut unlocated_id = None;
    for orientation in 2..=8 {
        let record = upload(
            port,
            ("X-Snapback-As", "alice"),
            &jpeg_with_private_metadata(orientation),
        );
        let expected = if orientation >= 5 {
            (Some(2), Some(4))
        } else {
            (Some(4), Some(2))
        };
        assert_eq!(
            (record["width"].as_u64(), record["height"].as_u64()),
            expected,
            "orientation {orientation}"
        );
        let id = record["id"].as_str().unwrap();
        assert_one_orientation_tag(
            &fs::read(root.join(format!(".snapback/blobs/{id}"))).unwrap(),
            orientation,
        );
        if orientation == 2 {
            unlocated_id = Some(id.to_owned());
        }
        if orientation == 6 {
            jpeg = Some(record);
        }
    }
    let jpeg = jpeg.unwrap();
    assert_eq!(
        (jpeg["width"].as_u64(), jpeg["height"].as_u64()),
        (Some(2), Some(4))
    );
    let unlocated = wire(
        port,
        "GET",
        &format!("/api/asset/{}", unlocated_id.unwrap()),
        &[("X-Snapback-As", "alice")],
        &[],
    );
    assert_eq!(
        unlocated.status, 404,
        "upload alone must not be deliverable"
    );
    let kept = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepPhoto",
        json!({ "photo": jpeg, "visibleTo": "dev:bob" }),
    );
    assert_eq!(kept["state"], "committed", "{kept}");
    let private_row = kept["data"].clone();
    let private_id = private_row["id"].as_str().unwrap();
    let jpeg_id = private_row["photo"]["id"].as_str().unwrap();
    let queried = json_request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "bob")],
        json!({ "op": "media.privateOne", "args": { "id": private_id } }),
    )
    .json();
    assert_eq!(queried["data"]["photo"], private_row["photo"]);

    let delivered = wire(
        port,
        "GET",
        &format!("/api/asset/{jpeg_id}"),
        &[("X-Snapback-As", "bob")],
        &[],
    );
    assert_eq!(delivered.status, 200);
    assert_eq!(delivered.header("accept-ranges"), "bytes");
    assert_eq!(delivered.header("x-content-type-options"), "nosniff");
    assert_eq!(delivered.header("content-type"), "image/jpeg");
    assert_eq!(delivered.header("referrer-policy"), "no-referrer");
    assert_eq!(delivered.header("cache-control"), "no-store");
    assert_one_orientation_tag(&delivered.body, 6);
    let etag = delivered.header("etag").to_owned();

    let partial = wire(
        port,
        "GET",
        &format!("/api/asset/{jpeg_id}"),
        &[("X-Snapback-As", "bob"), ("Range", "bytes=0-9")],
        &[],
    );
    assert_eq!(partial.status, 206);
    assert_eq!(partial.header("x-content-type-options"), "nosniff");
    assert_eq!(partial.header("referrer-policy"), "no-referrer");
    assert_eq!(partial.body.len(), 10);
    assert!(partial.header("content-range").starts_with("bytes 0-9/"));
    let unsatisfiable = wire(
        port,
        "GET",
        &format!("/api/asset/{jpeg_id}"),
        &[("X-Snapback-As", "bob"), ("Range", "bytes=999999-")],
        &[],
    );
    assert_eq!(unsatisfiable.status, 416);
    assert_eq!(unsatisfiable.header("x-content-type-options"), "nosniff");
    assert_eq!(unsatisfiable.header("referrer-policy"), "no-referrer");
    assert!(
        unsatisfiable
            .header("content-range")
            .starts_with("bytes */")
    );
    let not_modified = wire(
        port,
        "GET",
        &format!("/api/asset/{jpeg_id}"),
        &[("X-Snapback-As", "bob"), ("If-None-Match", &etag)],
        &[],
    );
    assert_eq!(not_modified.status, 304);
    assert_eq!(not_modified.header("x-content-type-options"), "nosniff");
    assert_eq!(not_modified.header("referrer-policy"), "no-referrer");

    let forged = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepPhoto",
        json!({
            "photo": { "id": jpeg_id, "width": 999, "height": 4 },
            "visibleTo": "dev:alice"
        }),
    );
    assert_eq!(forged["state"], "rejected", "{forged}");
    assert_eq!(forged["code"], "E_ASSET_TYPE", "{forged}");

    let png_bytes = image_bytes("png", 640, 480);
    let png = upload(port, ("X-Snapback-As", "alice"), &png_bytes);
    let png_kept = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepPhoto",
        json!({ "photo": png, "visibleTo": "dev:alice" }),
    );
    assert_eq!(png_kept["state"], "committed", "{png_kept}");
    let png_row_id = png_kept["data"]["id"].as_str().unwrap();
    let png_id = png_kept["data"]["photo"]["id"].as_str().unwrap();
    let png_query = json_request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "media.privateOne", "args": { "id": png_row_id } }),
    )
    .json();
    assert_eq!(png_query["data"]["photo"], png_kept["data"]["photo"]);
    let png_original = wire(
        port,
        "GET",
        &format!("/api/asset/{png_id}"),
        &[("X-Snapback-As", "alice")],
        &[],
    );
    assert_png_has_no_text(&png_original.body);
    let rung = wire(
        port,
        "GET",
        &format!("/api/asset/{png_id}?w=300"),
        &[("X-Snapback-As", "alice")],
        &[],
    );
    assert_eq!(rung.status, 200, "{}", String::from_utf8_lossy(&rung.body));
    assert!(
        root.join(format!(".snapback/blobs/{png_id}.w512"))
            .is_file()
    );
    let no_upscale = wire(
        port,
        "GET",
        &format!("/api/asset/{png_id}?w=700"),
        &[("X-Snapback-As", "alice")],
        &[],
    );
    assert_eq!(no_upscale.status, 200);
    assert!(!root.join(format!(".snapback/blobs/{png_id}.w640")).exists());

    let webp = upload(port, ("X-Snapback-As", "alice"), &image_bytes("webp", 7, 5));
    let webp_kept = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepPhoto",
        json!({ "photo": webp, "visibleTo": "dev:alice" }),
    );
    assert_eq!(webp_kept["state"], "committed", "{webp_kept}");
    let webp_row_id = webp_kept["data"]["id"].as_str().unwrap();
    let webp_id = webp_kept["data"]["photo"]["id"].as_str().unwrap();
    let webp_query = json_request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "media.privateOne", "args": { "id": webp_row_id } }),
    )
    .json();
    assert_eq!(webp_query["data"]["photo"], webp_kept["data"]["photo"]);
    let webp_delivery = wire(
        port,
        "GET",
        &format!("/api/asset/{webp_id}"),
        &[("X-Snapback-As", "alice")],
        &[],
    );
    assert_webp_has_one_exif_and_no_xmp(&webp_delivery.body);

    let video_bytes = fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../benchmarks/fixtures/social-messenger/media/vid-01.mp4"),
    )
    .unwrap();
    let video = upload(port, ("X-Snapback-As", "alice"), &video_bytes);
    assert!(video["duration"].as_i64().is_some_and(|value| value > 0));
    let video_kept = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepVideo",
        json!({ "clip": video, "visibleTo": "dev:bob" }),
    );
    assert_eq!(video_kept["state"], "committed", "{video_kept}");
    let video_row_id = video_kept["data"]["id"].as_str().unwrap();
    let video_id = video_kept["data"]["clip"]["id"].as_str().unwrap();
    let video_query = json_request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "bob")],
        json!({ "op": "media.privateOne", "args": { "id": video_row_id } }),
    )
    .json();
    assert_eq!(video_query["data"]["clip"], video_kept["data"]["clip"]);

    let persona_session = json_request(
        port,
        "POST",
        "/api/auth/asset-session",
        &[("X-Snapback-As", "bob")],
        json!({}),
    )
    .json();
    let persona_carrier = persona_session["token"].as_str().unwrap();
    let refused_image_carrier = wire(
        port,
        "GET",
        &format!("/api/asset/{jpeg_id}?s={persona_carrier}"),
        &[],
        &[],
    );
    assert_eq!(refused_image_carrier.status, 404);
    assert_eq!(refused_image_carrier.header("cache-control"), "no-store");
    assert_eq!(
        refused_image_carrier.header("referrer-policy"),
        "no-referrer"
    );
    let carried = wire(
        port,
        "GET",
        &format!("/api/asset/{video_id}?s={persona_carrier}"),
        &[],
        &[],
    );
    assert_eq!(carried.status, 200);
    assert_eq!(carried.header("cache-control"), "no-store");
    let carried_width = wire(
        port,
        "GET",
        &format!("/api/asset/{video_id}?w=300&s={persona_carrier}"),
        &[],
        &[],
    );
    assert_eq!(carried_width.status, 200);
    assert_eq!(carried_width.body, carried.body);
    assert!(
        !root
            .join(format!(".snapback/blobs/{video_id}.w512"))
            .exists()
    );

    let public_upload = upload(port, ("X-Snapback-As", "alice"), &png_bytes);
    let public_kept = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepPublic",
        json!({ "photo": public_upload }),
    );
    assert_eq!(public_kept["state"], "committed", "{public_kept}");
    let public_id = public_kept["data"]["photo"]["id"].as_str().unwrap();
    let public = wire(port, "GET", &format!("/api/asset/{public_id}"), &[], &[]);
    assert_eq!(public.status, 200);
    assert_eq!(public.header("cache-control"), "public, immutable");
    let redirect = wire(
        port,
        "GET",
        &format!("/api/asset/{public_id}?s={persona_carrier}"),
        &[],
        &[],
    );
    assert_eq!(redirect.status, 302);
    assert_eq!(
        redirect.header("location"),
        format!("/api/asset/{public_id}")
    );
    assert_eq!(redirect.header("cache-control"), "no-store");
    let combined = wire(
        port,
        "GET",
        &format!("/api/asset/{video_id}?s={persona_carrier}"),
        &[("X-Snapback-As", "bob")],
        &[],
    );
    assert_eq!(combined.status, 400);
    assert_eq!(combined.json()["code"], "E_AUTH_AMBIGUOUS");
    assert_eq!(combined.header("cache-control"), "no-store");
    assert_eq!(combined.header("referrer-policy"), "no-referrer");

    let advanced = json_request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret)],
        json!({ "advanceMs": 1_800_001 }),
    );
    assert_eq!(
        advanced.status,
        200,
        "{}",
        String::from_utf8_lossy(&advanced.body)
    );
    let expired = wire(
        port,
        "GET",
        &format!("/api/asset/{video_id}?s={persona_carrier}"),
        &[],
        &[],
    );
    assert_eq!(expired.status, 404);
    assert_eq!(expired.header("cache-control"), "no-store");
    assert_eq!(expired.header("referrer-policy"), "no-referrer");

    let signup = json_request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({ "email": "carrier@example.com", "password": "correct horse" }),
    )
    .json();
    let bearer = format!("Bearer {}", signup["token"].as_str().unwrap());
    let bearer_photo = upload(port, ("Authorization", &bearer), &png_bytes);
    let bearer_kept = mutation(
        port,
        ("Authorization", &bearer),
        "media.keepPhoto",
        json!({ "photo": bearer_photo, "visibleTo": signup["viewer"] }),
    );
    assert_eq!(bearer_kept["state"], "committed", "{bearer_kept}");
    let bearer_asset = bearer_kept["data"]["photo"]["id"].as_str().unwrap();
    let bearer_session = json_request(
        port,
        "POST",
        "/api/auth/asset-session",
        &[("Authorization", &bearer)],
        json!({}),
    )
    .json();
    let carrier_expiry = bearer_session["expiresAt"].as_i64().unwrap();
    let host_now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(carrier_expiry > host_now && carrier_expiry <= host_now + 3_700_000);
    let bearer_carrier = bearer_session["token"].as_str().unwrap();
    assert_eq!(
        wire(
            port,
            "GET",
            &format!("/api/asset/{bearer_asset}?s={bearer_carrier}"),
            &[],
            &[],
        )
        .status,
        404
    );
    let logout = json_request(
        port,
        "POST",
        "/api/auth/logout",
        &[("Authorization", &bearer)],
        json!({}),
    );
    assert_eq!(
        logout.status,
        200,
        "{}",
        String::from_utf8_lossy(&logout.body)
    );
    assert_eq!(
        wire(
            port,
            "GET",
            &format!("/api/asset/{bearer_asset}?s={bearer_carrier}"),
            &[],
            &[],
        )
        .status,
        404
    );

    let revoked = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.revoke",
        json!({ "id": private_id }),
    );
    assert_eq!(revoked["state"], "committed", "{revoked}");
    let denied_304 = wire(
        port,
        "GET",
        &format!("/api/asset/{jpeg_id}"),
        &[("X-Snapback-As", "bob"), ("If-None-Match", &etag)],
        &[],
    );
    assert_eq!(
        denied_304.status, 404,
        "authorization must precede ETag handling"
    );

    let malformed_carrier = wire(
        port,
        "GET",
        &format!("/api/asset/bad/path?s={bearer_carrier}"),
        &[],
        &[],
    );
    assert_eq!(malformed_carrier.status, 404);
    assert_eq!(malformed_carrier.header("cache-control"), "no-store");
    assert_eq!(malformed_carrier.header("referrer-policy"), "no-referrer");

    let fork = json_request(
        port,
        "POST",
        "/control/fork",
        &[("X-Snapback-Control", secret)],
        json!({ "name": "asset-reset" }),
    );
    assert_eq!(fork.status, 200, "{}", String::from_utf8_lossy(&fork.body));
    fs::write(root.join(".snapback/staging/stale.stage"), b"stale").unwrap();
    let reset = json_request(
        port,
        "POST",
        "/control/reset",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(
        reset.status,
        200,
        "{}",
        String::from_utf8_lossy(&reset.body)
    );
    assert!(root.join(format!(".snapback/blobs/{jpeg_id}")).is_file());
    assert!(
        root.join(format!(".snapback/blobs/{png_id}.w512"))
            .is_file()
    );
    assert_eq!(
        fs::read_dir(root.join(".snapback/staging"))
            .unwrap()
            .count(),
        0
    );

    let log = fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
    assert!(!log.contains(persona_carrier));
    assert!(!log.contains(bearer_carrier));
    let stopped = json_request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "asset integration complete" }),
    );
    assert_eq!(stopped.status, 200);
    let status = owner.child.wait().unwrap();
    assert!(status.success());

    let doctor = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .arg("doctor")
        .current_dir(&root)
        .env(
            "SNAPBACK2_COMPILER",
            root.join(".test-package/dist/compiler.mjs"),
        )
        .env("SNAPBACK2_MEDIA", root.join("missing-media-helper"))
        .output()
        .unwrap();
    assert!(!doctor.status.success());
    assert!(
        String::from_utf8_lossy(&doctor.stdout).contains("E_ASSET_NOT_READY"),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&doctor.stdout),
        String::from_utf8_lossy(&doctor.stderr)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn guest_upload_churn_hits_global_cap_and_claim_and_reclaim_release_it() {
    let root = fixture_root();
    let helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();
    let bytes = image_bytes("jpeg", 1, 1);
    let mut first = None;

    for _ in 0..snapback2_core::STAGING_GLOBAL_OBJECTS {
        let guest = json_request(port, "POST", "/api/auth/guest", &[], json!({}));
        assert_eq!(
            guest.status,
            200,
            "{}",
            String::from_utf8_lossy(&guest.body)
        );
        let guest = guest.json();
        let token = guest["token"].as_str().unwrap().to_owned();
        let viewer = guest["viewer"].as_str().unwrap().to_owned();
        let bearer = format!("Bearer {token}");
        let record = upload(port, ("Authorization", &bearer), &bytes);
        if first.is_none() {
            first = Some((token, viewer, record));
        }
    }

    let blocked_guest = json_request(port, "POST", "/api/auth/guest", &[], json!({})).json();
    let blocked_bearer = format!("Bearer {}", blocked_guest["token"].as_str().unwrap());
    let blocked = wire(
        port,
        "POST",
        "/api/upload",
        &[("Authorization", &blocked_bearer)],
        &bytes,
    );
    assert_eq!(
        blocked.status,
        422,
        "{}",
        String::from_utf8_lossy(&blocked.body)
    );
    assert_eq!(blocked.json()["code"], "E_ASSET_TOO_LARGE");

    let (first_token, first_viewer, first_record) = first.unwrap();
    let first_bearer = format!("Bearer {first_token}");
    let claimed = mutation(
        port,
        ("Authorization", &first_bearer),
        "media.keepPhoto",
        json!({ "photo": first_record, "visibleTo": first_viewer }),
    );
    assert_eq!(claimed["state"], "committed", "{claimed}");
    let after_claim = upload(port, ("Authorization", &blocked_bearer), &bytes);
    assert!(after_claim["id"].as_str().is_some());

    let advanced = json_request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret)],
        json!({ "advanceMs": snapback2_core::ASSET_RECLAIM_GRACE_MS + 1 }),
    );
    assert_eq!(
        advanced.status,
        200,
        "{}",
        String::from_utf8_lossy(&advanced.body)
    );
    let post_reclaim_guest = json_request(port, "POST", "/api/auth/guest", &[], json!({})).json();
    let post_reclaim_bearer = format!("Bearer {}", post_reclaim_guest["token"].as_str().unwrap());
    let after_reclaim = upload(port, ("Authorization", &post_reclaim_bearer), &bytes);
    assert!(after_reclaim["id"].as_str().is_some());

    let stopped = json_request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "guest asset churn test" }),
    );
    assert_eq!(stopped.status, 200);
    assert!(owner.child.wait().unwrap().success());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn concurrent_first_rung_http_requests_spawn_one_helper_and_all_succeed() {
    use std::os::unix::fs::PermissionsExt;

    const REQUESTS: usize = 16;
    let root = fixture_root();
    let real_helper = Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media");
    let helper = root.join("counting-media-helper");
    let renders = root.join("render-spawns");
    fs::write(
        &helper,
        format!(
            "#!/bin/sh\nif [ \"$1\" = render ]; then printf 'render\\n' >> '{}'; fi\nexec '{}' \"$@\"\n",
            renders.display(),
            real_helper.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();

    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();
    let record = upload(
        port,
        ("X-Snapback-As", "alice"),
        &image_bytes("png", 640, 480),
    );
    let kept = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepPhoto",
        json!({ "photo": record, "visibleTo": "dev:alice" }),
    );
    assert_eq!(kept["state"], "committed", "{kept}");
    let id = kept["data"]["photo"]["id"].as_str().unwrap().to_owned();
    let barrier = Arc::new(Barrier::new(REQUESTS));
    let requests = (0..REQUESTS)
        .map(|_| {
            let id = id.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                wire(
                    port,
                    "GET",
                    &format!("/api/asset/{id}?w=300"),
                    &[("X-Snapback-As", "alice")],
                    &[],
                )
            })
        })
        .collect::<Vec<_>>();
    for request in requests {
        let response = request.join().unwrap();
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
    }
    assert_eq!(fs::read_to_string(&renders).unwrap().lines().count(), 1);

    let stopped = json_request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "single-flight HTTP integration test" }),
    );
    assert_eq!(stopped.status, 200);
    assert!(owner.child.wait().unwrap().success());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn heic_upload_through_the_qualified_helper_returns_jpeg_facts_and_bytes() {
    let required = std::env::var_os("SNAPBACK2_REQUIRE_HEIC_TEST").is_some();
    let helper = std::env::var_os("SNAPBACK2_TEST_HEIC_MEDIA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_BIN_EXE_snapback2")).with_file_name("snapback2-media")
        });
    let capabilities = Command::new(&helper).arg("capabilities").output().unwrap();
    let capabilities: Value = serde_json::from_slice(&capabilities.stdout).unwrap();
    if capabilities["heic"] != true {
        assert!(
            !required,
            "SNAPBACK2_REQUIRE_HEIC_TEST requires a helper built with --features heic"
        );
        return;
    }
    let encoder = std::env::var_os("SNAPBACK2_TEST_HEIF_ENC")
        .map(PathBuf::from)
        .or_else(|| {
            [
                "/opt/homebrew/bin/heif-enc",
                "/usr/local/bin/heif-enc",
                "/usr/bin/heif-enc",
            ]
            .into_iter()
            .map(PathBuf::from)
            .find(|path| path.is_file())
        });
    let Some(encoder) = encoder else {
        assert!(!required, "SNAPBACK2_REQUIRE_HEIC_TEST requires heif-enc");
        return;
    };

    let root = fixture_root();
    let png = root.join("source.png");
    let heic = root.join("source.heic");
    fs::write(&png, image_bytes("png", 3, 2)).unwrap();
    let encoded = Command::new(encoder)
        .args(["-q", "90", "-o"])
        .arg(&heic)
        .arg(&png)
        .output()
        .unwrap();
    assert!(
        encoded.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&encoded.stdout),
        String::from_utf8_lossy(&encoded.stderr)
    );

    let mut owner = Owner::spawn(&root, &helper);
    let port = owner.port();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();
    let record = upload(port, ("X-Snapback-As", "alice"), &fs::read(&heic).unwrap());
    assert_eq!(
        (record["width"].as_u64(), record["height"].as_u64()),
        (Some(3), Some(2))
    );
    let kept = mutation(
        port,
        ("X-Snapback-As", "alice"),
        "media.keepPublic",
        json!({ "photo": record }),
    );
    assert_eq!(kept["state"], "committed", "{kept}");
    let id = kept["data"]["photo"]["id"].as_str().unwrap();
    let delivered = wire(port, "GET", &format!("/api/asset/{id}"), &[], &[]);
    assert_eq!(delivered.status, 200);
    assert_eq!(delivered.header("content-type"), "image/jpeg");
    assert!(delivered.body.starts_with(&[0xff, 0xd8, 0xff]));

    let stopped = json_request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "HEIC upload integration test" }),
    );
    assert_eq!(stopped.status, 200);
    assert!(owner.child.wait().unwrap().success());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn image_boot_and_apply_require_the_helper_but_video_only_boot_does_not() {
    let image_root = fixture_root();
    let compiler = common::isolated_compiler(&image_root.join(".test-package"));
    let missing = image_root.join("missing-media-helper");
    let refused = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["dev", "--project"])
        .arg(&image_root)
        .args(["--foreground", "--json"])
        .env("SNAPBACK2_COMPILER", compiler)
        .env("SNAPBACK2_MEDIA", &missing)
        .output()
        .unwrap();
    assert!(!refused.status.success());
    assert!(
        String::from_utf8_lossy(&refused.stdout).contains("E_ASSET_NOT_READY"),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&refused.stdout),
        String::from_utf8_lossy(&refused.stderr)
    );
    fs::remove_dir_all(image_root).unwrap();

    let video_root = fixture_root();
    let image_schema = fs::read(video_root.join("snapback/schema.q")).unwrap();
    let image_media = fs::read(video_root.join("snapback/media.q")).unwrap();
    let image_seed = fs::read(video_root.join("snapback/seed.ts")).unwrap();
    make_video_only(&video_root);
    let mut owner = Owner::spawn(&video_root, &missing);
    let port = owner.port();
    let state: Value =
        serde_json::from_slice(&fs::read(video_root.join(".snapback/owner.json")).unwrap())
            .unwrap();
    let secret = state["secret"].as_str().unwrap();
    let active_generation = state["generation"].as_str().unwrap().to_owned();

    // Let the source watcher establish its video-only fingerprint, then offer
    // it a successor whose schema and programs require image support.
    thread::sleep(Duration::from_millis(300));
    fs::write(video_root.join("snapback/schema.q"), image_schema).unwrap();
    fs::write(video_root.join("snapback/media.q"), image_media).unwrap();
    fs::write(video_root.join("snapback/seed.ts"), image_seed).unwrap();
    let refused = wait_for(Duration::from_secs(8), || {
        let response = json_request(
            port,
            "GET",
            "/control/status",
            &[("X-Snapback-Control", secret)],
            json!({}),
        );
        if response.status != 200 {
            return None;
        }
        let body = response.json();
        body["status"]["refused"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item["code"] == "E_ASSET_NOT_READY"))
            .then_some(body)
    });
    assert_eq!(refused["status"]["state"], "refused", "{refused}");
    assert_eq!(
        refused["generation"], active_generation,
        "the image successor must not become active without its helper: {refused}"
    );
    let stopped = json_request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "video-only helper boot and apply test" }),
    );
    assert_eq!(stopped.status, 200);
    assert!(owner.child.wait().unwrap().success());
    fs::remove_dir_all(video_root).unwrap();
}
