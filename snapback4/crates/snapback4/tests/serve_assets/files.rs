//! File assets over HTTP (LLP 3000.038): declared-plus-sniffed admission,
//! streaming bounds, and attachment-only delivery.
use super::super::*;

const SOURCE: &str = r#"
use personas alice, bob, mallory
use server
table receipts:
  owner: principal
  reader: principal
  scan: file <=4096 ('application/pdf', 'text/plain') ?
  photo: image <=10000000 ?
  read <- .owner = viewer or .reader = viewer
  insert <- .owner = viewer
mutation file(scan: file <=4096 ('application/pdf', 'text/plain')):
  return insert receipts { owner: viewer, reader: 'dev:bob', scan }
"#;

const PDF: &[u8] = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";

fn post(host: &Host, query: &str, content_type: Option<&str>, bytes: &[u8]) -> String {
    let header = content_type.map(|t| format!("Content-Type: {t}\r\n")).unwrap_or_default();
    let mut wire = format!("POST /assets{query} HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n{header}Content-Length: {}\r\n\r\n", bytes.len()).into_bytes();
    wire.extend_from_slice(bytes);
    exchange_bytes(host.address, &wire)
}

fn uploaded(reply: &str) -> Json {
    assert_eq!(status(reply), 200, "{reply}");
    let asset = body(reply)["asset"].clone();
    assert!(asset["id"].is_string(), "{reply}");
    asset
}

fn denied(reply: &str) -> String {
    body(reply)["denied"]["code"].as_str().unwrap_or_else(|| panic!("{reply}")).to_owned()
}

fn place(host: &Host, asset: &Json) {
    let write = json!({"id": format!("place-{}", asset["id"].as_str().unwrap()), "args": {"scan": {"id": asset["id"]}}}).to_string();
    let reply = body(&host.request("POST", "/m/file", "x-snapback-persona: alice\r\n", &write));
    assert_eq!(reply["state"], "sent", "{reply}");
}

fn headers(reply: &str) -> String { reply.split_once("\r\n\r\n").unwrap().0.to_ascii_lowercase() }

#[test]
fn a_pdf_uploads_with_its_name_and_downloads_only_as_an_attachment() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let asset = uploaded(&post(&host, "?as=file&name=Lab%20results%20%C3%A9.pdf", Some("application/pdf"), PDF));
    assert_eq!((asset["type"].as_str(), asset["name"].as_str(), asset["bytes"].as_u64()), (Some("application/pdf"), Some("Lab results é.pdf"), Some(PDF.len() as u64)));
    place(&host, &asset);
    let path = format!("/assets/{}", asset["id"].as_str().unwrap());
    let reply = host.request("GET", &path, "x-snapback-persona: bob\r\n", "");
    assert_eq!(status(&reply), 200, "{reply}");
    let head = headers(&reply);
    for expected in ["content-type: application/pdf\r\n", "content-disposition: attachment; filename=\"lab results _.pdf\"; filename*=utf-8''lab%20results%20%c3%a9.pdf",
        "x-content-type-options: nosniff", "content-security-policy: default-src 'none'; sandbox", "cache-control: private, no-store", "accept-ranges: bytes"] {
        assert!(head.contains(expected), "missing {expected}: {head}");
    }
    assert!(reply.ends_with(std::str::from_utf8(PDF).unwrap()), "{reply}");
    // Ranges work on a file (resumable downloads, PDF viewers).
    let ranged = host.request("GET", &path, "x-snapback-persona: bob\r\nRange: bytes=0-4\r\n", "");
    assert_eq!(status(&ranged), 206, "{ranged}");
    assert!(ranged.ends_with("%PDF-") && headers(&ranged).contains("content-disposition: attachment"), "{ranged}");
    // The home row's read rule decides; everyone else sees nothing.
    let hidden = host.request("GET", &path, "x-snapback-persona: mallory\r\n", "");
    assert_eq!(status(&hidden), 404);
    assert_eq!(denied(&hidden), "E_ASSET_UNKNOWN");
}

#[test]
fn script_bearing_spoofed_and_unaccepted_types_are_refused() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    for (content_type, bytes) in [
        (Some("text/html"), b"<html><script>alert(1)</script></html>".as_slice()),
        (Some("image/svg+xml"), b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>".as_slice()),
        // Spoofed MIME: declared PDF, the bytes are HTML.
        (Some("application/pdf"), b"<html><body>not a pdf</body></html>".as_slice()),
        // A PNG declared as a PDF.
        (Some("application/pdf"), b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01".as_slice()),
        // Verifiable, but no file column here accepts CSV.
        (Some("text/csv"), b"a,b\n1,2\n".as_slice()),
        // Text is never guessed without a declaration.
        (None, b"just words".as_slice()),
    ] {
        let reply = post(&host, "?as=file&name=x", content_type, bytes);
        assert_eq!(denied(&reply), "E_ASSET_TYPE", "{content_type:?}: {reply}");
    }
    // A PDF needs no declaration: its magic number names it.
    let named = uploaded(&post(&host, "?as=file&name=", Some("application/octet-stream"), PDF));
    assert_eq!((named["type"].as_str(), named["name"].as_str()), (Some("application/pdf"), Some("file")));
    let unknown = post(&host, "?as=document", Some("application/pdf"), PDF);
    assert_eq!((status(&unknown), denied(&unknown)), (400, "E_INPUT".into()));
}

#[test]
fn oversize_files_are_refused_before_and_while_streaming() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    // Declared over the largest file bound: refused before any body is read.
    let head = "POST /assets?as=file&name=big.pdf HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\nContent-Type: application/pdf\r\nContent-Length: 1000000\r\n\r\n";
    let reply = exchange_bytes(host.address, head.as_bytes());
    assert_eq!((status(&reply), denied(&reply)), (413, "E_ASSET_TOO_LARGE".into()), "{reply}");
    // Chunked with no declared length: the read stops one byte past the bound.
    let mut wire = b"POST /assets?as=file&name=big.pdf HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\nContent-Type: application/pdf\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
    let chunk = [b"%PDF-".as_slice(), &[b'a'; 5000]].concat();
    wire.extend_from_slice(format!("{:x}\r\n", chunk.len()).as_bytes());
    wire.extend_from_slice(&chunk);
    wire.extend_from_slice(b"\r\n0\r\n\r\n");
    let reply = exchange_bytes(host.address, &wire);
    assert_eq!((status(&reply), denied(&reply)), (413, "E_ASSET_TOO_LARGE".into()), "{reply}");
    // The media path keeps its own ceiling: a large image body is not bounded by the file column.
    let media = post(&host, "", None, &[b'x'; 8000]);
    assert_eq!(denied(&media), "E_ASSET_TYPE", "{media}");
}

#[test]
fn html_uploaded_as_text_is_served_as_text_never_inline() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let html = b"<html><script>document.cookie</script></html>";
    let asset = uploaded(&post(&host, "?as=file&name=page.html", Some("text/plain"), html));
    assert_eq!(asset["type"], "text/plain");
    place(&host, &asset);
    let reply = host.request("GET", &format!("/assets/{}", asset["id"].as_str().unwrap()), "x-snapback-persona: bob\r\n", "");
    assert_eq!(status(&reply), 200, "{reply}");
    let head = headers(&reply);
    assert!(head.contains("content-type: text/plain; charset=utf-8\r\n"), "{head}");
    assert!(!head.contains("text/html"), "{head}");
    assert!(head.contains("content-disposition: attachment; filename=\"page.html\""), "{head}");
    assert!(head.contains("x-content-type-options: nosniff") && head.contains("sandbox"), "{head}");
}

#[test]
fn a_hostile_filename_cannot_inject_headers_or_paths() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let asset = uploaded(&post(&host, "?as=file&name=..%2F..%2Fetc%2Fevil%0D%0ASet-Cookie%3A%20x%3D1%E2%80%AEfdp.pdf", Some("application/pdf"), PDF));
    assert_eq!(asset["name"], "evilSet-Cookie: x=1fdp.pdf");
    place(&host, &asset);
    let reply = host.request("GET", &format!("/assets/{}", asset["id"].as_str().unwrap()), "x-snapback-persona: alice\r\n", "");
    let head = headers(&reply);
    assert!(!head.contains("\r\nset-cookie"), "{head}");
    assert!(head.contains("filename=\"evilset-cookie: x=1fdp.pdf\""), "{head}");
}

#[test]
fn media_uploads_are_unchanged_and_a_schema_without_files_refuses_file_uploads() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let image = uploaded(&post(&host, "", Some("application/octet-stream"), png));
    assert!(image.get("name").is_none(), "media facts gain no name: {image}");
    let preview = host.request("GET", &format!("/assets/{}", image["id"].as_str().unwrap()), "x-snapback-persona: alice\r\n", "");
    assert!(!headers(&preview).contains("\r\ncontent-disposition:"), "images stay inline: {preview}");
    let bare = Host::with_store(true, snapback4_core::Store::memory().unwrap(), "use personas alice\nuse server\ntable photos:\n  photo: image <=1000\n  read <- allow\n");
    let reply = post(&bare, "?as=file&name=a.pdf", Some("application/pdf"), PDF);
    assert_eq!((status(&reply), denied(&reply)), (415, "E_ASSET_TYPE".into()), "{reply}");
}
