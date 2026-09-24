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
    for flag in ["--online", "--expo", "--web"] {
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
            assert!(!dir.0.join("snapback/worker.mts").exists(), "the core starter has no invitation action or worker");
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
fn web_starter_embeds_reference_and_keeps_default_schema_only() {
    let dir = Dir::new();
    let output = dir.run("--web");
    assert!(output.status.success(), "{output:?}");
    for file in ["src/App.tsx", "src/state.ts", "src/Composer.tsx", "src/client.ts", "vite.config.ts", "index.html", "README.md"] {
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
    for file in ["src/client.ts", "src/state.ts", "index.html"] {
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

const RETIRED: &str = "E_RECIPE_RETIRED: the Following recipe installer is retired; no files written\n  rewrite: maintain feed: timeline\n    events posts by authorId, at removed by removed\n    reposts reposts by actorId, postId, at\n    edges follows by followerId, followedId\n  declare before event and edge data exists; see snapback4 guide feeds\n";
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
    for flag in ["", "--online", "--expo", "--web"] {
        let dir = Dir::new();
        assert!(dir.run(flag).status.success());
        let source = fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap();
        let (document, errors) = snapback4_lang::parse_document("schema.q", &source);
        assert!(errors.is_empty());
        if flag == "--web" {
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
