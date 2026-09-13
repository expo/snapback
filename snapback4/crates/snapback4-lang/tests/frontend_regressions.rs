//! Authored programs exercise the frontend contract, not hand-patched IR.
//! R20–R24, R32 and R33 from the 2026-09-12 architecture review.

use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

const ITEMS: &str = "table items:\n  n: int\n  a: int\n  b: int\n  unique byAB: a, b\n  by byABId: a, b, id\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\n";
const HELPERS: &str = r#"
fn identity(x: int): x
fn pair(x: int, y: int): x * 10 + y
fn twice(x: id): { left: x, right: x }
proc add(x: int, y: int):
  local = pair(x, y)
  insert items { n: local, a: x, b: y }
query repeated():
  return identity(1) + identity(2)
query nested(x: int):
  return pair(identity(1), pair(2, x)) + x
mutation procs(x: int):
  local = 7
  add(1, x)
  add(2, x)
  for i in range(0, 3):
    add(i + 3, x)
  return { x, local }
mutation minted():
  return twice(new)
mutation arguments():
  return pair((insert items { a: 10, b: 0, n: 1 }).n, count(items[] first 10 by byId))
mutation readBeforeWrite():
  return pair(count(items[] first 10 by byId), (insert items { a: 10, b: 0, n: 1 }).n)
"#;
const LAZY: &str = r#"
fn present(): (items['missing'] ! else MISSING) != null
query skipped():
  return { a: true or present(), b: false and present(), c: false or (true or present()) }
query selected():
  return false or present()
mutation skippedWrites():
  a = true or ((insert items { a: 1, b: 1, n: 1 }) != null)
  b = false and ((insert items { a: 2, b: 2, n: 2 }) != null)
  return count(items[] first 10 by byId)
mutation selectedWrite():
  a = false or ((insert items { a: 1, b: 1, n: 1 }) != null)
  return count(items[] first 10 by byId)
query narrowed(x: int ?):
  return x != null and x > 0
"#;

fn bound(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

fn engine(source: &str) -> Engine {
    let bound = bound(source);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn context(args: &[(&str, Value)]) -> Context {
    Context::new("dev:alice", args.iter().map(|(name, value)| ((*name).into(), value.clone())).collect::<BTreeMap<_, _>>()).at(1)
}

fn query(engine: &mut Engine, name: &str, args: &[(&str, Value)]) -> Value {
    engine.query(name, context(args)).unwrap().data
}

fn mutation(engine: &mut Engine, name: &str, args: &[(&str, Value)]) -> Value {
    match engine.mutate(name, None, context(args).with_ids((1..20).map(|n| format!("id{n}")))).unwrap().state {
        WriteState::Sent { result, .. } => result,
        other => panic!("{other:?}"),
    }
}

#[test]
fn helpers_have_lexical_bindings_and_snapshot_arguments_once_in_source_order() {
    let mut e = engine(&format!("{ITEMS}\n{HELPERS}"));
    assert_eq!(query(&mut e, "repeated", &[]), Value::Int(3));
    assert_eq!(query(&mut e, "nested", &[("x", Value::Int(5))]), Value::Int(40));
    let minted = mutation(&mut e, "minted", &[]);
    assert_eq!(minted.field("left"), Ok(&Value::Id("id1".into())));
    assert_eq!(minted.field("left"), minted.field("right"));
    let locals = mutation(&mut e, "procs", &[("x", Value::Int(9))]);
    assert_eq!(locals.field("x"), Ok(&Value::Int(9)));
    assert_eq!(locals.field("local"), Ok(&Value::Int(7)));
    let rows = e.store().rows("items").unwrap();
    assert_eq!(rows.len(), 5);
    for row in rows {
        assert_eq!(row.field("b"), Ok(&Value::Int(9)), "later arguments resolve in the caller, before formal x exists");
    }
    let mut e = engine(&format!("{ITEMS}\n{HELPERS}"));
    assert_eq!(mutation(&mut e, "arguments", &[]), Value::Int(11));
    let mut e = engine(&format!("{ITEMS}\n{HELPERS}"));
    assert_eq!(mutation(&mut e, "readBeforeWrite", &[]), Value::Int(1));
}

#[test]
fn a_helper_cannot_capture_or_refine_a_callers_local() {
    let source = "fn capture(): outer\nquery q(outer: int):\n  return capture()\n";
    let compiled = compile(&[("schema.q".into(), source.into())]);
    assert!(compiled.diagnostics.iter().any(|d| d.message == "unknown name outer"));
    let source = "fn checked(x: int ?): x + 1 if x != null else 0\nquery q(x: int ?):\n  y = checked(x)\n  return x + 1\n";
    let compiled = compile(&[("schema.q".into(), source.into())]);
    assert!(compiled.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.site.line == 4));
}

#[test]
fn boolean_lowering_keeps_refusals_and_writes_in_the_selected_branch() {
    let mut e = engine(&format!("{ITEMS}\n{LAZY}"));
    let value = query(&mut e, "skipped", &[]);
    assert_eq!(value.field("a"), Ok(&Value::Bool(true)));
    assert_eq!(value.field("b"), Ok(&Value::Bool(false)));
    assert_eq!(value.field("c"), Ok(&Value::Bool(true)));
    assert_eq!(e.query("selected", context(&[])).unwrap_err().code, "MISSING");
    assert_eq!(mutation(&mut e, "skippedWrites", &[]), Value::Int(0));
    assert_eq!(mutation(&mut e, "selectedWrite", &[]), Value::Int(1));
    assert_eq!(query(&mut e, "narrowed", &[("x", Value::Null)]), Value::Bool(false));
    assert_eq!(query(&mut e, "narrowed", &[("x", Value::Int(1))]), Value::Bool(true));
}

#[test]
fn null_refinements_join_only_continuing_paths() {
    for body in [
        "  if x != null:\n    y = x + 1\n  return x + 1\n",
        "  if flag:\n    require x != null else MISSING\n  return x + 1\n",
        "  for i in range(0, 2):\n    require x != null else MISSING\n  return x + 1\n",
        "  y = x + 1 if x != null else 0\n  return x + 1\n",
        "  if flag:\n    if x = null:\n      return 0\n  return x + 1\n",
    ] {
        let source = format!("query q(x: int ?, flag: bool):\n{body}");
        let compiled = compile(&[("schema.q".into(), source)]);
        assert!(compiled.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "branch refinement escaped: {body}");
    }
    let source = r#"
query early(x: int ?):
  if x = null:
    return 0
  return x + 1
query refuse(x: int ?):
  if x = null:
    require false else MISSING
  return x + 1
query both(x: int ?, flag: bool):
  if flag:
    require x != null else MISSING
  else:
    if x = null:
      return 0
  return x + 1
query nested(x: int ?, flag: bool):
  if x = null:
    if flag:
      return 0
    else:
      return 1
  return x + 1
"#;
    let mut e = engine(source);
    assert_eq!(query(&mut e, "early", &[("x", Value::Null)]), Value::Int(0));
    assert_eq!(query(&mut e, "early", &[("x", Value::Int(9))]), Value::Int(10));
    assert_eq!(e.query("refuse", context(&[("x", Value::Null)])).unwrap_err().code, "MISSING");
    assert_eq!(query(&mut e, "both", &[("x", Value::Int(9)), ("flag", Value::Bool(false))]), Value::Int(10));
    assert_eq!(query(&mut e, "nested", &[("x", Value::Null), ("flag", Value::Bool(false))]), Value::Int(1));
}

#[test]
fn duplicate_named_keys_are_located_diagnostics_for_reads_ranges_and_rules() {
    let source = format!(
        "{ITEMS}\nquery point():\n  return items[a=1, a=2]\nquery page():\n  return items[a=1, a=2] first 10 by byABId\nquery mixed():\n  return items[a=1, 2]\ntable other:\n  n: int\n  read <- exists items[a=1, a=2]\nquery separate():\n  return misspelled\n"
    );
    let compiled = compile(&[("schema.q".into(), source)]);
    assert_eq!(compiled.diagnostics.len(), 5, "{:?}", compiled.diagnostics);
    assert_eq!(compiled.diagnostics.iter().filter(|d| d.message.contains("key repeats column a")).count(), 3);
    for diagnostic in &compiled.diagnostics {
        assert_eq!(diagnostic.site.file, "schema.q");
        assert!(diagnostic.site.line > 0 && diagnostic.site.col > 0);
        assert!(!diagnostic.rewrite.is_empty());
    }
    let source = format!("{ITEMS}\nquery valid():\n  return items[b=2, a=1]\n");
    let mut e = engine(&source);
    assert_eq!(query(&mut e, "valid", &[]), Value::Null);
}

#[test]
fn operation_uniqueness_uses_the_qualified_name_and_preserves_both_sites() {
    let sources = [("schema.q".into(), "query list():\n  return 1\n".into()), ("feed.q".into(), "query list():\n  return 2\n".into()), ("inbox.q".into(), "query list():\n  return 3\n".into())];
    let compiled = compile(&sources);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let names: Vec<_> = compiled.programs.iter().map(|p| p.program.name.as_str()).collect();
    assert_eq!(names, ["list", "feed.list", "inbox.list"]);
    let api = snapback4_lang::emit::typescript(&compiled);
    assert!(api.contains("name: \"feed.list\""));
    assert!(api.contains("name: \"inbox.list\""));
    let duplicate = compile(&[("feed.q".into(), "query list():\n  return 1\nquery list():\n  return 2\n".into())]);
    assert_eq!(duplicate.diagnostics.len(), 1);
    assert_eq!(duplicate.diagnostics[0].site.line, 3);
    assert!(duplicate.diagnostics[0].message.contains("duplicate operation feed.list; first declared at feed.q:1:1"));
    let collision = compile(&[("schema.q".into(), "query feed():\n  return 1\n".into()), ("feed.q".into(), "query list():\n  return 2\n".into())]);
    assert_eq!(collision.diagnostics.len(), 1);
    assert!(collision.diagnostics[0].message.contains("API name feed is both an operation and a module; first declared at schema.q:1:1"));
}

#[test]
fn numeric_rule_literals_use_the_same_checked_domain_as_program_literals() {
    for literal in ["1.5", "-1.5", "9007199254740992", "-9007199254740992", "18446744073709551616", "-18446744073709551616"] {
        for rule in [format!(".n = {literal}"), format!("exists targets[{literal}]")] {
            let source = format!("table targets:\n  n: int\n  unique byN: n\n  read <- allow\ntable t:\n  n: int\n  read <- {rule}\n");
            let compiled = compile(&[("schema.q".into(), source)]);
            assert!(compiled.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.site.line == 7), "literal {literal}: {:?}", compiled.diagnostics);
        }
    }
    for literal in ["0", "1", "-1", "9007199254740991", "-9007199254740991"] {
        let compiled = bound(&format!("table targets:\n  n: int\n  unique byN: n\n  read <- allow\ntable t:\n  n: int\n  read <- .n = {literal} or exists targets[{literal}]\n"));
        let json = serde_json::to_value(&compiled.schema.tables["t"].rules.read).unwrap();
        assert_eq!(json["Or"][0]["Eq"][1]["Literal"]["Int"], literal.parse::<i64>().unwrap());
        assert_eq!(json["Or"][1]["Exists"]["key"][0]["Literal"]["Int"], literal.parse::<i64>().unwrap());
    }
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("snapback4-lang-{}-{unique}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn workspace() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn generated_typescript_preserves_strings_and_typechecks_with_the_real_contract() {
    let source = "table t:\n  label: enum('has\"quote', 'back\\\\slash', 'line\\nbreak', 'tab\\tstop', 'é😀', '__proto__')\n  read <- allow\nquery __proto__():\n  return t['missing']\nquery metadata(photo: image <=1000):\n  return { width: photo.width, height: photo.height, duration: photo.duration, bytes: photo.bytes }\n";
    let compiled = compile(&[("quote\"back\\slash.q".into(), source.into())]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let api = snapback4_lang::emit::typescript(&compiled);
    for literal in ["has\"quote", "back\\slash", "line\nbreak", "tab\tstop", "é😀"] {
        assert!(api.contains(&serde_json::to_string(literal).unwrap()), "{api}");
    }
    let scratch = Scratch::new();
    std::fs::write(scratch.0.join("api.ts"), api.replace("\"snapback4/contract\"", "\"./contract\"")).unwrap();
    std::fs::write(scratch.0.join("contract.ts"), include_str!("../../../packages/snapback4/src/contract.ts")).unwrap();
    std::fs::write(
        scratch.0.join("check.ts"),
        r#"import { api, type Rows } from './api';
const label: Rows['t']['label'][] = ['has"quote', 'back\\slash', 'line\nbreak', 'tab\tstop', 'é😀', '__proto__'];
const name: string = api['quote"back\\slash'].__proto__.name;
type Metadata = NonNullable<typeof api['quote"back\\slash']['metadata']['__result']>;
const metadata: Metadata = { width: null, height: null, duration: null, bytes: 24 };
// @ts-expect-error Metadata can be absent for an image or a video.
const width: number = metadata.width;
const bytes: number = metadata.bytes;
type MetadataArgs = NonNullable<typeof api['quote"back\\slash']['metadata']['__args']>;
const input: MetadataArgs = { photo: { id: 'upload-id', width: null, height: null, duration: null } };
void width; void bytes; void input;
void label; void name;
"#,
    )
    .unwrap();
    let tsc = workspace().join("node_modules/typescript/bin/tsc");
    assert!(tsc.exists(), "the emitted-TypeScript check uses the existing Bun workspace dependencies; run bun install --frozen-lockfile in snapback4");
    let result = Command::new("node").arg(tsc).args(["--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "api.ts", "check.ts"]).current_dir(&scratch.0).output().unwrap();
    assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
}

#[test]
fn asset_metadata_narrowing_matches_nullable_server_facts() {
    use snapback4_lang::types::Ty;
    let source = "query metadata(photo: image <=1000, clip: video <=1000):\n  return { width: photo.width, height: clip.height, duration: photo.duration, bytes: photo.bytes, safeDuration: clip.duration ?? 0 }\n";
    let compiled = bound(source);
    let Ty::Object(fields) = &compiled.programs[0].result else { panic!("metadata has object result") };
    for name in ["width", "height", "duration"] {
        assert_eq!(fields[name], Ty::Int.optional());
    }
    assert_eq!(fields["bytes"], Ty::Int);
    assert_eq!(fields["safeDuration"], Ty::Int);
    let invalid = compile(&[("schema.q".into(), "query duration(photo: image <=1000):\n  return photo.duration + 1\n".into())]);
    assert!(!invalid.diagnostics.is_empty(), "nullable metadata must be narrowed before arithmetic");
    let value = Value::Map(BTreeMap::from([("id".into(), Value::Id("upload-id".into())), ("width".into(), Value::Null), ("height".into(), Value::Null), ("duration".into(), Value::Null), ("bytes".into(), Value::Int(24))]).into());
    let result = query(&mut engine(source), "metadata", &[("photo", value.clone()), ("clip", value)]);
    assert_eq!(result.field("duration").unwrap(), &Value::Null);
    assert_eq!(result.field("safeDuration").unwrap(), &Value::Int(0));
    assert_eq!(result.field("bytes").unwrap(), &Value::Int(24));
}

#[test]
fn structural_population_refusals_surface_during_authored_compilation() {
    let schema = "table members:\n  group: id\n  seen: bool\n  by byGroup: group, id\n  read <- allow\n  update <- allow\n";
    let operation = "mutation visit(group: id):\n  page = members[group] first 10 by byGroup\n  for row in page:\n    update members[row.id] { seen: true }\n  return true\n";
    let refused = compile(&[("fanout.q".into(), format!("{schema}{operation}"))]);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    let diagnostic = &refused.diagnostics[0];
    assert_eq!(diagnostic.code, "E_STRUCTURAL_FANOUT");
    assert_eq!(diagnostic.site.file, "fanout.q");
    assert!(diagnostic.site.line > 0);
    assert!(!diagnostic.rewrite.is_empty());
    assert!(refused.programs.is_empty());
    let capped = schema.replace("  read <-", "  cap 10 by group\n  read <-");
    let admitted = bound(&format!("{capped}{operation}"));
    assert_eq!(admitted.programs.len(), 1);
    let query = "query page(group: id):\n  return members[group] first 10 by byGroup\n";
    assert_eq!(bound(&format!("{schema}{query}")).programs.len(), 1);
}

#[test]
fn references_allow_absent_ids_and_explicit_guards_require_visible_targets() {
    use snapback4_core::{ir::ArgType, value::object, wire};
    let source = r#"
table posts:
  author: principal
  read <- .author = viewer
  insert <- allow
  delete <- .author = viewer
table votes:
  postId: posts
  principal: principal
  direction: int
  unique byPostPrincipal: postId, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
mutation unchecked(postId: posts, direction: int):
  upsert votes[postId, viewer] { direction }
mutation checked(postId: posts, direction: int):
  require exists posts[postId] else POST_NOT_FOUND
  upsert votes[postId, viewer] { direction }
mutation insertVote(postId: posts):
  insert votes { postId, principal: viewer, direction: 1 }
mutation changeVote(voteId: votes, postId: posts):
  update votes[voteId] { postId }
mutation removePost(postId: posts):
  delete posts[postId]
query post(postId: posts):
  return posts[postId]
"#;
    let id = |s: &str| Value::Id(s.into());
    let kind = ArgType::Ref { table: "posts".into() };
    let missing = wire::from_json(&kind, &serde_json::json!("null")).unwrap();
    assert_eq!(missing, id("null"));
    assert!(wire::from_json(&kind, &serde_json::Value::Null).is_err());
    let mut e = engine(source);
    e.seed([
        ("posts".into(), object([("id", id("visible")), ("author", id("dev:alice"))])),
        ("posts".into(), object([("id", id("hidden")), ("author", id("dev:bob"))])),
    ]).unwrap();
    let args = |post: Value, n| vec![("postId", post), ("direction", Value::Int(n))];
    let row = mutation(&mut e, "unchecked", &args(missing.clone(), 1));
    assert_eq!(row.field("postId"), Ok(&missing));
    mutation(&mut e, "unchecked", &args(missing.clone(), -1));
    assert_eq!(e.store().rows("votes").unwrap().len(), 1, "upsert may replace a dangling reference");
    let inserted = e.mutate("insertVote", None, context(&[("postId", id("also-absent"))]).with_ids(["vote2".into()])).unwrap();
    let WriteState::Sent { result: inserted, .. } = inserted.state else { panic!("{inserted:?}") };
    let vote_id = inserted.field("id").unwrap().clone();
    mutation(&mut e, "changeVote", &[("voteId", vote_id), ("postId", id("still-absent"))]);
    let before = e.store().rows("votes").unwrap();
    for target in [missing.clone(), id("hidden")] {
        let outcome = e.mutate("checked", None, context(&args(target.clone(), 1))).unwrap();
        assert!(matches!(outcome.state, WriteState::Failed { ref why, .. } if why.code == "POST_NOT_FOUND"), "{outcome:?}");
        assert_eq!(outcome.metered.examined, 1, "the explicit point read is metered even on a miss");
        assert_eq!(query(&mut e, "post", &[("postId", target)]), Value::Null);
        assert_eq!(e.store().rows("votes").unwrap(), before, "a guard refusal leaves rows intact");
    }
    let unguarded = e.mutate("unchecked", None, context(&args(id("visible"), 1))).unwrap();
    let guarded = e.mutate("checked", None, context(&args(id("visible"), 1))).unwrap();
    assert!(matches!(guarded.state, WriteState::Sent { .. }), "{guarded:?}");
    // Compare the same upsert path after the row exists, with and without its guard.
    let unguarded_again = e.mutate("unchecked", None, context(&args(id("visible"), 1))).unwrap();
    assert!(matches!(unguarded.state, WriteState::Sent { .. }));
    assert_eq!(guarded.metered.examined, unguarded_again.metered.examined + 1);
    mutation(&mut e, "removePost", &[("postId", id("visible"))]);
    assert!(e.store().rows("votes").unwrap().iter().any(|r| r.field("postId") == Ok(&id("visible"))), "deleting a target does not cascade to references");
    assert_eq!(query(&mut e, "post", &[("postId", id("visible"))]), Value::Null);
}
