// @ref LLP 3000.011.003.000.000#3 — generated proofs use the published kit and runtime ports.
use serde_json::{Value, json};
use super::{Options, pretty};

const README_PROOFS: &str = "\n## Frontend and day-two proofs\n\nRun\n`npm run frontend:proof` (it builds its own dist) to prove sign-in and the starter form in Chromium.\nAfter replacing the screen, add your business assertions to scripts/frontend-proof.mjs.\n`npm run day2:proof` proves saved-source deploy,\nrollback and compatible forward using versions/v1 and versions/v2. Replace the marked business assertion before it can pass.\nSet `PORT_LO` and `PORT_HI` at run time to confine proof servers and launchers;\nunset means allocated proof ports and the interactive starter defaults.\nSet `CHROME=/path/to/chromium` or install Playwright's Chromium (`npx playwright-core install chromium`).\n";
const PREVIOUS_README_PROOFS: &str = "\n## Frontend and day-two proofs\n\nAfter `npm run build` (web) or `npm run build:web` (Expo), run\n`npm run frontend:proof` to prove sign-in and the starter form in Chromium.\nAfter replacing the screen, add your business assertions to scripts/frontend-proof.mjs.\n`npm run day2:proof -- versions/v1.q versions/v2.q` proves saved-source deploy,\nrollback and compatible forward without replacing your working schema.\nSet `PORT_LO` and `PORT_HI` at run time to confine proof servers and launchers;\nunset means allocated proof ports and the interactive starter defaults.\nSet `CHROME=/path/to/chromium` or install Playwright's Chromium (`npx playwright-core install chromium`).\n";
/// Only the exact generated appendix is ignored for historical byte recognition.
pub(super) fn without_readme(text: &str) -> &str { text.strip_suffix(README_PROOFS).or_else(|| text.strip_suffix(PREVIOUS_README_PROOFS)).unwrap_or(text) }
pub(super) fn readme(mut text: String) -> String {
    if !text.contains("`npm run frontend:proof`") { text.push_str(README_PROOFS); }
    text
}

pub(super) fn files(files: &mut Vec<(&'static str, String)>, options: &Options, backend: u16, frontend: u16, web: bool, _shape: &super::starter::Shape) {
    for (name, text) in files.iter_mut().filter(|(name, _)| *name == "README.md") {
        *text = readme(std::mem::take(text)); let _ = name;
    }
    for (name, text) in files.iter_mut() {
        if *name == "vite.config.mts" { *text = runtime_vite(text, backend, frontend); }
    }
    let proof = frontend_proof(include_str!("frontend-proof.mjs"), options.flags.get("template").map(String::as_str), web);
    let dir = options.positionals.first().map(std::path::Path::new).unwrap_or_else(|| std::path::Path::new("."));
    let sources = if let Ok(Some(own)) = super::own_schema(dir) {
        own.files.iter().filter_map(|name| std::fs::read_to_string(dir.join("snapback").join(name)).ok().map(|text| (name.clone(), text))).collect::<Vec<_>>()
    } else { files.iter().find(|(name, _)| *name == "snapback/schema.q").map(|(_, text)| vec![("schema.q".to_owned(), text.clone())]).unwrap_or_default() };
    for version in ["v1", "v2"] {
        if dir.join("versions").join(version).exists() { continue; }
        // Init is a one-shot CLI operation. Destinations live for this invocation's
        // plan, whose existing interface uses static generated names.
        for (name, text) in &sources {
            let path: &'static str = Box::leak(format!("versions/{version}/{name}").into_boxed_str());
            files.push((path, text.clone()));
        }
        let marker: &'static str = Box::leak(format!("versions/{version}/fixtures/.gitkeep").into_boxed_str());
        files.push((marker, String::new()));
        let mut fixtures = files.iter().filter_map(|(name, text)| name.strip_prefix("fixtures/").map(|name| (name.to_owned(), text.clone()))).collect::<Vec<_>>();
        if fixtures.is_empty() {
            if let Ok(entries) = std::fs::read_dir(dir.join("fixtures")) {
                for entry in entries.flatten().filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl")) {
                    if let Ok(text) = std::fs::read_to_string(entry.path()) { fixtures.push((entry.file_name().to_string_lossy().into_owned(), text)); }
                }
            }
        }
        for (name, text) in fixtures {
            let path: &'static str = Box::leak(format!("versions/{version}/fixtures/{name}").into_boxed_str());
            files.push((path, text));
        }
    }
    files.push(("scripts/frontend-proof.mjs", proof));
    files.push(("scripts/day2-proof.mjs", include_str!("day2-proof.mjs").to_owned()));
    files.push(("scripts/launch.mjs", include_str!("launch.mjs").replace("BACKEND", &backend.to_string()).replace("FRONTEND", &frontend.to_string())));
    for (name, text) in files.iter_mut().filter(|(name, _)| *name == "package.json") {
        let mut package: Value = serde_json::from_str(text).unwrap();
        package["scripts"]["frontend:proof"] = json!("node scripts/frontend-proof.mjs");
        package["scripts"]["day2:proof"] = json!("node scripts/day2-proof.mjs versions/v1 versions/v2");
        package["scripts"]["proof:web"] = json!("node scripts/frontend-proof.mjs");
        package["devDependencies"]["playwright-core"] = json!("1.55.1");
        package["scripts"]["backend"] = json!("node scripts/launch.mjs backend");
        if web {
            package["scripts"]["dev"] = json!("node scripts/launch.mjs vite");
            package["scripts"]["preview"] = json!("node scripts/launch.mjs vite-preview");
        } else {
            package["scripts"]["start"] = json!("node scripts/launch.mjs expo");
            package["scripts"]["web"] = json!("node scripts/launch.mjs expo-web");
            package["scripts"]["native:smoke"] = json!("node scripts/launch.mjs native-smoke");
        }
        *text = pretty(&package);
        let _ = name;
    }
}

fn frontend_proof(source: &str, template: Option<&str>, web: bool) -> String {
    // Social keeps account controls on its Profile tab; prove the actual route.
    let mut proof = source.replace("// TEMPLATE_READY", if template == Some("social") {
        "await page.getByText(\"Profile\", { exact: true }).click();"
    } else { "" });
    if template == Some("social") {
        proof = proof.replace("getByLabel(\"Task\"", "getByLabel(\"Display name\"")
            .replace("name: \"Add\"", "name: \"Save profile\"")
            .replace("beginForm(\"add\", { title }", "beginForm(\"saveProfile\", { name: title }");
    } else if template == Some("chat") {
        proof = proof.replace("    const task =", r#"    const viewer = await page.evaluate(() => window.__snapback4Witness.viewer());
    const seeded = await fetch(`${dev.url}/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([
      { table: "conversations", row: { id: "proof-room", title: "Proof room", creatorId: viewer } },
      { table: "memberships", row: { id: "proof-member", conversationId: "proof-room", principal: viewer, role: "admin", joinedAt: Date.now() } }
    ]) });
    assert.ok(seeded.ok, await seeded.text());
    await page.getByText("Proof room", { exact: true }).click();
    const task ="#)
            .replace("page.getByLabel(\"Task\", { exact: true })", "page.getByPlaceholder(\"Message\", { exact: true })")
            .replace("name: \"Add\"", "name: \"Send\"")
            .replace("beginForm(\"add\", { title }", "beginForm(\"send\", { conversationId: \"proof-room\", body: title }");
        // Chat receipts echo drafts. Restrict evidence to its message display.
        if web { proof = proof.replace("renderedText(page, new RegExp(title))", "renderedText(page, new RegExp(title), { within: page.getByRole(\"region\", { name: \"Thread\" }) })"); }
    }
    proof = proof.replace("BUILD_SCRIPT", if web { "build" } else { "build:web" });
    proof
}

fn previous_frontend(dir: &std::path::Path, web: bool) -> Option<Option<&'static str>> {
    let text = std::fs::read_to_string(dir.join("scripts/frontend-proof.mjs")).ok()?;
    [None, Some("chat"), Some("social")].into_iter().find(|template| {
        [include_str!("previous/frontend-proof-0.4.28.mjs"), include_str!("previous/frontend-proof-0.4.29.mjs")]
            .iter().any(|source| text == frontend_proof(source, *template, web))
    })
}

/// Adapt adds missing proof infrastructure, preserving files and script names
/// already owned by the application. It never runs a package manager.
pub(super) fn plan(dir: &std::path::Path, own: &super::OwnSchema) -> std::io::Result<Vec<(&'static str, String)>> {
    let web = dir.join("src/App.tsx").is_file();
    let router = dir.join("app/_layout.tsx").is_file();
    if !web && !dir.join("App.tsx").is_file() && !router { return Ok(Vec::new()); }
    let shape = super::starter::Shape { title: super::title(dir), password: own.identity.is_some_and(|(p, g)| p && !g),
        personas: own.identity.is_none().then(|| own.personas.clone()).filter(|p| !p.is_empty()),
        body: super::starter::Body::Home(None), offline: own.offline.clone() };
    let path = dir.join("package.json");
    let text = std::fs::read_to_string(&path)?;
    let mut package: Value = serde_json::from_str(&text).map_err(std::io::Error::other)?;
    let router = router && !web && package["main"] == "expo-router/entry";
    if !web && !dir.join("App.tsx").is_file() && !router { return Ok(Vec::new()); }
    let original = package.clone();
    let backend = package["scripts"]["backend"].as_str().and_then(|s| s.strip_prefix("snapback4 dev --port ")).and_then(|s| s.parse::<u16>().ok())
.or_else(|| launcher_port(dir, "backend")).unwrap_or(4400);
    let frontend = launcher_port(dir, "frontend").or_else(|| package["scripts"][if web { "dev" } else { "start" }].as_str()
        .and_then(|s| s.split_once("--port ")).and_then(|(_, rest)| rest.split_whitespace().next()).and_then(|n| n.parse::<u16>().ok())
        .or_else(|| std::fs::read_to_string(dir.join("vite.config.mts")).ok().and_then(|s| s.split_once("server: { port: ").and_then(|(_, rest)| rest.split(|c: char| !c.is_ascii_digit()).next()).and_then(|n| n.parse::<u16>().ok())))
        ).unwrap_or(if backend != 4400 { backend.saturating_add(1) } else if web { 5173 } else { 8081 });
    let mut generated = vec![("package.json", pretty(&package))];
    files(&mut generated, &Options { positionals: vec![dir.to_string_lossy().into_owned()], flags: if router { [("template".into(), "social".into())].into() } else { Default::default() }, json: false }, backend, frontend, web, &shape);
    // A saved version is immutable application evidence. Never fill its missing
    // fixture files from today's working release during an adaptation.
    generated.retain(|(name, _)| !name.starts_with("versions/") || {
        let version = name.split('/').nth(1).unwrap();
        !dir.join("versions").join(version).exists()
    });
    generated.retain_mut(|(name, text)| {
        let Some(rest) = name.strip_prefix("versions/") else { return true; };
        let (version, leaf) = rest.split_once('/').unwrap();
        let legacy = dir.join("versions").join(format!("{version}.q"));
        if !legacy.is_file() { return true; }
        if leaf == "schema.q" { *text = std::fs::read_to_string(legacy).unwrap_or_else(|_| text.clone()); true }
        else { leaf == "fixtures/.gitkeep" }
    });
    let wanted: Value = serde_json::from_str(&generated[0].1).unwrap();
    for group in ["scripts", "devDependencies"] {
        if !package[group].is_object() { package[group] = json!({}); }
        for (key, value) in wanted[group].as_object().unwrap() {
            let old = package[group].get(key).and_then(Value::as_str);
            let managed = group == "scripts" && old.is_some_and(|old| match key.as_str() {
                "day2:proof" => old == "node scripts/day2-proof.mjs",
                "backend" => old.strip_prefix("snapback4 dev --port ").is_some_and(|n| n.parse::<u16>().is_ok()),
                "dev" | "preview" => old.strip_prefix(if key == "dev" { "vite --port " } else { "vite preview --port " }).and_then(|s| s.strip_suffix(" --strictPort")).is_some_and(|n| n.parse::<u16>().is_ok()),
                "start" | "web" => old.strip_prefix(if key == "start" { "expo start --port " } else { "expo start --web --port " }).is_some_and(|n| n.parse::<u16>().is_ok()),
                _ => false,
            });
            if managed || ((key == "frontend:proof" || key == "day2:proof" || key == "playwright-core") && old.is_none()) { package[group][key] = value.clone(); }
        }
    }
    let mut config_changes = Vec::new();
    if web {
        if let Ok(current) = std::fs::read_to_string(dir.join("vite.config.mts")) {
            // Replace only the exact initializer forms, allowing their port literals.
            let numbers = current.split("port: ").skip(1).filter_map(|s| s.split(|c: char| !c.is_ascii_digit()).next()?.parse::<u16>().ok()).collect::<Vec<_>>();
            let mut normalized = current.clone();
            for number in &numbers { normalized = normalized.replace(&format!("port: {number}"), "port: 5173"); }
            let reference = include_str!("starter/web/vite.config.mts").replace("port: 4173", "port: 5173");
            if normalized == reference { config_changes.push(("vite.config.mts", runtime_vite(&current, backend, numbers.first().copied().unwrap_or(5173)))); }
        }
    }
    let inherited_frontend = previous_frontend(dir, web);
    if let Some(template) = inherited_frontend {
        if let Some((_, text)) = generated.iter_mut().find(|(name, _)| *name == "scripts/frontend-proof.mjs") {
            *text = frontend_proof(include_str!("frontend-proof.mjs"), template, web);
        }
    }
    let mut additions: Vec<_> = generated.into_iter().skip(1)
        .filter(|(name, _)| !dir.join(name).exists() || (*name == "scripts/frontend-proof.mjs" && inherited_frontend.is_some()) || (*name == "scripts/day2-proof.mjs" && std::fs::read_to_string(dir.join(name)).ok().is_some_and(|text| text == include_str!("previous/day2-proof-0.4.28.mjs") || text == include_str!("previous/day2-proof-0.4.29.mjs")))) .collect();
    additions.extend(config_changes);
    if package != original { additions.push(("package.json", pretty(&package))); }
    Ok(additions)
}

fn launcher_port(dir: &std::path::Path, name: &str) -> Option<u16> {
    let text = std::fs::read_to_string(dir.join("scripts/launch.mjs")).ok()?;
    // Recognize the generated fallback expression, not client application code.
    let marker = if name == "backend" { "low === null ? " } else { ": low === null ? " };
    text.split_once(marker)?.1.split_whitespace().next()?.parse().ok()
}


pub(super) fn apply(dir: &std::path::Path, additions: &[(&str, String)]) -> std::io::Result<()> {
    for (name, body) in additions {
        let path = dir.join(name);
        std::fs::create_dir_all(path.parent().unwrap())?;
        if *name == "package.json" || *name == "vite.config.mts" || *name == "scripts/frontend-proof.mjs" || *name == "scripts/day2-proof.mjs" { super::replace_file(&path, body)?; }
        else {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
            file.write_all(body.as_bytes())?;
        }
    }
    Ok(())
}

/// Environment is evaluated whenever Vite loads the config, never at init time.
pub(super) fn runtime_vite(text: &str, backend: u16, frontend: u16) -> String {
    if text.contains("const proofRange") { return text.to_owned(); }
    let header = format!(r#"const proofRange = [process.env.PORT_LO, process.env.PORT_HI];
if (proofRange.some(v => v !== undefined) && (!proofRange.every(v => v && /^\d+$/.test(v)) || Number(proofRange[0]) < 1 || Number(proofRange[1]) > 65535 || Number(proofRange[0]) >= Number(proofRange[1]))) throw Error("PORT_LO/PORT_HI must provide at least two valid ports");
const backendPort = proofRange[0] === undefined ? {backend} : Number(proofRange[0]);
const frontendPort = proofRange[0] === undefined ? {frontend} : backendPort + 1;
process.env.VITE_SNAPBACK_URL ??= `http://127.0.0.1:${{backendPort}}`;
"#);
    let mut result = text.to_owned();
    // All generated configurations have literal ports; preserve unrelated config.
    for port in [frontend, 5173, 4173] { result = result.replace(&format!("port: {port}"), "port: frontendPort"); }
    format!("{header}{result}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn historical_frontend_templates_keep_assertions_and_gain_their_own_build() {
        for (version, source) in [
            (28, include_str!("previous/frontend-proof-0.4.28.mjs")),
            (29, include_str!("previous/frontend-proof-0.4.29.mjs")),
        ] {
            for web in [false, true] {
                for template in [None, Some("chat"), Some("social")] {
                    let dir = std::env::temp_dir().join(format!("day3-historical-proof-{}-{version}-{web}-{template:?}", std::process::id()));
                    std::fs::create_dir_all(dir.join("snapback")).unwrap();
                    std::fs::create_dir_all(dir.join("scripts")).unwrap();
                    let screen = if web { "src/App.tsx" } else { "App.tsx" };
                    std::fs::create_dir_all(dir.join(screen).parent().unwrap()).unwrap();
                    std::fs::write(dir.join(screen), "// screen").unwrap();
                    std::fs::write(dir.join("package.json"), r#"{"scripts":{}}"#).unwrap();
                    std::fs::write(dir.join("snapback/schema.q"), "query alive():\n  return true\n").unwrap();
                    let path = dir.join("scripts/frontend-proof.mjs");
                    std::fs::write(&path, frontend_proof(source, template, web)).unwrap();
                    let own = super::super::own_schema(&dir).unwrap().unwrap();
                    let changes = plan(&dir, &own).unwrap();
                    let updated = &changes.iter().find(|(name, _)| *name == "scripts/frontend-proof.mjs").unwrap().1;
                    assert_eq!(updated, &frontend_proof(include_str!("frontend-proof.mjs"), template, web));
                    assert!(updated.contains(if web { "[\"run\", \"build\"]" } else { "[\"run\", \"build:web\"]" }));
                    if template == Some("social") { assert!(updated.contains("Save profile") && updated.contains("getByText(\"Profile\"")); }
                    if template == Some("chat") { assert!(updated.contains("Proof room") && updated.contains("name: \"Send\"")); }
                    std::fs::write(path, format!("{}\n// app-owned assertion\n", frontend_proof(source, template, web))).unwrap();
                    assert!(!plan(&dir, &own).unwrap().iter().any(|(name, _)| *name == "scripts/frontend-proof.mjs"));
                    std::fs::remove_dir_all(dir).unwrap();
                }
            }
        }
    }
}
