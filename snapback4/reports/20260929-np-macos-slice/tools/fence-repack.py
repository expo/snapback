from pathlib import Path
r=Path('/Users/ccheever/sb4-np/lane/snapback4')
p=r/'crates/snapback4/src/verbs/witness.rs';s=p.read_text().replace('build: Option<PathBuf>, repack: Option<PathBuf>, app_project: Option<PathBuf>,','build: Option<PathBuf>,')
s=s.replace(', "repack", "app-project"','').replace('["bundle-id", "build", "repack"]','["bundle-id", "build"]')
s=s.replace('if selectors != 1 || flags.contains_key("app-project") != flags.contains_key("repack") { return Err(error("E_WITNESS_INPUT", "select exactly one of --bundle-id, --build or --repack; --repack requires --app-project")); }','if selectors != 1 { return Err(error("E_WITNESS_INPUT", "select exactly one of --bundle-id or --build")); }')
s=s.replace('!smoke && (flags.contains_key("build") || flags.contains_key("repack"))','!smoke && flags.contains_key("build")')
s=s.replace('if smoke { if flags.contains_key("repack") { "repack-smoke".into() } else { "smoke".into() } }','if smoke { "smoke".into() }')
s=s.replace(', repack: flags.get("repack").map(PathBuf::from), app_project: flags.get("app-project").map(PathBuf::from)','')
s=s.replace('        let o = options(&["ios", "--repack", "build.json", "--app-project", ".", "--smoke", "--artifacts", "unused"]);\n        assert_eq!(artifact_segment(&o), "repack-smoke");','        let o = options(&["ios", "--build", ".", "--smoke", "--artifacts", "unused"]);\n        assert_eq!(artifact_segment(&o), "smoke");')
p.write_text(s)
p=r/'crates/snapback4/src/verbs/witness/preparation.rs';s=p.read_text().replace('options.build.as_ref().or(options.app_project.as_ref())','options.build.as_ref()');s=s.replace('    let mode = if options.build.is_some() { "build" } else { "repack" };\n','')
s=s.replace('helper.to_str().unwrap(), mode, project.to_str().unwrap(), options.artifacts.to_str().unwrap(), udid, &origin,\n        options.repack.as_ref().and_then(|p| p.to_str()).unwrap_or("")','helper.to_str().unwrap(), project.to_str().unwrap(), options.artifacts.to_str().unwrap(), udid, &origin')
s=s.replace('options.artifacts.join(if mode == "build" { "build.json" } else { "repack.json" })','options.artifacts.join("build.json")')
s=s.replace('    if mode == "build" { proof["nativeBase"] = json!({ "app": prepared["executedApp"]["inventory"]["sha256"], "build": artifact(&receipt)?["sha256"], "fingerprint": prepared["nativeFingerprint"]["fingerprint"]["hash"] }); }','    proof["nativeBase"] = json!({ "app": prepared["executedApp"]["inventory"]["sha256"], "build": artifact(&receipt)?["sha256"], "fingerprint": prepared["nativeFingerprint"]["fingerprint"]["hash"] });')
p.write_text(s)
p=r/'crates/snapback4/src/verbs/witness/prepare.mjs';s=p.read_text().replace("import { isDeepStrictEqual } from 'node:util';\n",'')
s=s.replace('const [mode, projectArg, artifactsArg, udid, origin, receiptArg]', 'const [projectArg, artifactsArg, udid, origin]')
a=s.index('  let base = null;');b=s.index('  // Stable private path',a);s=s[:a]+s[b:]
s=s.replace('  let app, transformation = null, settings = null;\n  if (mode === \'build\') {','  let app, settings = null;\n  {')
a=s.index('  } else {\n    const repackCLI');b=s.index('  const executedApp = appInfo(app);',a);s=s[:a]+'  }\n'+s[b:]
a=s.index('  if (base) {');b=s.index('  const after = nativeInput(project);',a);s=s[:a]+s[b:]
s=s.replace("proofKind: base ? 'application-release-repack' : 'application-release'", "proofKind: 'application-release'")
s=s.replace('executedApp, transformation, phases','executedApp, phases').replace("buildResult: base ? null : inventory(path.join(out, 'build.xcresult'))", "buildResult: inventory(path.join(out, 'build.xcresult'))")
s=s.replace("nativeBase: base ? { app: base.executedApp.inventory.sha256, build: hash(fs.readFileSync(receiptArg)), fingerprint: base.nativeFingerprint.fingerprint.hash } : null,", 'nativeBase: null,')
s=s.replace("seal(path.join(out, base ? 'repack.json' : 'build.json'), result)","seal(path.join(out, 'build.json'), result)")
s=s.replace('outside both prepared proof routes','outside own-build proof support')
p.write_text(s)
p=r/'crates/snapback4/tests/witness.rs';s=p.read_text();a=s.index('fn preparation_selectors_are_exclusive_and_repack_names_its_project()');b=s.index('\n#[cfg(target_os = "linux")]',a)
s=s[:a]+'''fn preparation_selectors_are_exclusive_and_unqualified_repack_is_unavailable() {
    for (flags, reason) in [
        (vec!["--bundle-id", "app.test", "--build", "."], "select exactly one"),
        (vec!["--repack", "build.json"], "unknown flag --repack"),
        (vec!["--app-project", "."], "unknown flag --app-project"),
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["witness", "ios"]).args(flags).output().unwrap();
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains(reason));
    }
}
''' + s[b:];p.write_text(s)
p=r/'crates/snapback4-lang/src/guide/codes.rs';s=p.read_text();s='\n'.join(line for line in s.split('\n') if '"E_WITNESS_REPACK"' not in line);p.write_text(s)
