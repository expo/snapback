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
        assert!(error.contains("snapback4 init --recipe feeds --prefix feed"), "{error}");
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

#[test]
fn w6a_prefixed_recipe_adopts_into_existing_media_app() {
    let dir = Dir::new();
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    let app = "table posts:\n  body: text <=4000\n  media: image <=1000000 ?\n  read <- allow\ntable follows:\n  followerId: principal\n  followedId: principal\n  unique byPair: followerId, followedId\n  read <- allow\ntable reposts:\n  postId: posts\n  actorId: principal\n  read <- allow\n";
    fs::write(dir.0.join("snapback/schema.q"), app).unwrap();
    let refused = recipe(&dir, &[]);
    assert_eq!(refused.status.code(), Some(1), "{refused:?}");
    assert!(String::from_utf8_lossy(&refused.stderr).contains("snapback4 init --recipe feeds --prefix feed"), "{refused:?}");
    let installed = recipe(&dir, &["--prefix", "feed"]);
    assert!(installed.status.success(), "{installed:?}");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), app);
    let written = fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), app.into()), ("feed.q".into(), written)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert!(bound.schema.tables.contains_key("feedPosts"));
    assert!(bound.schema.operations.contains_key("feed.feedFollowing"));
    assert_eq!(bound.schema.schedules[0].target, "feed.feedPurgeRemoved");
    let checked = Command::new(BIN).args(["check", "--json"]).current_dir(&dir.0).output().unwrap();
    assert!(checked.status.success(), "{checked:?}");
    println!("W6a init: 3 existing app tables, 0 diagnostics, 0 notes");
}

#[test]
fn w6a_prefix_requires_a_recipe_and_a_valid_identifier_before_writing() {
    for args in [vec!["init", "--prefix", "feed"], vec!["init", "--recipe", "feeds", "--prefix"],
        vec!["init", "--recipe", "feeds", "--prefix", "feed.other"], vec!["init", "--recipe", "feeds", "--prefix", "1feed"],
        vec!["init", "--recipe", "feeds", "--prefix", "feed-name"]] {
        let dir = Dir::new();
        let output = Command::new(BIN).args(args).current_dir(&dir.0).output().unwrap();
        assert_eq!(output.status.code(), Some(2), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stderr).contains("--prefix <name>"));
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }
}

#[test]
fn w6r1_recipe_refuses_builtin_shadow_before_writing_then_delivers_follower_51() {
    use snapback4_core::{Context, Engine, Value as QValue, WriteState};
    for prefix in ["", "feed"] {
        let dir = Dir::new();
        fs::create_dir_all(dir.0.join("snapback")).unwrap();
        fs::write(dir.0.join("snapback/schema.q"), "-- existing app\n").unwrap();
        let helper = "fn count(value: json <=100000): 0\n";
        fs::write(dir.0.join("snapback/helpers.q"), helper).unwrap();
        let flags = if prefix.is_empty() { vec![] } else { vec!["--prefix", prefix] };
        let refused = recipe(&dir, &flags);
        assert_eq!(refused.status.code(), Some(1), "{refused:?}");
        let error = String::from_utf8_lossy(&refused.stderr);
        println!("{error}");
        assert!(error.contains("fn count") && error.contains("snapback/helpers.q:1:1") && error.contains("no files written"), "{error}");
        for name in ["snapback/feed.q", "src/following.ts", ".gitignore"] { assert!(!dir.0.join(name).exists()); }
        assert_eq!(fs::read_to_string(dir.0.join("snapback/helpers.q")).unwrap(), helper);
        let mut helper = helper.replace("fn count", "fn appCount");
        if !prefix.is_empty() { helper.push_str("fn copy(value: json <=100000): 0\nfn deliver(value: json <=100000): 0\n"); }
        fs::write(dir.0.join("snapback/helpers.q"), &helper).unwrap();
        let installed = recipe(&dir, &flags);
        assert!(installed.status.success(), "{installed:?}");
        if !prefix.is_empty() {
            helper.push_str("mutation register():\n  feedRegister()\nmutation follow(authorId: principal):\n  feedFollow(authorId)\nmutation createPost(postId: id):\n  feedCreatePost(postId)\n");
        }
        let bound = snapback4_lang::compile(&[("helpers.q".into(), helper), ("feed.q".into(), fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let name = |n: &str| snapback4_lang::recipe::prefixed_name(prefix, n);
        let mutate = |engine: &mut Engine, op: &str, viewer: &str, args| {
            let out = engine.mutate(&if prefix.is_empty() { format!("feed.{op}") } else { format!("helpers.{op}") }, None, Context::new(viewer, args).at(100)).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "{:?}", out.state);
        };
        mutate(&mut engine, "register", "author", Default::default());
        for n in 1..=51 { mutate(&mut engine, "follow", &format!("reader{n:02}"), [("authorId".into(), QValue::Id("author".into()))].into()); }
        assert_eq!(engine.store().rows(&name("authors")).unwrap()[0].field("shared").unwrap(), &QValue::Bool(true));
        mutate(&mut engine, "createPost", "author", [("postId".into(), QValue::Id("post51".into()))].into());
        let read = engine.query(&format!("feed.{}", name("following")), Context::new("reader51", Default::default())).unwrap();
        assert!(read.complete);
        assert_eq!(read.data.as_array().unwrap().len(), 1);
        assert_eq!(read.data.as_array().unwrap()[0].field("postId").unwrap(), &QValue::Id("post51".into()));
        println!("W6R1 prefix={prefix:?}: followers=51 shared=true broadcast={} delivered51=1 examined={}", engine.store().rows(&name("broadcast")).unwrap().len(), read.metered.examined);
    }
}

#[test]
fn w6r1_prefixed_recipe_keeps_app_copy_and_deliver_helpers() {
    let dir = Dir::new();
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    let source = "fn copy(value: int): value + 10\nfn deliver(value: int): value + 20\nquery helpers():\n  return { copy: copy(1), deliver: deliver(1) }\n";
    fs::write(dir.0.join("snapback/schema.q"), source).unwrap();
    let output = recipe(&dir, &["--prefix", "feed"]);
    assert!(output.status.success(), "{output:?}");
    let feed = fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap();
    assert!(feed.contains("feedCopy(p, viewer, true)") && feed.contains("feedDeliver(p)"));
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into()), ("feed.q".into(), feed)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let read = engine.query("helpers", snapback4_core::Context::new("alice", Default::default())).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&read.data), json!({"copy":11,"deliver":21}));
}

#[test]
fn w7a_prefixed_install_exposes_no_standalone_mutations() {
    let dir = Dir::new();
    let installed = recipe(&dir, &["--prefix", "feed"]);
    assert!(installed.status.success(), "{installed:?}");
    let source = fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap();
    let bound = snapback4_lang::compile(&[("feed.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("feedAuthors".into(), snapback4_core::value::object([("id", snapback4_core::Value::Id("attacker-author".into())), ("principal", snapback4_core::Value::Id("attacker".into())), ("shared", snapback4_core::Value::Bool(false))]))]).unwrap();
    for op in ["CreatePost", "Register", "Follow", "Unfollow", "Repost", "DeletePost", "Unrepost"] {
        let out = engine.mutate(&format!("feed.feed{op}"), None, snapback4_core::Context::new("attacker", [("postId".into(), snapback4_core::Value::Id("ghost".into()))].into()));
        assert!(out.is_err(), "standalone {op} is client-callable: {out:?}");
        if op == "CreatePost" { println!("W7a ghost call refused: {}", out.unwrap_err()); }
    }
    assert!(engine.store().rows("feedPosts").unwrap().is_empty());
    assert!(engine.query("feed.feedFollowing", snapback4_core::Context::new("attacker", Default::default())).unwrap().complete);
    let client = fs::read_to_string(dir.0.join("src/following.ts")).unwrap();
    assert!(!client.contains("client.mutate("), "{client}");
}

#[path = "../../snapback4-sim/tests/common/following_app.rs"]
mod following_fixture;

#[test]
fn w8b_init_prints_every_written_feed_cap() {
    let dir = Dir::new();
    let installed = recipe(&dir, &[]);
    let output = String::from_utf8_lossy(&installed.stdout);
    println!("{output}");
    assert!(installed.status.success(), "{installed:?}");
    for cap in ["authors=1000", "edges=100000", "pulls=32000", "pullCounts=32000", "sourceEvents=60000", "broadcast=32000", "tombstones=32000",
        "follows/reader=1000", "followers/author=1000", "events/actor=1000", "tombstones/actor=1000", "pulls/reader=32", "inbox/reader=50000", "inbox/reader/actor=1000", "inbox/event=1001"] {
        assert!(output.contains(cap), "missing {cap}: {output}");
    }
}

#[test]
fn w8b_sized_recipe_compiles_without_notes() {
    use snapback4_core::schema::Constraint;
    for prefix in ["", "feed"] {
        let dir = Dir::new();
        let mut flags = vec!["--authors", "1008", "--edges", "5921"];
        if !prefix.is_empty() { flags.extend(["--prefix", prefix]); }
        let installed = recipe(&dir, &flags);
        assert!(installed.status.success(), "{installed:?}");
        let source = fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap();
        let bound = snapback4_lang::compile(&[("feed.q".into(), source)]);
        assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
        for (name, expected) in [("authors", 1008), ("follows", 5921), ("pulls", 32256), ("pullCounts", 32256), ("posts", 60000)] {
            let table = &bound.schema.tables[&snapback4_lang::recipe::prefixed_name(prefix, name)];
            assert!(table.constraints.iter().any(|c| matches!(c, Constraint::Cap { by, max } if by.is_empty() && *max == expected)), "{name}: {:?}", table.constraints);
        }
        assert!(String::from_utf8_lossy(&installed.stdout).contains("authors=1008, edges=5921, pulls=32256, pullCounts=32256"));
    }
}

#[test]
fn w10b_sizing_carries_the_backfill_bound_and_refuses_incoherent_caps() {
    for (flags, backfill) in [(vec![], 917), (vec!["--authors", "1008", "--edges", "5921"], 917),
        (vec!["--authors", "2000"], 917), (vec!["--edges", "2000"], 917), (vec!["--authors", "50", "--edges", "1000"], 200)] {
        for prefix in ["", "feed"] {
            let dir = Dir::new();
            let mut flags = flags.clone();
            if !prefix.is_empty() { flags.extend(["--prefix", prefix]); }
            let installed = recipe(&dir, &flags);
            assert!(installed.status.success(), "{installed:?}");
            let source = fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap();
            assert!(source.contains(&format!("    if visited = {backfill}:")), "{flags:?}: stale backfill bound");
            let name = |n| snapback4_lang::recipe::prefixed_name(prefix, n);
            let bridge = format!("mutation followForTest(authorId: principal):\n  {}(authorId)\nmutation unfollowForTest(authorId: principal):\n  {}(authorId)\n", name("addFollow"), name("dropFollow"));
            let bound = snapback4_lang::compile(&[("feed.q".into(), source), ("test.q".into(), bridge)]);
            assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
            assert!(String::from_utf8_lossy(&installed.stdout).contains(&format!("backfill/author={backfill}")));
            if flags.contains(&"--authors") && prefix == "feed" {
                use snapback4_core::{Context, Engine, Value, WriteState, value::object};
                let id = |s: &str| Value::Id(s.into());
                let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
                let mut rows = vec![(name("authors"), object([("id", id("author")), ("principal", id("author")), ("shared", Value::Bool(false))]))];
                for n in 0..1000 {
                    rows.push((name("posts"), object([("id", id(&format!("event-{n:04}"))), ("postId", id(&format!("post-{n:04}"))),
                        ("actorId", id("author")), ("authorId", id("author")), ("repost", Value::Bool(false)), ("shared", Value::Bool(false)), ("at", Value::Int(n))])));
                }
                engine.seed(rows).unwrap();
                let context = || Context::new("reader", [("authorId".into(), id("author"))].into()).at(2000);
                let followed = engine.mutate("test.followForTest", None, context()).unwrap();
                assert!(matches!(followed.state, WriteState::Sent { .. }), "{followed:?}");
                let copied = engine.store().rows(&name("feed")).unwrap();
                assert_eq!(copied.len(), backfill);
                assert!(copied.iter().all(|row| row.field("at").unwrap().as_int().unwrap() >= 1000 - backfill as i64));
                println!("W10b backfill={backfill} examined={} index={} written={}", followed.metered.examined, followed.metered.index_entries, followed.metered.rows_written);
                assert!(matches!(engine.mutate("test.followForTest", None, context()).unwrap().state, WriteState::Sent { .. }));
                assert_eq!(engine.store().rows(&name("feed")).unwrap().len(), backfill);
                assert!(matches!(engine.mutate("test.unfollowForTest", None, context()).unwrap().state, WriteState::Sent { .. }));
                assert!(engine.store().rows(&name("feed")).unwrap().is_empty());
            }
        }
    }
    let dir = Dir::new();
    let refused = recipe(&dir, &["--authors", "50", "--edges", "50001"]);
    assert_eq!(refused.status.code(), Some(2));
    assert_eq!(String::from_utf8_lossy(&refused.stderr), "E_RECIPE_CAPS: --edges 50001 exceeds --authors 50 * 1000 followers/author; grow --authors or reduce --edges; see snapback4 guide feeds\n");
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
}

#[test]
fn w10b_residency_pointer_prints_once_at_recipe_install() {
    let pointer = "cold rows: snapback4 test --residency --fixture <fixture-directory> --as <principal>";
    for existing in [false, true] {
        let dir = Dir::new();
        if existing { assert!(dir.run("").status.success()); }
        let installed = recipe(&dir, &["--prefix", "feed"]);
        assert!(installed.status.success(), "{installed:?}");
        assert_eq!(String::from_utf8_lossy(&installed.stdout).lines().filter(|line| *line == pointer).count(), 1);
        let repeated = recipe(&dir, &["--prefix", "feed"]);
        assert!(!repeated.status.success());
        assert!(!String::from_utf8_lossy(&repeated.stdout).contains(pointer));
        for _ in 0..2 {
            let checked = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
            assert!(checked.status.success(), "{checked:?}");
            assert!(!String::from_utf8_lossy(&checked.stdout).contains(pointer));
        }
    }
    let dir = Dir::new();
    assert!(!String::from_utf8_lossy(&dir.run("").stdout).contains(pointer));
}

#[test]
fn w8b_incoherent_feed_caps_refuse_before_writing() {
    for flags in [vec!["--authors", "1", "--edges", "1001"], vec!["--authors", "0"], vec!["--edges", "0"],
        vec!["--authors"], vec!["--edges", "nope"], vec!["--authors", "4294967295"], vec!["--edges", "-1"], vec!["--authors", "1", "--edges", "1000"]] {
        let dir = Dir::new();
        let output = recipe(&dir, &flags);
        assert!(!output.status.success(), "{flags:?}: {output:?}");
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(error.contains("E_RECIPE_CAPS") && error.contains("guide feeds"), "{error}");
        println!("{error}");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0, "invalid sizing wrote files");
    }
    let dir = Dir::new();
    let output = Command::new(BIN).args(["init", "--authors", "1008"]).current_dir(&dir.0).output().unwrap();
    assert!(!output.status.success() && String::from_utf8_lossy(&output.stderr).contains("E_RECIPE_CAPS"));
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
}

#[test]
fn w7a_residency_measures_the_wired_500_follow_reader() {
    use std::io::Write;
    let dir = Dir::new();
    assert!(recipe(&dir, &["--prefix", "feed"]).status.success());
    fs::write(dir.0.join("snapback/social.q"), following_fixture::app()).unwrap();
    let bound = following_fixture::built();
    let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    following_fixture::seed(&mut engine);
    let fixture = dir.0.join("fixture");
    fs::create_dir(&fixture).unwrap();
    for table in engine.schema().tables.keys() {
        let mut file = fs::File::create(fixture.join(format!("{table}.jsonl"))).unwrap();
        for row in engine.store().rows(table).unwrap() {
            writeln!(file, "{}", snapback4_core::wire::to_json(&row)).unwrap();
        }
    }
    let measured = Command::new(BIN).args(["test", "--residency", "--verbose", "--fixture", "fixture", "--as", "dev:reader500"]).current_dir(&dir.0).output().unwrap();
    let output = String::from_utf8_lossy(&measured.stdout);
    println!("{output}");
    assert!(measured.status.success(), "{measured:?}");
    assert!(output.contains("dev:reader500 feedFeed: 527 rows"), "{output}");
    assert!(output.contains("dev:reader500 feedAuthors: 502 rows"), "{output}");
    assert!(output.contains("dev:reader500 feedPosts: 528 rows"), "{output}");
    assert!(output.contains("social.saveProfile: predicts: eligible") && output.contains("social.createPost: predicts: eligible") && output.contains("social.follow: predicts: never; queued without a row"), "{output}");
}

#[path = "../../snapback4-sim/tests/common/following_calibration.rs"]
mod calibration;

#[test]
fn w8b_residency_measures_the_wired_calibration_shape() {
    use std::{collections::BTreeMap, io::{BufWriter, Write}};
    let dir = Dir::new();
    let installed = recipe(&dir, &["--prefix", "feed", "--authors", "1008", "--edges", "5921"]);
    assert!(installed.status.success(), "{installed:?}");
    fs::write(dir.0.join("snapback/social.q"), following_fixture::app()).unwrap();
    let fixture = dir.0.join("fixture");
    fs::create_dir(&fixture).unwrap();
    let mut files = BTreeMap::new();
    for (table, row) in calibration::rows() {
        let file = files.entry(table.clone()).or_insert_with(|| BufWriter::new(fs::File::create(fixture.join(format!("{table}.jsonl"))).unwrap()));
        writeln!(file, "{}", snapback4_core::wire::to_json(&row)).unwrap();
    }
    for file in files.values_mut() { file.flush().unwrap(); }
    let measured = Command::new(BIN).args(["test", "--residency", "--verbose", "--fixture", "fixture", "--as", calibration::VIEWER]).current_dir(&dir.0).output().unwrap();
    let output = String::from_utf8_lossy(&measured.stdout);
    println!("{output}");
    assert!(measured.status.success(), "{}\n{output}", String::from_utf8_lossy(&measured.stderr));
    let mut counts = BTreeMap::new();
    for line in output.lines().filter_map(|l| l.strip_prefix(&format!("  {} ", calibration::VIEWER))) {
        let (table, rest) = line.split_once(": ").unwrap();
        if table == "total" { continue; }
        let words: Vec<_> = rest.split_whitespace().collect();
        counts.insert(table.to_owned(), (words[0].parse().unwrap(), words[2].parse().unwrap()));
    }
    calibration::check_counts(&counts);
    assert!(output.contains("social.saveProfile: predicts: eligible") && output.contains("social.createPost: predicts: eligible") && output.contains("social.follow: predicts: never; queued without a row"), "{output}");
}

fn w10r1b_backfill_engine(followers: usize) -> snapback4_core::Engine {
    use snapback4_core::{Engine, wire};
    let source = snapback4_lang::recipe::following("feed", "feed").unwrap();
    let bridge = "table appFollows:\n  reader: principal\n  author: principal\n  unique byPair: reader, author\n  public 'app edges'\n  insert <- .reader = viewer\nmutation follow(author: principal):\n  insert appFollows { reader: viewer, author }\n  feedAddFollow(author)\nmutation remove(postId: feedPosts):\n  feedDeletePost(postId)\nmutation replace(postId: id):\n  feedCreatePost(postId)\n";
    let b = snapback4_lang::compile(&[("feed.q".into(), source), ("schema.q".into(), bridge.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut rows = vec![("feedAuthors", serde_json::json!({"id":"author","principal":"author","shared":false}))];
    for n in 0..1000 {
        rows.push(("feedPosts", serde_json::json!({"id":format!("event-{n:04}"),"postId":format!("post-{n:04}"),"actorId":"author","authorId":"author","repost":false,"shared":false,"at":n})));
    }
    for n in 0..followers {
        rows.push(("feedFollows", serde_json::json!({"id":format!("edge-{n}"),"followerId":format!("f{n}"),"followedId":"author","at":1})));
    }
    let rows = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(&b.schema.tables[table], &row).unwrap())).collect::<Vec<_>>();
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed(rows).unwrap();
    e
}

#[test]
fn w10r1b_51st_follow_fits_the_write_ceiling_with_the_app_edge() {
    use snapback4_core::{Context, Value, WriteState};
    let mut e = w10r1b_backfill_engine(50);
    let write = e.mutate("follow", None, Context::new("reader", [("author".into(), Value::Id("author".into()))].into()).at(2000)).unwrap();
    println!("W10R1b promotion: state={:?} examined={} index={} written={}", write.state, write.metered.examined, write.metered.index_entries, write.metered.rows_written);
    assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
    assert_eq!(e.store().rows("feedFollows").unwrap().len(), 51);
    assert_eq!(e.store().rows("feedPulls").unwrap().len(), 52);
    assert_eq!(e.store().rows("appFollows").unwrap().len(), 1);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(), 917);
    assert_eq!(write.metered.rows_written, 1024);
}

#[test]
fn w10r1b_backfill_leaves_room_for_delete_and_replace_before_purge() {
    use snapback4_core::{Context, Value, WriteState};
    let mut e = w10r1b_backfill_engine(0);
    let mut run = |op: &str, viewer: &str, key: &str, value: &str| {
        let write = e.mutate(op, None, Context::new(viewer, [(key.into(), Value::Id(value.into()))].into()).at(2000)).unwrap();
        println!("W10R1b {op}: state={:?} examined={} index={} written={}", write.state, write.metered.examined, write.metered.index_entries, write.metered.rows_written);
        assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
    };
    run("follow", "reader", "author", "author");
    run("remove", "author", "postId", "event-0999");
    run("replace", "author", "postId", "replacement");
    let copies = e.store().rows("feedFeed").unwrap();
    let reader = copies.iter().filter(|r| r.field("readerId").unwrap().as_str().unwrap() == "reader").collect::<Vec<_>>();
    assert_eq!(reader.len(), 918);
    assert!(reader.iter().any(|r| r.field("eventId").unwrap().as_str().unwrap() == "event-0999"), "purge has not run");
    assert!(reader.iter().any(|r| r.field("eventId").unwrap().as_str().unwrap() == "replacement"));
    assert_eq!(e.store().rows("feedPosts").unwrap().len(), 1000);
}

#[test]
fn w13e_removed_search_recipe_is_an_ordinary_unknown_recipe() {
    let dir = Dir::new();
    let unknown = Command::new(BIN).args(["init", "--recipe", "unknown"]).current_dir(&dir.0).output().unwrap();
    let removed = Command::new(BIN).args(["init", "--recipe", "search"]).current_dir(&dir.0).output().unwrap();
    assert_eq!(unknown.status.code(), Some(2));
    assert_eq!(removed.status.code(), unknown.status.code());
    assert_eq!(removed.stderr, unknown.stderr);
    assert!(!dir.0.join("snapback").exists(), "unknown recipe writes nothing");
}
