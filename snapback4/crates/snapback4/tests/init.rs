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
    for name in ["README.md", "src/client.ts", "metro.config.js", "snapback/schema.q"] {
        let dir = Dir::new();
        let path = dir.0.join(name); fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(&path, "kept").unwrap();
        fs::write(dir.0.join("package.json"), "{}").unwrap();
        assert_eq!(dir.run("--expo").status.code(), Some(1));
        assert_eq!(fs::read_to_string(&path).unwrap(), "kept");
        assert_eq!(fs::read_to_string(dir.0.join("package.json")).unwrap(), "{}");
    }
}
