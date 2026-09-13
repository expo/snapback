//! Assets on the wire: `POST /assets` takes the bytes and answers with the
//! asset's facts; `GET /assets/<id>` serves them to a viewer the home row's
//! read rule admits (LLP 1006 carried into Snapback 4). A one-view image is
//! served once per principal and never cached anywhere; a deleted, cleared
//! or expired home stops the bytes at the server.

use crate::serve::{Shared, lock, principal_of, refusal_json, respond};
use serde_json::json;
use snapback4_core::error::Refusal;
use std::io::{self, Read as _, Seek, SeekFrom};
use tiny_http::{Header, Request, Response};

/// The most an upload may be when no column bounds it yet: the request is
/// refused before the schema is consulted.
pub const UPLOAD_CEILING: usize = 64 << 20;

pub fn upload(request: Request, body: Vec<u8>, shared: &Shared) {
    let principal = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    if body.is_empty() {
        return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_ASSET_TYPE", "asset", "the upload is empty: POST the file's bytes as the body").guide("assets")) }));
    }
    let stored = lock(&shared.engine).store_asset(&principal, &body, snapback4_core::now_ms());
    match stored {
        Ok(asset) => respond(request, 200, json!({ "asset": { "id": asset.id, "type": asset.content_type, "bytes": asset.bytes, "width": asset.width, "height": asset.height, "duration": asset.duration } })),
        Err(error) => {
            let refusal = error.refusal();
            respond(request, if refusal.retryable { 503 } else { 200 }, json!({ "denied": refusal_json(&refusal) }))
        }
    }
}

pub fn serve(request: Request, id: &str, shared: &Shared) {
    let principal = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_ASSET_UNKNOWN", "asset", "no asset is served under that id to this viewer").guide("assets")) }));
    }
    let _transfer = shared.asset_transfers.enter(id, &principal);
    let granted = lock(&shared.engine).asset_access(&principal, id, snapback4_core::now_ms());
    let grant = match granted {
        Ok(grant) => grant,
        Err(error) => {
            let refusal = error.refusal();
            let status = match refusal.code.as_str() {
                "E_ASSET_VIEWED" => 410,
                "E_ASSET_UNKNOWN" => 404,
                _ if refusal.retryable => 503,
                _ => 500,
            };
            return respond(request, status, json!({ "denied": refusal_json(&refusal) }));
        }
    };
    let Ok(mut file) = std::fs::File::open(&grant.path) else {
        return respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_ASSET_UNKNOWN", "asset", "the bytes are gone").guide("assets")) }));
    };
    let total = grant.bytes;
    let range_header = request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("range"));
    if grant.once && range_header.is_some() {
        return respond(request, 416, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "a one-view photo must be fetched as one complete response; retry without Range").guide("assets")) }));
    }
    let range = range_header.and_then(|h| byte_range(h.value.as_str(), total));
    let mut headers = vec![
        Header::from_bytes("Content-Type", grant.content_type.as_str()).unwrap(),
        Header::from_bytes("Accept-Ranges", "bytes").unwrap(),
        Header::from_bytes("Cache-Control", if grant.once { "private, no-store" } else { "private, max-age=31536000, immutable" }).unwrap(),
        Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap(),
        Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
        Header::from_bytes("Access-Control-Expose-Headers", "content-length, content-range, accept-ranges").unwrap(),
    ];
    let (status, start, length) = match range {
        Some((start, end)) => {
            headers.push(Header::from_bytes("Content-Range", format!("bytes {start}-{end}/{total}")).unwrap());
            (206, start, end - start + 1)
        }
        None => (200, 0, total),
    };
    if start > 0 && file.seek(SeekFrom::Start(start)).is_err() {
        return respond(request, 500, json!({ "denied": refusal_json(&Refusal::new("E_STORE", "store", "cannot read the bytes")) }));
    }
    let reader = ExactReader { inner: file.take(length), remaining: length };
    let mut response = Response::new(tiny_http::StatusCode(status), headers, reader, Some(length as usize), None);
    if status == 206 {
        response = response.with_status_code(206);
    }
    let delivered = request.respond_checked(response);
    if grant.once && delivered.is_ok() {
        if let Err(error) = lock(&shared.engine).record_asset_view(&principal, id, snapback4_core::now_ms()) {
            eprintln!("snapback4: one-view asset {id} was delivered to {principal}, but its view could not be recorded: {error}");
        }
    }
}

/// `io::copy` considers an early EOF successful. Convert it to an error so a
/// truncated asset cannot consume a one-view grant after a short response.
struct ExactReader<R> {
    inner: R,
    remaining: u64,
}

impl<R: io::Read> io::Read for ExactReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 || buffer.is_empty() {
            return Ok(0);
        }
        let wanted = buffer.len().min(self.remaining as usize);
        let read = self.inner.read(&mut buffer[..wanted])?;
        if read == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the asset ended before its recorded byte count"));
        }
        self.remaining -= read as u64;
        Ok(read)
    }
}

/// One `bytes=a-b` range, clamped; anything else is the whole file.
fn byte_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    let (start, end) = match (start.trim().parse::<u64>().ok(), end.trim().parse::<u64>().ok()) {
        (Some(start), Some(end)) => (start, end.min(total - 1)),
        (Some(start), None) => (start, total - 1),
        (None, Some(suffix)) => (total.saturating_sub(suffix), total - 1),
        (None, None) => return None,
    };
    (start <= end && start < total).then_some((start, end))
}
