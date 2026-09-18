//! Native store qualification and the compiled backend for the Unicode witness.
mod common;
use common::*;
use snapback4_core::Value;
use snapback4_device::device::{Backend, StreamPage};
use serde_json::json;
use std::{fs, path::Path};

const SOURCE: &str = "table notes:\n  body: text <=4000\n  by byWords: words(body), id\n  read <- allow\n  insert <- allow\n  sync public\nquery search(q: text <=4000):\n  return notes matching q first 20 by byWords\nquery lowerText(s: text <=4000):\n  return lower(s)\nmutation add(s: text <=1000):\n  return insert notes {body: lower(s)}\n";

#[test]
fn unicode_device_fixture_and_native_stores() {
    let (mut engine, backend) = compile(SOURCE);
    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/unicode-device.json");
    fs::create_dir_all(output.parent().unwrap()).unwrap();
    fs::write(&output, serde_json::to_vec(&backend).unwrap()).unwrap();
    engine.seed([("notes".into(), snapback4_core::value::object([("id", id("n1")), ("body", Value::String("CAFE\u{301} ΟΣ İ 𐐀".into()))]))]).unwrap();
    let pages = snapshot_pages(&mut engine, "alice", 4000);
    fn run<H: Host>(host: &mut H, backend: Backend, pages: &[StreamPage]) {
        let mut device = host.open("unicode", Some(backend)).unwrap();
        for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        for needle in ["café", "ος", "i", "𐐨"] {
            let result = device.query("search", "alice", &json!({"q":needle}), 0).unwrap();
            assert_eq!(result.data.as_array().unwrap().len(), 1, "{needle}");
        }
        assert!(device.query("search", "alice", &json!({"q":"absent"}), 0).unwrap().data.as_array().unwrap().is_empty());
        host.close("unicode", device);
        let mut device = host.open("unicode", None).unwrap();
        assert_eq!(device.query("search", "alice", &json!({"q":"café"}), 0).unwrap().data.as_array().unwrap().len(), 1);
        assert_eq!(device.query("lowerText", "alice", &json!({"s":"I İ ı ΟΣ 𐐀"}), 0).unwrap().data, Value::String("i i\u{307} ı ος 𐐨".into()));
        host.close("unicode", device);
    }
    run(&mut Memory::new(), backend.clone(), &pages);
    run(&mut Sqlite::new("unicode"), backend, &pages);
    println!("unicode device fixture: both native stores; {}", output.display());
}
