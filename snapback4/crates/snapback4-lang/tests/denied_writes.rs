//! LLP 3000.036 §3 C: `check` notes a mutation's write (or upsert arm) whose
//! table rule for that effect is `deny`, written or omitted.
use snapback4_lang::compile;

const TABLES: &str = "use personas alice
table orders:
  title: text <=80
  author: principal
  submitted: bool default false
  read <- .author = viewer
  insert <- .author = viewer
  update <- deny
table alerts:
  body: text <=80
  read <- allow
table counts:
  owner: principal
  n: int
  unique owner
  read <- .owner = viewer
  insert <- .owner = viewer
table marks:
  owner: principal
  seen: int default 0 written by .owner
  read <- .owner = viewer
  insert <- .owner = viewer
";

fn notes(body: &str) -> Vec<snapback4_lang::Diagnostic> { notes_in(TABLES, body) }

fn notes_in(tables: &str, body: &str) -> Vec<snapback4_lang::Diagnostic> {
    let bound = compile(&[("schema.q".into(), format!("{tables}{body}"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound.notes.into_iter().filter(|note| note.code == "N_WRITE_DENIED").collect()
}

#[test]
fn each_denied_effect_and_upsert_arm_is_noted_with_its_clause() {
    let update = notes("mutation submit(o: orders):\n  update orders[o] { submitted: true }\n");
    assert_eq!(update.len(), 1, "{update:?}");
    assert_eq!(update[0].guide, "rules");
    assert!(update[0].message.starts_with("orders has `update <- deny` (schema.q:8:3); the update at schema.q:"), "{}", update[0]);
    assert!(update[0].message.contains("in `submit` cannot pass it for any caller but the system"), "{}", update[0]);

    let omitted = notes("mutation alert(body: text <=80):\n  insert alerts { body }\n");
    assert!(omitted.len() == 1 && omitted[0].message.starts_with("alerts has no `insert` rule (schema.q:9:1), so it is deny"), "{omitted:?}");

    let delete = notes("mutation drop(o: orders):\n  delete orders[o]\n");
    assert!(delete.len() == 1 && delete[0].message.contains("no `delete` rule"), "{delete:?}");

    let upsert = notes("mutation bump():\n  upsert counts[viewer] { n: 1 }\n");
    assert!(upsert.len() == 1 && upsert[0].message.contains("the update arm of the upsert") && upsert[0].message.contains("the insert arm can"), "{upsert:?}");
}

#[test]
fn admitted_writes_jobs_and_owned_field_patches_are_not_noted() {
    for body in [
        "mutation create(title: text <=80):\n  insert orders { title, author: viewer }\n",
        // A job runs as the system and passes every rule.
        "job close():\n  for o in orders:\n    update orders[o.id] { submitted: true }\n",
        // A patch of only `written by` fields is judged by field authority.
        "mutation see(m: marks, n: int):\n  update marks[m] { seen: n }\n",
    ] {
        assert!(notes(body).is_empty(), "{body}: {:?}", notes(body));
    }
    // An immutable field beside owned ones is dropped against a hidden row,
    // and the owned remainder passes field authority without the update rule.
    let immutable = TABLES.replace("  seen: int default 0 written by .owner\n", "  seen: int default 0 written by .owner\n  immutable owner\n");
    let bound = compile(&[("schema.q".into(), format!("{immutable}mutation see(m: marks, n: int):\n  update marks[m] {{ owner: viewer, seen: n }}\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.iter().all(|note| note.code != "N_WRITE_DENIED"), "{:?}", bound.notes);
    // `false` binds to deny like `deny`.
    let literal = notes_in(&TABLES.replace("update <- deny", "update <- false"), "mutation submit(o: orders):\n  update orders[o] { submitted: true }\n");
    assert!(literal.len() == 1 && literal[0].message.contains("`update <- false`"), "{literal:?}");
    // A rule whose bind failed is reported as an error, never as this note.
    let broken = compile(&[("schema.q".into(), format!("{}mutation submit(o: orders):\n  update orders[o] {{ submitted: true }}\n", TABLES.replace("update <- deny", "update <- .nope = viewer")))]);
    assert!(!broken.diagnostics.is_empty());
    assert!(broken.notes.iter().all(|note| note.code != "N_WRITE_DENIED"), "{:?}", broken.notes);
}
