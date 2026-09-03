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

fn write_jpeg(path: &Path) {
    let image = rgba_fixture();
    let rgb = image::DynamicImage::ImageRgba8(image).to_rgb8();
    let mut output = File::create(path).unwrap();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 90)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
}

fn write_webp(path: &Path) {
    let image = rgba_fixture();
    let mut output = File::create(path).unwrap();
    image::codecs::webp::WebPEncoder::new_lossless(&mut output)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
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
    write_jpeg(&jpeg);
    write_png(&png, &rgba_fixture(), None);
    write_webp(&webp);

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
    write_jpeg(&source);
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
        assert_eq!(probe(&source).unwrap().orientation, orientation);
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
fn alpha_source_renders_as_png() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.png");
    let destination = temp.path().join("rendered.bin");
    let mut image = rgba_fixture();
    image.get_pixel_mut(1, 1)[3] = 31;
    write_png(&source, &image, None);
    let result = render(&source, &destination, 3, None, CEILINGS).unwrap();
    assert_eq!(result.format, MediaFormat::Png);
    assert_eq!(&fs::read(destination).unwrap()[..8], b"\x89PNG\r\n\x1a\n");
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
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
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
    assert_eq!(refusal.detail, "HEIC decoder not built");
}

#[cfg(feature = "heic")]
#[test]
fn heic_feature_routes_into_the_decoder() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.heic");
    let destination = temp.path().join("output.jpg");
    let mut bytes = vec![0, 0, 0, 24];
    bytes.extend_from_slice(b"ftypheic");
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes.extend_from_slice(b"heic");
    fs::write(&source, bytes).unwrap();
    let refusal = normalize_heic(&source, &destination).unwrap_err();
    assert_eq!(refusal.code, E_ASSET_TYPE);
    assert_ne!(refusal.detail, "HEIC decoder not built");
    assert!(!destination.exists());
}
