use super::*;
use image::{ImageEncoder, Rgba, RgbaImage};
use std::fs;
use tempfile::TempDir;

fn rgba_fixture() -> RgbaImage {
    RgbaImage::from_fn(3, 2, |x, y| {
        let red = (1 + y * 3 + x) as u8;
        Rgba([red, 0, 0, 255])
    })
}

fn write_png(path: &Path, image: &RgbaImage, orientation: Option<u8>) {
    let mut output = File::create(path).unwrap();
    let mut encoder = image::codecs::png::PngEncoder::new(&mut output);
    if let Some(orientation) = orientation {
        encoder
            .set_exif_metadata(exif_orientation(orientation))
            .unwrap();
    }
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
}

fn write_jpeg(path: &Path, orientation: Option<u8>) {
    let image = rgba_fixture();
    let rgb = image::DynamicImage::ImageRgba8(image).to_rgb8();
    let mut output = File::create(path).unwrap();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 90);
    if let Some(orientation) = orientation {
        encoder
            .set_exif_metadata(exif_orientation(orientation))
            .unwrap();
    }
    encoder
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
}

fn write_webp(path: &Path, image: &RgbaImage, orientation: Option<u8>) {
    let mut output = File::create(path).unwrap();
    let mut encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut output);
    if let Some(orientation) = orientation {
        encoder
            .set_exif_metadata(exif_orientation(orientation))
            .unwrap();
    }
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("testdata")
        .join(name)
}

fn exif_orientation(orientation: u8) -> Vec<u8> {
    vec![
        b'I',
        b'I',
        42,
        0,
        8,
        0,
        0,
        0,
        1,
        0,
        0x12,
        0x01,
        3,
        0,
        1,
        0,
        0,
        0,
        orientation,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ]
}

fn fake_png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes
}

fn red_grid(path: &Path) -> Vec<Vec<u8>> {
    let image = image::open(path).unwrap().to_rgba8();
    (0..image.height())
        .map(|y| {
            (0..image.width())
                .map(|x| image.get_pixel(x, y)[0])
                .collect()
        })
        .collect()
}

#[test]
fn probe_supports_synthesized_jpeg_png_and_webp() {
    let temp = TempDir::new().unwrap();
    let jpeg = temp.path().join("sample.jpg");
    let png = temp.path().join("sample.png");
    let webp = temp.path().join("sample.webp");
    write_jpeg(&jpeg, None);
    write_png(&png, &rgba_fixture(), None);
    write_webp(&webp, &rgba_fixture(), None);

    for (path, expected) in [
        (&jpeg, MediaFormat::Jpeg),
        (&png, MediaFormat::Png),
        (&webp, MediaFormat::Webp),
    ] {
        let result = probe(path).unwrap();
        assert_eq!(result.format, expected);
        assert_eq!((result.width, result.height, result.orientation), (3, 2, 1));
    }
}

#[test]
fn render_never_upscales() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.jpg");
    let destination = temp.path().join("rendered.jpg");
    write_jpeg(&source, None);
    let result = render(&source, &destination, 300, Some(1), CEILINGS).unwrap();
    assert_eq!((result.width, result.height), (3, 2));
    assert_eq!(image::image_dimensions(destination).unwrap(), (3, 2));
}

#[test]
fn orientations_one_through_eight_move_pixels_correctly() {
    let expected = [
        vec![vec![1, 2, 3], vec![4, 5, 6]],
        vec![vec![3, 2, 1], vec![6, 5, 4]],
        vec![vec![6, 5, 4], vec![3, 2, 1]],
        vec![vec![4, 5, 6], vec![1, 2, 3]],
        vec![vec![1, 4], vec![2, 5], vec![3, 6]],
        vec![vec![4, 1], vec![5, 2], vec![6, 3]],
        vec![vec![6, 3], vec![5, 2], vec![4, 1]],
        vec![vec![3, 6], vec![2, 5], vec![1, 4]],
    ];
    for orientation in 1..=8_u8 {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.png");
        let destination = temp.path().join("rendered.png");
        write_png(&source, &rgba_fixture(), Some(orientation));
        let probed = probe(&source).unwrap();
        assert_eq!(probed.orientation, orientation);
        assert_eq!(
            (probed.width, probed.height),
            if orientation >= 5 { (2, 3) } else { (3, 2) }
        );
        let requested_width = if orientation >= 5 { 2 } else { 3 };
        render(&source, &destination, requested_width, None, CEILINGS).unwrap();
        assert_eq!(
            red_grid(&destination),
            expected[usize::from(orientation - 1)]
        );
    }
}

#[test]
fn explicit_orientation_overrides_the_embedded_tag() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.png");
    let destination = temp.path().join("rendered.png");
    write_png(&source, &rgba_fixture(), Some(1));
    render(&source, &destination, 2, Some(6), CEILINGS).unwrap();
    assert_eq!(
        red_grid(&destination),
        vec![vec![4, 1], vec![5, 2], vec![6, 3]]
    );
}

#[test]
fn translucent_png_and_webp_preserve_alpha_through_render() {
    let mut image = rgba_fixture();
    image.get_pixel_mut(1, 1)[3] = 31;
    for source_format in [MediaFormat::Png, MediaFormat::Webp] {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.image");
        let destination = temp.path().join("rendered.png");
        match source_format {
            MediaFormat::Png => write_png(&source, &image, None),
            MediaFormat::Webp => write_webp(&source, &image, None),
            _ => unreachable!(),
        }
        let result = render(&source, &destination, 3, None, CEILINGS).unwrap();
        assert_eq!(result.format, MediaFormat::Png);
        assert_eq!(&fs::read(&destination).unwrap()[..8], b"\x89PNG\r\n\x1a\n");
        let rendered = image::open(destination).unwrap().to_rgba8();
        assert_eq!(rendered.get_pixel(1, 1)[3], 31, "{source_format:?}");
    }
}

#[test]
fn opaque_jpeg_renders_as_jpeg() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.jpg");
    let destination = temp.path().join("rendered.bin");
    write_jpeg(&source, None);
    let result = render(&source, &destination, 3, None, CEILINGS).unwrap();
    assert_eq!(result.format, MediaFormat::Jpeg);
    assert!(fs::read(destination).unwrap().starts_with(&[0xff, 0xd8]));
}

#[test]
fn jpeg_and_webp_exif_six_probe_as_display_dimensions() {
    let temp = TempDir::new().unwrap();
    let jpeg = temp.path().join("oriented.jpg");
    let webp = temp.path().join("oriented.webp");
    write_jpeg(&jpeg, Some(6));
    write_webp(&webp, &rgba_fixture(), Some(6));
    for path in [&jpeg, &webp] {
        let result = probe(path).unwrap();
        assert_eq!((result.width, result.height, result.orientation), (2, 3, 6));
    }
}

#[test]
fn no_upscale_is_decided_after_orientation_swap() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.png");
    let destination = temp.path().join("rendered.png");
    write_png(&source, &rgba_fixture(), Some(6));
    let result = render(&source, &destination, 3, None, CEILINGS).unwrap();
    assert_eq!((result.width, result.height), (2, 3));
    assert_eq!(image::image_dimensions(destination).unwrap(), (2, 3));
}

#[test]
fn pixel_ceiling_refuses_from_header() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("large.png");
    fs::write(&source, fake_png(10_000, 6_000)).unwrap();
    let refusal = inspect_raster(&source, CEILINGS).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TOO_LARGE);
    assert!(refusal.detail.contains("pixel count"));
}

#[test]
fn longest_edge_ceiling_refuses_from_header() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("wide.png");
    fs::write(&source, fake_png(16_385, 1)).unwrap();
    let refusal = inspect_raster(&source, CEILINGS).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TOO_LARGE);
    assert!(refusal.detail.contains("longest-edge"));
}

#[test]
fn decompression_ratio_ceiling_refuses_from_header() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("bomb.png");
    fs::write(&source, fake_png(4_096, 2_048)).unwrap();
    let refusal = inspect_raster(&source, CEILINGS).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TOO_LARGE);
    assert!(refusal.detail.contains("decompression ratio"));
}

#[test]
fn header_ceiling_refuses_before_decode() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("header.jpg");
    let mut bytes = vec![0xff, 0xd8, 0xff, 0xe1, 0, 18];
    bytes.extend_from_slice(&[0; 16]);
    bytes.extend_from_slice(&[0xff, 0xd9]);
    fs::write(&source, bytes).unwrap();
    let ceilings = Ceilings {
        max_header_bytes: 8,
        ..CEILINGS
    };
    let refusal = inspect_raster(&source, ceilings).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TOO_LARGE);
    assert!(refusal.detail.contains("header"));
}

#[test]
fn jpeg_fill_bytes_are_charged_to_the_header_ceiling() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("fill.jpg");
    let mut bytes = vec![0xff, 0xd8];
    bytes.extend(std::iter::repeat_n(0, 2 * 1024 * 1024));
    bytes.extend_from_slice(&[0xff, 0xc0, 0, 7, 8, 0, 2, 0, 3]);
    fs::write(&source, bytes).unwrap();
    let refusal = inspect_raster(&source, CEILINGS).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TOO_LARGE);
    assert!(refusal.detail.contains("JPEG header"));
}

#[test]
fn png_metadata_chunks_are_charged_before_decoder_creation() {
    for chunk_type in [b"tEXt", b"zTXt", b"iTXt", b"eXIf"] {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("metadata.png");
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&3_u32.to_be_bytes());
        bytes.extend_from_slice(&2_u32.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&100_u32.to_be_bytes());
        bytes.extend_from_slice(chunk_type);
        fs::write(&source, bytes).unwrap();
        let ceilings = Ceilings {
            max_header_bytes: 64,
            ..CEILINGS
        };
        let refusal = inspect_raster(&source, ceilings).unwrap_err();
        assert_eq!(refusal.code, E_ASSET_TOO_LARGE, "{chunk_type:?}");
        assert!(refusal.detail.contains("PNG metadata"));
    }
}

#[test]
fn output_ceiling_leaves_no_partial_destination_or_temp() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.png");
    let destination = temp.path().join("rendered.png");
    write_png(&source, &rgba_fixture(), None);
    let ceilings = Ceilings {
        max_output_bytes: 16,
        ..CEILINGS
    };
    let refusal = render(&source, &destination, 3, None, ceilings).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TOO_LARGE);
    assert!(!destination.exists());
    let survivors = fs::read_dir(temp.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert_eq!(survivors.len(), 1);
    assert_eq!(survivors[0], source.file_name().unwrap());
    assert!(!survivors.iter().any(|name| {
        name.to_string_lossy().starts_with(".snapback2-media-")
            && name.to_string_lossy().ends_with(".tmp")
    }));
}

#[cfg(not(feature = "heic"))]
#[test]
fn heic_without_feature_is_a_typed_refusal() {
    let temp = TempDir::new().unwrap();
    let refusal = normalize_heic(
        &temp.path().join("source.heic"),
        &temp.path().join("output.jpg"),
    )
    .unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TYPE);
    assert_eq!(
        refusal.detail,
        "HEIC decoder not built; rebuild snapback2-media with --features heic"
    );
}

#[cfg(feature = "heic")]
#[test]
fn real_heic_fixtures_normalize_orientation_exactly_once() {
    let temp = TempDir::new().unwrap();
    for (name, expected, has_item_transform) in [
        ("minimal.heic", (16, 8), false),
        ("exif-orientation-6.heic", (8, 16), false),
        ("exif-orientation-6-offset-4.heic", (8, 16), false),
        ("irot-90.heic", (8, 16), true),
        ("irot-90-exif-6.heic", (8, 16), true),
    ] {
        let source = fixture(name);
        assert_eq!(
            heic_has_item_transform_file(&source).unwrap(),
            has_item_transform,
            "{name}"
        );
        let probed = probe(&source).unwrap();
        assert_eq!((probed.width, probed.height), expected, "{name}");
        assert_eq!(probed.orientation, 1, "{name}");
        let destination = temp.path().join(format!("{name}.jpg"));
        let rendered = normalize_heic(&source, &destination).unwrap();
        assert_eq!((rendered.width, rendered.height), expected, "{name}");
        assert_eq!(
            image::image_dimensions(&destination).unwrap(),
            expected,
            "{name}"
        );
        let header = inspect_raster(&destination, CEILINGS).unwrap();
        assert_eq!(
            raster_orientation(&destination, header, CEILINGS).unwrap(),
            1,
            "{name}"
        );
    }
}

#[cfg(feature = "heic")]
#[test]
fn capabilities_prove_the_embedded_heic_fixture_decodes() {
    let supported = capabilities();
    assert!(supported.images);
    assert!(supported.heic);
}

#[cfg(feature = "heic")]
#[test]
fn heic_ispe_limit_refuses_before_pixel_decode() {
    let bytes = fs::read(fixture("minimal.heic")).unwrap();
    let ceilings = Ceilings {
        max_edge: 10,
        ..CEILINGS
    };
    let refusal = decode_heic_bytes(&bytes, ceilings).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TOO_LARGE);
    assert!(refusal.detail.contains("longest-edge"));
}

#[cfg(feature = "heic")]
#[test]
fn mif1_only_hevc_primary_is_recognized_as_heic() {
    let source = fixture("minimal.heic");
    let mut bytes = fs::read(&source).unwrap();
    assert!(bytes.windows(4).any(|brand| brand == b"mif1"));
    bytes[8..12].copy_from_slice(b"mif1");
    bytes[16..20].copy_from_slice(b"mif1");
    bytes[20..24].copy_from_slice(b"mif1");
    bytes[24..28].copy_from_slice(b"miaf");
    let temp = TempDir::new().unwrap();
    let mif1 = temp.path().join("mif1.heic");
    fs::write(&mif1, bytes).unwrap();
    assert_eq!(detect_format(&mif1, CEILINGS).unwrap(), MediaFormat::Heic);
}

#[cfg(not(feature = "heic"))]
fn assert_explicit_hevc_brand_is_recognized(brand: &[u8; 4]) {
    let mut bytes = fs::read(fixture("minimal.heic")).unwrap();
    bytes[8..12].copy_from_slice(brand);
    bytes[16..20].copy_from_slice(brand);
    bytes[20..24].copy_from_slice(brand);
    let temp = TempDir::new().unwrap();
    let path = temp
        .path()
        .join(format!("{}.heic", String::from_utf8_lossy(brand)));
    fs::write(&path, bytes).unwrap();
    assert_eq!(detect_format(&path, CEILINGS).unwrap(), MediaFormat::Heic);
}

#[cfg(not(feature = "heic"))]
#[test]
fn heim_hevc_primary_is_recognized_as_heic() {
    assert_explicit_hevc_brand_is_recognized(b"heim");
}

#[cfg(not(feature = "heic"))]
#[test]
fn heis_hevc_primary_is_recognized_as_heic() {
    assert_explicit_hevc_brand_is_recognized(b"heis");
}

#[test]
fn avif_brands_are_refused_even_with_mif1_compatibility() {
    for brand in [b"avif", b"avis", b"av01"] {
        let mut bytes = fs::read(fixture("minimal.heic")).unwrap();
        bytes[8..12].copy_from_slice(brand);
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("avif.bin");
        fs::write(&path, bytes).unwrap();
        let refusal = detect_format(&path, CEILINGS).unwrap_err();
        assert_eq!(refusal.code, E_ASSET_TYPE, "{brand:?}");
    }
}

#[cfg(feature = "heic")]
#[test]
fn non_hevc_primary_item_is_refused_despite_heic_brand() {
    let mut bytes = fs::read(fixture("minimal.heic")).unwrap();
    let item_type = bytes
        .windows(4)
        .position(|candidate| candidate == b"hvc1")
        .expect("fixture has an HEVC primary item");
    bytes[item_type..item_type + 4].copy_from_slice(b"av01");
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("non-hevc.heic");
    fs::write(&path, bytes).unwrap();
    let refusal = detect_format(&path, CEILINGS).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TYPE);
}

#[test]
fn refusal_detail_is_escaped_and_bounded() {
    let refusal = Refusal::asset_type(format!("argument {}\n", "x".repeat(32_000)));
    assert!(refusal.detail.len() <= MAX_DETAIL_BYTES + 3);
    assert!(!refusal.detail.contains('\n'));
    assert!(refusal.detail.ends_with("..."));
}
