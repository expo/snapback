//! Assets (LLP 1006, carried into Snapback 4): an upload is bytes the server
//! sniffs — JPEG, PNG, WebP, MP4 — and records once, under the uploader; a
//! row column of type `image`/`video` then claims it: one asset, one home.
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
}
#[cfg(feature = "sqlite")]
impl Upload {
    pub fn write(mut self, bytes: &[u8]) -> Result<Self, RuntimeError> {
        use std::io::Write;
        if bytes.len() as u64 != self.asset.bytes {
            return Err(RuntimeError::Input("upload length changed".into()));
        }
        let io = |e: std::io::Error| RuntimeError::Store(format!("cannot keep the upload: {e}"));
        let staging = self.path.with_extension("part");
        let mut file = crate::private_fs::file(&staging, true).map_err(io)?;
        // Only remove a file after this upload actually created it.
        self.written = true;
        file.write_all(bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
        std::fs::rename(staging, &self.path).map_err(io)?;
        Ok(self)
    }
}
#[cfg(feature = "sqlite")]
impl Drop for Upload {
    fn drop(&mut self) {
        if self.written && !self.committed {
            let _ = std::fs::remove_file(self.path.with_extension("part"));
            let _ = std::fs::remove_file(&self.path);
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

    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
    pub(crate) fn ids(&self) -> impl Iterator<Item = &str> {
        self.items.iter().map(|(id, _)| id.as_str())
    }

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
}

impl AssetKind {
    pub fn word(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
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
}

impl Asset {
    /// The value a row column carries: the id and the facts the server
    /// established, never the client's word for them.
    pub fn column_value(&self) -> Value {
        let int = |value: Option<u64>| value.map(|v| Value::Int(v as i64)).unwrap_or(Value::Null);
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

const COLUMNS: &str = "id, owner, kind, content_type, bytes, width, height, duration, created_at, home_table, home_id, home_column, released_at";

fn read_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<Asset> {
    let kind: String = row.get(2)?;
    let home: (Option<String>, Option<String>, Option<String>) = (row.get(9)?, row.get(10)?, row.get(11)?);
    Ok(Asset {
        id: row.get(0)?,
        owner: row.get(1)?,
        kind: if kind == "video" { AssetKind::Video } else { AssetKind::Image },
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
    })
}

fn find(conn: &Connection, id: &str) -> Result<Option<Asset>, RuntimeError> {
    Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM _assets WHERE id = ?1"), [id], read_asset,
            ).optional()?)
}

    fn stale(conn: &Connection, now: i64) -> Result<Vec<Asset>, RuntimeError> {
        let mut statement = conn.prepare(&format!("SELECT {COLUMNS} FROM _assets WHERE released_at IS NOT NULL OR (home_table IS NULL AND created_at < ?1) LIMIT 256"))?;
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
            &format!("INSERT INTO _assets({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, NULL, NULL)"),
            params![asset.id, asset.owner, asset.kind.word(), asset.content_type, asset.bytes as i64, asset.width.map(i64::from), asset.height.map(i64::from), asset.duration.map(|d| d as i64), asset.created_at],
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
            let assets = stale(self.conn(), now)?;
            for asset in &assets {
                self.conn().execute("INSERT OR IGNORE INTO _asset_gc(asset) VALUES (?1)", [&asset.id])?;
                self.conn().execute(
                    "UPDATE _assets SET released_at = COALESCE(released_at, ?2) WHERE id = ?1",
                    params![asset.id, now],
                )?;
            }
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

    /// The home let go of the asset (the row is deleted, or the column
    /// cleared or replaced): served no more, unlinked by the sweep.
    pub fn release_asset(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _assets SET released_at = ?2, home_table = NULL, home_id = NULL, home_column = NULL WHERE id = ?1 AND released_at IS NULL", params![id, now])?;
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
