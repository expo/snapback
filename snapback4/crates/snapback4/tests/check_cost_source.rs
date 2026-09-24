//! Cost explanations preserve the authored meaning and hide planner identities.
use std::{fs, path::PathBuf, process::Command, sync::atomic::{AtomicUsize, Ordering}};
use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;

const SOURCE: &str = r#"
table orgs:
  name: text <=100
  public
  sync public
table issues:
  org: orgs
  status: enum('todo', 'doing', 'done')
  assignee: principal ?
  at: time
  public
  sync public
query board(org: orgs, status: enum('todo', 'doing', 'done') ?, assignee: principal ?, c: cursor ?):
  return issues where .org = org and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .at after c
query heldBoard(org: orgs, c: cursor ?) held:
  return issues where .org = org last 50 by .at after c
"#;
const FILTER: &str = "(status = null or .status = status) and (assignee = null or .assignee = assignee)";

struct Project(PathBuf);
impl Project {
    fn new(source: &str) -> Self {
        static ID: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("sb4-cost-source-{}-{}", std::process::id(), ID.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(dir.join("snapback")).unwrap();
        fs::write(dir.join("snapback/schema.q"), source).unwrap();
        Self(dir)
    }
    fn run(&self, args: &[&str]) -> String {
        let result = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&self.0).args(args).output().unwrap();
        assert!(result.status.success(), "{result:?}");
        String::from_utf8(result.stdout).unwrap()
    }
}
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

#[test]
fn board_quotes_residual_filter_and_source_read_with_planner_columns() {
    let p = Project::new(SOURCE);
    let cost = p.run(&["check", "--cost"]);
    assert!(cost.contains(&format!("scale: grows with issues skipped by `{FILTER}` before 50 match")), "{cost}");
    let read = format!("read: issues where .org = org and {FILTER} last 50 by .at after c");
    assert!(cost.contains(&read), "{cost}");
    assert!(cost.contains("scan issues using index (org, at), chosen by the planner last 50"), "{cost}");
    assert!(cost.contains("selected index (org, at), chosen by the planner (org = org); result: page; read:"), "{cost}");
    assert!(!cost.contains("$intent:") && !cost.contains(" if "), "{cost}");
    let plain = p.run(&["check"]);
    assert!(plain.contains("index (org, at), chosen by the planner"), "{plain}");
    assert!(!plain.contains("$intent:"), "{plain}");
    let verbose = p.run(&["check", "--cost", "--verbose"]);
    assert!(verbose.contains("$intent:byOrgAt:"), "{verbose}");
    assert!(verbose.contains(&read), "{verbose}");
    let json: serde_json::Value = serde_json::from_str(&p.run(&["check", "--cost", "--json"])).unwrap();
    let plans = json["plans"]["board"].as_object().unwrap();
    assert!(plans.values().any(|p| p.as_str().unwrap().contains("selected $intent:byOrgAt:")));
    assert!(plans.values().any(|p| p.as_str().unwrap().contains(&read)));
    let c = json["scale"].as_array().unwrap().iter().find(|c| c["operation"] == "board").unwrap();
    assert!(c["growth_sites"][0]["reason"].as_str().unwrap().contains(FILTER));
}

#[test]
fn source_spans_keep_spacing_parentheses_and_duration_spelling() {
    let authored = "(status=null  or  .status=status) and (assignee = null or .assignee = assignee)";
    let source = SOURCE.replace(FILTER, authored).replace(".org = org and", ".org=org  and");
    let cost = Project::new(&source).run(&["check", "--cost"]);
    assert!(cost.contains(&format!("skipped by `{authored}` before 50")), "{cost}");
    assert!(cost.contains(&format!("read: issues where .org=org  and {authored} last 50")), "{cost}");
    let source = format!("{SOURCE}\nquery recent(c: cursor ?):\n  return issues where .at > now - 24h last 50 by .status after c\n");
    let cost = Project::new(&source).run(&["check", "--cost"]);
    assert!(cost.contains("issues skipped by `.at > now - 24h`"), "{cost}");
    let range = "range(0, (row.amount + 1) * 2)";
    let source = format!("{}\nquery dataRange(id: issues):\n  row = issues[id] ! else MISSING\n  n = 0\n  for i in {range}:\n    n = n + 1\n  return n\n", SOURCE.replace("  at: time", "  at: time\n  amount: int"));
    let cost = Project::new(&source).run(&["check", "--cost"]);
    assert!(cost.contains(&format!("iterations of {range} from stored data")), "{cost}");
}

#[test]
fn multiline_unicode_literals_are_quoted_without_relabeling_their_contents() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    let index = bound.schema.tables["issues"].indexes.keys().find(|name| name.starts_with("$intent:byOrgAt:")).unwrap();
    let literal = format!("'héllo \\'quote\\' {index}; synthesized; explicit by'");
    let filter = format!("(status = null or\n    .label = {literal})");
    let source = SOURCE.replace("  status: enum", "  label: text <=200\n  status: enum").replace(FILTER, &filter).replace('\n', "\r\n");
    let cost = Project::new(&source).run(&["check", "--cost"]);
    assert!(cost.contains(&format!("skipped by `{filter}`")), "{cost}");
    assert!(cost.contains(&format!("read: issues where .org = org and {filter} last 50")), "{cost}");
    assert!(cost.contains("selected index (org, at), chosen by the planner"), "{cost}");
}

#[test]
fn changed_syntax_at_a_retained_site_never_quotes_stale_source() {
    use snapback4_lang::ast::{Expr, Stmt};
    let (mut doc, errors) = snapback4_lang::parse_document("schema.q", SOURCE);
    assert!(errors.is_empty());
    let Stmt::Return { value: Expr::Read(read), .. } = &mut doc.programs[0].body[0] else { panic!("read") };
    let Expr::Binary { right, .. } = read.filter.as_mut().unwrap().as_mut() else { panic!("and") };
    let Expr::Binary { op, .. } = right.as_mut() else { panic!("or") };
    *op = "and".into();
    let b = snapback4_lang::bind(vec![doc]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let p = b.programs.iter().find(|p| p.program.name == "board").unwrap();
    assert!(p.selection("programs.board.0").unwrap().contains("assignee = null and .assignee = assignee"));
    assert!(!p.selection("programs.board.0").unwrap().contains(FILTER));
}

#[test]
fn fallback_printer_preserves_boolean_arithmetic_and_conditional_precedence() {
    use snapback4_lang::{ast::Stmt, print};
    for (expression, expected) in [
        ("(1 + 2) * 3", Value::Int(9)),
        ("10 - (3 - 1)", Value::Int(8)),
        ("true and (false or true)", Value::Bool(true)),
        ("false and (false or true)", Value::Bool(false)),
        ("not (true or false)", Value::Bool(false)),
        ("-(1 + 2)", Value::Int(-3)),
        ("-(-3)", Value::Int(3)),
        ("(1 if false else 2) + 3", Value::Int(5)),
        ("(null ?? 3) ?? 4", Value::Int(3)),
        ("'héllo \\'quoted\\' \\\\ path'", Value::String("héllo 'quoted' \\ path".into())),
    ] {
        let (doc, errors) = snapback4_lang::parse_document("schema.q", &format!("query q():\n  return {expression}\n"));
        assert!(errors.is_empty(), "{errors:?}");
        let Stmt::Return { value, .. } = &doc.programs[0].body[0] else { panic!("return") };
        let printed = print::expression(value);
        let b = snapback4_lang::compile(&[("schema.q".into(), format!("query q():\n  return {printed}\n"))]);
        assert!(b.diagnostics.is_empty(), "{expression} => {printed}: {:?}", b.diagnostics);
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let result = engine.query("q", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(result.data, expected, "{expression} => {printed}");
    }
    let (mut doc, errors) = snapback4_lang::parse_document("schema.q", SOURCE);
    assert!(errors.is_empty());
    doc.source = Default::default();
    let b = snapback4_lang::bind(vec![doc]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let p = b.programs.iter().find(|p| p.program.name == "board").unwrap();
    assert!(p.selections().values().any(|s| s.contains(FILTER)), "{:?}", p.selections());
    assert_eq!(p.filter_source("programs.board.0"), Some(FILTER));
}
