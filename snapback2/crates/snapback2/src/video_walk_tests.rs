use crate::video_walk::{Ceilings, DEFAULT_CEILINGS, VideoFacts, walk_and_strip};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const GPS: &str = "+37.7749-122.4194/";
const IDENTITY: [i32; 4] = [0x0001_0000, 0, 0, 0x0001_0000];
const ROTATE_90: [i32; 4] = [0, 0x0001_0000, -0x0001_0000, 0];
const ROTATE_270: [i32; 4] = [0, -0x0001_0000, 0x0001_0000, 0];
const XMP_UUID: [u8; 16] = [
    0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC,
];

struct StagingFile {
    path: PathBuf,
}

impl StagingFile {
    fn new(bytes: &[u8]) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let sequence = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "snapback2-video-walk-{}-{sequence}.mov",
            std::process::id()
        ));
        fs::write(&path, bytes).unwrap();
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn bytes(&self) -> Vec<u8> {
        fs::read(&self.path).unwrap()
    }
}

impl Drop for StagingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    out
}

fn largesize_box(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = 1u32.to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(&((payload.len() + 16) as u64).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

fn ftyp(major: &[u8; 4], compatible: &[[u8; 4]]) -> Vec<u8> {
    let mut payload = major.to_vec();
    payload.extend_from_slice(&0u32.to_be_bytes());
    for brand in compatible {
        payload.extend_from_slice(brand);
    }
    boxed(b"ftyp", &payload)
}

fn mp4_ftyp() -> Vec<u8> {
    ftyp(b"isom", &[*b"isom", *b"mp42"])
}

fn quicktime_ftyp() -> Vec<u8> {
    ftyp(b"qt  ", &[*b"qt  "])
}

fn mvhd(timescale: u32, duration: u32) -> Vec<u8> {
    let mut payload = vec![0u8; 100];
    payload[12..16].copy_from_slice(&timescale.to_be_bytes());
    payload[16..20].copy_from_slice(&duration.to_be_bytes());
    boxed(b"mvhd", &payload)
}

fn tkhd(width: u32, height: u32, matrix: [i32; 4]) -> Vec<u8> {
    let mut payload = vec![0u8; 84];
    payload[40..44].copy_from_slice(&matrix[0].to_be_bytes());
    payload[44..48].copy_from_slice(&matrix[1].to_be_bytes());
    payload[52..56].copy_from_slice(&matrix[2].to_be_bytes());
    payload[56..60].copy_from_slice(&matrix[3].to_be_bytes());
    payload[76..80].copy_from_slice(&(width << 16).to_be_bytes());
    payload[80..84].copy_from_slice(&(height << 16).to_be_bytes());
    boxed(b"tkhd", &payload)
}

fn video_moov(width: u32, height: u32, matrix: [i32; 4]) -> Vec<u8> {
    let trak = boxed(b"trak", &tkhd(width, height, matrix));
    boxed(b"moov", &[mvhd(1000, 2000), trak].concat())
}

fn xyz_atom() -> Vec<u8> {
    let mut payload = (GPS.len() as u16).to_be_bytes().to_vec();
    payload.extend_from_slice(&0x15C7u16.to_be_bytes());
    payload.extend_from_slice(GPS.as_bytes());
    boxed(&[0xA9, b'x', b'y', b'z'], &payload)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn assert_facts(facts: VideoFacts, detected_type: &str, width: u32, height: u32) {
    assert_eq!(facts.detected_type, detected_type);
    assert_eq!(facts.duration_ms, 2000);
    assert_eq!(facts.width, width);
    assert_eq!(facts.height, height);
}

fn assert_type_refusal(result: Result<VideoFacts, crate::protocol::Refusal>, message: &str) {
    let refusal = result.unwrap_err();
    assert_eq!(refusal.code, "E_ASSET_TYPE");
    assert_eq!(refusal.family, "input");
    assert!(
        refusal.message.contains(message),
        "expected {:?} in {:?}",
        message,
        refusal.message
    );
}

fn mdta_location_meta(direct_quicktime_children: bool) -> Vec<u8> {
    let hdlr = boxed(b"hdlr", &[0u8; 24]);
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
    let location = boxed(&1u32.to_be_bytes(), GPS.as_bytes());
    let model = boxed(&2u32.to_be_bytes(), b"Snapback Cam");
    let ilst = boxed(b"ilst", &[location, model].concat());
    let mut payload = Vec::new();
    if !direct_quicktime_children {
        payload.extend_from_slice(&0u32.to_be_bytes());
    }
    payload.extend_from_slice(&hdlr);
    payload.extend_from_slice(&keys);
    payload.extend_from_slice(&ilst);
    boxed(b"meta", &payload)
}

#[test]
fn strips_udta_xyz_and_loci_in_place_without_moving_media() {
    let loci = boxed(b"loci", b"\x00\x00\x15\xC7somewhere");
    let udta = boxed(b"udta", &[xyz_atom(), loci].concat());
    let trak = boxed(b"trak", &tkhd(640, 480, IDENTITY));
    let moov = boxed(b"moov", &[mvhd(1000, 2000), trak, udta].concat());
    let mdat = boxed(b"mdat", b"media bytes and offsets stay exactly here");
    let source = [mp4_ftyp(), moov, mdat.clone()].concat();
    let staging = StagingFile::new(&source);
    let before = fs::metadata(staging.path()).unwrap();

    let facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let after = fs::metadata(staging.path()).unwrap();
    let canonical = staging.bytes();
    assert_facts(facts, "video/mp4", 640, 480);
    assert_eq!(before.len(), after.len());
    assert_eq!(canonical.len(), source.len());
    assert!(!contains(&canonical, GPS.as_bytes()));
    assert!(!contains(&canonical, b"somewhere"));
    assert!(!contains(&canonical, &[0xA9, b'x', b'y', b'z']));
    assert!(!contains(&canonical, b"loci"));
    assert_eq!(&canonical[canonical.len() - mdat.len()..], mdat);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(before.ino(), after.ino(), "staging inode must not change");
    }
}

#[test]
fn strips_quicktime_meta_in_moov_last_layout_and_preserves_co64() {
    let mut co64_payload = 0u32.to_be_bytes().to_vec();
    co64_payload.extend_from_slice(&1u32.to_be_bytes());
    co64_payload.extend_from_slice(&64u64.to_be_bytes());
    let co64 = boxed(b"co64", &co64_payload);
    let stbl = boxed(b"stbl", &co64);
    let minf = boxed(b"minf", &stbl);
    let mdia = boxed(b"mdia", &minf);
    let trak = boxed(b"trak", &[tkhd(1920, 1080, IDENTITY), mdia].concat());
    let udta = boxed(b"udta", &mdta_location_meta(true));
    let moov = boxed(b"moov", &[mvhd(1000, 2000), trak, udta].concat());
    let mut source = quicktime_ftyp();
    source.extend_from_slice(&boxed(b"wide", &[]));
    source.extend_from_slice(&largesize_box(b"mdat", &[0xAA, 0xBB, 0, 0, 0, 0]));
    source.extend_from_slice(&moov);
    source.extend_from_slice(&[0u8; 7]);
    let staging = StagingFile::new(&source);

    let facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let canonical = staging.bytes();
    assert_facts(facts, "video/quicktime", 1920, 1080);
    let gps_at = source
        .windows(GPS.len())
        .position(|window| window == GPS.as_bytes())
        .unwrap();
    assert_eq!(&canonical[gps_at - 4..gps_at], b"free");
    assert!(!contains(&canonical, GPS.as_bytes()));
    assert!(contains(&canonical, b"Snapback Cam"));
    assert!(contains(&canonical, b"co64"));
    assert_eq!(&canonical[canonical.len() - 7..], &[0u8; 7]);
}

#[test]
fn iso_fullbox_meta_and_xmp_uuid_are_blanked() {
    let meta = mdta_location_meta(false);
    let mut xmp_payload = XMP_UUID.to_vec();
    xmp_payload.extend_from_slice(b"<x:xmpmeta>gps here</x:xmpmeta>");
    let xmp = boxed(b"uuid", &xmp_payload);
    let trak = boxed(b"trak", &tkhd(800, 600, IDENTITY));
    let moov = boxed(b"moov", &[mvhd(1000, 2000), trak, meta, xmp].concat());
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());

    walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let canonical = staging.bytes();
    assert!(!contains(&canonical, GPS.as_bytes()));
    assert!(!contains(&canonical, b"xmpmeta"));
}

#[test]
fn refuses_unclassified_uuid_without_modifying_the_file() {
    let mut unknown_payload = [0x11u8; 16].to_vec();
    unknown_payload.extend_from_slice(b"vendor mystery");
    let unknown = boxed(b"uuid", &unknown_payload);
    let source = [mp4_ftyp(), video_moov(640, 480, IDENTITY), unknown].concat();
    let staging = StagingFile::new(&source);

    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "unclassified uuid metadata box",
    );
    assert_eq!(staging.bytes(), source);
}

#[test]
fn applies_tkhd_matrix_to_portrait_and_landscape_display_dimensions() {
    let portrait =
        StagingFile::new(&[quicktime_ftyp(), video_moov(1920, 1080, ROTATE_90)].concat());
    let portrait_270 =
        StagingFile::new(&[quicktime_ftyp(), video_moov(1920, 1080, ROTATE_270)].concat());
    let landscape = StagingFile::new(&[mp4_ftyp(), video_moov(1920, 1080, IDENTITY)].concat());

    assert_facts(
        walk_and_strip(portrait.path(), &DEFAULT_CEILINGS).unwrap(),
        "video/quicktime",
        1080,
        1920,
    );
    assert_facts(
        walk_and_strip(portrait_270.path(), &DEFAULT_CEILINGS).unwrap(),
        "video/quicktime",
        1080,
        1920,
    );
    assert_facts(
        walk_and_strip(landscape.path(), &DEFAULT_CEILINGS).unwrap(),
        "video/mp4",
        1920,
        1080,
    );
}

#[test]
fn refuses_audio_only_and_missing_or_zero_movie_facts() {
    let audio_track = boxed(b"trak", &tkhd(0, 0, IDENTITY));
    let audio_only = StagingFile::new(
        &[
            mp4_ftyp(),
            boxed(b"moov", &[mvhd(1000, 2000), audio_track].concat()),
        ]
        .concat(),
    );
    assert_type_refusal(
        walk_and_strip(audio_only.path(), &DEFAULT_CEILINGS),
        "no video tkhd",
    );

    for (timescale, duration) in [(0, 2000), (1000, 0)] {
        let trak = boxed(b"trak", &tkhd(640, 480, IDENTITY));
        let moov = boxed(b"moov", &[mvhd(timescale, duration), trak].concat());
        let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());
        assert_type_refusal(
            walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
            "non-zero mvhd timescale and duration",
        );
    }

    let missing_mvhd =
        StagingFile::new(&[mp4_ftyp(), boxed(b"moov", &tkhd(640, 480, IDENTITY))].concat());
    assert_type_refusal(
        walk_and_strip(missing_mvhd.path(), &DEFAULT_CEILINGS),
        "non-zero mvhd timescale and duration",
    );
}

#[test]
fn refuses_depth_and_metadata_payload_bombs_with_v1_vocabulary() {
    let tiny = Ceilings {
        max_box_depth: 3,
        max_box_count: 64,
        max_metadata_bytes: 64,
        step_time_budget_ms: 10_000,
        max_parse_bytes: 1024 * 1024,
    };
    let mut meta_payload = vec![0u8; 4];
    meta_payload.extend_from_slice(&boxed(b"ilst", &[]));
    let deep = boxed(
        b"moov",
        &boxed(b"trak", &boxed(b"udta", &boxed(b"meta", &meta_payload))),
    );
    let depth_bomb = StagingFile::new(&[mp4_ftyp(), deep].concat());
    assert_type_refusal(
        walk_and_strip(depth_bomb.path(), &tiny),
        "box nesting exceeds the 3 ceiling",
    );

    let fat_udta = boxed(b"udta", &[0u8; 128]);
    let metadata_bomb = StagingFile::new(&[mp4_ftyp(), boxed(b"moov", &fat_udta)].concat());
    assert_type_refusal(
        walk_and_strip(metadata_bomb.path(), &tiny),
        "container metadata exceeds the 64 byte ceiling",
    );
}

#[test]
fn refuses_box_count_file_size_and_unsupported_brand() {
    let tiny = Ceilings {
        max_box_count: 8,
        max_parse_bytes: 1024 * 1024,
        ..DEFAULT_CEILINGS
    };
    let mut many = mp4_ftyp();
    for _ in 0..16 {
        many.extend_from_slice(&boxed(b"free", &[]));
    }
    let count_bomb = StagingFile::new(&many);
    assert_type_refusal(
        walk_and_strip(count_bomb.path(), &tiny),
        "box count exceeds the 8 ceiling",
    );

    let capped = Ceilings {
        max_parse_bytes: 16,
        ..DEFAULT_CEILINGS
    };
    let too_large = StagingFile::new(&[mp4_ftyp(), video_moov(640, 480, IDENTITY)].concat());
    assert_type_refusal(
        walk_and_strip(too_large.path(), &capped),
        "container exceeds the 16 byte processing ceiling",
    );

    let heic = StagingFile::new(&ftyp(b"heic", &[*b"heic"]));
    assert_type_refusal(
        walk_and_strip(heic.path(), &DEFAULT_CEILINGS),
        "is not a supported strip target",
    );
}

#[test]
fn malformed_structures_refuse_before_any_recorded_blank_is_applied() {
    let mut source = mp4_ftyp();
    source.extend_from_slice(&boxed(
        b"moov",
        &[
            mvhd(1000, 2000),
            boxed(b"trak", &tkhd(640, 480, IDENTITY)),
            boxed(b"udta", &xyz_atom()),
        ]
        .concat(),
    ));
    source.extend_from_slice(&64u32.to_be_bytes());
    source.extend_from_slice(b"moov");
    let staging = StagingFile::new(&source);

    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "declares a size beyond its container",
    );
    assert_eq!(staging.bytes(), source, "validation precedes all blanking");

    let mut nested_zero = 0u32.to_be_bytes().to_vec();
    nested_zero.extend_from_slice(b"udta");
    let invalid = StagingFile::new(&[mp4_ftyp(), boxed(b"moov", &nested_zero)].concat());
    assert_type_refusal(
        walk_and_strip(invalid.path(), &DEFAULT_CEILINGS),
        "uses size 0 inside a container",
    );
}

#[test]
fn admits_top_level_size_zero_mdat_as_the_last_box() {
    let mut mdat = 0u32.to_be_bytes().to_vec();
    mdat.extend_from_slice(b"mdat");
    mdat.extend_from_slice(b"unchanged media payload");
    let source = [mp4_ftyp(), video_moov(640, 480, IDENTITY), mdat].concat();
    let staging = StagingFile::new(&source);

    let facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    assert_facts(facts, "video/mp4", 640, 480);
    assert_eq!(staging.bytes(), source);
}
