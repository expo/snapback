//! Codec-only S4a evidence; this does not install an image or change a store.
use snapback4_core::{compact, json_codec};
use snapback4_device::device::Backend;
use std::{hint::black_box, time::Instant};

fn chat() -> Backend {
    let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../apps/chat/snapback/schema.q").into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Backend { generation: 1, schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() }
}
fn equal(a: &Backend, b: &Backend) {
    assert_eq!(a.generation, b.generation); assert_eq!(a.schema, b.schema); assert_eq!(a.programs, b.programs);
}
#[test]
fn chat_backend_round_trip_and_every_truncated_prefix_refuses() {
    let backend = chat();
    let bytes = compact::to_vec(&backend).unwrap();
    equal(&backend, &compact::from_slice(&bytes).unwrap());
    equal(&backend, &json_codec::from_text(&json_codec::to_text(&backend).unwrap()).unwrap());
    for offset in 0..bytes.len() { assert!(compact::from_slice::<Backend>(&bytes[..offset]).is_err(), "accepted truncation at {offset}/{}", bytes.len()); }
    let mut trailing = bytes.clone(); trailing.push(0);
    assert!(compact::from_slice::<Backend>(&trailing).is_err());
    println!("chat compact: {} bytes; {} truncated prefixes refused", bytes.len(), bytes.len());
}

#[test]
#[ignore = "native paired measurement, seven alternating blocks of seven samples"]
fn paired_backend_decode() {
    let backend = chat();
    let bytes = compact::to_vec(&backend).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../apps/chat/snapback/schema.q").into())]);
    let mut schema = backend.schema.clone(); schema.prepare_contribution_indexes();
    let mut programs: Vec<_> = backend.programs.iter().collect(); programs.sort_by(|a,b| a.name.cmp(&b.name));
    let identity = snapback4_core::value::digest(&(&schema, programs, backend.generation));
    let text = serde_json::json!({"generation":1,"identity":identity,"schema":bound.schema,"programs":snapback4_lang::emit::backend_programs(&bound),"native":null}).to_string();
    equal(&backend, &json_codec::from_text(&text).unwrap());
    let run = |binary: bool| {
        let mut samples = Vec::new();
        for _ in 0..7 {
            let start = Instant::now();
            for _ in 0..100 {
                let decoded: Backend = if binary { compact::from_slice(black_box(&bytes)).unwrap() } else { json_codec::from_text(black_box(&text)).unwrap() };
                black_box(decoded);
            }
            samples.push(start.elapsed().as_secs_f64() * 10_000.0);
        }
        samples.sort_by(f64::total_cmp);
        samples[3]
    };
    let (mut json, mut binary) = (Vec::new(), Vec::new());
    for block in 0..7 {
        let (j, b) = if block % 2 == 0 { let j = run(false); (j, run(true)) } else { let b = run(true); (run(false), b) };
        println!("block {block}: JSON {j:.3} us/decode, compact {b:.3} us/decode");
        json.push(j); binary.push(b);
    }
    json.sort_by(f64::total_cmp); binary.sort_by(f64::total_cmp);
    println!("paired median: JSON {:.3} us/decode; compact {:.3} us/decode; change {:.2}%", json[3], binary[3], (binary[3] / json[3] - 1.0) * 100.0);
    if let Ok(directory) = std::env::var("S4A_ARTIFACT_DIR") {
        let path = std::path::Path::new(&directory);
        std::fs::create_dir_all(path).unwrap();
        std::fs::write(path.join("chat.backend.json"), json_codec::to_text(&backend).unwrap()).unwrap();
        let mut image = b"SB4B\x01".to_vec(); image.extend(&bytes);
        std::fs::write(path.join("chat.probe.sb4b"), &image).unwrap();
        std::fs::write(path.join("chat.proposed-schema.json"), &text).unwrap();
        println!("chat probe image {} bytes; metadata hex {} ASCII bytes, base64 {} ASCII bytes", image.len(), image.len() * 2, image.len().div_ceil(3) * 4);
    }
}
