//! Assets on the wire: `POST /assets` takes the bytes and answers with the
//! asset's facts; `GET /assets/<id>` serves them to a viewer the home row's
//! read rule admits (LLP 1006 carried into Snapback 4). A one-view image is
//! served once per principal and never cached anywhere; a deleted, cleared
//! or expired home stops the bytes at the server.

use crate::serve::{Shared, cors, lock, principal_of, refusal_json, respond};
use serde_json::json;
use snapback4_core::error::Refusal;
use std::io::{self, Read as _, Seek, SeekFrom};
use tiny_http::{Header, Request, Response};

/// The most an upload may be when no column bounds it yet: the request is
/// refused before the schema is consulted.
pub const UPLOAD_CEILING: usize = 64 << 20;

pub struct UploadPermit<'a>(&'a std::sync::atomic::AtomicUsize);
pub fn admit(shared: &Shared) -> Option<UploadPermit<'_>> {
    use std::sync::atomic::Ordering;
    shared.uploads.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < 2).then_some(n + 1)).ok()?;
    Some(UploadPermit(&shared.uploads))
}
impl Drop for UploadPermit<'_> {
    fn drop(&mut self) { self.0.fetch_sub(1, std::sync::atomic::Ordering::Release); }
}

pub fn upload(request: Request, body: Vec<u8>, shared: &Shared) {
    let principal = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    if body.is_empty() {
        return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_ASSET_TYPE", "asset", "the upload is empty: POST the file's bytes as the body").guide("assets")) }));
    }
    let stored = (|| {
        let sniffed = snapback4_core::assets::sniff(&body)?;
        let upload = lock(&shared.engine).prepare_asset(&principal, sniffed, body.len() as u64, shared.now())?;
        #[cfg(test)] crate::serve::test_work(&shared.upload_work);
        let upload = upload.write(&body)?;
        // Logout while disk I/O was in flight cannot publish a new asset.
        principal_of(&request, shared).map_err(|_| snapback4_core::RuntimeError::Auth("sign in again".into()))?;
        lock(&shared.engine).finish_asset(upload)
    })();
    match stored {
        Ok(asset) => respond(request, 200, json!({ "asset": { "id": asset.id, "type": asset.content_type, "bytes": asset.bytes, "width": asset.width, "height": asset.height, "duration": asset.duration } })),
        Err(error) => {
            let refusal = error.refusal();
            snapback4_core::diagnostic!("{} at POST /assets: {}", refusal.code, refusal.message);
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
    let range_requested = request.headers().iter().any(|h| h.field.equiv("range"));
    let granted = lock(&shared.engine).asset_access_request(&principal, id, shared.now(), range_requested);
    let grant = match granted {
        Ok(grant) => grant,
        Err(error) => {
            let refusal = error.refusal();
            let status = match refusal.code.as_str() {
                "E_ASSET_VIEWED" => 410,
                "E_ASSET_RANGE" => 416,
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
    let range = request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("range"))
        .map(|h| byte_range(h.value.as_str(), total)).unwrap_or(ByteRange::Ignore);
    if range == ByteRange::Unsatisfiable {
        let mut response = Response::empty(416);
        response.add_header(Header::from_bytes("Content-Range", format!("bytes */{total}")).unwrap());
        response.add_header(Header::from_bytes("Cache-Control", "private, no-store").unwrap());
        response.add_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap());
        for header in cors(&request).into_iter().chain(crate::serve::latency::header()) { response.add_header(header); }
        let _ = request.respond_checked_with_completion(response, |_| crate::serve::latency::finished(true));
        return;
    }
    let mut headers = vec![
        Header::from_bytes("Content-Type", grant.content_type.as_str()).unwrap(),
        Header::from_bytes("Accept-Ranges", if grant.once { "none" } else { "bytes" }).unwrap(),
        Header::from_bytes("Cache-Control", "private, no-store").unwrap(),
        Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap(),
        Header::from_bytes("Access-Control-Expose-Headers", "content-length, content-range, accept-ranges, x-snapback-asset-home").unwrap(),
    ];
    // @ref LLP 3000.019#3.5 — only the download's ledger home authorizes retention.
    if let Some((table, row, column)) = &grant.home {
        let receipt = json!({"store_id":grant.store_id,"table":table,"row":row,"column":column}).to_string();
        // Percent-encoded UTF-8 keeps arbitrary row identities safe in an ASCII header.
        let encoded: String = receipt.bytes().map(|byte| format!("%{byte:02X}")).collect();
        headers.push(Header::from_bytes("X-Snapback-Asset-Home", encoded).unwrap());
    }
    headers.extend(cors(&request));
    headers.extend(crate::serve::latency::header());
    let (status, start, length) = match range {
        ByteRange::Satisfiable(start, end) => {
            headers.push(Header::from_bytes("Content-Range", format!("bytes {start}-{end}/{total}")).unwrap());
            (206, start, end - start + 1)
        }
        ByteRange::Ignore => (200, 0, total),
        ByteRange::Unsatisfiable => unreachable!("handled above"),
    };
    if start > 0 && file.seek(SeekFrom::Start(start)).is_err() {
        return respond(request, 500, json!({ "denied": refusal_json(&Refusal::new("E_STORE", "store", "cannot read the bytes")) }));
    }
    let reader = ExactReader { inner: file.take(length), remaining: length };
    let mut response = Response::new(tiny_http::StatusCode(status), headers, reader, Some(length as usize), None);
    if status == 206 {
        response = response.with_status_code(206);
    }
    // @ref LLP 3000.019#3.7 — finish before reader disposal and one-view bookkeeping.
    let delivered = request.respond_checked_with_completion(response, |result| crate::serve::latency::finished(result.is_err()));
    if grant.once && delivered.is_ok() {
        if let Err(error) = lock(&shared.engine).record_asset_view(&principal, id, shared.now()) {
            snapback4_core::diagnostic!("snapback4: one-view asset {id} was delivered to {principal}, but its view could not be recorded: {error}");
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ByteRange {
    Ignore,
    Unsatisfiable,
    Satisfiable(u64, u64),
}

/// One `bytes=a-b` range, clamped. A valid interval outside the file is
/// distinguished from malformed syntax so the former receives HTTP 416.
fn byte_range(header: &str, total: u64) -> ByteRange {
    let Some((unit, spec)) = header.trim().split_once('=') else { return ByteRange::Ignore; };
    if !unit.eq_ignore_ascii_case("bytes") || spec.contains(',') { return ByteRange::Ignore; }
    let Some((start, end)) = spec.split_once('-') else { return ByteRange::Ignore; };
    if end.contains('-') { return ByteRange::Ignore; }
    let parse = |part: &str| -> Result<Option<u64>, ()> {
        let part = part.trim();
        if part.is_empty() { Ok(None) } else { part.parse().map(Some).map_err(|_| ()) }
    };
    let (start, end) = match (parse(start), parse(end)) {
        (Ok(start), Ok(end)) if start.is_some() || end.is_some() => (start, end),
        _ => return ByteRange::Ignore,
    };
    match (start, end) {
        (Some(start), end) => {
            if total == 0 || start >= total { return ByteRange::Unsatisfiable; }
            let end = end.unwrap_or(total - 1).min(total - 1);
            if start > end { ByteRange::Unsatisfiable } else { ByteRange::Satisfiable(start, end) }
        }
        (None, Some(0)) => ByteRange::Unsatisfiable,
        (None, Some(suffix)) if total > 0 => ByteRange::Satisfiable(total.saturating_sub(suffix), total - 1),
        (None, Some(_)) => ByteRange::Unsatisfiable,
        (None, None) => ByteRange::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_ranges_distinguish_invalid_and_unsatisfiable_requests() {
        assert_eq!(byte_range("bytes=1-3", 10), ByteRange::Satisfiable(1, 3));
        assert_eq!(byte_range("bytes=8-30", 10), ByteRange::Satisfiable(8, 9));
        assert_eq!(byte_range("bytes=-3", 10), ByteRange::Satisfiable(7, 9));
        assert_eq!(byte_range("bytes=10-20", 10), ByteRange::Unsatisfiable);
        assert_eq!(byte_range("bytes=7-3", 10), ByteRange::Unsatisfiable);
        assert_eq!(byte_range("bytes=-0", 10), ByteRange::Unsatisfiable);
        assert_eq!(byte_range("bytes=wat", 10), ByteRange::Ignore);
        assert_eq!(byte_range("items=1-3", 10), ByteRange::Ignore);
    }
}
