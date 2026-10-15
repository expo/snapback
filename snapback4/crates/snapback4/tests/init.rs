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
    fn install_client(&self) {
        // Generated release-availability handles now use the installed SDK at runtime.
        fs::create_dir_all(self.0.join("node_modules")).unwrap();
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback4").canonicalize().unwrap();
        #[cfg(unix)] std::os::unix::fs::symlink(source, self.0.join("node_modules/snapback4")).unwrap();
        #[cfg(windows)] std::os::windows::fs::symlink_dir(source, self.0.join("node_modules/snapback4")).unwrap();
    }
    fn run(&self, flag: &str) -> std::process::Output { Command::new(BIN).args(["init", flag]).current_dir(&self.0).output().unwrap() }
    fn init(&self, flags: &[&str]) -> std::process::Output { Command::new(BIN).arg("init").args(flags).current_dir(&self.0).output().unwrap() }
}
impl Drop for Dir { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

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
    for flags in [&["--online"][..], &["--expo"], &["--web"], &["--expo", "--template", "chat"], &["--web", "--template", "chat"]] {
        let flag = flags[0];
        let chat = flags.len() > 1;
        let dir = Dir::new();
        let before = json!({"name":"my-app", "private":false, "type":"module", "description":"kept", "dependencies":{"unrelated":"1", "snapback4":env!("CARGO_PKG_VERSION")}, "devDependencies":{"my-tool":"2"}, "scripts":{"test":"my-tests"}});
        fs::write(dir.0.join("package.json"), before.to_string()).unwrap();
        let output = dir.init(flags);
        assert!(output.status.success(), "{output:?}");
        let after: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
        for key in ["name", "private", "type", "description"] { assert_eq!(after[key], before[key]); }
        assert_eq!(after["dependencies"]["unrelated"], "1");
        assert_eq!(after["devDependencies"]["my-tool"], "2");
        assert_eq!(after["scripts"]["test"], "my-tests");
        if flag == "--expo" { assert_eq!(after["scripts"]["start"], "node scripts/launch.mjs expo"); assert_eq!(after["devDependencies"]["babel-preset-expo"], "57.0.11"); }
        assert!(dir.0.join("snapback/schema.q").exists());
        if flag == "--expo" { assert!(dir.0.join("expo-env.d.ts").is_file(), "Expo's types declare process.env for the starter's typecheck"); }
        if flag == "--expo" && chat {
            for file in ["src/intents.ts", "src/intent-store.ts", "src/intent-store.web.ts", "src/intent-store.native.ts"] {
                assert!(dir.0.join(file).exists(), "{file}");
            }
            let web_store = fs::read_to_string(dir.0.join("src/intent-store.web.ts")).unwrap();
            assert!(web_store.contains("localStorage"));
            assert!(!web_store.contains("expo-sqlite"));
            let native_store = fs::read_to_string(dir.0.join("src/intent-store.native.ts")).unwrap();
            assert!(native_store.contains("expo-sqlite/kv-store"));
        }
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
    for name in ["src/client.ts", "metro.config.js"] {
        let dir = Dir::new();
        let path = dir.0.join(name); fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(&path, "kept").unwrap();
        fs::write(dir.0.join("package.json"), "{}").unwrap();
        assert_eq!(dir.run("--expo").status.code(), Some(1));
        assert_eq!(fs::read_to_string(&path).unwrap(), "kept");
        assert_eq!(fs::read_to_string(dir.0.join("package.json")).unwrap(), "{}");
    }
    // snapback/generated/ is `check`'s output, rewritten on every run: init
    // replaces it rather than refusing (wave 4, 1b).
    let dir = Dir::new();
    let path = dir.0.join("snapback/generated/package.json"); fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(&path, "stale").unwrap();
    assert!(dir.run("--expo").status.success());
    assert!(serde_json::from_str::<Value>(&fs::read_to_string(&path).unwrap()).is_ok());
    // A snapback/*.q is the project's schema, never a conflict: kept as written.
    let dir = Dir::new();
    let path = dir.0.join("snapback/schema.q"); fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(&path, "kept").unwrap();
    fs::write(dir.0.join("package.json"), "{}").unwrap();
    assert!(dir.run("--expo").status.success());
    assert_eq!(fs::read_to_string(&path).unwrap(), "kept");
}

#[cfg(unix)]
#[test]
fn init_preserves_unrelated_symlinks_and_readmes_in_every_starter() {
    for flag in ["", "--online", "--expo", "--web"] {
        let dir = Dir::new();
        fs::write(dir.0.join("README.md"), "My project\n").unwrap();
        std::os::unix::fs::symlink("/not-an-installed-instrument", dir.0.join("instrument")).unwrap();
        let output = dir.run(flag);
        assert!(output.status.success(), "{output:?}");
        assert_eq!(fs::read_to_string(dir.0.join("README.md")).unwrap(), "My project\n");
        assert_eq!(fs::read_link(dir.0.join("instrument")).unwrap(), PathBuf::from("/not-an-installed-instrument"));
        assert!(dir.0.join("snapback/schema.q").is_file());
        if !flag.is_empty() {
            assert!(dir.0.join("README.snapback.md").is_file());
            assert!(String::from_utf8_lossy(&output.stdout).contains("README.snapback.md"));
        }
    }
}

#[test]
fn init_reports_all_conflicts_before_writing() {
    let dir = Dir::new();
    let package = r#"{"dependencies":{"snapback4":"different"},"scripts":{"start":"mine"},"main":"my-entry.js","devDependencies":[]}"#;
    fs::write(dir.0.join("package.json"), package).unwrap();
    for name in ["README.md", "README.snapback.md", "snapback/schema.q", "App.tsx"] {
        let path = dir.0.join(name); fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "kept").unwrap();
    }
    let output = dir.run("--expo");
    assert_eq!(output.status.code(), Some(1));
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    for conflict in ["E_INIT_CONFLICT", "dependencies.snapback4", "scripts.start", "conflict at main", "devDependencies must be an object", "App.tsx", "README.snapback.md", "rewrite:"] {
        assert!(diagnostic.contains(conflict), "{diagnostic}");
    }
    assert!(!diagnostic.contains("schema.q already exists"), "the project's schema is never a conflict: {diagnostic}");
    assert_eq!(fs::read_to_string(dir.0.join("package.json")).unwrap(), package);
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), "kept");
    assert!(!dir.0.join("app.json").exists());
    assert!(!dir.0.join(".gitignore").exists());
}

#[cfg(unix)]
#[test]
fn init_refuses_owned_symlinks_but_allows_an_unwritten_package_link() {
    for name in ["package.json", ".gitignore", "snapback/schema.q"] {
        let dir = Dir::new();
        let target = dir.0.join("kept"); fs::write(&target, "{}\n").unwrap();
        let path = dir.0.join(name); fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        let output = dir.run("--web");
        // A linked schema is the project's schema: kept, never written through.
        if name == "snapback/schema.q" { assert!(output.status.success(), "{output:?}"); }
        else {
            assert_eq!(output.status.code(), Some(1), "{output:?}");
            assert!(String::from_utf8_lossy(&output.stderr).contains(name));
        }
        assert_eq!(fs::read_to_string(&target).unwrap(), "{}\n");
        assert_eq!(fs::read_link(path).unwrap(), target);
    }
    let dir = Dir::new();
    std::os::unix::fs::symlink("absent", dir.0.join("package.json")).unwrap();
    assert!(dir.run("").status.success(), "the schema-only starter does not write package.json");
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
    dir.install_client();
    fs::write(dir.0.join("package.json"), r#"{"name":"astra-snapback4","version":"1.0.0","type":"commonjs"}"#).unwrap();
    assert!(dir.run("--expo").status.success());
    let check = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
    assert!(check.status.success(), "{check:?}");
    fs::create_dir_all(dir.0.join("scripts")).unwrap();
    fs::write(dir.0.join("scripts/seed.mjs"), "import {api} from '../snapback/generated/api.ts';\nif (!api.add) throw new Error('missing add');\nconsole.log('api import: ok');\n").unwrap();
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
        dir.install_client();
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
            assert!(!dir.0.join("snapback/worker.mts").exists(), "the core starter has no invitation action or worker");
        }
        let operation = "add";
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

#[path = "../../snapback4-sim/tests/common/following_app.rs"]
mod following_fixture;
#[path = "../../snapback4-sim/tests/common/following_calibration.rs"]
mod calibration;

fn existing_recipe_fixture(dir: &Dir, authors: Option<&str>, edges: Option<&str>) {
    assert!(dir.run("").status.success());
    let caps = snapback4_lang::recipe::FollowingCaps::parse(authors, edges).unwrap();
    fs::write(dir.0.join("snapback/feed.q"), snapback4_lang::recipe::following_sized("feed", "feed", caps).unwrap()).unwrap();
}

#[test]
fn w7a_residency_measures_the_wired_500_follow_reader() {
    use std::io::Write;
    let dir = Dir::new();
    existing_recipe_fixture(&dir, None, None);
    assert!(fs::read_to_string(dir.0.join("snapback/feed.q")).unwrap().contains("if visited = 865"));
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

#[test]
fn w8b_residency_measures_the_wired_calibration_shape() {
    use std::{collections::BTreeMap, io::{BufWriter, Write}};
    let dir = Dir::new();
    existing_recipe_fixture(&dir, Some("1008"), Some("5921"));
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
    assert_eq!(e.store().rows("feedFeed").unwrap().len(), 865);
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
    assert_eq!(reader.len(), 866);
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

#[test]
fn web_chat_template_embeds_reference_and_keeps_default_schema_only() {
    let dir = Dir::new();
    let output = dir.init(&["--web", "--template", "chat"]);
    assert!(output.status.success(), "{output:?}");
    for file in ["src/App.tsx", "src/state.ts", "src/Composer.tsx", "src/client.ts", "vite.config.mts", "index.html", "README.md"] {
        assert!(dir.0.join(file).is_file(), "{file}");
    }
    let checked = Command::new(BIN).args(["check", "--json"]).current_dir(&dir.0).output().unwrap();
    assert!(checked.status.success(), "{checked:?}");
    let source = fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert_eq!(bound.schema.operations["markRead"].predicts.as_deref(), Some("never"));
    assert_eq!(bound.schema.operations["room"].runs.as_deref(), Some("device"));
    let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["dependencies"]["snapback4"], env!("CARGO_PKG_VERSION"));
    assert!(package["scripts"]["build"].as_str().unwrap().ends_with("snapback4 web-shell dist"));
    assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().contains("createApp"));
    assert!(fs::read_to_string(dir.0.join("src/App.tsx")).unwrap().contains("useAuth"));
    assert!(!dir.0.join("shell.ts").exists());
    let plain = Dir::new();
    assert!(plain.run("").status.success());
    assert!(plain.0.join("snapback/schema.q").is_file());
    assert!(!plain.0.join("src").exists() && !plain.0.join("package.json").exists());
}

#[test]
fn web_starter_refuses_conflicts_before_writing() {
    for flag in ["--expo"] {
        let dir = Dir::new();
        let output = Command::new(BIN).args(["init", "--web", flag]).current_dir(&dir.0).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }
    for file in ["src/client.ts", "src/App.tsx", "index.html"] {
        let dir = Dir::new();
        let path = dir.0.join(file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "kept").unwrap();
        assert_eq!(dir.run("--web").status.code(), Some(1));
        assert_eq!(fs::read_to_string(path).unwrap(), "kept");
        assert!(!dir.0.join("snapback").exists());
    }
}

fn snapshot(dir: &std::path::Path) -> Vec<(PathBuf, Option<Vec<u8>>)> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files.push((path.clone(), None));
            files.extend(snapshot(&path));
        } else { files.push((path.clone(), Some(fs::read(path).unwrap()))); }
    }
    files.sort(); files
}

const RETIRED: &str = "E_RECIPE_RETIRED: the Following recipe installer is retired; no files written\n  rewrite: maintain feed: timeline\n    events posts by authorId, at removed by removed\n    reposts reposts by actorId, postId, at\n    edges follows by followerId, followedId\n  use a fresh feed name; dev adopts retained sources and deploy requires --allow-feed-adoption; see snapback4 guide feeds\n";
const RECIPE_OPTIONS: [[&str; 2]; 7] = [
    ["--prefix", "feed"], ["--authors", "1008"], ["--edges", "5921"],
    ["--public-profiles", "profiles:principal"], ["--public-posts", "posts:authorId:at"],
    ["--public-follows", "follows:followerId:followedId"], ["--public-reposts", "reposts:actorId:postId:at"],
];

fn assert_retired(dir: &Dir, flags: &[&str]) {
    let before = snapshot(&dir.0);
    let output = Command::new(BIN).arg("init").args(flags).current_dir(&dir.0).output().unwrap();
    assert_eq!(output.status.code(), Some(2), "{flags:?}: {output:?}");
    assert_eq!(String::from_utf8_lossy(&output.stderr), RETIRED, "{flags:?}");
    assert!(output.stdout.is_empty(), "{flags:?}: {output:?}");
    assert_eq!(snapshot(&dir.0), before, "{flags:?}: retired command changed the directory tree");
}

#[test]
fn retired_feed_installer_and_all_its_options_refuse_without_writes() {
    for existing in [false, true] {
        let dir = Dir::new();
        if existing { assert!(dir.run("--expo").status.success()); }
        // Every subset: standalone, each individual mapping, partial mappings and all options.
        for mask in 0..(1 << RECIPE_OPTIONS.len()) {
            for mode in [vec![], vec!["--expo"], vec!["--online"], vec!["--web"], vec!["--expo", "--online"]] {
                let mut flags = vec!["--recipe", "feeds"];
                flags.extend(mode);
                for (bit, option) in RECIPE_OPTIONS.iter().enumerate() {
                    if mask & (1 << bit) != 0 { flags.extend(option); }
                }
                assert_retired(&dir, &flags);
            }
        }
    }
    for starter in ["", "--online", "--web"] {
        let dir = Dir::new();
        assert!(dir.run(starter).status.success());
        assert_retired(&dir, &["--recipe", "feeds"]);
    }
    let dir = Dir::new();
    for mode in ["--expo", "--online", "--web"] {
        assert_retired(&dir, &["new-app", mode, "--recipe", "feeds"]);
    }
    assert!(!dir.0.join("new-app").exists());
}

#[test]
fn orphan_and_invalid_recipe_options_keep_the_clear_retirement_refusal() {
    for existing in [false, true] {
        let dir = Dir::new();
        if existing { assert!(dir.run("--online").status.success()); }
        for option in RECIPE_OPTIONS {
            assert_retired(&dir, &option);
            assert_retired(&dir, &["--recipe", "feeds", option[0]]); // missing option value
            let assigned = format!("{}={}", option[0], option[1]);
            assert_retired(&dir, &["--recipe=feeds", &assigned]);
        }
        let orphan_mappings: Vec<_> = RECIPE_OPTIONS[3..].iter().flatten().copied().collect();
        assert_retired(&dir, &orphan_mappings);
        for flags in [["--recipe", "feeds", "--authors", "0"], ["--recipe", "feeds", "--prefix", "bad-prefix"]] {
            assert_retired(&dir, &flags);
        }
    }
}

#[test]
fn usage_stderr_never_recommends_the_retired_installer() {
    let dir = Dir::new();
    for flags in [vec!["--help"], vec!["init", "--help"], vec!["init", "--recipe"], vec!["init", "--recipe", "unknown"], vec!["init", "--recipe", "search"], vec!["init", "--expo", "--online"]] {
        let before = snapshot(&dir.0);
        let output = Command::new(BIN).args(&flags).current_dir(&dir.0).output().unwrap();
        let expected = if flags.contains(&"--help") { 0 } else { 2 };
        assert_eq!(output.status.code(), Some(expected), "{flags:?}: {output:?}");
        let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(text.contains("init [dir] [--online|--expo|--web [--online]]"), "{text}");
        assert!(text.lines().filter(|line| line.contains("--recipe")).all(|line| line.contains("retired spelling")), "{text}");
        assert_eq!(snapshot(&dir.0), before);
    }
}

#[test]
fn ordinary_starters_still_check_and_preserve_their_server_opt_in() {
    for flags in [&[""][..], &["--online"], &["--expo"], &["--web"], &["--expo", "--template", "chat"], &["--web", "--template", "chat"]] {
        let dir = Dir::new();
        assert!(dir.init(flags).status.success());
        let source = fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap();
        let (document, errors) = snapback4_lang::parse_document("schema.q", &source);
        assert!(errors.is_empty());
        if flags == ["--web", "--template", "chat"] {
            assert!(document.server && !document.actions.is_empty());
        } else {
            assert!(!document.server && document.actions.is_empty() && document.routes.is_empty());
            assert!(document.schedules.iter().all(|schedule| schedule.target != "invite"));
            for (path, bytes) in snapshot(&dir.0) {
                assert!(!path.file_name().unwrap().to_string_lossy().starts_with("worker."));
                if let Some(bytes) = bytes { assert!(!String::from_utf8_lossy(&bytes).contains("invite"), "{}", path.display()); }
            }
        }
        let checked = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        assert!(checked.status.success(), "{checked:?}");
        assert!(!dir.0.join("snapback/feed.q").exists());
    }
    let help = Command::new(BIN).arg("--help").output().unwrap();
    assert!(!String::from_utf8_lossy(&help.stdout).contains("--recipe"));
}

#[test]
fn expo_starters_pave_native_smoke_and_export_at_every_milestone() {
    for social in [false, true] {
        let dir = Dir::new();
        let output = if social { Command::new(BIN).args(["new", "social", "--template", "social"]).current_dir(&dir.0).output().unwrap() }
            else { dir.run("--expo") };
        assert!(output.status.success(), "{output:?}");
        let root = if social { dir.0.join("social") } else { dir.0.clone() };
        let package: Value = serde_json::from_slice(&fs::read(root.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["scripts"]["native:smoke"], "node scripts/launch.mjs native-smoke");
        assert_eq!(package["scripts"]["export:ios"], "snapback4-export-ios");
        assert_eq!(package["devDependencies"]["@expo/fingerprint"], "0.20.13");
        let config: Value = serde_json::from_slice(&fs::read(root.join("app.json")).unwrap()).unwrap();
        assert_eq!(config["expo"]["newArchEnabled"], true);
        assert!(config["expo"]["plugins"].as_array().unwrap().contains(&json!("snapback4-expo/plugin")));
        assert_eq!(config["expo"]["plugins"].as_array().unwrap().iter().filter(|p| **p == json!("snapback4-expo/plugin")).count(), 1);
        assert!(root.join("src/native-smoke.ts").exists());
        let readme = fs::read_to_string(root.join("README.md")).unwrap();
        for text in ["every milestone", "npm run export:ios", "npm run native:smoke", "in the background", "witness status --wait", "doctor", "artifacts/native-smoke/<timestamp>", "offline reopen", "write replay"] {
            assert!(readme.to_lowercase().contains(&text.to_lowercase()), "missing {text}");
        }
        assert!(!readme.contains("SNAPBACK4_NATIVE_SMOKE=off"));
    }
}

fn starter_texts(root: &std::path::Path) -> Vec<(PathBuf, String)> {
    snapshot(root).into_iter().filter_map(|(path, bytes)| bytes.map(|bytes| (path, String::from_utf8(bytes).unwrap()))).collect()
}

#[test]
fn web_and_expo_starters_are_one_small_screen_with_product_comments() {
    for (flag, screens) in [("--web", &["src/App.tsx", "src/client.ts", "src/main.tsx", "src/styles.css", "index.html", "vite.config.mts"][..]), ("--expo", &["App.tsx", "src/client.ts", "expo-env.d.ts", "metro.config.js"])] {
        let dir = Dir::new();
        let output = dir.run(flag);
        assert!(output.status.success(), "{output:?}");
        for file in screens { assert!(dir.0.join(file).is_file(), "{flag}: {file}"); }
        for chat in ["src/Inbox.tsx", "src/Thread.tsx", "src/intents.ts", "src/state.ts", "snapback/worker.ts", "snapback/worker.mts"] {
            assert!(!dir.0.join(chat).exists(), "{flag}: the small starter carries no chat file {chat}");
        }
        let texts = starter_texts(&dir.0);
        // Three kit scripts replace builder-owned process orchestration.
        assert!(texts.len() <= 23, "{flag}: {} files", texts.len());
        let schema = fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), schema)]);
        assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
        assert_eq!(bound.schema.tables.len(), 1);
        assert!(bound.schema.auth.guests, "the starter screen signs in as a guest");
        for op in ["list", "add", "toggle", "remove"] { assert!(bound.schema.operations.contains_key(op), "{op}"); }
        let checked = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        assert!(checked.status.success(), "{checked:?}");
        let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
        let summary = String::from_utf8_lossy(&tested.stdout);
        assert!(tested.status.success() && summary.contains("cases: 7 passed, 0 failed"), "{flag}: {tested:?}");
        let app = fs::read_to_string(dir.0.join(if flag == "--web" { "src/App.tsx" } else { "App.tsx" })).unwrap();
        for call in ["AppProvider", "auth.guest()", "usePage(api.list", "useMutation(api.add)", "api.toggle", "api.remove"] { assert!(app.contains(call), "{flag}: {call}"); }
        // Wave 4 (I7): the named hook types and the signed-in viewer hook are
        // in the starter, where builders look for them.
        for call in ["useSignedInViewer()", "UsePage<typeof api.list>", "UseMutation<typeof api.toggle>", "UseQuery<typeof api.op>", "useQuery(api.op, args)", ".find(isFailed)"] { assert!(app.contains(call), "{flag}: {call}"); }
        assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().contains("webDevice()"));
        let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["dependencies"]["snapback4"], env!("CARGO_PKG_VERSION"));
        if flag == "--web" {
            assert_eq!(package["type"], "module", "a fresh directory keeps Vite's ESM package type");
            assert!(package["scripts"]["build"].as_str().unwrap().ends_with("snapback4 web-shell dist"));
            assert!(fs::read_to_string(dir.0.join("vite.config.mts")).unwrap().contains("strictPort: true"));
            assert!(!dir.0.join("vite.config.ts").exists(), "an .mts config loads as ESM whatever the package type");
            assert!(fs::read_to_string(dir.0.join("tsconfig.json")).unwrap().contains("\"vite.config.mts\""));
            let html = fs::read_to_string(dir.0.join("index.html")).unwrap();
            assert!(!html.contains("<style") && !html.contains("<title>Todos</title>"), "{html}");
        } else {
            assert_eq!(fs::read_to_string(dir.0.join("expo-env.d.ts")).unwrap().trim(), "/// <reference types=\"expo/types\" />");
            assert_eq!(package["scripts"]["typecheck"], "tsc -p tsconfig.json --noEmit");
        }
        let readme = fs::read_to_string(dir.0.join("README.md")).unwrap();
        assert!(readme.contains(&format!("init <dir> {flag} --template chat")), "{flag}: the README names the full example");
    }
}

#[test]
fn every_starter_is_free_of_repository_history() {
    let starters: [&[&str]; 7] = [&["init"], &["init", "--online"], &["init", "--web"], &["init", "--expo"], &["init", "--web", "--template", "chat"], &["init", "--expo", "--template", "chat"], &["new", "app", "--template", "social"]];
    for args in starters {
        let dir = Dir::new();
        let output = Command::new(BIN).args(args).current_dir(&dir.0).output().unwrap();
        assert!(output.status.success(), "{args:?}: {output:?}");
        for (path, text) in starter_texts(&dir.0) {
            for stale in ["@ref", "LLP ", "week 2", "Snapback 2", "nothing compiles", "beauty test"] {
                assert!(!text.contains(stale), "{args:?}: {} mentions {stale:?}", path.display());
            }
        }
    }
}

#[test]
fn chat_template_is_explicit_and_needs_one_client() {
    for (args, code) in [(&["init", "--template", "chat"][..], 2), (&["init", "--online", "--template", "chat"], 2), (&["init", "--web", "--expo", "--template", "chat"], 2), (&["new", "app", "--template", "nope"], 2), (&["new", "app"], 2)] {
        let dir = Dir::new();
        let output = Command::new(BIN).args(args).current_dir(&dir.0).output().unwrap();
        assert_eq!(output.status.code(), Some(code), "{args:?}: {output:?}");
        assert!(String::from_utf8_lossy(&output.stderr).contains("--template chat"), "{args:?}: {output:?}");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0, "{args:?} wrote files");
    }
    let dir = Dir::new();
    let output = Command::new(BIN).args(["new", "chat", "--template", "chat", "--expo"]).current_dir(&dir.0).output().unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(dir.0.join("chat/src/Inbox.tsx").is_file() && dir.0.join("chat/src/Thread.tsx").is_file());
    assert!(String::from_utf8_lossy(&output.stdout).contains("Expo chat app"));
}

#[test]
fn skip_existing_keeps_files_and_writes_the_rest() {
    let dir = Dir::new();
    let mine = "use personas carol\ntable notes:\n  body: text <=100\n  public 'shared'\n  insert <- allow\n";
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    fs::write(dir.0.join("snapback/schema.q"), mine).unwrap();
    // The project's own schema is never a conflict (wave 3: init after the
    // schema refused E_INIT_CONFLICT naming only snapback/schema.q).
    let output = dir.init(&["--web"]);
    assert!(output.status.success(), "{output:?}");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("kept 1 existing file unchanged: snapback/schema.q") && stdout.contains("replace Home with your own screens"), "{stdout}");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), mine);
    for file in ["src/App.tsx", "src/client.ts", "package.json", "README.md", "snapback/generated/package.json"] { assert!(dir.0.join(file).is_file(), "{file}"); }
    // The starter's todos rows and cases would fail `test` beside this schema.
    assert!(!dir.0.join("fixtures").exists(), "the todo starter's fixtures stay out of a project with its own schema");
    assert!(stdout.contains("skipped the todo starter's fixtures/todos.jsonl and fixtures/test.cases.jsonl"), "{stdout}");
    // `use personas carol` and no `use identity`: nobody can sign in as a guest.
    assert!(stdout.contains("picks a persona"), "{stdout}");
    let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
    assert!(client.contains(r#"personas: readonly string[] = ["carol"]"#) && client.contains("createApp({ url, persona })"), "{client}");
    let app = fs::read_to_string(dir.0.join("src/App.tsx")).unwrap();
    // The schema has none of the todo starter's operations: the screen behind
    // the picker is the neutral Home, which compiles against any schema.
    assert!(!app.contains("auth.guest()") && app.contains("usePersonaApp(persona, openApp)") && app.contains("function Home(") && !app.contains("api.list"), "{app}");
    // Rerunning skips everything it wrote and still never touches the schema.
    let again = dir.init(&["--web", "--skip-existing"]);
    assert!(again.status.success(), "{again:?}");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), mine);
    // Package conflicts are not files to keep: they still refuse.
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), r#"{"dependencies":{"snapback4":"0.0.1"}}"#).unwrap();
    let output = dir.init(&["--web", "--skip-existing"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("dependencies.snapback4"));
    assert!(!dir.0.join("snapback").exists());
}

#[test]
fn init_port_sets_the_backend_url_and_next_step() {
    for flag in ["--web", "--expo", "--online"] {
        let dir = Dir::new();
        let output = dir.init(&[flag, "--port", "4517"]);
        assert!(output.status.success(), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stdout).contains("`snapback4 dev --port 4517`"), "{output:?}");
        let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
        assert!(client.contains("127.0.0.1:4517") && !client.contains("4400"), "{flag}: {client}");
    }
    let dir = Dir::new();
    assert_eq!(dir.init(&["--web", "--port", "http"]).status.code(), Some(2));
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
}

#[test]
fn init_beside_a_projects_own_schema_leaves_its_tests_green() {
    for flag in ["--web", "--expo"] {
        let dir = Dir::new();
        fs::create_dir_all(dir.0.join("snapback")).unwrap();
        fs::create_dir_all(dir.0.join("fixtures")).unwrap();
        fs::write(dir.0.join("snapback/schema.q"), "use identity\nuse personas alice\ntable notes:\n  body: text <=100\n  ownerId: principal\n  read <- .ownerId = viewer\n  insert <- .ownerId = viewer\nquery mine(c: cursor ?):\n  return notes where .ownerId = viewer after c first 50 by .id\n").unwrap();
        fs::write(dir.0.join("fixtures/notes.jsonl"), "{\"id\":\"n1\",\"body\":\"hi\",\"ownerId\":\"dev:alice\"}\n").unwrap();
        fs::write(dir.0.join("fixtures/test.cases.jsonl"), "{\"as\":\"alice\",\"op\":\"mine\",\"args\":{},\"count\":1}\n").unwrap();
        let output = dir.init(&[flag, "--skip-existing"]);
        assert!(output.status.success(), "{flag}: {output:?}");
        assert!(!dir.0.join("fixtures/todos.jsonl").exists(), "{flag}");
        assert_eq!(fs::read_to_string(dir.0.join("fixtures/test.cases.jsonl")).unwrap(), "{\"as\":\"alice\",\"op\":\"mine\",\"args\":{},\"count\":1}\n");
        // With `use identity` the guest screen stays.
        let app = fs::read_to_string(dir.0.join(if flag == "--web" { "src/App.tsx" } else { "App.tsx" })).unwrap();
        assert!(app.contains("auth.guest()"), "{flag}");
        let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
        assert!(tested.status.success() && String::from_utf8_lossy(&tested.stdout).contains("cases: 1 passed, 0 failed"), "{flag}: {tested:?}");
    }
    // Wave 4 (1d): the starter's unmodified todos.jsonl beside a schema without
    // `todos` is skipped with a warning naming `init --adapt`; the project's
    // own rows still load and its cases still run.
    let dir = Dir::new();
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    fs::write(dir.0.join("snapback/schema.q"), "use personas alice\ntable notes:\n  body: text <=100\n  public 'shared'\nquery all(c: cursor ?):\n  return notes after c first 50 by .id\n").unwrap();
    let starter = Dir::new();
    assert!(starter.run("--web").status.success());
    fs::create_dir_all(dir.0.join("fixtures")).unwrap();
    fs::copy(starter.0.join("fixtures/todos.jsonl"), dir.0.join("fixtures/todos.jsonl")).unwrap();
    fs::write(dir.0.join("fixtures/notes.jsonl"), "{\"id\":\"n1\",\"body\":\"hi\"}\n").unwrap();
    fs::write(dir.0.join("fixtures/test.cases.jsonl"), "{\"as\":\"alice\",\"op\":\"all\",\"args\":{},\"count\":1}\n").unwrap();
    let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
    let stderr = String::from_utf8_lossy(&tested.stderr);
    assert!(tested.status.success() && String::from_utf8_lossy(&tested.stdout).contains("cases: 1 passed, 0 failed"), "{tested:?}");
    assert!(stderr.contains("WARNING: skipped fixtures/todos.jsonl") && stderr.contains("snapback4 init --adapt"), "{stderr}");
    // A todos.jsonl the project changed is its own file for a missing table: still a refusal, naming the starter.
    fs::write(dir.0.join("fixtures/todos.jsonl"), format!("{}{{\"id\":\"todo-eggs\",\"title\":\"Eggs\",\"done\":false,\"ownerId\":\"dev:alice\"}}\n", fs::read_to_string(starter.0.join("fixtures/todos.jsonl")).unwrap())).unwrap();
    let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
    assert!(!tested.status.success());
    assert!(String::from_utf8_lossy(&tested.stderr).contains("todo starter's sample"), "{tested:?}");
    // Any other file for a missing table refuses the run.
    fs::remove_file(dir.0.join("fixtures/todos.jsonl")).unwrap();
    fs::write(dir.0.join("fixtures/note.jsonl"), "{\"id\":\"n2\",\"body\":\"typo\"}\n").unwrap();
    let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
    assert!(!tested.status.success() && String::from_utf8_lossy(&tested.stderr).contains("note.jsonl names no table"), "{tested:?}");
}

#[test]
fn every_q_file_is_the_projects_schema() {
    for flags in [&["--web"][..], &["--web", "--skip-existing"]] {
        let dir = Dir::new();
        fs::create_dir_all(dir.0.join("snapback")).unwrap();
        fs::write(dir.0.join("snapback/app.q"), "use identity password\ntable notes:\n  body: text <=100\n  public 'shared'\n").unwrap();
        let output = dir.init(flags);
        assert!(output.status.success(), "{flags:?}: {output:?}");
        assert!(!dir.0.join("snapback/schema.q").exists() && !dir.0.join("fixtures").exists());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("auth.signup") && stdout.contains("kept 1 existing file unchanged: snapback/app.q"), "{flags:?}: {stdout}");
        assert!(dir.0.join("src/App.tsx").is_file());
    }
}

#[test]
fn init_web_port_moves_vite_with_the_backend() {
    let dir = Dir::new();
    let output = dir.init(&["--web", "--port", "50540"]);
    assert!(output.status.success(), "{output:?}");
    let config = fs::read_to_string(dir.0.join("vite.config.mts")).unwrap();
    assert!(config.contains("frontendPort = proofRange[0] === undefined ? 50541") && config.contains("server: { port: frontendPort, strictPort: true }") && config.contains("preview: { port: frontendPort, strictPort: true }"), "{config}");
    assert!(fs::read_to_string(dir.0.join("README.md")).unwrap().contains("http://localhost:50541"));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("http://127.0.0.1:50540") && stdout.contains("http://localhost:50541"), "{stdout}");
    for args in [&["--web", "--web-port", "4600"][..], &["--web", "--template", "chat", "--web-port", "4600"]] {
        let dir = Dir::new();
        assert!(dir.init(args).status.success(), "{args:?}");
        let config = fs::read_to_string(dir.0.join("vite.config.mts")).unwrap();
        assert!(config.contains("frontendPort = proofRange[0] === undefined ? 4600") && !config.contains("5173"), "{args:?}: {config}");
        assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().contains("127.0.0.1:4400"));
    }
    for args in [&["--expo", "--web-port", "4600"][..], &["--web", "--web-port", "0"], &["--web", "--port", "4500", "--web-port", "4500"]] {
        let dir = Dir::new();
        assert_eq!(dir.init(args).status.code(), Some(2), "{args:?}");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0, "{args:?}");
    }
}

#[test]
fn frontend_starters_ignore_builds_and_take_the_directorys_name() {
    for flag in ["--web", "--expo"] {
        let parent = Dir::new();
        let dir = parent.0.join("bake-sale");
        fs::create_dir_all(&dir).unwrap();
        let output = Command::new(BIN).args(["init", flag]).current_dir(&dir).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(fs::read_to_string(dir.join(".gitignore")).unwrap().lines().any(|line| line == "dist/"), "{flag}");
        if flag == "--web" { assert!(fs::read_to_string(dir.join("index.html")).unwrap().contains("<title>Bake Sale</title>")); }
        else {
            let config: Value = serde_json::from_slice(&fs::read(dir.join("app.json")).unwrap()).unwrap();
            assert_eq!(config["expo"]["name"], "Bake Sale");
            // Wave 6 (067): the ids are the directory's, never the todo starter's.
            assert_eq!((&config["expo"]["slug"], &config["expo"]["scheme"], &config["expo"]["ios"]["bundleIdentifier"], &config["expo"]["android"]["package"]),
                (&json!("bake-sale"), &json!("bakesale"), &json!("dev.snapback4.bakesale"), &json!("dev.snapback4.bakesale")));
        }
    }
    let dir = Dir::new();
    assert!(dir.run("--online").status.success());
    assert!(!fs::read_to_string(dir.0.join(".gitignore")).unwrap().contains("dist/"));
}

#[test]
fn package_scripts_compare_as_commands() {
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), r#"{"type":"commonjs","scripts":{"typecheck":"tsc --noEmit   -p tsconfig.json"}}"#).unwrap();
    let output = dir.run("--expo");
    assert!(output.status.success(), "{output:?}");
    let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["scripts"]["typecheck"], "tsc --noEmit   -p tsconfig.json", "the existing spelling is kept");
    // `npm init -y && npm i snapback4` saves a caret range of the same version.
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), json!({"type":"commonjs","dependencies":{"snapback4":format!("^{}", env!("CARGO_PKG_VERSION"))}}).to_string()).unwrap();
    let output = dir.run("--web");
    assert!(output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("pinned package.json dependencies.snapback4"), "{output:?}");
    let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["dependencies"]["snapback4"], env!("CARGO_PKG_VERSION"));
    assert_eq!(package["type"], "commonjs", "the package keeps its type; vite.config.mts is ESM regardless");
    // A different command still refuses.
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), r#"{"scripts":{"typecheck":"tsc --noEmit -p other.json"}}"#).unwrap();
    let output = dir.run("--expo");
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("scripts.typecheck"));
}

/// Wave 3 (0.4.18): agents run `init --web` first, then replace the schema,
/// and are left with the todo starter's fixtures and a guest screen the schema
/// cannot sign in to. `check` names those files and `init --adapt` fits them,
/// judging each by the starter's original bytes.
#[test]
fn init_first_then_schema_leftovers_are_named_and_adapted() {
    let check = |dir: &Dir| Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
    let check_json = |dir: &Dir| -> Value { serde_json::from_slice(&Command::new(BIN).args(["check", "--json"]).current_dir(&dir.0).output().unwrap().stdout).unwrap() };
    let dir = Dir::new();
    assert!(dir.init(&["--web", "--port", "4517"]).status.success());
    // The untouched starter fits its own schema: nothing to report.
    let fresh = check(&dir);
    assert!(fresh.status.success() && !String::from_utf8_lossy(&fresh.stdout).contains("starter:"), "{fresh:?}");
    assert!(check_json(&dir)["starterLeftovers"].is_null());
    let personas = "use personas carol, dave\ntable notes:\n  body: text <=100\n  public 'shared'\n  insert <- allow\n";
    fs::write(dir.0.join("snapback/schema.q"), personas).unwrap();
    let named = check(&dir);
    assert!(named.status.success(), "{named:?}");
    let stdout = String::from_utf8_lossy(&named.stdout);
    for text in ["starter: 5 files left", "fixtures/todos.jsonl", "fixtures/test.cases.jsonl", "src/App.tsx: the unmodified starter screen shows the guest sign-in", "src/client.ts", "README.md: the unmodified starter README describes the todo starter", "fix: snapback4 init --adapt"] {
        assert!(stdout.contains(text), "{text}: {stdout}");
    }
    let json = check_json(&dir);
    assert_eq!(json["starterLeftovers"]["fix"], "snapback4 init --adapt");
    assert_eq!(json["starterLeftovers"]["files"].as_array().unwrap().iter().map(|file| file["path"].as_str().unwrap()).collect::<Vec<_>>(), ["fixtures/todos.jsonl", "fixtures/test.cases.jsonl", "src/App.tsx", "src/client.ts", "README.md"]);
    // `test` points at the same command.
    let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "carol"]).current_dir(&dir.0).output().unwrap();
    assert!(!tested.status.success() && String::from_utf8_lossy(&tested.stderr).contains("snapback4 init --adapt"), "{tested:?}");
    // A second init over the first one's starter names --adapt first.
    let again = dir.init(&["--web"]);
    assert_eq!(again.status.code(), Some(1));
    let refusal = String::from_utf8_lossy(&again.stderr);
    assert!(refusal.lines().next().unwrap().contains("snapback4 init --adapt") && !refusal.contains("schema.q already exists"), "{refusal}");
    let adapted = dir.init(&["--adapt", "--apply"]);
    assert!(adapted.status.success(), "{adapted:?}");
    let stdout = String::from_utf8_lossy(&adapted.stdout);
    assert!(stdout.contains("removed fixtures/todos.jsonl and fixtures/test.cases.jsonl") && stdout.contains("rewrote src/App.tsx and src/client.ts and README.md"), "{stdout}");
    // Wave 4 (R1): adapt removes the files it names, never the directory.
    assert!(dir.0.join("fixtures").is_dir() && fs::read_dir(dir.0.join("fixtures")).unwrap().count() == 0);
    assert!(stdout.contains("fixtures/ stays"), "{stdout}");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), personas);
    let app = fs::read_to_string(dir.0.join("src/App.tsx")).unwrap();
    let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
    assert!(!app.contains("auth.guest()") && app.contains("usePersonaApp(persona, openApp)"), "{app}");
    assert!(client.contains(r#"personas: readonly string[] = ["carol", "dave"]"#) && client.contains("127.0.0.1:4517") && !client.contains("4400"), "{client}");
    // Exactly what schema-first init writes for the same schema and port.
    let schema_first = Dir::new();
    fs::create_dir_all(schema_first.0.join("snapback")).unwrap();
    fs::write(schema_first.0.join("snapback/schema.q"), personas).unwrap();
    assert!(schema_first.init(&["--web", "--port", "4517"]).status.success());
    for file in ["src/App.tsx", "src/client.ts"] {
        assert_eq!(fs::read_to_string(dir.0.join(file)).unwrap(), fs::read_to_string(schema_first.0.join(file)).unwrap(), "{file}");
    }
    // Wave 6 (042): the README is rewritten too, to the one schema-first init writes
    // (named after the directory, the persona sign-in, `dev --port`), apart from the title.
    let readme = fs::read_to_string(dir.0.join("README.md")).unwrap();
    assert!(!readme.contains("todos") && readme.contains("usePersonaApp") && readme.contains("npx snapback4 dev --port 4517 ") && readme.contains("127.0.0.1:4517"), "{readme}");
    let body = |text: String| text.split_once('\n').unwrap().1.to_owned();
    assert_eq!(body(readme), body(fs::read_to_string(schema_first.0.join("README.md")).unwrap()));
    // Adapted: the screen behind the picker is the neutral Home, so nothing is
    // left over and no screen calls the starter's operations (wave 4, 1c).
    assert!(app.contains("function Home(") && app.contains("useSignedInViewer()") && !app.contains("api.list"), "{app}");
    assert!(check_json(&dir)["starterLeftovers"].is_null());
    assert!(!String::from_utf8_lossy(&check(&dir).stdout).contains("starter:"));
    // New personas rewrite the picker's list; `use identity` brings the guest screen back.
    fs::write(dir.0.join("snapback/schema.q"), personas.replace("carol, dave", "erin")).unwrap();
    assert!(dir.init(&["--adapt", "--apply"]).status.success());
    assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().contains(r#"= ["erin"];"#));
    fs::write(dir.0.join("snapback/schema.q"), format!("use identity\n{personas}")).unwrap();
    assert!(dir.init(&["--adapt", "--apply"]).status.success());
    let guest = Dir::new();
    fs::create_dir_all(guest.0.join("snapback")).unwrap();
    fs::write(guest.0.join("snapback/schema.q"), format!("use identity\n{personas}")).unwrap();
    assert!(guest.init(&["--web", "--port", "4517"]).status.success());
    for file in ["src/App.tsx", "src/client.ts"] {
        assert_eq!(fs::read_to_string(dir.0.join(file)).unwrap(), fs::read_to_string(guest.0.join(file)).unwrap(), "{file}");
    }
    // A second adapt has nothing to do.
    let idle = dir.init(&["--adapt", "--apply"]);
    assert!(idle.status.success() && String::from_utf8_lossy(&idle.stdout).contains("nothing to adapt"), "{idle:?}");
}

/// Wave 6 (067): Expo projects started by 0.4.21 or earlier carry the todo
/// starter's slug, scheme and bundle ids. `check` names them and `init
/// --adapt` renames only those values after the directory; changed ids stay.
#[test]
fn adapt_names_an_old_expo_starters_ids_after_the_directory() {
    let parent = Dir::new();
    let dir = parent.0.join("4h-club");
    fs::create_dir_all(&dir).unwrap();
    let run = |args: &[&str]| Command::new(BIN).args(args).current_dir(&dir).output().unwrap();
    assert!(run(&["init", "--expo"]).status.success());
    let fresh = fs::read_to_string(dir.join("app.json")).unwrap();
    assert!(fresh.contains("\"4h-club\"") && fresh.contains("\"app4hclub\"") && fresh.contains("\"dev.snapback4.app4hclub\"") && !fresh.contains("todos"), "{fresh}");
    let old = fresh.replace("\"dev.snapback4.app4hclub\"", "\"dev.snapback4.todos\"").replace("\"app4hclub\"", "\"snapback4todos\"").replace("\"4h-club\"", "\"snapback4-todos\"");
    fs::write(dir.join("app.json"), &old).unwrap();
    let checked = String::from_utf8_lossy(&run(&["check"]).stdout).into_owned();
    assert!(checked.contains("app.json: the todo starter's ids") && checked.contains("dev.snapback4.app4hclub"), "{checked}");
    let adapted = run(&["init", "--adapt", "--apply"]);
    assert!(adapted.status.success() && String::from_utf8_lossy(&adapted.stdout).contains("rewrote") && String::from_utf8_lossy(&adapted.stdout).contains("app.json"), "{adapted:?}");
    assert_eq!(fs::read_to_string(dir.join("app.json")).unwrap(), fresh, "only the ids change");
    // A project that set its own bundle id keeps the file as it is.
    let mine = old.replace("\"dev.snapback4.todos\",\n      \"supportsTablet\"", "\"com.example.club\",\n      \"supportsTablet\"");
    assert_ne!(mine, old);
    fs::write(dir.join("app.json"), &mine).unwrap();
    assert!(String::from_utf8_lossy(&run(&["init", "--adapt", "--apply"]).stdout).contains("nothing to adapt"));
    assert_eq!(fs::read_to_string(dir.join("app.json")).unwrap(), mine);
}

#[test]
fn adapt_never_touches_a_file_the_project_changed() {
    let dir = Dir::new();
    assert!(dir.init(&["--expo"]).status.success());
    fs::write(dir.0.join("snapback/schema.q"), "use personas carol\ntable notes:\n  body: text <=100\n  public 'shared'\n").unwrap();
    // The project edited its screen and its cases; the rows are still the starter's.
    let app = format!("{}\n// mine\n", fs::read_to_string(dir.0.join("App.tsx")).unwrap());
    fs::write(dir.0.join("App.tsx"), &app).unwrap();
    let cases = format!("{}{{\"as\":\"carol\",\"op\":\"list\",\"args\":{{}}}}\n", fs::read_to_string(dir.0.join("fixtures/test.cases.jsonl")).unwrap());
    fs::write(dir.0.join("fixtures/test.cases.jsonl"), &cases).unwrap();
    let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
    let checked = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
    let stdout = String::from_utf8_lossy(&checked.stdout);
    // Wave 6: the README is the starter's own, unmodified, so it follows the schema even beside a changed screen.
    assert!(stdout.contains("starter: 2 files left") && stdout.contains("fixtures/todos.jsonl") && stdout.contains("README.md") && !stdout.contains("App.tsx"), "{stdout}");
    let before = snapshot(&dir.0);
    let preview = dir.init(&["--adapt"]);
    assert!(preview.status.success() && String::from_utf8_lossy(&preview.stdout).contains("preview only"), "{preview:?}");
    assert_eq!(snapshot(&dir.0), before, "edited app defaults to a nonmutating preview");
    let adapted = dir.init(&["--adapt", "--apply"]);
    assert!(adapted.status.success(), "{adapted:?}");
    assert!(!dir.0.join("fixtures/todos.jsonl").exists());
    assert_eq!(fs::read_to_string(dir.0.join("fixtures/test.cases.jsonl")).unwrap(), cases);
    assert_eq!(fs::read_to_string(dir.0.join("App.tsx")).unwrap(), app);
    assert_eq!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap(), client);
    let adapted = String::from_utf8_lossy(&adapted.stdout);
    assert!(adapted.contains("rewrote README.md —") && adapted.contains("application-owned or modified files stay unchanged:") && !adapted.contains("rewrite App.tsx") && !adapted.contains("rewrite src/client.ts"), "{adapted}");
    // An unmodified Expo screen adapts like the web one.
    let dir = Dir::new();
    assert!(dir.init(&["--expo"]).status.success());
    fs::write(dir.0.join("snapback/schema.q"), "use personas carol\ntable notes:\n  body: text <=100\n  public 'shared'\n").unwrap();
    assert!(dir.init(&["--adapt", "--apply"]).status.success());
    assert!(fs::read_to_string(dir.0.join("App.tsx")).unwrap().contains("usePersonaApp(persona, openApp)"));
    assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().contains(r#"= ["carol"];"#));
    // --adapt takes no starter flags and needs a schema.
    assert_eq!(dir.init(&["--adapt", "--port", "1"]).status.code(), Some(2));
    let empty = Dir::new();
    assert_eq!(empty.init(&["--adapt"]).status.code(), Some(1));
    assert_eq!(fs::read_dir(&empty.0).unwrap().count(), 0);
}

/// Wave 3: every Expo install reported a deprecated `uuid@7` (xcode@3.0.1
/// under Expo 57's config plugins) among its audit findings. The Expo
/// starters override it to a release that still exports CommonJS `v4`.
#[test]
fn expo_starters_override_the_config_plugins_uuid() {
    for flags in [&["--expo"][..], &["--expo", "--template", "chat"]] {
        let dir = Dir::new();
        assert!(dir.init(flags).status.success(), "{flags:?}");
        let package: Value = serde_json::from_str(&fs::read_to_string(dir.0.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["overrides"], json!({ "xcode": { "uuid": "11.1.1" } }), "{flags:?}");
        let readme = fs::read_to_string(dir.0.join("README.md")).unwrap();
        assert!(readme.contains("overrides") && readme.contains("node-forge") && readme.contains("SDK 44"), "{flags:?}");
    }
    // Wave 4 (15 lanes): the advisories are named before the install reports them,
    // in init's output and above the starter README's first command.
    let dir = Dir::new();
    let output = dir.init(&["--expo"]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("about 15 high advisories") && stdout.contains("do not run `npm audit fix --force`"), "{stdout}");
    let readme = fs::read_to_string(dir.0.join("README.md")).unwrap();
    let notice = readme.find("do not run `npm audit fix --force`").expect("the README names the advisories");
    assert!(notice < readme.find("npm install\n").unwrap(), "{readme}");
    let web = Dir::new();
    let output = web.init(&["--web"]);
    assert!(output.status.success() && !String::from_utf8_lossy(&output.stdout).contains("advisories"), "{output:?}");
    // An existing package's own overrides are its own.
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), r#"{"overrides":{"left-pad":"1.3.0"}}"#).unwrap();
    assert!(dir.init(&["--expo"]).status.success());
    let package: Value = serde_json::from_str(&fs::read_to_string(dir.0.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["overrides"], json!({ "left-pad": "1.3.0" }));
}

// Wave 3 (LLP 3000.037): 36 lanes guessed `vite.config.ts` or `metro.config.cjs`.
// init names every file it wrote, and each named file exists.
#[test]
fn init_lists_the_files_it_wrote() {
    for (args, expected) in [(&["--web"][..], &["vite.config.mts", "src/{", "App.tsx"][..]), (&["--expo"], &["metro.config.js", "metro-wasm-transformer.cjs", "App.tsx"])] {
        let dir = Dir::new();
        let output = dir.init(args);
        assert!(output.status.success(), "{output:?}");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let listed = stdout.lines().find_map(|line| line.strip_prefix("init: files: ")).unwrap_or_else(|| panic!("{args:?}: {stdout}"));
        for name in expected { assert!(listed.contains(name), "{args:?}: {listed}"); }
        assert!(!listed.contains("vite.config.ts") && !listed.contains("metro.config.cjs"), "{listed}");
        // Expand `dir/{a, b}` and check every listed file exists.
        let mut names = Vec::new();
        let mut rest = listed;
        while !rest.is_empty() {
            let (item, tail) = match (rest.find(", "), rest.find('{')) {
                (_, Some(open)) if rest.find(", ").is_none_or(|comma| open < comma) => {
                    let close = rest.find('}').unwrap();
                    (&rest[..=close], rest[close + 1..].trim_start_matches(", "))
                }
                (Some(comma), _) => (&rest[..comma], &rest[comma + 2..]),
                (None, _) => (rest, ""),
            };
            match item.split_once("/{") {
                Some((dir_name, members)) => names.extend(members.trim_end_matches('}').split(", ").map(|m| format!("{dir_name}/{m}"))),
                None => names.push(item.to_owned()),
            }
            rest = tail;
        }
        for name in names { assert!(dir.0.join(&name).exists(), "{args:?}: listed {name} does not exist ({listed})"); }
    }
}

/// Wave 4 (R1, 17 lanes): `init --adapt` removed the emptied `fixtures/`, so
/// the documented next step, writing `fixtures/<table>.jsonl`, failed. Adapt
/// removes only the starter files it names; the project's own fixture files
/// and the directory stay.
#[test]
fn adapt_keeps_the_fixture_directory_and_the_projects_own_rows() {
    let dir = Dir::new();
    assert!(dir.init(&["--web"]).status.success());
    fs::write(dir.0.join("snapback/schema.q"), "use identity\nuse personas alice\ntable notes:\n  body: text <=100\n  ownerId: principal\n  read <- .ownerId = viewer\n  insert <- .ownerId = viewer\nquery mine(c: cursor ?):\n  return notes where .ownerId = viewer after c first 50 by .id\n").unwrap();
    let mine = "{\"id\":\"n1\",\"body\":\"hi\",\"ownerId\":\"dev:alice\"}\n";
    fs::write(dir.0.join("fixtures/notes.jsonl"), mine).unwrap();
    let adapted = dir.init(&["--adapt", "--apply"]);
    assert!(adapted.status.success(), "{adapted:?}");
    let stdout = String::from_utf8_lossy(&adapted.stdout);
    assert!(stdout.contains("removed fixtures/todos.jsonl and fixtures/test.cases.jsonl") && !stdout.contains("notes.jsonl"), "{stdout}");
    assert!(dir.0.join("fixtures").is_dir());
    assert_eq!(fs::read_to_string(dir.0.join("fixtures/notes.jsonl")).unwrap(), mine);
    assert!(!dir.0.join("fixtures/todos.jsonl").exists() && !dir.0.join("fixtures/test.cases.jsonl").exists());
    // With only the starter's files there, the emptied directory stays too.
    let dir = Dir::new();
    assert!(dir.init(&["--expo"]).status.success());
    fs::write(dir.0.join("snapback/schema.q"), "use personas carol\ntable notes:\n  body: text <=100\n  public 'shared'\n").unwrap();
    assert!(dir.init(&["--adapt", "--apply"]).status.success());
    assert!(dir.0.join("fixtures").is_dir());
    fs::write(dir.0.join("fixtures/notes.jsonl"), "{\"id\":\"n1\",\"body\":\"hi\"}\n").unwrap();
}

/// Wave 4 (1c, 8 lanes): after `--adapt` the starter's Todos screen still
/// called list/add/toggle/remove and the app did not typecheck. Beside a
/// schema without those operations, both orders (init first, then adapt; or
/// schema first) write the same neutral Home screen, for web and Expo, under
/// the guest sign-in and the persona picker.
#[test]
fn a_schema_without_the_todo_operations_gets_a_neutral_home_screen() {
    // Wave 5: the Home renders the first query without required arguments (`recent`, not `one`).
    let notes = "table notes:\n  body: text <=100\n  public 'shared'\n  insert <- allow\nmutation post(body: text 1..100):\n  return insert notes { body }\nquery one(n: notes):\n  return notes[n]\nquery recent(c: cursor ?):\n  return notes first 20 by .id after c\n";
    for (flag, app_path) in [("--web", "src/App.tsx"), ("--expo", "App.tsx")] {
        for sign_in in ["use identity\n", "use personas carol, dave\n"] {
            let schema = format!("{sign_in}{notes}");
            let first = Dir::new();
            assert!(first.init(&[flag]).status.success());
            fs::write(first.0.join("snapback/schema.q"), &schema).unwrap();
            let adapted = first.init(&["--adapt", "--apply"]);
            assert!(adapted.status.success(), "{adapted:?}");
            let stdout = String::from_utf8_lossy(&adapted.stdout);
            assert!(stdout.contains(&format!("rewrote {app_path}")) && stdout.contains("replace Home with your own screens"), "{flag} {sign_in}: {stdout}");
            let app = fs::read_to_string(first.0.join(app_path)).unwrap();
            assert!(app.contains("function Home(") && !app.contains("function Todos()") && app.contains("useSignedInViewer()") && app.contains("Object.keys(api)"), "{flag} {sign_in}: {app}");
            // Wave 5 (lane 062): behind the persona picker there is no session; Home switches persona.
            if sign_in.contains("personas") {
                assert!(app.contains("function Home({ leave }: { leave: () => void })") && app.contains("Switch persona") && !app.contains("Sign out") && !app.contains("auth.logout()"), "{flag}: {app}");
                assert!(app.contains("<Home leave={"), "{flag}: the picker hands Home its leave: {app}");
            } else {
                assert!(app.contains("function Home()") && app.contains("Sign out") && app.contains("auth.logout()"), "{flag}: {app}");
            }
            for todo in ["api.list", "api.add", "api.toggle", "api.remove", "<Todos />"] { assert!(!app.contains(todo), "{flag} {sign_in}: {todo}"); }
            assert!(app.contains("<FirstRead />") && app.contains("const read = useQuery(api.recent, {});") && app.contains("matchRead(read, {") && !app.contains("api.one"), "{flag} {sign_in}: {app}");
            assert_eq!(app.contains("usePersonaApp(persona, openApp)"), sign_in.contains("personas"), "{flag} {sign_in}");
            // Wave 6 (042): the README follows the screen, and is what schema-first init writes.
            let readme = fs::read_to_string(first.0.join("README.md")).unwrap();
            assert!(!readme.contains("todos") && readme.contains("`Home`") && readme.contains(if sign_in.contains("personas") { "usePersonaApp" } else { "Continue as a guest" }), "{flag} {sign_in}: {readme}");
            assert_eq!(app.contains("auth.guest()"), sign_in.contains("identity"), "{flag} {sign_in}");
            // One import per module.
            let modules: Vec<&str> = app.lines().filter(|line| line.starts_with("import ")).map(|line| line.rsplit_once(" from ").unwrap().1).collect();
            let mut unique = modules.clone();
            unique.sort(); unique.dedup();
            assert_eq!(unique.len(), modules.len(), "{flag} {sign_in}: {app}");
            // Nothing left over, and a second adapt has nothing to do.
            assert!(!String::from_utf8_lossy(&Command::new(BIN).arg("check").current_dir(&first.0).output().unwrap().stdout).contains("starter:"));
            assert!(String::from_utf8_lossy(&first.init(&["--adapt", "--apply"]).stdout).contains("nothing to adapt"));
            // Schema first writes exactly the same screen and client.
            let schema_first = Dir::new();
            fs::create_dir_all(schema_first.0.join("snapback")).unwrap();
            fs::write(schema_first.0.join("snapback/schema.q"), &schema).unwrap();
            assert!(schema_first.init(&[flag]).status.success());
            for file in [app_path, "src/client.ts"] {
                assert_eq!(fs::read_to_string(first.0.join(file)).unwrap(), fs::read_to_string(schema_first.0.join(file)).unwrap(), "{flag} {sign_in}: {file}");
            }
            let body = |dir: &Dir| fs::read_to_string(dir.0.join("README.md")).unwrap().split_once('\n').unwrap().1.to_owned();
            assert_eq!(body(&first), body(&schema_first), "{flag} {sign_in}: README");
            // Restoring the todo operations brings the Todos screen back.
            fs::write(first.0.join("snapback/schema.q"), format!("{sign_in}{}", include_str!("../src/verbs/init/starter/schema.q").lines().filter(|line| !line.starts_with("use ")).collect::<Vec<_>>().join("\n"))).unwrap();
            assert!(first.init(&["--adapt", "--apply"]).status.success());
            assert!(fs::read_to_string(first.0.join(app_path)).unwrap().contains("function Todos()"), "{flag} {sign_in}");
            assert!(fs::read_to_string(first.0.join("README.md")).unwrap().starts_with("# Todos: a Snapback 4"), "{flag} {sign_in}: the todo README comes back with the screen");
        }
    }
}

/// Wave 4 (1b, 6 lanes): schema first, `check`, then `init --web` refused
/// `E_INIT_CONFLICT` on check's own snapback/generated/package.json, and then
/// on `tsc --noEmit` against the starter's `tsc -p tsconfig.json --noEmit`.
#[test]
fn schema_first_init_after_check_replaces_generated_files() {
    for flag in ["--web", "--expo"] {
        let dir = Dir::new();
        fs::create_dir_all(dir.0.join("snapback")).unwrap();
        fs::write(dir.0.join("snapback/schema.q"), "use identity\ntable notes:\n  body: text <=100\n  public 'shared'\n").unwrap();
        let checked = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        assert!(checked.status.success() && dir.0.join("snapback/generated/package.json").is_file() && dir.0.join("snapback/generated/api.ts").is_file(), "{checked:?}");
        let api = fs::read(dir.0.join("snapback/generated/api.ts")).unwrap();
        fs::write(dir.0.join("package.json"), r#"{"name":"mine","type":"module","scripts":{"typecheck":"tsc --noEmit"}}"#).unwrap();
        let output = dir.init(&[flag]);
        assert!(output.status.success(), "{flag}: {output:?}");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("kept your package.json scripts.typecheck \"tsc --noEmit\""), "{flag}: {stdout}");
        let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["scripts"]["typecheck"], "tsc --noEmit");
        assert_eq!(fs::read(dir.0.join("snapback/generated/api.ts")).unwrap(), api, "init writes only generated/package.json");
        assert!(serde_json::from_slice::<Value>(&fs::read(dir.0.join("snapback/generated/package.json")).unwrap()).is_ok());
    }
    // `npx tsc …` and `--project tsconfig.json` are the same command too; another project is not.
    let dir = Dir::new();
    fs::write(dir.0.join("package.json"), r#"{"scripts":{"typecheck":"npx tsc --project ./tsconfig.json --noEmit"}}"#).unwrap();
    assert!(dir.run("--expo").status.success());
}

/// Wave 7 (R3, 5 lanes: 004 038 064 082 091): beside an all-`online only`
/// schema the README said "It works offline and syncs when the link returns"
/// and init's summary "offline-capable". Both now follow the synced tables, at
/// init and at `--adapt`, and adapt still recognizes 0.4.22's README.
#[test]
fn the_readme_says_what_works_offline_from_the_schemas_synced_tables() {
    let online = "use identity\ntable orders:\n  owner: principal\n  title: text 1..80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nquery mine(c: cursor ?):\n  return orders where .owner = viewer first 20 by .id after c\n";
    let synced = format!("{online}table notes:\n  owner: principal\n  body: text <=200\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\n");
    for flag in ["--web", "--expo"] {
        let dir = Dir::new();
        fs::create_dir_all(dir.0.join("snapback")).unwrap();
        fs::write(dir.0.join("snapback/schema.q"), online).unwrap();
        let output = dir.init(&[flag]);
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success() && stdout.contains("online reads (no table declares `sync`") && !stdout.contains("offline-capable"), "{flag}: {stdout}");
        let readme = fs::read_to_string(dir.0.join("README.md")).unwrap();
        let flat = readme.replace('\n', " ");
        assert!(!readme.contains("works offline") && !readme.contains("work offline"), "{flag}: {readme}");
        assert!(flat.contains("no table in `snapback/*.q` declares `sync`, so reads need the server. Writes made offline are kept") && flat.contains(if flag == "--web" { "principal journal" } else { "on this device" }), "{flag}: {readme}");
        assert!(readme.lines().all(|line| line.matches('`').count() % 2 == 0 || line.starts_with("```") || line.contains("``")), "{flag}: no code span is wrapped: {readme}");
        // The schema grows a synced table: adapt rewrites only that paragraph.
        fs::write(dir.0.join("snapback/schema.q"), &synced).unwrap();
        let checked = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        assert!(String::from_utf8_lossy(&checked.stdout).contains("README.md: the unmodified starter README says what works offline for another schema"), "{flag}: {checked:?}");
        let adapted = dir.init(&["--adapt", "--apply"]);
        assert!(adapted.status.success() && String::from_utf8_lossy(&adapted.stdout).contains("rewrote") && String::from_utf8_lossy(&adapted.stdout).contains("README.md"), "{flag}: {adapted:?}");
        let after = fs::read_to_string(dir.0.join("README.md")).unwrap();
        if flag == "--web" { assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().contains("device: webDevice()"), "adapt follows the newly synced table"); }
        assert!(after.replace('\n', " ").contains("the synced table (`notes`) reads and writes offline"), "{flag}: {after}");
        assert_eq!(after.split("\n\n").filter(|paragraph| !paragraph.starts_with("Offline")).collect::<Vec<_>>(),
            readme.replace("web uses the principal write journal (no synced tables).", "web uses the wasm\ndevice.").replace("or the principal write journal (web, no synced tables).", "or `webDevice()` (web).").split("\n\n").filter(|paragraph| !paragraph.starts_with("Offline")).collect::<Vec<_>>(), "{flag}: only offline wording changes");
        assert!(dir.init(&["--adapt", "--apply"]).status.success());
        assert_eq!(fs::read_to_string(dir.0.join("README.md")).unwrap(), after, "{flag}: adapt is idempotent");
        // 0.4.22's README (the unconditional claim) is still the starter's, and is rewritten.
        let legacy = match flag {
            "--web" => after.split("\n\n").filter(|paragraph| !paragraph.starts_with("Offline")).collect::<Vec<_>>().join("\n\n")
                .replace("the Snapback 4 web starter.", "the Snapback 4 web starter. It works offline and syncs when the link returns."),
            _ => after.split("\n\n").filter(|paragraph| !paragraph.starts_with("Offline")).collect::<Vec<_>>().join("\n\n")
                .replace("open the native device; Expo Go uses the online client; web uses the wasm\ndevice.", "open the native device and work offline; Expo Go uses the online client; web\nuses the wasm device."),
        };
        assert_ne!(legacy, after);
        fs::write(dir.0.join("README.md"), &legacy).unwrap();
        assert!(dir.init(&["--adapt", "--apply"]).status.success());
        assert_eq!(fs::read_to_string(dir.0.join("README.md")).unwrap(), after, "{flag}: 0.4.22's README is rewritten");
        // A README the project edited is never touched.
        fs::write(dir.0.join("README.md"), format!("{after}\nMy notes.\n")).unwrap();
        fs::write(dir.0.join("snapback/schema.q"), online).unwrap();
        assert!(dir.init(&["--adapt", "--apply"]).status.success());
        assert!(fs::read_to_string(dir.0.join("README.md")).unwrap().ends_with("My notes.\n"));
    }
    // The todo starter's own schema syncs its one table; its README keeps its claim.
    let dir = Dir::new();
    let output = dir.init(&["--web"]);
    assert!(String::from_utf8_lossy(&output.stdout).contains("Vite + React todos, offline-capable"));
    assert!(fs::read_to_string(dir.0.join("README.md")).unwrap().contains("It works offline and syncs when the link returns."));
}

/// Wave 7 (11 lanes): seven lanes hand-edited 4400/5173/4173 and asked for one
/// option that sets the backend and page ports together; `--port N` already
/// does, but init's success line named only `--web-port`.
#[test]
fn init_names_the_one_flag_that_moves_both_ports() {
    let dir = Dir::new();
    let stdout = String::from_utf8_lossy(&dir.init(&["--web"]).stdout).into_owned();
    assert!(stdout.contains("`init --web --port N` sets the backend to N and the page to N+1 together"), "{stdout}");
    let dir = Dir::new();
    let stdout = String::from_utf8_lossy(&dir.init(&["--web", "--port", "20010"]).stdout).into_owned();
    assert!(stdout.contains("http://127.0.0.1:20010") && stdout.contains("http://localhost:20011") && !stdout.contains("sets the backend to N"), "{stdout}");
    let dir = Dir::new();
    let stdout = String::from_utf8_lossy(&dir.init(&["--expo"]).stdout).into_owned();
    assert!(stdout.contains("`init --expo --port N` sets the client's URL"), "{stdout}");
    let help = Command::new(BIN).args(["init", "--help"]).output().unwrap();
    let help = String::from_utf8_lossy(&help.stdout);
    assert!(help.contains("--port N") && help.contains("the page on N+1") && help.contains("one flag moves all of them"), "{help}");
}

#[test]
fn wave8_web_client_chooses_principal_journal_for_both_identity_modes_when_nothing_syncs() {
    for identity in ["use identity", "use personas alice, bob"] {
        for sync in [false, true] {
            let dir = Dir::new(); fs::create_dir_all(dir.0.join("snapback")).unwrap();
            fs::write(dir.0.join("snapback/schema.q"), format!("{identity}\ntable notes:\n  owner: principal\n  body: text <=100\n  immutable owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  {}\n", if sync { "sync to .owner" } else { "online only" })).unwrap();
            let output = dir.run("--web"); assert!(output.status.success(), "{output:?}");
            let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
            assert_eq!(client.contains("device: webDevice()"), sync, "{client}");
            assert_eq!(client.contains("from \"snapback4/web\""), sync);
            assert!(!client.contains("This schema syncs todos"));
            assert_eq!(client.contains("sessionStore: localStorageSessionStore()"), identity == "use identity");
            assert_eq!(client.contains("createApp({ url, persona"), identity.contains("personas"));
        }
    }
}

#[test]
fn password_starters_and_expo_web_journal_follow_schema() {
    for flag in ["--web", "--expo"] {
        for identity in ["use identity password", "use personas alice"] {
            let dir = Dir::new(); fs::create_dir(dir.0.join("snapback")).unwrap();
            fs::write(dir.0.join("snapback/schema.q"), format!("{identity}\ntable notes:\n  body: text 1..80\n  public\n  online only\nmutation add(body: text 1..80):\n  return insert notes {{ body }}\n")).unwrap();
            let out = dir.run(flag); assert!(out.status.success(), "{out:?}");
            let app = fs::read_to_string(dir.0.join(if flag == "--expo" { "App.tsx" } else { "src/App.tsx" })).unwrap();
            if identity.contains("password") { assert!(app.contains("auth.signup") && app.contains("auth.login") && !app.contains("auth.guest"), "{app}"); }
            let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
            assert!(!client.contains("webDevice"), "{client}");
            assert!(client.contains("get(\"api\")") && client.contains("registerWebWitness"), "{client}");
            if flag == "--expo" { assert!(client.contains("nativeDevice"), "{client}"); }
            let pkg: Value = serde_json::from_str(&fs::read_to_string(dir.0.join("package.json")).unwrap()).unwrap();
            assert!(pkg["scripts"]["build:web"].is_string());
            if flag == "--expo" { assert!(pkg["scripts"]["build:web"].as_str().unwrap().contains("--clear")); }
        }
    }
}

#[test]
fn adapt_switches_guest_password_and_persona_and_keeps_password_readme() {
    for mode in ["--web", "--expo"] {
        let dir = Dir::new(); assert!(dir.run(mode).status.success());
        let path = dir.0.join("snapback/schema.q");
        let original = fs::read_to_string(&path).unwrap();
        for (identity, expected) in [("use identity password", "the password sign-in"), ("use personas alice", "a persona picker"), ("use identity password", "the password sign-in"), ("use identity", "the guest sign-in")] {
            let body = original.lines().filter(|line| !line.starts_with("use identity") && !line.starts_with("use personas")).collect::<Vec<_>>().join("\n");
            fs::write(&path, format!("{identity}\n{body}\n")).unwrap();
            let out = dir.init(&["--adapt", "--apply"]); assert!(out.status.success(), "{out:?}");
            let text = String::from_utf8_lossy(&out.stdout); assert!(text.contains(expected), "{text}");
            let app = fs::read_to_string(dir.0.join(if mode == "--web" { "src/App.tsx" } else { "App.tsx" })).unwrap();
            if identity.contains("password") {
                assert!(app.contains("auth.signup") && !app.contains("auth.guest"));
                let readme = fs::read_to_string(dir.0.join("README.md")).unwrap();
                assert!(!readme.contains("Choose \"Continue as a"), "{readme}");
                assert!(readme.contains("Sign up or sign in"), "{readme}");
            }
        }
    }
}

#[test]
fn untouched_previous_release_clients_adapt_to_password_but_edits_stay_owned() {
    for (mode, previous) in [
        ("--web", include_str!("../src/verbs/init/starter/previous/web-client.ts")),
        ("--expo", include_str!("../src/verbs/init/starter/previous/expo-client.ts")),
        ("--web", include_str!("../src/verbs/init/starter/previous/web-persona-client.ts")),
        ("--expo", include_str!("../src/verbs/init/starter/previous/expo-persona-client.ts")),
    ] {
        let dir = Dir::new(); let persona = previous.contains("PERSONAS");
        if persona {
            fs::create_dir(dir.0.join("snapback")).unwrap();
            fs::write(dir.0.join("snapback/schema.q"), "use personas alice\nquery hello():\n  return 42\n").unwrap();
        }
        assert!(dir.run(mode).status.success());
        let client = previous.replace("PERSONAS", "[\"alice\"]").replace("127.0.0.1:4400", "127.0.0.1:4517");
        fs::write(dir.0.join("src/client.ts"), &client).unwrap();
        let schema = dir.0.join("snapback/schema.q");
        let body = fs::read_to_string(&schema).unwrap().lines().filter(|l| !l.starts_with("use identity") && !l.starts_with("use personas")).collect::<Vec<_>>().join("\n");
        fs::write(schema, format!("use identity password\n{body}\n")).unwrap();
        let out = dir.init(&["--adapt", "--apply"]); assert!(out.status.success(), "{out:?}");
        let app_path = dir.0.join(if mode == "--web" { "src/App.tsx" } else { "App.tsx" });
        let app = fs::read_to_string(&app_path).unwrap(); assert!(app.contains("auth.signup") && !app.contains("auth.guest()"), "{app}");
        let adapted = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
        assert!(adapted.contains("127.0.0.1:4517") && adapted.contains("registerWebWitness"));
        fs::write(dir.0.join("src/client.ts"), format!("{client}\n// An application edit.\n")).unwrap();
        let before = fs::read_to_string(&app_path).unwrap();
        assert!(dir.init(&["--adapt", "--apply"]).status.success());
        assert_eq!(fs::read_to_string(app_path).unwrap(), before);
        assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().ends_with("// An application edit.\n"));
    }
}

#[test]
fn untouched_starters_have_no_adaptation_advice() {
    for flags in [vec![], vec!["--online"], vec!["--web"], vec!["--expo"], vec!["--web", "--template", "chat"], vec!["--expo", "--template", "chat"], vec!["--template", "social"]] {
        let dir = Dir::new();
        assert!(dir.init(&flags).status.success());
        let output = Command::new(BIN).arg("check").current_dir(&dir.0).output().unwrap();
        let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(output.status.success(), "{flags:?}: {text}");
        assert!(!text.contains("init --adapt") && !text.contains("starter:"), "{flags:?}: {text}");
        if flags.contains(&"--expo") || flags.contains(&"social") {
            let config: Value = serde_json::from_slice(&fs::read(dir.0.join("app.json")).unwrap()).unwrap();
            assert!(config.pointer("/expo/web/favicon").is_none());
            assert!(!dir.0.join("assets/favicon.svg").exists());
        }
    }
}

#[test]
fn adapt_repairs_only_the_owned_0_4_26_expo_favicon() {
    for edited in [false, true] {
        let dir = Dir::new(); assert!(dir.init(&["--expo"]).status.success());
        fs::create_dir_all(dir.0.join("assets")).unwrap();
        let asset = include_str!("../src/verbs/init/starter/favicon.svg");
        fs::write(dir.0.join("assets/favicon.svg"), if edited { format!("{asset}<!-- mine -->") } else { asset.into() }).unwrap();
        let path = dir.0.join("app.json");
        let mut config: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        config["expo"]["web"]["favicon"] = json!("./assets/favicon.svg");
        config["expo"]["description"] = json!("keep this");
        fs::write(&path, config.to_string()).unwrap();
        assert!(dir.init(&["--adapt", "--apply"]).status.success());
        let after: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["expo"]["description"], "keep this");
        assert_eq!(after.pointer("/expo/web/favicon").is_some(), edited);
        assert_eq!(dir.0.join("assets/favicon.svg").exists(), edited);
    }
}

#[test]
fn generated_proofs_read_ports_at_execution_and_declare_the_driver() {
    for flag in ["--web", "--expo"] {
        let dir = Dir::new();
        let output = Command::new(BIN).args(["init", flag]).env("PORT_LO", "29040").env("PORT_HI", "29049").current_dir(&dir.0).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        let package: Value = serde_json::from_slice(&fs::read(dir.0.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["scripts"]["frontend:proof"], "node scripts/frontend-proof.mjs");
        assert_eq!(package["devDependencies"]["playwright-core"], "1.55.1");
        for path in ["package.json", "scripts/frontend-proof.mjs", "scripts/launch.mjs", "src/client.ts"] {
            let body = fs::read_to_string(dir.0.join(path)).unwrap();
            assert!(!body.contains("29040") && !body.contains("29041") && !body.contains("29049"), "{flag}: initializer's environment leaked into {path}");
        }
        let proof = fs::read_to_string(dir.0.join("scripts/frontend-proof.mjs")).unwrap();
        assert!(proof.contains("snapback4/proof") && proof.contains("encodeURIComponent(dev.url)") && proof.contains("cleanup("));
        assert!(!proof.contains("spawn(") && !proof.contains("npx") && !proof.contains("--port"));
    }
}

#[test]
fn adapt_adds_missing_proof_files_and_preserves_application_proofs() {
    let dir = Dir::new(); assert!(dir.run("--web").status.success());
    fs::remove_dir_all(dir.0.join("scripts")).unwrap();
    let path = dir.0.join("package.json");
    let mut package: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    package["scripts"].as_object_mut().unwrap().remove("frontend:proof");
    package["devDependencies"].as_object_mut().unwrap().remove("playwright-core");
    fs::write(&path, package.to_string()).unwrap();
    assert!(dir.init(&["--adapt", "--apply"]).status.success());
    assert!(dir.0.join("scripts/frontend-proof.mjs").is_file());
    let mut package: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(package["scripts"]["frontend:proof"], "node scripts/frontend-proof.mjs");
    assert_eq!(package["devDependencies"]["playwright-core"], "1.55.1");
    package["scripts"]["frontend:proof"] = json!("my-custom-proof"); fs::write(&path, package.to_string()).unwrap();
    fs::write(dir.0.join("scripts/frontend-proof.mjs"), "// application-owned proof\n").unwrap();
    assert!(dir.init(&["--adapt", "--apply"]).status.success());
    let package: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(package["scripts"]["frontend:proof"], "my-custom-proof");
    assert_eq!(fs::read_to_string(dir.0.join("scripts/frontend-proof.mjs")).unwrap(), "// application-owned proof\n");
}
