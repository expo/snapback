//! Upload and delivery routes for server-owned asset bytes.

use crate::blob_store::{BlobStore, ByteRange, LocalStaging};
use crate::image_walk::{self, ImageFormat};
use crate::media_helper;
use crate::protocol::{Refusal, refusal_json};
use crate::serve::{
    Context, Query, decorate_asset_response_headers, header, header_value, refusal_status,
    request_identity, respond_json, respond_refusal,
};
use crate::video_walk::{DEFAULT_CEILINGS, walk_and_strip};
use crate::writer::{Action, Identity};
use snapback2_core::{AssetKind, AssetReadyFacts};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use tiny_http::{Request, Response, StatusCode};

pub const IMAGE_WIDTH_RUNGS: &[u32] = &[
    256, 512, 768, 1_024, 1_536, 2_048, 3_072, 4_096, 6_144, 8_192, 12_288, 16_384,
];
const DETECTION_PREFIX_BYTES: u64 = 64 * 1024;
pub const MAX_MEDIA_HELPERS: usize = 2;

#[derive(Clone, Default)]
pub struct MediaJobs(Arc<MediaJobState>);

#[derive(Default)]
struct MediaJobState {
    state: Mutex<MediaJobCounts>,
    changed: Condvar,
}

#[derive(Default)]
struct MediaJobCounts {
    helpers: usize,
    rungs: std::collections::BTreeSet<String>,
}

impl MediaJobs {
    fn helper(&self) -> HelperPermit {
        let mut state = self.0.state.lock().expect("media job lock");
        while state.helpers >= MAX_MEDIA_HELPERS {
            state = self.0.changed.wait(state).expect("media job lock");
        }
        state.helpers += 1;
        HelperPermit(self.clone())
    }

    fn rung(&self, key: &str) -> Option<RungPermit> {
        let mut state = self.0.state.lock().expect("media job lock");
        if state.rungs.insert(key.to_owned()) {
            Some(RungPermit {
                jobs: self.clone(),
                key: key.to_owned(),
            })
        } else {
            None
        }
    }

    fn wait_for_rung(&self, key: &str) {
        let mut state = self.0.state.lock().expect("media job lock");
        while state.rungs.contains(key) {
            state = self.0.changed.wait(state).expect("media job lock");
        }
    }
}

struct HelperPermit(MediaJobs);

impl Drop for HelperPermit {
    fn drop(&mut self) {
        let mut state = self.0.0.state.lock().expect("media job lock");
        state.helpers -= 1;
        self.0.0.changed.notify_one();
    }
}

struct RungPermit {
    jobs: MediaJobs,
    key: String,
}

impl Drop for RungPermit {
    fn drop(&mut self) {
        let mut state = self.jobs.0.state.lock().expect("media job lock");
        state.rungs.remove(&self.key);
        self.jobs.0.changed.notify_all();
    }
}

struct UploadLedgerGuard {
    handle: crate::writer::OwnerHandle,
    id: String,
    settled: bool,
}

impl Drop for UploadLedgerGuard {
    fn drop(&mut self) {
        if !self.settled {
            let _ = self.handle.call(Action::AssetUploadFailed {
                id: self.id.clone(),
            });
        }
    }
}

// @ref LLP 1006#5-upload-one-post — admission checks declared length before
// streaming one request into local staging and finalizing outside the writer.
pub fn handle_upload(mut request: Request, context: &Context, identity: Identity) {
    let content_length = match required_content_length(&request) {
        Ok(length) => length,
        Err(error) => {
            respond_refusal(request, 422, error, &context.mode);
            return;
        }
    };
    let authorization = match context.handle.call(Action::AssetUploadAuthorize {
        bytes: content_length,
        identity: identity.clone(),
    }) {
        Ok(value) => value,
        Err(error) => {
            let status = upload_refusal_status(&error);
            respond_refusal(request, status, error, &context.mode);
            return;
        }
    };
    let mut staging = match context.staging.create() {
        Ok(staging) => staging,
        Err(error) => {
            respond_refusal(request, 500, error, &context.mode);
            return;
        }
    };
    let prefix_bytes = content_length.min(DETECTION_PREFIX_BYTES);
    let copied = match io::copy(
        &mut request.as_reader().take(prefix_bytes),
        staging.file_mut(),
    ) {
        Ok(copied) => copied,
        Err(error) => {
            respond_refusal(
                request,
                422,
                asset_type(format!("cannot stream upload body to staging: {error}")),
                &context.mode,
            );
            return;
        }
    };
    if copied != prefix_bytes {
        respond_refusal(
            request,
            422,
            asset_type(format!(
                "Content-Length declared {content_length} bytes but the detection prefix supplied {copied}"
            )),
            &context.mode,
        );
        return;
    }
    if let Err(error) = staging.flush() {
        respond_refusal(request, 500, error, &context.mode);
        return;
    }

    let detected = match detect_kind(staging.path()) {
        Ok(detected) => detected,
        Err(error) => {
            respond_refusal(request, 422, error, &context.mode);
            return;
        }
    };
    let kind_max = match detected.kind {
        AssetKind::Image => authorization["imageMaxBytes"].as_u64().unwrap_or(0),
        AssetKind::Video => authorization["videoMaxBytes"].as_u64().unwrap_or(0),
    };
    if kind_max == 0 {
        respond_refusal(
            request,
            422,
            asset_type(format!(
                "the active generation declares no {} asset bound",
                detected.kind
            )),
            &context.mode,
        );
        return;
    }
    if content_length > kind_max {
        respond_refusal(
            request,
            422,
            too_large(format!(
                "the detected {} upload has {content_length} bytes, over the generation's {kind_max} byte bound",
                detected.kind
            )),
            &context.mode,
        );
        return;
    }

    let begun = match context.handle.call(Action::AssetUploadBegin {
        kind: detected.kind,
        bytes: content_length,
        identity: identity.clone(),
    }) {
        Ok(value) => value,
        Err(error) => {
            let status = upload_refusal_status(&error);
            respond_refusal(request, status, error, &context.mode);
            return;
        }
    };
    let id = begun["id"].as_str().unwrap_or_default().to_owned();
    let mut ledger = UploadLedgerGuard {
        handle: context.handle.clone(),
        id: id.clone(),
        settled: false,
    };
    let remaining = content_length.saturating_sub(copied);
    let copied_rest = match io::copy(
        &mut request.as_reader().take(remaining.saturating_add(1)),
        staging.file_mut(),
    ) {
        Ok(copied) => copied,
        Err(error) => {
            respond_refusal(
                request,
                422,
                asset_type(format!("cannot stream upload body to staging: {error}")),
                &context.mode,
            );
            return;
        }
    };
    if copied_rest != remaining {
        respond_refusal(
            request,
            422,
            asset_type(format!(
                "Content-Length declared {content_length} bytes but the body supplied {}",
                copied.saturating_add(copied_rest)
            )),
            &context.mode,
        );
        return;
    }
    if let Err(error) = staging.sync_and_close() {
        respond_refusal(request, 500, error, &context.mode);
        return;
    }
    let max = begun["maxBytes"].as_u64().unwrap_or(kind_max);
    let finalized = finalize_asset(
        &context.staging,
        &context.media_jobs,
        staging.path(),
        detected,
        max,
    );
    let facts = match finalized {
        Ok(facts) => facts,
        Err(error) => {
            let _ = context.blobs.delete(&id);
            let status = if error.family == "owner" { 500 } else { 422 };
            respond_refusal(request, status, error, &context.mode);
            return;
        }
    };
    if let Err(error) = context.handle.call(Action::AssetUploadReserve {
        id: id.clone(),
        bytes: facts.bytes,
    }) {
        respond_refusal(request, upload_refusal_status(&error), error, &context.mode);
        return;
    }
    if let Err(error) = publish_finalized(context.blobs.as_ref(), staging.path(), &id, facts.bytes)
    {
        let _ = context.blobs.delete(&id);
        respond_refusal(request, 500, error, &context.mode);
        return;
    }
    match context.handle.call(Action::AssetUploadReady {
        id: id.clone(),
        facts,
    }) {
        Ok(record) => {
            ledger.settled = true;
            respond_json(request, 200, record, &context.mode)
        }
        Err(error) => {
            let _ = context.blobs.delete(&id);
            respond_refusal(request, upload_refusal_status(&error), error, &context.mode);
        }
    }
}

// @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — every full,
// range, conditional, and carrier request obtains current certified row authority first.
pub fn handle_asset_delivery(request: Request, context: &Context, path: &str, query: &Query) {
    let Some(id) = path
        .strip_prefix("/api/asset/")
        .filter(|id| !id.is_empty() && !id.contains('/'))
    else {
        respond_asset_refusal(request, 404, asset_not_ready(), &context.mode);
        return;
    };
    let carrier = query.get("s");
    let has_header_credential =
        header(&request, "Authorization").is_some() || header(&request, "X-Snapback-As").is_some();
    if carrier.is_some() && has_header_credential {
        respond_asset_refusal(
            request,
            400,
            Refusal::new(
                "E_AUTH_AMBIGUOUS",
                "auth",
                "an asset request cannot combine a session carrier with a header credential",
                "send either ?s=<carrier> or one Authorization/X-Snapback-As header",
                "auth/asset-session",
            ),
            &context.mode,
        );
        return;
    }
    let identity = carrier.map_or_else(
        || request_identity(&request),
        |token| Identity::Carrier(token.to_owned()),
    );
    let delivery = match context.handle.call(Action::AssetDelivery {
        id: id.to_owned(),
        identity,
    }) {
        Ok(delivery) => delivery,
        Err(error) => {
            let status = if error.code == "E_ASSET_NOT_READY" {
                404
            } else {
                refusal_status(&error)
            };
            respond_asset_refusal(request, status, error, &context.mode);
            return;
        }
    };
    let public = delivery["public"].as_bool().unwrap_or(false);
    if carrier.is_some() && public {
        let location = query.get("w").map_or_else(
            || format!("/api/asset/{id}"),
            |width| format!("/api/asset/{id}?w={width}"),
        );
        respond_empty(
            request,
            302,
            vec![
                header_value("Location", &location),
                header_value("Cache-Control", "no-store"),
                header_value("Referrer-Policy", "no-referrer"),
            ],
            &context.mode,
        );
        return;
    }

    let kind = delivery["kind"].as_str().unwrap_or_default();
    let source_width = delivery["width"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0);
    let source_type = delivery["type"]
        .as_str()
        .unwrap_or("application/octet-stream");
    let mut key = id.to_owned();
    let mut content_type = source_type.to_owned();
    if kind == "image"
        && let Some(raw_width) = query.get("w")
    {
        let requested = match raw_width.parse::<u32>().ok().filter(|width| *width > 0) {
            Some(width) => width,
            None => {
                respond_asset_refusal(
                    request,
                    422,
                    asset_type("image width must be a positive integer"),
                    &context.mode,
                );
                return;
            }
        };
        let rung = snap_width(requested, source_width);
        if rung < source_width {
            key = format!("{id}.w{rung}");
            match ensure_rung(
                context.blobs.as_ref(),
                &context.staging,
                &context.media_jobs,
                id,
                &key,
                rung,
                delivery["bytes"].as_u64().unwrap_or(0),
            ) {
                Ok(media_type) => content_type = media_type,
                Err(error) => {
                    let status = if error.family == "owner" { 500 } else { 422 };
                    respond_asset_refusal(request, status, error, &context.mode);
                    return;
                }
            }
        }
    }
    let etag = format!("\"{key}\"");
    let cache = if carrier.is_some() {
        "no-store"
    } else if public {
        "public, immutable"
    } else {
        "private, no-cache"
    };
    if !public
        && carrier.is_none()
        && header(&request, "If-None-Match").as_deref() == Some(etag.as_str())
    {
        respond_empty(
            request,
            304,
            delivery_headers(&content_type, cache, Some(&etag)),
            &context.mode,
        );
        return;
    }
    let full_blob = match context.blobs.get(&key, None) {
        Ok(blob) => blob,
        Err(error) => {
            respond_asset_refusal(request, 404, error, &context.mode);
            return;
        }
    };
    let total = full_blob.total;
    let range = match parse_range(header(&request, "Range").as_deref(), total) {
        RangeRequest::Full => None,
        RangeRequest::Partial(range) => Some(range),
        RangeRequest::Unsatisfiable => {
            let mut headers = delivery_headers(&content_type, cache, (!public).then_some(&etag));
            headers.push(header_value("Content-Range", &format!("bytes */{total}")));
            respond_empty(request, 416, headers, &context.mode);
            return;
        }
    };
    let blob = match range {
        None => full_blob,
        Some(range) => match context.blobs.get(&key, Some(range)) {
            Ok(blob) => blob,
            Err(error) => {
                respond_asset_refusal(request, 404, error, &context.mode);
                return;
            }
        },
    };
    let mut headers = delivery_headers(&content_type, cache, (!public).then_some(&etag));
    let status = if let Some(range) = blob.range {
        headers.push(header_value(
            "Content-Range",
            &format!("bytes {}-{}/{}", range.start, range.end, blob.total),
        ));
        206
    } else {
        200
    };
    add_cors(&mut headers, &context.mode);
    decorate_asset_response_headers(request.url(), &mut headers);
    let length = match usize::try_from(blob.length) {
        Ok(length) => length,
        Err(_) => {
            respond_asset_refusal(
                request,
                500,
                asset_type("asset response length exceeds this platform"),
                &context.mode,
            );
            return;
        }
    };
    let response = Response::new(StatusCode(status), headers, blob.stream, Some(length), None)
        .with_chunked_threshold(usize::MAX);
    let _ = request.respond(response);
}

#[derive(Clone, Copy)]
struct Detected {
    kind: AssetKind,
    image: Option<ImageFormat>,
}

fn detect_kind(path: &Path) -> Result<Detected, Refusal> {
    if let Some(image) = image_walk::detect(path)? {
        return Ok(Detected {
            kind: AssetKind::Image,
            image: Some(image),
        });
    }
    if detect_video(path)? {
        return Ok(Detected {
            kind: AssetKind::Video,
            image: None,
        });
    }
    Err(asset_type(
        "upload bytes are not JPEG, PNG, WebP, HEIC, MP4, or QuickTime MOV",
    ))
}

fn detect_video(path: &Path) -> Result<bool, Refusal> {
    let mut file = File::open(path).map_err(|error| {
        Refusal::new(
            "E_OWNER_ASSET_IO",
            "owner",
            format!("cannot open video staging file: {error}"),
            "retry the upload after repairing .snapback/staging",
            "assets/video",
        )
    })?;
    let mut header = [0_u8; 8];
    if file.read_exact(&mut header).is_err() || &header[4..] != b"ftyp" {
        return Ok(false);
    }
    let size = u64::from(u32::from_be_bytes(header[..4].try_into().unwrap()));
    if !(16..=64 * 1024).contains(&size) {
        return Ok(false);
    }
    let mut payload = vec![0_u8; (size - 8) as usize];
    file.read_exact(&mut payload)
        .map_err(|error| asset_type(format!("truncated media file-type box: {error}")))?;
    Ok(payload.chunks_exact(4).enumerate().any(|(index, brand)| {
        index != 1
            && matches!(
                brand,
                b"isom" | b"iso2" | b"mp41" | b"mp42" | b"avc1" | b"qt  "
            )
    }))
}

fn finalize_asset(
    staging: &LocalStaging,
    media_jobs: &MediaJobs,
    path: &Path,
    detected: Detected,
    max: u64,
) -> Result<AssetReadyFacts, Refusal> {
    // @ref LLP 1006#4-admission — detected media is structurally stripped (or
    // HEIC-normalized) before finalized facts are durably reserved and published.
    let (media_type, width, height, duration) = match detected.kind {
        AssetKind::Image => match detected.image.expect("detected image format") {
            ImageFormat::Heic => {
                let normalized = staging.allocate_path("heic-normalized")?;
                let _helper = media_jobs.helper();
                let result = media_helper::normalize_heic(path, &normalized);
                let result = match result {
                    Ok(result) => result,
                    Err(error) => {
                        let _ = fs::remove_file(&normalized);
                        return Err(error);
                    }
                };
                fs::remove_file(path).map_err(asset_file_io)?;
                fs::rename(&normalized, path).map_err(asset_file_io)?;
                let stripped = image_walk::strip(path)?;
                if stripped.format != ImageFormat::Jpeg
                    || result.format != media_helper::MediaFormat::Jpeg
                    || stripped.width != result.width
                    || stripped.height != result.height
                {
                    return Err(asset_type(
                        "HEIC helper facts do not match its normalized JPEG",
                    ));
                }
                (
                    stripped.format.media_type().to_owned(),
                    stripped.width,
                    stripped.height,
                    None,
                )
            }
            _ => {
                let facts = image_walk::strip(path)?;
                (
                    facts.format.media_type().to_owned(),
                    facts.width,
                    facts.height,
                    None,
                )
            }
        },
        AssetKind::Video => {
            let facts = walk_and_strip(path, &DEFAULT_CEILINGS)?;
            (
                facts.detected_type.to_owned(),
                facts.width,
                facts.height,
                Some(facts.duration_ms),
            )
        }
    };
    let bytes = fs::metadata(path).map_err(asset_file_io)?.len();
    if bytes == 0 || bytes > max {
        return Err(too_large(format!(
            "finalized asset has {bytes} bytes, outside the active {max} byte bound"
        )));
    }
    Ok(AssetReadyFacts {
        media_type,
        bytes,
        width: i64::from(width),
        height: i64::from(height),
        duration: duration
            .map(i64::try_from)
            .transpose()
            .map_err(|_| too_large("video duration exceeds the i53 record ceiling"))?,
    })
}

fn publish_finalized(
    store: &dyn BlobStore,
    path: &Path,
    id: &str,
    bytes: u64,
) -> Result<(), Refusal> {
    let mut source = File::open(path).map_err(asset_file_io)?;
    let published = store.put(id, &mut source)?;
    if published != bytes {
        return Err(asset_type(format!(
            "blob store published {published} of {bytes} finalized bytes"
        )));
    }
    Ok(())
}

// @ref LLP 1006#8-sizes-ask-for-any-width — callers can ask for any positive
// width; internal snapping bounds work and clamping to the source prevents upscale.
fn snap_width(requested: u32, source: u32) -> u32 {
    IMAGE_WIDTH_RUNGS
        .iter()
        .copied()
        .find(|rung| *rung >= requested)
        .unwrap_or(source)
        .min(source)
}

fn ensure_rung(
    store: &dyn BlobStore,
    staging_store: &LocalStaging,
    media_jobs: &MediaJobs,
    source_id: &str,
    key: &str,
    width: u32,
    source_max: u64,
) -> Result<String, Refusal> {
    ensure_rung_with(
        store,
        staging_store,
        media_jobs,
        source_id,
        key,
        width,
        source_max,
        &media_helper::render,
    )
}

#[allow(clippy::too_many_arguments)]
fn ensure_rung_with(
    store: &dyn BlobStore,
    staging_store: &LocalStaging,
    media_jobs: &MediaJobs,
    source_id: &str,
    key: &str,
    width: u32,
    source_max: u64,
    render: &dyn Fn(&Path, &Path, u32) -> Result<media_helper::RenderResult, Refusal>,
) -> Result<String, Refusal> {
    loop {
        if let Ok(media_type) = sniff_image_type(store, key) {
            return Ok(media_type);
        }
        let Some(_flight) = media_jobs.rung(key) else {
            media_jobs.wait_for_rung(key);
            continue;
        };
        if let Ok(media_type) = sniff_image_type(store, key) {
            return Ok(media_type);
        }
        return render_rung(
            store,
            staging_store,
            media_jobs,
            source_id,
            key,
            width,
            source_max,
            render,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn render_rung(
    store: &dyn BlobStore,
    staging_store: &LocalStaging,
    media_jobs: &MediaJobs,
    source_id: &str,
    key: &str,
    width: u32,
    source_max: u64,
    render: &dyn Fn(&Path, &Path, u32) -> Result<media_helper::RenderResult, Refusal>,
) -> Result<String, Refusal> {
    let mut source = staging_store.create_named("source")?;
    let blob = store.get(source_id, None)?;
    if blob.length == 0 || blob.length > source_max {
        return Err(too_large(format!(
            "stored source has {} bytes outside its certified {source_max} byte record",
            blob.length
        )));
    }
    let expected = blob.length;
    let copied = io::copy(
        &mut blob.stream.take(expected.saturating_add(1)),
        source.file_mut(),
    )
    .map_err(asset_file_io)?;
    if copied != expected {
        return Err(asset_type("blob store returned a truncated rung source"));
    }
    source.sync_and_close()?;
    let output = staging_store.allocate_path("rung")?;
    let _helper = media_jobs.helper();
    let result = render(source.path(), &output, width);
    let rendered = match result {
        Ok(rendered) => rendered,
        Err(error) => {
            let _ = fs::remove_file(&output);
            return Err(error);
        }
    };
    if rendered.width != width {
        let _ = fs::remove_file(&output);
        return Err(asset_type(format!(
            "media helper rendered width {}, expected rung {width}",
            rendered.width
        )));
    }
    let mut input = File::open(&output).map_err(asset_file_io)?;
    let put = store.put(key, &mut input);
    let _ = fs::remove_file(&output);
    match put {
        Ok(_) => Ok(rendered.format.content_type().to_owned()),
        Err(error) => sniff_image_type(store, key).map_err(|_| error),
    }
}

fn sniff_image_type(store: &dyn BlobStore, key: &str) -> Result<String, Refusal> {
    let mut blob = store.get(key, None)?;
    let mut prefix = [0_u8; 12];
    blob.stream.read_exact(&mut prefix).map_err(asset_file_io)?;
    let media_type = if prefix.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if prefix.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else {
        return Err(asset_type("stored image rung has an unknown essence"));
    };
    Ok(media_type.to_owned())
}

enum RangeRequest {
    Full,
    Partial(ByteRange),
    Unsatisfiable,
}

fn parse_range(header: Option<&str>, total: u64) -> RangeRequest {
    let Some(header) = header else {
        return RangeRequest::Full;
    };
    let Some(spec) = header.trim().strip_prefix("bytes=") else {
        return RangeRequest::Unsatisfiable;
    };
    if spec.contains(',') {
        return RangeRequest::Unsatisfiable;
    }
    let Some((start, end)) = spec.split_once('-') else {
        return RangeRequest::Unsatisfiable;
    };
    let (start, end) = (start.trim(), end.trim());
    if start.is_empty() {
        let Some(suffix) = end.parse::<u64>().ok().filter(|suffix| *suffix > 0) else {
            return RangeRequest::Unsatisfiable;
        };
        if total == 0 {
            return RangeRequest::Unsatisfiable;
        }
        return RangeRequest::Partial(ByteRange {
            start: total.saturating_sub(suffix),
            end: total - 1,
        });
    }
    let Ok(start) = start.parse::<u64>() else {
        return RangeRequest::Unsatisfiable;
    };
    if start >= total {
        return RangeRequest::Unsatisfiable;
    }
    if end.is_empty() {
        return RangeRequest::Partial(ByteRange {
            start,
            end: total - 1,
        });
    }
    let Ok(end) = end.parse::<u64>() else {
        return RangeRequest::Unsatisfiable;
    };
    if end < start {
        return RangeRequest::Unsatisfiable;
    }
    RangeRequest::Partial(ByteRange {
        start,
        end: end.min(total - 1),
    })
}

fn delivery_headers(content_type: &str, cache: &str, etag: Option<&str>) -> Vec<tiny_http::Header> {
    let mut headers = vec![
        header_value("Accept-Ranges", "bytes"),
        header_value("X-Content-Type-Options", "nosniff"),
        header_value("Content-Type", content_type),
        header_value("Referrer-Policy", "no-referrer"),
        header_value("Cache-Control", cache),
    ];
    if let Some(etag) = etag {
        headers.push(header_value("ETag", etag));
    }
    headers
}

fn respond_empty(request: Request, status: u16, mut headers: Vec<tiny_http::Header>, mode: &str) {
    add_cors(&mut headers, mode);
    decorate_asset_response_headers(request.url(), &mut headers);
    let mut response = Response::empty(StatusCode(status));
    for header in headers {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn respond_asset_refusal(request: Request, status: u16, refusal: Refusal, mode: &str) {
    let body = serde_json::to_string(&refusal_json(&refusal)).unwrap_or_else(|_| "{}".to_owned());
    let mut headers = vec![
        header_value("Content-Type", "application/json"),
        header_value("Referrer-Policy", "no-referrer"),
    ];
    add_cors(&mut headers, mode);
    decorate_asset_response_headers(request.url(), &mut headers);
    let response = Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(headers.remove(0));
    let mut response = response;
    for header in headers {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn add_cors(headers: &mut Vec<tiny_http::Header>, mode: &str) {
    if mode == "dev" {
        headers.push(header_value("Access-Control-Allow-Origin", "*"));
    }
}

fn required_content_length(request: &Request) -> Result<u64, Refusal> {
    header(request, "Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| asset_type("Content-Length is required and must be a positive integer"))
}

fn upload_refusal_status(refusal: &Refusal) -> u16 {
    if refusal.code.starts_with("E_ASSET_") && refusal.family == "input" {
        422
    } else {
        refusal_status(refusal)
    }
}

fn asset_not_ready() -> Refusal {
    Refusal::new(
        "E_ASSET_NOT_READY",
        "input",
        "asset is unavailable",
        "upload the asset again and store the returned record",
        "assets/delivery",
    )
}

fn asset_type(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TYPE",
        "input",
        message,
        "upload supported media or correct the asset request",
        "assets/admission",
    )
}

fn too_large(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TOO_LARGE",
        "input",
        message,
        "upload bytes within the generated and staging ceilings",
        "assets/admission",
    )
}

fn asset_file_io(error: io::Error) -> Refusal {
    Refusal::new(
        "E_OWNER_ASSET_IO",
        "owner",
        format!("asset file operation failed: {error}"),
        "repair .snapback staging/blob permissions and retry",
        "assets/storage",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob_store::BlobRead;
    use std::collections::BTreeMap;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[derive(Default)]
    struct MemoryBlobStore(Mutex<BTreeMap<String, Vec<u8>>>);

    impl BlobStore for MemoryBlobStore {
        fn put(&self, key: &str, source: &mut dyn Read) -> Result<u64, Refusal> {
            let mut bytes = Vec::new();
            source.read_to_end(&mut bytes).map_err(asset_file_io)?;
            let mut blobs = self.0.lock().unwrap();
            if blobs.contains_key(key) {
                return Err(asset_type("immutable key already exists"));
            }
            let length = bytes.len() as u64;
            blobs.insert(key.to_owned(), bytes);
            Ok(length)
        }

        fn get(&self, key: &str, range: Option<ByteRange>) -> Result<BlobRead, Refusal> {
            let blobs = self.0.lock().unwrap();
            let bytes = blobs.get(key).cloned().ok_or_else(asset_not_ready)?;
            let total = bytes.len() as u64;
            let (bytes, selected) = match range {
                Some(range) => (
                    bytes[range.start as usize..=range.end as usize].to_vec(),
                    Some(range),
                ),
                None => (bytes, None),
            };
            Ok(BlobRead {
                length: bytes.len() as u64,
                total,
                range: selected,
                stream: Box::new(Cursor::new(bytes)),
            })
        }

        fn delete(&self, key: &str) -> Result<(), Refusal> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }

        fn enumerate(
            &self,
            prefix: &str,
            visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
        ) -> Result<(), Refusal> {
            let keys = self
                .0
                .lock()
                .unwrap()
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect::<Vec<_>>();
            for key in keys {
                visitor(&key)?;
            }
            Ok(())
        }
    }

    #[test]
    fn ranges_are_exact_and_multi_or_malformed_are_unsatisfiable() {
        assert!(matches!(parse_range(None, 10), RangeRequest::Full));
        assert!(matches!(
            parse_range(Some("bytes=2-5"), 10),
            RangeRequest::Partial(ByteRange { start: 2, end: 5 })
        ));
        assert!(matches!(
            parse_range(Some("bytes=-3"), 10),
            RangeRequest::Partial(ByteRange { start: 7, end: 9 })
        ));
        for invalid in ["bytes=10-", "bytes=5-2", "items=0-1", "bytes=0-1,4-5"] {
            assert!(matches!(
                parse_range(Some(invalid), 10),
                RangeRequest::Unsatisfiable
            ));
        }
    }

    #[test]
    fn widths_snap_up_and_never_upscale() {
        assert_eq!(snap_width(300, 4_000), 512);
        assert_eq!(snap_width(8_000, 4_000), 4_000);
        assert_eq!(snap_width(u32::MAX, 10_000), 10_000);
    }

    #[test]
    fn concurrent_first_rung_requests_spawn_one_helper_and_all_succeed() {
        const ID: &str = "s2id-0123456789abcdef0123456789abcdef-0000000000000001";
        let key = format!("{ID}.w256");
        let store = Arc::new(MemoryBlobStore::default());
        store
            .0
            .lock()
            .unwrap()
            .insert(ID.to_owned(), b"source-bytes".to_vec());
        let root = std::env::temp_dir().join(format!(
            "snapback2-rung-flight-{}-{}",
            std::process::id(),
            crate::writer_util::unix_millis()
        ));
        fs::create_dir_all(root.join(".snapback")).unwrap();
        let staging = Arc::new(LocalStaging::open(&root).unwrap());
        let jobs = MediaJobs::default();
        let spawns = Arc::new(AtomicUsize::new(0));
        let threads = (0..16)
            .map(|_| {
                let store = store.clone();
                let staging = staging.clone();
                let jobs = jobs.clone();
                let spawns = spawns.clone();
                let key = key.clone();
                std::thread::spawn(move || {
                    ensure_rung_with(
                        store.as_ref(),
                        &staging,
                        &jobs,
                        ID,
                        &key,
                        256,
                        12,
                        &|_, output, width| {
                            spawns.fetch_add(1, Ordering::SeqCst);
                            std::thread::sleep(Duration::from_millis(50));
                            fs::write(output, b"\xff\xd8\xffrendered!").map_err(asset_file_io)?;
                            Ok(media_helper::RenderResult {
                                format: media_helper::MediaFormat::Jpeg,
                                width,
                                height: 128,
                            })
                        },
                    )
                })
            })
            .collect::<Vec<_>>();
        for thread in threads {
            assert_eq!(thread.join().unwrap().unwrap(), "image/jpeg");
        }
        assert_eq!(spawns.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
