use snapback4_lang::{compile, guide};

#[test]
fn every_wave13_recipe_is_clean_and_executable() {
    let blocks = guide::quarry(include_str!("../src/guide/rule_recipes_wave13.md"));
    assert_eq!(blocks.len(), 8);
    let mut failures = Vec::new();
    for source in blocks {
        let b = compile(&[("schema.q".into(), source.clone())]);
        // This exact hidden-target upsert intentionally retains runtime
        // deadline equality; all other recipes remain note-free.
        let notes_clean = if source.contains("mutation reportWords(") && source.contains("table peerCounts:") {
            b.notes.len() == 1 && b.notes[0].code == "N_IMMUTABLE_PATCH"
                && b.notes[0].message.contains("peerCounts.opensAt")
                && b.notes[0].message.contains("equals the stored value")
        } else { b.notes.is_empty() };
        if !b.diagnostics.is_empty() || !notes_clean {
            failures.push(format!("{}\n{:?}\n{:?}", source.lines().nth(1).unwrap_or(""), b.diagnostics, b.notes));
        } else {
            snapback4_core::Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

#[test]
fn contradiction_notes_name_the_table_layer_and_failing_image() {
    let base = "table claims:\n  owner: principal\n  state: enum('pending', 'withdrawn')\n  read <- .owner = viewer\n  update <- .owner = viewer and .state = 'pending'\n  online only\n";
    for (gate, patch, image) in [("pending", "withdrawn", "next image"), ("withdrawn", "pending", "old image")] {
        let b = compile(&[("schema.q".into(),format!("{base}mutation change(claim: claims):\n  c = claims[claim] ! else NOT_FOUND\n  require c.owner = viewer and c.state = '{gate}' else WRONG_STATE\n  update claims[claim] {{ state: '{patch}' }}\n"))]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let n=b.notes.iter().find(|n|n.code=="N_WRITE_DENIED").expect("contradiction");
        assert!(n.message.contains("table authorization layer") && n.message.contains(image),"{n:?}");
        assert!(n.rewrite.contains("old.owner = viewer") && n.rewrite.contains("old.state = 'pending'") && n.rewrite.contains("policy") && n.rewrite.contains("see: guide rule-recipes update-images"),"{n:?}");
    }
}

#[test]
fn every_recipe_pointer_resolves_to_its_named_section() {
    let card=guide::card("rule-recipes").unwrap();
    for name in ["offline-roster","quantified-consent","mutable-workflow","source-publication","owner-now","grant-expiry","role-workflow","update-images"] {
        assert!(guide::section("rule-recipes",card,name).is_ok(),"{name}");
    }
}
