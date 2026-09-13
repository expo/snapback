use image::GenericImageView;
use serde_json::{Value as Json, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TempRoot(PathBuf);

impl TempRoot {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "snapback3-media-cli-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
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

fn helper() -> &'static str {
    env!("CARGO_BIN_EXE_snapback3-media")
}

fn run(args: &[&str]) -> Output {
    Command::new(helper()).args(args).output().unwrap()
}

fn one_line(output: &Output) -> Json {
    let stdout = String::from_utf8(output.stdout.clone()).unwrap();
    assert_eq!(stdout.lines().count(), 1, "{stdout:?}");
    serde_json::from_str(stdout.trim_end()).unwrap()
}

fn validate(kind: &str, source: &Path, destination: &Path) -> (Output, Json) {
    let output = run(&[
        "validate",
        kind,
        source.to_str().unwrap(),
        destination.to_str().unwrap(),
    ]);
    let response = one_line(&output);
    (output, response)
}

fn write_pixels(path: &Path, format: image::ImageFormat) {
    let pixels = image::RgbImage::from_fn(4, 2, |x, y| {
        image::Rgb([(x * 47) as u8, (y * 113) as u8, ((x + y) * 31) as u8])
    });
    image::DynamicImage::ImageRgb8(pixels)
        .save_with_format(path, format)
        .unwrap();
}

fn decoded_dimensions(path: &Path) -> (u32, u32) {
    image::ImageReader::open(path)
        .unwrap()
        .with_guessed_format()
        .unwrap()
        .decode()
        .unwrap()
        .dimensions()
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

fn orient_jpeg(path: &Path, orientation: u8) {
    let bytes = fs::read(path).unwrap();
    assert_eq!(&bytes[..2], b"\xff\xd8");
    let mut exif = b"Exif\0\0".to_vec();
    exif.extend_from_slice(&private_tiff(orientation));
    exif.extend_from_slice(b"private-location");
    let mut result = bytes[..2].to_vec();
    result.extend_from_slice(b"\xff\xe1");
    result.extend_from_slice(&u16::try_from(exif.len() + 2).unwrap().to_be_bytes());
    result.extend_from_slice(&exif);
    result.extend_from_slice(&bytes[2..]);
    fs::write(path, result).unwrap();
}

fn png_chunk(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut chunk = Vec::new();
    chunk.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    chunk.extend_from_slice(kind);
    chunk.extend_from_slice(payload);
    let mut checksum = kind.to_vec();
    checksum.extend_from_slice(payload);
    chunk.extend_from_slice(&crc32(&checksum).to_be_bytes());
    chunk
}

fn orient_png(path: &Path, orientation: u8) {
    let bytes = fs::read(path).unwrap();
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    let ihdr_end = 8 + 12 + 13;
    let mut result = bytes[..ihdr_end].to_vec();
    result.extend_from_slice(&png_chunk(b"eXIf", &private_tiff(orientation)));
    result.extend_from_slice(&png_chunk(b"tEXt", b"private-location"));
    result.extend_from_slice(&bytes[ihdr_end..]);
    fs::write(path, result).unwrap();
}

fn webp_chunk(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut chunk = Vec::new();
    chunk.extend_from_slice(kind);
    chunk.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    chunk.extend_from_slice(payload);
    if payload.len() & 1 == 1 {
        chunk.push(0);
    }
    chunk
}

fn orient_webp(path: &Path, orientation: u8) {
    let bytes = fs::read(path).unwrap();
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WEBP");
    let mut body = Vec::new();
    let mut vp8x = [0_u8; 10];
    vp8x[0] = 0b0000_1100;
    vp8x[4..7].copy_from_slice(&[3, 0, 0]);
    vp8x[7..10].copy_from_slice(&[1, 0, 0]);
    body.extend_from_slice(&webp_chunk(b"VP8X", &vp8x));
    body.extend_from_slice(&bytes[12..]);
    let mut exif = b"Exif\0\0".to_vec();
    exif.extend_from_slice(&private_tiff(orientation));
    body.extend_from_slice(&webp_chunk(b"EXIF", &exif));
    body.extend_from_slice(&webp_chunk(b"XMP ", b"private-location"));
    let mut result = b"RIFF".to_vec();
    result.extend_from_slice(&u32::try_from(body.len() + 4).unwrap().to_le_bytes());
    result.extend_from_slice(b"WEBP");
    result.extend_from_slice(&body);
    fs::write(path, result).unwrap();
}

#[derive(Clone, Copy)]
struct Atom {
    start: usize,
    payload: usize,
    end: usize,
    kind: [u8; 4],
}

fn children(bytes: &[u8], start: usize, end: usize) -> Vec<Atom> {
    let mut atoms = Vec::new();
    let mut at = start;
    while at < end {
        let size = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let kind = bytes[at + 4..at + 8].try_into().unwrap();
        let (payload, atom_end) = if size == 1 {
            let size = u64::from_be_bytes(bytes[at + 8..at + 16].try_into().unwrap()) as usize;
            (at + 16, at + size)
        } else if size == 0 {
            (at + 8, end)
        } else {
            (at + 8, at + size)
        };
        assert!(atom_end <= end && atom_end > at);
        atoms.push(Atom {
            start: at,
            payload,
            end: atom_end,
            kind,
        });
        at = atom_end;
    }
    atoms
}

fn one(bytes: &[u8], parent: Atom, kind: &[u8; 4]) -> Atom {
    children(bytes, parent.payload, parent.end)
        .into_iter()
        .find(|atom| atom.kind == *kind)
        .unwrap()
}

fn top(bytes: &[u8], kind: &[u8; 4]) -> Atom {
    children(bytes, 0, bytes.len())
        .into_iter()
        .find(|atom| atom.kind == *kind)
        .unwrap()
}

fn media_box(bytes: &[u8], handler: &[u8; 4]) -> Atom {
    let moov = top(bytes, b"moov");
    for trak in children(bytes, moov.payload, moov.end)
        .into_iter()
        .filter(|atom| atom.kind == *b"trak")
    {
        let mdia = one(bytes, trak, b"mdia");
        let hdlr = one(bytes, mdia, b"hdlr");
        if &bytes[hdlr.payload + 8..hdlr.payload + 12] == handler {
            return mdia;
        }
    }
    panic!("missing media handler")
}

fn nested_sample_table(bytes: &[u8], handler: &[u8; 4]) -> Atom {
    let mdia = media_box(bytes, handler);
    let minf = one(bytes, mdia, b"minf");
    one(bytes, minf, b"stbl")
}

fn replace_box_kind(bytes: &mut [u8], kind: &[u8; 4]) {
    let at = bytes
        .windows(4)
        .position(|window| window == kind)
        .expect("fixture box exists");
    bytes[at..at + 4].copy_from_slice(b"free");
}

fn canonical_video() -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../benchmarks/fixtures/social-messenger/media/vid-01.mp4"),
    )
    .unwrap()
}

#[test]
fn capabilities_are_exact_and_fixture_qualified() {
    let output = run(&["capabilities"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        one_line(&output),
        json!({
            "protocol":"snapback3-media/1",
            "images":true,
            "video":true,
            "imageTypes":["image/jpeg","image/png","image/webp"],
            "videoTypes":["video/mp4"]
        })
    );
}

#[test]
fn real_decoders_preserve_orientation_two_through_eight_and_strip_location() {
    let root = TempRoot::new("oriented-images");
    for orientation in 2..=8 {
        let source = root.0.join(format!("orientation-{orientation}.jpg"));
        let destination = root.0.join(format!("orientation-{orientation}.out"));
        write_pixels(&source, image::ImageFormat::Jpeg);
        orient_jpeg(&source, orientation);
        let (output, facts) = validate("image", &source, &destination);
        assert!(
            output.status.success(),
            "orientation {orientation}: {facts}"
        );
        let expected = if orientation >= 5 { (2, 4) } else { (4, 2) };
        assert_eq!(
            (facts["width"].as_u64(), facts["height"].as_u64()),
            (Some(expected.0), Some(expected.1))
        );
        assert_eq!(decoded_dimensions(&destination), (4, 2));
        let bytes = fs::read(&destination).unwrap();
        assert!(
            !bytes
                .windows(16)
                .any(|window| window == b"private-location")
        );
        assert!(!bytes.windows(2).any(|window| window == [0x25, 0x88]));
    }

    for (name, format, orientation, orient, expected_type) in [
        (
            "control.png",
            image::ImageFormat::Png,
            6,
            orient_png as fn(&Path, u8),
            "image/png",
        ),
        (
            "control.webp",
            image::ImageFormat::WebP,
            8,
            orient_webp as fn(&Path, u8),
            "image/webp",
        ),
    ] {
        let source = root.0.join(name);
        let destination = root.0.join(format!("{name}.out"));
        write_pixels(&source, format);
        orient(&source, orientation);
        let (output, facts) = validate("image", &source, &destination);
        assert!(output.status.success(), "{name}: {facts}");
        assert_eq!(facts["type"], expected_type);
        assert_eq!(
            (facts["width"].as_u64(), facts["height"].as_u64()),
            (Some(2), Some(4))
        );
        assert_eq!(decoded_dimensions(&destination), (4, 2));
        let bytes = fs::read(&destination).unwrap();
        assert!(
            !bytes
                .windows(16)
                .any(|window| window == b"private-location")
        );
        assert!(!bytes.windows(2).any(|window| window == [0x25, 0x88]));
    }
}

#[test]
fn canonical_and_portrait_transform_mp4_are_accepted_by_the_real_helper() {
    let root = TempRoot::new("valid-video");
    let canonical = root.0.join("canonical.mp4");
    fs::write(&canonical, canonical_video()).unwrap();
    let destination = root.0.join("canonical.out");
    let (output, facts) = validate("video", &canonical, &destination);
    assert!(output.status.success(), "{facts}");
    assert_eq!(facts["type"], "video/mp4");
    assert_eq!(
        (facts["width"].as_u64(), facts["height"].as_u64()),
        (Some(320), Some(240))
    );
    assert_eq!(facts["duration"], 5_000);

    let mut portrait_bytes = canonical_video();
    let video_mdia = media_box(&portrait_bytes, b"vide");
    let moov = top(&portrait_bytes, b"moov");
    let video_trak = children(&portrait_bytes, moov.payload, moov.end)
        .into_iter()
        .find(|trak| {
            trak.kind == *b"trak" && one(&portrait_bytes, *trak, b"mdia").start == video_mdia.start
        })
        .unwrap();
    let tkhd = one(&portrait_bytes, video_trak, b"tkhd");
    let matrix = tkhd.payload
        + if portrait_bytes[tkhd.payload] == 0 {
            40
        } else {
            52
        };
    for (index, value) in [0_i32, 0x0001_0000, 0, -0x0001_0000, 0, 0, 0, 0, 0x4000_0000]
        .into_iter()
        .enumerate()
    {
        portrait_bytes[matrix + index * 4..matrix + index * 4 + 4]
            .copy_from_slice(&value.to_be_bytes());
    }
    let portrait = root.0.join("portrait.mp4");
    fs::write(&portrait, portrait_bytes).unwrap();
    let portrait_output = root.0.join("portrait.out");
    let (output, facts) = validate("video", &portrait, &portrait_output);
    assert!(output.status.success(), "{facts}");
    assert_eq!(
        (facts["width"].as_u64(), facts["height"].as_u64()),
        (Some(240), Some(320))
    );
}

#[test]
fn malformed_structural_mp4_corpus_is_refused_without_output() {
    let root = TempRoot::new("malformed-video");
    let canonical = canonical_video();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("missing-avcc", {
            let mut bytes = canonical.clone();
            replace_box_kind(&mut bytes, b"avcC");
            bytes
        }),
        ("missing-esds", {
            let mut bytes = canonical.clone();
            replace_box_kind(&mut bytes, b"esds");
            bytes
        }),
        ("malformed-avcc", {
            let mut bytes = canonical.clone();
            let kind = bytes
                .windows(4)
                .position(|window| window == b"avcC")
                .unwrap();
            bytes[kind + 4] = 0;
            bytes
        }),
        ("non-aac-decoder-configuration", {
            let mut bytes = canonical.clone();
            let marker = b"\x04\x80\x80\x80\x17\x40";
            let descriptor = bytes
                .windows(marker.len())
                .position(|window| window == marker)
                .unwrap();
            bytes[descriptor + marker.len() - 1] = 0x20;
            bytes
        }),
        ("chunk-outside-mdat", {
            let mut bytes = canonical.clone();
            let stbl = nested_sample_table(&bytes, b"vide");
            let stco = one(&bytes, stbl, b"stco");
            bytes[stco.payload + 8..stco.payload + 12].copy_from_slice(&1_u32.to_be_bytes());
            bytes
        }),
        ("inconsistent-sample-timing", {
            let mut bytes = canonical.clone();
            let stbl = nested_sample_table(&bytes, b"vide");
            let stts = one(&bytes, stbl, b"stts");
            let count = u32::from_be_bytes(
                bytes[stts.payload + 8..stts.payload + 12]
                    .try_into()
                    .unwrap(),
            );
            bytes[stts.payload + 8..stts.payload + 12]
                .copy_from_slice(&count.saturating_add(1).to_be_bytes());
            bytes
        }),
        ("overlong-track-under-short-movie", {
            let mut bytes = canonical.clone();
            let mdia = media_box(&bytes, b"vide");
            let mdhd = one(&bytes, mdia, b"mdhd");
            let timescale = mdhd.payload + if bytes[mdhd.payload] == 0 { 12 } else { 20 };
            bytes[timescale..timescale + 4].copy_from_slice(&1_u32.to_be_bytes());
            bytes
        }),
    ];
    for (name, bytes) in cases {
        let source = root.0.join(format!("{name}.mp4"));
        let destination = root.0.join(format!("{name}.out"));
        fs::write(&source, bytes).unwrap();
        let (output, refusal) = validate("video", &source, &destination);
        assert!(
            !output.status.success(),
            "{name} unexpectedly passed: {refusal}"
        );
        assert!(
            matches!(
                refusal["code"].as_str(),
                Some("E_ASSET_TYPE" | "E_ASSET_TOO_LARGE")
            ),
            "{name}: {refusal}"
        );
        assert!(!destination.exists(), "{name} left a publishable output");
    }
}

#[test]
fn exact_pre_fix_no_mdat_derivative_is_now_refused() {
    let root = TempRoot::new("missing-mdat");
    let canonical = canonical_video();
    let mut without_mdat = Vec::new();
    for atom in children(&canonical, 0, canonical.len()) {
        if atom.kind != *b"mdat" {
            without_mdat.extend_from_slice(&canonical[atom.start..atom.end]);
        }
    }
    assert_eq!(without_mdat.len(), 6_241);
    let source = root.0.join("no-mdat.mp4");
    let destination = root.0.join("no-mdat.out");
    fs::write(&source, without_mdat).unwrap();
    let (output, refusal) = validate("video", &source, &destination);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(refusal["code"], "E_ASSET_TYPE");
    assert!(refusal["message"].as_str().unwrap().contains("media-data"));
    assert!(!destination.exists());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & 0_u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}
