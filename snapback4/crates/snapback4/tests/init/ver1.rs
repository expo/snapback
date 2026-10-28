// Starter ownership and UI size checks across the unified verification loop.
use super::*;

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
        // Kit scripts replace builder-owned process orchestration; DX14 adds one
        // shared TypeScript helper and its ESM scope for Node proof imports.
        // Saved proof packets moved from v1/ to versions/; neither is application source.
        // @ref LLP 3000.011.003.000#10 — an exact licensed build dependency has its own inventory; application source keeps its ceiling.
        let dependency_files = ["toolchain/deepmerge/package.json", "toolchain/deepmerge/index.cjs", "toolchain/deepmerge/index.d.ts", "toolchain/deepmerge/LICENSE", "toolchain/deepmerge/README.md"];
        let dependency_paths = texts.iter().map(|(path, _)| path.strip_prefix(&dir.0).unwrap()).filter(|path| path.starts_with("toolchain/deepmerge")).collect::<std::collections::BTreeSet<_>>();
        let expected = if flag == "--expo" { dependency_files.iter().map(std::path::Path::new).collect::<std::collections::BTreeSet<_>>() } else { Default::default() };
        assert_eq!(dependency_paths, expected, "only the five declared dependency leaves may be outside the application-source count");
        let app_files = texts.iter().filter(|(path, _)| {
            let relative = path.strip_prefix(&dir.0).unwrap();
            !relative.starts_with(".snapback4") && !relative.starts_with("v1") && !relative.starts_with("versions") && !expected.contains(relative)

        }).count();
        assert!(app_files <= 30, "{flag}: {app_files} application files");
        assert!(!dir.0.join("recipes").exists(), "ordinary starters must not ship unused guide recipes");
        let schema = fs::read_to_string(dir.0.join("snapback/schema.q")).unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), schema)]);
        assert!(bound.diagnostics.is_empty() && bound.notes.iter().all(|n| n.code == "N_LOOKUP_FILTERED"), "{:?} {:?}", bound.diagnostics, bound.notes);
        assert_eq!(bound.schema.tables.len(), 1);
        assert!(bound.schema.auth.guests, "the starter screen signs in as a guest");
        for op in ["list", "add", "toggle", "remove"] { assert!(bound.schema.operations.contains_key(op), "{op}"); }
        let checked = Command::new(BIN).env("SNAPBACK4_INIT_INSTALL","0").arg("check").current_dir(&dir.0).output().unwrap();
        assert!(checked.status.success(), "{checked:?}");
        let tested = Command::new(BIN).env("SNAPBACK4_INIT_INSTALL","0").args(["test", "--json", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
        assert!(tested.status.success(), "{flag}: {tested:?}");
        assert_eq!(test_case_counts(&tested.stdout), (7, 0), "{flag}: {tested:?}");
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
        let tested = Command::new(BIN).env("SNAPBACK4_INIT_INSTALL","0").args(["test", "--json", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
        assert!(tested.status.success(), "{flag}: {tested:?}");
        assert_eq!(test_case_counts(&tested.stdout), (1, 0), "{flag}: {tested:?}");
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
    let tested = Command::new(BIN).env("SNAPBACK4_INIT_INSTALL","0").args(["test", "--json", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
    let stderr = String::from_utf8_lossy(&tested.stderr);
    assert!(tested.status.success(), "{tested:?}");
    assert_eq!(test_case_counts(&tested.stdout), (1, 0), "{tested:?}");
    assert!(stderr.contains("WARNING: skipped fixtures/todos.jsonl") && stderr.contains("snapback4 init --adapt"), "{stderr}");
    // A todos.jsonl the project changed is its own file for a missing table: still a refusal, naming the starter.
    fs::write(dir.0.join("fixtures/todos.jsonl"), format!("{}{{\"id\":\"todo-eggs\",\"title\":\"Eggs\",\"done\":false,\"ownerId\":\"dev:alice\"}}\n", fs::read_to_string(starter.0.join("fixtures/todos.jsonl")).unwrap())).unwrap();
    let tested = Command::new(BIN).env("SNAPBACK4_INIT_INSTALL","0").args(["test", "--json", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
    assert!(!tested.status.success());
    assert!(String::from_utf8_lossy(&tested.stderr).contains("todo starter's sample"), "{tested:?}");
    // Any other file for a missing table refuses the run.
    fs::remove_file(dir.0.join("fixtures/todos.jsonl")).unwrap();
    fs::write(dir.0.join("fixtures/note.jsonl"), "{\"id\":\"n2\",\"body\":\"typo\"}\n").unwrap();
    let tested = Command::new(BIN).env("SNAPBACK4_INIT_INSTALL","0").args(["test", "--json", "--fixture", "fixtures", "--as", "alice"]).current_dir(&dir.0).output().unwrap();
    assert!(!tested.status.success() && String::from_utf8_lossy(&tested.stderr).contains("note.jsonl names no table"), "{tested:?}");
}

// Machine consumers read TOK2's complete evidence, independent of presentation.
fn test_case_counts(stdout: &[u8]) -> (u64, u64) {
    let report: serde_json::Value = serde_json::from_slice(stdout).unwrap();
    let cases = report["evidence"].as_array().unwrap().iter().find_map(|e| e.get("cases")).unwrap();
    (cases["passed"].as_u64().unwrap(), cases["failed"].as_u64().unwrap())
}
