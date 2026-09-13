//! The TS return-page analysis is held to the actual Rust implementation.
//! Include its private module here without expanding the engine's public API.
use snapback4_core::{Value, ir};
use std::path::PathBuf;

#[path = "../../snapback4-core/src/engine/pages.rs"]
mod rust_pages;

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

#[test]
fn typescript_page_plans_match_rust_for_authored_aliases_and_corpus_shapes() {
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let source = r#"
table items:
  value: int
  read <- allow
fn position(c: cursor ?): c
query helper(c: cursor ?):
  return items[] after position(c) first 2 by byId
query branch(c: cursor ?, choice: bool):
  rows = items[] after c first 2 by byId
  if choice:
    return { rows }
  else:
    return rows
query auxiliary(c: cursor ?):
  rows = items[] after c first 2 by byId
  unused = items[] after c last 1 by byId
  return rows
"#;
    let compiled = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let mut programs: Vec<ir::Program> = compiled.programs.into_iter().map(|bound| bound.program).collect();
    for name in [
        "composite-ambiguous-pages-no-next", "composite-pushed-page-no-next", "conditional-auxiliary-page-is-not-result",
        "conditional-enriched-hidden-page-1", "composite-merge-page-1", "composite-range-page-3",
        "conditional-merge-partial-clears-next", "opaque-cursor-merge-page-two", "merge-for-lane-domain-limit",
        "fanout-refused-range", "merge-runtime-overlap-deduped", "asset-video-duration-member",
    ] {
        let case: serde_json::Value = serde_json::from_slice(&std::fs::read(workspace.join("corpus").join(format!("{name}.json"))).unwrap()).unwrap();
        programs.push(serde_json::from_value(case["program"].clone()).unwrap());
    }
    let vectors: Vec<_> = programs.iter().map(|program| serde_json::json!({ "program": program, "expected": rust_pages::plan(program) })).collect();
    assert!(vectors.iter().any(|vector| !vector["expected"].as_object().unwrap().is_empty()));
    assert!(vectors.iter().any(|vector| vector["expected"].as_object().unwrap().is_empty()));
    let scratch = Scratch(std::env::temp_dir().join(format!("sb4-page-plan-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos())));
    std::fs::create_dir(&scratch.0).unwrap();
    std::fs::write(scratch.0.join("vectors.json"), serde_json::to_vec(&vectors).unwrap()).unwrap();
    let result = std::process::Command::new("bun").args(["--eval", r#"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pagePlan } from './packages/snapback4/src/replica/pages.ts';
const vectors = JSON.parse(readFileSync(process.env.SB4_PAGE_VECTORS, 'utf8'));
for (const { program, expected } of vectors) {
  assert.deepEqual(Object.fromEntries(pagePlan(program)), expected, program.name);
}
"#]).env("SB4_PAGE_VECTORS", scratch.0.join("vectors.json")).current_dir(&workspace).output().unwrap();
    assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
}
