use serde_json::{Value, json};
use std::{fs, path::PathBuf, process::Command, sync::atomic::{AtomicUsize, Ordering}};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
struct Dir(PathBuf);
impl Dir {
    fn new() -> Self {
        static SERIAL: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!("sb4-init-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap(); Self(path)
    }
    fn run(&self, flag: &str) -> std::process::Output { Command::new(BIN).args(["init", flag]).current_dir(&self.0).output().unwrap() }
}
impl Drop for Dir { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

fn recipe(dir: &Dir, extra: &[&str]) -> std::process::Output {
    Command::new(BIN).args(["init", "--recipe", "feeds"]).args(extra).current_dir(&dir.0).output().unwrap()
}

fn check_recipe(dir: &Dir) {
    let written = fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap();
    let card = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).remove(0);
    assert_eq!(written, card.replace(": purgeRemoved\n", ": feed.purgeRemoved\n"), "only the module's schedule target is qualified");
    let bound = snapback4_lang::compile(&[("feed.q".into(), written.clone())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert_eq!(bound.schema.operations["feed.following"].runs.as_deref(), Some("device"));
    assert_eq!(bound.schema.schedules[0].target, "feed.purgeRemoved");
    let output = Command::new(BIN).args(["check", "--json"]).current_dir(&dir.0).output().unwrap();
    assert!(output.status.success(), "{output:?}");
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let starter = snapback4_lang::compile(&[("schema.q".into(), fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap())]);
    assert_eq!(report["notes"], serde_json::to_value(&starter.notes).unwrap(), "the recipe must add no notes: {report}");
    let api = fs::read_to_string(dir.0.join("snapback/generated/api.ts")).unwrap();
    assert!(api.contains("feed.following") && api.contains("feed.register"), "{api}");
    assert!(dir.0.join("src/following.ts").is_file());
    println!("recipe check: {} tables, {} operations, 0 diagnostics, 0 recipe notes ({} starter notes); module: {} lines, {} bytes; check: {} ms", report["tables"], report["operations"], starter.notes.len(), written.lines().count(), written.len(), report["ms"]);
}

#[test]
fn feeds_recipe_initializes_empty_and_fresh_expo_projects() {
    for extra in [&[][..], &["--expo"][..]] {
        let dir = Dir::new();
        let output = recipe(&dir, extra);
        assert!(output.status.success(), "{output:?}");
        assert!(dir.0.join("snapback/schema.q").is_file());
        check_recipe(&dir);
    }
}

#[test]
fn feeds_recipe_adds_to_existing_starters_without_changing_their_files() {
    for flag in ["", "--expo", "--online"] {
        let dir = Dir::new();
        assert!(dir.run(flag).status.success());
        let check = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        assert!(check.status.success(), "{check:?}");
        fn snapshot(dir: &std::path::Path) -> Vec<(PathBuf, Vec<u8>)> {
            let mut files = Vec::new();
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() { files.extend(snapshot(&path)); } else { files.push((path.clone(), fs::read(path).unwrap())); }
            }
            files
        }
        let before = snapshot(&dir.0);
        let output = recipe(&dir, &[]);
        assert!(output.status.success(), "{output:?}");
        for (path, bytes) in before { assert_eq!(fs::read(&path).unwrap(), bytes, "{} changed", path.display()); }
        check_recipe(&dir);
    }
}

#[test]
fn feeds_recipe_conflicts_leave_every_destination_untouched() {
    for existing in [false, true] {
        for name in ["snapback/feed.q", "src/following.ts"] {
            let dir = Dir::new();
            if existing { assert!(dir.run("--expo").status.success()); }
            let path = dir.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, "kept").unwrap();
            let output = recipe(&dir, &[]);
            assert_eq!(output.status.code(), Some(1), "{output:?}");
            assert_eq!(String::from_utf8_lossy(&output.stderr), format!("./{name} already exists\n"));
            assert_eq!(fs::read_to_string(path).unwrap(), "kept");
            let other = if name.ends_with(".q") { "src/following.ts" } else { "snapback/feed.q" };
            assert!(!dir.0.join(other).exists());
            assert_eq!(dir.0.join("snapback/schema.q").exists(), existing);
        }
    }
    let dir = Dir::new();
    assert!(recipe(&dir, &[]).status.success());
    assert_eq!(recipe(&dir, &[]).status.code(), Some(1));
}

#[test]
fn feeds_recipe_requires_a_known_name_before_writing() {
    for args in [vec!["init", "--recipe"], vec!["init", "--recipe", "unknown"]] {
        let dir = Dir::new();
        let output = Command::new(BIN).args(args).current_dir(&dir.0).output().unwrap();
        assert_eq!(output.status.code(), Some(2), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stderr).contains("--recipe feeds"));
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }
}

#[test]
fn feeds_recipe_schema_collisions_refuse_before_writing() {
    for (file, name) in [("schema.q", "posts"), ("social.q", "follows"), ("schema.q", "feed"), ("schema.q", "broadcast")] {
        let dir = Dir::new();
        fs::create_dir_all(dir.0.join("snapback")).unwrap();
        fs::write(dir.0.join("snapback/schema.q"), "").unwrap();
        let source = format!("table {name}:\n  title: text <=100\n  read <- allow\n");
        fs::write(dir.0.join("snapback").join(file), &source).unwrap();
        let output = recipe(&dir, &[]);
        println!("collision {name}: stdout={}stderr={}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(error.contains(&format!("table {name}")) && error.contains(&format!("snapback/{file}:1:")) && error.contains("snapback/feed.q:"), "{error}");
        assert!(error.contains(&format!("rename the existing {name} declaration and its references")), "{error}");
        assert_eq!(fs::read_to_string(dir.0.join("snapback").join(file)).unwrap(), source);
        for name in ["snapback/feed.q", "src", ".gitignore"] { assert!(!dir.0.join(name).exists(), "{name} was written"); }
    }
}

#[test]
fn feeds_recipe_non_clashing_app_compiles_before_installing() {
    let dir = Dir::new();
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    fs::write(dir.0.join("snapback/schema.q"), "table notes:\n  title: text <=100\n  read <- allow\n").unwrap();
    fs::write(dir.0.join("snapback/extra.q"), "query notes(c: cursor ?):\n  return notes after c first 10\n").unwrap();
    let output = recipe(&dir, &[]);
    assert!(output.status.success(), "{output:?}");
    check_recipe(&dir);
}

#[test]
fn feeds_recipe_parent_file_refuses_before_writing() {
    let dir = Dir::new();
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    fs::write(dir.0.join("snapback/schema.q"), "").unwrap();
    fs::write(dir.0.join("src"), "kept").unwrap();
    let output = recipe(&dir, &[]);
    println!("parent conflict: {}", String::from_utf8_lossy(&output.stderr));
    assert!(!dir.0.join("snapback/feed.q").exists(), "partial recipe left behind: {output:?}");
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    assert_eq!(String::from_utf8_lossy(&output.stderr), "init: ./src is not a directory; rename it or choose another init directory\n");
    assert_eq!(fs::read_to_string(dir.0.join("src")).unwrap(), "kept");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), "");
    assert!(!dir.0.join(".gitignore").exists());
}

#[cfg(unix)]
#[test]
fn feeds_recipe_late_write_failure_removes_new_files() {
    use std::os::unix::process::CommandExt;
    let dir = Dir::new();
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    fs::write(dir.0.join("snapback/schema.q"), "").unwrap();
    // Both recipe files fit; extending the existing ignore file fails only
    // after they were written. Inject a real OS write error, without a CLI hook.
    let before = "# kept\n".repeat(10_000);
    fs::write(dir.0.join(".gitignore"), &before).unwrap();
    let mut command = Command::new(BIN);
    command.args(["init", "--recipe", "feeds"]).current_dir(&dir.0);
    unsafe { command.pre_exec(|| {
        let limit = libc::rlimit { rlim_cur: 32_768, rlim_max: 32_768 };
        if libc::setrlimit(libc::RLIMIT_FSIZE, &limit) != 0 { return Err(std::io::Error::last_os_error()); }
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
        Ok(())
    }); }
    let output = command.output().unwrap();
    println!("late write failure: {}", String::from_utf8_lossy(&output.stderr));
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    for name in ["snapback/feed.q", "src/following.ts"] { assert!(!dir.0.join(name).exists(), "partial recipe: {name}"); }
    assert_eq!(fs::read_to_string(dir.0.join(".gitignore")).unwrap(), before);
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), "");
    assert!(!fs::read_dir(&dir.0).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
}

#[test]
fn expo_metro_blocks_store_files_and_preserves_expo_exclusions() {
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), r#"{"type":"module"}"#).unwrap();
    assert!(dir.run("--expo").status.success());
    let generated = dir.0.join("metro.config.cjs");
    let reference = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/chat-expo/metro.config.js");
    // Evaluate the actual configs with Expo's resolver shape, including its
    // single-RegExp and array forms, without starting Metro on the host.
    let script = r#"const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
for (const file of process.argv.slice(1)) for (const existing of [undefined, /expo-hidden/, [/expo-hidden/]]) {
  const config = { resolver: { assetExts: [], blockList: existing }, transformer: {} };
  const req = name => name === 'expo/metro-config' ? { getDefaultConfig: () => config } : require(name);
  req.resolve = name => name;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: req, __dirname: path.dirname(file), module: { exports: {} } });
  const blocked = file => [].concat(config.resolver.blockList ?? []).some(re => re.test(file));
  for (const file of ['/app/.snapback4/store.sqlite', '/app/.snapback4/store.sqlite-wal', '/workspace/other/.snapback4/assets/bytes', 'C:\\app\\.snapback4\\store.sqlite-shm']) assert.ok(blocked(file), file);
  for (const file of ['/app/snapback/schema.q', '/app/src/client.ts', '/app/.snapback4-not-store/file']) assert.ok(!blocked(file), file);
  if (existing) assert.ok(blocked('/app/expo-hidden/file'));
  assert.equal(config.resolver.unstable_enablePackageExports, true);
}
console.log('Metro: 2 configs, 3 Expo blockList shapes, store paths excluded and source paths watched');"#;
    let output = Command::new("node").args(["-e", script]).arg(generated).arg(reference).output().unwrap();
    println!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    assert!(output.status.success());
}
#[test]
fn init_merges_packages_and_preserves_unrelated_metadata() {
    for flag in ["--online", "--expo"] {
        let dir = Dir::new();
        let before = json!({"name":"my-app", "private":false, "type":"module", "description":"kept", "dependencies":{"unrelated":"1", "snapback4":env!("CARGO_PKG_VERSION")}, "devDependencies":{"my-tool":"2"}, "scripts":{"test":"my-tests"}});
        fs::write(dir.0.join("package.json"), before.to_string()).unwrap();
        let output = dir.run(flag);
        assert!(output.status.success(), "{output:?}");
        let after: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
        for key in ["name", "private", "type", "description"] { assert_eq!(after[key], before[key]); }
        assert_eq!(after["dependencies"]["unrelated"], "1");
        assert_eq!(after["devDependencies"]["my-tool"], "2");
        assert_eq!(after["scripts"]["test"], "my-tests");
        if flag == "--expo" { assert_eq!(after["scripts"]["start"], "expo start"); assert_eq!(after["devDependencies"]["babel-preset-expo"], "57.0.11"); }
        assert!(dir.0.join("snapback/schema.q").exists());
        if flag == "--expo" {
            assert!(dir.0.join("metro.config.cjs").exists());
            assert!(dir.0.join("babel.config.cjs").exists());
            assert!(!dir.0.join("metro.config.js").exists());
        }
    }
}
#[test]
fn init_conflicts_name_the_key_and_leave_every_destination_untouched() {
    for (group, key) in [("dependencies", "snapback4"), ("devDependencies", "babel-preset-expo"), ("scripts", "start")] {
        let dir = Dir::new();
        let before = json!({group: {key: "different"}}).to_string();
        fs::write(dir.0.join("package.json"), &before).unwrap();
        let output = dir.run("--expo");
        assert_eq!(output.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&output.stderr).contains(&format!("package.json conflict at {group}.{key}: existing \"different\"")), "{output:?}");
        assert_eq!(fs::read_to_string(dir.0.join("package.json")).unwrap(), before);
        assert!(!dir.0.join("snapback").exists());
    }
    for name in ["README.md", "src/client.ts", "metro.config.js", "snapback/schema.q", "snapback/generated/package.json"] {
        let dir = Dir::new();
        let path = dir.0.join(name); fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(&path, "kept").unwrap();
        fs::write(dir.0.join("package.json"), "{}").unwrap();
        assert_eq!(dir.run("--expo").status.code(), Some(1));
        assert_eq!(fs::read_to_string(&path).unwrap(), "kept");
        assert_eq!(fs::read_to_string(dir.0.join("package.json")).unwrap(), "{}");
    }
}

#[cfg(unix)]
#[test]
fn failed_package_write_preserves_original() {
    use std::os::unix::process::CommandExt;
    let dir = Dir::new();
    let before = "{\"name\":\"kept\",\"description\":\"original metadata\"}\n";
    fs::write(dir.0.join("package.json"), before).unwrap();
    let mut command = Command::new(BIN);
    command.args(["init", "--expo"]).current_dir(&dir.0);
    unsafe { command.pre_exec(|| {
        let limit = libc::rlimit { rlim_cur: 512, rlim_max: 512 };
        if libc::setrlimit(libc::RLIMIT_FSIZE, &limit) != 0 { return Err(std::io::Error::last_os_error()); }
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
        Ok(())
    }); }
    let output = command.output().unwrap();
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    assert_eq!(fs::read_to_string(dir.0.join("package.json")).unwrap(), before);
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1, "failed replacement removes its temporary file");
}

#[test]
fn calibration_commonjs_expo_imports_generated_api_from_node_esm() {
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), r#"{"name":"astra-snapback4","version":"1.0.0","type":"commonjs"}"#).unwrap();
    assert!(dir.run("--expo").status.success());
    let check = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
    assert!(check.status.success(), "{check:?}");
    fs::create_dir_all(dir.0.join("scripts")).unwrap();
    fs::write(dir.0.join("scripts/seed.mjs"), "import {api} from '../snapback/generated/api.ts';\nif (!api.send) throw new Error('missing send');\nconsole.log('api import: ok');\n").unwrap();
    let output = Command::new("node").arg("scripts/seed.mjs").current_dir(&dir.0).output().unwrap();
    println!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    assert!(output.status.success(), "{output:?}");
    let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["type"], "commonjs");
}

#[test]
fn init_preserves_existing_commonjs_scripts_and_imports_generated_api() {
    for (package, flag) in [(r#"{"type":"commonjs"}"#, ""), ("{}", "--online"), (r#"{"type":"commonjs"}"#, "--expo")] {
        let dir = Dir::new();
        fs::write(dir.0.join("package.json"), package).unwrap();
        fs::create_dir_all(dir.0.join("snapback")).unwrap();
        let seed = "const assert = require('node:assert/strict');\nmodule.exports = 42;\nassert.equal(module.exports, 42);\nconsole.log('existing CommonJS seed: ok');\n";
        fs::write(dir.0.join("snapback/seed.js"), seed).unwrap();
        let run_seed = || Command::new("node").arg("snapback/seed.js").current_dir(&dir.0).output().unwrap();
        assert!(run_seed().status.success(), "the existing seed must run before init");
        let mut command = Command::new(BIN);
        command.arg("init").current_dir(&dir.0);
        if !flag.is_empty() { command.arg(flag); }
        let init = command.output().unwrap();
        assert!(init.status.success(), "{init:?}");
        assert_eq!(fs::read_to_string(dir.0.join("snapback/seed.js")).unwrap(), seed);
        let output = run_seed();
        println!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(output.status.success(), "init must preserve CommonJS interpretation: {output:?}");
        assert!(!dir.0.join("snapback/package.json").exists());
        let check = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        assert!(check.status.success(), "{check:?}");
        if flag == "--expo" {
            let output = Command::new("node").args(["--check", "snapback/worker.mts"]).current_dir(&dir.0).output().unwrap();
            assert!(output.status.success(), "the generated ESM worker must parse inside the CommonJS app: {output:?}");
        }
        let operation = if flag == "--expo" { "send" } else { "add" };
        fs::write(dir.0.join("import.mjs"), "import {api} from './snapback/generated/api.ts';\nif (!api.OP) throw new Error('missing operation');\nconsole.log('generated api ESM import: ok');\n".replace("OP", operation)).unwrap();
        let output = Command::new("node").arg("import.mjs").current_dir(&dir.0).output().unwrap();
        println!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(output.status.success(), "{output:?}");
        fs::remove_dir_all(dir.0.join("snapback/generated")).unwrap();
        let check = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        assert!(check.status.success(), "{check:?}");
        let rebuilt = Command::new("node").arg("import.mjs").current_dir(&dir.0).output().unwrap();
        assert!(rebuilt.status.success(), "check must rebuild the generated ESM boundary too: {rebuilt:?}");
    }
}

#[test]
fn init_preserves_inherited_module_type_when_creating_root_package() {
    for kind in ["commonjs", "module"] {
        let parent = Dir::new();
        fs::write(parent.0.join("package.json"), json!({"type":kind}).to_string()).unwrap();
        let dir = parent.0.join("app");
        fs::create_dir_all(dir.join("snapback")).unwrap();
        fs::write(dir.join("snapback/seed.js"), "console.log(typeof require);\n").unwrap();
        let run = || Command::new("node").arg("snapback/seed.js").current_dir(&dir).output().unwrap();
        let before = run();
        assert!(before.status.success());
        let init = Command::new(BIN).args(["init", "--online"]).current_dir(&dir).output().unwrap();
        assert!(init.status.success(), "{init:?}");
        let after = run();
        assert!(after.status.success());
        assert_eq!(after.stdout, before.stdout, "init changed the inherited {kind} interpretation");
    }
}
