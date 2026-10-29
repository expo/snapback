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
        assert_eq!(pkg["scripts"]["check"], "snapback4 check && npm run --silent typecheck && echo \"Next: wire app assertions, then npm run verify (all four phases). Codex: yield_time_ms=30000.\"");
        assert_eq!(pkg["scripts"]["verify"], "node scripts/verify.mjs");
        assert!(pkg["scripts"]["typecheck"].as_str().is_some_and(|s| !s.contains("snapback4 check")));
        for script in ["acceptance", "frontend:proof", "probe:check", "probe:serve"] { assert!(pkg["scripts"][script].is_string(), "{args:?}: {script}"); }
        assert!(String::from_utf8_lossy(&out.stdout).contains("npm run verify"));
        assert!(fs::read_to_string(dir.join("README.md")).unwrap().contains("npm run verify"));
    }
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn successful_check_handoff_never_runs_proofs_or_hides_either_check_failure() {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("sb4-starter2-handoff-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let init = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["init", root.to_str().unwrap(), "--web", "--no-install"]).output().unwrap();
    assert!(init.status.success(), "{init:?}");
    let pkg: serde_json::Value = serde_json::from_slice(&fs::read(root.join("package.json")).unwrap()).unwrap();
    let script = pkg["scripts"]["check"].as_str().unwrap();
    let bin = root.join("fake-bin"); fs::create_dir(&bin).unwrap();
    for (name, body) in [("snapback4", "#!/bin/sh\necho quarry >> phases\nexit \"${CHECK_EXIT:-0}\"\n"), ("npm", "#!/bin/sh\necho \"$3\" >> phases\nexit \"${TYPE_EXIT:-0}\"\n")] {
        let path = bin.join(name); fs::write(&path, body).unwrap(); fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    for (check, types, expected) in [(0, 0, 0), (17, 0, 17), (0, 23, 23)] {
        fs::write(root.join("phases"), "").unwrap();
        let out = Command::new("sh").args(["-c", script]).current_dir(&root)
            .env("PATH", format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()))
            .env("CHECK_EXIT", check.to_string()).env("TYPE_EXIT", types.to_string()).output().unwrap();
        assert_eq!(out.status.code(), Some(expected), "{out:?}");
        let text = String::from_utf8_lossy(&out.stdout);
        assert_eq!(text.contains("npm run verify"), expected == 0, "{out:?}");
        if expected == 0 { assert_eq!(text.lines().count(), 1); assert!(text.contains("yield_time_ms=30000")); }
        assert_eq!(fs::read_to_string(root.join("phases")).unwrap(), if check == 0 { "quarry\ntypecheck\n" } else { "quarry\n" });
    }
    fs::remove_dir_all(root).unwrap();
}
