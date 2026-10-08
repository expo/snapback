//! LLP 3000.036 §4: a write that can only store the reserved system principal
//! is refused at `check`, with its site and the guide's repair.
use snapback4_lang::compile;

const TABLES: &str = "use personas alice
table grants:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
table activity:
  actor: principal
  helper: principal ?
  watchers: [principal] 0..4
  note: text <=40
  read <- .actor = viewer
  insert <- deny
  update <- deny
";

fn refusals(body: &str) -> Vec<snapback4_lang::Diagnostic> {
    let bound = compile(&[("schema.q".into(), format!("{TABLES}{body}"))]);
    bound.diagnostics.into_iter().filter(|d| d.code.starts_with("E_")).collect()
}

fn refused(body: &str, column: &str, cause: &str) {
    let found = refusals(body);
    assert_eq!(found.len(), 1, "{found:?}");
    let refusal = &found[0];
    assert_eq!(refusal.code, "E_SYSTEM_PRINCIPAL_WRITE", "{refusal}");
    assert_eq!(refusal.guide, "jobs");
    assert!(refusal.message.starts_with(&format!("activity.{column} cannot store the reserved system principal")) && refusal.message.contains(cause), "{refusal}");
    assert!(refusal.site.line > 14, "located at the write: {refusal}");
}

#[test]
fn job_writes_of_the_system_principal_are_refused_at_check() {
    let sweep = "job tick():\n  for g in grants by .id:\n";
    refused(&format!("{sweep}    insert activity {{ actor: 'system', note: 'x', watchers: [] }}\n"), "actor", "the literal 'system'");
    refused(&format!("{sweep}    insert activity {{ actor: viewer, note: 'x', watchers: [] }}\n"), "actor", "`viewer`, which in a job");
    refused(&format!("{sweep}    insert activity {{ actor: g.owner, helper: viewer, note: 'x', watchers: [] }}\n"), "helper", "`viewer`");
    refused(&format!("{sweep}    insert activity {{ actor: g.owner, watchers: [g.owner, viewer], note: 'x' }}\n"), "watchers", "`viewer`");
    refused(&format!("{sweep}    update activity[g.id] {{ actor: viewer }}\n"), "actor", "`viewer`");
    // A mutation's viewer is its caller, but the literal is never a caller.
    refused("mutation m():\n  insert activity { actor: 'system', note: 'x', watchers: [] }\n", "actor", "would refuse with E_INPUT");
}

#[test]
fn a_job_insert_that_leaves_a_default_viewer_column_to_its_default_is_refused() {
    let body = "job tick():\n  for g in grants by .id:\n    insert notes { body: 'x' }\n";
    let schema = "table notes:\n  author: principal default viewer\n  body: text <=40\n  read <- .author = viewer\n  insert <- deny\n";
    let bound = compile(&[("schema.q".into(), format!("{TABLES}{schema}{body}"))]);
    let refusal = bound.diagnostics.iter().find(|d| d.code == "E_SYSTEM_PRINCIPAL_WRITE").unwrap_or_else(|| panic!("{:?}", bound.diagnostics));
    assert!(refusal.message.contains("notes.author") && refusal.message.contains("default viewer") && refusal.rewrite.starts_with("drop the default"), "{refusal}");
    // An upsert's insert arm runs only when the row is absent; its update arm can succeed.
    let upsert = format!("{TABLES}{}job tick():\n  for g in grants by .id:\n    upsert notes[body = 'x'] {{ n: 1 }}\n", schema.replace("  body: text <=40\n", "  body: text <=40\n  n: int\n  unique body\n"));
    let bound = compile(&[("schema.q".into(), upsert)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let explicit = compile(&[("schema.q".into(), format!("{TABLES}{schema}{}", body.replace("{ body: 'x' }", "{ author: g.owner, body: 'x' }")))]);
    assert!(explicit.diagnostics.iter().all(|d| !d.code.starts_with("E_")), "{:?}", explicit.diagnostics);
}

#[test]
fn the_guide_repairs_and_ordinary_principals_compile() {
    for body in [
        "job tick():\n  for g in grants by .id:\n    insert activity { actor: g.owner, helper: null, note: 'x', watchers: [] }\n",
        "job tick():\n  for g in grants by .id:\n    insert activity { actor: 'service:reminders', note: 'x', watchers: [] }\n",
        // A mutation's viewer is the caller; a value through a local stays a runtime refusal.
        "mutation m():\n  insert activity { actor: viewer, watchers: [viewer], note: 'x' }\n",
        "job tick():\n  for g in grants by .id:\n    who = g.owner\n    insert activity { actor: who, note: 'x', watchers: [] }\n",
        // `viewer` in a job may be read (for example compared), never stored.
        "job tick():\n  for g in grants by .id:\n    if g.owner != viewer:\n      insert activity { actor: g.owner, note: 'x', watchers: [] }\n",
    ] {
        let found = refusals(body);
        assert!(found.is_empty(), "{body}: {found:?}");
    }
}

// Astra review: writes whose explicit value may never reach storage stay admitted.
#[test]
fn values_that_may_not_reach_storage_are_not_refused() {
    // A later spread replaces the explicit field.
    let spread = "mutation m(a: activity):\n  insert activity { actor: 'system', ...a }\n";
    assert!(refusals(spread).iter().all(|d| d.code != "E_SYSTEM_PRINCIPAL_WRITE"), "{:?}", refusals(spread));
    // A patch of an immutable column is dropped against a hidden row.
    let schema = TABLES.replace("  update <- deny\n", "  update <- deny\n  immutable actor\n");
    let bound = compile(&[("schema.q".into(), format!("{schema}mutation m(a: activity):\n  update activity[a] {{ actor: 'system', note: 'x' }}\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // The same immutable column on insert is stored, and refused.
    let bound = compile(&[("schema.q".into(), format!("{schema}mutation m():\n  insert activity {{ actor: 'system', note: 'x', watchers: [] }}\n"))]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_SYSTEM_PRINCIPAL_WRITE"), "{:?}", bound.diagnostics);
}
