//! Store-less media helper protocol derived from Snapback2's tested validators.

use crate::codec::verify_h264_aac;
use crate::image_walk::{self, ImageFormat};
use crate::protocol::Refusal;
use crate::video_walk::{DEFAULT_CEILINGS, walk_and_strip};
use image::{GenericImageView, ImageDecoder};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES: u64 = 50 * 1024 * 1024;
const MAX_VIDEO_DURATION_MS: u64 = 60_000;
const MAX_PIXELS: u64 = 50_000_000;
const MAX_EDGE: u32 = 16_384;
const MAX_DECOMPRESSION_RATIO: u64 = 500;
const RATIO_FLOOR_BYTES: u64 = 16 * 1024 * 1024;
static CAPABILITY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    protocol: &'static str,
    images: bool,
    video: bool,
    image_types: [&'static str; 3],
    video_types: [&'static str; 1],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Facts {
    r#type: &'static str,
    bytes: u64,
    width: u32,
    height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<u64>,
}

pub fn run(args: &[String]) -> Result<serde_json::Value, Refusal> {
    let value = match args {
        [command] if command == "capabilities" => serde_json::to_value(capabilities()?),
        [command, kind, source, destination] if command == "validate" => {
            let facts = validate(kind, Path::new(source), Path::new(destination))?;
            serde_json::to_value(facts)
        }
        _ => {
            return Err(asset_type(
                "usage: snapback3-media <capabilities|validate KIND SOURCE DESTINATION>",
            ));
        }
    };
    value.map_err(|error| asset_type(format!("cannot encode helper response: {error}")))
}

fn capabilities() -> Result<Capabilities, Refusal> {
    use crate::capability_fixtures::{JPEG, PNG, WEBP};

    const MP4: &[u8] =
        include_bytes!("../../../../benchmarks/fixtures/social-messenger/media/vid-01.mp4");

    let root = CapabilityRoot::new()?;
    for (name, bytes, expected) in [
        ("image.jpg", JPEG, "image/jpeg"),
        ("image.png", PNG, "image/png"),
        ("image.webp", WEBP, "image/webp"),
    ] {
        let source = root.0.join(name);
        let destination = root.0.join(format!("{name}.out"));
        fs::write(&source, bytes).map_err(|error| capability_io("write image fixture", error))?;
        let facts = validate("image", &source, &destination)
            .map_err(|error| capability_refusal(name, error))?;
        if facts.r#type != expected || facts.width == 0 || facts.height == 0 {
            return Err(capability_failed(format!(
                "{name} returned inconsistent decoded facts"
            )));
        }
    }
    let video_source = root.0.join("video.mp4");
    let video_destination = root.0.join("video.mp4.out");
    fs::write(&video_source, MP4).map_err(|error| capability_io("write video fixture", error))?;
    let video = validate("video", &video_source, &video_destination)
        .map_err(|error| capability_refusal("video.mp4", error))?;
    if video.r#type != "video/mp4"
        || video.width == 0
        || video.height == 0
        || video.duration.is_none_or(|duration| duration == 0)
    {
        return Err(capability_failed(
            "video.mp4 returned inconsistent container facts",
        ));
    }
    Ok(Capabilities {
        protocol: "snapback3-media/1",
        images: true,
        video: true,
        image_types: ["image/jpeg", "image/png", "image/webp"],
        video_types: ["video/mp4"],
    })
}

struct CapabilityRoot(PathBuf);

impl CapabilityRoot {
    fn new() -> Result<Self, Refusal> {
        let path = std::env::temp_dir().join(format!(
            "snapback3-media-capability-{}-{}",
            std::process::id(),
            CAPABILITY_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&path).map_err(|error| capability_io("create fixture scratch", error))?;
        Ok(Self(path))
    }
}

impl Drop for CapabilityRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn capability_refusal(name: &str, refusal: Refusal) -> Refusal {
    capability_failed(format!(
        "compiled media path refused embedded {name}: {} ({})",
        refusal.message, refusal.code
    ))
}

fn capability_failed(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_OWNER_MEDIA_CAPABILITY",
        "owner",
        message,
        "install the fixture-qualified snapback3-media helper for this platform",
        "assets/helper",
    )
}

fn capability_io(action: &str, error: io::Error) -> Refusal {
    capability_failed(format!("could not {action}: {error}"))
}

// @ref LLP 2000#13-first-implementation-choices — this is copied, S3-local
// validation source; the running product never imports a sibling runtime.
fn validate(kind: &str, source: &Path, destination: &Path) -> Result<Facts, Refusal> {
    copy_durable(source, destination)?;
    let result = match kind {
        "image" => validate_image(destination),
        "video" => validate_video(destination),
        _ => Err(asset_type("media kind must be image or video")),
    };
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn validate_image(path: &Path) -> Result<Facts, Refusal> {
    let before = fs::metadata(path)
        .map_err(|error| io_refusal("inspect image", error))?
        .len();
    if before == 0 || before > MAX_IMAGE_BYTES {
        return Err(too_large("image bytes exceed the 10 MiB admission ceiling"));
    }
    let facts = image_walk::strip(path)?;
    if facts.format == ImageFormat::Heic {
        return Err(asset_type(
            "HEIC is not admitted by the Snapback3 Clique media slice",
        ));
    }
    let pixels = u64::from(facts.sensor_width) * u64::from(facts.sensor_height);
    if facts.sensor_width == 0
        || facts.sensor_height == 0
        || facts.sensor_width > MAX_EDGE
        || facts.sensor_height > MAX_EDGE
        || pixels > MAX_PIXELS
    {
        return Err(too_large(
            "image dimensions exceed the decode-safety ceiling",
        ));
    }
    let decoded_bytes = pixels.saturating_mul(4);
    if decoded_bytes > RATIO_FLOOR_BYTES && decoded_bytes / before.max(1) > MAX_DECOMPRESSION_RATIO
    {
        return Err(too_large(
            "image decompression ratio exceeds the decode-safety ceiling",
        ));
    }
    // Decoding the stripped file is intentional: header-only dimension probes
    // do not establish that attacker-controlled compressed pixels are valid.
    let format = match facts.format {
        ImageFormat::Jpeg => image::ImageFormat::Jpeg,
        ImageFormat::Png => image::ImageFormat::Png,
        ImageFormat::Webp => image::ImageFormat::WebP,
        ImageFormat::Heic => unreachable!("HEIC was refused above"),
    };
    let reader = image::ImageReader::with_format(
        BufReader::new(File::open(path).map_err(|error| io_refusal("open image decoder", error))?),
        format,
    );
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| asset_type(format!("cannot open image decoder: {error}")))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(MAX_PIXELS.saturating_mul(8));
    decoder
        .set_limits(limits)
        .map_err(|error| too_large(format!("image decoder limits refused input: {error}")))?;
    if decoder.dimensions() != (facts.sensor_width, facts.sensor_height) {
        return Err(asset_type(
            "image decoder dimensions disagree with the bounded container walk",
        ));
    }
    let decoded = image::DynamicImage::from_decoder(decoder)
        .map_err(|error| asset_type(format!("image pixel decode failed: {error}")))?;
    if decoded.dimensions() != (facts.sensor_width, facts.sensor_height) {
        return Err(asset_type(
            "decoded pixels disagree with the validated image dimensions",
        ));
    }
    let bytes = fs::metadata(path)
        .map_err(|error| io_refusal("inspect stripped image", error))?
        .len();
    if bytes == 0 || bytes > MAX_IMAGE_BYTES {
        return Err(too_large(
            "stripped image bytes exceed the 10 MiB admission ceiling",
        ));
    }
    sync_file(path)?;
    Ok(Facts {
        r#type: facts.format.media_type(),
        bytes,
        width: facts.width,
        height: facts.height,
        duration: None,
    })
}

fn validate_video(path: &Path) -> Result<Facts, Refusal> {
    let bytes = fs::metadata(path)
        .map_err(|error| io_refusal("inspect video", error))?
        .len();
    if bytes == 0 || bytes > MAX_VIDEO_BYTES {
        return Err(too_large("video bytes exceed the 50 MiB admission ceiling"));
    }
    let validated_duration = verify_h264_aac(path)?;
    let facts = walk_and_strip(path, &DEFAULT_CEILINGS)?;
    if facts.detected_type != "video/mp4" {
        return Err(asset_type(
            "the Snapback3 Clique media slice admits MP4, not QuickTime MOV",
        ));
    }
    if facts.duration_ms > MAX_VIDEO_DURATION_MS {
        return Err(too_large("video duration exceeds 60 seconds"));
    }
    if facts.duration_ms != validated_duration {
        return Err(asset_type(
            "video movie duration changed between structural validation passes",
        ));
    }
    let final_bytes = fs::metadata(path)
        .map_err(|error| io_refusal("inspect stripped video", error))?
        .len();
    sync_file(path)?;
    Ok(Facts {
        r#type: "video/mp4",
        bytes: final_bytes,
        width: facts.width,
        height: facts.height,
        duration: Some(facts.duration_ms),
    })
}

fn copy_durable(source: &Path, destination: &Path) -> Result<(), Refusal> {
    let mut input = File::open(source).map_err(|error| io_refusal("open staged media", error))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| io_refusal("create validated media", error))?;
    let result = io::copy(&mut input, &mut output)
        .map_err(|error| io_refusal("copy staged media", error))
        .and_then(|_| {
            output
                .flush()
                .map_err(|error| io_refusal("flush validated media", error))
        })
        .and_then(|_| {
            output
                .sync_all()
                .map_err(|error| io_refusal("sync validated media", error))
        });
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn sync_file(path: &Path) -> Result<(), Refusal> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_refusal("sync finalized media", error))
}

fn asset_type(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TYPE",
        "input",
        message,
        "upload a valid JPEG, PNG, WebP, or MP4/H.264/AAC file",
        "assets/admission",
    )
}

fn too_large(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TOO_LARGE",
        "input",
        message,
        "upload media within the generated byte, pixel, and duration limits",
        "assets/admission",
    )
}

fn io_refusal(action: &str, error: io::Error) -> Refusal {
    Refusal::new(
        "E_OWNER_ASSET_IO",
        "owner",
        format!("could not {action}: {error}"),
        "repair .snapback3 media storage and retry",
        "assets/storage",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "snapback3-media-{label}-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../benchmarks/fixtures/social-messenger/media")
            .join(name)
    }

    #[test]
    fn clique_image_and_h264_aac_video_are_fully_walked() {
        let root = TempRoot::new("clique-fixtures");
        let image_path = root.0.join("image.out");
        let image = validate("image", &fixture("avatar-alice.png"), &image_path).unwrap();
        assert_eq!(image.r#type, "image/png");
        assert_eq!((image.width, image.height), (256, 256));
        assert_eq!(fs::metadata(&image_path).unwrap().len(), image.bytes);
        assert_eq!(
            image::ImageReader::open(&image_path)
                .unwrap()
                .with_guessed_format()
                .unwrap()
                .decode()
                .unwrap()
                .dimensions(),
            (256, 256),
        );

        let video_path = root.0.join("video.out");
        let video = validate("video", &fixture("vid-01.mp4"), &video_path).unwrap();
        assert_eq!(video.r#type, "video/mp4");
        assert_eq!((video.width, video.height), (320, 240));
        assert!(
            video
                .duration
                .is_some_and(|duration| duration <= MAX_VIDEO_DURATION_MS)
        );
        assert_eq!(fs::metadata(&video_path).unwrap().len(), video.bytes);
    }

    #[test]
    fn corrupt_and_kind_mismatched_bytes_leave_no_output() {
        let root = TempRoot::new("refusals");
        let corrupt = root.0.join("corrupt.png");
        fs::write(&corrupt, b"\x89PNG\r\n\x1a\ncorrupt").unwrap();
        let corrupt_output = root.0.join("corrupt.out");
        assert_eq!(
            validate("image", &corrupt, &corrupt_output)
                .unwrap_err()
                .code,
            "E_ASSET_TYPE"
        );
        assert!(!corrupt_output.exists());

        let mismatch_output = root.0.join("mismatch.out");
        assert_eq!(
            validate("video", &fixture("avatar-alice.png"), &mismatch_output)
                .unwrap_err()
                .code,
            "E_ASSET_TYPE",
        );
        assert!(!mismatch_output.exists());

        let truncated = root.0.join("truncated.mp4");
        let video = fs::read(fixture("vid-01.mp4")).unwrap();
        fs::write(&truncated, &video[..video.len().min(128)]).unwrap();
        let truncated_output = root.0.join("truncated.out");
        assert_eq!(
            validate("video", &truncated, &truncated_output)
                .unwrap_err()
                .code,
            "E_ASSET_TYPE",
        );
        assert!(!truncated_output.exists());
    }
}
