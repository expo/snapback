//! One npm loop for generated UI starters; application scripts remain editable.
use serde_json::{Value, json};
// @ref LLP 3000.037.000#14-wave-34-one-verify-loop-ver1 — check owns generation before TypeScript; verify stops on the first red.
pub(super) fn files(files: &mut Vec<(&'static str, String)>, password: bool) {
    files.push(("scripts/verify.mjs", super::without_design_references(include_str!("verify.mjs"))));
    files.push(("scripts/verify-parent.mjs", super::without_design_references(include_str!("verify-parent.mjs"))));
    if !password {
        files.push(("scripts/probe-serve.mjs", include_str!("probe-serve.mjs").into()));
        files.push(("scripts/probe-check.mjs", include_str!("password-probe-check.mjs").into()));
    }
    for (_, text) in files.iter_mut().filter(|(name, _)| *name == "package.json") {
        let mut package: Value = serde_json::from_str(text).unwrap();
        let scripts = &mut package["scripts"];
        if !scripts["typecheck"].is_string() {
            scripts["typecheck"] = scripts["check"].as_str().map(|s| json!(s)).unwrap_or(json!("tsc --noEmit"));
        }
        scripts["check"] = json!("snapback4 check && npm run --silent typecheck && echo \"Next: wire app assertions, then npm run verify (all four phases). Codex: yield_time_ms=30000.\"");
        // Starter fixture acceptance is replaced by the app's authored scenario.
        scripts["acceptance"] = json!("snapback4 test");
        scripts["verify"] = json!("node scripts/verify.mjs");
        if !password {
            scripts["probe:serve"] = json!("exec node scripts/probe-serve.mjs");
            scripts["probe:check"] = json!("node scripts/probe-check.mjs");
        }
        *text = super::pretty(&package);
    }
}
