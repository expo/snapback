//! Assets (LLP 1006, carried into Snapback 4): an upload is bytes the server
//! sniffs — JPEG, PNG, WebP, MP4 — and records once, under the uploader; a
//! row column of type `image`/`video` then claims it: one asset, one home.
//! A `file` upload (LLP 3000.038) declares its media type and filename; the
//! server verifies the declaration against the bytes and serves it only as
//! an attachment.
//! Serving the bytes is authorized by the home row's read rule, so what a
//! viewer may read, they may see, and what is deleted, cleared or expired is
//! no longer served. `image ... once` records one view per principal.

use crate::error::RuntimeError;
use crate::value::Value;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Unclaimed uploads older than this are forgotten by the sweep.
pub const UNCLAIMED_TTL_MS: i64 = 60 * 60 * 1000;
pub const MAX_DIMENSION: u32 = 16_384;
pub const MAX_PIXELS: u64 = 40_000_000;
pub const MAX_DURATION_MS: u64 = 3_600_000;

/// An upload prepared under the engine guard, written without it, then
/// committed under that same generation. Dropping an uncommitted upload
/// cleans up its task-owned files, including failed disk writes.
#[cfg(feature = "sqlite")]
pub struct Upload {
    pub(crate) asset: Asset,
    pub(crate) path: std::path::PathBuf,
    pub(crate) generation: u64,
    pub(crate) committed: bool,
    pub(crate) written: bool,
    pub(crate) intent: Option<(String, String)>,
    pub(crate) placement: Option<serde_json::Value>,
    /// The directory is a store-in-memory's own: this upload creates it if
    /// the first write needs it, and removes it again if it is left empty
    /// by an upload that never committed — including one written after the
    /// store itself was dropped.
    pub(crate) ephemeral_directory: bool,
}
#[cfg(feature = "sqlite")]
impl Upload {
    /// Bind this staged upload to an immutable device intent.
    pub fn with_intent(mut self, id: &str, fingerprint: &str) -> Self {
        self.intent = Some((id.to_owned(), fingerprint.to_owned()));
        self
    }
    pub fn with_placement(mut self, placement: serde_json::Value) -> Self {self.placement=Some(placement);self}
    pub fn write(mut self, bytes: &[u8]) -> Result<Self, RuntimeError> {
        use std::io::Write;
        if bytes.len() as u64 != self.asset.bytes {
            return Err(RuntimeError::Input("upload length changed".into()));
        }
        let io = |e: std::io::Error| RuntimeError::Store(format!("cannot keep the upload: {e}"));
        // A store in memory has no assets directory until its first upload.
        if self.ephemeral_directory && let Some(directory) = self.path.parent() {
            crate::private_fs::directory(directory).map_err(io)?;
        }
        let staging = self.path.with_extension("part");
        let mut file = crate::private_fs::file(&staging, true).map_err(io)?;
        // Only remove a file after this upload actually created it.
        self.written = true;
        file.write_all(bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
        std::fs::rename(staging, &self.path).map_err(io)?;
        // A synced inode is insufficient: publish its name durably before the ledger commit.
        if let Some(directory) = self.path.parent() { std::fs::File::open(directory).and_then(|f| f.sync_all()).map_err(io)?; }
        Ok(self)
    }
}
#[cfg(feature = "sqlite")]
impl Drop for Upload {
    fn drop(&mut self) {
        if self.written && !self.committed {
            let _ = std::fs::remove_file(self.path.with_extension("part"));
            let _ = std::fs::remove_file(&self.path);
            // `remove_dir` removes only an empty directory: a live store's
            // other assets keep theirs, and the store recreates it on demand.
            if self.ephemeral_directory && let Some(directory) = self.path.parent() {
                let _ = std::fs::remove_dir(directory);
            }
        }
    }
}

/// A bounded batch selected and made unclaimable under the engine guard.
/// File removal is deliberately a separate operation so the HTTP host can
/// perform it without holding the process-wide engine mutex.
#[cfg(feature = "sqlite")]
#[derive(Clone, Debug)]
pub struct AssetSweep {
    items: Vec<(String, std::path::PathBuf)>,
}

#[cfg(feature = "sqlite")]
impl AssetSweep {
    pub(crate) fn new(assets: &[Asset], directory: &std::path::Path) -> Self {
        Self {
            items: assets
                .iter()
                .map(|asset| (asset.id.clone(), directory.join(&asset.id)))
                .collect(),
        }
    }

    /// Every named asset's bytes in `directory`, for a caller that has
    /// already forgotten the ledger rows (a development reset).
    pub(crate) fn named(ids: impl IntoIterator<Item = String>, directory: &std::path::Path) -> Self {
        Self { items: ids.into_iter().map(|id| { let path = directory.join(&id); (id, path) }).collect() }
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
    pub(crate) fn ids(&self) -> impl Iterator<Item = &str> {
        self.items.iter().map(|(id, _)| id.as_str())
    }
    pub(crate) fn forget_prefix(&mut self, count: usize) { self.items.drain(..count); }

    pub fn remove_files(&self) -> Result<(), RuntimeError> {
        for (_, path) in &self.items {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(RuntimeError::Store(format!(
                        "cannot remove stale asset {}: {error}",
                        path.display()
                    )));
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Video,
    File,
}

impl AssetKind {
    pub fn word(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::File => "file",
        }
    }
}

/// What the sniffer read from the bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sniffed {
    pub kind: AssetKind,
    pub content_type: &'static str,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Milliseconds, for video.
    pub duration: Option<u64>,
}

/// One recorded asset.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub owner: String,
    pub kind: AssetKind,
    pub content_type: String,
    pub bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<u64>,
    pub created_at: i64,
    /// `(table, row id, column)` once a row holds it.
    pub home: Option<(String, String, String)>,
    /// Set when its home let go of it: the bytes are no longer served and
    /// the sweep removes them.
    pub released_at: Option<i64>,
    /// A file's sanitized filename (`sanitize_name`); None for media.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Asset {
    /// The value a row column carries: the id and the facts the server
    /// established, never the client's word for them.
    pub fn column_value(&self) -> Value {
        let int = |value: Option<u64>| value.map(|v| Value::Int(v as i64)).unwrap_or(Value::Null);
        if self.kind == AssetKind::File {
            // @ref LLP 3000.038#1 — a file's facts are its type, size and name; it has no media facts.
            return Value::Map(BTreeMap::from([
                ("id".to_owned(), Value::Id(self.id.clone())),
                ("type".to_owned(), Value::String(self.content_type.clone())),
                ("bytes".to_owned(), Value::Int(self.bytes as i64)),
                ("name".to_owned(), self.name.clone().map(Value::String).unwrap_or(Value::Null)),
            ]).into());
        }
        // Every fact is a key, null when the kind has none: `.duration` on
        // an image reads null, never a missing field.
        let fields = BTreeMap::from([
            ("id".to_owned(), Value::Id(self.id.clone())),
            ("type".to_owned(), Value::String(self.content_type.clone())),
            ("bytes".to_owned(), Value::Int(self.bytes as i64)),
            ("width".to_owned(), int(self.width.map(u64::from))),
            ("height".to_owned(), int(self.height.map(u64::from))),
            ("duration".to_owned(), int(self.duration)),
        ]);
        Value::Map(fields.into())
    }
}

/// The fact keys every asset value carries.
pub const FACTS: [&str; 5] = ["type", "bytes", "width", "height", "duration"];
/// The fact keys every file value carries.
pub const FILE_FACTS: [&str; 3] = ["type", "bytes", "name"];

/// The media types a `file` column may accept: each is one Snapback can
/// verify against the bytes (`verify_file`). None is script-bearing: HTML,
/// SVG, XML and JavaScript are never stored as files (LLP 3000.038 §2).
pub const FILE_TYPES: &[&str] = &[
    "audio/wav", "audio/mpeg", "audio/flac", "application/pdf",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/json",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/// The longest stored filename, in UTF-8 bytes.
pub const MAX_NAME_BYTES: usize = 255;

/// Whether a file column with this allow-list (empty: the default, every
/// verifiable type) accepts `content_type`.
pub fn file_accepts(types: &[String], content_type: &str) -> bool {
    if types.is_empty() { FILE_TYPES.contains(&content_type) } else { types.iter().any(|t| t == content_type) }
}

/// Why a type cannot be listed on a file column, or None when it can.
pub fn file_type_refusal(content_type: &str) -> Option<String> {
    if FILE_TYPES.contains(&content_type) { return None; }
    let scripted = ["text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml", "text/javascript", "application/javascript", "application/ecmascript"];
    let lowered = content_type.to_ascii_lowercase();
    let known = FILE_TYPES.iter().map(|t| format!("'{t}'")).collect::<Vec<_>>().join(", ");
    Some(if scripted.contains(&lowered.as_str()) || lowered.ends_with("+xml") {
        format!("'{content_type}' can carry script that a browser runs; Snapback never stores it as a file — accept it as 'text/plain' or inside 'application/zip'. Verifiable types: {known}")
    } else if lowered != content_type && FILE_TYPES.contains(&lowered.as_str()) {
        format!("media types are lowercase: write '{lowered}'")
    } else {
        format!("Snapback cannot verify '{content_type}' against the bytes. Verifiable types: {known}")
    })
}

/// The declared type of a file upload as a canonical media type essence:
/// parameters dropped, lowercase, `None` when absent or octet-stream.
pub fn declared_type(header: Option<&str>) -> Option<String> {
    let essence = header?.split(';').next()?.trim().to_ascii_lowercase();
    (!essence.is_empty() && essence != "application/octet-stream").then_some(essence)
}

/// Check that `bytes` are what `declared` says (or, with no declaration,
/// name a binary type by its magic number), returning the canonical type.
/// This is a type check, not a safety scan (LLP 3000.038 §2).
// @ref LLP 3000.038#2 — declared plus sniffed: a mismatch refuses, text is never inferred.
pub fn verify_file(bytes: &[u8], declared: Option<&str>) -> Result<&'static str, RuntimeError> {
    let refuse = |message: String| RuntimeError::Asset { code: "E_ASSET_TYPE", message };
    let sniffed = magic_type(bytes);
    let Some(declared) = declared else {
        return sniffed.ok_or_else(|| refuse("declare the file's media type in Content-Type: only PDF, PNG, JPEG, WebP, GIF and zip are recognized without one".into()));
    };
    let Some(canonical) = FILE_TYPES.iter().copied().find(|t| *t == declared) else {
        return Err(refuse(file_type_refusal(declared).unwrap_or_default()));
    };
    let matches = match canonical {
        "text/plain" | "text/csv" | "text/markdown" => text(bytes).is_some(),
        "application/json" => text(bytes).is_some_and(|text| serde_json::from_str::<serde::de::IgnoredAny>(text).is_ok()),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "application/vnd.openxmlformats-officedocument.presentationml.presentation" => sniffed == Some("application/zip"),
        other => sniffed == Some(other),
    };
    if !matches {
        let found = sniffed.map(|t| format!("the bytes are {t}")).unwrap_or_else(|| "the bytes do not match it".into());
        return Err(refuse(format!("the upload declares {canonical}, but {found}; declare the file's real type")));
    }
    Ok(canonical)
}

fn magic_type(bytes: &[u8]) -> Option<&'static str> {
    if audio_wav(bytes) { return Some("audio/wav"); }
    if bytes.len() >= 42 && bytes.starts_with(b"fLaC") && bytes[4] & 0x7f == 0 && bytes[5..8] == [0, 0, 34] {
        return Some("audio/flac");
    }
    if audio_mp3(bytes) { return Some("audio/mpeg"); }
    if bytes.starts_with(b"%PDF-") { return Some("application/pdf"); }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { return Some("image/gif"); }
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") { return Some("application/zip"); }
    match sniff_header(bytes) {
        Ok(Sniffed { kind: AssetKind::Image, content_type, .. }) => Some(content_type),
        _ => None,
    }
}

// Header verification, not decoding or a duration claim.
fn audio_wav(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" { return false; }
    let Some(end)=(u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize).checked_add(8) else {return false};
    if end > bytes.len() || end < 12 { return false; }
    let mut at = 12;
    let mut format = false;
    while at + 8 <= end {
        let length = u32::from_le_bytes(bytes[at+4..at+8].try_into().unwrap()) as usize;
        let Some(next) = (at + 8).checked_add(length) else { return false };
        if next > end { return false; }
        if &bytes[at..at+4] == b"fmt " && length >= 16 {
            format = bytes[at+10..at+12] != [0, 0] && bytes[at+12..at+16] != [0, 0, 0, 0];
        }
        if &bytes[at..at+4] == b"data" && length > 0 && format { return true; }
        at = next + (length & 1);
    }
    false
}
fn audio_mp3(bytes: &[u8]) -> bool {
    let mut at = 0;
    if bytes.starts_with(b"ID3") {
        if bytes.len() < 10 || bytes[6..10].iter().any(|b| *b > 127) { return false; }
        let length = bytes[6..10].iter().fold(0usize, |n, b| (n << 7) | usize::from(*b));
        at = 10 + length + if bytes[5] & 0x10 != 0 { 10 } else { 0 };
    }
    let Some(h) = bytes.get(at..at+4) else { return false };
    let version = (h[1] >> 3) & 3;
    let rate = usize::from(h[2] >> 4);
    let frequency = usize::from((h[2] >> 2) & 3);
    if h[0] != 255 || h[1] & 0xe0 != 0xe0 || version == 1 || (h[1] >> 1) & 3 != 1 || rate == 0 || rate == 15 || frequency == 3 { return false; }
    let bitrate = if version == 3 { [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320][rate] } else { [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160][rate] };
    let hz = [44100,48000,32000][frequency] / if version == 3 { 1 } else if version == 2 { 2 } else { 4 };
    let frame = (if version == 3 { 144 } else { 72 }) * bitrate * 1000 / hz + usize::from((h[2] >> 1) & 1);
    bytes.len() >= at + frame
}

/// UTF-8 text with no NUL byte; a leading byte-order mark is allowed.
fn text(bytes: &[u8]) -> Option<&str> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    if bytes.contains(&0) { return None; }
    std::str::from_utf8(bytes).ok()
}

/// The stored form of an uploader's filename (LLP 3000.038 §4): its last
/// path segment, without control or bidirectional-override characters,
/// trimmed, at most 255 bytes, `file` when nothing remains.
pub fn sanitize_name(name: &str) -> String {
    let segment = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = segment.chars().filter(|c| !c.is_control() && !matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}' | '\u{061C}')).collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim_start();
    let mut end = trimmed.len().min(MAX_NAME_BYTES);
    while !trimmed.is_char_boundary(end) { end -= 1; }
    let bounded = trimmed[..end].trim_end();
    if bounded.is_empty() { "file".into() } else { bounded.into() }
}

/// `Content-Disposition` for a stored filename: always an attachment, an
/// ASCII fallback plus the exact name in RFC 8187 form.
pub fn attachment_disposition(name: &str) -> String {
    let fallback: String = name.chars().map(|c| if c.is_ascii_graphic() && !matches!(c, '"' | '\\' | '/' | ';' | '%') || c == ' ' { c } else { '_' }).collect();
    let encoded: String = name.bytes().map(|b| if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
}

/// The asset id a column value names, if it is an asset value.
pub fn asset_id(value: Option<&Value>) -> Option<&str> {
    match value {
        Some(Value::Map(fields)) => match fields.get("id") {
            Some(Value::Id(id)) => Some(id.as_str()),
            _ => None,
        },
        _ => None,
    }
}

/// What the bytes are. The kind decides which column may hold them and
/// which ceiling applies; the dimensions and duration ride on the row.
pub fn sniff(bytes: &[u8]) -> Result<Sniffed, RuntimeError> {
    let facts = sniff_header(bytes)?;
    let dimensions_bad = match (facts.width, facts.height) {
        (Some(w), Some(h)) => {
            w == 0
                || h == 0
                || w > MAX_DIMENSION
                || h > MAX_DIMENSION
                || u64::from(w) * u64::from(h) > MAX_PIXELS
        }
        _ => facts.kind == AssetKind::Image,
    };
    if dimensions_bad
        || facts
            .duration
            .is_some_and(|d| d == 0 || d > MAX_DURATION_MS)
        || (facts.kind == AssetKind::Video && facts.duration.is_none())
    {
        return Err(RuntimeError::Asset { code: "E_ASSET_BOUNDS", message: "media needs nonzero dimensions at most 16384 per side and 40 million pixels, and video needs a duration at most 3600000 ms".into() });
    }
    Ok(facts)
}

fn sniff_header(bytes: &[u8]) -> Result<Sniffed, RuntimeError> {
    let refuse = || RuntimeError::Asset { code: "E_ASSET_TYPE", message: "the bytes are not a JPEG, PNG, WebP or MP4".into() };
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        let (width, height) = jpeg_dimensions(bytes).ok_or_else(refuse)?;
        return Ok(Sniffed { kind: AssetKind::Image, content_type: "image/jpeg", width: Some(width), height: Some(height), duration: None });
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        if bytes.len() < 24 || &bytes[12..16] != b"IHDR" {
            return Err(refuse());
        }
        let width = u32::from_be_bytes(bytes[16..20].try_into().expect("four bytes"));
        let height = u32::from_be_bytes(bytes[20..24].try_into().expect("four bytes"));
        return Ok(Sniffed { kind: AssetKind::Image, content_type: "image/png", width: Some(width), height: Some(height), duration: None });
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        let (width, height) = webp_dimensions(bytes).ok_or_else(refuse)?;
        return Ok(Sniffed { kind: AssetKind::Image, content_type: "image/webp", width: Some(width), height: Some(height), duration: None });
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && mp4_brand(bytes) {
        let duration = mp4_duration_ms(bytes);
        return Ok(Sniffed { kind: AssetKind::Video, content_type: "video/mp4", width: None, height: None, duration });
    }
    Err(refuse())
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2;
    while i + 4 <= bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        i += 2;
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }
        if marker == 0xD9 || marker == 0xDA {
            return None;
        }
        if i + 2 > bytes.len() {
            return None;
        }
        let length = usize::from(u16::from_be_bytes([bytes[i], bytes[i + 1]]));
        if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
            if i + 7 > bytes.len() {
                return None;
            }
            let height = u16::from_be_bytes([bytes[i + 3], bytes[i + 4]]);
            let width = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]);
            return Some((u32::from(width), u32::from(height)));
        }
        i += length.max(2);
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut i = 12;
    while i + 8 <= bytes.len() {
        let fourcc = &bytes[i..i + 4];
        let length = u32::from_le_bytes(bytes[i + 4..i + 8].try_into().expect("four bytes")) as usize;
        let end = (i + 8).checked_add(length)?;
        let payload = bytes.get(i + 8..end)?;
        match fourcc {
            b"VP8X" if payload.len() >= 10 => return Some((1 + u24_le(&payload[4..7]), 1 + u24_le(&payload[7..10]))),
            b"VP8L" if payload.len() >= 5 && payload[0] == 0x2f => {
                let width = 1 + u32::from(payload[1]) + (u32::from(payload[2] & 0x3f) << 8);
                let height = 1 + u32::from(payload[2] >> 6) + (u32::from(payload[3]) << 2) + (u32::from(payload[4] & 0x0f) << 10);
                return Some((width, height));
            }
            b"VP8 " if payload.len() >= 10 && &payload[3..6] == b"\x9d\x01\x2a" => {
                return Some((u32::from(u16::from_le_bytes([payload[6], payload[7]]) & 0x3fff), u32::from(u16::from_le_bytes([payload[8], payload[9]]) & 0x3fff)));
            }
            _ => {}
        }
        i += 8 + length + (length & 1);
    }
    None
}

fn u24_le(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

/// The boxes at one level of an ISO BMFF stream: `(type, payload)`.
fn boxes(mut bytes: &[u8]) -> Vec<(&[u8], &[u8])> {
    let mut out = Vec::new();
    while bytes.len() >= 8 {
        let size32 = u32::from_be_bytes(bytes[..4].try_into().expect("four bytes")) as usize;
        let kind = &bytes[4..8];
        let (header, size) = match size32 {
            0 => (8, bytes.len()),
            1 if bytes.len() >= 16 => (16, u64::from_be_bytes(bytes[8..16].try_into().expect("eight bytes")) as usize),
            1 => break,
            n => (8, n),
        };
        if size < header || size > bytes.len() {
            break;
        }
        out.push((kind, &bytes[header..size]));
        bytes = &bytes[size..];
    }
    out
}

fn mp4_brand(bytes: &[u8]) -> bool {
    boxes(bytes).first().is_some_and(|(kind, payload)| *kind == b"ftyp" && payload.chunks_exact(4).enumerate().any(|(n, brand)| n != 1 && matches!(brand, b"isom" | b"iso2" | b"iso5" | b"iso6" | b"mp41" | b"mp42" | b"avc1" | b"M4V " | b"qt  ")))
}

fn mp4_duration_ms(bytes: &[u8]) -> Option<u64> {
    let (_, moov) = boxes(bytes).into_iter().find(|(kind, _)| *kind == b"moov")?;
    let (_, mvhd) = boxes(moov).into_iter().find(|(kind, _)| *kind == b"mvhd")?;
    let (timescale, duration) = match mvhd.first()? {
        0 if mvhd.len() >= 20 => (u64::from(u32::from_be_bytes(mvhd[12..16].try_into().expect("four bytes"))), u64::from(u32::from_be_bytes(mvhd[16..20].try_into().expect("four bytes")))),
        1 if mvhd.len() >= 32 => (u64::from(u32::from_be_bytes(mvhd[20..24].try_into().expect("four bytes"))), u64::from_be_bytes(mvhd[24..32].try_into().expect("eight bytes"))),
        _ => return None,
    };
    (timescale > 0).then(|| duration.saturating_mul(1000) / timescale)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    #[test]
    fn png_dimensions_are_read_from_ihdr() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&640u32.to_be_bytes());
        png.extend_from_slice(&480u32.to_be_bytes());
        let sniffed = sniff(&png).unwrap();
        assert_eq!((sniffed.kind, sniffed.content_type, sniffed.width, sniffed.height), (AssetKind::Image, "image/png", Some(640), Some(480)));
    }

    #[test]
    fn jpeg_dimensions_come_from_the_frame_header() {
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00];
        jpeg.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x01, 0x00, 0x02, 0x00, 0x03, 0x01, 0x11, 0x00]);
        let sniffed = sniff(&jpeg).unwrap();
        assert_eq!((sniffed.content_type, sniffed.width, sniffed.height), ("image/jpeg", Some(512), Some(256)));
    }

    #[test]
    fn webp_vp8x_dimensions() {
        let mut webp = b"RIFF\x00\x00\x00\x00WEBPVP8X".to_vec();
        webp.extend_from_slice(&10u32.to_le_bytes());
        webp.extend_from_slice(&[0, 0, 0, 0, 0x1F, 0x03, 0x00, 0xDF, 0x01, 0x00]);
        let sniffed = sniff(&webp).unwrap();
        assert_eq!((sniffed.content_type, sniffed.width, sniffed.height), ("image/webp", Some(800), Some(480)));
    }

    #[test]
    fn webp_headers_never_borrow_bytes_from_the_next_chunk() {
        for (kind, payload) in [(b"VP8X", vec![0,0,0,0,31,3,0,223,1,0]), (b"VP8L", vec![0x2f,0,0,0,0]), (b"VP8 ", vec![0,0,0,0x9d,1,0x2a,1,0,1,0])] {
            let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
            webp.extend(kind);
            webp.extend(1u32.to_le_bytes());
            webp.extend(&payload);
            assert!(sniff(&webp).is_err());
            webp[16..20].copy_from_slice(&100u32.to_le_bytes());
            assert!(sniff(&webp).is_err());
            webp[16..20].copy_from_slice(&(payload.len() as u32).to_le_bytes());
            assert!(sniff(&webp).is_ok());
        }
    }

    #[test]
    fn mp4_duration_comes_from_mvhd() {
        let mut mvhd = vec![0u8; 20];
        mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
        mvhd[16..20].copy_from_slice(&4500u32.to_be_bytes());
        let mut mp4 = boxed(b"ftyp", b"isom\x00\x00\x02\x00isomiso2");
        mp4.extend(boxed(b"moov", &boxed(b"mvhd", &mvhd)));
        let sniffed = sniff(&mp4).unwrap();
        assert_eq!((sniffed.kind, sniffed.content_type, sniffed.duration), (AssetKind::Video, "video/mp4", Some(4500)));
    }

    #[test]
    fn mp4_duration_has_a_nonzero_finite_bound() {
        for (duration, valid) in [
            (0u32, false),
            (3_600_000, true),
            (3_600_001, false),
            (u32::MAX, false),
        ] {
            let mut mvhd = vec![0u8; 20];
            mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
            mvhd[16..20].copy_from_slice(&duration.to_be_bytes());
            let mut bytes = boxed(b"ftyp", b"isom\x00\x00\x02\x00isomiso2");
            bytes.extend(boxed(b"moov", &boxed(b"mvhd", &mvhd)));
            assert_eq!(sniff(&bytes).is_ok(), valid);
        }
    }

    #[test]
    fn files_are_declared_and_sniffed() {
        assert_eq!(verify_file(b"%PDF-1.7\n", Some("application/pdf")).unwrap(), "application/pdf");
        assert_eq!(verify_file(b"%PDF-1.7\n", None).unwrap(), "application/pdf");
        // A spoofed PDF: the declaration does not match the bytes.
        assert!(matches!(verify_file(b"<html><script>alert(1)</script>", Some("application/pdf")), Err(RuntimeError::Asset { code: "E_ASSET_TYPE", .. })));
        // A PNG declared as a PDF names what the bytes are.
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
        let RuntimeError::Asset { message, .. } = verify_file(png, Some("application/pdf")).unwrap_err() else { panic!() };
        assert!(message.contains("image/png"), "{message}");
        assert_eq!(verify_file(png, Some("image/png")).unwrap(), "image/png");
        // HTML is never a verifiable type; as text it is text.
        assert!(verify_file(b"<html></html>", Some("text/html")).is_err());
        assert!(verify_file(b"<svg/>", Some("image/svg+xml")).is_err());
        assert_eq!(verify_file(b"<html></html>", Some("text/plain")).unwrap(), "text/plain");
        // Text is never inferred, and must be UTF-8 without NUL.
        assert!(verify_file(b"hello", None).is_err());
        assert!(verify_file(b"a\0b", Some("text/plain")).is_err());
        assert!(verify_file(b"\xff\xfe", Some("text/csv")).is_err());
        assert_eq!(verify_file(b"\xEF\xBB\xBFa,b\n", Some("text/csv")).unwrap(), "text/csv");
        assert_eq!(verify_file(b"{\"a\":1}", Some("application/json")).unwrap(), "application/json");
        assert!(verify_file(b"{\"a\":", Some("application/json")).is_err());
        assert_eq!(verify_file(b"PK\x03\x04rest", Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).unwrap(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assert!(verify_file(b"%PDF-1.4", Some("application/zip")).is_err());
        assert_eq!(declared_type(Some("Application/PDF; charset=binary")).as_deref(), Some("application/pdf"));
        assert_eq!(declared_type(Some("application/octet-stream")), None);
    }

    #[test]
    fn filenames_are_one_safe_segment() {
        assert_eq!(sanitize_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_name("C:\\Users\\me\\receipt.pdf"), "receipt.pdf");
        assert_eq!(sanitize_name("invoice\u{202E}fdp.exe"), "invoicefdp.exe");
        assert_eq!(sanitize_name("a\nb\r\0c.txt"), "abc.txt");
        assert_eq!(sanitize_name("  .hidden  "), "hidden");
        assert_eq!(sanitize_name(".."), "file");
        assert_eq!(sanitize_name(""), "file");
        let long = "é".repeat(200);
        let kept = sanitize_name(&long);
        assert!(kept.len() <= MAX_NAME_BYTES && kept.chars().all(|c| c == 'é'));
        assert_eq!(attachment_disposition("Résumé \"final\".pdf"), "attachment; filename=\"R_sum_ _final_.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf");
    }

    #[test]
    fn file_types_refuse_script_bearing_types() {
        assert!(file_type_refusal("application/pdf").is_none());
        assert!(file_type_refusal("text/html").unwrap().contains("script"));
        assert!(file_type_refusal("image/svg+xml").unwrap().contains("script"));
        assert!(file_type_refusal("Application/PDF").unwrap().contains("lowercase"));
        assert!(file_accepts(&[], "text/csv"));
        assert!(!file_accepts(&["application/pdf".into()], "text/csv"));
    }

    #[test]
    fn other_bytes_are_refused() {
        assert!(matches!(sniff(b"hello"), Err(RuntimeError::Asset { code: "E_ASSET_TYPE", .. })));
        assert!(matches!(sniff(b"GIF89a"), Err(RuntimeError::Asset { .. })));
    }
}

#[cfg(feature = "sqlite")]
mod persistence {
// ----- persistence: the `_assets` and `_asset_views` tables -----

use super::*;
use crate::store::{Store, Tx};
use rusqlite::{Connection, OptionalExtension, params};

const COLUMNS: &str = "id, owner, kind, content_type, bytes, width, height, duration, created_at, home_table, home_id, home_column, released_at, name";

fn read_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<Asset> {
    let kind: String = row.get(2)?;
    let home: (Option<String>, Option<String>, Option<String>) = (row.get(9)?, row.get(10)?, row.get(11)?);
    Ok(Asset {
        id: row.get(0)?,
        owner: row.get(1)?,
        kind: match kind.as_str() { "video" => AssetKind::Video, "file" => AssetKind::File, _ => AssetKind::Image },
        content_type: row.get(3)?,
        bytes: row.get::<_, i64>(4)? as u64,
        width: row.get::<_, Option<i64>>(5)?.map(|w| w as u32),
        height: row.get::<_, Option<i64>>(6)?.map(|h| h as u32),
        duration: row.get::<_, Option<i64>>(7)?.map(|d| d as u64),
        created_at: row.get(8)?,
        home: match home {
            (Some(table), Some(id), Some(column)) => Some((table, id, column)),
            _ => None,
        },
        released_at: row.get(12)?,
        name: row.get(13)?,
    })
}

fn find(conn: &Connection, id: &str) -> Result<Option<Asset>, RuntimeError> {
    Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM _assets WHERE id = ?1"), [id], read_asset,
            ).optional()?)
}

    fn stale(conn: &Connection, now: i64) -> Result<Vec<Asset>, RuntimeError> {
        let mut statement = conn.prepare(&format!("SELECT {COLUMNS} FROM _assets WHERE released_at IS NOT NULL OR (home_table IS NULL AND created_at < ?1 AND NOT EXISTS (SELECT 1 FROM _asset_intents u WHERE u.asset=_assets.id AND u.state='pending' AND NOT EXISTS (SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent))) LIMIT 256"))?;
        let rows = statement.query_map([now - UNCLAIMED_TTL_MS], read_asset)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    fn forget(conn: &Connection, id: &str) -> Result<(), RuntimeError> {
        conn.execute("DELETE FROM _asset_views WHERE asset = ?1", [id])?;
        conn.execute("DELETE FROM _asset_gc WHERE asset = ?1", [id])?;
        conn.execute("DELETE FROM _assets WHERE id = ?1", [id])?;
        Ok(())
    }

    fn record(conn: &Connection, asset: &Asset) -> Result<(), RuntimeError> {
        conn.execute(
            &format!("INSERT INTO _assets({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, NULL, NULL, ?10)"),
            params![asset.id, asset.owner, asset.kind.word(), asset.content_type, asset.bytes as i64, asset.width.map(i64::from), asset.height.map(i64::from), asset.duration.map(|d| d as i64), asset.created_at, asset.name],
        )?;
        Ok(())
    }

    impl Store {
        /// Record an upload. The bytes are the caller's to write at `asset_path`.
        pub fn record_asset(&self, asset: &Asset) -> Result<(), RuntimeError> {
            record(self.conn(), asset)
    }

    pub fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> {
        find(self.conn(), id)
    }

    pub fn asset_path(&self, id: &str) -> std::path::PathBuf {
        self.assets_dir().join(id)
    }

    /// Assets nobody serves any more: released by their home, or never
    /// claimed within the grace period. The sweep unlinks and forgets them.
    pub fn stale_assets(&self, now: i64) -> Result<Vec<Asset>, RuntimeError> {
            stale(self.conn(), now)
    }

    pub fn forget_asset(&self, id: &str) -> Result<(), RuntimeError> {
            forget(self.conn(), id)
    }
}

impl Tx<'_> {
        pub fn record_asset(&self, asset: &Asset) -> Result<(), RuntimeError> {
            record(self.conn(), asset)
        }

        /// Select a bounded sweep batch and close the claim race for old,
        /// unclaimed uploads before their files are removed outside the guard.
        pub fn stage_stale_assets(&self, now: i64) -> Result<Vec<Asset>, RuntimeError> {
            self.stage_stale_assets_for(now, std::time::Duration::MAX)
        }

        pub fn stage_stale_assets_for(&self, now: i64, budget: std::time::Duration) -> Result<Vec<Asset>, RuntimeError> {
            let started = std::time::Instant::now();
            let mut assets = stale(self.conn(), now)?;
            let mut staged = 0;
            for asset in &assets {
                if staged > 0 && started.elapsed() >= budget { break; }
                self.conn().execute("INSERT OR IGNORE INTO _asset_gc(asset) VALUES (?1)", [&asset.id])?;
                self.conn().execute(
                    "UPDATE _assets SET released_at = COALESCE(released_at, ?2) WHERE id = ?1",
                    params![asset.id, now],
                )?;
                staged += 1;
            }
            assets.truncate(staged);
            Ok(assets)
        }

        pub fn forget_asset(&self, id: &str) -> Result<(), RuntimeError> {
            forget(self.conn(), id)
        }

        pub fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> {
        find(self.conn(), id)
    }

    /// A row column takes the asset: one asset, one home. The uploader's
    /// own assets only (the system principal may place any), and an asset
    /// another row already holds is refused.
    pub fn claim_asset(&self, id: &str, by: &str, table: &str, row_id: &str, column: &str) -> Result<Asset, RuntimeError> {
        let unknown = || RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: format!("no upload of yours is named {id}; upload the bytes first (POST /assets) and place the id it returns") };
        let Some(asset) = self.asset(id)? else { return Err(unknown()) };
        // @ref LLP 3000#7 — release permits a move; collection reservation closes the outside-lock unlink race.
        if self.conn().query_row("SELECT EXISTS(SELECT 1 FROM _asset_gc WHERE asset = ?1)", [id], |row| row.get::<_, bool>(0))? {
            return Err(unknown());
        }
        if asset.owner != by && by != crate::SYSTEM_PRINCIPAL {
            return Err(unknown());
        }
        // Release detaches the previous home. The uploader may reclaim
        // the still-present bytes until the garbage collector reserves them.
        match &asset.home {
            Some((t, r, c)) if (t.as_str(), r.as_str(), c.as_str()) == (table, row_id, column) => {}
            Some((t, _, _)) => return Err(RuntimeError::Asset { code: "E_ASSET_PLACED", message: format!("asset {id} already belongs to a row of {t}; upload it again for a second home") }),
            None => {
                self.conn().execute("UPDATE _assets SET home_table = ?2, home_id = ?3, home_column = ?4, released_at = NULL WHERE id = ?1", params![id, table, row_id, column])?;
            }
        }
        Ok(asset)
    }

    /// Only the recorded home can let go of an asset. Legacy references in
    /// another cell (or to an unplaced upload) leave its ledger untouched.
    pub fn release_asset(&self, id: &str, table: &str, row_id: &str, column: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _assets SET released_at = ?2, home_table = NULL, home_id = NULL, home_column = NULL WHERE id = ?1 AND released_at IS NULL AND home_table = ?3 AND home_id = ?4 AND home_column = ?5", params![id, now, table, row_id, column])?;
        Ok(())
    }

    pub fn asset_viewed(&self, id: &str, principal: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row("SELECT 1 FROM _asset_views WHERE asset = ?1 AND principal = ?2", params![id, principal], |_| Ok(())).optional()?.is_some())
    }

    pub fn record_asset_view(&self, id: &str, principal: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT OR IGNORE INTO _asset_views(asset, principal, at) VALUES (?1, ?2, ?3)", params![id, principal, now])?;
        Ok(())
    }
}
}

// @ref LLP 3000.038.000#3 — immutable dedup receipts survive collection and cancellation.
#[cfg(feature = "sqlite")]
pub(crate) fn replay_intent(tx: &crate::store::Tx<'_>, owner: &str, id: &str, fingerprint: &str) -> Result<Option<Asset>, RuntimeError> {
    use rusqlite::OptionalExtension;
    let receipt: Option<(Option<String>, Option<String>, String)> = tx.conn().query_row(
        "SELECT fingerprint, facts, state FROM _asset_intents WHERE owner=?1 AND intent=?2", [owner, id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    let Some((original, facts, state)) = receipt else {
        if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _ops WHERE principal=?1 AND id=?2)", [owner, id], |r| r.get::<_, bool>(0))? {
            return Err(RuntimeError::Asset { code: "E_WRITE_ID_REUSE", message: "intent id already belongs to an executed mutation; select a new id".into() });
        }
        return Ok(None);
    };
    if state == "cancelled" { return Err(RuntimeError::Asset { code: "E_UPLOAD_CANCELLED", message: "this upload intent was cancelled".into() }); }
    if original.as_deref() != Some(fingerprint) {
        return Err(RuntimeError::Asset { code: "E_ASSET_INTENT_REUSE", message: "upload intent id belongs to different bytes or metadata; retry the original input or use a new id".into() });
    }
    if state=="declared" {return Ok(None);}
    let asset: Asset = crate::json_codec::from_text(facts.as_deref().unwrap_or("null")).map_err(|e| RuntimeError::Store(e.to_string()))?;
    if tx.asset(&asset.id)?.is_none() {
        return Err(RuntimeError::Asset { code: "E_ASSET_INTENT_EXPIRED", message: "the original upload was collected; select the file again under a new intent id".into() });
    }
    Ok(Some(asset))
}

#[cfg(feature="sqlite")]
pub(crate) fn require_placement(tx:&crate::store::Tx<'_>,owner:&str,id:&str,name:&str,args:&serde_json::Value)->Result<(),RuntimeError>{
    use rusqlite::OptionalExtension;
    let record:Option<(Option<String>,Option<String>,String)>=tx.conn().query_row("SELECT placement,facts,state FROM _asset_intents WHERE owner=?1 AND intent=?2",[owner,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let Some((binding,facts,state))=record else {return Ok(())};
    if state=="cancelled"{return Err(RuntimeError::Asset{code:"E_UPLOAD_CANCELLED",message:"this upload-and-place intent was cancelled".into()});}
    let Some(binding)=binding else {return Err(RuntimeError::Asset{code:"E_UPLOAD_INTENT",message:"upload intent has no declared placement".into()});};
    let Some(facts)=facts else{return Err(RuntimeError::Asset{code:"E_UPLOAD_PENDING",message:"placing mutation must wait for its uploaded asset".into()});};
    let binding:serde_json::Value=crate::json_codec::from_text(&binding).map_err(|e|RuntimeError::Store(e.to_string()))?;
    let asset:Asset=crate::json_codec::from_text(&facts).map_err(|e|RuntimeError::Store(e.to_string()))?;
    let mut expected=binding["args"].clone();
    let argument=binding["argument"].as_str().ok_or_else(||RuntimeError::Input("declared placement has no asset argument".into()))?;
    let mut asset_facts=serde_json::json!({"id":asset.id,"type":asset.content_type,"bytes":asset.bytes,"width":asset.width,"height":asset.height,"duration":asset.duration});
    if let Some(name)=asset.name{asset_facts["name"]=serde_json::json!(name);}
    expected[argument]=asset_facts;
    if binding["op"]!=name||expected!=*args{return Err(RuntimeError::Asset{code:"E_ASSET_INTENT_REUSE",message:"operation or args differ from the declared placement and authenticated upload facts".into()});}
    Ok(())
}
