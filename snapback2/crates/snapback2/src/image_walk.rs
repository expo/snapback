//! Bounded JPEG, PNG, and WebP metadata walks.

use crate::protocol::Refusal;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_METADATA_BYTES: u64 = 4 * 1024 * 1024;
const WEBP_EXIF_FLAG: u8 = 0b0000_1000;
const WEBP_XMP_FLAG: u8 = 0b0000_0100;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Webp,
    Heic,
}

impl ImageFormat {
    pub fn media_type(self) -> &'static str {
        match self {
            Self::Jpeg | Self::Heic => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ImageFacts {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub orientation: u8,
    pub sensor_width: u32,
    pub sensor_height: u32,
}

pub fn detect(path: &Path) -> Result<Option<ImageFormat>, Refusal> {
    let mut file = File::open(path).map_err(|error| asset_io("open image staging file", error))?;
    let mut prefix = [0_u8; 32];
    let read = file
        .read(&mut prefix)
        .map_err(|error| asset_io("read image header", error))?;
    let prefix = &prefix[..read];
    if prefix.starts_with(&[0xff, 0xd8, 0xff]) {
        return Ok(Some(ImageFormat::Jpeg));
    }
    if prefix.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(Some(ImageFormat::Png));
    }
    if prefix.len() >= 12 && &prefix[..4] == b"RIFF" && &prefix[8..12] == b"WEBP" {
        return Ok(Some(ImageFormat::Webp));
    }
    if prefix.len() >= 16 && &prefix[4..8] == b"ftyp" && heic_brand(&prefix[8..]) {
        return Ok(Some(ImageFormat::Heic));
    }
    Ok(None)
}

// @ref LLP 1006#4-admission — metadata is deleted structurally while a newly
// synthesized EXIF container retains only the orientation needed to render the
// untouched compressed pixels correctly.
pub fn strip(path: &Path) -> Result<ImageFacts, Refusal> {
    match detect(path)? {
        Some(ImageFormat::Jpeg) => strip_jpeg(path),
        Some(ImageFormat::Png) => strip_png(path),
        Some(ImageFormat::Webp) => strip_webp(path),
        Some(ImageFormat::Heic) | None => Err(asset_type(
            "image strip accepts JPEG, PNG, or WebP after HEIC normalization",
        )),
    }
}

fn strip_jpeg(path: &Path) -> Result<ImageFacts, Refusal> {
    let facts = inspect_jpeg(path)?;
    let mut input = File::open(path).map_err(|error| asset_io("open JPEG", error))?;
    let (temporary, mut output) = temporary_output(path)?;
    let result = (|| -> Result<(), Refusal> {
        let mut soi = [0_u8; 2];
        input
            .read_exact(&mut soi)
            .map_err(|error| asset_type(format!("truncated JPEG signature: {error}")))?;
        if soi != [0xff, 0xd8] {
            return Err(asset_type("JPEG signature is malformed"));
        }
        output
            .write_all(&soi)
            .map_err(|error| asset_io("write stripped JPEG", error))?;
        write_jpeg_exif(&mut output, facts.orientation)?;
        let mut pending = None;
        loop {
            let marker = pending
                .take()
                .map_or_else(|| read_jpeg_marker(&mut input), Ok)?;
            if marker == 0xd9 {
                output
                    .write_all(&[0xff, marker])
                    .map_err(|error| asset_io("write JPEG end marker", error))?;
                break;
            }
            if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
                if (0xd0..=0xd7).contains(&marker) {
                    output
                        .write_all(&[0xff, marker])
                        .map_err(|error| asset_io("write JPEG restart marker", error))?;
                }
                continue;
            }
            let length = read_u16_be(&mut input)?;
            if length < 2 {
                return Err(asset_type("JPEG segment has an invalid length"));
            }
            let payload_len = usize::from(length - 2);
            let mut payload = vec![0_u8; payload_len];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated JPEG segment: {error}")))?;
            if marker == 0xda {
                output
                    .write_all(&[0xff, marker])
                    .and_then(|()| output.write_all(&length.to_be_bytes()))
                    .and_then(|()| output.write_all(&payload))
                    .map_err(|error| asset_io("write JPEG scan header", error))?;
                pending = Some(copy_jpeg_scan(&mut input, &mut output)?);
                continue;
            }
            if jpeg_segment_allowed(marker, &payload) {
                output
                    .write_all(&[0xff, marker])
                    .and_then(|()| output.write_all(&length.to_be_bytes()))
                    .and_then(|()| output.write_all(&payload))
                    .map_err(|error| asset_io("write JPEG segment", error))?;
            }
        }
        finish_replace(path, &temporary, output)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|()| facts)
}

fn inspect_jpeg(path: &Path) -> Result<ImageFacts, Refusal> {
    let mut input = File::open(path).map_err(|error| asset_io("open JPEG", error))?;
    let mut soi = [0_u8; 2];
    input
        .read_exact(&mut soi)
        .map_err(|error| asset_type(format!("truncated JPEG signature: {error}")))?;
    if soi != [0xff, 0xd8] {
        return Err(asset_type("JPEG signature is malformed"));
    }
    let mut dimensions = None;
    let mut orientation = 1;
    let mut metadata = 0_u64;
    let mut pending = None;
    loop {
        let marker = pending
            .take()
            .map_or_else(|| read_jpeg_marker(&mut input), Ok)?;
        if marker == 0xd9 {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        let length = read_u16_be(&mut input)?;
        if length < 2 {
            return Err(asset_type("JPEG segment has an invalid length"));
        }
        let payload_len = usize::from(length - 2);
        if marker == 0xe1 || marker == 0xed || marker == 0xfe || (0xe0..=0xef).contains(&marker) {
            metadata = metadata.saturating_add(payload_len as u64);
            if metadata > MAX_METADATA_BYTES {
                return Err(too_large("JPEG metadata exceeds the 4 MiB safety ceiling"));
            }
        }
        if marker == 0xda {
            skip_exact(&mut input, payload_len as u64)?;
            pending = Some(skip_jpeg_scan(&mut input)?);
        } else if is_sof(marker) {
            let mut head = [0_u8; 5];
            if payload_len < head.len() {
                return Err(asset_type("JPEG frame header is truncated"));
            }
            input
                .read_exact(&mut head)
                .map_err(|error| asset_type(format!("truncated JPEG frame: {error}")))?;
            dimensions = Some((
                u32::from(u16::from_be_bytes([head[3], head[4]])),
                u32::from(u16::from_be_bytes([head[1], head[2]])),
            ));
            skip_exact(&mut input, (payload_len - head.len()) as u64)?;
        } else if marker == 0xe1 {
            let mut payload = vec![0_u8; payload_len];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated JPEG EXIF: {error}")))?;
            if let Some(value) = parse_orientation(&payload)? {
                orientation = value;
            }
        } else {
            skip_exact(&mut input, payload_len as u64)?;
        }
    }
    let (sensor_width, sensor_height) =
        dimensions.ok_or_else(|| asset_type("JPEG has no frame dimensions"))?;
    let (width, height) = display_dimensions(sensor_width, sensor_height, orientation);
    positive_dimensions(width, height)?;
    Ok(ImageFacts {
        format: ImageFormat::Jpeg,
        width,
        height,
        orientation,
        sensor_width,
        sensor_height,
    })
}

fn jpeg_segment_allowed(marker: u8, payload: &[u8]) -> bool {
    is_sof(marker)
        || matches!(marker, 0xc4 | 0xdb | 0xdd)
        || (marker == 0xe0 && payload.starts_with(b"JFIF\0"))
        || (marker == 0xe2 && payload.starts_with(b"ICC_PROFILE\0"))
        // Adobe APP14 is rendering data for CMYK/YCCK, not private metadata.
        // Its fixed 12-byte payload ends in the color-transform selector.
        || (marker == 0xee && payload.len() == 12 && payload.starts_with(b"Adobe"))
}

fn strip_png(path: &Path) -> Result<ImageFacts, Refusal> {
    let facts = inspect_png(path)?;
    let mut input = File::open(path).map_err(|error| asset_io("open PNG", error))?;
    let (temporary, mut output) = temporary_output(path)?;
    let result = (|| -> Result<(), Refusal> {
        let mut signature = [0_u8; 8];
        input
            .read_exact(&mut signature)
            .map_err(|error| asset_type(format!("truncated PNG signature: {error}")))?;
        output
            .write_all(&signature)
            .map_err(|error| asset_io("write PNG signature", error))?;
        let mut wrote_exif = false;
        loop {
            let (length, kind) = read_png_chunk_header(&mut input)?;
            if &kind == b"eXIf" || !png_chunk_allowed(&kind) {
                skip_exact(&mut input, u64::from(length) + 4)?;
            } else {
                output
                    .write_all(&length.to_be_bytes())
                    .and_then(|()| output.write_all(&kind))
                    .map_err(|error| asset_io("write PNG chunk header", error))?;
                copy_exact(&mut input, &mut output, u64::from(length) + 4)?;
            }
            if &kind == b"IHDR" && !wrote_exif {
                write_png_chunk(&mut output, b"eXIf", &minimal_tiff(facts.orientation))?;
                wrote_exif = true;
            }
            if &kind == b"IEND" {
                break;
            }
        }
        finish_replace(path, &temporary, output)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|()| facts)
}

fn inspect_png(path: &Path) -> Result<ImageFacts, Refusal> {
    let mut input = File::open(path).map_err(|error| asset_io("open PNG", error))?;
    let mut signature = [0_u8; 8];
    input
        .read_exact(&mut signature)
        .map_err(|error| asset_type(format!("truncated PNG signature: {error}")))?;
    if signature != *b"\x89PNG\r\n\x1a\n" {
        return Err(asset_type("PNG signature is malformed"));
    }
    let mut dimensions = None;
    let mut orientation = 1;
    let mut metadata = 0_u64;
    loop {
        let (length, kind) = read_png_chunk_header(&mut input)?;
        if matches!(&kind, b"eXIf" | b"tEXt" | b"iTXt" | b"zTXt") {
            metadata = metadata.saturating_add(u64::from(length));
            if metadata > MAX_METADATA_BYTES {
                return Err(too_large("PNG metadata exceeds the 4 MiB safety ceiling"));
            }
        }
        if &kind == b"IHDR" {
            if length != 13 || dimensions.is_some() {
                return Err(asset_type("PNG IHDR is malformed"));
            }
            let mut payload = [0_u8; 13];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated PNG IHDR: {error}")))?;
            dimensions = Some((
                u32::from_be_bytes(payload[..4].try_into().unwrap()),
                u32::from_be_bytes(payload[4..8].try_into().unwrap()),
            ));
            skip_exact(&mut input, 4)?;
        } else if &kind == b"eXIf" {
            let mut payload = vec![0_u8; length as usize];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated PNG EXIF: {error}")))?;
            if let Some(value) = parse_orientation(&payload)? {
                orientation = value;
            }
            skip_exact(&mut input, 4)?;
        } else {
            skip_exact(&mut input, u64::from(length) + 4)?;
        }
        if &kind == b"IEND" {
            break;
        }
    }
    let (sensor_width, sensor_height) = dimensions.ok_or_else(|| asset_type("PNG has no IHDR"))?;
    let (width, height) = display_dimensions(sensor_width, sensor_height, orientation);
    positive_dimensions(width, height)?;
    Ok(ImageFacts {
        format: ImageFormat::Png,
        width,
        height,
        orientation,
        sensor_width,
        sensor_height,
    })
}

fn png_chunk_allowed(kind: &[u8; 4]) -> bool {
    matches!(
        kind,
        b"IHDR"
            | b"PLTE"
            | b"tRNS"
            | b"IDAT"
            | b"IEND"
            | b"gAMA"
            | b"cHRM"
            | b"iCCP"
            | b"sRGB"
            | b"sBIT"
            | b"pHYs"
            | b"bKGD"
            | b"hIST"
            | b"sPLT"
            | b"acTL"
            | b"fcTL"
            | b"fdAT"
    )
}

fn strip_webp(path: &Path) -> Result<ImageFacts, Refusal> {
    let facts = inspect_webp(path)?;
    let mut input = File::open(path).map_err(|error| asset_io("open WebP", error))?;
    let (temporary, mut output) = temporary_output(path)?;
    let result = (|| -> Result<(), Refusal> {
        let mut header = [0_u8; 12];
        input
            .read_exact(&mut header)
            .map_err(|error| asset_type(format!("truncated WebP header: {error}")))?;
        output
            .write_all(b"RIFF\0\0\0\0WEBP")
            .map_err(|error| asset_io("write WebP header", error))?;
        let has_vp8x = first_webp_chunk_is_vp8x(&mut input)?;
        input
            .seek(SeekFrom::Start(12))
            .map_err(|error| asset_io("seek WebP", error))?;
        if !has_vp8x {
            let mut payload = [0_u8; 10];
            payload[0] = WEBP_EXIF_FLAG;
            write_u24_le(&mut payload[4..7], facts.sensor_width - 1);
            write_u24_le(&mut payload[7..10], facts.sensor_height - 1);
            write_webp_chunk(&mut output, b"VP8X", &payload)?;
        }
        let total = input
            .metadata()
            .map_err(|error| asset_io("inspect WebP", error))?
            .len();
        let mut at = 12_u64;
        while at < total {
            let (kind, length) = read_webp_chunk_header(&mut input)?;
            at = at.saturating_add(8);
            let padded = u64::from(length) + u64::from(length & 1);
            if at.saturating_add(padded) > total {
                return Err(asset_type("WebP chunk exceeds the RIFF body"));
            }
            if &kind == b"EXIF" || !webp_chunk_allowed(&kind) {
                skip_exact(&mut input, padded)?;
            } else if &kind == b"VP8X" {
                if length != 10 {
                    return Err(asset_type("WebP VP8X chunk must be exactly 10 bytes"));
                }
                let mut payload = [0_u8; 10];
                input
                    .read_exact(&mut payload)
                    .map_err(|error| asset_type(format!("truncated WebP VP8X: {error}")))?;
                if length & 1 == 1 {
                    skip_exact(&mut input, 1)?;
                }
                payload[0] = (payload[0] | WEBP_EXIF_FLAG) & !WEBP_XMP_FLAG;
                write_webp_chunk(&mut output, b"VP8X", &payload)?;
            } else {
                output
                    .write_all(&kind)
                    .and_then(|()| output.write_all(&length.to_le_bytes()))
                    .map_err(|error| asset_io("write WebP chunk header", error))?;
                copy_exact(&mut input, &mut output, padded)?;
            }
            at = at.saturating_add(padded);
        }
        // WebP metadata follows the image data. Writing the one synthesized
        // container here also makes the result independent of source chunk order.
        write_webp_chunk(&mut output, b"EXIF", &jpeg_exif_payload(facts.orientation))?;
        let end = output
            .stream_position()
            .map_err(|error| asset_io("measure stripped WebP", error))?;
        let riff_size = u32::try_from(end.saturating_sub(8))
            .map_err(|_| too_large("stripped WebP exceeds the RIFF size ceiling"))?;
        output
            .seek(SeekFrom::Start(4))
            .and_then(|_| output.write_all(&riff_size.to_le_bytes()))
            .map_err(|error| asset_io("finish WebP header", error))?;
        finish_replace(path, &temporary, output)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|()| facts)
}

fn inspect_webp(path: &Path) -> Result<ImageFacts, Refusal> {
    let mut input = File::open(path).map_err(|error| asset_io("open WebP", error))?;
    let total = input
        .metadata()
        .map_err(|error| asset_io("inspect WebP", error))?
        .len();
    let mut header = [0_u8; 12];
    input
        .read_exact(&mut header)
        .map_err(|error| asset_type(format!("truncated WebP header: {error}")))?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WEBP" {
        return Err(asset_type("WebP RIFF header is malformed"));
    }
    let declared = u64::from(u32::from_le_bytes(header[4..8].try_into().unwrap())) + 8;
    if declared != total {
        return Err(asset_type("WebP RIFF length does not match the file"));
    }
    let mut at = 12_u64;
    let mut dimensions = None;
    let mut orientation = 1;
    let mut metadata = 0_u64;
    while at < total {
        let (kind, length) = read_webp_chunk_header(&mut input)?;
        at = at.saturating_add(8);
        let padded = u64::from(length) + u64::from(length & 1);
        if at.saturating_add(padded) > total {
            return Err(asset_type("WebP chunk exceeds the RIFF body"));
        }
        if &kind == b"EXIF" || &kind == b"XMP " {
            metadata = metadata.saturating_add(u64::from(length));
            if metadata > MAX_METADATA_BYTES {
                return Err(too_large("WebP metadata exceeds the 4 MiB safety ceiling"));
            }
        }
        if &kind == b"VP8X" && length >= 10 {
            let mut payload = [0_u8; 10];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated WebP VP8X: {error}")))?;
            dimensions = Some((
                1 + read_u24_le(&payload[4..7]),
                1 + read_u24_le(&payload[7..10]),
            ));
            skip_exact(&mut input, padded - 10)?;
        } else if &kind == b"VP8L" && length >= 5 {
            let mut payload = [0_u8; 5];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated WebP VP8L: {error}")))?;
            if payload[0] != 0x2f {
                return Err(asset_type("WebP VP8L signature is malformed"));
            }
            dimensions.get_or_insert((
                1 + u32::from(payload[1]) + (u32::from(payload[2] & 0x3f) << 8),
                1 + u32::from(payload[2] >> 6)
                    + (u32::from(payload[3]) << 2)
                    + (u32::from(payload[4] & 0x0f) << 10),
            ));
            skip_exact(&mut input, padded - 5)?;
        } else if &kind == b"VP8 " && length >= 10 {
            let mut payload = [0_u8; 10];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated WebP VP8: {error}")))?;
            if &payload[3..6] != b"\x9d\x01\x2a" {
                return Err(asset_type("WebP VP8 signature is malformed"));
            }
            dimensions.get_or_insert((
                u32::from(u16::from_le_bytes([payload[6], payload[7]]) & 0x3fff),
                u32::from(u16::from_le_bytes([payload[8], payload[9]]) & 0x3fff),
            ));
            skip_exact(&mut input, padded - 10)?;
        } else if &kind == b"EXIF" {
            let mut payload = vec![0_u8; length as usize];
            input
                .read_exact(&mut payload)
                .map_err(|error| asset_type(format!("truncated WebP EXIF: {error}")))?;
            if let Some(value) = parse_orientation(&payload)? {
                orientation = value;
            }
            skip_exact(&mut input, padded - u64::from(length))?;
        } else {
            skip_exact(&mut input, padded)?;
        }
        at = at.saturating_add(padded);
    }
    let (sensor_width, sensor_height) =
        dimensions.ok_or_else(|| asset_type("WebP has no image dimensions"))?;
    let (width, height) = display_dimensions(sensor_width, sensor_height, orientation);
    positive_dimensions(width, height)?;
    Ok(ImageFacts {
        format: ImageFormat::Webp,
        width,
        height,
        orientation,
        sensor_width,
        sensor_height,
    })
}

fn webp_chunk_allowed(kind: &[u8; 4]) -> bool {
    matches!(
        kind,
        b"VP8 " | b"VP8L" | b"VP8X" | b"ALPH" | b"ANIM" | b"ANMF" | b"ICCP"
    )
}

fn parse_orientation(payload: &[u8]) -> Result<Option<u8>, Refusal> {
    let tiff = payload.strip_prefix(b"Exif\0\0").unwrap_or(payload);
    if tiff.len() < 8 {
        return Ok(None);
    }
    let little = match &tiff[..2] {
        b"II" => true,
        b"MM" => false,
        _ => return Ok(None),
    };
    let u16_at = |at: usize| -> Option<u16> {
        let bytes: [u8; 2] = tiff.get(at..at + 2)?.try_into().ok()?;
        Some(if little {
            u16::from_le_bytes(bytes)
        } else {
            u16::from_be_bytes(bytes)
        })
    };
    let u32_at = |at: usize| -> Option<u32> {
        let bytes: [u8; 4] = tiff.get(at..at + 4)?.try_into().ok()?;
        Some(if little {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        })
    };
    if u16_at(2) != Some(42) {
        return Ok(None);
    }
    let ifd = usize::try_from(u32_at(4).unwrap_or(u32::MAX)).unwrap_or(usize::MAX);
    let count = usize::from(u16_at(ifd).unwrap_or(0));
    if count > 4096 {
        return Err(too_large("EXIF tag count exceeds the safety ceiling"));
    }
    for index in 0..count {
        let at = ifd
            .saturating_add(2)
            .saturating_add(index.saturating_mul(12));
        if at.saturating_add(12) > tiff.len() {
            return Err(asset_type("EXIF directory is truncated"));
        }
        if u16_at(at) == Some(0x0112) && u16_at(at + 2) == Some(3) && u32_at(at + 4) == Some(1) {
            let orientation = u16_at(at + 8).unwrap_or(0) as u8;
            return (1..=8)
                .contains(&orientation)
                .then_some(Some(orientation))
                .ok_or_else(|| asset_type("EXIF orientation must be from 1 through 8"));
        }
    }
    Ok(None)
}

fn minimal_tiff(orientation: u8) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(26);
    bytes.extend_from_slice(b"II");
    bytes.extend_from_slice(&42_u16.to_le_bytes());
    bytes.extend_from_slice(&8_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&0x0112_u16.to_le_bytes());
    bytes.extend_from_slice(&3_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    bytes.extend_from_slice(&(u16::from(orientation)).to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes
}

fn jpeg_exif_payload(orientation: u8) -> Vec<u8> {
    let mut payload = b"Exif\0\0".to_vec();
    payload.extend_from_slice(&minimal_tiff(orientation));
    payload
}

fn write_jpeg_exif(output: &mut File, orientation: u8) -> Result<(), Refusal> {
    let payload = jpeg_exif_payload(orientation);
    let length = u16::try_from(payload.len() + 2).expect("minimal EXIF fits JPEG");
    output
        .write_all(&[0xff, 0xe1])
        .and_then(|()| output.write_all(&length.to_be_bytes()))
        .and_then(|()| output.write_all(&payload))
        .map_err(|error| asset_io("write minimal JPEG EXIF", error))
}

fn write_png_chunk(output: &mut File, kind: &[u8; 4], payload: &[u8]) -> Result<(), Refusal> {
    let length = u32::try_from(payload.len()).expect("minimal EXIF fits PNG");
    let mut crc_input = Vec::with_capacity(kind.len() + payload.len());
    crc_input.extend_from_slice(kind);
    crc_input.extend_from_slice(payload);
    output
        .write_all(&length.to_be_bytes())
        .and_then(|()| output.write_all(kind))
        .and_then(|()| output.write_all(payload))
        .and_then(|()| output.write_all(&crc32(&crc_input).to_be_bytes()))
        .map_err(|error| asset_io("write minimal PNG EXIF", error))
}

fn write_webp_chunk(output: &mut File, kind: &[u8; 4], payload: &[u8]) -> Result<(), Refusal> {
    let length = u32::try_from(payload.len())
        .map_err(|_| too_large("WebP metadata chunk exceeds the format ceiling"))?;
    output
        .write_all(kind)
        .and_then(|()| output.write_all(&length.to_le_bytes()))
        .and_then(|()| output.write_all(payload))
        .and_then(|()| {
            if length & 1 == 1 {
                output.write_all(&[0])
            } else {
                Ok(())
            }
        })
        .map_err(|error| asset_io("write WebP chunk", error))
}

fn read_jpeg_marker(input: &mut File) -> Result<u8, Refusal> {
    let mut byte = [0_u8; 1];
    loop {
        input
            .read_exact(&mut byte)
            .map_err(|error| asset_type(format!("truncated JPEG marker: {error}")))?;
        if byte[0] == 0xff {
            break;
        }
    }
    loop {
        input
            .read_exact(&mut byte)
            .map_err(|error| asset_type(format!("truncated JPEG marker: {error}")))?;
        if byte[0] != 0xff {
            return Ok(byte[0]);
        }
    }
}

fn skip_jpeg_scan(input: &mut File) -> Result<u8, Refusal> {
    let mut byte = [0_u8; 1];
    loop {
        input
            .read_exact(&mut byte)
            .map_err(|error| asset_type(format!("truncated JPEG scan: {error}")))?;
        if byte[0] != 0xff {
            continue;
        }
        loop {
            input
                .read_exact(&mut byte)
                .map_err(|error| asset_type(format!("truncated JPEG scan marker: {error}")))?;
            match byte[0] {
                0x00 | 0xd0..=0xd7 => break,
                0xff => continue,
                marker => return Ok(marker),
            }
        }
    }
}

fn copy_jpeg_scan(input: &mut File, output: &mut File) -> Result<u8, Refusal> {
    let mut byte = [0_u8; 1];
    loop {
        input
            .read_exact(&mut byte)
            .map_err(|error| asset_type(format!("truncated JPEG scan: {error}")))?;
        output
            .write_all(&byte)
            .map_err(|error| asset_io("write JPEG scan", error))?;
        if byte[0] != 0xff {
            continue;
        }
        loop {
            input
                .read_exact(&mut byte)
                .map_err(|error| asset_type(format!("truncated JPEG scan marker: {error}")))?;
            match byte[0] {
                0x00 | 0xd0..=0xd7 => {
                    output
                        .write_all(&byte)
                        .map_err(|error| asset_io("write JPEG scan", error))?;
                    break;
                }
                0xff => continue,
                marker => return Ok(marker),
            }
        }
    }
}

fn read_png_chunk_header(input: &mut File) -> Result<(u32, [u8; 4]), Refusal> {
    let mut header = [0_u8; 8];
    input
        .read_exact(&mut header)
        .map_err(|error| asset_type(format!("truncated PNG chunk header: {error}")))?;
    Ok((
        u32::from_be_bytes(header[..4].try_into().unwrap()),
        header[4..].try_into().unwrap(),
    ))
}

fn read_webp_chunk_header(input: &mut File) -> Result<([u8; 4], u32), Refusal> {
    let mut header = [0_u8; 8];
    input
        .read_exact(&mut header)
        .map_err(|error| asset_type(format!("truncated WebP chunk header: {error}")))?;
    Ok((
        header[..4].try_into().unwrap(),
        u32::from_le_bytes(header[4..].try_into().unwrap()),
    ))
}

fn first_webp_chunk_is_vp8x(input: &mut File) -> Result<bool, Refusal> {
    input
        .seek(SeekFrom::Start(12))
        .map_err(|error| asset_io("seek WebP", error))?;
    let mut kind = [0_u8; 4];
    input
        .read_exact(&mut kind)
        .map_err(|error| asset_type(format!("WebP has no image chunk: {error}")))?;
    Ok(&kind == b"VP8X")
}

fn read_u16_be(input: &mut File) -> Result<u16, Refusal> {
    let mut bytes = [0_u8; 2];
    input
        .read_exact(&mut bytes)
        .map_err(|error| asset_type(format!("truncated JPEG segment length: {error}")))?;
    Ok(u16::from_be_bytes(bytes))
}

fn is_sof(marker: u8) -> bool {
    matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc)
}

fn heic_brand(bytes: &[u8]) -> bool {
    bytes.chunks_exact(4).any(|brand| {
        matches!(
            brand,
            b"heic" | b"heix" | b"heim" | b"heis" | b"hevc" | b"hevx"
        )
    })
}

fn display_dimensions(width: u32, height: u32, orientation: u8) -> (u32, u32) {
    if (5..=8).contains(&orientation) {
        (height, width)
    } else {
        (width, height)
    }
}

fn positive_dimensions(width: u32, height: u32) -> Result<(), Refusal> {
    if width == 0 || height == 0 {
        Err(asset_type("image dimensions must be positive"))
    } else {
        Ok(())
    }
}

fn temporary_output(path: &Path) -> Result<(PathBuf, File), Refusal> {
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    for _ in 0..100 {
        let temporary = directory.join(format!(
            ".asset-strip-{}-{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new()
            .write(true)
            .read(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => return Ok((temporary, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(asset_io("create stripped image temporary", error)),
        }
    }
    Err(asset_io(
        "allocate stripped image temporary",
        io::Error::new(io::ErrorKind::AlreadyExists, "name attempts exhausted"),
    ))
}

fn finish_replace(path: &Path, temporary: &Path, mut output: File) -> Result<(), Refusal> {
    output
        .flush()
        .and_then(|()| output.sync_all())
        .map_err(|error| asset_io("sync stripped image", error))?;
    drop(output);
    fs::rename(temporary, path).map_err(|error| asset_io("publish stripped image", error))?;
    if let Some(directory) = path.parent() {
        File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(|error| asset_io("sync stripped image directory", error))?;
    }
    Ok(())
}

fn copy_exact(input: &mut File, output: &mut File, bytes: u64) -> Result<(), Refusal> {
    let copied = io::copy(&mut input.take(bytes), output)
        .map_err(|error| asset_io("copy image chunk", error))?;
    if copied != bytes {
        return Err(asset_type("image chunk is truncated"));
    }
    Ok(())
}

fn skip_exact(input: &mut File, bytes: u64) -> Result<(), Refusal> {
    let copied = io::copy(&mut input.take(bytes), &mut io::sink())
        .map_err(|error| asset_io("skip image chunk", error))?;
    if copied != bytes {
        return Err(asset_type("image chunk is truncated"));
    }
    Ok(())
}

fn read_u24_le(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

fn write_u24_le(bytes: &mut [u8], value: u32) {
    bytes[0] = value as u8;
    bytes[1] = (value >> 8) as u8;
    bytes[2] = (value >> 16) as u8;
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & (0_u32.wrapping_sub(crc & 1)));
        }
    }
    !crc
}

fn asset_type(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TYPE",
        "input",
        message,
        "upload a supported JPEG, PNG, WebP, MP4, or QuickTime MOV",
        "assets/admission",
    )
}

fn too_large(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TOO_LARGE",
        "input",
        message,
        "upload an asset within the generated byte and safety bounds",
        "assets/admission",
    )
}

fn asset_io(action: &str, error: io::Error) -> Refusal {
    Refusal::new(
        "E_OWNER_ASSET_IO",
        "owner",
        format!("could not {action}: {error}"),
        "discard this staging file and retry the upload",
        "assets/storage",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "snapback2-image-walk-{label}-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn private_tiff(orientation: u8) -> Vec<u8> {
        let mut tiff = b"II".to_vec();
        tiff.extend_from_slice(&42_u16.to_le_bytes());
        tiff.extend_from_slice(&8_u32.to_le_bytes());
        tiff.extend_from_slice(&2_u16.to_le_bytes());
        tiff.extend_from_slice(&0x8825_u16.to_le_bytes());
        tiff.extend_from_slice(&4_u16.to_le_bytes());
        tiff.extend_from_slice(&1_u32.to_le_bytes());
        tiff.extend_from_slice(&38_u32.to_le_bytes());
        tiff.extend_from_slice(&0x0112_u16.to_le_bytes());
        tiff.extend_from_slice(&3_u16.to_le_bytes());
        tiff.extend_from_slice(&1_u32.to_le_bytes());
        tiff.extend_from_slice(&u16::from(orientation).to_le_bytes());
        tiff.extend_from_slice(&0_u16.to_le_bytes());
        tiff.extend_from_slice(&0_u32.to_le_bytes());
        tiff.extend_from_slice(&0_u16.to_le_bytes());
        tiff
    }

    fn jpeg_segment(bytes: &mut Vec<u8>, marker: u8, payload: &[u8]) {
        bytes.extend_from_slice(&[0xff, marker]);
        bytes.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
        bytes.extend_from_slice(payload);
    }

    fn jpeg_markers(bytes: &[u8]) -> Vec<u8> {
        let mut markers = vec![0xd8];
        let mut at = 2;
        let mut in_scan = false;
        while at + 1 < bytes.len() {
            if !in_scan {
                assert_eq!(bytes[at], 0xff);
                while bytes[at] == 0xff {
                    at += 1;
                }
            } else {
                while at < bytes.len() && bytes[at] != 0xff {
                    at += 1;
                }
                at += 1;
                while at < bytes.len() && bytes[at] == 0xff {
                    at += 1;
                }
                if at >= bytes.len() {
                    break;
                }
                if bytes[at] == 0 || (0xd0..=0xd7).contains(&bytes[at]) {
                    at += 1;
                    continue;
                }
            }
            let marker = bytes[at];
            at += 1;
            markers.push(marker);
            if marker == 0xd9 {
                break;
            }
            if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
                continue;
            }
            let length = usize::from(u16::from_be_bytes(bytes[at..at + 2].try_into().unwrap()));
            at += length;
            in_scan = marker == 0xda;
        }
        markers
    }

    #[test]
    fn progressive_jpeg_strips_metadata_between_scans_and_uses_allowlist() {
        let path = path("progressive.jpg");
        let mut bytes = vec![0xff, 0xd8];
        jpeg_segment(&mut bytes, 0xe0, b"JFIF\0kept");
        jpeg_segment(&mut bytes, 0xe2, b"ICC_PROFILE\0kept");
        jpeg_segment(&mut bytes, 0xc2, &[8, 0, 2, 0, 4]);
        jpeg_segment(&mut bytes, 0xc4, &[0]);
        jpeg_segment(&mut bytes, 0xda, &[1, 1, 0, 0, 63, 0]);
        bytes.extend_from_slice(&[1, 2, 0xff, 0, 3, 0xff, 0xd0, 4]);
        let mut exif = b"Exif\0\0".to_vec();
        exif.extend_from_slice(&private_tiff(6));
        jpeg_segment(&mut bytes, 0xe1, &exif);
        jpeg_segment(&mut bytes, 0xfe, b"private comment");
        jpeg_segment(&mut bytes, 0xe3, b"private app3");
        jpeg_segment(&mut bytes, 0xda, &[1, 1, 0, 1, 63, 0]);
        bytes.extend_from_slice(&[5, 6, 0xff, 0xd9]);
        fs::write(&path, bytes).unwrap();

        let facts = strip(&path).unwrap();
        assert_eq!((facts.width, facts.height, facts.orientation), (2, 4, 6));
        let output = fs::read(&path).unwrap();
        let markers = jpeg_markers(&output);
        assert_eq!(markers.iter().filter(|marker| **marker == 0xe1).count(), 1);
        assert!(markers.iter().all(|marker| matches!(
            marker,
            0xd8 | 0xd9 | 0xd0..=0xd7 | 0xc0..=0xc3 | 0xc5..=0xc7
                | 0xc9..=0xcb | 0xcd..=0xcf | 0xc4 | 0xdb | 0xdd | 0xda | 0xe0 | 0xe1 | 0xe2
        )));
        assert!(!output.windows(2).any(|window| window == [0x25, 0x88]));
        assert!(
            !output
                .windows(15)
                .any(|window| window == b"private comment")
        );
        assert!(!output.windows(12).any(|window| window == b"private app3"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn ycck_jpeg_keeps_only_fixed_adobe_app14_transform() {
        let path = path("ycck.jpg");
        let adobe_ycck = b"Adobe\x00\x64\x00\x00\x00\x00\x02";
        let mut bytes = vec![0xff, 0xd8];
        jpeg_segment(&mut bytes, 0xee, b"Adobf\x00\x64\x00\x00\x00\x00\x02");
        jpeg_segment(&mut bytes, 0xee, b"Adobe\x00\x64\x00\x00\x00\x00\x02x");
        jpeg_segment(&mut bytes, 0xee, adobe_ycck);
        // Four frame components plus APP14 transform=2 identify YCCK.
        jpeg_segment(
            &mut bytes,
            0xc0,
            &[
                8, 0, 2, 0, 4, 4, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 4, 0x11, 0,
            ],
        );
        bytes.extend_from_slice(&[0xff, 0xd9]);
        fs::write(&path, bytes).unwrap();

        let facts = strip(&path).unwrap();
        assert_eq!((facts.width, facts.height), (4, 2));
        let output = fs::read(&path).unwrap();
        assert_eq!(
            jpeg_markers(&output)
                .iter()
                .filter(|marker| **marker == 0xee)
                .count(),
            1
        );
        assert!(
            output
                .windows(adobe_ycck.len())
                .any(|window| window == adobe_ycck)
        );
        fs::remove_file(path).unwrap();
    }

    fn png_chunk(bytes: &mut Vec<u8>, kind: &[u8; 4], payload: &[u8]) {
        bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(payload);
        let mut crc = kind.to_vec();
        crc.extend_from_slice(payload);
        bytes.extend_from_slice(&crc32(&crc).to_be_bytes());
    }

    #[test]
    fn png_drops_text_and_gps_exif_and_keeps_only_allowlisted_chunks() {
        let path = path("private.png");
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&4_u32.to_be_bytes());
        ihdr.extend_from_slice(&2_u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        png_chunk(&mut bytes, b"IHDR", &ihdr);
        png_chunk(&mut bytes, b"tEXt", b"gps=private");
        png_chunk(&mut bytes, b"zTXt", b"private-zlib");
        png_chunk(&mut bytes, b"iTXt", b"private-utf8");
        png_chunk(&mut bytes, b"eXIf", &private_tiff(8));
        png_chunk(&mut bytes, b"vpAg", b"unknown-private");
        png_chunk(&mut bytes, b"IDAT", &[0]);
        png_chunk(&mut bytes, b"IEND", &[]);
        fs::write(&path, bytes).unwrap();

        let facts = strip(&path).unwrap();
        assert_eq!((facts.width, facts.height, facts.orientation), (2, 4, 8));
        let output = fs::read(&path).unwrap();
        let mut at = 8;
        let mut exif = 0;
        while at < output.len() {
            let length = u32::from_be_bytes(output[at..at + 4].try_into().unwrap()) as usize;
            let kind: &[u8; 4] = output[at + 4..at + 8].try_into().unwrap();
            exif += usize::from(kind == b"eXIf");
            assert!(kind == b"eXIf" || png_chunk_allowed(kind));
            at += 12 + length;
        }
        assert_eq!(exif, 1);
        assert!(!output.windows(2).any(|window| window == [0x25, 0x88]));
        fs::remove_file(path).unwrap();
    }

    fn webp_chunk(bytes: &mut Vec<u8>, kind: &[u8; 4], payload: &[u8]) {
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        bytes.extend_from_slice(payload);
        if payload.len() & 1 == 1 {
            bytes.push(0);
        }
    }

    #[test]
    fn webp_drops_exif_xmp_and_unknown_chunks_and_keeps_sensor_canvas() {
        let path = path("private.webp");
        let mut body = Vec::new();
        let mut vp8x = [0_u8; 10];
        vp8x[0] = WEBP_EXIF_FLAG | WEBP_XMP_FLAG;
        write_u24_le(&mut vp8x[4..7], 3);
        write_u24_le(&mut vp8x[7..10], 1);
        webp_chunk(&mut body, b"VP8X", &vp8x);
        let mut exif = b"Exif\0\0".to_vec();
        exif.extend_from_slice(&private_tiff(6));
        webp_chunk(&mut body, b"EXIF", &exif);
        webp_chunk(&mut body, b"XMP ", b"private xmp");
        webp_chunk(&mut body, b"META", b"private unknown");
        webp_chunk(&mut body, b"VP8L", &[0x2f, 3, 64, 0, 0]);
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&(body.len() as u32 + 4).to_le_bytes());
        bytes.extend_from_slice(b"WEBP");
        bytes.extend_from_slice(&body);
        fs::write(&path, bytes).unwrap();

        let facts = strip(&path).unwrap();
        assert_eq!((facts.sensor_width, facts.sensor_height), (4, 2));
        assert_eq!((facts.width, facts.height, facts.orientation), (2, 4, 6));
        let output = fs::read(&path).unwrap();
        let mut at = 12;
        let mut exif_count = 0;
        while at < output.len() {
            let kind: &[u8; 4] = output[at..at + 4].try_into().unwrap();
            let length = u32::from_le_bytes(output[at + 4..at + 8].try_into().unwrap()) as usize;
            exif_count += usize::from(kind == b"EXIF");
            assert!(kind == b"EXIF" || webp_chunk_allowed(kind));
            at += 8 + length + (length & 1);
        }
        assert_eq!(exif_count, 1);
        assert!(!output.windows(2).any(|window| window == [0x25, 0x88]));
        fs::remove_file(path).unwrap();
    }
}
