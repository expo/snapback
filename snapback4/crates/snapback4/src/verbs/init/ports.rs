// @ref LLP 3000.011.003.000#9 — one range localizes every starter launcher before any file is written.
use super::super::Options;
use serde_json::{Value, json};

pub(super) fn range(options: &Options) -> Result<Option<(u16, u16)>, String> {
    let text = match options.flags.get("port-range") {
        Some(text) => Some(text.clone()),
        None => match (std::env::var("PORT_LO").ok(), std::env::var("PORT_HI").ok()) {
            (None, None) => None,
            (Some(low), Some(high)) => Some(format!("{low}-{high}")),
            _ => return Err("PORT_LO and PORT_HI must be set together".into()),
        }
    };
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
