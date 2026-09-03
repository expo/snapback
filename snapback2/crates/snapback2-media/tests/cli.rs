#![cfg(feature = "images")]

use image::{ImageEncoder, Rgba, RgbaImage};
use serde_json::Value;
use std::fs::File;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::TempDir;

const BIN: &str = env!("CARGO_BIN_EXE_snapback2-media");
const STDOUT_CEILING: usize = 4096;

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

fn write_png(path: &Path, orientation: u8) {
    let image = RgbaImage::from_fn(3, 2, |x, y| {
        Rgba([
            (x + y * 3) as u8,
            0,
            0,
            if x == 1 && y == 1 { 31 } else { 255 },
        ])
    });
    let mut output = File::create(path).unwrap();
    let mut encoder = image::codecs::png::PngEncoder::new(&mut output);
    encoder
        .set_exif_metadata(exif_orientation(orientation))
        .unwrap();
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
}

fn run(args: &[&str]) -> Output {
    Command::new(BIN).args(args).output().unwrap()
}

fn one_json_line(output: &Output) -> Value {
    assert!(
        output.stdout.len() <= STDOUT_CEILING,
        "stdout was {} bytes",
        output.stdout.len()
    );
    let stdout = std::str::from_utf8(&output.stdout).unwrap();
    assert!(stdout.ends_with('\n'));
    assert_eq!(stdout.lines().count(), 1, "{stdout:?}");
    serde_json::from_str(stdout.trim_end()).unwrap()
}

fn assert_refusal(args: &[&str]) {
    let output = run(args);
    assert_eq!(output.status.code(), Some(2), "{:?}", output.status);
    let json = one_json_line(&output);
    assert!(json.get("code").and_then(Value::as_str).is_some());
    assert!(json.get("detail").and_then(Value::as_str).is_some());
}

#[test]
fn executable_success_path_covers_every_verb() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source.png");
    let rendered = temp.path().join("rendered.png");
    write_png(&source, 6);

    let capabilities = run(&["capabilities"]);
    assert!(capabilities.status.success());
    let capabilities = one_json_line(&capabilities);
    assert_eq!(capabilities["images"], true);
    #[cfg(feature = "heic")]
    assert_eq!(capabilities["heic"], true);

    let probed = run(&["probe", source.to_str().unwrap()]);
    assert!(probed.status.success());
    let probed = one_json_line(&probed);
    assert_eq!(
        (probed["width"].as_u64(), probed["height"].as_u64()),
        (Some(2), Some(3))
    );

    let rendered_result = run(&[
        "render",
        source.to_str().unwrap(),
        rendered.to_str().unwrap(),
        "--width",
        "3",
    ]);
    assert!(rendered_result.status.success());
    assert_eq!(one_json_line(&rendered_result)["format"], "png");
    assert_eq!(
        image::open(&rendered).unwrap().to_rgba8().get_pixel(0, 1)[3],
        31
    );

    #[cfg(feature = "heic")]
    {
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/exif-orientation-6.heic");
        let normalized = temp.path().join("normalized.jpg");
        let heic = run(&[
            "heic",
            fixture.to_str().unwrap(),
            normalized.to_str().unwrap(),
        ]);
        assert!(
            heic.status.success(),
            "{}",
            String::from_utf8_lossy(&heic.stdout)
        );
        let result = one_json_line(&heic);
        assert_eq!(
            (result["width"].as_u64(), result["height"].as_u64()),
            (Some(8), Some(16))
        );
        assert_eq!(image::image_dimensions(normalized).unwrap(), (8, 16));
    }
}

#[test]
fn executable_probe_reports_display_dimensions_for_orientations_one_through_eight() {
    for orientation in 1..=8 {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join(format!("orientation-{orientation}.png"));
        write_png(&source, orientation);
        let output = run(&["probe", source.to_str().unwrap()]);
        assert!(output.status.success());
        let result = one_json_line(&output);
        let expected = if orientation >= 5 { (2, 3) } else { (3, 2) };
        assert_eq!(
            (result["width"].as_u64(), result["height"].as_u64()),
            (Some(expected.0), Some(expected.1)),
            "orientation {orientation}"
        );
        assert_eq!(result["orientation"].as_u64(), Some(orientation.into()));
    }
}

#[test]
fn every_verb_refuses_with_exit_two_one_bounded_json_line() {
    let huge = format!("missing-{}\n", "x".repeat(16_000));
    let cases = [
        vec!["capabilities", "extra"],
        vec!["probe", huge.as_str()],
        vec!["render", "source", "destination", huge.as_str(), "1"],
        vec!["heic", huge.as_str(), "destination"],
    ];
    for args in cases {
        assert_refusal(&args);
    }
}

#[test]
fn unknown_argv_is_bounded_too() {
    let command = "x".repeat(16_000);
    assert_refusal(&[command.as_str()]);
}
