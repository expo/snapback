use super::*;

/// Wave-30 012E/037E: shared TypeScript works in Node without changing root
/// package metadata or the Expo CommonJS configuration files.
#[test]
fn dx14_shared_typescript_is_esm_under_an_existing_commonjs_package() {
    for platform in ["--web", "--expo"] {
        let dir = Dir::new();
        fs::write(dir.0.join("package.json"), r#"{"type":"commonjs"}"#).unwrap();
        assert!(dir.run(platform).status.success());
        fs::write(dir.0.join("scripts/shared-proof.mjs"), "import { matchesFilter } from '../src/shared.ts';\nimport assert from 'node:assert/strict';\nassert.equal(matchesFilter(false, 'open'), true);\nassert.equal(matchesFilter(true, 'open'), false);\n").unwrap();
        let output = Command::new("node").arg("scripts/shared-proof.mjs").current_dir(&dir.0).output().unwrap();
        assert!(output.status.success(), "{platform}: {output:?}");
        let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["type"], "commonjs");
    }
}

/// Wave-30 014R/030R/044R/050R and 027E: controls own stable names.
#[test]
fn dx14_starters_teach_explicit_labels_and_strict_optional_props() {
    for platform in ["--web", "--expo"] {
        let dir = Dir::new();
        assert!(dir.run(platform).status.success());
        let app = fs::read_to_string(dir.0.join(if platform == "--web" { "src/App.tsx" } else { "App.tsx" })).unwrap();
        let proof = fs::read_to_string(dir.0.join("scripts/frontend-proof.mjs")).unwrap();
        let config: Value = serde_json::from_slice(&fs::read(dir.0.join("tsconfig.json")).unwrap()).unwrap();
        assert_eq!(config["compilerOptions"]["noUncheckedIndexedAccess"], true);
        assert_eq!(config["compilerOptions"]["exactOptionalPropertyTypes"], true);
        if platform == "--web" {
            assert!(app.contains("htmlFor=\"task-filter\"") && app.contains("<select id=\"task-filter\" aria-label=\"Task status\""));
            assert!(app.contains("<textarea id=\"task-title\" aria-label=\"Task\""));
            assert!(proof.contains("getByRole(\"combobox\", { name: \"Task status\", exact: true })"));
        } else {
            assert!(app.contains("accessibilityLabel=\"Task\"") && app.contains("accessibilityLabel=\"Write status\""));
            assert!(!app.contains("accessibilityRole=\"status\""));
            assert!(proof.contains("getByLabel(\"Write status\", { exact: true })"));
            let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
            assert!(client.contains("{ device: nativeDevice } : {}"), "omit optional props instead of assigning undefined: {client}");
        }
    }
}

/// Generated runtime imports are ordinary git content after check.
#[test]
fn dx14_generated_runtime_imports_survive_git_archive_and_owned_ignore_upgrade() {
    let dir = Dir::new(); dir.install_client();
    fs::write(dir.0.join(".gitignore"), "# custom\nkeep-private/\nsnapback/generated/\n# generated map policy\nsnapback/generated/*.map\n# snapback4\n.snapback4/\n").unwrap();
    assert!(dir.run("--web").status.success());
    assert!(Command::new(BIN).arg("check").current_dir(&dir.0).status().unwrap().success());
    let ignore = fs::read_to_string(dir.0.join(".gitignore")).unwrap();
    assert!(ignore.contains("keep-private/") && ignore.contains("# generated map policy\nsnapback/generated/*.map\n"));
    assert!(!ignore.lines().any(|line| line == "snapback/generated/"));
    for args in [vec!["init", "--quiet"], vec!["add", "snapback/generated"]] {
        let output = Command::new("git").args(args).current_dir(&dir.0).output().unwrap();
        assert!(output.status.success(), "{output:?}");
    }
    let output = Command::new("git").args(["ls-files", "snapback/generated"]).current_dir(&dir.0).output().unwrap();
    let tracked = String::from_utf8_lossy(&output.stdout);
    assert!(tracked.contains("api.ts") && tracked.contains("package.json"), "{tracked}");
    let tree = Command::new("git").arg("write-tree").current_dir(&dir.0).output().unwrap();
    assert!(tree.status.success(), "{tree:?}");
    let copy = Dir::new(); copy.install_client();
    let archive = copy.0.join("source.tar");
    let output = Command::new("git").args(["archive", "--format=tar", "--output"]).arg(&archive).arg(String::from_utf8_lossy(&tree.stdout).trim()).current_dir(&dir.0).output().unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(Command::new("tar").args(["xf"]).arg(archive).current_dir(&copy.0).status().unwrap().success());
    fs::write(copy.0.join("proof.mjs"), "import { api } from './snapback/generated/api.ts';\nif (!api.add) throw Error('missing runtime import');\n").unwrap();
    let output = Command::new("node").arg("proof.mjs").current_dir(&copy.0).output().unwrap();
    assert!(output.status.success(), "git copy must execute its generated runtime imports: {output:?}");
}

/// Actual 0.4.32 proof bytes cannot acquire controls/imports from a screen
/// refresh that adaptation refused because the application owns its source.
#[test]
fn dx14_historical_proof_stays_with_the_authored_screen_or_shared_module() {
    for platform in ["--web", "--expo"] { for collision in [false, true] {
        let dir = Dir::new(); assert!(dir.run(platform).status.success());
        let app_path = dir.0.join(if platform == "--web" { "src/App.tsx" } else { "App.tsx" });
        if collision { fs::write(dir.0.join("src/shared.ts"), "// application-owned helper\n").unwrap(); }
        else {
            fs::write(&app_path, "export function App() { return null; } // application-owned\n").unwrap();
            fs::remove_file(dir.0.join("src/shared.ts")).unwrap();
        }
        let app = fs::read(&app_path).unwrap();
        let historical = include_str!("../../src/verbs/init/previous/frontend-proof-0.4.32.mjs")
            .replace("// TEMPLATE_READY", "")
            .replace("BUILD_SCRIPT", if platform == "--web" { "build" } else { "build:web" })
            .replace("RESULTS_SCOPE", if platform == "--web" { "page.getByRole(\"list\")" } else { "page.getByTestId(\"todo-results\")" });
        fs::write(dir.0.join("scripts/frontend-proof.mjs"), &historical).unwrap();
        let output = dir.init(&["--adapt", "--apply"]);
        assert!(output.status.success(), "{platform} collision={collision}: {output:?}");
        assert_eq!(fs::read(&app_path).unwrap(), app);
        assert_eq!(fs::read_to_string(dir.0.join("scripts/frontend-proof.mjs")).unwrap(), historical);
        if collision { assert_eq!(fs::read_to_string(dir.0.join("src/shared.ts")).unwrap(), "// application-owned helper\n"); }
        else { assert!(!dir.0.join("src/shared.ts").exists()); }
        fs::remove_file(dir.0.join("scripts/frontend-proof.mjs")).unwrap();
        assert!(dir.init(&["--adapt", "--apply"]).status.success());
        assert!(!dir.0.join("scripts/frontend-proof.mjs").exists(), "an unreferenced helper/control cannot be introduced by adding a missing proof either");
    }}
}
