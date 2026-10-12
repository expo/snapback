//! Assets on the wire: `POST /assets` takes the bytes and answers with the
//! asset's facts; `GET /assets/<id>` serves them to a viewer the home row's
//! read rule admits (LLP 1006 carried into Snapback 4). A one-view image is
//! served once per principal and never cached anywhere; a deleted, cleared
//! or expired home stops the bytes at the server. A `file` (LLP 3000.038)
//! is uploaded with `?as=file&name=` and its declared `Content-Type`, which
//! the server verifies against the bytes; it is only ever served as an
//! attachment under `nosniff` and a sandboxing CSP.

use crate::serve::{Shared, cors, lock, producing_engine, principal_of, refusal_json, respond};
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
    match producing_engine(shared).file_upload_ceiling() {
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
                producing_engine(shared).prepare_file(&principal, content_type, name, body.len() as u64, shared.now())?
            }
            None => {
                let sniffed = snapback4_core::assets::sniff(&body)?;
                producing_engine(shared).prepare_asset(&principal, sniffed, body.len() as u64, shared.now())?
            }
        };
        #[cfg(test)] crate::serve::test_work(&shared.upload_work);
        let upload = if let Some(id) = intent { upload.with_intent(id, &fingerprint).with_placement(placement.unwrap()) } else { upload };
        let upload = upload.write(&body)?;
        // Logout while disk I/O was in flight cannot publish a new asset.
        principal_of(&request, shared).map_err(|_| snapback4_core::RuntimeError::Auth("sign in again".into()))?;
