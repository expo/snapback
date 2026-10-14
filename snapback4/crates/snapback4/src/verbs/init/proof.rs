// @ref LLP 3000.011.003.000.000#3 — generated proofs use the published kit and runtime ports.
use serde_json::{Value, json};
use super::{Options, pretty};

pub(super) fn files(files: &mut Vec<(&'static str, String)>, _options: &Options, backend: u16, frontend: u16, web: bool, _shape: &super::starter::Shape) {
    let proof = include_str!("frontend-proof.mjs").to_owned();
    files.push(("scripts/frontend-proof.mjs", proof));
    files.push(("scripts/day2-proof.mjs", include_str!("day2-proof.mjs").to_owned()));
    files.push(("scripts/launch.mjs", include_str!("launch.mjs").replace("BACKEND", &backend.to_string()).replace("FRONTEND", &frontend.to_string())));
    for (name, text) in files.iter_mut().filter(|(name, _)| *name == "package.json") {
        let mut package: Value = serde_json::from_str(text).unwrap();
        package["scripts"]["frontend:proof"] = json!("node scripts/frontend-proof.mjs");
        package["scripts"]["day2:proof"] = json!("node scripts/day2-proof.mjs");
        package["scripts"]["proof:web"] = json!("node scripts/frontend-proof.mjs");
        package["devDependencies"]["playwright-core"] = json!("1.55.1");
        package["scripts"]["backend"] = json!("node scripts/launch.mjs backend");
        if web {
            package["scripts"]["dev"] = json!("node scripts/launch.mjs vite");
            package["scripts"]["preview"] = json!("node scripts/launch.mjs vite-preview");
        } else {
            package["scripts"]["start"] = json!("node scripts/launch.mjs expo");
            package["scripts"]["web"] = json!("node scripts/launch.mjs expo-web");
        }
        *text = pretty(&package);
        let _ = name;
    }
}

/// Adapt adds missing proof infrastructure, preserving files and script names
/// already owned by the application. It never runs a package manager.
pub(super) fn plan(dir: &std::path::Path, own: &super::OwnSchema) -> std::io::Result<Vec<(&'static str, String)>> {
    let web = dir.join("src/App.tsx").is_file();
    if !web && !dir.join("App.tsx").is_file() { return Ok(Vec::new()); }
    let shape = super::starter::Shape { title: super::title(dir), password: own.identity.is_some_and(|(p, g)| p && !g),
        personas: own.identity.is_none().then(|| own.personas.clone()).filter(|p| !p.is_empty()),
        body: super::starter::Body::Home(None), offline: own.offline.clone() };
    let path = dir.join("package.json");
    let text = std::fs::read_to_string(&path)?;
    let mut package: Value = serde_json::from_str(&text).map_err(std::io::Error::other)?;
    let original = package.clone();
    let mut generated = vec![("package.json", pretty(&package))];
    files(&mut generated, &Options { positionals: vec![], flags: Default::default(), json: false }, 4400, if web { 5173 } else { 8081 }, web, &shape);
    let wanted: Value = serde_json::from_str(&generated[0].1).unwrap();
    for group in ["scripts", "devDependencies"] {
        if !package[group].is_object() { package[group] = json!({}); }
        for (key, value) in wanted[group].as_object().unwrap() {
            if (key == "frontend:proof" || key == "day2:proof" || key == "playwright-core") && package[group].get(key).is_none() { package[group][key] = value.clone(); }
        }
    }
    let mut additions: Vec<_> = generated.into_iter().skip(1)
        .filter(|(name, _)| !dir.join(name).exists()).collect();
    if package != original { additions.push(("package.json", pretty(&package))); }
    Ok(additions)
}

pub(super) fn apply(dir: &std::path::Path, additions: &[(&str, String)]) -> std::io::Result<()> {
    for (name, body) in additions {
        let path = dir.join(name);
        if *name == "package.json" { super::replace_file(&path, body)?; }
        else {
            std::fs::create_dir_all(path.parent().unwrap())?;
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
            file.write_all(body.as_bytes())?;
        }
    }
    Ok(())
}
