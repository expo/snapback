//! Facts about the current store and a directional release pair.
// @ref LLP 3000.000.000#11-wave-11-factual-release-narration — source changes, dependency changes and absent behavior are separate facts.
// @ref LLP 3000.000.000#12.2 — effective image rules and lexical guard context govern directional narration.
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
            lines.push(format!("WARNING {path}: {count} {} {} {}, which {target_label} cannot hold; {} dormant on this switch and {} restored on compatible forward; accept their absence or preserve these values in a bridge release",
                if count == 1 { "row" } else { "rows" }, if count == 1 { "holds" } else { "hold" }, values.join(", "),
                if count == 1 { "it becomes" } else { "they become" }, if count == 1 { "is" } else { "are" }));
        } else {
            lines.push(format!("note: {path}: no stored values are incompatible with {target_label}; no value repair is needed for this switch"));
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
        lines.push(format!("note: {path} admits {admission}; rows that later use those values become dormant on rollback to release {current_release}; keep this value domain in a bridge if those rows must stay available"));
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
    let mut dependency_groups: BTreeMap<BTreeSet<String>, (usize, BTreeSet<String>)> = BTreeMap::new();
    use super::clause_compare::{self as clauses, Change};
    for (name, old) in &current.tables {
        let Some(next) = target.table(name) else { continue; };
        for effect in [snapback4_core::schema::Effect::Read, snapback4_core::schema::Effect::Insert, snapback4_core::schema::Effect::Update, snapback4_core::schema::Effect::Delete] {
            let (before, after) = (old.rules.for_effect(effect), next.rules.for_effect(effect));
            let before_judged=if effect==snapback4_core::schema::Effect::Update {old.update_rule_judged()} else {std::borrow::Cow::Borrowed(before)};
            let after_judged=if effect==snapback4_core::schema::Effect::Update {next.update_rule_judged()} else {std::borrow::Cow::Borrowed(after)};
            let changed_dependencies = super::release_dependencies::rule(current, name, &before_judged, &after_judged)
                .changed(&super::release_dependencies::rule(target, name, &before_judged, &after_judged));
            let dependencies_stable = changed_dependencies.is_empty();
            if before_judged == after_judged {
                if !dependencies_stable {
                    let group=dependency_groups.entry(changed_dependencies).or_default();group.0+=1;group.1.insert(format!("{name}.{effect}"));
                }
                continue;
            }
            let change = if dependencies_stable { clauses::compare(&clauses::rule(&before_judged), &clauses::rule(&after_judged)) } else { Change::Unknown };
            let line = format!("{target_label} {} {name}.{effect}; old: {} | new: {}", match change { Change::Tightens => "tightens", Change::Loosens => "loosens", Change::Same => "keeps equivalent", Change::Unknown => "changes (implication unproved)" }, before.quarry(), after.quarry());
            if matches!(change,Change::Same | Change::Tightens) { notes.push(line); } else { warnings.push(line); }
        }
    }
    if let Some(project) = old_project {
        let old = authored_programs(&project)?;
        let next = authored_programs(candidate)?;
        for (name, before) in old {
            let Some(after) = next.get(&name) else { continue; };
            if before.kind != snapback4_lang::ast::ProgramKind::Mutation { continue; }
            let (old_lines, _) = requirements(&before, false);
            let (new_lines, _) = requirements(after, false);
            let changed_dependencies = before_programs.get(&name).zip(after_programs.get(&name)).map(|(old,new)|
                super::release_dependencies::changes(current, old, target, new, old_lines==new_lines));
            let stable = changed_dependencies.as_ref().is_some_and(|changes|changes.iter().all(BTreeSet::is_empty));
            let (_,old_formula) = requirements(&before, stable);
            let (_,new_formula) = requirements(after, stable);
            if old_lines.is_empty() && new_lines.is_empty() { continue; }
            if old_lines==new_lines && before.kind==after.kind {
                if stable { continue; }
                let changes=changed_dependencies.unwrap_or_else(||vec![BTreeSet::from(["unavailable saved dependency evidence".into()])]);
                for changed in changes.into_iter().filter(|c|!c.is_empty()) {
                    let group = dependency_groups.entry(changed).or_default();
                    group.0 += 1; group.1.insert(name.clone());
                }
                continue;
            }
            let change = if stable && before.kind == after.kind {
                old_formula.zip(new_formula).map(|(a,b)|clauses::compare(&a,&b)).unwrap_or(Change::Unknown)
            } else { Change::Unknown };
            // Refusal code/message changes are observable even for equivalent predicates.
            let guards = |p: &snapback4_lang::ast::ProgramDecl| p.prelude.iter().chain(&p.body).filter_map(|s| match s {
                snapback4_lang::ast::Stmt::Require {condition,code,message,..}=>Some((condition.clone(),code.clone(),message.clone())), _=>None
            }).collect::<Vec<_>>();
            let old_guards=guards(&before);let new_guards=guards(after);
            let args=before.args.iter().map(|a|a.name.clone()).collect();
            let contract_same=old_guards.len()==new_guards.len() && old_guards.iter().zip(&new_guards).all(|((a,code,msg),(b,next_code,next_msg))| {
                code==next_code && msg==next_msg && clauses::require(a,&args,stable).zip(clauses::require(b,&args,stable)).is_some_and(|(a,b)|clauses::compare(&a,&b)==Change::Same)
            });
            // Admission tightening alone does not preserve earlier refusal codes.
            // Prove each old first-failure region still reaches its same refusal.
            let tightening_contract = old_guards.len()<=new_guards.len() && {
                let (mut old_prefix,mut new_prefix)=(Vec::new(),Vec::new());
                old_guards.iter().zip(&new_guards).all(|((a,code,msg),(b,next_code,next_msg))| {
                    let Some((a,b))=clauses::require(a,&args,stable).zip(clauses::require(b,&args,stable)) else {return false;};
                    let old_failure=clauses::Formula::And(old_prefix.iter().cloned().chain([clauses::Formula::Not(Box::new(a.clone()))]).collect());
                    let new_failure=clauses::Formula::And(new_prefix.iter().cloned().chain([clauses::Formula::Not(Box::new(b.clone()))]).collect());
                    old_prefix.push(a);new_prefix.push(b);
                    code==next_code && msg==next_msg && matches!(clauses::compare(&old_failure,&new_failure),Change::Same|Change::Loosens)
                })
            };
            let change = if change==Change::Same && !contract_same || change==Change::Tightens && !tightening_contract {Change::Unknown} else {change};
            let line = format!("{target_label} {} {name}.require; old: {} | new: {}", match change { Change::Tightens => "tightens", Change::Loosens => "loosens", Change::Same => "keeps equivalent", _ => "changes (implication unproved)" }, if old_lines.is_empty() { "allow".into() } else { old_lines.join("; ") }, if new_lines.is_empty() { "allow".into() } else { new_lines.join("; ") });
            if matches!(change,Change::Same | Change::Tightens) { notes.push(line); } else { warnings.push(line); }
        }
    }
    for (dependencies,(count,operations)) in dependency_groups {
        warnings.push(format!("{} changed: {count} {} unproved across {}; verify their refusal cases before selecting {target_label}", dependencies.into_iter().collect::<Vec<_>>().join(", "), if count==1 {"guard"} else {"guards"}, operations.into_iter().collect::<Vec<_>>().join(", ")));
    }
    for warning in &mut warnings {
        if warning.contains("guards unproved") {continue;}
        warning.push_str(if warning.contains("lacks operation") { "; preserve callers in a bridge or accept this operation being unavailable" }
            else if warning.contains("schedule") || warning.contains("job ") { "; verify scheduled work before selecting this release" }
            else { "; verify allowed and refused cases before selecting this release" });
    }
    for note in &mut notes {
        note.push_str(if note.contains("tightens") { "; confirm newly refused cases are intended" }
            else if note.contains("keeps equivalent") { "; no guard-specific action needed" }
            else { "; verify the scheduled result if these dependencies matter" });
    }
    warnings.sort(); warnings.dedup(); notes.sort(); notes.dedup();
    Ok((warnings, notes))
}

fn authored_programs(project: &Project) -> Result<BTreeMap<String,snapback4_lang::ast::ProgramDecl>,String> {
    let mut out = BTreeMap::new();
    for (file,source) in project.sources().map_err(|e|e.to_string())? {
        let module = Path::new(&file).file_stem().and_then(|s|s.to_str()).unwrap_or("schema");
        for program in snapback4_lang::parse_document(&file,&source).0.programs {
            let name = if module == "schema" { program.name.clone() } else { format!("{module}.{}",program.name) };
            out.insert(name,program);
        }
    }
    Ok(out)
}
fn requirements(program: &snapback4_lang::ast::ProgramDecl, stable_probes: bool) -> (Vec<String>,Option<super::clause_compare::Formula>) {
    use snapback4_lang::ast::Stmt;
    use super::clause_compare::{self as clauses,Formula};
    fn collect(body: &[Stmt], path: &str, inherited: &[String], lines: &mut Vec<String>) -> Vec<String> {
        let mut bindings=inherited.to_vec();
        for (i,stmt) in body.iter().enumerate() {
            let at = format!("{path}/{i}");
            match stmt {
                Stmt::Require { condition,code,message,.. } => lines.push(format!("{at}{}: require {} else {code}{}",if bindings.is_empty() {String::new()} else {format!(" with {}",bindings.join("; "))},snapback4_lang::print::expression(condition),message.as_ref().map(|s|format!(" {}",snapback4_lang::print::quote(s))).unwrap_or_default())),
                Stmt::Bind {names,value,..}=>bindings.push(format!("{} = {}",names.join(", "),snapback4_lang::print::expression(value))),
                Stmt::If { condition,then_body,else_body,.. } => { let at=format!("{at} if {}",snapback4_lang::print::expression(condition)); collect(then_body,&format!("{at}/then"),&bindings,lines);collect(else_body,&format!("{at}/else"),&bindings,lines); },
                Stmt::For { name,domain,body,.. } => {collect(body,&format!("{at} for {name} in {}",snapback4_lang::print::expression(domain)),&bindings,lines);},
                Stmt::As { principal,body,.. } => {collect(body,&format!("{at} as {}",snapback4_lang::print::expression(principal)),&bindings,lines);}, _ => (),
            }
        }
        bindings
    }
    let mut lines=Vec::new();
    let prelude=collect(&program.prelude,"prelude",&[],&mut lines);
    collect(&program.body,"body",&prelude,&mut lines);
    let args = program.args.iter().map(|a|a.name.clone()).collect();
    let mut prefix=true; let mut formulas=Some(Vec::new());
    for stmt in program.prelude.iter().chain(&program.body) {
        if let Stmt::Require {condition,..}=stmt {
            if !prefix { formulas=None; }
            if let Some(parts)=&mut formulas { if let Some(formula)=clauses::require(condition,&args,stable_probes) {parts.push(formula);} else {formulas=None;} }
        } else { prefix=false; }
    }
    // Nested requirements cannot be replaced by a conjunction.
    let count = program.prelude.iter().chain(&program.body).filter(|s|matches!(s,Stmt::Require{..})).count();
    if count != lines.len() { formulas=None; }
    (lines,formulas.map(Formula::And))
}
