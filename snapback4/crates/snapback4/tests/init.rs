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
