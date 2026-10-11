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
        if flag == "--expo" { assert_eq!(after["scripts"]["start"], "expo start"); assert_eq!(after["devDependencies"]["babel-preset-expo"], "57.0.11"); }
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
    for flag in ["--online", "--expo"] {
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
        assert!(text.contains("init [dir] [--online|--expo|--web]"), "{text}");
        assert!(!text.contains("--recipe"), "{text}");
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
        assert_eq!(package["scripts"]["native:smoke"], "snapback4 witness ios --build . --smoke");
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
        assert!(texts.len() <= 18, "{flag}: {} files", texts.len());
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
    assert!(stdout.contains("kept 1 existing file unchanged: snapback/schema.q") && stdout.contains("adapt them to your schema"), "{stdout}");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), mine);
    for file in ["src/App.tsx", "src/client.ts", "package.json", "README.md", "snapback/generated/package.json"] { assert!(dir.0.join(file).is_file(), "{file}"); }
    // The starter's todos rows and cases would fail `test` beside this schema.
    assert!(!dir.0.join("fixtures").exists(), "the todo starter's fixtures stay out of a project with its own schema");
    assert!(stdout.contains("skipped the todo starter's fixtures/todos.jsonl and fixtures/test.cases.jsonl"), "{stdout}");
    // `use personas carol` and no `use identity`: nobody can sign in as a guest.
    assert!(stdout.contains("picks a persona"), "{stdout}");
    let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
    assert!(client.contains(r#"personas: readonly string[] = ["carol"]"#) && client.contains("createApp({ url, persona, device: webDevice() })"), "{client}");
    let app = fs::read_to_string(dir.0.join("src/App.tsx")).unwrap();
    assert!(!app.contains("auth.guest()") && app.contains("openApp(persona)") && app.contains("function Todos()"), "{app}");
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
    // A stray starter file from an earlier init names the starter as its source.
    let dir = Dir::new();
    fs::create_dir_all(dir.0.join("snapback")).unwrap();
    fs::write(dir.0.join("snapback/schema.q"), "use personas alice\ntable notes:\n  body: text <=100\n  public 'shared'\n").unwrap();
    let starter = Dir::new();
    assert!(starter.run("--web").status.success());
    fs::create_dir_all(dir.0.join("fixtures")).unwrap();
    fs::copy(starter.0.join("fixtures/todos.jsonl"), dir.0.join("fixtures/todos.jsonl")).unwrap();
    let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
    assert!(!tested.status.success());
    assert!(String::from_utf8_lossy(&tested.stderr).contains("todo starter's sample"), "{tested:?}");
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
    assert!(config.contains("server: { port: 50541, strictPort: true }") && config.contains("preview: { port: 50541, strictPort: true }"), "{config}");
    assert!(fs::read_to_string(dir.0.join("README.md")).unwrap().contains("http://localhost:50541"));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("http://127.0.0.1:50540") && stdout.contains("http://localhost:50541"), "{stdout}");
    for args in [&["--web", "--web-port", "4600"][..], &["--web", "--template", "chat", "--web-port", "4600"]] {
        let dir = Dir::new();
        assert!(dir.init(args).status.success(), "{args:?}");
        let config = fs::read_to_string(dir.0.join("vite.config.mts")).unwrap();
        assert!(config.contains("port: 4600") && !config.contains("5173"), "{args:?}: {config}");
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
        else { assert_eq!(serde_json::from_slice::<Value>(&fs::read(dir.join("app.json")).unwrap()).unwrap()["expo"]["name"], "Bake Sale"); }
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
    for text in ["starter: 4 files left", "fixtures/todos.jsonl", "fixtures/test.cases.jsonl", "src/App.tsx: the unmodified starter screen shows the guest sign-in", "src/client.ts", "fix: snapback4 init --adapt"] {
        assert!(stdout.contains(text), "{text}: {stdout}");
    }
    let json = check_json(&dir);
    assert_eq!(json["starterLeftovers"]["fix"], "snapback4 init --adapt");
    assert_eq!(json["starterLeftovers"]["files"].as_array().unwrap().iter().map(|file| file["path"].as_str().unwrap()).collect::<Vec<_>>(), ["fixtures/todos.jsonl", "fixtures/test.cases.jsonl", "src/App.tsx", "src/client.ts"]);
    // `test` points at the same command.
    let tested = Command::new(BIN).args(["test", "--fixture", "fixtures", "--as", "carol"]).current_dir(&dir.0).output().unwrap();
    assert!(!tested.status.success() && String::from_utf8_lossy(&tested.stderr).contains("snapback4 init --adapt"), "{tested:?}");
    // A second init over the first one's starter names --adapt first.
    let again = dir.init(&["--web"]);
    assert_eq!(again.status.code(), Some(1));
    let refusal = String::from_utf8_lossy(&again.stderr);
    assert!(refusal.lines().next().unwrap().contains("snapback4 init --adapt") && !refusal.contains("schema.q already exists"), "{refusal}");
    let adapted = dir.init(&["--adapt"]);
    assert!(adapted.status.success(), "{adapted:?}");
    let stdout = String::from_utf8_lossy(&adapted.stdout);
    assert!(stdout.contains("removed fixtures/todos.jsonl and fixtures/test.cases.jsonl") && stdout.contains("rewrote src/App.tsx and src/client.ts"), "{stdout}");
    // Wave 4 (R1): adapt removes the files it names, never the directory.
    assert!(dir.0.join("fixtures").is_dir() && fs::read_dir(dir.0.join("fixtures")).unwrap().count() == 0);
    assert!(stdout.contains("fixtures/ stays"), "{stdout}");
    assert_eq!(fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap(), personas);
    let app = fs::read_to_string(dir.0.join("src/App.tsx")).unwrap();
    let client = fs::read_to_string(dir.0.join("src/client.ts")).unwrap();
    assert!(!app.contains("auth.guest()") && app.contains("openApp(persona)"), "{app}");
    assert!(client.contains(r#"personas: readonly string[] = ["carol", "dave"]"#) && client.contains("127.0.0.1:4517") && !client.contains("4400"), "{client}");
    // Exactly what schema-first init writes for the same schema and port.
    let schema_first = Dir::new();
    fs::create_dir_all(schema_first.0.join("snapback")).unwrap();
    fs::write(schema_first.0.join("snapback/schema.q"), personas).unwrap();
    assert!(schema_first.init(&["--web", "--port", "4517"]).status.success());
    for file in ["src/App.tsx", "src/client.ts"] {
        assert_eq!(fs::read_to_string(dir.0.join(file)).unwrap(), fs::read_to_string(schema_first.0.join(file)).unwrap(), "{file}");
    }
    // Adapted: no files left over; the screen's todo calls remain advice.
    let json = check_json(&dir);
    assert!(json["starterLeftovers"]["files"].as_array().unwrap().is_empty() && json["starterLeftovers"]["fix"].is_null(), "{json}");
    assert!(String::from_utf8_lossy(&check(&dir).stdout).contains("its Todos screen still calls"));
    // New personas rewrite the picker's list; `use identity` brings the guest screen back.
    fs::write(dir.0.join("snapback/schema.q"), personas.replace("carol, dave", "erin")).unwrap();
    assert!(dir.init(&["--adapt"]).status.success());
    assert!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap().contains(r#"= ["erin"];"#));
    fs::write(dir.0.join("snapback/schema.q"), format!("use identity\n{personas}")).unwrap();
    assert!(dir.init(&["--adapt"]).status.success());
    let guest = Dir::new();
    assert!(guest.init(&["--web", "--port", "4517"]).status.success());
    for file in ["src/App.tsx", "src/client.ts"] {
        assert_eq!(fs::read_to_string(dir.0.join(file)).unwrap(), fs::read_to_string(guest.0.join(file)).unwrap(), "{file}");
    }
    // A second adapt has nothing to do.
    let idle = dir.init(&["--adapt"]);
    assert!(idle.status.success() && String::from_utf8_lossy(&idle.stdout).contains("nothing to adapt"), "{idle:?}");
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
    assert!(stdout.contains("starter: 1 file left") && stdout.contains("fixtures/todos.jsonl") && !stdout.contains("App.tsx"), "{stdout}");
    let adapted = dir.init(&["--adapt"]);
    assert!(adapted.status.success(), "{adapted:?}");
    assert!(!dir.0.join("fixtures/todos.jsonl").exists());
    assert_eq!(fs::read_to_string(dir.0.join("fixtures/test.cases.jsonl")).unwrap(), cases);
    assert_eq!(fs::read_to_string(dir.0.join("App.tsx")).unwrap(), app);
    assert_eq!(fs::read_to_string(dir.0.join("src/client.ts")).unwrap(), client);
    assert!(!String::from_utf8_lossy(&adapted.stdout).contains("rewrote"), "{adapted:?}");
    // An unmodified Expo screen adapts like the web one.
    let dir = Dir::new();
    assert!(dir.init(&["--expo"]).status.success());
    fs::write(dir.0.join("snapback/schema.q"), "use personas carol\ntable notes:\n  body: text <=100\n  public 'shared'\n").unwrap();
    assert!(dir.init(&["--adapt"]).status.success());
    assert!(fs::read_to_string(dir.0.join("App.tsx")).unwrap().contains("openApp(persona)"));
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
    let adapted = dir.init(&["--adapt"]);
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
    assert!(dir.init(&["--adapt"]).status.success());
    assert!(dir.0.join("fixtures").is_dir());
    fs::write(dir.0.join("fixtures/notes.jsonl"), "{\"id\":\"n1\",\"body\":\"hi\"}\n").unwrap();
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
