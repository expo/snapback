//! Trusted video container processing for the asset pipeline (LLP 0044,
//! completion program W2d): bounded ISO BMFF box-tree parsing and in-place
//! location blanking. This is box-structure surgery, never transcoding —
//! the strip rewrite blanks location carriers in place (type renamed to
//! `free`, payload zeroed) so every stco/co64 chunk offset stays valid
//! without a demux.
//!
//! Every input is hostile until proven otherwise: box sizes are validated
//! against their container before any traversal step, depth/count/metadata
//! ceilings refuse structurally, and a metadata region that might carry
//! location but cannot be safely classified refuses rather than passing
//! through — fail closed, never silently retain.
// @ref LLP 0044#restricted-staging-and-trusted-finalization — canonical
// bytes are the blanked file, digested after rewrite under the
// `strip-video.v1` policy tag.

use crate::diagnostic::{SnapbackError, SnapbackResult};

/// Enforced ceilings for one container-processing invocation; the local
/// values are `ASSET_VIDEO_CEILINGS_LOCAL_V1`, surfaced as capability
/// facts. Tests construct smaller ones so refusals are exercised without
/// gigantic fixtures.
#[derive(Clone, Copy, Debug)]
pub struct AssetVideoCeilingsV1 {
    pub max_box_depth: u32,
    pub max_box_count: u64,
    /// Total `udta`/`meta` payload bytes — the metadata-bomb bound.
    pub max_metadata_bytes: u64,
    pub step_time_budget_ms: u64,
    /// Whole-file bound for the canonicalization pass.
    pub max_parse_bytes: u64,
}

pub const ASSET_VIDEO_CEILINGS_LOCAL_V1: AssetVideoCeilingsV1 = AssetVideoCeilingsV1 {
    max_box_depth: 16,
    max_box_count: 65_536,
    max_metadata_bytes: 4 * 1024 * 1024,
    step_time_budget_ms: 10_000,
    max_parse_bytes: 256 * 1024 * 1024,
};

/// Container brands the strip rewrite understands. A file whose `ftyp`
/// names none of these (major or compatible) refuses under strip: an
/// unknown brand may lay out metadata this walker cannot classify.
const SUPPORTED_BRANDS: [&[u8; 4]; 6] = [b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"qt  "];

/// The XMP `uuid` extended type (ISO 14496-12 Annex; Adobe XMP part 3).
/// XMP is the one `uuid` payload this walker classifies: it may carry GPS,
/// so it is blanked wholesale. Any other `uuid` box refuses — unknown
/// vendor metadata cannot be proven location-free.
const XMP_UUID: [u8; 16] = [
    0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC,
];

fn bounds_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED", "assets", message)
}

fn parse_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_ASSET_VIDEO_PARSE_FAILED", "assets", message)
}

fn unsupported_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_ASSET_VIDEO_STRIP_UNSUPPORTED", "assets", message)
}

fn escaped_box_kind(kind: &[u8; 4]) -> String {
    kind.iter()
        .flat_map(|byte| std::ascii::escape_default(*byte))
        .map(char::from)
        .collect()
}

/// Safe facts extracted from the container. Location never leaves this
/// module: it is deliberately not represented here.
#[derive(Clone, Debug, Default)]
pub struct AssetVideoFacts {
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug)]
pub struct AssetVideoStripOutcome {
    /// The blanked container — identical layout, every location carrier
    /// overwritten in place.
    pub canonical: Vec<u8>,
    pub facts: AssetVideoFacts,
}

/// One in-place blank: rename the box type at `type_at` to `free` and zero
/// `payload` — sizes and therefore all sibling/chunk offsets are untouched.
struct BlankAction {
    type_at: usize,
    payload: std::ops::Range<usize>,
}

struct Walk<'a> {
    bytes: &'a [u8],
    ceilings: &'a AssetVideoCeilingsV1,
    started: std::time::Instant,
    box_count: u64,
    metadata_bytes: u64,
    blanks: Vec<BlankAction>,
    facts: AssetVideoFacts,
}

struct BoxHeader {
    kind: [u8; 4],
    /// First payload byte (past size/type/largesize).
    payload_start: usize,
    /// One past the last byte of the whole box.
    end: usize,
}

impl<'a> Walk<'a> {
    fn new(bytes: &'a [u8], ceilings: &'a AssetVideoCeilingsV1) -> Self {
        Self {
            bytes,
            ceilings,
            started: std::time::Instant::now(),
            box_count: 0,
            metadata_bytes: 0,
            blanks: Vec::new(),
            facts: AssetVideoFacts::default(),
        }
    }

    fn step(&mut self) -> SnapbackResult<()> {
        self.box_count += 1;
        if self.box_count > self.ceilings.max_box_count {
            return Err(bounds_error(format!(
                "box count exceeds the {} ceiling",
                self.ceilings.max_box_count
            )));
        }
        if self.box_count.is_multiple_of(256) {
            let elapsed = self.started.elapsed().as_millis() as u64;
            if elapsed > self.ceilings.step_time_budget_ms {
                return Err(bounds_error(format!(
                    "container walk exceeded its {}ms budget",
                    self.ceilings.step_time_budget_ms
                )));
            }
        }
        Ok(())
    }

    /// Parse one box header at `at`, validated against `end`. `top_level`
    /// admits the size-0 "to end of file" form; inside a container that
    /// form is refused — a nested to-end box is how size lies hide.
    fn header(&mut self, at: usize, end: usize, top_level: bool) -> SnapbackResult<BoxHeader> {
        self.step()?;
        if at + 8 > end {
            return Err(parse_error(format!(
                "truncated box header at byte offset {at}"
            )));
        }
        let size32 = u32::from_be_bytes(self.bytes[at..at + 4].try_into().unwrap());
        let mut kind = [0u8; 4];
        kind.copy_from_slice(&self.bytes[at + 4..at + 8]);
        let (payload_start, box_end) = match size32 {
            0 if top_level => (at + 8, end),
            0 => {
                return Err(parse_error(format!(
                    "box {} at byte offset {at} uses size 0 inside a container",
                    escaped_box_kind(&kind)
                )));
            }
            1 => {
                if at + 16 > end {
                    return Err(parse_error(format!(
                        "box {} at byte offset {at} has a truncated largesize header",
                        escaped_box_kind(&kind)
                    )));
                }
                let large = u64::from_be_bytes(self.bytes[at + 8..at + 16].try_into().unwrap());
                if large < 16 {
                    return Err(parse_error(format!(
                        "box {} at byte offset {at} has a largesize smaller than its header",
                        escaped_box_kind(&kind)
                    )));
                }
                let Some(box_end) = (at as u64).checked_add(large) else {
                    return Err(parse_error(format!(
                        "box {} at byte offset {at} has a largesize that overflows",
                        escaped_box_kind(&kind)
                    )));
                };
                let Ok(box_end) = usize::try_from(box_end) else {
                    return Err(parse_error(format!(
                        "box {} at byte offset {at} has a largesize that exceeds this platform",
                        escaped_box_kind(&kind)
                    )));
                };
                (at + 16, box_end)
            }
            2..=7 => {
                return Err(parse_error(format!(
                    "box {} at byte offset {at} declares a size smaller than its header",
                    escaped_box_kind(&kind)
                )));
            }
            size => {
                let Some(box_end) = at.checked_add(size as usize) else {
                    return Err(parse_error(format!(
                        "box {} at byte offset {at} declares a size that overflows",
                        escaped_box_kind(&kind)
                    )));
                };
                (at + 8, box_end)
            }
        };
        if box_end > end || box_end < payload_start {
            return Err(parse_error(format!(
                "box {} at byte offset {at} declares a size beyond its container",
                escaped_box_kind(&kind)
            )));
        }
        Ok(BoxHeader {
            kind,
            payload_start,
            end: box_end,
        })
    }

    fn walk_children(
        &mut self,
        start: usize,
        end: usize,
        depth: u32,
        parent: &[u8; 4],
    ) -> SnapbackResult<()> {
        if depth > self.ceilings.max_box_depth {
            return Err(bounds_error(format!(
                "box nesting exceeds the {} ceiling",
                self.ceilings.max_box_depth
            )));
        }
        let mut at = start;
        while at < end {
            // QuickTime writers may leave an all-zero suffix after the final
            // top-level atom. Admit only that exact, bounded padding form;
            // any nonzero suffix still goes through ordinary box validation.
            if depth == 0 && self.bytes[at..end].iter().all(|byte| *byte == 0) {
                break;
            }
            let header = self.header(at, end, depth == 0)?;
            self.visit(&header, depth, parent)?;
            at = header.end;
        }
        Ok(())
    }

    fn visit(&mut self, header: &BoxHeader, depth: u32, parent: &[u8; 4]) -> SnapbackResult<()> {
        let payload_len = (header.end - header.payload_start) as u64;
        match &header.kind {
            b"moov" | b"trak" => {
                self.walk_children(header.payload_start, header.end, depth + 1, &header.kind)
            }
            b"udta" => {
                self.metadata_check(payload_len)?;
                self.walk_children(header.payload_start, header.end, depth + 1, &header.kind)
            }
            b"meta" => {
                self.metadata_check(payload_len)?;
                // ISO `meta` is a fullbox with four version/flags bytes.
                // QuickTime `meta` instead starts directly with its required
                // `hdlr` child. Detect only that explicit direct-child form;
                // everything else keeps the ISO path and its size check.
                let direct_quicktime_children = header.payload_start + 8 <= header.end
                    && &self.bytes[header.payload_start + 4..header.payload_start + 8] == b"hdlr";
                let children_start = if direct_quicktime_children {
                    header.payload_start
                } else {
                    if payload_len < 4 {
                        return Err(parse_error("meta box smaller than its fullbox header"));
                    }
                    header.payload_start + 4
                };
                self.visit_meta(children_start, header.end, depth + 1)
            }
            b"mvhd" => {
                self.facts_from_mvhd(header)?;
                Ok(())
            }
            b"tkhd" => {
                self.facts_from_tkhd(header)?;
                Ok(())
            }
            b"uuid" => {
                if payload_len < 16 {
                    return Err(parse_error("uuid box smaller than its extended type"));
                }
                let ext = &self.bytes[header.payload_start..header.payload_start + 16];
                if ext == XMP_UUID {
                    // XMP may carry GPS; blank the whole payload including
                    // the extended type — a freed box needs neither.
                    self.blanks.push(BlankAction {
                        type_at: header.payload_start - 8 + 4,
                        payload: header.payload_start..header.end,
                    });
                    Ok(())
                } else {
                    Err(unsupported_error(
                        "unclassified uuid metadata box; cannot prove it location-free",
                    ))
                }
            }
            [0xA9, b'x', b'y', b'z'] | b"loci" if parent == b"udta" => {
                self.blanks.push(BlankAction {
                    type_at: header.payload_start - 8 + 4,
                    payload: header.payload_start..header.end,
                });
                Ok(())
            }
            // Everything else — mdat foremost — is skipped by size, never
            // read. Location carriers outside the walked containers are not
            // reachable by players either.
            _ => Ok(()),
        }
    }

    /// `meta` children: pair the `keys` name table with `ilst` entries so
    /// location-named keys blank their values. Any structural surprise in
    /// that pairing refuses — a metadata region that cannot be classified
    /// is never passed through.
    fn visit_meta(&mut self, start: usize, end: usize, depth: u32) -> SnapbackResult<()> {
        if depth > self.ceilings.max_box_depth {
            return Err(bounds_error(format!(
                "box nesting exceeds the {} ceiling",
                self.ceilings.max_box_depth
            )));
        }
        // First pass: locate keys/ilst.
        let mut location_key_indices: Vec<u32> = Vec::new();
        let mut ilst: Option<(usize, usize)> = None;
        let mut at = start;
        while at < end {
            let header = self.header(at, end, false)?;
            match &header.kind {
                b"keys" => {
                    location_key_indices =
                        self.location_key_indices(header.payload_start, header.end)?;
                }
                b"ilst" => ilst = Some((header.payload_start, header.end)),
                _ => {}
            }
            at = header.end;
        }
        if let Some((ilst_start, ilst_end)) = ilst {
            let mut at = ilst_start;
            while at < ilst_end {
                let header = self.header(at, ilst_end, false)?;
                // mdta-scheme children are keyed by 1-based big-endian
                // index into `keys`; iTunes-style children carry a 4CC
                // type directly.
                let index = u32::from_be_bytes(header.kind);
                let named_location = location_key_indices.contains(&index);
                let direct_location = matches!(&header.kind, [0xA9, b'x', b'y', b'z'] | b"loci");
                if named_location || direct_location {
                    self.blanks.push(BlankAction {
                        type_at: header.payload_start - 8 + 4,
                        payload: header.payload_start..header.end,
                    });
                }
                at = header.end;
            }
        } else if !location_key_indices.is_empty() {
            return Err(unsupported_error(
                "meta declares location keys but carries no parseable ilst",
            ));
        }
        Ok(())
    }

    /// The 1-based indices of `keys` entries whose names refer to location.
    fn location_key_indices(&mut self, start: usize, end: usize) -> SnapbackResult<Vec<u32>> {
        // keys is a fullbox: version/flags then entry_count.
        if start + 8 > end {
            return Err(parse_error("keys box smaller than its header"));
        }
        let count = u32::from_be_bytes(self.bytes[start + 4..start + 8].try_into().unwrap());
        let mut indices = Vec::new();
        let mut at = start + 8;
        for index in 1..=count {
            self.step()?;
            if at + 8 > end {
                return Err(parse_error("keys entry truncated"));
            }
            let size = u32::from_be_bytes(self.bytes[at..at + 4].try_into().unwrap()) as usize;
            if size < 8 || at + size > end {
                return Err(parse_error("keys entry declares a lying size"));
            }
            let name = &self.bytes[at + 8..at + size];
            let lowered = name.to_ascii_lowercase();
            if lowered
                .windows(b"location".len())
                .any(|window| window == b"location")
            {
                indices.push(index);
            }
            at += size;
        }
        Ok(indices)
    }

    fn metadata_check(&mut self, payload_len: u64) -> SnapbackResult<()> {
        self.metadata_bytes = self.metadata_bytes.saturating_add(payload_len);
        if self.metadata_bytes > self.ceilings.max_metadata_bytes {
            return Err(bounds_error(format!(
                "container metadata exceeds the {} byte ceiling",
                self.ceilings.max_metadata_bytes
            )));
        }
        Ok(())
    }

    fn facts_from_mvhd(&mut self, header: &BoxHeader) -> SnapbackResult<()> {
        let p = header.payload_start;
        if p + 4 > header.end {
            return Err(parse_error("mvhd smaller than its fullbox header"));
        }
        let version = self.bytes[p];
        let (timescale, duration) = match version {
            0 if p + 24 <= header.end => (
                u64::from(u32::from_be_bytes(
                    self.bytes[p + 12..p + 16].try_into().unwrap(),
                )),
                u64::from(u32::from_be_bytes(
                    self.bytes[p + 16..p + 20].try_into().unwrap(),
                )),
            ),
            1 if p + 32 <= header.end => (
                u64::from(u32::from_be_bytes(
                    self.bytes[p + 20..p + 24].try_into().unwrap(),
                )),
                u64::from_be_bytes(self.bytes[p + 24..p + 32].try_into().unwrap()),
            ),
            _ => return Err(parse_error("mvhd truncated for its declared version")),
        };
        self.facts.duration_ms = duration.saturating_mul(1000).checked_div(timescale);
        Ok(())
    }

    fn facts_from_tkhd(&mut self, header: &BoxHeader) -> SnapbackResult<()> {
        let p = header.payload_start;
        if p + 4 > header.end {
            return Err(parse_error("tkhd smaller than its fullbox header"));
        }
        let version = self.bytes[p];
        // 16.16 fixed-point width/height close the tkhd payload.
        let (w_at, h_at) = match version {
            0 => (p + 76, p + 80),
            1 => (p + 88, p + 92),
            _ => return Err(parse_error("tkhd carries an unknown version")),
        };
        if h_at + 4 > header.end {
            return Err(parse_error("tkhd truncated for its declared version"));
        }
        let width = u32::from_be_bytes(self.bytes[w_at..w_at + 4].try_into().unwrap()) >> 16;
        let height = u32::from_be_bytes(self.bytes[h_at..h_at + 4].try_into().unwrap()) >> 16;
        // The first visually sized track wins; audio tracks carry zeros.
        if width > 0 && height > 0 && self.facts.width.is_none() {
            self.facts.width = Some(width);
            self.facts.height = Some(height);
        }
        Ok(())
    }
}

fn check_brand(bytes: &[u8]) -> SnapbackResult<()> {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return Err(parse_error("container does not start with an ftyp box"));
    }
    let ftyp_size = u32::from_be_bytes(bytes[0..4].try_into().unwrap()) as usize;
    if ftyp_size < 16 || ftyp_size > bytes.len() {
        return Err(parse_error("ftyp declares a lying size"));
    }
    let major: &[u8; 4] = bytes[8..12].try_into().unwrap();
    if SUPPORTED_BRANDS.contains(&major) {
        return Ok(());
    }
    // Compatible brands follow the 4-byte minor version.
    let mut at = 16;
    while at + 4 <= ftyp_size {
        let brand: &[u8; 4] = bytes[at..at + 4].try_into().unwrap();
        if SUPPORTED_BRANDS.contains(&brand) {
            return Ok(());
        }
        at += 4;
    }
    Err(unsupported_error(format!(
        "container brand {} is not a supported strip target",
        String::from_utf8_lossy(major)
    )))
}

fn walk_container<'a>(
    bytes: &'a [u8],
    ceilings: &'a AssetVideoCeilingsV1,
) -> SnapbackResult<Walk<'a>> {
    if bytes.len() as u64 > ceilings.max_parse_bytes {
        return Err(bounds_error(format!(
            "container exceeds the {} byte processing ceiling",
            ceilings.max_parse_bytes
        )));
    }
    check_brand(bytes)?;
    let mut walk = Walk::new(bytes, ceilings);
    walk.walk_children(0, bytes.len(), 0, b"    ")?;
    Ok(walk)
}

/// The strip canonicalization: parse bounded, blank every location carrier
/// in place, return the blanked bytes and the safe facts. Deterministic
/// over the input — a hostile or unclassifiable container refuses
/// identically on every retry.
pub fn canonicalize_strip_video(
    bytes: &[u8],
    ceilings: &AssetVideoCeilingsV1,
) -> SnapbackResult<AssetVideoStripOutcome> {
    let walk = walk_container(bytes, ceilings)?;
    let facts = walk.facts.clone();
    let blanks = walk.blanks;
    let mut canonical = bytes.to_vec();
    for blank in blanks {
        canonical[blank.type_at..blank.type_at + 4].copy_from_slice(b"free");
        canonical[blank.payload.clone()].fill(0);
    }
    Ok(AssetVideoStripOutcome { canonical, facts })
}

/// Retain-path inspection: the same bounded walk for facts, no rewrite.
/// Hostile containers refuse deterministically here too — the video
/// capability claim covers both policies or neither.
pub fn inspect_video(
    bytes: &[u8],
    ceilings: &AssetVideoCeilingsV1,
) -> SnapbackResult<AssetVideoFacts> {
    Ok(walk_container(bytes, ceilings)?.facts)
}

/// Deterministic container fixtures shared with the finalizer e2e suites.
#[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
pub mod fixtures {
    pub const GPS: &str = "+37.7749-122.4194/";

    pub fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    pub fn ftyp() -> Vec<u8> {
        let mut payload = b"isom".to_vec();
        payload.extend_from_slice(&0u32.to_be_bytes());
        payload.extend_from_slice(b"isommp42");
        boxed(b"ftyp", &payload)
    }

    pub fn mvhd(timescale: u32, duration: u32) -> Vec<u8> {
        let mut payload = vec![0u8; 100];
        payload[12..16].copy_from_slice(&timescale.to_be_bytes());
        payload[16..20].copy_from_slice(&duration.to_be_bytes());
        boxed(b"mvhd", &payload)
    }

    pub fn tkhd(width: u32, height: u32) -> Vec<u8> {
        let mut payload = vec![0u8; 84];
        payload[76..80].copy_from_slice(&(width << 16).to_be_bytes());
        payload[80..84].copy_from_slice(&(height << 16).to_be_bytes());
        boxed(b"tkhd", &payload)
    }

    pub fn xyz_atom() -> Vec<u8> {
        let mut payload = (GPS.len() as u16).to_be_bytes().to_vec();
        payload.extend_from_slice(&0x15C7u16.to_be_bytes());
        payload.extend_from_slice(GPS.as_bytes());
        boxed(&[0xA9, b'x', b'y', b'z'], &payload)
    }

    /// A minimal valid MP4 carrying a QuickTime GPS atom: 640x480, 2 s.
    pub fn mp4_with_gps() -> Vec<u8> {
        let udta = boxed(b"udta", &xyz_atom());
        let trak = boxed(b"trak", &tkhd(640, 480));
        let moov = boxed(b"moov", &[mvhd(1000, 2000), trak, udta].concat());
        [ftyp(), moov, boxed(b"mdat", &[0u8; 32])].concat()
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::{GPS, boxed, ftyp, mvhd, tkhd};
    use super::*;

    fn gps_fixture() -> Vec<u8> {
        fixtures::mp4_with_gps()
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    fn quicktime_ftyp() -> Vec<u8> {
        let mut payload = b"qt  ".to_vec();
        payload.extend_from_slice(&0u32.to_be_bytes());
        payload.extend_from_slice(b"qt  ");
        boxed(b"ftyp", &payload)
    }

    fn mdta_location_meta(direct_quicktime_children: bool) -> Vec<u8> {
        let hdlr = boxed(b"hdlr", &[0u8; 24]);
        let name = b"com.apple.quicktime.location.ISO6709";
        let mut keys_payload = 0u32.to_be_bytes().to_vec();
        keys_payload.extend_from_slice(&1u32.to_be_bytes());
        keys_payload.extend_from_slice(&((name.len() + 8) as u32).to_be_bytes());
        keys_payload.extend_from_slice(b"mdta");
        keys_payload.extend_from_slice(name);
        let keys = boxed(b"keys", &keys_payload);
        let ilst = boxed(b"ilst", &boxed(&1u32.to_be_bytes(), GPS.as_bytes()));
        let mut payload = Vec::new();
        if !direct_quicktime_children {
            payload.extend_from_slice(&0u32.to_be_bytes());
        }
        payload.extend_from_slice(&hdlr);
        payload.extend_from_slice(&keys);
        payload.extend_from_slice(&ilst);
        boxed(b"meta", &payload)
    }

    fn largesize_box(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = 1u32.to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(&((payload.len() + 16) as u64).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    #[test]
    fn strips_udta_gps_and_extracts_safe_facts() {
        let source = gps_fixture();
        assert!(contains(&source, GPS.as_bytes()));
        let outcome = canonicalize_strip_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
        assert_eq!(outcome.canonical.len(), source.len(), "in-place blanking");
        assert!(!contains(&outcome.canonical, GPS.as_bytes()));
        assert!(!contains(&outcome.canonical, &[0xA9, b'x', b'y', b'z']));
        assert_eq!(outcome.facts.duration_ms, Some(2000));
        assert_eq!(outcome.facts.width, Some(640));
        assert_eq!(outcome.facts.height, Some(480));
        // mdat and every offset-bearing byte outside the blank is untouched.
        let mdat_at = source.len() - 40;
        assert_eq!(&outcome.canonical[mdat_at..], &source[mdat_at..]);
        // Deterministic: identical input, identical canonical bytes.
        let again = canonicalize_strip_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
        assert_eq!(again.canonical, outcome.canonical);
    }

    #[test]
    fn strips_loci_and_mdta_location_keys_but_keeps_other_metadata() {
        let loci = boxed(b"loci", b"\x00\x00\x15\xC7somewhere");
        let mut keys_payload = 0u32.to_be_bytes().to_vec();
        keys_payload.extend_from_slice(&2u32.to_be_bytes());
        for name in [
            "com.apple.quicktime.location.ISO6709",
            "com.apple.quicktime.model",
        ] {
            keys_payload.extend_from_slice(&((name.len() + 8) as u32).to_be_bytes());
            keys_payload.extend_from_slice(b"mdta");
            keys_payload.extend_from_slice(name.as_bytes());
        }
        let keys = boxed(b"keys", &keys_payload);
        let entry1 = boxed(&1u32.to_be_bytes(), GPS.as_bytes());
        let entry2 = boxed(&2u32.to_be_bytes(), b"Snapback Cam");
        let ilst = boxed(b"ilst", &[entry1, entry2].concat());
        let mut meta_payload = vec![0u8; 4];
        meta_payload.extend_from_slice(&[keys, ilst].concat());
        let meta = boxed(b"meta", &meta_payload);
        let udta = boxed(b"udta", &loci);
        let moov = boxed(b"moov", &[mvhd(600, 1200), udta, meta].concat());
        let source = [ftyp(), moov].concat();
        let outcome = canonicalize_strip_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
        assert!(!contains(&outcome.canonical, b"somewhere"));
        assert!(!contains(&outcome.canonical, GPS.as_bytes()));
        assert!(
            contains(&outcome.canonical, b"Snapback Cam"),
            "non-location keys stay"
        );
        assert_eq!(outcome.facts.duration_ms, Some(2000));
    }

    #[test]
    fn admits_synthesized_iphone_quicktime_layout() {
        // Metadata-only synthesis of the Apple layout named by the device
        // report: qt brand, exact 8-byte wide placeholder, largesize mdat,
        // moov last with co64, direct-child QuickTime meta, and zero tail.
        let mut co64_payload = 0u32.to_be_bytes().to_vec();
        co64_payload.extend_from_slice(&1u32.to_be_bytes());
        co64_payload.extend_from_slice(&64u64.to_be_bytes());
        let co64 = boxed(b"co64", &co64_payload);
        let stbl = boxed(b"stbl", &co64);
        let minf = boxed(b"minf", &stbl);
        let mdia = boxed(b"mdia", &minf);
        let trak = boxed(b"trak", &[tkhd(1920, 1080), mdia].concat());
        let udta = boxed(b"udta", &mdta_location_meta(true));
        let moov = boxed(b"moov", &[mvhd(600, 1800), trak, udta].concat());
        let mut source = quicktime_ftyp();
        source.extend_from_slice(&boxed(b"wide", &[]));
        source.extend_from_slice(&largesize_box(b"mdat", &[0xAA, 0xBB, 0, 0, 0, 0]));
        source.extend_from_slice(&moov);
        source.extend_from_slice(&[0u8; 7]);

        let outcome = canonicalize_strip_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
        assert_eq!(outcome.canonical.len(), source.len(), "in-place blanking");
        assert!(!contains(&outcome.canonical, GPS.as_bytes()));
        assert!(contains(&outcome.canonical, b"wide"));
        assert!(contains(&outcome.canonical, b"co64"));
        assert_eq!(&outcome.canonical[outcome.canonical.len() - 7..], &[0u8; 7]);
        assert_eq!(outcome.facts.duration_ms, Some(3000));
        assert_eq!(outcome.facts.width, Some(1920));
        assert_eq!(outcome.facts.height, Some(1080));
    }

    #[test]
    fn admits_top_level_size_zero_mdat_as_the_last_atom() {
        let mut size_zero_mdat = 0u32.to_be_bytes().to_vec();
        size_zero_mdat.extend_from_slice(b"mdat");
        size_zero_mdat.extend_from_slice(&[0xAA, 0xBB, 0, 0]);
        let source = [
            quicktime_ftyp(),
            boxed(b"wide", &[]),
            boxed(b"moov", &mvhd(1000, 1000)),
            size_zero_mdat,
        ]
        .concat();
        let facts = inspect_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
        assert_eq!(facts.duration_ms, Some(1000));
    }

    #[test]
    fn blanks_xmp_uuid_and_refuses_unknown_uuid() {
        let mut xmp_payload = XMP_UUID.to_vec();
        xmp_payload.extend_from_slice(b"<x:xmpmeta>gps here</x:xmpmeta>");
        let xmp = boxed(b"uuid", &xmp_payload);
        let source = [ftyp(), boxed(b"moov", &mvhd(1000, 1000)), xmp].concat();
        let outcome = canonicalize_strip_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
        assert!(!contains(&outcome.canonical, b"xmpmeta"));

        let mut unknown_payload = [0x11u8; 16].to_vec();
        unknown_payload.extend_from_slice(b"vendor mystery");
        let unknown = boxed(b"uuid", &unknown_payload);
        let source = [ftyp(), unknown].concat();
        let error = canonicalize_strip_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_VIDEO_STRIP_UNSUPPORTED"
        );
    }

    #[test]
    fn refuses_structural_hostility() {
        // Size lie: a box claiming bytes beyond its container.
        let mut lying = ftyp();
        lying.extend_from_slice(&64u32.to_be_bytes());
        lying.extend_from_slice(b"moov");
        let error = canonicalize_strip_video(&lying, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_VIDEO_PARSE_FAILED");

        // A nonzero tail remains a box header and still fails its declared
        // bound. Its non-printable kind is escaped and its offset is named.
        let mut malformed_tail = ftyp();
        let malformed_at = malformed_tail.len();
        malformed_tail.extend_from_slice(&16u32.to_be_bytes());
        malformed_tail.extend_from_slice(&[0u8; 4]);
        let error =
            canonicalize_strip_video(&malformed_tail, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_VIDEO_PARSE_FAILED");
        assert!(
            error.diagnostic.message.contains(&format!(
                "box \\x00\\x00\\x00\\x00 at byte offset {malformed_at}"
            )),
            "{}",
            error.diagnostic.message
        );
        assert!(!error.diagnostic.message.as_bytes().contains(&0));

        // A truncated header containing non-padding data still refuses.
        let mut truncated = ftyp();
        truncated.extend_from_slice(&[0, 1]);
        let error =
            canonicalize_strip_video(&truncated, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_VIDEO_PARSE_FAILED");
        assert!(
            error
                .diagnostic
                .message
                .contains(&format!("byte offset {}", ftyp().len()))
        );

        // Nested size-0 box.
        let nested_zero = {
            let mut inner = 0u32.to_be_bytes().to_vec();
            inner.extend_from_slice(b"udta");
            [ftyp(), boxed(b"moov", &inner)].concat()
        };
        let error =
            canonicalize_strip_video(&nested_zero, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_VIDEO_PARSE_FAILED");

        // Unsupported brand.
        let mut heic_payload = b"heic".to_vec();
        heic_payload.extend_from_slice(&0u32.to_be_bytes());
        heic_payload.extend_from_slice(b"heic");
        let heic = boxed(b"ftyp", &heic_payload);
        let error = canonicalize_strip_video(&heic, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_VIDEO_STRIP_UNSUPPORTED"
        );
    }

    #[test]
    fn ceilings_refuse_bombs() {
        let tiny = AssetVideoCeilingsV1 {
            max_box_depth: 3,
            max_box_count: 8,
            max_metadata_bytes: 64,
            step_time_budget_ms: 10_000,
            max_parse_bytes: 1024 * 1024,
        };
        // Depth bomb: moov > trak > udta > meta exceeds depth 3.
        let mut meta_payload = vec![0u8; 4];
        meta_payload.extend_from_slice(&boxed(b"ilst", &[]));
        let deep = boxed(
            b"moov",
            &boxed(b"trak", &boxed(b"udta", &boxed(b"meta", &meta_payload))),
        );
        let source = [ftyp(), deep].concat();
        let error = canonicalize_strip_video(&source, &tiny).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED"
        );

        // Count bomb.
        let mut many = ftyp();
        for _ in 0..16 {
            many.extend_from_slice(&boxed(b"free", &[]));
        }
        let error = canonicalize_strip_video(&many, &tiny).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED"
        );

        // Metadata bomb.
        let fat_udta = boxed(b"udta", &[0u8; 128]);
        let source = [ftyp(), boxed(b"moov", &fat_udta)].concat();
        let error = canonicalize_strip_video(&source, &tiny).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED"
        );

        // Whole-file ceiling.
        let capped = AssetVideoCeilingsV1 {
            max_parse_bytes: 16,
            ..tiny
        };
        let error = canonicalize_strip_video(&gps_fixture(), &capped).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED"
        );
    }

    #[test]
    fn inspect_matches_strip_facts_and_largesize_parses() {
        let facts = inspect_video(&gps_fixture(), &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
        assert_eq!(facts.duration_ms, Some(2000));
        assert_eq!(facts.width, Some(640));

        // A top-level largesize mdat parses.
        let mut large = 1u32.to_be_bytes().to_vec();
        large.extend_from_slice(b"mdat");
        large.extend_from_slice(&(16u64 + 8).to_be_bytes());
        large.extend_from_slice(&[0u8; 8]);
        let source = [ftyp(), boxed(b"moov", &mvhd(1000, 1000)), large].concat();
        inspect_video(&source, &ASSET_VIDEO_CEILINGS_LOCAL_V1).unwrap();
    }
}
