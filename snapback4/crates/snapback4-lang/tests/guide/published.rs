//! Prose references must be usable from an installed package, without a checkout.
use std::{collections::BTreeSet, fs, path::Path};
use super::card;

fn shipped_files() -> BTreeSet<String> {
    let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback4");
    let manifest: serde_json::Value = serde_json::from_str(&fs::read_to_string(package.join("package.json")).unwrap()).unwrap();
    fn visit(root: &Path, path: &Path, files: &mut BTreeSet<String>) {
        if path.is_dir() {
            for entry in fs::read_dir(path).unwrap() { visit(root, &entry.unwrap().path(), files); }
        } else if path.is_file() {
            files.insert(path.strip_prefix(root).unwrap().to_str().unwrap().to_owned());
        }
    }
    let mut files = BTreeSet::from(["package.json".to_owned()]);
    for entry in manifest["files"].as_array().unwrap() {
        visit(&package, &package.join(entry.as_str().unwrap()), &mut files);
    }
    files
}

// These are application inputs/outputs described by the cards, not dependencies
// on repository files. Keep exact paths: accepting an entire src/ tree would
// admit the unshipped adoption instructions that prompted this regression.
const APP_FILES: &[&str] = &[
    "snapback/schema.q", "snapback/social.q", "snapback/jobs.q", "snapback/*.q",
    "snapback/server.ts", "snapback/worker.ts", "snapback/worker.mts",
    "snapback/generated/api.ts", "snapback/generated/server.ts",
    "snapback/generated/native.rs", "snapback/generated/native.wasm",
    "snapback/generated/package.json", "snapback/generated/residency.json",
    "snapback/native/Cargo.toml", ".snapback4/store.sqlite",
    ".snapback4/dev-refusals/<storeId>/<instance>.json",
    "src/client.ts", "src/Inbox.tsx", "src/Thread.tsx", "src/witness.ts",
    "about/index.html", "artifacts/native-smoke/smoke-ios-run.json",
    "snapback/organizations.q", "src/following.ts", "generated/residency.json",
    "api.ts", "server.ts", "schema.q", "m.q", "digest.q", "mail.q", "hooks.q",
    "App.tsx", "metro.config.js", "metro.config.cjs", "metro-wasm-transformer.cjs",
    "snapback4-sw.js", "contact.html", "about.html", "store.sqlite",
    "<dir>/store.sqlite", "<segment>-ios-run.json", "<segment>-ios-screen.mp4",
    "<segment>-ios-receipts.jsonl", "/api.ts", "/native.wasm",
    "index.html", "<table>.jsonl", "releases.jsonl", "backend.json",
];

fn accessible(target: &str, shipped: &BTreeSet<String>, application_path: bool) -> bool {
    let target = target.split(['#', '?']).next().unwrap();
    if target.is_empty() { return true; }
    let repository_path = if let Some(path) = target.strip_prefix("https://github.com/expo/snapback/blob/") {
        Some(path.split_once('/').map_or(path, |(_, path)| path))
    } else if let Some(path) = target.strip_prefix("https://raw.githubusercontent.com/expo/snapback/") {
        Some(path.split_once('/').map_or(path, |(_, path)| path))
    } else { None };
    if let Some(path) = repository_path {
        // A repository-root README is not the package README. Require the
        // actual package directory before testing shipped-file membership.
        return path.strip_prefix("snapback4/packages/snapback4/")
            .is_some_and(|path| shipped.contains(path));
    }
    if target.starts_with("https://") || target.starts_with("http://") {
        // Web pages need no local file. File links still require shipped bytes.
        let path = target.split_once("://").unwrap().1.split_once('/').map_or("", |(_, p)| p);
        return !path.rsplit('/').next().unwrap().contains('.');
    }
    let target = target.strip_prefix("snapback4/packages/snapback4/").unwrap_or(target);
    let target = target.strip_prefix("./").unwrap_or(target);
    shipped.contains(target) || (application_path && APP_FILES.contains(&target))
}

pub(super) fn contains_llp_reference(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.match_indices("llp").any(|(index, _)| {
        let before = lower[..index].chars().next_back();
        let after = lower[index + 3..].trim_start_matches(|c: char|
            c.is_whitespace() || "-–—_:#*`".contains(c));
        !before.is_some_and(|c| c.is_ascii_alphanumeric())
            && after.starts_with(|c: char| c.is_ascii_digit())
    })
}

fn unshipped(doc: &str, shipped: &BTreeSet<String>) -> Vec<String> {
    let mut failures = Vec::new();
    let mut fenced = false;
    for line in doc.lines() {
        if line.trim_start().starts_with("```") { fenced = !fenced; continue; }
        // Snippets create app files and import app modules; this checks prose.
        if fenced || line.contains(concat!("@", "ref ")) { continue; }
        if contains_llp_reference(line) { failures.push(line.to_owned()); }
        let reference = line.trim_start().starts_with('[').then(|| line.split_once("]:")).flatten();
        let line = reference.map_or(line, |(_, target)| target);
        for token in line.split_whitespace() {
            // Inline links (also wrapped across lines), autolinks, bare paths,
            // and reference-style link definitions all reach the same check.
            let link_target = token.rsplit_once("](");
            let token = link_target.map_or(token, |(_, target)| target);
            // Remove Markdown emphasis/code delimiters before classifying a
            // bare path, including punctuation outside the closing delimiter.
            let token = token.trim_start_matches(|c: char| "*_~`[()\"'".contains(c))
                .trim_end_matches(|c: char| "*_~`[]()\"',;:.".contains(c));
            let token = if token.starts_with("<http") { token.trim_matches(['<', '>']) } else { token };
            let linked = link_target.is_some() || token.starts_with("http://") || token.starts_with("https://")
                || reference.is_some();
            let path = token.split(['#', '?']).next().unwrap();
            let extension = path.rsplit('/').next().unwrap().rsplit_once('.');
            let file = extension.is_some_and(|(stem, ext)| !stem.is_empty() &&
                ((path.contains('/') && ext.chars().any(|c| c.is_ascii_alphabetic()) && ext.chars().all(|c| c.is_ascii_alphanumeric())) ||
                ["md", "rs", "ts", "tsx", "js", "mjs", "cjs", "json", "jsonl", "toml", "q", "wasm", "h", "html", "sqlite", "sh", "txt", "mp4"].contains(&ext)));
            if token.ends_with("]:") { continue; }
            if (linked || file) && !accessible(token, shipped, !linked) { failures.push(token.to_owned()); }
        }
    }
    failures
}

#[test]
fn published_file_references_resolve_against_package_contents() {
    let shipped = shipped_files();
    let mut failures = Vec::new();
    for name in snapback4_lang::guide::KEYWORDS {
        failures.extend(unshipped(card(name).unwrap(), &shipped).into_iter().map(|p| format!("guide {name}: {p}")));
    }
    let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback4");
    for name in shipped.iter().filter(|p| p.ends_with(".md")) {
        failures.extend(unshipped(&fs::read_to_string(package.join(name)).unwrap(), &shipped).into_iter().map(|p| format!("{name}: {p}")));
    }
    assert!(failures.is_empty(), "unshipped references:\n{}", failures.join("\n"));
}

#[test]
fn published_path_guard_rejects_astras_counterexample_and_unlisted_files() {
    let shipped = shipped_files();
    for text in [
        "must follow the [adoption instructions](https://github.com/expo/snapback/blob/main/snapback4/crates/snapback4-lang/src/recipe/ADOPTION.md)",
        "See `src/recipe/ADOPTION.md`.",
        "Required procedure: **src/recipe/ADOPTION.md**.",
        "Required procedure: **ADOPTION.md**.",
        "Required procedure: [instructions](https://github.com/expo/snapback/blob/main/README.md).",
        "Required procedure: LLP-3000.028.",
        "Required procedure: __src/recipe/ADOPTION.md__.",
        "Required procedure: *ADOPTION.md*.",
        "Required procedure: LLP_3000.028.",
        "Required procedure: LLP3000.028.",
        "Required procedure: llp: 3000.028.",
        "Read https://raw.githubusercontent.com/expo/snapback/main/README.md.",
        "Read https://github.com/other/repo/blob/main/snapback4/packages/snapback4/README.md.",
        "Read [details](./unpublished-new-name.md).",
        "Read unlisted/new-file.rs first.",
        "<https://github.com/ccheever/snapback/blob/main/snapback4/crates/snapback4-device/include/snapback4.h>",
        "[details]: ./private/new.md",
        "Read [details](./dist/missing.js).",
        "Read [details](./MISSING).",
        "Read `private/unknown.xyz`.",
        "Read [escape](../README.md).",
        "Read [details](https://example.com/private/new.md).",
    ] { assert!(!unshipped(text, &shipped).is_empty(), "accepted {text}"); }
    for text in ["Read [client](./CLIENT-AND-OPERATIONS.md#react).", "Read [adoption](./FOLLOWING-ADOPTION.md).", "[client]: ./CLIENT-AND-OPERATIONS.md", "Run `snapback4 guide receipts`.", "Edit `snapback/schema.q`.", "Generated local evidence: `.snapback4/dev-refusals/<storeId>/<instance>.json`."] {
        assert!(unshipped(text, &shipped).is_empty(), "refused {text}");
    }
    for text in [
        "Read **FOLLOWING-ADOPTION.md**.",
        "Read [client](https://github.com/expo/snapback/blob/main/snapback4/packages/snapback4/README.md).",
        "Read https://raw.githubusercontent.com/expo/snapback/main/snapback4/packages/snapback4/README.md.",
    ] { assert!(unshipped(text, &shipped).is_empty(), "refused {text}"); }
    let without_adoption = shipped.into_iter().filter(|p| p != "FOLLOWING-ADOPTION.md").collect();
    assert!(!unshipped("[adoption](./FOLLOWING-ADOPTION.md)", &without_adoption).is_empty());
}

#[test]
fn client_teaches_sdk_delivery_and_screen_seen() {
    let client = card("client").unwrap();
    assert!(client.contains("SDK owns delivery reporting"));
    assert!(client.contains("screen owns visible `seen` reporting"));
    for name in ["client", "receipts", "sync"] {
        let text = card(name).unwrap();
        assert!(!text.contains("background (`visible: false`) delivery hooks"));
        assert!(!text.contains("delivery hooks only after"));
    }
    let receipts = card("receipts").unwrap();
    assert!(receipts.contains("SDK reports delivered positions"));
    assert!(receipts.contains("even with no\nconversation mounted"));
}
