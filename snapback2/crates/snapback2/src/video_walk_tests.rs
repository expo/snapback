use crate::video_walk::{Ceilings, DEFAULT_CEILINGS, VideoFacts, walk_and_strip};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const GPS: &str = "+37.7749-122.4194/";
const IDENTITY: [i32; 4] = [0x0001_0000, 0, 0, 0x0001_0000];
const ROTATE_90: [i32; 4] = [0, 0x0001_0000, -0x0001_0000, 0];
const ROTATE_180: [i32; 4] = [-0x0001_0000, 0, 0, -0x0001_0000];
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
    mvhd_with_version(u64::from(timescale), u64::from(duration), 0)
}

fn mvhd_with_version(timescale: u64, duration: u64, version: u8) -> Vec<u8> {
    let mut payload = vec![0u8; 100];
    payload[0] = version;
    match version {
        0 => {
            payload[12..16].copy_from_slice(&(timescale as u32).to_be_bytes());
            payload[16..20].copy_from_slice(&(duration as u32).to_be_bytes());
        }
        1 => {
            payload[20..24].copy_from_slice(&(timescale as u32).to_be_bytes());
            payload[24..32].copy_from_slice(&duration.to_be_bytes());
        }
        _ => unreachable!(),
    }
    boxed(b"mvhd", &payload)
}

fn tkhd(width: u32, height: u32, matrix: [i32; 4]) -> Vec<u8> {
    tkhd_with_terms(width, height, matrix, 0, 0, 0x4000_0000, 0)
}

fn tkhd_with_terms(
    width: u32,
    height: u32,
    matrix: [i32; 4],
    u: i32,
    v: i32,
    w: i32,
    version: u8,
) -> Vec<u8> {
    let matrix_at = if version == 0 { 40 } else { 52 };
    let mut payload = vec![0u8; matrix_at + 44];
    payload[0] = version;
    payload[matrix_at..matrix_at + 4].copy_from_slice(&matrix[0].to_be_bytes());
    payload[matrix_at + 4..matrix_at + 8].copy_from_slice(&matrix[1].to_be_bytes());
    payload[matrix_at + 8..matrix_at + 12].copy_from_slice(&u.to_be_bytes());
    payload[matrix_at + 12..matrix_at + 16].copy_from_slice(&matrix[2].to_be_bytes());
    payload[matrix_at + 16..matrix_at + 20].copy_from_slice(&matrix[3].to_be_bytes());
    payload[matrix_at + 20..matrix_at + 24].copy_from_slice(&v.to_be_bytes());
    payload[matrix_at + 32..matrix_at + 36].copy_from_slice(&w.to_be_bytes());
    payload[matrix_at + 36..matrix_at + 40].copy_from_slice(&(width << 16).to_be_bytes());
    payload[matrix_at + 40..matrix_at + 44].copy_from_slice(&(height << 16).to_be_bytes());
    boxed(b"tkhd", &payload)
}

fn hdlr(handler_type: &[u8; 4]) -> Vec<u8> {
    let mut payload = vec![0u8; 24];
    payload[8..12].copy_from_slice(handler_type);
    boxed(b"hdlr", &payload)
}

fn track(handler_type: &[u8; 4], tkhd: Vec<u8>, mdia_tail: &[u8]) -> Vec<u8> {
    let mut mdia_payload = hdlr(handler_type);
    mdia_payload.extend_from_slice(mdia_tail);
    let mdia = boxed(b"mdia", &mdia_payload);
    boxed(b"trak", &[tkhd, mdia].concat())
}

fn video_track(width: u32, height: u32, matrix: [i32; 4]) -> Vec<u8> {
    track(b"vide", tkhd(width, height, matrix), &[])
}

fn video_moov(width: u32, height: u32, matrix: [i32; 4]) -> Vec<u8> {
    let trak = video_track(width, height, matrix);
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

fn mdta_keys(names: &[&[u8]]) -> Vec<u8> {
    let mut payload = 0u32.to_be_bytes().to_vec();
    payload.extend_from_slice(&(names.len() as u32).to_be_bytes());
    for name in names {
        payload.extend_from_slice(&((name.len() + 8) as u32).to_be_bytes());
        payload.extend_from_slice(b"mdta");
        payload.extend_from_slice(name);
    }
    boxed(b"keys", &payload)
}

fn mdta_location_meta(direct_quicktime_children: bool) -> Vec<u8> {
    let hdlr = boxed(b"hdlr", &[0u8; 24]);
    let keys = mdta_keys(&[
        b"com.apple.quicktime.location.ISO6709",
        b"com.apple.quicktime.model",
    ]);
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
    let trak = video_track(640, 480, IDENTITY);
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
    let trak = track(b"vide", tkhd(1920, 1080, IDENTITY), &minf);
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
    let trak = video_track(800, 600, IDENTITY);
    let moov = boxed(b"moov", &[mvhd(1000, 2000), trak, meta, xmp].concat());
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());

    let facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let canonical = staging.bytes();
    assert_facts(facts, "video/mp4", 800, 600);
    assert!(!contains(&canonical, GPS.as_bytes()));
    assert!(!contains(&canonical, b"xmpmeta"));
}

#[test]
fn retry_blanks_a_free_box_with_a_nonzero_location_payload() {
    let torn_location = boxed(b"free", &xyz_atom()[8..]);
    let udta = boxed(b"udta", &torn_location);
    let moov = boxed(
        b"moov",
        &[mvhd(1000, 2000), video_track(640, 480, IDENTITY), udta].concat(),
    );
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());

    let facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let canonical = staging.bytes();
    assert_facts(facts, "video/mp4", 640, 480);
    assert!(!contains(&canonical, GPS.as_bytes()));
    let free_at = canonical
        .windows(4)
        .position(|window| window == b"free")
        .unwrap();
    assert!(
        canonical[free_at + 4..free_at + torn_location.len() - 4]
            .iter()
            .all(|byte| *byte == 0)
    );
}

#[test]
fn retry_recognizes_a_torn_xmp_uuid_zero() {
    let mut torn_xmp_type = XMP_UUID;
    torn_xmp_type[..7].fill(0);
    let mut payload = torn_xmp_type.to_vec();
    payload.extend_from_slice(b"<x:xmpmeta>location remains</x:xmpmeta>");
    let source = [
        mp4_ftyp(),
        video_moov(640, 480, IDENTITY),
        boxed(b"uuid", &payload),
    ]
    .concat();
    let staging = StagingFile::new(&source);

    let facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let canonical = staging.bytes();
    assert_facts(facts, "video/mp4", 640, 480);
    assert!(!contains(&canonical, b"location remains"));
    assert!(!contains(&canonical, b"uuid"));
}

#[test]
fn a_second_walk_of_a_fully_stripped_file_is_idempotent() {
    let udta = boxed(b"udta", &xyz_atom());
    let moov = boxed(
        b"moov",
        &[mvhd(1000, 2000), video_track(640, 480, IDENTITY), udta].concat(),
    );
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());

    let first_facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let first_bytes = staging.bytes();
    let second_facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    let second_bytes = staging.bytes();

    assert_eq!(second_facts, first_facts);
    assert_eq!(second_bytes, first_bytes);
}

#[test]
fn meta_location_keys_without_ilst_refuse() {
    let mut meta_payload = 0u32.to_be_bytes().to_vec();
    meta_payload.extend_from_slice(&mdta_keys(&[b"com.apple.quicktime.location.ISO6709"]));
    let meta = boxed(b"meta", &meta_payload);
    let moov = boxed(
        b"moov",
        &[mvhd(1000, 2000), video_track(640, 480, IDENTITY), meta].concat(),
    );
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());

    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "meta declares location keys but carries no parseable ilst",
    );
}

#[test]
fn streaming_location_key_match_across_an_8kib_boundary_is_blanked() {
    let mut boundary_name = vec![b'x'; 8188];
    boundary_name.extend_from_slice(b"location");
    let keys = mdta_keys(&[&boundary_name]);
    let ilst = boxed(b"ilst", &boxed(&1u32.to_be_bytes(), GPS.as_bytes()));
    let mut meta_payload = 0u32.to_be_bytes().to_vec();
    meta_payload.extend_from_slice(&keys);
    meta_payload.extend_from_slice(&ilst);
    let meta = boxed(b"meta", &meta_payload);
    let moov = boxed(
        b"moov",
        &[mvhd(1000, 2000), video_track(640, 480, IDENTITY), meta].concat(),
    );
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());

    let facts = walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap();
    assert_facts(facts, "video/mp4", 640, 480);
    assert!(!contains(&staging.bytes(), GPS.as_bytes()));
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
fn uuid_shorter_than_its_16_byte_extended_type_refuses() {
    let source = [
        mp4_ftyp(),
        video_moov(640, 480, IDENTITY),
        boxed(b"uuid", &[0u8; 15]),
    ]
    .concat();
    let staging = StagingFile::new(&source);

    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "uuid box smaller than its extended type",
    );
    assert_eq!(staging.bytes(), source);
}

#[test]
fn xmp_uuid_payload_is_charged_to_the_metadata_ceiling() {
    let mut xmp_payload = XMP_UUID.to_vec();
    xmp_payload.extend_from_slice(&[b'x'; 64]);
    let source = [
        mp4_ftyp(),
        video_moov(640, 480, IDENTITY),
        boxed(b"uuid", &xmp_payload),
    ]
    .concat();
    let staging = StagingFile::new(&source);
    let tiny = Ceilings {
        max_metadata_bytes: 32,
        ..DEFAULT_CEILINGS
    };

    assert_type_refusal(
        walk_and_strip(staging.path(), &tiny),
        "container metadata exceeds the 32 byte ceiling",
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
fn valid_affine_w_one_passes() {
    let trak = track(
        b"vide",
        tkhd_with_terms(1920, 1080, IDENTITY, 0, 0, 0x4000_0000, 0),
        &[],
    );
    let moov = boxed(b"moov", &[mvhd(1000, 2000), trak].concat());
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());
    assert_facts(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap(),
        "video/mp4",
        1920,
        1080,
    );
}

#[test]
fn a_180_degree_matrix_does_not_swap_extents() {
    let trak = track(
        b"vide",
        tkhd_with_terms(1920, 1080, ROTATE_180, 0, 0, 0x4000_0000, 0),
        &[],
    );
    let moov = boxed(b"moov", &[mvhd(1000, 2000), trak].concat());
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());
    assert_facts(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap(),
        "video/mp4",
        1920,
        1080,
    );
}

#[test]
fn projective_terms_and_singular_tkhd_matrices_refuse() {
    for (matrix, u, v, w, message) in [
        (IDENTITY, 1, 0, 0x4000_0000, "projective"),
        (IDENTITY, 0, 1, 0x4000_0000, "projective"),
        (IDENTITY, 0, 0, 0x3fff_ffff, "projective"),
        (
            [0x0001_0000, 0x0001_0000, 0x0001_0000, 0x0001_0000],
            0,
            0,
            0x4000_0000,
            "singular",
        ),
    ] {
        let trak = track(
            b"vide",
            tkhd_with_terms(1920, 1080, matrix, u, v, w, 0),
            &[],
        );
        let moov = boxed(b"moov", &[mvhd(1000, 2000), trak].concat());
        let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());
        assert_type_refusal(walk_and_strip(staging.path(), &DEFAULT_CEILINGS), message);
    }
}

#[test]
fn version_one_mvhd_and_tkhd_are_parsed() {
    let trak = track(
        b"vide",
        tkhd_with_terms(1080, 1920, IDENTITY, 0, 0, 0x4000_0000, 1),
        &[],
    );
    let moov = boxed(b"moov", &[mvhd_with_version(1000, 2000, 1), trak].concat());
    let staging = StagingFile::new(&[quicktime_ftyp(), moov].concat());

    assert_facts(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap(),
        "video/quicktime",
        1080,
        1920,
    );
}

#[test]
fn refuses_audio_only_and_missing_or_zero_movie_facts() {
    let audio_track = track(b"soun", tkhd(0, 0, IDENTITY), &[]);
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
        let trak = video_track(640, 480, IDENTITY);
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
fn mvhd_inside_udta_refuses() {
    let nested_mvhd = boxed(b"udta", &mvhd(1000, 2000));
    let moov = boxed(
        b"moov",
        &[nested_mvhd, video_track(640, 480, IDENTITY)].concat(),
    );
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());
    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "non-zero mvhd timescale and duration",
    );
}

#[test]
fn audio_only_file_with_nonzero_tkhd_refuses() {
    let adversarial_audio = track(b"soun", tkhd(4096, 2160, IDENTITY), &[]);
    let audio_moov = boxed(b"moov", &[mvhd(1000, 2000), adversarial_audio].concat());
    let audio = StagingFile::new(&[mp4_ftyp(), audio_moov].concat());
    assert_type_refusal(
        walk_and_strip(audio.path(), &DEFAULT_CEILINGS),
        "no video tkhd",
    );
}

#[test]
fn audio_track_before_video_track_uses_the_video_dimensions() {
    let audio = track(b"soun", tkhd(4096, 2160, IDENTITY), &[]);
    let video = video_track(1280, 720, IDENTITY);
    let moov = boxed(b"moov", &[mvhd(1000, 2000), audio, video].concat());
    let staging = StagingFile::new(&[mp4_ftyp(), moov].concat());

    assert_facts(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS).unwrap(),
        "video/mp4",
        1280,
        720,
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
fn oversized_ftyp_refuses_fast_before_scanning_compatible_brands() {
    let mut payload = b"zzzz".to_vec();
    payload.extend_from_slice(&0u32.to_be_bytes());
    payload.resize(64 * 1024, b'x');
    payload.extend_from_slice(b"isom");
    let staging = StagingFile::new(&boxed(b"ftyp", &payload));

    let started = Instant::now();
    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "ftyp exceeds the 65536 byte processing ceiling",
    );
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "oversized ftyp should refuse without scanning every brand"
    );
}

#[test]
fn top_level_zero_probe_is_bounded_and_long_padding_refuses() {
    let mut source = [mp4_ftyp(), video_moov(640, 480, IDENTITY)].concat();
    source.extend_from_slice(&vec![0u8; 8193]);
    let staging = StagingFile::new(&source);

    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "top-level trailing zero padding exceeds the 8192 byte ceiling",
    );
}

#[test]
fn malformed_structures_refuse_before_any_recorded_blank_is_applied() {
    let mut source = mp4_ftyp();
    source.extend_from_slice(&boxed(
        b"moov",
        &[
            mvhd(1000, 2000),
            video_track(640, 480, IDENTITY),
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
fn truncated_top_level_tail_refuses() {
    let mut source = [mp4_ftyp(), video_moov(640, 480, IDENTITY)].concat();
    source.extend_from_slice(&[0, 0, 0, 8, b'f']);
    let staging = StagingFile::new(&source);

    assert_type_refusal(
        walk_and_strip(staging.path(), &DEFAULT_CEILINGS),
        "truncated box header",
    );
}

#[test]
fn staging_io_failures_use_the_owner_operational_refusal() {
    let staging = StagingFile::new(&[]);
    let missing = staging.path().to_owned();
    drop(staging);

    let refusal = walk_and_strip(&missing, &DEFAULT_CEILINGS).unwrap_err();
    assert_eq!(refusal.code, "E_OWNER_ASSET_IO");
    assert_eq!(refusal.family, "owner");
    assert_eq!(refusal.guide, "assets/video");
    assert_eq!(
        refusal.rewrite.as_deref(),
        Some("discard this staging file and retry the upload")
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
