//! The Expo native ABI is versioned with the core package, including patch versions.
use crate::project::Project;
use serde_json::Value;

pub(super) fn warn(project: &Project) {
    let installed = |name: &str| -> Option<String> {
        let mut dir = Some(project.root.as_path());
        while let Some(root) = dir {
            let path = root.join("node_modules").join(name).join("package.json");
            if let Ok(text) = std::fs::read_to_string(path) {
                return serde_json::from_str::<Value>(&text).ok()?.get("version")?.as_str().map(str::to_owned);
            }
            dir = root.parent();
        }
        None
    };
    if let (Some(core), Some(expo)) = (installed("snapback4"), installed("snapback4-expo"))
        && core != expo {
        eprintln!("check: WARNING: snapback4 {core} and snapback4-expo {expo} differ; the Expo adapter requires the exact core version. Upgrade both with: bun add snapback4@latest snapback4-expo@latest; then rebuild the native app.");
    }
}
