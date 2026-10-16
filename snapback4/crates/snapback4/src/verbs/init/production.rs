//! Explicit, preview-first schema adaptation. Application screens stay owned.
// @ref LLP 3000.011.003.000#14-wave-14-persona-to-production — apply authorizes only the displayed seat grants.
use crate::project::Project;
use snapback4_core::schema::{ColumnType, RuleExpr};
use snapback4_lang::{ast::{Effect, TableDecl}, lexer::{self, Kind}};
use std::{collections::BTreeSet, path::{Path, PathBuf}};

struct Change { name: String, after: String }
struct Plan { sources: Vec<(String, String)>, changes: Vec<Change>, messages: Vec<String> }

pub(super) fn adapt(root: &Path, apply: bool) -> i32 {
    let project = Project { root: root.to_owned() };
    let plan = match plan(&project) { Ok(plan) => plan, Err(error) => { eprintln!("E_INPUT: {error}"); return 2; } };
    println!("Production adaptation{}: application screens stay unchanged", if apply { " (apply)" } else { " (preview; no files written)" });
    for message in &plan.messages { println!("  {message}"); }
    for change in &plan.changes {
        println!("  replace snapback/{} with:\n{}", change.name, change.after);
    }
    if !apply {
        println!("Review the seat grants, then run: snapback4 init --adapt --production --apply");
        return 0;
    }
    // Check the whole plan before its first write. Do not follow a source symlink.
    if let Err(error) = preflight(&project, &plan.sources) {
        eprintln!("E_INPUT: {error}"); return 2;
    }
    for change in &plan.changes {
        let path = project.schema_dir().join(&change.name);
        if let Err(error) = super::replace_file(&path, &change.after) {
            eprintln!("E_INPUT: {}: {error}; some earlier displayed files may have been written", path.display()); return 2;
        }
    }
    println!("Applied {} schema file(s). Run snapback4 check; map the listed dev principals before deploying. Signup grants no role.", plan.changes.len());
    0
}

fn preflight(project: &Project, sources: &Vec<(String, String)>) -> Result<(), String> {
    if project.sources().ok().as_ref() != Some(sources) { return Err("source set changed during production adaptation; preview again".into()); }
    for (name, before) in sources {
        let path = project.schema_dir().join(name);
        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink())
            || std::fs::read_to_string(&path).unwrap_or_default() != *before {
            return Err(format!("{} changed during production adaptation or is a symlink; preview again", path.display()));
        }
    }
    Ok(())
}

fn plan(project: &Project) -> Result<Plan, String> {
    let sources = project.sources().map_err(|e| format!("snapback/*.q: {e}"))?;
    if sources.is_empty() { return Err("production adaptation needs snapback/*.q".into()); }
    let initial = snapback4_lang::compile(&sources);
    if !initial.diagnostics.is_empty() { return Err(format!("repair the schema before production adaptation: {:?}", initial.diagnostics)); }
    let mut revised = sources.clone();
    let mut messages = vec!["GET /auth/config reports development; guest sessions POST /auth/guest before reads. Bare use identity keeps guests; use identity password removes them.".into()];
    let has_identity = sources.iter().any(|(name, source)| snapback4_lang::parse_document(name, source).0.identity.is_some());
    if !has_identity {
        revised[0].1.insert_str(0, "use identity\n");
        messages.push(format!("add use identity to snapback/{} (password accounts and guests)", revised[0].0));
    } else { messages.push("keep the existing identity methods".into()); }
    let bound = snapback4_lang::compile(&revised);
    let blocked = super::super::readiness::blocked_tables(&bound);
    if blocked.is_empty() { messages.push("no N_NO_PRODUCTION_WRITER tables".into()); }
    else { messages.push(format!("N_NO_PRODUCTION_WRITER tables (including blocked dependents): {}", blocked.iter().cloned().collect::<Vec<_>>().join(", "))); }
    let mut names: BTreeSet<_> = bound.programs.iter().map(|p| p.program.name.clone()).collect();
    let module = Path::new(&revised[0].0).file_stem().unwrap().to_string_lossy();
    let prefix = if module == "schema" { String::new() } else { format!("{module}.") };
    let mut mutations = String::new();
    // A roster has a principal in a unique identity. Other roots need explicit
    // application policy; report them without inventing a catalogue or profile.
    for name in &blocked {
        let table = bound.schema.table(name).unwrap();
        let roster = table.columns.iter().any(|(col, ty)| matches!(ty, ColumnType::Principal)
            && table.indexes.values().any(|index| index.unique && index.columns().contains(col)));
        if !roster || table.through.is_some() {
            messages.push(format!("{name}: review an application-specific first writer (no roster seat grant generated)")); continue;
        }
        let base = format!("bootstrap{name}");
        let mut operation = base.clone(); let mut suffix = 2;
        while !names.insert(format!("{prefix}{operation}")) { operation = format!("{base}{suffix}"); suffix += 1; }
        let inputs: Vec<_> = table.columns.iter().filter(|(column, kind)| column.as_str() != "id"
            && !table.maintained.contains_key(*column)
            && (!table.defaults.contains_key(*column) || matches!(kind, ColumnType::Principal) || column.as_str() == "role")).collect();
        let args = inputs.iter().map(|(col, ty)| format!("seat_{col}: {ty}")).collect::<Vec<_>>().join(", ");
        let fields = inputs.iter().map(|(col, _)| format!("{col}: seat_{col}")).collect::<Vec<_>>().join(", ");
        mutations.push_str(&format!("\nmutation {operation}({args}):\n  require viewer = 'service:ops' else NOT_OPERATOR\n  return insert {name} {{ {fields} }}\n"));
        messages.push(format!("{name}: add {operation}; allow service:ops to read and insert this roster. Existing account grants stay in place; signup grants no role."));
        for (file, source) in &mut revised {
            let (document, _) = snapback4_lang::parse_document(file, source);
            if let Some(decl) = document.tables.iter().find(|decl| decl.name == *name) {
                *source = seat_rules(file, source, decl, &table.rules.read, &table.rules.insert)?;
                break;
            }
        }
    }
    revised[0].1.push_str(&mutations);
    let checked = snapback4_lang::compile(&revised);
    if !checked.diagnostics.is_empty() { return Err(format!("the proposed roster policy does not compile; no files written: {:?}", checked.diagnostics)); }
    messages.push("Mint a private seat with snapback4 token --service ops --release ./deployment; call each bootstrap mutation with real account principals. Never seed a deployed store.".into());
    frontend_principals(&project.root, &mut messages)?;
    let changes = sources.iter().cloned().zip(revised).filter_map(|((name, before), (_, after))| (before != after).then_some(Change { name, after })).collect();
    Ok(Plan { sources, changes, messages })
}

fn allows_seat(rule: &RuleExpr) -> bool {
    use snapback4_core::{schema::RuleTerm, Value};
    match rule {
        RuleExpr::Allow | RuleExpr::Public { .. } => true,
        RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Literal(Value::Id(value) | Value::String(value)))
        | RuleExpr::Eq(RuleTerm::Literal(Value::Id(value) | Value::String(value)), RuleTerm::Viewer) => value == "service:ops",
        RuleExpr::Or(rules) => rules.iter().any(allows_seat),
        _ => false,
    }
}

fn seat_rules(file: &str, source: &str, table: &TableDecl, read: &RuleExpr, insert: &RuleExpr) -> Result<String, String> {
    let mut lines: Vec<String> = source.lines().map(|line| format!("{line}\n")).collect();
    let mut edits = Vec::new();
    let (tokens, _) = lexer::lex(file, source);
    for (effect, rule) in [(Effect::Read, read), (Effect::Insert, insert)] {
        let grant = "viewer = 'service:ops'";
        if allows_seat(rule) { continue; }
        if let Some(decl) = table.rules.iter().find(|decl| decl.effect == effect) {
            let start = decl.site.line as usize - 1;
            let token = tokens.iter().position(|token| token.site.line == decl.site.line && token.value == effect.word()).ok_or("could not locate roster rule")?;
            let end = tokens[token..].iter().find(|token| matches!(token.kind, Kind::Newline | Kind::Eof)).ok_or("could not locate roster rule end")?.site.line as usize;
            let old = lines[start..end.min(lines.len())].concat();
            let (left, value) = old.split_once("<-").ok_or("roster rule needs <-")?;
            // Group the original expression, preserving bindings, comments and
            // every existing branch. The closing line cannot be commented out.
            let new = format!("{}<- (\n{}\n  ) or {grant}\n", left, value.trim_end());
            edits.push((start, end.min(lines.len()), new));
        } else if effect == Effect::Read && table.public.is_some() {
            // Public rows already admit the seat; preserve the authored reason.
        } else {
            edits.push((table.site.line as usize, table.site.line as usize, format!("  {} <- {grant}\n", effect.word())));
        }
    }
    edits.sort_by_key(|(start, _, _)| std::cmp::Reverse(*start));
    for (start, end, text) in edits { lines.splice(start..end, [text]); }
    Ok(lines.concat())
}

fn frontend_principals(root: &Path, messages: &mut Vec<String>) -> Result<(), String> {
    fn walk(root: &Path, dir: &Path, messages: &mut Vec<String>, depth: u8) -> Result<(), String> {
        if depth == 0 { return Ok(()); }
        let entries = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let mut paths: Vec<PathBuf> = entries.map(|entry| entry.map(|e| e.path())).collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        paths.sort();
        for path in paths {
            let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() { continue; }
            if meta.is_dir() {
                if !matches!(path.file_name().and_then(|name| name.to_str()), Some("node_modules" | ".git" | "snapback" | ".snapback4" | "target" | "dist" | "build" | ".expo" | "fixtures" | "versions" | "recipes")) {
                    walk(root, &path, messages, depth - 1)?;
                }
            } else if path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "html")) {
                let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                for (line, _) in text.lines().enumerate().filter(|(_, text)| text.contains("dev:")) {
                    messages.push(format!("{}:{}: hard-coded dev: principal; map to an authenticated account or authorized principal picker", path.strip_prefix(root).unwrap_or(&path).display(), line + 1));
                }
            }
        }
        Ok(())
    }
    walk(root, root, messages, 20)
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preflight_covers_unchanged_modules_and_added_sources() {
        let root = std::env::temp_dir().join(format!("sb4-prod-preflight-{}", std::process::id()));
        std::fs::create_dir_all(root.join("snapback")).unwrap();
        let project = Project { root: root.clone() };
        let file = root.join("snapback/schema.q");
        std::fs::write(&file, "query who():\n  return viewer\n").unwrap();
        let snapshot = project.sources().unwrap();
        assert!(preflight(&project, &snapshot).is_ok());
        std::fs::write(&file, "query who():\n  return 1\n").unwrap();
        assert!(preflight(&project, &snapshot).is_err());
        std::fs::write(&file, &snapshot[0].1).unwrap();
        std::fs::write(root.join("snapback/new.q"), "query value():\n  return 2\n").unwrap();
        assert!(preflight(&project, &snapshot).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
