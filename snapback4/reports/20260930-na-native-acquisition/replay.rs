// Copy into crates/snapback4-device/examples/na_replay.rs for attribution.
use snapback4_device::{native::Device, device::StreamPage};
use std::{fs, io::{BufRead, BufReader}, path::Path, time::Instant};
#[derive(serde::Deserialize)]
struct Page { op: String, page: StreamPage, #[serde(default)] first: bool }
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let text = fs::read_to_string(&args[1]).unwrap();
    let opening = snapback4_device::opening::Opening::parse(Some(&text)).unwrap();
    let mut device = Device::open_with(Path::new(&args[3]), opening).unwrap();
    let start = Instant::now();
    let mut apply = 0f64;
    for (seq,line) in BufReader::new(fs::File::open(&args[2]).unwrap()).lines().enumerate() {
        let line = line.unwrap();
        let decode = Instant::now();
        let page = serde_json::from_str::<Page>(&line);
        let decode_ms = decode.elapsed().as_secs_f64()*1000.;
        if let Ok(page) = page && page.op == "apply" {
            snapback4_core::na_profile::reset();
            let start = Instant::now();
            let result = device.apply_publication(&page.page, page.first).unwrap();
            let ms = start.elapsed().as_secs_f64()*1000.; apply += ms;
            println!("{}",serde_json::json!({"seq":seq,"decodeMs":decode_ms,"applyMs":ms,"rows":page.page.events.len(),"published":result.1,"profile":snapback4_core::na_profile::report()}));
        } else {
            let result = snapback4_device::call::try_call_text(&mut device,&line).unwrap();
            assert!(result.get("denied").is_none(), "{seq}: {result}");
            if line.contains("witness_coverage") { println!("coverage {}", result); }
        }
    }
    println!("{}",serde_json::json!({"wallMs":start.elapsed().as_secs_f64()*1000.,"applyMs":apply}));
}
