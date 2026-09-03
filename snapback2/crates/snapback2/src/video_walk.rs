//! Bounded MP4 and QuickTime container walking with in-place location stripping.
//!
//! Real-phone acceptance still needs a real portrait iPhone MOV supplied by a human
//! as required by LLP 1006 §15.

// @ref LLP 1006#9-lifecycle-finalize-off-the-writer-and-reclamation — video
// finalization walks the staging file without copying it and preserves chunk offsets
// by replacing location-bearing boxes with same-sized `free` boxes.

pub use crate::protocol::Refusal;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::ops::Range;
use std::path::Path;
use std::time::Instant;

/// Bounds enforced during one video-container walk.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ceilings {
    pub max_box_depth: u32,
    pub max_box_count: u64,
    /// Total `udta`/`meta` payload bytes.
    pub max_metadata_bytes: u64,
    pub step_time_budget_ms: u64,
    pub max_parse_bytes: u64,
}

pub const DEFAULT_CEILINGS: Ceilings = Ceilings {
    max_box_depth: 16,
    max_box_count: 65_536,
    max_metadata_bytes: 4 * 1024 * 1024,
    step_time_budget_ms: 10_000,
    max_parse_bytes: 256 * 1024 * 1024,
};

impl Default for Ceilings {
    fn default() -> Self {
        DEFAULT_CEILINGS
    }
}

/// Facts that are safe to place in a closed `VideoAsset` record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VideoFacts {
    pub detected_type: &'static str,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
}

const MP4_BRANDS: [[u8; 4]; 5] = [*b"isom", *b"iso2", *b"mp41", *b"mp42", *b"avc1"];
const QUICKTIME_BRAND: [u8; 4] = *b"qt  ";

/// Adobe's XMP extended type. XMP can carry GPS, so the entire box is blanked.
const XMP_UUID: [u8; 16] = [
    0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC,
];

fn asset_type_refusal(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TYPE",
        "input",
        message,
        "upload an MP4 or QuickTime MOV whose metadata and video facts can be verified",
        "assets/video",
    )
}

fn io_refusal(action: &str, error: std::io::Error) -> Refusal {
    asset_type_refusal(format!(
        "could not {action} the video staging file: {error}"
    ))
}

fn escaped_box_kind(kind: &[u8; 4]) -> String {
    kind.iter()
        .flat_map(|byte| std::ascii::escape_default(*byte))
        .map(char::from)
        .collect()
}

#[derive(Debug)]
struct BlankAction {
    type_at: u64,
    payload: Range<u64>,
}

#[derive(Debug)]
struct BoxHeader {
    kind: [u8; 4],
    type_at: u64,
    payload_start: u64,
    end: u64,
}

struct Walk<'a> {
    file: &'a mut File,
    ceilings: &'a Ceilings,
    started: Instant,
    box_count: u64,
    metadata_bytes: u64,
    blanks: Vec<BlankAction>,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
}

impl<'a> Walk<'a> {
    fn new(file: &'a mut File, ceilings: &'a Ceilings) -> Self {
        Self {
            file,
            ceilings,
            started: Instant::now(),
            box_count: 0,
            metadata_bytes: 0,
            blanks: Vec::new(),
            duration_ms: None,
            width: None,
            height: None,
        }
    }

    fn step(&mut self) -> Result<(), Refusal> {
        self.box_count = self.box_count.saturating_add(1);
        if self.box_count > self.ceilings.max_box_count {
            return Err(asset_type_refusal(format!(
                "box count exceeds the {} ceiling",
                self.ceilings.max_box_count
            )));
        }
        if self.box_count.is_multiple_of(256) {
            self.check_time()?;
        }
        Ok(())
    }

    fn check_time(&self) -> Result<(), Refusal> {
        if self.started.elapsed().as_millis() as u64 > self.ceilings.step_time_budget_ms {
            return Err(asset_type_refusal(format!(
                "container walk exceeded its {}ms budget",
                self.ceilings.step_time_budget_ms
            )));
        }
        Ok(())
    }

    fn read_exact_at<const N: usize>(&mut self, at: u64) -> Result<[u8; N], Refusal> {
        let mut bytes = [0u8; N];
        self.file
            .seek(SeekFrom::Start(at))
            .map_err(|error| io_refusal("seek in", error))?;
        self.file
            .read_exact(&mut bytes)
            .map_err(|error| io_refusal("read", error))?;
        Ok(bytes)
    }

    fn header(&mut self, at: u64, end: u64, top_level: bool) -> Result<BoxHeader, Refusal> {
        self.step()?;
        if at.checked_add(8).is_none_or(|header_end| header_end > end) {
            return Err(asset_type_refusal(format!(
                "truncated box header at byte offset {at}"
            )));
        }
        let base = self.read_exact_at::<8>(at)?;
        let size32 = u32::from_be_bytes(base[..4].try_into().unwrap());
        let kind: [u8; 4] = base[4..8].try_into().unwrap();
        let type_at = at + 4;
        let (payload_start, box_end) = match size32 {
            0 if top_level => (at + 8, end),
            0 => {
                return Err(asset_type_refusal(format!(
                    "box {} at byte offset {at} uses size 0 inside a container",
                    escaped_box_kind(&kind)
                )));
            }
            1 => {
                if at.checked_add(16).is_none_or(|header_end| header_end > end) {
                    return Err(asset_type_refusal(format!(
                        "box {} at byte offset {at} has a truncated largesize header",
                        escaped_box_kind(&kind)
                    )));
                }
                let large = u64::from_be_bytes(self.read_exact_at::<8>(at + 8)?);
                if large < 16 {
                    return Err(asset_type_refusal(format!(
                        "box {} at byte offset {at} has a largesize smaller than its header",
                        escaped_box_kind(&kind)
                    )));
                }
                let Some(box_end) = at.checked_add(large) else {
                    return Err(asset_type_refusal(format!(
                        "box {} at byte offset {at} has a largesize that overflows",
                        escaped_box_kind(&kind)
                    )));
                };
                (at + 16, box_end)
            }
            2..=7 => {
                return Err(asset_type_refusal(format!(
                    "box {} at byte offset {at} declares a size smaller than its header",
                    escaped_box_kind(&kind)
                )));
            }
            size => {
                let Some(box_end) = at.checked_add(u64::from(size)) else {
                    return Err(asset_type_refusal(format!(
                        "box {} at byte offset {at} declares a size that overflows",
                        escaped_box_kind(&kind)
                    )));
                };
                (at + 8, box_end)
            }
        };
        if box_end > end || box_end < payload_start {
            return Err(asset_type_refusal(format!(
                "box {} at byte offset {at} declares a size beyond its container",
                escaped_box_kind(&kind)
            )));
        }
        Ok(BoxHeader {
            kind,
            type_at,
            payload_start,
            end: box_end,
        })
    }

    fn walk_children(
        &mut self,
        start: u64,
        end: u64,
        depth: u32,
        parent: &[u8; 4],
    ) -> Result<(), Refusal> {
        if depth > self.ceilings.max_box_depth {
            return Err(asset_type_refusal(format!(
                "box nesting exceeds the {} ceiling",
                self.ceilings.max_box_depth
            )));
        }
        let mut at = start;
        while at < end {
            if depth == 0 && self.region_is_all_zero(at, end)? {
                break;
            }
            let header = self.header(at, end, depth == 0)?;
            self.visit(&header, depth, parent)?;
            at = header.end;
        }
        Ok(())
    }

    fn region_is_all_zero(&mut self, start: u64, end: u64) -> Result<bool, Refusal> {
        let mut at = start;
        let mut buffer = [0u8; 8192];
        self.file
            .seek(SeekFrom::Start(start))
            .map_err(|error| io_refusal("seek in", error))?;
        while at < end {
            let length = usize::try_from((end - at).min(buffer.len() as u64)).unwrap();
            self.file
                .read_exact(&mut buffer[..length])
                .map_err(|error| io_refusal("read", error))?;
            if buffer[..length].iter().any(|byte| *byte != 0) {
                return Ok(false);
            }
            at += length as u64;
            self.check_time()?;
        }
        Ok(true)
    }

    fn visit(&mut self, header: &BoxHeader, depth: u32, parent: &[u8; 4]) -> Result<(), Refusal> {
        let payload_len = header.end - header.payload_start;
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
                let direct_quicktime_children = header
                    .payload_start
                    .checked_add(8)
                    .is_some_and(|needed| needed <= header.end)
                    && self.read_exact_at::<4>(header.payload_start + 4)? == *b"hdlr";
                let children_start = if direct_quicktime_children {
                    header.payload_start
                } else {
                    if payload_len < 4 {
                        return Err(asset_type_refusal(
                            "meta box smaller than its fullbox header",
                        ));
                    }
                    header.payload_start + 4
                };
                self.visit_meta(children_start, header.end, depth + 1)
            }
            b"mvhd" => self.facts_from_mvhd(header),
            b"tkhd" => self.facts_from_tkhd(header),
            b"uuid" => {
                if payload_len < 16 {
                    return Err(asset_type_refusal(
                        "uuid box smaller than its extended type",
                    ));
                }
                if self.read_exact_at::<16>(header.payload_start)? == XMP_UUID {
                    self.blanks.push(BlankAction {
                        type_at: header.type_at,
                        payload: header.payload_start..header.end,
                    });
                    Ok(())
                } else {
                    Err(asset_type_refusal(
                        "unclassified uuid metadata box; cannot prove it location-free",
                    ))
                }
            }
            [0xA9, b'x', b'y', b'z'] | b"loci" if parent == b"udta" => {
                self.blanks.push(BlankAction {
                    type_at: header.type_at,
                    payload: header.payload_start..header.end,
                });
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn visit_meta(&mut self, start: u64, end: u64, depth: u32) -> Result<(), Refusal> {
        if depth > self.ceilings.max_box_depth {
            return Err(asset_type_refusal(format!(
                "box nesting exceeds the {} ceiling",
                self.ceilings.max_box_depth
            )));
        }
        let mut location_key_indices = Vec::new();
        let mut ilst = None;
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
                let index = u32::from_be_bytes(header.kind);
                let named_location = location_key_indices.contains(&index);
                let direct_location = matches!(&header.kind, [0xA9, b'x', b'y', b'z'] | b"loci");
                if named_location || direct_location {
                    self.blanks.push(BlankAction {
                        type_at: header.type_at,
                        payload: header.payload_start..header.end,
                    });
                }
                at = header.end;
            }
        } else if !location_key_indices.is_empty() {
            return Err(asset_type_refusal(
                "meta declares location keys but carries no parseable ilst",
            ));
        }
        Ok(())
    }

    fn location_key_indices(&mut self, start: u64, end: u64) -> Result<Vec<u32>, Refusal> {
        if start.checked_add(8).is_none_or(|needed| needed > end) {
            return Err(asset_type_refusal("keys box smaller than its header"));
        }
        let prefix = self.read_exact_at::<8>(start)?;
        let count = u32::from_be_bytes(prefix[4..8].try_into().unwrap());
        let mut indices = Vec::new();
        let mut at = start + 8;
        for index in 1..=count {
            self.step()?;
            if at.checked_add(8).is_none_or(|needed| needed > end) {
                return Err(asset_type_refusal("keys entry truncated"));
            }
            let entry_prefix = self.read_exact_at::<8>(at)?;
            let size = u64::from(u32::from_be_bytes(entry_prefix[..4].try_into().unwrap()));
            let Some(entry_end) = at.checked_add(size) else {
                return Err(asset_type_refusal("keys entry declares a lying size"));
            };
            if size < 8 || entry_end > end {
                return Err(asset_type_refusal("keys entry declares a lying size"));
            }
            if self.region_contains_location(at + 8, entry_end)? {
                indices.push(index);
            }
            at = entry_end;
        }
        Ok(indices)
    }

    fn region_contains_location(&mut self, start: u64, end: u64) -> Result<bool, Refusal> {
        const NEEDLE: &[u8; 8] = b"location";
        let mut matched = 0usize;
        let mut at = start;
        let mut buffer = [0u8; 8192];
        self.file
            .seek(SeekFrom::Start(start))
            .map_err(|error| io_refusal("seek in", error))?;
        while at < end {
            let length = usize::try_from((end - at).min(buffer.len() as u64)).unwrap();
            self.file
                .read_exact(&mut buffer[..length])
                .map_err(|error| io_refusal("read", error))?;
            for byte in &buffer[..length] {
                let lower = byte.to_ascii_lowercase();
                if lower == NEEDLE[matched] {
                    matched += 1;
                    if matched == NEEDLE.len() {
                        return Ok(true);
                    }
                } else {
                    matched = usize::from(lower == NEEDLE[0]);
                }
            }
            at += length as u64;
            self.check_time()?;
        }
        Ok(false)
    }

    fn metadata_check(&mut self, payload_len: u64) -> Result<(), Refusal> {
        self.metadata_bytes = self.metadata_bytes.saturating_add(payload_len);
        if self.metadata_bytes > self.ceilings.max_metadata_bytes {
            return Err(asset_type_refusal(format!(
                "container metadata exceeds the {} byte ceiling",
                self.ceilings.max_metadata_bytes
            )));
        }
        Ok(())
    }

    fn facts_from_mvhd(&mut self, header: &BoxHeader) -> Result<(), Refusal> {
        let p = header.payload_start;
        if p.checked_add(4).is_none_or(|needed| needed > header.end) {
            return Err(asset_type_refusal("mvhd smaller than its fullbox header"));
        }
        let version = self.read_exact_at::<4>(p)?[0];
        let (timescale, duration) = match version {
            0 if p + 24 <= header.end => {
                let fields = self.read_exact_at::<20>(p)?;
                (
                    u64::from(u32::from_be_bytes(fields[12..16].try_into().unwrap())),
                    u64::from(u32::from_be_bytes(fields[16..20].try_into().unwrap())),
                )
            }
            1 if p + 32 <= header.end => {
                let fields = self.read_exact_at::<32>(p)?;
                (
                    u64::from(u32::from_be_bytes(fields[20..24].try_into().unwrap())),
                    u64::from_be_bytes(fields[24..32].try_into().unwrap()),
                )
            }
            _ => {
                return Err(asset_type_refusal(
                    "mvhd truncated for its declared version",
                ));
            }
        };
        self.duration_ms = duration.saturating_mul(1000).checked_div(timescale);
        Ok(())
    }

    fn facts_from_tkhd(&mut self, header: &BoxHeader) -> Result<(), Refusal> {
        let p = header.payload_start;
        if p.checked_add(4).is_none_or(|needed| needed > header.end) {
            return Err(asset_type_refusal("tkhd smaller than its fullbox header"));
        }
        let version = self.read_exact_at::<4>(p)?[0];
        let matrix_at = match version {
            0 if p + 84 <= header.end => p + 40,
            1 if p + 96 <= header.end => p + 52,
            0 | 1 => {
                return Err(asset_type_refusal(
                    "tkhd truncated for its declared version",
                ));
            }
            _ => return Err(asset_type_refusal("tkhd carries an unknown version")),
        };
        let fields = self.read_exact_at::<44>(matrix_at)?;
        let a = i32::from_be_bytes(fields[0..4].try_into().unwrap());
        let b = i32::from_be_bytes(fields[4..8].try_into().unwrap());
        let c = i32::from_be_bytes(fields[12..16].try_into().unwrap());
        let d = i32::from_be_bytes(fields[16..20].try_into().unwrap());
        let width = u32::from_be_bytes(fields[36..40].try_into().unwrap());
        let height = u32::from_be_bytes(fields[40..44].try_into().unwrap());
        if width == 0 || height == 0 || self.width.is_some() {
            return Ok(());
        }
        let display_width = transformed_extent(a, c, width, height)?;
        let display_height = transformed_extent(b, d, width, height)?;
        if display_width > 0 && display_height > 0 {
            self.width = Some(display_width);
            self.height = Some(display_height);
        }
        Ok(())
    }
}

fn transformed_extent(
    along_width: i32,
    along_height: i32,
    width_16_16: u32,
    height_16_16: u32,
) -> Result<u32, Refusal> {
    let numerator = u128::from(along_width.unsigned_abs()) * u128::from(width_16_16)
        + u128::from(along_height.unsigned_abs()) * u128::from(height_16_16);
    let unit = 1u128 << 32;
    let pixels = numerator.div_ceil(unit);
    u32::try_from(pixels)
        .map_err(|_| asset_type_refusal("tkhd transform produces an unbounded display size"))
}

fn classify_brand(brand: [u8; 4]) -> Option<&'static str> {
    if brand == QUICKTIME_BRAND {
        Some("video/quicktime")
    } else if MP4_BRANDS.contains(&brand) {
        Some("video/mp4")
    } else {
        None
    }
}

fn check_brand(file: &mut File, file_len: u64) -> Result<&'static str, Refusal> {
    if file_len < 12 {
        return Err(asset_type_refusal(
            "container does not start with an ftyp box",
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| io_refusal("seek in", error))?;
    let mut prefix = [0u8; 12];
    file.read_exact(&mut prefix)
        .map_err(|error| io_refusal("read", error))?;
    if &prefix[4..8] != b"ftyp" {
        return Err(asset_type_refusal(
            "container does not start with an ftyp box",
        ));
    }
    let ftyp_size = u64::from(u32::from_be_bytes(prefix[..4].try_into().unwrap()));
    if ftyp_size < 16 || ftyp_size > file_len {
        return Err(asset_type_refusal("ftyp declares a lying size"));
    }
    let major: [u8; 4] = prefix[8..12].try_into().unwrap();
    if let Some(detected_type) = classify_brand(major) {
        return Ok(detected_type);
    }
    let mut at = 16;
    while at + 4 <= ftyp_size {
        file.seek(SeekFrom::Start(at))
            .map_err(|error| io_refusal("seek in", error))?;
        let mut brand = [0u8; 4];
        file.read_exact(&mut brand)
            .map_err(|error| io_refusal("read", error))?;
        if let Some(detected_type) = classify_brand(brand) {
            return Ok(detected_type);
        }
        at += 4;
    }
    Err(asset_type_refusal(format!(
        "container brand {} is not a supported strip target",
        String::from_utf8_lossy(&major)
    )))
}

fn apply_blanks(file: &mut File, blanks: &[BlankAction]) -> Result<(), Refusal> {
    const ZEROS: [u8; 8192] = [0; 8192];
    for blank in blanks {
        file.seek(SeekFrom::Start(blank.type_at))
            .map_err(|error| io_refusal("seek in", error))?;
        file.write_all(b"free")
            .map_err(|error| io_refusal("write", error))?;
        file.seek(SeekFrom::Start(blank.payload.start))
            .map_err(|error| io_refusal("seek in", error))?;
        let mut remaining = blank.payload.end - blank.payload.start;
        while remaining > 0 {
            let length = usize::try_from(remaining.min(ZEROS.len() as u64)).unwrap();
            file.write_all(&ZEROS[..length])
                .map_err(|error| io_refusal("write", error))?;
            remaining -= length as u64;
        }
    }
    file.flush().map_err(|error| io_refusal("flush", error))
}

/// Validate and strip an MP4 or QuickTime MOV in place on its staging path.
///
/// The complete read-only walk succeeds before the first byte is changed. Location-bearing
/// box types become `free` and their payloads become zeroes; box sizes and media offsets do
/// not move. Missing or zero closed-record facts refuse rather than returning partial facts.
pub fn walk_and_strip(path: &Path, ceilings: &Ceilings) -> Result<VideoFacts, Refusal> {
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| io_refusal("open", error))?;
    let file_len = file
        .metadata()
        .map_err(|error| io_refusal("inspect", error))?
        .len();
    if file_len > ceilings.max_parse_bytes {
        return Err(asset_type_refusal(format!(
            "container exceeds the {} byte processing ceiling",
            ceilings.max_parse_bytes
        )));
    }
    let detected_type = check_brand(&mut file, file_len)?;
    let mut walk = Walk::new(&mut file, ceilings);
    walk.walk_children(0, file_len, 0, b"    ")?;

    let duration_ms = walk
        .duration_ms
        .filter(|duration| *duration > 0)
        .ok_or_else(|| {
            asset_type_refusal("video container is missing a non-zero mvhd timescale and duration")
        })?;
    let (width, height) = match (walk.width, walk.height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => (width, height),
        _ => {
            return Err(asset_type_refusal(
                "video container has no video tkhd with non-zero display width and height",
            ));
        }
    };
    apply_blanks(walk.file, &walk.blanks)?;
    Ok(VideoFacts {
        detected_type,
        duration_ms,
        width,
        height,
    })
}
