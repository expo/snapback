//! Facts about the current store and a directional release pair.
// @ref LLP 3000.000.000#11-wave-11-factual-release-narration — source changes, dependency changes and absent behavior are separate facts.
use crate::project::Project;
use snapback4_core::{Schema, Store, successor::{self, Change}};
use snapback4_lang::lexer::{self, Kind};
use std::{collections::{BTreeMap, BTreeSet}, path::Path};

fn narrower(wide: &Schema, narrow: &Schema) -> BTreeSet<String> {
    let mut paths: BTreeSet<_> = successor::classify(wide, narrow).into_iter()
        .filter(|step| step.change == Change::Narrowing && step.path.contains(".columns."))
        .map(|step| step.path.trim_start_matches("tables.").replace(".columns.", ".")).collect();
    // Defaults and required additions are adoption work, not a change in the
    // intersection of the two releases' column value domains.
    paths.retain(|path| path.split_once('.').is_some_and(|(name, column)| {
        wide.table(name).and_then(|t| t.columns.get(column)).zip(narrow.table(name).and_then(|t| t.columns.get(column))).is_some_and(|(a, b)| a != b)
    }));
    for (name, table) in &narrow.tables {
        let Some(wide) = wide.table(name) else { continue; };
        for constraint in &table.constraints {
            if let snapback4_core::schema::Constraint::Text { field, min, format } = constraint {
                let before = wide.constraints.iter().find_map(|c| match c {
                    snapback4_core::schema::Constraint::Text { field: f, min, format } if f == field => Some((*min, *format)), _ => None,
                }).unwrap_or((0, None));
                if wide.columns.contains_key(field) && (before.0 < *min || format.is_some() && before.1 != *format) {
                    paths.insert(format!("{name}.{field}"));
                }
            }
        }
    }
    paths.retain(|path| path.split_once('.').is_some_and(|(name, column)| narrow.table(name).is_some_and(|t| t.columns.contains_key(column))));
    paths
}

pub(super) fn compatibility(store: &Store, current: &Schema, target: &Schema, current_release: u64, target_label: &str, include_future: bool) -> Result<Vec<String>, String> {
    let mut lines = Vec::new();
    for path in narrower(current, target) {
        let (name, column) = path.split_once('.').unwrap();
        let (count, values) = store.rollback_incompatible_values(current, target, name, column).map_err(|e| e.to_string())?;
        if count > 0 {
            lines.push(format!("WARNING {path}: {count} {} {} {}, which {target_label} cannot hold; {} dormant on this switch and {} restored on compatible forward",
                if count == 1 { "row" } else { "rows" }, if count == 1 { "holds" } else { "hold" }, values.join(", "),
                if count == 1 { "it becomes" } else { "they become" }, if count == 1 { "is" } else { "are" }));
        } else {
            lines.push(format!("note: {path}: no stored values are incompatible with {target_label}"));
        }
    }
    for path in if include_future { narrower(target, current) } else { BTreeSet::new() } {
        let (name, column) = path.split_once('.').unwrap();
        let wide = &target.tables[name].columns[column];
        let narrow = &current.tables[name].columns[column];
        let admission = match (wide, narrow) {
            (snapback4_core::schema::ColumnType::Enum { variants }, snapback4_core::schema::ColumnType::Enum { variants: old }) =>
                variants.iter().filter(|v| !old.contains(v)).map(|v| snapback4_lang::print::quote(v)).collect::<Vec<_>>().join(", "),
            _ => format!("values outside release {current_release}'s column declaration"),
        };
        lines.push(format!("note: {path} admits {admission}; rows that later use {} become dormant on rollback to release {current_release}", if admission.starts_with('\'') { "them" } else { "those values" }));
    }
    Ok(lines)
}

// The lexer excludes comments and positions while retaining indentation and literals.
// Compare authored declarations, not compiler-inserted default/column plumbing.
fn declarations(project: &Project) -> Result<BTreeMap<String, Vec<(Kind, String)>>, String> {
    let mut out = BTreeMap::new();
    for (file, source) in project.sources().map_err(|e| e.to_string())? {
        let (document, _) = snapback4_lang::parse_document(&file, &source);
        let (tokens, errors) = lexer::lex(&file, &source);
        if !errors.is_empty() { return Err(format!("cannot compare job source in {file}: lexical diagnostics")); }
        let mut roots = Vec::new();
        let (mut indent, mut groups) = (0usize, 0usize);
        for (index, token) in tokens.iter().enumerate() {
            // Continuation fields/arguments can start at column one inside
            // delimiters. Only the lexer's actual root declarations end a job.
            if indent == 0 && groups == 0 && token.kind == Kind::Word && token.site.col == 1 {
                roots.push((token.site.line, index));
            }
            match token.kind {
                Kind::Indent => indent += 1,
                Kind::Dedent => indent = indent.saturating_sub(1),
                Kind::Symbol if matches!(token.value.as_str(), "(" | "[" | "{") => groups += 1,
                Kind::Symbol if matches!(token.value.as_str(), ")" | "]" | "}") => groups = groups.saturating_sub(1),
                _ => (),
            }
        }
        for program in document.programs {
            let Some(position) = roots.iter().position(|(line, _)| *line == program.site.line) else { continue; };
            let start = roots[position].1;
            let end = roots.get(position + 1).map_or(tokens.len(), |(_, index)| *index);
            let module = Path::new(&file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
            let name = if module == "schema" { program.name } else { format!("{module}.{}", program.name) };
            out.insert(name, tokens[start..end].iter().filter(|t| t.kind != Kind::Eof).map(|t| (t.kind, t.value.clone())).collect());
        }
    }
    Ok(out)
}

pub(super) fn behavior(store_path: &Path, current: &Schema, target: &Schema, before_programs: &BTreeMap<String, snapback4_core::ir::Program>, after_programs: &BTreeMap<String, snapback4_core::ir::Program>, candidate: &Project, previous_release: Option<u64>, target_label: &str) -> Result<(Vec<String>, Vec<String>), String> {
    let old_project = previous_release.and_then(|id| store_path.parent().map(|dir| Project { root: dir.join("releases").join(id.to_string()) }));
    let source_before = old_project.as_ref().and_then(|p| declarations(p).ok());
    let source_after = declarations(candidate)?;
    let mut warnings = Vec::new();
    let mut notes = Vec::new();
    for schedule in &current.schedules {
        let next = target.schedules.iter().find(|next| next.name == schedule.name);
        if next.is_none() {
            warnings.push(format!("{target_label} lacks schedule {} (job {})", schedule.name, schedule.target));
        } else if !after_programs.contains_key(&schedule.target) {
            warnings.push(format!("{target_label} lacks job {} named by schedule {}", schedule.target, schedule.name));
        } else if next != Some(schedule) {
            warnings.push(format!("schedule {} changes in {target_label} (job {})", schedule.name, schedule.target));
        } else if source_before.as_ref().and_then(|s| s.get(&schedule.target)).zip(source_after.get(&schedule.target)).is_some_and(|(old, new)| old != new) {
            warnings.push(format!("job {} source changes in {target_label}; schedule {} remains", schedule.target, schedule.name));
        } else if before_programs.get(&schedule.target) != after_programs.get(&schedule.target) {
            let unchanged_source = source_before.as_ref().and_then(|s| s.get(&schedule.target)).zip(source_after.get(&schedule.target)).is_some_and(|(old, new)| old == new);
            if !unchanged_source {
                notes.push(format!("job {} compiles differently; saved source comparison unavailable; schedule {} remains", schedule.target, schedule.name));
                continue;
            }
            let tables: BTreeSet<_> = before_programs.get(&schedule.target).into_iter().flat_map(|p| snapback4_core::ir::read_sites(p).into_iter().map(|r| r.table).chain(snapback4_core::ir::write_tables(p).into_iter().map(|(t, _)| t))).collect();
            let changes = tables.into_iter().filter_map(|name| {
                let old = current.table(&name)?;
                let next = target.table(&name)?;
                if old == next { return None; }
                let added = next.columns.keys().filter(|c| !old.columns.contains_key(*c)).cloned().collect::<Vec<_>>();
                let removed = old.columns.keys().filter(|c| !next.columns.contains_key(*c)).cloned().collect::<Vec<_>>();
                Some(format!("{name} changed ({})", if !added.is_empty() { format!("added {}", added.join(", ")) } else if !removed.is_empty() { format!("removed {}", removed.join(", ")) } else { "definition changed".into() }))
            }).collect::<Vec<_>>();
            notes.push(format!("job {} compiles differently because {}; schedule {} remains", schedule.target, if changes.is_empty() { "its dependencies changed".into() } else { changes.join("; ") }, schedule.name));
        }
    }
    for name in before_programs.keys().filter(|n| !after_programs.contains_key(*n)) {
        warnings.push(format!("{target_label} lacks operation {name}"));
    }
    if let Some(project) = old_project {
        for (file, source) in project.sources().map_err(|e| e.to_string())? {
            for table in snapback4_lang::parse_document(&file, &source).0.tables {
                for rule in table.rules {
                    let Some(old) = current.table(&table.name) else { continue; };
                    let effect = match rule.effect {
                        snapback4_lang::ast::Effect::Read => snapback4_core::schema::Effect::Read,
                        snapback4_lang::ast::Effect::Insert => snapback4_core::schema::Effect::Insert,
                        snapback4_lang::ast::Effect::Update => snapback4_core::schema::Effect::Update,
                        snapback4_lang::ast::Effect::Delete => snapback4_core::schema::Effect::Delete,
                    };
                    if target.table(&table.name).is_some_and(|next| next.rules.for_effect(effect) == old.rules.for_effect(effect)) { continue; }
                    warnings.push(format!("{target_label} lacks current rule clause {}.{} <- {}; review business compatibility", table.name, format!("{:?}", rule.effect).to_lowercase(), snapback4_lang::print::expression(&rule.value)));
                }
            }
        }
    }
    warnings.sort(); warnings.dedup(); notes.sort(); notes.dedup();
    Ok((warnings, notes))
}
