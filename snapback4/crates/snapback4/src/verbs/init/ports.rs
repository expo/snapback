// @ref LLP 3000.011.003.000#9 — one range localizes every starter launcher before any file is written.
use super::super::Options;
use serde_json::{Value, json};

pub(super) fn range(options: &Options) -> Result<Option<(u16, u16)>, String> {
    // Environment belongs to the process launch, never to generated files.
    // Validate malformed assigned ranges at run time through snapback4/proof.
    let text = options.flags.get("port-range").cloned();
    let Some(text) = text else { return Ok(None) };
    let (low, high) = text.split_once('-').ok_or("--port-range must be A-B (1 <= A <= B <= 65535)")?;
    let (low, high) = (low.parse::<u16>(), high.parse::<u16>());
    match (low, high) {
        (Ok(low), Ok(high)) if low > 0 && low <= high => Ok(Some((low, high))),
        _ => Err("--port-range must be A-B (1 <= A <= B <= 65535)".into()),
    }
}

pub(super) fn scripts(files: &mut Vec<(&'static str, String)>, backend: u16, frontend: u16, range: Option<(u16, u16)>, web: bool) {
    for (name, text) in files.iter_mut() {
        if *name != "package.json" { continue; }
        let mut package: Value = serde_json::from_str(text).unwrap();
        package["scripts"]["backend"] = json!(format!("snapback4 dev --port {backend}"));
        if web {
            package["scripts"]["dev"] = json!(format!("vite --port {frontend} --strictPort"));
            package["scripts"]["preview"] = json!(format!("vite preview --port {frontend} --strictPort"));
        } else {
            package["scripts"]["start"] = json!(format!("expo start --port {frontend}"));
            package["scripts"]["web"] = json!(format!("expo start --web --port {frontend}"));
            package["scripts"]["native:smoke"] = json!(format!("snapback4 witness ios --build . --smoke --port {backend}"));
        }
        package["scripts"]["proof:web"] = json!(format!("snapback4 witness web dist{}", range.map(|(low, high)| format!(" --port-range {low}-{high}")).unwrap_or_default()));
        *text = super::pretty(&package);
    }
}

/// The initializer only reports this range; generated files read it again at launch.
pub(super) fn environment() -> Result<Option<(u16, u16)>, String> {
    match (std::env::var("PORT_LO").ok(), std::env::var("PORT_HI").ok()) {
        (None, None) => Ok(None),
        (Some(lo), Some(hi)) => match (lo.parse::<u16>(), hi.parse::<u16>()) {
            (Ok(lo), Ok(hi)) if lo > 0 && lo <= hi => Ok(Some((lo, hi))),
            _ => Err("PORT_LO/PORT_HI must provide an inclusive range in 1..65535".into()),
        },
        _ => Err("PORT_LO and PORT_HI must both be set".into()),
    }
}
