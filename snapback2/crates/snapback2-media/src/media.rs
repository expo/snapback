//! JSON-line protocol for Snapback 2's store-less media subprocess.
//!
//! `probe` reports display dimensions. For JPEG, PNG, and WebP it also returns
//! the retained EXIF orientation; for HEIC, libheif item transforms and an
//! eligible EXIF transform are baked by `heic`, so the reported orientation is
//! `1`. `render` and `heic` write beside the destination under the fixed
//! `.snapback2-media-*.tmp` prefix before an atomic rename. The parent owns a
//! sweep of that prefix after every child outcome because SIGKILL and
//! `panic=abort` cannot run this process's `Drop` cleanup.

#![cfg_attr(not(feature = "images"), allow(dead_code))]

use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

// @ref LLP 1006#14a-codecs-live-in-a-separate-executable-the-type-does-not — all pixel-producing work stays in this store-less helper.
const E_ASSET_TYPE: &str = "E_ASSET_TYPE";
const E_ASSET_TOO_LARGE: &str = "E_ASSET_TOO_LARGE";

// @ref LLP 1006#4-admission — hostile image dimensions and expansion are bounded before pixel allocation.
const MAX_PIXELS: u64 = 50_000_000;
const MAX_EDGE: u32 = 16_384;
const MAX_DECOMPRESSION_RATIO: u64 = 500;
const RATIO_FLOOR_BYTES: u64 = 16 * 1024 * 1024;
const MAX_HEADER_BYTES: u64 = 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DETAIL_BYTES: usize = 1024;
const CEILINGS: Ceilings = Ceilings {
    max_pixels: MAX_PIXELS,
    max_edge: MAX_EDGE,
    max_decompression_ratio: MAX_DECOMPRESSION_RATIO,
    ratio_floor_bytes: RATIO_FLOOR_BYTES,
    max_header_bytes: MAX_HEADER_BYTES,
    max_output_bytes: MAX_OUTPUT_BYTES,
};

const RENDER_JPEG_QUALITY: u8 = 85;
#[cfg(feature = "heic")]
const HEIC_JPEG_QUALITY: u8 = 92;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
struct Ceilings {
    max_pixels: u64,
    max_edge: u32,
    max_decompression_ratio: u64,
    ratio_floor_bytes: u64,
    max_header_bytes: u64,
    max_output_bytes: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct Refusal {
    code: &'static str,
    detail: String,
}

impl Refusal {
    fn asset_type(detail: impl Into<String>) -> Self {
        Self {
            code: E_ASSET_TYPE,
            detail: bounded_detail(detail.into()),
        }
    }

    fn too_large(detail: impl Into<String>) -> Self {
        Self {
            code: E_ASSET_TOO_LARGE,
            detail: bounded_detail(detail.into()),
        }
    }
}

fn bounded_detail(detail: String) -> String {
    let mut escaped = String::with_capacity(detail.len().min(MAX_DETAIL_BYTES));
    let mut clipped = false;
    for character in detail.chars() {
        let encoded = character.escape_default().to_string();
        if escaped.len().saturating_add(encoded.len()) > MAX_DETAIL_BYTES {
            clipped = true;
            break;
        }
        escaped.push_str(&encoded);
    }
    if clipped {
        escaped.push_str("...");
    }
    escaped
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum MediaFormat {
    Jpeg,
    Png,
    Webp,
    Heic,
}

#[derive(Debug, Serialize)]
struct ProbeResult {
    format: MediaFormat,
    width: u32,
    height: u32,
    orientation: u8,
}

#[derive(Debug, Serialize)]
struct RenderResult {
    width: u32,
    height: u32,
    format: MediaFormat,
}

#[derive(Debug, Serialize)]
struct Capabilities {
    images: bool,
    heic: bool,
}

#[derive(Clone, Copy, Debug)]
struct RasterHeader {
    format: MediaFormat,
    width: u32,
    height: u32,
}

pub(crate) fn run(args: &[String]) -> Result<serde_json::Value, Refusal> {
    let Some(command) = args.first().map(String::as_str) else {
        return Err(Refusal::asset_type(
            "usage: snapback2-media <capabilities|probe|render|heic> ...",
        ));
    };
    let value = match command {
        "capabilities" if args.len() == 1 => serde_json::to_value(capabilities()),
        "probe" if args.len() == 2 => serde_json::to_value(probe(Path::new(&args[1]))?),
        "render" => {
            let request = parse_render(args)?;
            serde_json::to_value(render(
                &request.source,
                &request.destination,
                request.width,
                request.orientation,
                CEILINGS,
            )?)
        }
        "heic" if args.len() == 3 => {
            serde_json::to_value(normalize_heic(Path::new(&args[1]), Path::new(&args[2]))?)
        }
        _ => {
            return Err(Refusal::asset_type(format!("invalid {command} arguments")));
        }
    };
    value.map_err(|error| Refusal::asset_type(format!("cannot encode result: {error}")))
}

fn capabilities() -> Capabilities {
    Capabilities {
        images: images_codec_available(),
        heic: heic_codec_available(),
    }
}

#[cfg(feature = "images")]
fn images_codec_available() -> bool {
    const PNG: &[u8] = include_bytes!("../testdata/capability.png");
    image::load_from_memory_with_format(PNG, image::ImageFormat::Png).is_ok()
}

#[cfg(not(feature = "images"))]
fn images_codec_available() -> bool {
    false
}

#[cfg(feature = "heic")]
fn heic_codec_available() -> bool {
    const HEIC: &[u8] = include_bytes!("../testdata/minimal.heic");
    decode_heic_bytes(HEIC, CEILINGS).is_ok()
}

#[cfg(not(feature = "heic"))]
fn heic_codec_available() -> bool {
    false
}

struct RenderRequest {
    source: PathBuf,
    destination: PathBuf,
    width: u32,
    orientation: Option<u8>,
}

fn parse_render(args: &[String]) -> Result<RenderRequest, Refusal> {
    if args.len() < 5 {
        return Err(Refusal::asset_type(
            "usage: snapback2-media render <src> <dst> --width N [--orientation K]",
        ));
    }
    let mut width = None;
    let mut orientation = None;
    let mut cursor = 3;
    while cursor < args.len() {
        let flag = args[cursor].as_str();
        let Some(value) = args.get(cursor + 1) else {
            return Err(Refusal::asset_type(format!("{flag} needs a value")));
        };
        match flag {
            "--width" if width.is_none() => {
                let parsed = value
                    .parse::<u32>()
                    .ok()
                    .filter(|value| *value > 0)
                    .ok_or_else(|| {
                        Refusal::asset_type("render width must be a positive integer")
                    })?;
                width = Some(parsed);
            }
            "--orientation" if orientation.is_none() => {
                let parsed = value
                    .parse::<u8>()
                    .ok()
                    .filter(|value| (1..=8).contains(value))
                    .ok_or_else(|| {
                        Refusal::asset_type("orientation must be an integer from 1 to 8")
                    })?;
                orientation = Some(parsed);
            }
            _ => {
                return Err(Refusal::asset_type(format!(
                    "unknown or repeated flag {flag}"
                )));
            }
        }
        cursor += 2;
    }
    Ok(RenderRequest {
        source: PathBuf::from(&args[1]),
        destination: PathBuf::from(&args[2]),
        width: width.ok_or_else(|| Refusal::asset_type("render requires --width"))?,
        orientation,
    })
}

fn probe(path: &Path) -> Result<ProbeResult, Refusal> {
    match detect_format(path, CEILINGS)? {
        MediaFormat::Jpeg | MediaFormat::Png | MediaFormat::Webp => {
            #[cfg(feature = "images")]
            {
                let header = inspect_raster(path, CEILINGS)?;
                let orientation = raster_orientation(path, header, CEILINGS)?;
                let (width, height) = display_dimensions(header.width, header.height, orientation);
                Ok(ProbeResult {
                    format: header.format,
                    width,
                    height,
                    orientation,
                })
            }
            #[cfg(not(feature = "images"))]
            {
                Err(Refusal::asset_type(
                    "image decoders not built; rebuild snapback2-media with --features images",
                ))
            }
        }
        MediaFormat::Heic => probe_heic(path, CEILINGS),
    }
}

#[cfg(feature = "images")]
fn render(
    source: &Path,
    destination: &Path,
    requested_width: u32,
    requested_orientation: Option<u8>,
    ceilings: Ceilings,
) -> Result<RenderResult, Refusal> {
    use image::GenericImageView;

    let header = inspect_raster(source, ceilings)?;
    let (mut decoded, embedded_orientation) = decode_raster(source, header, ceilings)?;
    let orientation = requested_orientation.unwrap_or(embedded_orientation);
    // @ref LLP 1006#8-sizes-ask-for-any-width — orientation is baked before a width is selected and images never upscale.
    decoded.apply_orientation(image_orientation(orientation));
    let has_alpha = decoded.color().has_alpha();
    let (source_width, source_height) = decoded.dimensions();
    let width = requested_width.min(source_width);
    let height = scaled_height(source_width, source_height, width);
    if width != source_width {
        decoded = decoded.resize_exact(width, height, image::imageops::FilterType::Lanczos3);
    }
    let output_format = if has_alpha {
        MediaFormat::Png
    } else {
        MediaFormat::Jpeg
    };
    write_image_atomic(
        destination,
        &decoded,
        output_format,
        RENDER_JPEG_QUALITY,
        ceilings.max_output_bytes,
    )?;
    Ok(RenderResult {
        width,
        height,
        format: output_format,
    })
}

#[cfg(not(feature = "images"))]
fn render(
    _source: &Path,
    _destination: &Path,
    _requested_width: u32,
    _requested_orientation: Option<u8>,
    _ceilings: Ceilings,
) -> Result<RenderResult, Refusal> {
    Err(Refusal::asset_type(
        "image decoders not built; rebuild snapback2-media with --features images",
    ))
}

fn normalize_heic(source: &Path, destination: &Path) -> Result<RenderResult, Refusal> {
    #[cfg(feature = "heic")]
    {
        let decoded = decode_heic(source, CEILINGS)?;
        let (width, height) = image::GenericImageView::dimensions(&decoded);
        write_image_atomic(
            destination,
            &decoded,
            MediaFormat::Jpeg,
            HEIC_JPEG_QUALITY,
            CEILINGS.max_output_bytes,
        )?;
        Ok(RenderResult {
            width,
            height,
            format: MediaFormat::Jpeg,
        })
    }
    #[cfg(not(feature = "heic"))]
    {
        let _ = (source, destination);
        Err(Refusal::asset_type(
            "HEIC decoder not built; rebuild snapback2-media with --features heic",
        ))
    }
}

#[cfg(feature = "images")]
fn image_orientation(value: u8) -> image::metadata::Orientation {
    image::metadata::Orientation::from_exif(value)
        .expect("orientation was validated or came from the decoder")
}

fn scaled_height(source_width: u32, source_height: u32, width: u32) -> u32 {
    let numerator = u64::from(source_height) * u64::from(width) + u64::from(source_width / 2);
    u32::try_from(numerator / u64::from(source_width))
        .unwrap_or(u32::MAX)
        .max(1)
}

fn display_dimensions(width: u32, height: u32, orientation: u8) -> (u32, u32) {
    if (5..=8).contains(&orientation) {
        (height, width)
    } else {
        (width, height)
    }
}

fn detect_format(path: &Path, ceilings: Ceilings) -> Result<MediaFormat, Refusal> {
    let mut file = open_input(path)?;
    let mut prefix = [0_u8; 32];
    let read = file
        .read(&mut prefix)
        .map_err(|error| io_refusal("read input header", path, error))?;
    let prefix = &prefix[..read];
    if prefix.starts_with(&[0xff, 0xd8]) {
        return Ok(MediaFormat::Jpeg);
    }
    if prefix.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(MediaFormat::Png);
    }
    if prefix.len() >= 12 && &prefix[..4] == b"RIFF" && &prefix[8..12] == b"WEBP" {
        return Ok(MediaFormat::Webp);
    }
    if heic_brand(path, &mut file, ceilings)? {
        return Ok(MediaFormat::Heic);
    }
    Err(Refusal::asset_type("input is not JPEG, PNG, WebP, or HEIC"))
}

fn heic_brand(path: &Path, file: &mut File, ceilings: Ceilings) -> Result<bool, Refusal> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| Refusal::asset_type(format!("cannot seek HEIC header: {error}")))?;
    let mut header = [0_u8; 8];
    if file.read_exact(&mut header).is_err() || &header[4..] != b"ftyp" {
        return Ok(false);
    }
    let box_bytes = u64::from(u32::from_be_bytes(
        header[..4].try_into().expect("four bytes"),
    ));
    if box_bytes < 16 {
        return Ok(false);
    }
    if box_bytes > ceilings.max_header_bytes {
        return Err(Refusal::too_large(format!(
            "HEIC file-type header exceeds the {} byte ceiling",
            ceilings.max_header_bytes
        )));
    }
    let payload_len = usize::try_from(box_bytes - 8)
        .map_err(|_| Refusal::too_large("HEIC file-type header is too large"))?;
    let mut payload = vec![0_u8; payload_len];
    file.read_exact(&mut payload).map_err(|error| {
        Refusal::asset_type(format!("malformed HEIC file-type header: {error}"))
    })?;
    let brands = payload[..4]
        .chunks_exact(4)
        .chain(payload.get(8..).unwrap_or_default().chunks_exact(4))
        .collect::<Vec<_>>();
    if brands
        .iter()
        .any(|brand| [b"avif".as_slice(), b"avis", b"av01"].contains(brand))
    {
        return Ok(false);
    }
    let declares_hevc = brands.iter().any(|brand| {
        [
            b"heic".as_slice(),
            b"heix",
            b"heim",
            b"heis",
            b"hevc",
            b"hevx",
        ]
        .contains(brand)
    });
    let generic_heif = brands
        .iter()
        .any(|brand| [b"mif1".as_slice(), b"msf1"].contains(brand));
    if !declares_hevc && !generic_heif {
        return Ok(false);
    }

    #[cfg(feature = "heic")]
    {
        heif_primary_item_is_hevc_file(path)
    }
    #[cfg(not(feature = "heic"))]
    {
        let _ = path;
        // A generic HEIF brand says nothing about the primary codec. Without
        // libheif, only an explicit HEVC brand can select the HEIC path.
        Ok(declares_hevc)
    }
}

fn inspect_raster(path: &Path, ceilings: Ceilings) -> Result<RasterHeader, Refusal> {
    let format = detect_format(path, ceilings)?;
    if format == MediaFormat::Heic {
        return Err(Refusal::asset_type(
            "render accepts JPEG, PNG, or WebP; use the heic command for HEIC",
        ));
    }
    let mut file = open_input(path)?;
    let file_bytes = file
        .metadata()
        .map_err(|error| io_refusal("inspect input", path, error))?
        .len();
    let (width, height) = match format {
        MediaFormat::Jpeg => jpeg_dimensions(&mut file, ceilings)?,
        MediaFormat::Png => png_dimensions(&mut file)?,
        MediaFormat::Webp => webp_dimensions(&mut file, ceilings)?,
        MediaFormat::Heic => unreachable!(),
    };
    check_dimensions(width, height, file_bytes, ceilings)?;
    if format == MediaFormat::Png {
        png_metadata_within_ceiling(&mut file, ceilings)?;
    }
    Ok(RasterHeader {
        format,
        width,
        height,
    })
}

fn check_dimensions(
    width: u32,
    height: u32,
    file_bytes: u64,
    ceilings: Ceilings,
) -> Result<(), Refusal> {
    if width == 0 || height == 0 {
        return Err(Refusal::asset_type("image dimensions must be positive"));
    }
    if width > ceilings.max_edge || height > ceilings.max_edge {
        return Err(Refusal::too_large(format!(
            "image dimensions {width}x{height} exceed the {} longest-edge ceiling",
            ceilings.max_edge
        )));
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > ceilings.max_pixels {
        return Err(Refusal::too_large(format!(
            "image pixel count {pixels} exceeds the {} pixel ceiling",
            ceilings.max_pixels
        )));
    }
    let decoded_bytes = pixels.saturating_mul(4);
    if decoded_bytes > ceilings.ratio_floor_bytes {
        let ratio = decoded_bytes / file_bytes.max(1);
        if ratio > ceilings.max_decompression_ratio {
            return Err(Refusal::too_large(format!(
                "image decompression ratio {ratio} exceeds the {}x ceiling",
                ceilings.max_decompression_ratio
            )));
        }
    }
    Ok(())
}

fn jpeg_dimensions(file: &mut File, ceilings: Ceilings) -> Result<(u32, u32), Refusal> {
    file.seek(SeekFrom::Start(2))
        .map_err(|error| Refusal::asset_type(format!("cannot seek JPEG header: {error}")))?;
    let mut scanned = 2_u64;
    loop {
        let marker = next_jpeg_marker(file, &mut scanned, ceilings)?;
        if marker == 0xda || marker == 0xd9 {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        let length = read_u16_be(file)?;
        charge_header_bytes(&mut scanned, 2, ceilings, "JPEG")?;
        if length < 2 {
            return Err(Refusal::asset_type("JPEG segment has an invalid length"));
        }
        let payload_bytes = u64::from(length - 2);
        charge_header_bytes(&mut scanned, payload_bytes, ceilings, "JPEG")?;
        if matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
            let mut dimensions = [0_u8; 5];
            file.read_exact(&mut dimensions).map_err(|error| {
                Refusal::asset_type(format!("truncated JPEG frame header: {error}"))
            })?;
            return Ok((
                u32::from(u16::from_be_bytes([dimensions[3], dimensions[4]])),
                u32::from(u16::from_be_bytes([dimensions[1], dimensions[2]])),
            ));
        }
        file.seek(SeekFrom::Current(i64::from(length) - 2))
            .map_err(|error| Refusal::asset_type(format!("cannot seek JPEG segment: {error}")))?;
    }
    Err(Refusal::asset_type("JPEG carries no frame dimensions"))
}

fn next_jpeg_marker(file: &mut File, scanned: &mut u64, ceilings: Ceilings) -> Result<u8, Refusal> {
    let mut byte = [0_u8; 1];
    loop {
        file.read_exact(&mut byte)
            .map_err(|error| Refusal::asset_type(format!("truncated JPEG header: {error}")))?;
        charge_header_bytes(scanned, 1, ceilings, "JPEG")?;
        if byte[0] == 0xff {
            break;
        }
    }
    loop {
        file.read_exact(&mut byte)
            .map_err(|error| Refusal::asset_type(format!("truncated JPEG marker: {error}")))?;
        charge_header_bytes(scanned, 1, ceilings, "JPEG")?;
        if byte[0] != 0xff {
            return Ok(byte[0]);
        }
    }
}

fn charge_header_bytes(
    scanned: &mut u64,
    consumed: u64,
    ceilings: Ceilings,
    format: &str,
) -> Result<(), Refusal> {
    *scanned = scanned.saturating_add(consumed);
    if *scanned > ceilings.max_header_bytes {
        return Err(Refusal::too_large(format!(
            "{format} header exceeds the {} byte ceiling",
            ceilings.max_header_bytes
        )));
    }
    Ok(())
}

fn png_dimensions(file: &mut File) -> Result<(u32, u32), Refusal> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| Refusal::asset_type(format!("cannot seek PNG header: {error}")))?;
    let mut header = [0_u8; 24];
    file.read_exact(&mut header)
        .map_err(|error| Refusal::asset_type(format!("truncated PNG header: {error}")))?;
    if !header.starts_with(b"\x89PNG\r\n\x1a\n") || &header[12..16] != b"IHDR" {
        return Err(Refusal::asset_type("PNG header is malformed"));
    }
    Ok((
        u32::from_be_bytes(header[16..20].try_into().expect("four bytes")),
        u32::from_be_bytes(header[20..24].try_into().expect("four bytes")),
    ))
}

fn png_metadata_within_ceiling(file: &mut File, ceilings: Ceilings) -> Result<(), Refusal> {
    file.seek(SeekFrom::Start(8))
        .map_err(|error| Refusal::asset_type(format!("cannot seek PNG chunks: {error}")))?;
    let mut scanned = 8_u64;
    loop {
        let mut header = [0_u8; 8];
        file.read_exact(&mut header)
            .map_err(|error| Refusal::asset_type(format!("truncated PNG chunk header: {error}")))?;
        charge_header_bytes(&mut scanned, 8, ceilings, "PNG metadata")?;
        let length = u64::from(u32::from_be_bytes(
            header[..4].try_into().expect("four bytes"),
        ));
        if &header[4..8] == b"IDAT" {
            return Ok(());
        }
        let chunk_bytes = length.saturating_add(4);
        charge_header_bytes(&mut scanned, chunk_bytes, ceilings, "PNG metadata")?;
        match &header[4..8] {
            b"IEND" => return Err(Refusal::asset_type("PNG carries no image data")),
            _ => file
                .seek(SeekFrom::Current(
                    i64::try_from(chunk_bytes).unwrap_or(i64::MAX),
                ))
                .map_err(|error| {
                    Refusal::asset_type(format!("cannot seek PNG metadata chunk: {error}"))
                })?,
        };
    }
}

fn webp_dimensions(file: &mut File, ceilings: Ceilings) -> Result<(u32, u32), Refusal> {
    file.seek(SeekFrom::Start(12))
        .map_err(|error| Refusal::asset_type(format!("cannot seek WebP header: {error}")))?;
    let mut scanned = 12_u64;
    loop {
        let mut chunk = [0_u8; 8];
        file.read_exact(&mut chunk).map_err(|error| {
            Refusal::asset_type(format!("WebP carries no image header: {error}"))
        })?;
        let length = u64::from(u32::from_le_bytes(
            chunk[4..8].try_into().expect("four bytes"),
        ));
        scanned = scanned.saturating_add(8);
        let dimensions = match &chunk[..4] {
            b"VP8X" if length >= 10 => {
                let mut payload = [0_u8; 10];
                file.read_exact(&mut payload).map_err(|error| {
                    Refusal::asset_type(format!("truncated WebP VP8X header: {error}"))
                })?;
                Some((
                    1 + read_u24_le(&payload[4..7]),
                    1 + read_u24_le(&payload[7..10]),
                ))
            }
            b"VP8L" if length >= 5 => {
                let mut payload = [0_u8; 5];
                file.read_exact(&mut payload).map_err(|error| {
                    Refusal::asset_type(format!("truncated WebP VP8L header: {error}"))
                })?;
                if payload[0] != 0x2f {
                    return Err(Refusal::asset_type("WebP VP8L signature is malformed"));
                }
                let width = 1 + u32::from(payload[1]) + (u32::from(payload[2] & 0x3f) << 8);
                let height = 1
                    + u32::from(payload[2] >> 6)
                    + (u32::from(payload[3]) << 2)
                    + (u32::from(payload[4] & 0x0f) << 10);
                Some((width, height))
            }
            b"VP8 " if length >= 10 => {
                let mut payload = [0_u8; 10];
                file.read_exact(&mut payload).map_err(|error| {
                    Refusal::asset_type(format!("truncated WebP VP8 header: {error}"))
                })?;
                if &payload[3..6] != b"\x9d\x01\x2a" {
                    return Err(Refusal::asset_type("WebP VP8 signature is malformed"));
                }
                Some((
                    u32::from(u16::from_le_bytes([payload[6], payload[7]]) & 0x3fff),
                    u32::from(u16::from_le_bytes([payload[8], payload[9]]) & 0x3fff),
                ))
            }
            _ => None,
        };
        if let Some(dimensions) = dimensions {
            return Ok(dimensions);
        }
        scanned = scanned.saturating_add(length + (length & 1));
        if scanned > ceilings.max_header_bytes {
            return Err(Refusal::too_large(format!(
                "WebP header exceeds the {} byte ceiling",
                ceilings.max_header_bytes
            )));
        }
        file.seek(SeekFrom::Current(
            i64::try_from(length + (length & 1)).unwrap_or(i64::MAX),
        ))
        .map_err(|error| Refusal::asset_type(format!("cannot seek WebP chunk: {error}")))?;
    }
}

fn read_u24_le(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

fn read_u16_be(file: &mut File) -> Result<u16, Refusal> {
    let mut bytes = [0_u8; 2];
    file.read_exact(&mut bytes)
        .map_err(|error| Refusal::asset_type(format!("truncated JPEG segment: {error}")))?;
    Ok(u16::from_be_bytes(bytes))
}

#[cfg(feature = "images")]
fn raster_orientation(
    path: &Path,
    header: RasterHeader,
    ceilings: Ceilings,
) -> Result<u8, Refusal> {
    let mut decoder = raster_decoder(path, header, ceilings)?;
    decoder
        .orientation()
        .map(|orientation| orientation.to_exif())
        .map_err(|error| Refusal::asset_type(format!("cannot read image orientation: {error}")))
}

#[cfg(feature = "images")]
fn decode_raster(
    path: &Path,
    header: RasterHeader,
    ceilings: Ceilings,
) -> Result<(image::DynamicImage, u8), Refusal> {
    let mut decoder = raster_decoder(path, header, ceilings)?;
    let orientation = decoder
        .orientation()
        .map_err(|error| Refusal::asset_type(format!("cannot read image orientation: {error}")))?
        .to_exif();
    let decoded = image::DynamicImage::from_decoder(decoder)
        .map_err(|error| Refusal::asset_type(format!("image decode failed: {error}")))?;
    Ok((decoded, orientation))
}

#[cfg(feature = "images")]
fn raster_decoder(
    path: &Path,
    header: RasterHeader,
    ceilings: Ceilings,
) -> Result<Box<dyn image::ImageDecoder>, Refusal> {
    use image::ImageDecoder;

    let format = match header.format {
        MediaFormat::Jpeg => image::ImageFormat::Jpeg,
        MediaFormat::Png => image::ImageFormat::Png,
        MediaFormat::Webp => image::ImageFormat::WebP,
        MediaFormat::Heic => unreachable!(),
    };
    let reader =
        image::ImageReader::with_format(std::io::BufReader::new(open_input(path)?), format);
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| Refusal::asset_type(format!("cannot open image decoder: {error}")))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(ceilings.max_edge);
    limits.max_image_height = Some(ceilings.max_edge);
    limits.max_alloc = Some(ceilings.max_pixels.saturating_mul(8));
    decoder.set_limits(limits).map_err(|error| {
        Refusal::too_large(format!("image decoder limits refused input: {error}"))
    })?;
    if decoder.dimensions() != (header.width, header.height) {
        return Err(Refusal::asset_type(
            "image decoder dimensions disagree with the bounded header probe",
        ));
    }
    Ok(Box::new(decoder))
}

#[cfg(feature = "images")]
fn write_image_atomic(
    destination: &Path,
    image: &image::DynamicImage,
    format: MediaFormat,
    jpeg_quality: u8,
    max_output_bytes: u64,
) -> Result<(), Refusal> {
    use image::ImageEncoder;

    let mut temporary = TemporaryOutput::create(destination)?;
    let mut writer = BoundedWriter::new(&mut temporary.file, max_output_bytes);
    let encoded = match format {
        MediaFormat::Png => {
            let pixels = image.to_rgba8();
            image::codecs::png::PngEncoder::new(&mut writer).write_image(
                pixels.as_raw(),
                pixels.width(),
                pixels.height(),
                image::ExtendedColorType::Rgba8,
            )
        }
        MediaFormat::Jpeg => {
            let pixels = image.to_rgb8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, jpeg_quality)
                .write_image(
                    pixels.as_raw(),
                    pixels.width(),
                    pixels.height(),
                    image::ExtendedColorType::Rgb8,
                )
        }
        MediaFormat::Webp | MediaFormat::Heic => unreachable!(),
    };
    if writer.exceeded {
        return Err(Refusal::too_large(format!(
            "encoded output exceeds the {max_output_bytes} byte ceiling"
        )));
    }
    encoded.map_err(|error| Refusal::asset_type(format!("image encode failed: {error}")))?;
    writer
        .flush()
        .map_err(|error| Refusal::asset_type(format!("cannot flush image output: {error}")))?;
    drop(writer);
    temporary
        .file
        .sync_all()
        .map_err(|error| Refusal::asset_type(format!("cannot sync image output: {error}")))?;
    temporary.commit(destination)
}

struct BoundedWriter<W> {
    inner: W,
    written: u64,
    limit: u64,
    exceeded: bool,
}

impl<W> BoundedWriter<W> {
    fn new(inner: W, limit: u64) -> Self {
        Self {
            inner,
            written: 0,
            limit,
            exceeded: false,
        }
    }
}

impl<W: Write> Write for BoundedWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if (bytes.len() as u64) > self.limit.saturating_sub(self.written) {
            self.exceeded = true;
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "snapback2 media output ceiling exceeded",
            ));
        }
        let written = self.inner.write(bytes)?;
        self.written = self.written.saturating_add(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

struct TemporaryOutput {
    path: PathBuf,
    file: File,
    committed: bool,
}

impl TemporaryOutput {
    fn create(destination: &Path) -> Result<Self, Refusal> {
        let directory = destination.parent().unwrap_or_else(|| Path::new("."));
        for _ in 0..100 {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = directory.join(format!(
                ".snapback2-media-{}-{sequence}.tmp",
                std::process::id()
            ));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => {
                    return Ok(Self {
                        path,
                        file,
                        committed: false,
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(Refusal::asset_type(format!(
                        "cannot create temporary output beside {}: {error}",
                        destination.display()
                    )));
                }
            }
        }
        Err(Refusal::asset_type(
            "cannot allocate a unique temporary output name",
        ))
    }

    fn commit(mut self, destination: &Path) -> Result<(), Refusal> {
        fs::rename(&self.path, destination).map_err(|error| {
            Refusal::asset_type(format!(
                "cannot atomically rename output to {}: {error}",
                destination.display()
            ))
        })?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for TemporaryOutput {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn open_input(path: &Path) -> Result<File, Refusal> {
    File::open(path).map_err(|error| io_refusal("open input", path, error))
}

fn io_refusal(action: &str, path: &Path, error: io::Error) -> Refusal {
    Refusal::asset_type(format!("cannot {action} {}: {error}", path.display()))
}

#[cfg(feature = "heic")]
fn probe_heic(path: &Path, ceilings: Ceilings) -> Result<ProbeResult, Refusal> {
    let facts = heic_facts(path, ceilings)?;
    Ok(ProbeResult {
        format: MediaFormat::Heic,
        width: facts.width,
        height: facts.height,
        orientation: 1,
    })
}

#[cfg(not(feature = "heic"))]
fn probe_heic(_path: &Path, _ceilings: Ceilings) -> Result<ProbeResult, Refusal> {
    Err(Refusal::asset_type(
        "HEIC decoder not built; rebuild snapback2-media with --features heic",
    ))
}

#[cfg(feature = "heic")]
struct HeicFacts {
    width: u32,
    height: u32,
    exif_orientation: u8,
    has_item_transform: bool,
}

#[cfg(feature = "heic")]
fn heic_facts(path: &Path, ceilings: Ceilings) -> Result<HeicFacts, Refusal> {
    use libheif_rs::HeifContext;

    let file_bytes = fs::metadata(path)
        .map_err(|error| io_refusal("inspect input", path, error))?
        .len();
    let context = HeifContext::read_from_file(&path.to_string_lossy())
        .map_err(|error| Refusal::asset_type(format!("cannot read HEIC container: {error}")))?;
    let has_item_transform = heic_has_item_transform_file(path)?;
    heic_facts_from_context(&context, file_bytes, has_item_transform, ceilings)
}

#[cfg(feature = "heic")]
fn heic_facts_from_context(
    context: &libheif_rs::HeifContext<'_>,
    file_bytes: u64,
    has_item_transform: bool,
    ceilings: Ceilings,
) -> Result<HeicFacts, Refusal> {
    use libheif_rs::ItemId;

    let handle = context
        .primary_image_handle()
        .map_err(|error| Refusal::asset_type(format!("HEIC has no primary image: {error}")))?;
    let sensor_width = u32::try_from(handle.ispe_width())
        .map_err(|_| Refusal::asset_type("HEIC sensor width is invalid"))?;
    let sensor_height = u32::try_from(handle.ispe_height())
        .map_err(|_| Refusal::asset_type("HEIC sensor height is invalid"))?;
    // The ispe check is the pre-decode allocation gate. handle dimensions
    // already include libheif's irot/imir/clap transforms.
    check_dimensions(sensor_width, sensor_height, file_bytes, ceilings)?;
    let transformed_width = handle.width();
    let transformed_height = handle.height();

    let count = handle.number_of_metadata_blocks(b"Exif").max(0) as usize;
    if (count as u64).saturating_mul(std::mem::size_of::<ItemId>() as u64)
        > ceilings.max_header_bytes
    {
        return Err(Refusal::too_large(format!(
            "HEIC metadata index exceeds the {} byte ceiling",
            ceilings.max_header_bytes
        )));
    }
    let mut ids = vec![0 as ItemId; count];
    let exif_orientation = if handle.metadata_block_ids(&mut ids, b"Exif") == 0 {
        1
    } else {
        if handle.metadata_size(ids[0]) as u64 > ceilings.max_header_bytes {
            return Err(Refusal::too_large(format!(
                "HEIC EXIF metadata exceeds the {} byte ceiling",
                ceilings.max_header_bytes
            )));
        }
        handle
            .metadata(ids[0])
            .ok()
            .and_then(|bytes| heic_exif_orientation(&bytes))
            .unwrap_or(1)
    };
    let applied_exif = if has_item_transform {
        1
    } else {
        exif_orientation
    };
    let (width, height) = display_dimensions(transformed_width, transformed_height, applied_exif);
    check_dimensions(width, height, file_bytes, ceilings)?;
    Ok(HeicFacts {
        width,
        height,
        exif_orientation,
        has_item_transform,
    })
}

#[cfg(feature = "heic")]
fn heic_exif_orientation(bytes: &[u8]) -> Option<u8> {
    use image::metadata::Orientation;

    let offset = u32::from_be_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    let tiff = bytes.get(4_usize.checked_add(offset)?..)?;
    Orientation::from_exif_chunk(tiff).map(Orientation::to_exif)
}

#[cfg(feature = "heic")]
fn heic_has_item_transform_file(path: &Path) -> Result<bool, Refusal> {
    use std::ffi::CString;

    let path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| Refusal::asset_type("HEIC path contains a NUL byte"))?;
    raw_heic_has_item_transform(|context| unsafe {
        libheif_sys::heif_context_read_from_file(context, path.as_ptr(), std::ptr::null())
    })
}

#[cfg(feature = "heic")]
fn heic_has_item_transform_bytes(bytes: &[u8]) -> Result<bool, Refusal> {
    raw_heic_has_item_transform(|context| unsafe {
        libheif_sys::heif_context_read_from_memory_without_copy(
            context,
            bytes.as_ptr().cast(),
            bytes.len(),
            std::ptr::null(),
        )
    })
}

#[cfg(feature = "heic")]
struct RawHeifContext(*mut libheif_sys::heif_context);

#[cfg(feature = "heic")]
impl Drop for RawHeifContext {
    fn drop(&mut self) {
        unsafe { libheif_sys::heif_context_free(self.0) };
    }
}

#[cfg(feature = "heic")]
fn read_raw_heif_context(
    read: impl FnOnce(*mut libheif_sys::heif_context) -> libheif_sys::heif_error,
    action: &str,
) -> Result<RawHeifContext, Refusal> {
    let context = RawHeifContext(unsafe { libheif_sys::heif_context_alloc() });
    if context.0.is_null() {
        return Err(Refusal::asset_type("cannot allocate HEIF context"));
    }
    raw_heic_ok(read(context.0), action)?;
    Ok(context)
}

#[cfg(feature = "heic")]
fn heif_primary_item_is_hevc_file(path: &Path) -> Result<bool, Refusal> {
    use std::ffi::CString;

    let path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| Refusal::asset_type("HEIF path contains a NUL byte"))?;
    heif_primary_item_is_hevc(|context| unsafe {
        libheif_sys::heif_context_read_from_file(context, path.as_ptr(), std::ptr::null())
    })
}

#[cfg(feature = "heic")]
fn heif_primary_item_is_hevc_bytes(bytes: &[u8]) -> Result<bool, Refusal> {
    heif_primary_item_is_hevc(|context| unsafe {
        libheif_sys::heif_context_read_from_memory_without_copy(
            context,
            bytes.as_ptr().cast(),
            bytes.len(),
            std::ptr::null(),
        )
    })
}

#[cfg(feature = "heic")]
fn heif_primary_item_is_hevc(
    read: impl FnOnce(*mut libheif_sys::heif_context) -> libheif_sys::heif_error,
) -> Result<bool, Refusal> {
    let context = read_raw_heif_context(read, "cannot read HEIF primary item")?;
    let mut item_id = 0;
    raw_heic_ok(
        unsafe { libheif_sys::heif_context_get_primary_image_ID(context.0, &mut item_id) },
        "HEIF has no primary image",
    )?;
    let item_type = unsafe { libheif_sys::heif_item_get_item_type(context.0, item_id) };
    let item_type = item_type.to_be_bytes();
    Ok(item_type == *b"hvc1" || item_type == *b"hev1")
}

#[cfg(feature = "heic")]
fn raw_heic_has_item_transform(
    read: impl FnOnce(*mut libheif_sys::heif_context) -> libheif_sys::heif_error,
) -> Result<bool, Refusal> {
    let context = read_raw_heif_context(read, "cannot read HEIC transforms")?;
    let mut item_id = 0;
    raw_heic_ok(
        unsafe { libheif_sys::heif_context_get_primary_image_ID(context.0, &mut item_id) },
        "HEIC has no primary image",
    )?;
    let count = unsafe {
        libheif_sys::heif_item_get_transformation_properties(
            context.0,
            item_id,
            std::ptr::null_mut(),
            0,
        )
    };
    if count < 0 {
        return Err(Refusal::asset_type(
            "cannot inspect HEIC item transformations",
        ));
    }
    let mut properties = vec![0; count as usize];
    let filled = unsafe {
        libheif_sys::heif_item_get_transformation_properties(
            context.0,
            item_id,
            properties.as_mut_ptr(),
            count,
        )
    };
    if filled < 0 {
        return Err(Refusal::asset_type(
            "cannot inspect HEIC item transformations",
        ));
    }
    for property in properties.into_iter().take(filled as usize) {
        let property_type =
            unsafe { libheif_sys::heif_item_get_property_type(context.0, item_id, property) };
        if property_type
            == libheif_sys::heif_item_property_type_heif_item_property_type_transform_mirror
        {
            return Ok(true);
        }
        if property_type
            == libheif_sys::heif_item_property_type_heif_item_property_type_transform_rotation
        {
            let degrees = unsafe {
                libheif_sys::heif_item_get_property_transform_rotation_ccw(
                    context.0, item_id, property,
                )
            };
            if degrees != 0 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[cfg(feature = "heic")]
fn raw_heic_ok(error: libheif_sys::heif_error, action: &str) -> Result<(), Refusal> {
    if error.code == libheif_sys::heif_error_code_heif_error_Ok {
        Ok(())
    } else {
        Err(Refusal::asset_type(action))
    }
}

#[cfg(feature = "heic")]
fn decode_heic(path: &Path, ceilings: Ceilings) -> Result<image::DynamicImage, Refusal> {
    use libheif_rs::HeifContext;

    if detect_format(path, ceilings)? != MediaFormat::Heic {
        return Err(Refusal::asset_type("input is not HEIC"));
    }
    let facts = heic_facts(path, ceilings)?;
    let context = HeifContext::read_from_file(&path.to_string_lossy())
        .map_err(|error| Refusal::asset_type(format!("cannot read HEIC container: {error}")))?;
    decode_heic_context(&context, facts)
}

#[cfg(feature = "heic")]
fn decode_heic_bytes(bytes: &[u8], ceilings: Ceilings) -> Result<image::DynamicImage, Refusal> {
    use libheif_rs::HeifContext;

    if !heif_primary_item_is_hevc_bytes(bytes)? {
        return Err(Refusal::asset_type("HEIF primary image is not HEVC"));
    }
    let context = HeifContext::read_from_bytes(bytes)
        .map_err(|error| Refusal::asset_type(format!("cannot read HEIC container: {error}")))?;
    let has_item_transform = heic_has_item_transform_bytes(bytes)?;
    let facts =
        heic_facts_from_context(&context, bytes.len() as u64, has_item_transform, ceilings)?;
    decode_heic_context(&context, facts)
}

#[cfg(feature = "heic")]
fn decode_heic_context(
    context: &libheif_rs::HeifContext<'_>,
    facts: HeicFacts,
) -> Result<image::DynamicImage, Refusal> {
    use image::{DynamicImage, GenericImageView, RgbImage};
    use libheif_rs::{ColorSpace, LibHeif, RgbChroma};

    let handle = context
        .primary_image_handle()
        .map_err(|error| Refusal::asset_type(format!("HEIC has no primary image: {error}")))?;
    // libheif applies irot/imir/crop transformations while decoding, so these are display pixels.
    let decoded = LibHeif::new()
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|error| Refusal::asset_type(format!("HEIC decode failed: {error}")))?;
    let width = decoded.width();
    let height = decoded.height();
    let plane = decoded
        .planes()
        .interleaved
        .ok_or_else(|| Refusal::asset_type("HEIC decoder returned no RGB plane"))?;
    let row_bytes = usize::try_from(u64::from(width) * 3)
        .map_err(|_| Refusal::too_large("HEIC RGB row is too large"))?;
    if plane.stride < row_bytes || plane.data.len() < plane.stride.saturating_mul(height as usize) {
        return Err(Refusal::asset_type(
            "HEIC decoder returned a truncated RGB plane",
        ));
    }
    let capacity = row_bytes
        .checked_mul(height as usize)
        .ok_or_else(|| Refusal::too_large("HEIC RGB output is too large"))?;
    let mut pixels = Vec::with_capacity(capacity);
    for row in plane.data.chunks(plane.stride).take(height as usize) {
        pixels.extend_from_slice(&row[..row_bytes]);
    }
    let image = RgbImage::from_raw(width, height, pixels)
        .ok_or_else(|| Refusal::asset_type("HEIC RGB plane dimensions are inconsistent"))?;
    let mut image = DynamicImage::ImageRgb8(image);
    if !facts.has_item_transform && (2..=8).contains(&facts.exif_orientation) {
        image.apply_orientation(image_orientation(facts.exif_orientation));
    }
    if image.dimensions() != (facts.width, facts.height) {
        return Err(Refusal::asset_type(
            "HEIC decoded dimensions disagree with the bounded display probe",
        ));
    }
    Ok(image)
}

#[cfg(test)]
mod tests;
