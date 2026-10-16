//! Advice is evidence about known template bytes, or explicitly a heuristic.
// @ref LLP 3000.011.003.000.000#11-wave-14-truthful-starter-custody-day4 — custom proofs own their arguments and assertions.
use std::path::Path;
use sha2::{Digest, Sha256};
use serde::Deserialize;

#[derive(Deserialize)]
struct Template { file: String, version: String, template: Option<String>, web: bool, sha256: String }
fn templates() -> &'static [Template] {
    static TEMPLATES: std::sync::OnceLock<Vec<Template>> = std::sync::OnceLock::new();
    TEMPLATES.get_or_init(|| serde_json::from_str(include_str!("proof-digests.json")).expect("shipped proof digests"))
}
fn digest(text: &str) -> String { format!("{:x}", Sha256::digest(text.as_bytes())) }
pub(super) fn known_day2(text: &str) -> bool {
    let hash = digest(text);
    templates().iter().any(|t| t.file == "day2" && t.sha256 == hash)
}
pub(super) fn frontend_template(dir: &Path, web: bool) -> Option<(&'static str, Option<&'static str>)> {
    let text = std::fs::read_to_string(dir.join("scripts/frontend-proof.mjs")).ok()?;
    let hash = digest(&text);
    templates().iter().find(|t| t.file == "frontend" && t.web == web && t.sha256 == hash)
        .map(|t| (t.version.as_str(), t.template.as_deref()))
}
pub(super) fn known_frontend(dir: &Path) -> bool { [false,true].into_iter().any(|web|frontend_template(dir,web).is_some()) }
fn package(dir: &Path) -> serde_json::Value {
    std::fs::read_to_string(dir.join("package.json")).ok().and_then(|s|serde_json::from_str(&s).ok()).unwrap_or_default()
}
pub(super) fn referenced(dir: &Path, path: &str) -> bool {
    package(dir)["scripts"].as_object().is_some_and(|scripts| scripts.values().any(|v|v.as_str().is_some_and(|s|s.contains(path))))
}
pub(super) fn report(dir: &Path) -> Vec<String> {
    let mut advice = Vec::new();
    for path in ["scripts/frontend-proof.mjs", "scripts/day2-proof.mjs", "scripts/launch.mjs"] {
        if !dir.join(path).exists() && referenced(dir, path) {
            advice.push(format!("info: {path} is missing but package.json still references it; preview `snapback4 init --adapt`, then `snapback4 init --adapt --apply`"));
        }
    }
    if let Ok(text) = std::fs::read_to_string(dir.join("scripts/day2-proof.mjs")) {
        let hash=digest(&text);
        if let Some(t)=templates().iter().find(|t| t.file=="day2" && t.sha256==hash) {
            if matches!(t.version.as_str(),"0.4.28"|"0.4.29") {
                advice.push(format!("info: scripts/day2-proof.mjs is the unmodified {} starter: it asserts no business rows; preview `snapback4 init --adapt` to replace it and capture current sources/fixtures",t.version));
            }
            if t.version=="0.4.30" || t.version=="0.4.31" {
                let script=package(dir)["scripts"]["day2:proof"].as_str().unwrap_or("").to_owned();
                if script=="node scripts/day2-proof.mjs" {
                    advice.push("info: the unmodified day-two starter needs its two saved-source arguments; preview `snapback4 init --adapt`".into());
                }
            }
        }
    }
    if let Ok(text)=std::fs::read_to_string(dir.join("scripts/frontend-proof.mjs")) {
        // Custom JavaScript can hide builds in arbitrary imports/functions. These
        // checks deliberately make no claim about its behavior or ownership.
        let active=text.lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let flat=active.replace(['\"','\'',',','[',']','(',')'], " ");
        let words=flat.split_whitespace().collect::<Vec<_>>();
        let serves_dist=words.windows(2).any(|w|w==["startStatic","dist"]);
        let pkg=package(dir);
        let launch=pkg["scripts"]["frontend:proof"].as_str().unwrap_or("");
        let pre=pkg["scripts"]["prefrontend:proof"].as_str().unwrap_or("");
        let builds=|s:&str|s.contains("build")||s.contains("export");
        if serves_dist && !builds(&active) && !builds(launch) && !builds(pre) {
            advice.push("info: scripts/frontend-proof.mjs serves dist with no visible build step (heuristic; imported code may build it); build in the proof or its npm script before startStatic(\"dist\")".into());
        }
        if words.windows(3).any(|w|w==["npx","snapback4","dev"]) {
            advice.push("info: scripts/frontend-proof.mjs launches npx snapback4 dev (heuristic); use startDev from snapback4/proof for an owned server and bounded cleanup".into());
        }
    }
    advice
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_shipped_proof_template_has_a_digest() {
        let mut expected=Vec::new();
        for (version,frontend,day2) in [
            ("0.4.28",include_str!("previous/frontend-proof-0.4.28.mjs"),include_str!("previous/day2-proof-0.4.28.mjs")),
            ("0.4.29",include_str!("previous/frontend-proof-0.4.29.mjs"),include_str!("previous/day2-proof-0.4.29.mjs")),
            ("0.4.30",include_str!("previous/frontend-proof-0.4.30.mjs"),include_str!("previous/day2-proof-0.4.30.mjs")),
            ("0.4.31",include_str!("frontend-proof.mjs"),include_str!("day2-proof.mjs")),
        ] {
            for web in [false,true] { for template in [None,Some("chat"),Some("social")] {
                expected.push(serde_json::json!({"file":"frontend","version":version,"web":web,"template":template,"sha256":digest(&super::super::proof::frontend_proof(frontend,template,web))}));
            }}
            expected.push(serde_json::json!({"file":"day2","version":version,"web":false,"template":null,"sha256":digest(day2)}));
        }
        if std::env::var_os("SNAPBACK4_UPDATE_PROOF_DIGESTS").is_some() {
            std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"),"/src/verbs/init/proof-digests.json"),serde_json::to_string_pretty(&expected).unwrap()+"\n").unwrap();
        } else {
            assert_eq!(serde_json::from_str::<serde_json::Value>(include_str!("proof-digests.json")).unwrap(),serde_json::json!(expected),"retain historical digests and register each new shipped template");
        }
    }
}
