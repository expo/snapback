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
pub(super) fn digest(text: &str) -> String { format!("{:x}", Sha256::digest(text.as_bytes())) }
pub(super) fn known_day2(text: &str) -> bool {
    let hash = digest(text);
    text == include_str!("day2-proof.mjs") || templates().iter().any(|t| t.file == "day2" && t.sha256 == hash)
}
/// Exact shipped helper bytes identify its identity mode and starter revision.
pub(super) fn native_template(text: &str) -> Option<(&'static str, bool)> {
    let hash = digest(text);
    templates().iter().find(|t| t.file == "native" && t.sha256 == hash)
        .map(|t| (t.version.as_str(), t.template.as_deref() == Some("password")))
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
// @ref LLP 3000.011.003.000#15-wave-15-starter-advice-day5-2026-10-18 — compare the complete directory capture; no distinguished schema.q is required.
pub(super) fn legacy_differences(dir: &Path, plan: &[(&str, String)]) -> Vec<String> {
    ["v1", "v2"].into_iter().filter_map(|version| {
        let flat = format!("versions/{version}.q");
        let prefix = format!("versions/{version}/");
        let legacy = std::fs::read_to_string(dir.join(&flat)).ok()?;
        let mut saved = std::collections::BTreeMap::new();
        if let Ok(entries) = std::fs::read_dir(dir.join(&prefix)) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext|ext=="q") && let Ok(text)=std::fs::read_to_string(&path) {
                    saved.insert(format!("{prefix}{}",entry.file_name().to_string_lossy()),text);
                }
            }
        }
        for (name,text) in plan.iter().filter(|(name,_)|name.starts_with(&prefix) && name.ends_with(".q")) {
            saved.insert((*name).to_owned(),text.clone());
        }
        if saved.is_empty() || saved.len()==1 && saved.values().next()==Some(&legacy) {return None;}
        let paths=saved.keys().cloned().collect::<Vec<_>>().join(", ");
        Some(format!("info: {flat} differs from {paths}; saved {version} captures snapback/*.q, not the legacy flat source; both remain unchanged evidence. Review the pair before day2:proof"))
    }).collect()
}
pub(super) fn report(dir: &Path) -> Vec<String> {
    let mut advice = legacy_differences(dir, &[]);
    // A current or application-owned recipe can contain genuine historical
    // todo source. Only a recognized old scaffold recipe supplies evidence of
    // the old placeholder problem; never relabel new captures as stale.
    let inherited_recipe=std::fs::read_to_string(dir.join("scripts/day2-proof.mjs")).ok()
        .is_some_and(|text|{let hash=digest(&text);templates().iter().any(|t|t.file=="day2"&&t.sha256==hash)});
    if let Ok(entries) = std::fs::read_dir(dir.join("versions")) && inherited_recipe {
        let mut paths = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(files) = std::fs::read_dir(&path) { paths.extend(files.flatten().map(|entry|entry.path()).filter(|path|path.extension().is_some_and(|e|e=="q"))); }
            } else if path.extension().is_some_and(|e|e=="q") { paths.push(path); }
        }
        paths.sort();
        for path in paths {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let hash = digest(&text);
                if let Some(t) = templates().iter().find(|t| t.file == "todo-schema" && t.sha256 == hash) {
                    advice.push(format!("info: {} is the unmodified {} todo snapshot (sha256 {hash}); preserve genuine historical source and fixtures; if this was only a scaffold placeholder, replace it with the actual historical unit before day2:proof", path.strip_prefix(dir).unwrap_or(&path).display(), t.version));
                }
            }
        }
    }
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
            if text.contains("assert.fail(") {
                advice.push(format!("info: scripts/day2-proof.mjs is the unmodified {} assert.fail business-assertion placeholder (sha256 {hash}); replace BUSINESS_ASSERTION_BEGIN with this app's persisted-row and refusal assertions", t.version));
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
    for path in ["scripts/frontend-proof.mjs", "scripts/day2-proof.mjs", "scripts/proof.mjs", "scripts/acceptance.mjs"] {
        let Ok(text) = std::fs::read_to_string(dir.join(path)) else { continue; };
        let active = text.lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let npx = active.contains("\"npx\"") || active.contains("'npx'");
        let status_only = active.contains("/auth/config") && (active.contains("status === 200") || active.contains("status == 200") || active.contains("[200, 404]") || active.contains("status === 404"));
        if npx && status_only {
            advice.push(format!("info: {path} spawns npx and accepts readiness HTTP status (heuristic; sha256 {}); readiness is not business evidence. Use snapback4/proof hosts and assert persisted rows plus refusals at each release", digest(&text)));
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
            ("0.4.31",include_str!("previous/frontend-proof-0.4.31.mjs"),include_str!("previous/day2-proof-0.4.40.mjs")),
            ("0.4.32",include_str!("previous/frontend-proof-0.4.32.mjs"),include_str!("previous/day2-proof-0.4.32.mjs")),
            ("0.4.33",include_str!("frontend-proof.mjs"),include_str!("previous/day2-proof-0.4.40.mjs")),
        ] {
            for web in [false,true] { for template in [None,Some("chat"),Some("social")] {
                expected.push(serde_json::json!({"file":"frontend","version":version,"web":web,"template":template,"sha256":digest(&super::super::proof::frontend_proof(frontend,template,web))}));
            }}
            expected.push(serde_json::json!({"file":"day2","version":version,"web":false,"template":null,"sha256":digest(day2)}));
        }
        for (version, source) in [
            ("0.4.9", include_str!("starter/previous/native-smoke-0.4.9.ts")),
            ("0.4.16", include_str!("starter/previous/native-smoke-0.4.16.ts")),
            ("0.4.28", include_str!("starter/previous/wave14/native-smoke.ts")),
            ("0.4.31", include_str!("native-smoke.ts")),
        ] {
            for password in [false, true].into_iter().filter(|password| !*password || version != "0.4.9") {
                let text = super::super::starter::native_smoke_version(password, source);
                let version = if version == "0.4.16" && password { "0.4.25" } else { version };
                expected.push(serde_json::json!({"file":"native","version":version,"web":false,"template":if password { Some("password") } else { None },"sha256":digest(&text)}));
            }
        }
        expected.push(serde_json::json!({"file":"todo-schema","version":"0.4.30","web":false,"template":null,"sha256":digest(&super::super::without_design_references(include_str!("starter/previous/schema-0.4.30.q")))}));
        expected.push(serde_json::json!({"file":"todo-schema","version":"0.4.33","web":false,"template":null,"sha256":digest(&super::super::without_design_references(include_str!("starter/previous/schema-0.4.33.q")))}));
        expected.push(serde_json::json!({"file":"todo-schema","version":"0.4.35","web":false,"template":null,"sha256":digest(&super::super::without_design_references(include_str!("starter/previous/schema-0.4.35.q")))}));
        expected.push(serde_json::json!({"file":"todo-schema","version":"0.4.38","web":false,"template":null,"sha256":digest(&super::super::without_design_references(include_str!("starter/schema.q")))}));
        if std::env::var_os("SNAPBACK4_UPDATE_PROOF_DIGESTS").is_some() {
            std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"),"/src/verbs/init/proof-digests.json"),serde_json::to_string_pretty(&expected).unwrap()+"\n").unwrap();
        } else {
            assert_eq!(serde_json::from_str::<serde_json::Value>(include_str!("proof-digests.json")).unwrap(),serde_json::json!(expected),"retain historical digests and register each new shipped template");
        }
    }
}

#[test]
fn readiness_npx_advice_is_heuristic_and_does_not_claim_template_ownership() {
    let root=std::env::temp_dir().join(format!("sb4-day5-proof-advice-{}",std::process::id()));
    std::fs::create_dir_all(root.join("scripts")).unwrap();
    std::fs::write(root.join("scripts/frontend-proof.mjs"), "spawn('npx', ['snapback4','dev']); fetch('/auth/config'); if (res.ok || res.status === 404) return;").unwrap();
    let advice=report(&root).join("\n");
    assert!(advice.contains("spawns npx and accepts readiness HTTP status (heuristic; sha256"),"{advice}");
    assert!(!known_frontend(&root));
    std::fs::remove_dir_all(root).unwrap();
}
