//! Init's explicit online web tier and adaptation preview contract.
use std::{fs, path::PathBuf, process::{Command, Output}, sync::atomic::{AtomicUsize, Ordering}};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Project(PathBuf);
impl Project {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("sb4-dx3-init-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap(); Self(path)
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(BIN).args(args).current_dir(&self.0).env_remove("PORT_LO").env_remove("PORT_HI").output().unwrap()
    }
    fn text(&self, path: &str) -> String { fs::read_to_string(self.0.join(path)).unwrap() }
}
impl Drop for Project { fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); } }
fn ok(output: Output) -> String {
    assert!(output.status.success(), "{output:?}"); String::from_utf8(output.stdout).unwrap()
}
#[test]
fn explicit_online_web_starter_checks_and_keeps_the_choice_when_adapted() {
    let dir = Project::new();
    let output = ok(dir.run(&["init", "--web", "--online"]));
    assert!(output.contains("no device"), "{output}");
    assert!(dir.text("src/client.ts").contains("writes: \"online\""));
    assert!(!dir.text("src/client.ts").contains("webDevice"));
    assert!(!dir.text("snapback/schema.q").contains("sync to"));
    assert!(!dir.text("README.md").contains("works offline"));
    ok(dir.run(&["check"])); ok(dir.run(&["test", "--fixture", "fixtures", "--as", "alice"]));
    let schema = dir.text("snapback/schema.q").replace("use identity ", "use identity password ").replace("  online only", "  sync to .ownerId");
    fs::write(dir.0.join("snapback/schema.q"), schema).unwrap();
    let plan = ok(dir.run(&["init", "--adapt", "--dry-run"]));
    assert!(plan.contains("rewrite src/App.tsx") && plan.contains("preview only"), "{plan}");
    ok(dir.run(&["init", "--adapt"]));
    assert!(dir.text("src/App.tsx").contains("auth.signup"));
    assert!(dir.text("src/client.ts").contains("writes: \"online\"") && !dir.text("src/client.ts").contains("webDevice"));
    assert!(dir.text("README.md").contains("ships no device"));
    ok(dir.run(&["check"]));
}
#[test]
fn online_web_keeps_an_existing_synced_schema_and_supports_personas() {
    for identity in ["use personas alice", "use identity password"] {
        let dir = Project::new(); fs::create_dir(dir.0.join("snapback")).unwrap();
        let schema = format!("{identity}\ntable notes:\n  owner: principal\n  title: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nquery mine():\n  return notes where .owner = viewer first 20 by .id\nmutation add(title: text <=80):\n  return insert notes {{ owner: viewer, title }}\n");
        fs::write(dir.0.join("snapback/schema.q"), &schema).unwrap();
        ok(dir.run(&["init", "--web", "--online"]));
        assert_eq!(dir.text("snapback/schema.q"), schema);
        assert!(dir.text("src/client.ts").contains("writes: \"online\""));
        assert!(!dir.text("src/client.ts").contains("webDevice"));
        ok(dir.run(&["check"]));
    }
}
#[test]
fn dry_run_lists_removals_and_rewrites_without_changing_files() {
    let dir = Project::new(); ok(dir.run(&["init", "--web"]));
    fs::write(dir.0.join("snapback/schema.q"), "use personas alice\ntable notes:\n  body: text <=80\n  public 'shared'\n").unwrap();
    let app = dir.text("src/App.tsx"); let readme = dir.text("README.md"); let fixture = dir.text("fixtures/todos.jsonl");
    let plan = ok(dir.run(&["init", "--adapt", "--dry-run"]));
    assert!(plan.contains("remove fixtures/todos.jsonl") && plan.contains("rewrite src/App.tsx"), "{plan}");
    assert_eq!(dir.text("src/App.tsx"), app); assert_eq!(dir.text("README.md"), readme); assert_eq!(dir.text("fixtures/todos.jsonl"), fixture);
    fs::write(dir.0.join("README.md"), "Application-owned introduction\n").unwrap();
    let applied = ok(dir.run(&["init", "--adapt", "--apply"]));
    assert!(applied.contains("application-owned or modified files stay unchanged: README.md"), "{applied}");
    assert_eq!(dir.text("README.md"), "Application-owned introduction\n");
    assert!(!dir.0.join("fixtures/todos.jsonl").exists());
    assert!(dir.text("src/App.tsx").contains("usePersonaApp"));
}
#[test]
fn preview_flags_require_adapt_and_cannot_be_combined() {
    for args in [vec!["init", "--dry-run"], vec!["init", "--apply"], vec!["init", "--adapt", "--dry-run", "--apply"], vec!["init", "--expo", "--online"], vec!["init", "--web", "--online", "--template", "chat"]] {
        let dir = Project::new(); let result = dir.run(&args);
        assert_eq!(result.status.code(), Some(2), "{args:?}: {result:?}");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }
}

#[test]
fn proof_additions_share_the_complete_nonmutating_adaptation_plan() {
    let dir = Project::new(); ok(dir.run(&["init", "--web"]));
    for file in ["scripts/frontend-proof.mjs", "scripts/day2-proof.mjs"] { fs::remove_file(dir.0.join(file)).unwrap(); }
    let mut package: serde_json::Value = serde_json::from_str(&dir.text("package.json")).unwrap();
    for key in ["frontend:proof", "day2:proof"] { package["scripts"].as_object_mut().unwrap().remove(key); }
    package["devDependencies"].as_object_mut().unwrap().remove("playwright-core");
    fs::write(dir.0.join("package.json"), serde_json::to_string_pretty(&package).unwrap()).unwrap();
    fs::write(dir.0.join("README.md"), "Application-owned introduction\n").unwrap();
    let before = dir.text("package.json");
    for args in [vec!["init", "--adapt", "--dry-run"], vec!["init", "--adapt"]] {
        let output = ok(dir.run(&args));
        assert!(output.contains("add scripts/frontend-proof.mjs") && output.contains("add scripts/day2-proof.mjs") && output.contains("extend package.json") && output.contains("preview only"), "{output}");
        assert_eq!(dir.text("package.json"), before);
        assert!(!dir.0.join("scripts/frontend-proof.mjs").exists());
        assert_eq!(dir.text("README.md"), "Application-owned introduction\n");
    }
    ok(dir.run(&["init", "--adapt", "--apply"]));
    let package: serde_json::Value = serde_json::from_str(&dir.text("package.json")).unwrap();
    assert_eq!(package["scripts"]["frontend:proof"], "node scripts/frontend-proof.mjs");
    assert_eq!(package["devDependencies"]["playwright-core"], "1.55.1");
    assert!(dir.0.join("scripts/day2-proof.mjs").exists());
    assert_eq!(dir.text("README.md"), "Application-owned introduction\n");
}

#[test]
fn every_frontend_template_documents_proofs_and_expo_uses_the_runtime_api() {
    for args in [vec!["init", "--web"], vec!["init", "--web", "--online"], vec!["init", "--expo"], vec!["init", "--web", "--template", "chat"], vec!["init", "--expo", "--template", "chat"], vec!["init", "--template", "social"]] {
        let dir = Project::new(); ok(dir.run(&args));
        let readme = dir.text("README.md");
        for word in ["frontend:proof", "day2:proof", "PORT_LO", "PORT_HI", "CHROME"] { assert!(readme.contains(word), "{args:?}: missing {word}"); }
        let package: serde_json::Value = serde_json::from_str(&dir.text("package.json")).unwrap();
        assert_eq!(package["scripts"]["frontend:proof"], "node scripts/frontend-proof.mjs");
        if args.contains(&"--web") { assert!(dir.text("src/client.ts").contains("new URLSearchParams(window.location.search).get(\"api\")")); }
        else {
            assert!(dir.text("src/client.ts").contains("Platform.OS === \"web\" ? new URLSearchParams(window.location.search).get(\"api\") : null"));
            assert_eq!(package["scripts"]["native:smoke"], "node scripts/launch.mjs native-smoke");
        }
    }
}

#[test]
fn historical_readmes_without_the_exact_proof_appendix_still_adapt() {
    for flag in ["--web", "--expo"] {
        let dir = Project::new(); ok(dir.run(&["init", flag]));
        // Exact pre-FIX28 generated bytes: only the newly appended section is absent.
        let current = dir.text("README.md");
        let historical = current.split_once("\n## Frontend and day-two proofs\n").unwrap().0.to_owned();
        fs::write(dir.0.join("README.md"), &historical).unwrap();
        let plan = ok(dir.run(&["init", "--adapt", "--dry-run"]));
        assert!(plan.contains("README.md") && plan.contains("lacks frontend/day-two proof instructions"), "{plan}");
        ok(dir.run(&["init", "--adapt", "--apply"])); assert_eq!(dir.text("README.md"), current);
        fs::write(dir.0.join("README.md"), &historical).unwrap();
        fs::write(dir.0.join("snapback/schema.q"), "use personas alice\ntable notes:\n  body: text <=80\n  public 'shared'\n").unwrap();
        let plan = ok(dir.run(&["init", "--adapt", "--dry-run"]));
        assert!(plan.contains("README.md") && !plan.contains("modified files"), "{plan}");
        ok(dir.run(&["init", "--adapt", "--apply"]));
        let adapted = dir.text("README.md"); assert!(adapted.contains("Home") && adapted.contains("frontend:proof"));
        fs::write(dir.0.join("README.md"), format!("{adapted}\nMy notes.\n")).unwrap();
        ok(dir.run(&["init", "--adapt", "--apply"])); assert!(dir.text("README.md").ends_with("My notes.\n"));
    }
}
