//! Trusted image processing for the asset pipeline (LLP 0044, image
//! program P-01/P-02): bounded decode over adversarial inputs and the
//! strip-canonicalization rewrite.
//!
//! Every input is hostile until proven otherwise. Decode work is bounded
//! *before* allocation by header-probed dimensions against the declared
//! ceilings; the `image` crate's own limits back the same bounds during
//! decode. There is no mid-decode cancellation in the crate, so the time
//! budget is checked between steps — the pixel and dimension ceilings are
//! what bound any single step's work.
// @ref LLP 0044#declarative-processing-and-rendition-publication — every
// processing input is adversarial; ceilings are Enforced capability facts.

use image::{DynamicImage, ImageDecoder};

use crate::diagnostic::{SnapbackError, SnapbackResult};

/// Enforced ceilings for one processing invocation. The local target's
/// values are `ASSET_IMAGE_CEILINGS_LOCAL_V1`; tests construct smaller
/// ones so refusals are exercised without gigantic fixtures. P-05 surfaces
/// the local values as capability facts.
#[derive(Clone, Copy, Debug)]
pub struct AssetImageCeilingsV1 {
    pub max_pixels: u64,
    pub max_dimension: u32,
    /// Decompression-ratio bound, applied only above `ratio_floor_bytes` of
    /// estimated decoded size — small legitimate images compress far better
    /// than any bomb needs to.
    pub max_decompression_ratio: u64,
    pub ratio_floor_bytes: u64,
    pub max_metadata_bytes: u64,
    pub step_time_budget_ms: u64,
    pub max_output_bytes: u64,
}

pub const ASSET_IMAGE_CEILINGS_LOCAL_V1: AssetImageCeilingsV1 = AssetImageCeilingsV1 {
    max_pixels: 50_000_000,
    max_dimension: 16_384,
    max_decompression_ratio: 500,
    ratio_floor_bytes: 16 * 1024 * 1024,
    max_metadata_bytes: 1024 * 1024,
    step_time_budget_ms: 10_000,
    max_output_bytes: 64 * 1024 * 1024,
};

fn bounds_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED", "assets", message)
}

fn decode_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_ASSET_IMAGE_DECODE_FAILED", "assets", message)
}

pub(crate) struct StepBudget {
    started: std::time::Instant,
    budget_ms: u64,
}

impl StepBudget {
    pub(crate) fn start(ceilings: &AssetImageCeilingsV1) -> Self {
        Self {
            started: std::time::Instant::now(),
            budget_ms: ceilings.step_time_budget_ms,
        }
    }

    fn check(&self, step: &str) -> SnapbackResult<()> {
        let elapsed = self.started.elapsed().as_millis() as u64;
        if elapsed > self.budget_ms {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_IMAGE_TIME_BUDGET_EXCEEDED",
                "assets",
                format!(
                    "processing exceeded its {}ms budget after {step}",
                    self.budget_ms
                ),
            ));
        }
        Ok(())
    }
}

/// Header dimensions parsed directly from the container bytes, so the
/// ceiling checks below run before the decoder crate's own limit machinery
/// can label a hostile header as a mere decode failure — a dimension lie
/// must refuse as a bounds refusal, before any pixel allocation.
fn header_dimensions(bytes: &[u8], content_type: &str) -> SnapbackResult<(u32, u32)> {
    match content_type {
        "image/png" => {
            if bytes.len() >= 24 && &bytes[12..16] == b"IHDR" {
                let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
                let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
                return Ok((width, height));
            }
            Err(decode_error("png header is malformed"))
        }
        "image/jpeg" => {
            let mut cursor = 2usize;
            while cursor + 4 <= bytes.len() {
                if bytes[cursor] != 0xFF {
                    break;
                }
                let marker = bytes[cursor + 1];
                let length = u16::from_be_bytes([bytes[cursor + 2], bytes[cursor + 3]]) as usize;
                if matches!(marker, 0xC0..=0xCF)
                    && !matches!(marker, 0xC4 | 0xC8 | 0xCC)
                    && cursor + 9 <= bytes.len()
                {
                    let height =
                        u32::from(u16::from_be_bytes([bytes[cursor + 5], bytes[cursor + 6]]));
                    let width =
                        u32::from(u16::from_be_bytes([bytes[cursor + 7], bytes[cursor + 8]]));
                    return Ok((width, height));
                }
                if marker == 0xDA {
                    break;
                }
                cursor += 2 + length;
            }
            Err(decode_error("jpeg header carries no frame dimensions"))
        }
        other => Err(decode_error(format!("no header parser for {other}"))),
    }
}

/// Header-probed dimensions, checked against the ceilings before any pixel
/// allocation happens. A dimension-lying header refuses here.
fn probe_dimensions(
    bytes: &[u8],
    content_type: &str,
    ceilings: &AssetImageCeilingsV1,
) -> SnapbackResult<(u32, u32)> {
    let (width, height) = header_dimensions(bytes, content_type)?;
    if width > ceilings.max_dimension || height > ceilings.max_dimension {
        return Err(bounds_error(format!(
            "declared dimensions {width}x{height} exceed the {} ceiling",
            ceilings.max_dimension
        )));
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > ceilings.max_pixels {
        return Err(bounds_error(format!(
            "declared pixel count {pixels} exceeds the {} ceiling",
            ceilings.max_pixels
        )));
    }
    let decoded_estimate = pixels.saturating_mul(4);
    if decoded_estimate > ceilings.ratio_floor_bytes {
        let encoded = bytes.len().max(1) as u64;
        if decoded_estimate / encoded > ceilings.max_decompression_ratio {
            return Err(bounds_error(format!(
                "decompression ratio {} exceeds the {} ceiling",
                decoded_estimate / encoded,
                ceilings.max_decompression_ratio
            )));
        }
    }
    Ok((width, height))
}

pub(crate) fn decode_bounded(
    bytes: &[u8],
    content_type: &str,
    ceilings: &AssetImageCeilingsV1,
    budget: &StepBudget,
) -> SnapbackResult<DynamicImage> {
    probe_dimensions(bytes, content_type, ceilings)?;
    budget.check("the header probe")?;
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| decode_error(format!("cannot probe image container: {error}")))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| decode_error(format!("cannot open image decoder: {error}")))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(ceilings.max_dimension);
    limits.max_image_height = Some(ceilings.max_dimension);
    limits.max_alloc = Some(ceilings.max_pixels.saturating_mul(8));
    decoder
        .set_limits(limits)
        .map_err(|error| bounds_error(format!("decoder limits refused: {error}")))?;
    let decoded = DynamicImage::from_decoder(decoder)
        .map_err(|error| decode_error(format!("image decode failed: {error}")))?;
    budget.check("decode")?;
    Ok(decoded)
}

/// EXIF facts safe to keep. Location never leaves this module: it is
/// deliberately not represented here, so nothing downstream can persist it.
#[derive(Clone, Debug, Default)]
pub struct AssetImageSafeExif {
    /// EXIF orientation 1..8 as stored; `None` when absent/unreadable.
    pub orientation: Option<u16>,
    pub captured_at: Option<String>,
}

fn exif_fields(bytes: &[u8]) -> Option<exif::Exif> {
    exif::Reader::new()
        .read_from_container(&mut std::io::Cursor::new(bytes))
        .ok()
}

pub fn extract_safe_exif(bytes: &[u8]) -> AssetImageSafeExif {
    let Some(exif) = exif_fields(bytes) else {
        return AssetImageSafeExif::default();
    };
    let orientation = exif
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| (1..=8).contains(value));
    let captured_at = exif
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .map(|field| field.display_value().to_string());
    AssetImageSafeExif {
        orientation,
        captured_at,
    }
}

/// Total metadata-segment size (JPEG APPn segments / PNG ancillary chunks),
/// bounded before any parse so a metadata bomb refuses structurally.
fn metadata_bytes(bytes: &[u8], content_type: &str) -> u64 {
    match content_type {
        "image/jpeg" => {
            let mut total = 0u64;
            let mut cursor = 2usize;
            while cursor + 4 <= bytes.len() {
                if bytes[cursor] != 0xFF {
                    break;
                }
                let marker = bytes[cursor + 1];
                if marker == 0xDA {
                    break;
                }
                let length = u64::from(u16::from_be_bytes([bytes[cursor + 2], bytes[cursor + 3]]));
                if (0xE0..=0xEF).contains(&marker) || marker == 0xFE {
                    total = total.saturating_add(length);
                }
                cursor += 2 + length as usize;
            }
            total
        }
        "image/png" => {
            let mut total = 0u64;
            let mut cursor = 8usize;
            while cursor + 8 <= bytes.len() {
                let length = u64::from(u32::from_be_bytes([
                    bytes[cursor],
                    bytes[cursor + 1],
                    bytes[cursor + 2],
                    bytes[cursor + 3],
                ]));
                let kind = &bytes[cursor + 4..cursor + 8];
                if matches!(kind, b"eXIf" | b"tEXt" | b"zTXt" | b"iTXt") {
                    total = total.saturating_add(length);
                }
                cursor = cursor.saturating_add(12 + length as usize);
            }
            total
        }
        _ => 0,
    }
}

fn apply_orientation(decoded: DynamicImage, orientation: u16) -> DynamicImage {
    // EXIF orientation values: the corrective transform that displays the
    // stored pixels upright.
    match orientation {
        2 => decoded.fliph(),
        3 => decoded.rotate180(),
        4 => decoded.flipv(),
        5 => decoded.rotate90().fliph(),
        6 => decoded.rotate90(),
        7 => decoded.rotate270().fliph(),
        8 => decoded.rotate270(),
        _ => decoded,
    }
}

/// The single v1 placeholder algorithm (author decision 2026-07-31):
/// ThumbHash, one versioned tag so a successor can be admitted beside it
/// without reinterpreting stored values.
pub const ASSET_PLACEHOLDER_ALGO_THUMBHASH_V1: &str = "thumbhash.v1";

/// ThumbHash encoding, transcribed faithfully from the published reference
/// implementation (Evan Wallace, MIT) so client-side reference decoders can
/// render our values. Input must already be ≤ `THUMBHASH_MAX_DIM` per side.
mod thumbhash {
    pub(super) const THUMBHASH_MAX_DIM: u32 = 100;

    pub(super) fn rgba_to_thumb_hash(w: usize, h: usize, rgba: &[u8]) -> Vec<u8> {
        assert!(w <= 100 && h <= 100, "thumbhash input must be ≤100x100");
        assert_eq!(rgba.len(), w * h * 4);

        let mut avg_r = 0f64;
        let mut avg_g = 0f64;
        let mut avg_b = 0f64;
        let mut avg_a = 0f64;
        for i in 0..w * h {
            let j = i * 4;
            let alpha = f64::from(rgba[j + 3]) / 255.0;
            avg_r += alpha / 255.0 * f64::from(rgba[j]);
            avg_g += alpha / 255.0 * f64::from(rgba[j + 1]);
            avg_b += alpha / 255.0 * f64::from(rgba[j + 2]);
            avg_a += alpha;
        }
        if avg_a > 0.0 {
            avg_r /= avg_a;
            avg_g /= avg_a;
            avg_b /= avg_a;
        }

        let has_alpha = avg_a < (w * h) as f64;
        let l_limit = if has_alpha { 5.0 } else { 7.0 };
        let max_wh = w.max(h) as f64;
        let lx = ((l_limit * w as f64 / max_wh).round() as usize).max(1);
        let ly = ((l_limit * h as f64 / max_wh).round() as usize).max(1);
        let mut l = vec![0f64; w * h];
        let mut p = vec![0f64; w * h];
        let mut q = vec![0f64; w * h];
        let mut a = vec![0f64; w * h];
        for i in 0..w * h {
            let j = i * 4;
            let alpha = f64::from(rgba[j + 3]) / 255.0;
            let r = avg_r * (1.0 - alpha) + alpha / 255.0 * f64::from(rgba[j]);
            let g = avg_g * (1.0 - alpha) + alpha / 255.0 * f64::from(rgba[j + 1]);
            let b = avg_b * (1.0 - alpha) + alpha / 255.0 * f64::from(rgba[j + 2]);
            l[i] = (r + g + b) / 3.0;
            p[i] = (r + g) / 2.0 - b;
            q[i] = r - g;
            a[i] = alpha;
        }

        let encode_channel = |channel: &[f64], nx: usize, ny: usize| {
            let mut dc = 0f64;
            let mut ac = Vec::new();
            let mut scale = 0f64;
            let mut fx = vec![0f64; w];
            for cy in 0..ny {
                let mut cx = 0usize;
                while cx * ny < nx * (ny - cy) {
                    let mut f = 0f64;
                    for (x, slot) in fx.iter_mut().enumerate() {
                        *slot =
                            (std::f64::consts::PI / w as f64 * cx as f64 * (x as f64 + 0.5)).cos();
                    }
                    for y in 0..h {
                        let fy =
                            (std::f64::consts::PI / h as f64 * cy as f64 * (y as f64 + 0.5)).cos();
                        for x in 0..w {
                            f += channel[x + y * w] * fx[x] * fy;
                        }
                    }
                    f /= (w * h) as f64;
                    if cx > 0 || cy > 0 {
                        ac.push(f);
                        scale = scale.max(f.abs());
                    } else {
                        dc = f;
                    }
                    cx += 1;
                }
            }
            if scale > 0.0 {
                for value in &mut ac {
                    *value = 0.5 + 0.5 / scale * *value;
                }
            }
            (dc, ac, scale)
        };

        let (l_dc, l_ac, l_scale) = encode_channel(&l, lx.max(3), ly.max(3));
        let (p_dc, p_ac, p_scale) = encode_channel(&p, 3, 3);
        let (q_dc, q_ac, q_scale) = encode_channel(&q, 3, 3);
        let (a_dc, a_ac, a_scale) = if has_alpha {
            encode_channel(&a, 5, 5)
        } else {
            (1.0, Vec::new(), 1.0)
        };

        let is_landscape = w > h;
        let header24: u32 = ((63.0 * l_dc).round() as u32)
            | (((31.5 + 31.5 * p_dc).round() as u32) << 6)
            | (((31.5 + 31.5 * q_dc).round() as u32) << 12)
            | (((31.0 * l_scale).round() as u32) << 18)
            | (u32::from(has_alpha) << 23);
        let header16: u32 = (if is_landscape { ly } else { lx } as u32)
            | (((63.0 * p_scale).round() as u32) << 3)
            | (((63.0 * q_scale).round() as u32) << 9)
            | (u32::from(is_landscape) << 15);
        let mut hash = vec![
            (header24 & 255) as u8,
            ((header24 >> 8) & 255) as u8,
            (header24 >> 16) as u8,
            (header16 & 255) as u8,
            (header16 >> 8) as u8,
        ];
        let ac_start = if has_alpha { 6 } else { 5 };
        if has_alpha {
            hash.push(((15.0 * a_dc).round() as u8) | (((15.0 * a_scale).round() as u8) << 4));
        }
        let mut ac_index = 0usize;
        let channels: &[&[f64]] = if has_alpha {
            &[&l_ac, &p_ac, &q_ac, &a_ac]
        } else {
            &[&l_ac, &p_ac, &q_ac]
        };
        for ac in channels {
            for f in ac.iter() {
                let slot = ac_start + (ac_index >> 1);
                if slot >= hash.len() {
                    hash.push(0);
                }
                hash[slot] |= ((15.0 * f).round() as u8) << ((ac_index & 1) * 4);
                ac_index += 1;
            }
        }
        hash
    }
}

/// Placeholder + dominant color derived from one bounded downscale of the
/// oriented pixels. Deterministic: same input bytes → same facts.
#[derive(Clone, Debug)]
pub struct AssetImageDerivedFacts {
    /// Base64 (standard, unpadded) ThumbHash bytes.
    pub placeholder: String,
    /// `#rrggbb` alpha-weighted average.
    pub dominant_color: String,
}

fn derive_image_facts(oriented: &DynamicImage) -> AssetImageDerivedFacts {
    use base64::Engine as _;
    let small = oriented.thumbnail(thumbhash::THUMBHASH_MAX_DIM, thumbhash::THUMBHASH_MAX_DIM);
    let rgba = small.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let hash = thumbhash::rgba_to_thumb_hash(w, h, rgba.as_raw());
    let placeholder = base64::engine::general_purpose::STANDARD_NO_PAD.encode(hash);
    let (mut r, mut g, mut b, mut weight) = (0f64, 0f64, 0f64, 0f64);
    for pixel in rgba.pixels() {
        let alpha = f64::from(pixel[3]) / 255.0;
        r += alpha * f64::from(pixel[0]);
        g += alpha * f64::from(pixel[1]);
        b += alpha * f64::from(pixel[2]);
        weight += alpha;
    }
    let dominant_color = if weight > 0.0 {
        format!(
            "#{:02x}{:02x}{:02x}",
            (r / weight).round() as u8,
            (g / weight).round() as u8,
            (b / weight).round() as u8
        )
    } else {
        "#000000".to_owned()
    };
    AssetImageDerivedFacts {
        placeholder,
        dominant_color,
    }
}

/// Facts-only inspection for images published without rewriting (retain
/// policy). Dimensions are the displayed (post-orientation) dimensions.
#[derive(Clone, Debug)]
pub struct AssetImageInspection {
    pub width: u32,
    pub height: u32,
    pub safe_exif: AssetImageSafeExif,
    pub derived: AssetImageDerivedFacts,
}

pub fn inspect_image(
    bytes: &[u8],
    content_type: &str,
    ceilings: &AssetImageCeilingsV1,
) -> SnapbackResult<AssetImageInspection> {
    let budget = StepBudget::start(ceilings);
    let metadata = metadata_bytes(bytes, content_type);
    if metadata > ceilings.max_metadata_bytes {
        return Err(bounds_error(format!(
            "embedded metadata ({metadata} bytes) exceeds the {} ceiling",
            ceilings.max_metadata_bytes
        )));
    }
    let safe_exif = extract_safe_exif(bytes);
    let decoded = decode_bounded(bytes, content_type, ceilings, &budget)?;
    let oriented = apply_orientation(decoded, safe_exif.orientation.unwrap_or(1));
    budget.check("the orientation transform")?;
    let derived = derive_image_facts(&oriented);
    budget.check("fact derivation")?;
    Ok(AssetImageInspection {
        width: oriented.width(),
        height: oriented.height(),
        safe_exif,
        derived,
    })
}

/// One declared rendition: bounded decode of the canonical bytes, downscale
/// to the declared width (never upscale), re-encode in the canonical
/// container. Deterministic for a given canonical input.
pub fn render_variant(
    canonical: &[u8],
    content_type: &str,
    target_width: u64,
    ceilings: &AssetImageCeilingsV1,
) -> SnapbackResult<Vec<u8>> {
    let budget = StepBudget::start(ceilings);
    let decoded = decode_bounded(canonical, content_type, ceilings, &budget)?;
    let width = decoded.width();
    let target = u32::try_from(target_width).unwrap_or(u32::MAX).min(width);
    let resized = if target < width {
        decoded.resize(target, u32::MAX, image::imageops::FilterType::Triangle)
    } else {
        decoded
    };
    budget.check("resize")?;
    let mut out = Vec::new();
    match content_type {
        "image/jpeg" => {
            let mut cursor = std::io::Cursor::new(&mut out);
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 90);
            encoder
                .encode_image(&resized.to_rgb8())
                .map_err(|error| decode_error(format!("variant jpeg encode failed: {error}")))?;
        }
        "image/png" => {
            resized
                .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
                .map_err(|error| decode_error(format!("variant png encode failed: {error}")))?;
        }
        other => {
            return Err(decode_error(format!("no variant renderer for {other}")));
        }
    }
    budget.check("variant re-encode")?;
    if out.len() as u64 > ceilings.max_output_bytes {
        return Err(bounds_error(format!(
            "variant output ({} bytes) exceeds the {} ceiling",
            out.len(),
            ceilings.max_output_bytes
        )));
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub struct AssetImageStripOutcome {
    pub canonical: Vec<u8>,
    pub safe_exif: AssetImageSafeExif,
    pub width: u32,
    pub height: u32,
    pub derived: AssetImageDerivedFacts,
}

/// The strip canonicalization: decode → corrective orientation transform →
/// re-encode. Re-encoding structurally drops every metadata segment — that
/// *is* the strip; the safe facts are extracted first and returned beside
/// the bytes, never inside them.
pub fn canonicalize_strip(
    bytes: &[u8],
    content_type: &str,
    ceilings: &AssetImageCeilingsV1,
) -> SnapbackResult<AssetImageStripOutcome> {
    if !matches!(content_type, "image/jpeg" | "image/png") {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_LOCATION_POLICY_UNSUPPORTED",
            "assets",
            format!("no strip canonicalization exists for {content_type}"),
        ));
    }
    let budget = StepBudget::start(ceilings);
    let metadata = metadata_bytes(bytes, content_type);
    if metadata > ceilings.max_metadata_bytes {
        return Err(bounds_error(format!(
            "embedded metadata ({metadata} bytes) exceeds the {} ceiling",
            ceilings.max_metadata_bytes
        )));
    }
    let safe_exif = extract_safe_exif(bytes);
    let decoded = decode_bounded(bytes, content_type, ceilings, &budget)?;
    let oriented = apply_orientation(decoded, safe_exif.orientation.unwrap_or(1));
    budget.check("the orientation transform")?;
    let (width, height) = (oriented.width(), oriented.height());
    let derived = derive_image_facts(&oriented);
    budget.check("fact derivation")?;
    let mut canonical = Vec::new();
    match content_type {
        "image/jpeg" => {
            let mut cursor = std::io::Cursor::new(&mut canonical);
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 90);
            encoder
                .encode_image(&oriented.to_rgb8())
                .map_err(|error| decode_error(format!("jpeg re-encode failed: {error}")))?;
        }
        "image/png" => {
            oriented
                .write_to(
                    &mut std::io::Cursor::new(&mut canonical),
                    image::ImageFormat::Png,
                )
                .map_err(|error| decode_error(format!("png re-encode failed: {error}")))?;
        }
        other => {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_LOCATION_POLICY_UNSUPPORTED",
                "assets",
                format!("no strip canonicalization exists for {other}"),
            ));
        }
    }
    budget.check("re-encode")?;
    if canonical.len() as u64 > ceilings.max_output_bytes {
        return Err(bounds_error(format!(
            "canonical output ({} bytes) exceeds the {} ceiling",
            canonical.len(),
            ceilings.max_output_bytes
        )));
    }
    Ok(AssetImageStripOutcome {
        canonical,
        safe_exif,
        width,
        height,
        derived,
    })
}

#[cfg(any(test, feature = "test-support"))]
pub mod fixtures {
    /// A deterministic JPEG carrying an EXIF APP1 segment with GPS
    /// coordinates, orientation, and DateTimeOriginal — the exact triple the
    /// strip path must separate: drop the first, apply the second, keep the
    /// third.
    pub fn jpeg_with_gps_exif(width: u32, height: u32, orientation: u16) -> Vec<u8> {
        let encoded = plain_jpeg(width, height);
        let exif_payload = exif_app1_payload(orientation);
        let mut out = Vec::with_capacity(encoded.len() + exif_payload.len() + 4);
        out.extend_from_slice(&encoded[..2]);
        out.push(0xFF);
        out.push(0xE1);
        let segment_length = (exif_payload.len() + 2) as u16;
        out.extend_from_slice(&segment_length.to_be_bytes());
        out.extend_from_slice(&exif_payload);
        out.extend_from_slice(&encoded[2..]);
        out
    }

    pub fn plain_jpeg(width: u32, height: u32) -> Vec<u8> {
        plain_jpeg_quality(width, height, 90)
    }

    pub fn plain_jpeg_quality(width: u32, height: u32, quality: u8) -> Vec<u8> {
        let image = deterministic_rgb(width, height);
        let mut encoded = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut encoded);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
        encoder.encode_image(&image).expect("fixture jpeg encodes");
        drop(encoder);
        encoded
    }

    pub fn deterministic_rgb(width: u32, height: u32) -> image::RgbImage {
        image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 241) as u8, ((x + y) % 239) as u8])
        })
    }

    /// A PNG whose IHDR declares enormous dimensions with no real pixel
    /// data behind them.
    pub fn dimension_lying_png(width: u32, height: u32) -> Vec<u8> {
        let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&width.to_be_bytes());
        ihdr.extend_from_slice(&height.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        out.extend_from_slice(&(ihdr.len() as u32).to_be_bytes());
        out.extend_from_slice(b"IHDR");
        let mut crc = crc32fast::Hasher::new();
        crc.update(b"IHDR");
        crc.update(&ihdr);
        out.extend_from_slice(&ihdr);
        out.extend_from_slice(&crc.finalize().to_be_bytes());
        out
    }

    fn exif_app1_payload(orientation: u16) -> Vec<u8> {
        use exif::experimental::Writer;
        let orientation_value = exif::Value::Short(vec![orientation]);
        let captured = exif::Value::Ascii(vec![b"2026:07:30 12:00:00".to_vec()]);
        let lat_ref = exif::Value::Ascii(vec![b"N".to_vec()]);
        let lat = exif::Value::Rational(vec![(37, 1).into(), (46, 1).into(), (30, 1).into()]);
        let lon_ref = exif::Value::Ascii(vec![b"W".to_vec()]);
        let lon = exif::Value::Rational(vec![(122, 1).into(), (25, 1).into(), (10, 1).into()]);
        let orientation_field = exif::Field {
            tag: exif::Tag::Orientation,
            ifd_num: exif::In::PRIMARY,
            value: orientation_value,
        };
        let captured_field = exif::Field {
            tag: exif::Tag::DateTimeOriginal,
            ifd_num: exif::In::PRIMARY,
            value: captured,
        };
        let lat_ref_field = exif::Field {
            tag: exif::Tag::GPSLatitudeRef,
            ifd_num: exif::In::PRIMARY,
            value: lat_ref,
        };
        let lat_field = exif::Field {
            tag: exif::Tag::GPSLatitude,
            ifd_num: exif::In::PRIMARY,
            value: lat,
        };
        let lon_ref_field = exif::Field {
            tag: exif::Tag::GPSLongitudeRef,
            ifd_num: exif::In::PRIMARY,
            value: lon_ref,
        };
        let lon_field = exif::Field {
            tag: exif::Tag::GPSLongitude,
            ifd_num: exif::In::PRIMARY,
            value: lon,
        };
        let mut writer = Writer::new();
        writer.push_field(&orientation_field);
        writer.push_field(&captured_field);
        writer.push_field(&lat_ref_field);
        writer.push_field(&lat_field);
        writer.push_field(&lon_ref_field);
        writer.push_field(&lon_field);
        let mut payload = std::io::Cursor::new(Vec::new());
        writer
            .write(&mut payload, false)
            .expect("exif payload writes");
        let mut out = b"Exif\0\0".to_vec();
        out.extend_from_slice(payload.get_ref());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_ceilings() -> AssetImageCeilingsV1 {
        AssetImageCeilingsV1 {
            max_pixels: 10_000,
            max_dimension: 128,
            max_decompression_ratio: 500,
            ratio_floor_bytes: 16 * 1024 * 1024,
            max_metadata_bytes: 4096,
            step_time_budget_ms: 10_000,
            max_output_bytes: 1024 * 1024,
        }
    }

    #[test]
    fn asset_image_dimension_lying_header_refuses_before_allocation() {
        let bomb = fixtures::dimension_lying_png(100_000, 100_000);
        let error = canonicalize_strip(&bomb, "image/png", &small_ceilings())
            .expect_err("dimension lie refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED"
        );
    }

    #[test]
    fn asset_image_pixel_ceiling_refuses_within_dimension_bound() {
        let ceilings = AssetImageCeilingsV1 {
            max_pixels: 100,
            ..small_ceilings()
        };
        let fixture = fixtures::plain_jpeg(64, 64);
        let error = canonicalize_strip(&fixture, "image/jpeg", &ceilings)
            .expect_err("pixel ceiling refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED"
        );
    }

    #[test]
    fn asset_image_decompression_ratio_refuses_a_bomb_shape() {
        let ceilings = AssetImageCeilingsV1 {
            max_pixels: u64::MAX,
            max_dimension: u32::MAX,
            max_decompression_ratio: 4,
            ratio_floor_bytes: 1,
            ..small_ceilings()
        };
        let bomb = fixtures::dimension_lying_png(4_000, 4_000);
        let error = canonicalize_strip(&bomb, "image/png", &ceilings).expect_err("ratio refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED"
        );
    }

    #[test]
    fn asset_image_truncated_jpeg_refuses_as_decode_failure() {
        let fixture = fixtures::plain_jpeg(32, 32);
        let truncated = &fixture[..fixture.len() / 2];
        let error = canonicalize_strip(truncated, "image/jpeg", &small_ceilings())
            .expect_err("truncated refuses");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_IMAGE_DECODE_FAILED");
    }

    #[test]
    fn asset_image_metadata_bomb_refuses() {
        let ceilings = AssetImageCeilingsV1 {
            max_metadata_bytes: 16,
            ..small_ceilings()
        };
        let fixture = fixtures::jpeg_with_gps_exif(16, 16, 1);
        let error = canonicalize_strip(&fixture, "image/jpeg", &ceilings)
            .expect_err("metadata ceiling refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED"
        );
    }

    #[test]
    fn asset_image_zero_time_budget_refuses() {
        let ceilings = AssetImageCeilingsV1 {
            step_time_budget_ms: 0,
            ..small_ceilings()
        };
        let fixture = fixtures::plain_jpeg(32, 32);
        let error =
            canonicalize_strip(&fixture, "image/jpeg", &ceilings).expect_err("zero budget refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_IMAGE_TIME_BUDGET_EXCEEDED"
        );
    }

    #[test]
    fn asset_image_output_ceiling_refuses() {
        let ceilings = AssetImageCeilingsV1 {
            max_output_bytes: 64,
            ..small_ceilings()
        };
        let fixture = fixtures::plain_jpeg(64, 64);
        let error = canonicalize_strip(&fixture, "image/jpeg", &ceilings)
            .expect_err("output ceiling refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED"
        );
    }

    #[test]
    fn asset_image_strip_drops_gps_applies_orientation_keeps_captured_at() {
        let fixture = fixtures::jpeg_with_gps_exif(48, 32, 6);
        let outcome = canonicalize_strip(&fixture, "image/jpeg", &small_ceilings())
            .expect("strip canonicalizes");
        // Orientation 6 (rotate 90 CW) swaps the axes.
        assert_eq!((outcome.width, outcome.height), (32, 48));
        assert_eq!(outcome.safe_exif.orientation, Some(6));
        assert!(
            outcome
                .safe_exif
                .captured_at
                .as_deref()
                .is_some_and(|value| value.contains("2026")),
            "captured-at survives extraction: {:?}",
            outcome.safe_exif.captured_at
        );
        // The canonical bytes carry no APP1 segment at all — re-encoding
        // dropped every metadata container, GPS with it.
        let mut cursor = 2usize;
        while cursor + 4 <= outcome.canonical.len() {
            assert_eq!(
                outcome.canonical[cursor], 0xFF,
                "well-formed segment stream"
            );
            let marker = outcome.canonical[cursor + 1];
            assert_ne!(marker, 0xE1, "no APP1/EXIF segment survives the strip");
            if marker == 0xDA {
                break;
            }
            let length =
                u16::from_be_bytes([outcome.canonical[cursor + 2], outcome.canonical[cursor + 3]])
                    as usize;
            cursor += 2 + length;
        }
        // And the extraction on the canonical bytes finds nothing.
        let stripped = extract_safe_exif(&outcome.canonical);
        assert_eq!(stripped.orientation, None);
        assert_eq!(stripped.captured_at, None);
    }

    #[test]
    fn asset_image_strip_is_deterministic_for_dedup() {
        let fixture = fixtures::jpeg_with_gps_exif(24, 24, 1);
        let first =
            canonicalize_strip(&fixture, "image/jpeg", &small_ceilings()).expect("first strip");
        let second =
            canonicalize_strip(&fixture, "image/jpeg", &small_ceilings()).expect("second strip");
        assert_eq!(first.canonical, second.canonical);
    }

    #[test]
    fn asset_image_thumbhash_is_deterministic_and_reference_shaped() {
        let image = fixtures::deterministic_rgb(64, 32);
        let rgba = image::DynamicImage::ImageRgb8(image).to_rgba8();
        let first = thumbhash::rgba_to_thumb_hash(64, 32, rgba.as_raw());
        let second = thumbhash::rgba_to_thumb_hash(64, 32, rgba.as_raw());
        assert_eq!(first, second, "same pixels must hash identically");
        // Reference layout facts for an opaque landscape input: no alpha bit
        // in header24, the landscape bit set in header16, and 5 header bytes
        // plus nibble-packed AC coefficients.
        let header24 =
            u32::from(first[0]) | (u32::from(first[1]) << 8) | (u32::from(first[2]) << 16);
        assert_eq!(header24 >> 23, 0, "opaque input must not claim alpha");
        let header16 = u32::from(first[3]) | (u32::from(first[4]) << 8);
        assert_eq!(header16 >> 15, 1, "64x32 is landscape");
        assert!(first.len() > 5, "AC coefficients follow the headers");
    }

    #[test]
    fn asset_image_derived_facts_pin_placeholder_and_dominant_color() {
        // A solid red square: the dominant color is exact and the
        // placeholder is a stable, decodable vector for the JS cross-check.
        let solid = image::RgbImage::from_pixel(32, 32, image::Rgb([200, 40, 20]));
        let facts = derive_image_facts(&image::DynamicImage::ImageRgb8(solid));
        assert_eq!(facts.dominant_color, "#c82814");
        // The committed vector the JS cross-check decodes with the vendored
        // reference decoder (asset-thumbhash-vector.test.mjs). Changing the
        // encoder or the downscale changes this value — that is a
        // compatibility event for stored placeholders, not a test to update
        // casually.
        assert_eq!(facts.placeholder, "FTsDBwAwZIZ3d4eHiGd3l4h3CIpjoDgG");
        assert_eq!(
            facts.placeholder,
            derive_image_facts(&image::DynamicImage::ImageRgb8(
                image::RgbImage::from_pixel(32, 32, image::Rgb([200, 40, 20]))
            ))
            .placeholder,
            "placeholder must be deterministic"
        );
    }

    #[test]
    fn asset_image_inspect_applies_orientation_and_derives_facts() {
        // Orientation 6 (rotate 90°): a 48x32 stored frame displays 32x48.
        let bytes = fixtures::jpeg_with_gps_exif(48, 32, 6);
        let inspection = inspect_image(&bytes, "image/jpeg", &small_ceilings()).expect("inspects");
        assert_eq!((inspection.width, inspection.height), (32, 48));
        assert_eq!(inspection.safe_exif.orientation, Some(6));
        assert!(inspection.safe_exif.captured_at.is_some());
        assert!(!inspection.derived.placeholder.is_empty());
    }

    #[test]
    fn asset_image_render_variant_downscales_never_upscales() {
        let canonical = fixtures::plain_jpeg(64, 48);
        let small =
            render_variant(&canonical, "image/jpeg", 32, &small_ceilings()).expect("renders");
        let decoded = image::load_from_memory(&small).expect("variant decodes");
        assert_eq!(decoded.width(), 32);
        assert_eq!(decoded.height(), 24, "aspect ratio preserved");
        let same =
            render_variant(&canonical, "image/jpeg", 500, &small_ceilings()).expect("renders");
        let full = image::load_from_memory(&same).expect("variant decodes");
        assert_eq!(
            full.width(),
            64,
            "a variant never upscales past the canonical width"
        );
    }

    #[test]
    fn asset_image_unsupported_strip_format_refuses() {
        let error = canonicalize_strip(b"GIF89a....", "image/gif", &small_ceilings())
            .expect_err("gif strip unsupported");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_LOCATION_POLICY_UNSUPPORTED"
        );
    }
}
