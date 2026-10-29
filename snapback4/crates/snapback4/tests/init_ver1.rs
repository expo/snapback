//! Wave-34 lane regressions: one generated check/verify route for every UI starter.
use std::{fs, process::Command};
#[test]
fn every_ui_starter_has_one_quarry_check_before_typescript_and_one_verify_loop() {
    let root = std::env::temp_dir().join(format!("sb4-ver1-init-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    for (n, args) in [vec!["--web"], vec!["--web", "--online"], vec!["--web", "--online", "--password"], vec!["--expo"], vec!["--expo", "--online", "--password"], vec!["--web", "--template", "chat"], vec!["--expo", "--template", "chat"], vec!["--template", "social"]].iter().enumerate() {
        let dir = root.join(n.to_string());
        let out = Command::new(env!("CARGO_BIN_EXE_snapback4")).arg("init").arg(&dir).args(args).arg("--no-install").output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let pkg: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("package.json")).unwrap()).unwrap();
        assert_eq!(pkg["scripts"]["check"], "snapback4 check && npm run --silent typecheck");
        assert_eq!(pkg["scripts"]["verify"], "node scripts/verify.mjs");
        for phase in ["acceptance", "frontend:proof"] {
            assert_eq!(pkg["scripts"][format!("pre{phase}")], format!("node scripts/verify-cache.mjs before {phase}"));
            assert_eq!(pkg["scripts"][format!("post{phase}")], format!("node scripts/verify-cache.mjs after {phase}"));
        }
        assert!(dir.join("scripts/verify-cache.mjs").is_file());
        assert!(pkg["scripts"]["typecheck"].as_str().is_some_and(|s| !s.contains("snapback4 check")));
        for script in ["acceptance", "frontend:proof", "probe:check", "probe:serve"] { assert!(pkg["scripts"][script].is_string(), "{args:?}: {script}"); }
        assert!(String::from_utf8_lossy(&out.stdout).contains("npm run verify"));
        assert!(fs::read_to_string(dir.join("README.md")).unwrap().contains("npm run verify"));
    }
    fs::remove_dir_all(root).unwrap();
}
