use snapback4_lang::compile;

#[test]
fn project_builtins_are_reserved_for_parameters_locals_and_loop_bindings() {
    for (source, name) in [
        ("query q(now: time):\n  return now\n", "now"),
        ("mutation m():\n  commit = now\n  return commit\n", "commit"),
        ("mutation m():\n  for new in range(0, 1):\n    return new\n", "new"),
        ("query q(viewer: principal):\n  return viewer\n", "viewer"),
    ] {
        let bound = compile(&[("schema.q".into(), source.into())]);
        let diagnostic = bound
            .diagnostics
            .iter()
            .find(|d| d.code == "E_QUARRY_RESERVED")
            .unwrap_or_else(|| panic!("{name}: {:?}", bound.diagnostics));
        assert!(diagnostic.message.contains(&format!("`{name}`")), "{diagnostic}");
    }
}

#[test]
fn repeated_identity_declarations_name_both_method_sets() {
    let same_file = compile(&[(
        "schema.q".into(),
        "use identity password\nuse identity guests\n".into(),
    )]);
    assert_eq!(same_file.diagnostics.len(), 1, "{:?}", same_file.diagnostics);
    let diagnostic = &same_file.diagnostics[0];
    assert_eq!(diagnostic.code, "E_QUARRY_SYNTAX");
    assert_eq!(diagnostic.site.line, 2);
    assert!(
        diagnostic.message.contains("password") && diagnostic.message.contains("guests"),
        "{diagnostic}"
    );

    let across_files = compile(&[
        ("schema.q".into(), "use identity guests\n".into()),
        ("accounts.q".into(), "use identity\n".into()),
    ]);
    assert_eq!(across_files.diagnostics.len(), 1, "{:?}", across_files.diagnostics);
    let diagnostic = &across_files.diagnostics[0];
    assert_eq!(diagnostic.site.file, "accounts.q");
    assert!(
        diagnostic.message.contains("guests")
            && diagnostic.message.contains("password and guests"),
        "{diagnostic}"
    );
}
