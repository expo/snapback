//! Assets on the wire: `POST /assets` takes the bytes and answers with the
//! asset's facts; `GET /assets/<id>` serves them to a viewer the home row's
//! read rule admits (LLP 1006 carried into Snapback 4). A one-view image is
//! served once per principal and never cached anywhere; a deleted, cleared
//! or expired home stops the bytes at the server. A `file` (LLP 3000.038)
//! is uploaded with `?as=file&name=` and its declared `Content-Type`, which
//! the server verifies against the bytes; it is only ever served as an
//! attachment under `nosniff` and a sandboxing CSP.

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

/// Whether `POST /assets` carries `as=file`.
pub fn is_file_upload(url: &str) -> bool {
    crate::serve::query_params(url).get("as").is_some_and(|kind| kind == "file")
}

/// The most bytes a file upload may stream: the schema's largest file
/// bound, under the general upload ceiling. A schema with no file column
/// refuses before any body is read.
pub fn file_ceiling(shared: &Shared) -> Result<usize, Refusal> {
    match lock(&shared.engine).file_upload_ceiling() {
        Some(max) => Ok((max as usize).min(UPLOAD_CEILING)),
        None => Err(Refusal::new("E_ASSET_TYPE", "asset", "no column of this backend takes a file; declare one (`doc: file <=10000000`)").guide("assets")),
    }
}

pub fn upload(request: Request, body: Vec<u8>, shared: &Shared) {
    let principal = match principal_of(&request, shared) {
        Ok(principal) => principal.0,
        Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    if body.is_empty() {
        return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_ASSET_TYPE", "asset", "the upload is empty: POST the file's bytes as the body").guide("assets")) }));
    }
    let params = crate::serve::query_params(request.url());
    let file = match params.get("as").map(String::as_str) {
        None | Some("image" | "video") => None,
        Some("file") => Some(params.get("name").cloned().unwrap_or_default()),
        Some(other) => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("as={other} is not an upload kind; use as=file for a document, or omit it for an image or video")).guide("assets")) })),
    };
    let declared = match crate::serve::single_header(&request, "content-type") {
        Ok(value) => snapback4_core::assets::declared_type(value),
        Err(()) => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "send one Content-Type header").guide("assets")) })),
    };
    let intent = params.get("intent").map(String::as_str);
    if intent.is_some_and(|id| id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')) {
        return respond(request, 400, json!({"denied": Refusal::new("E_INPUT", "input", "intent is 1–128 ASCII letters, digits, hyphens or underscores")}));
    }
    use sha2::{Digest, Sha256};
    let fingerprint = snapback4_core::value::digest(&(format!("{:x}", Sha256::digest(&body)), &file.as_ref().map(|name| snapback4_core::assets::sanitize_name(name)), &declared));
    let expected_store = params.get("store_id");
    if intent.is_some() && expected_store.is_none() { return respond(request,400,json!({"denied":Refusal::new("E_INPUT","input","intent uploads require store_id from the identified backend")})); }
    let stored = (|| {
        if let Some(expected) = expected_store {
            if lock(&shared.engine).store().meta("store_id")?.as_ref() != Some(expected) {
                return Err(snapback4_core::RuntimeError::Structural { code: "E_STORE_REPLACED", message: "upload intent belongs to another backend store".into() });
            }
        }
        if let Some(id) = intent {
            if let Some(asset) = lock(&shared.engine).asset_intent(&principal, id, &fingerprint)? { return Ok(asset); }
        }
        let placement=if let Some(id)=intent {Some(lock(&shared.engine).asset_declaration(&principal,id)?.ok_or_else(||snapback4_core::RuntimeError::Asset{code:"E_UPLOAD_INTENT",message:"declare this intent's immutable placement before sending its bytes".into()} )?)}else{None};
        let upload = match &file {
            // @ref LLP 3000.038#2 — the declared type is verified against the bytes before admission.
            Some(name) => {
                let content_type = snapback4_core::assets::verify_file(&body, declared.as_deref())?;
                lock(&shared.engine).prepare_file(&principal, content_type, name, body.len() as u64, shared.now())?
            }
            None => {
                let sniffed = snapback4_core::assets::sniff(&body)?;
                lock(&shared.engine).prepare_asset(&principal, sniffed, body.len() as u64, shared.now())?
            }
        };
        #[cfg(test)] crate::serve::test_work(&shared.upload_work);
        let upload = if let Some(id) = intent { upload.with_intent(id, &fingerprint).with_placement(placement.unwrap()) } else { upload };
        let upload = upload.write(&body)?;
        // Logout while disk I/O was in flight cannot publish a new asset.
        principal_of(&request, shared).map_err(|_| snapback4_core::RuntimeError::Auth("sign in again".into()))?;
        let mut engine = lock(&shared.engine);
        if let Some(expected) = expected_store {
            if engine.store().meta("store_id")?.as_ref() != Some(expected) { return Err(snapback4_core::RuntimeError::Structural {code:"E_STORE_REPLACED",message:"upload store changed during disk write".into()}); }
        }
        engine.finish_asset(upload)
    })();
    match stored {
        Ok(asset) => {
            let mut facts = json!({ "id": asset.id, "type": asset.content_type, "bytes": asset.bytes, "width": asset.width, "height": asset.height, "duration": asset.duration });
            if let Some(name) = asset.name { facts["name"] = json!(name); }
            respond(request, 200, json!({ "asset": facts }))
        }
        Err(error) => {
            let refusal = error.refusal();
            snapback4_core::diagnostic!("{} at POST /assets: {}", refusal.code, refusal.message);
            respond(request, if refusal.retryable { 503 } else { 200 }, json!({ "denied": refusal_json(&refusal) }))
        }
    }
}

pub fn serve(request: Request, id: &str, shared: &Shared) {
    let (principal, _, scope) = match principal_of(&request, shared) {
        Ok(capability) => capability,
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
    // @ref LLP 3000.033#1.5 — refuse only an otherwise successful once grant,
    // after authorization/range/viewed checks and before opening any bytes.
    if grant.once && scope == snapback4_core::identity::SessionScope::Read {
        return respond(request, 403, json!({"denied": Refusal::new("E_ASSET_READ_ONLY", "asset", "this read session cannot consume a view-once asset").guide("read-only")}));
    }
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
    let attachment = grant.kind == snapback4_core::assets::AssetKind::File;
    let content_type = if attachment && grant.content_type.starts_with("text/") { format!("{}; charset=utf-8", grant.content_type) } else { grant.content_type.clone() };
    let mut headers = vec![
        Header::from_bytes("Content-Type", content_type.as_str()).unwrap(),
        Header::from_bytes("Accept-Ranges", if grant.once { "none" } else { "bytes" }).unwrap(),
        Header::from_bytes("Cache-Control", "private, no-store").unwrap(),
        Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap(),
        Header::from_bytes("Access-Control-Expose-Headers", "content-length, content-range, accept-ranges, content-disposition, x-snapback-asset-home").unwrap(),
    ];
    // @ref LLP 3000.038#5 — a file is always a download: never rendered inline, never sniffed, nothing active even if navigated to.
    if attachment {
        let name = grant.name.as_deref().unwrap_or("file");
        headers.push(Header::from_bytes("Content-Disposition", snapback4_core::assets::attachment_disposition(name)).unwrap());
        headers.push(Header::from_bytes("Content-Security-Policy", "default-src 'none'; sandbox").unwrap());
    }
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

/// A durable cancellation tombstone closes cancellation versus staged-file commit.
pub fn cancel(request: Request, id: &str, shared: &Shared) {
    let principal = match principal_of(&request, shared) { Ok(p) => p.0, Err(why) => return respond(request, 401, json!({"denied":refusal_json(&why)})) };
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return respond(request, 400, json!({"denied":Refusal::new("E_INPUT","input","invalid upload intent id")}));
    }
    let params = crate::serve::query_params(request.url());
    let mut engine = lock(&shared.engine);
    let result = if params.get("store_id") != engine.store().meta("store_id").ok().flatten().as_ref() {
        Err(snapback4_core::RuntimeError::Structural {code:"E_STORE_REPLACED",message:"cancellation belongs to another backend store".into()})
    } else { engine.cancel_asset_intent(&principal,id) };
    drop(engine);
    match result { Ok(()) => respond(request,200,json!({"ok":true})), Err(e) => respond(request,200,json!({"denied":refusal_json(&e.refusal())})) }
}

/// Finalize only a reported terminal refusal; an existing bound execution always wins.
pub fn finish(request: Request, id: &str, body: Vec<u8>, shared: &Shared) {
    let principal = match principal_of(&request,shared) { Ok(p)=>p.0,Err(why)=>return respond(request,401,json!({"denied":refusal_json(&why)})) };
    let params = crate::serve::query_params(request.url());
    let result = (|| {
        let payload: serde_json::Value = serde_json::from_slice(&body).map_err(|e| snapback4_core::RuntimeError::Input(e.to_string()))?;
        let name = payload.get("op").and_then(serde_json::Value::as_str).ok_or_else(|| snapback4_core::RuntimeError::Input("finalization needs op".into()))?;
        let args = payload.get("args").ok_or_else(|| snapback4_core::RuntimeError::Input("finalization needs args".into()))?;
        let why: Refusal = serde_json::from_value(payload.get("why").cloned().unwrap_or_default()).map_err(|e| snapback4_core::RuntimeError::Input(e.to_string()))?;
        let mut engine = lock(&shared.engine);
        if params.get("store_id") != engine.store().meta("store_id")?.as_ref() { return Err(snapback4_core::RuntimeError::Structural {code:"E_STORE_REPLACED",message:"finalization belongs to another backend store".into()}); }
        engine.finish_asset_intent(&principal,id,name,args,&why)
    })();
    match result { Ok(outcome) => respond(request,200,outcome.receipt(Some(id))), Err(error)=>respond(request,200,json!({"denied":refusal_json(&error.refusal())})) }
}

/// Owner-only pinned-intent inventory gives storage-loss victims a bounded cleanup path.
pub fn intents(request: Request, shared: &Shared) {
    let principal = match principal_of(&request,shared) { Ok(p)=>p.0,Err(why)=>return respond(request,401,json!({"denied":refusal_json(&why)})) };
    let params=crate::serve::query_params(request.url());
    let mut engine=lock(&shared.engine);
    let result=(|| {
        if params.get("store_id") != engine.store().meta("store_id")?.as_ref() { return Err(snapback4_core::RuntimeError::Structural {code:"E_STORE_REPLACED",message:"intent inventory requires the current backend store_id".into()}); }
        let after=params.get("after").map(String::as_str).unwrap_or("");
        if after.len()>128 { return Err(snapback4_core::RuntimeError::Input("invalid intent continuation".into())); }
        engine.pending_asset_intents(&principal,after)
    })();
    drop(engine);
    match result {Ok(json)=>respond(request,200,json),Err(error)=>respond(request,200,json!({"denied":refusal_json(&error.refusal())}))}
}

/// A bounded declaration binds byte fingerprint and placement before any byte request.
pub fn declare(request:Request,id:&str,body:Vec<u8>,shared:&Shared){
    let principal=match principal_of(&request,shared){Ok(p)=>p.0,Err(why)=>return respond(request,401,json!({"denied":refusal_json(&why)}))};
    let params=crate::serve::query_params(request.url());
    let result=(||{
        if id.is_empty()||id.len()>128||!id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){return Err(snapback4_core::RuntimeError::Input("invalid upload intent id".into()));}
        let payload:serde_json::Value=serde_json::from_slice(&body).map_err(|e|snapback4_core::RuntimeError::Input(e.to_string()))?;
        let digest=payload["digest"].as_str().filter(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).ok_or_else(||snapback4_core::RuntimeError::Input("declaration needs SHA-256 of the selected bytes".into()))?;
        let placement=&payload["placement"];
        let argument=placement["argument"].as_str().filter(|a|!a.is_empty()).ok_or_else(||snapback4_core::RuntimeError::Input("declaration needs its asset argument".into()))?;
        if placement["op"].as_str().is_none()||!placement["args"].is_object()||placement["args"].get(argument).is_some(){return Err(snapback4_core::RuntimeError::Input("declare op and placing args omitting the asset argument".into()));}
        let file=payload.get("file").map(|f|snapback4_core::assets::sanitize_name(f["name"].as_str().unwrap_or("")));
        let declared=payload.get("file").and_then(|f|snapback4_core::assets::declared_type(f["type"].as_str()));
        let fingerprint=snapback4_core::value::digest(&(digest,file,declared));
        let mut engine=lock(&shared.engine);
        if params.get("store_id")!=engine.store().meta("store_id")?.as_ref(){return Err(snapback4_core::RuntimeError::Structural{code:"E_STORE_REPLACED",message:"declaration belongs to another backend store".into()});}
        engine.declare_asset_intent(&principal,id,&fingerprint,placement)
    })();
    match result{Ok(())=>respond(request,200,json!({"ok":true})),Err(error)=>respond(request,200,json!({"denied":refusal_json(&error.refusal())}))}
}
