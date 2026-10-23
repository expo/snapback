//! Intersect authored authority and reuse an authored old endpoint when a
//! deliberately relaxed unique key invalidates its former point lookup.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — no invented row choice or broader audience.
use crate::{
    ast,
    lexer::{self, Kind},
    parser, print,
};
use std::collections::{BTreeMap, BTreeSet};
fn offset(text: &str, line: u32, col: u32) -> usize {
    let start=text.split_inclusive('\n').take(line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
    start+text[start..].chars().take(col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>()
}
fn line_span(file: &str, text: &str, site: &crate::Site) -> Option<(usize, usize)> {
    let (tokens, _) = lexer::lex(file, text);
    let at = tokens.iter().position(|t| t.site == *site)?;
    let end = tokens[at..].iter().find(|t| t.kind == Kind::Newline)?;
    Some((
        offset(text, site.line, 1),
        offset(text, end.site.line, end.site.col),
    ))
}
fn declaration(text: &str, line: u32) -> (usize, usize, String) {
    let start = offset(text, line, 1);
    let mut end = text.len();
    for (next, s) in text.lines().enumerate().skip(line as usize) {
        if !s.trim().is_empty() && !s.starts_with(char::is_whitespace) && !s.starts_with("--") {
            end = offset(text, next as u32 + 1, 1);
            break;
        }
    }
    (start, end, text[start..end].to_owned())
}
pub(super) fn carry(
    sources: &mut [(String, String)],
    current: &[(String, String)],
    changes: &mut Vec<String>,
    forced_programs: &BTreeSet<String>,
) -> BTreeSet<String> {
    let docs = current
        .iter()
        .map(|(f, t)| (f, t, parser::parse_document(f, t).0))
        .collect::<Vec<_>>();
    let mut aliases = BTreeMap::new();
    let mut tables = BTreeMap::new();
    let mut programs = BTreeMap::new();
    for (file, text, doc) in &docs {
        for table in &doc.tables {
            tables.insert(table.name.clone(), table);
            if let Some(old) = &table.renamed_from {
                aliases.insert(table.name.clone(), old.clone());
                tables.insert(old.clone(), table);
            }
        }
        for p in &doc.programs {
            programs.insert(super::release_bridge::operation_name(file,&p.name), (*file, *text, p));
        }
        for(name,target,_)in &doc.aliases {if let Some(p)=doc.programs.iter().find(|p|p.name==*target){programs.insert(super::release_bridge::operation_name(file,name),(*file,*text,p));}}
    }
    for(file,text)in sources.iter(){for old in parser::parse_document(file,text).0.tables{if let Some(prior)=&old.renamed_from{if !tables.contains_key(&old.name){if let Some(next)=tables.get(prior).copied(){tables.insert(old.name.clone(),next);aliases.insert(prior.clone(),old.name.clone());}}}}}
    let remap = |expr: &ast::Expr| {
        let mut expr = expr.clone();
        crate::bind::intent_walk::expression(&mut expr, &mut |e| {
            if let ast::Expr::Read(r)
            | ast::Expr::Exists { read: r, .. }
            | ast::Expr::Created { read: r, .. } = e
            {
                if let Some(old) = aliases.get(&r.table) {
                    r.table = old.clone();
                }
            }
        });
        expr
    };
    let mut relaxed = BTreeSet::new();
    let mut expanded = BTreeSet::new();
    for (file, text) in sources {
        let doc = parser::parse_document(file, text).0;
        let mut edits = Vec::new();
        for old in &doc.tables {
            let Some(next) = tables.get(&old.name) else {
                continue;
            };
            let current_text=docs.iter().find(|(_,_,d)|d.tables.iter().any(|t|t.name==next.name)).map(|(_,text,_)|*text).unwrap();
            let authored_read=|rule:&ast::RuleDecl|->Option<String>{
                if rule.effect!=ast::Effect::Read{return None}
                let(a,b)=line_span(&rule.site.file,current_text,&rule.site)?;let raw=&current_text[a..b];
                raw.trim_start().starts_with("read through ").then(||raw.to_owned())
            };
            for index in old.indexes.iter().filter(|i| {
                i.unique
                    && !next
                        .indexes
                        .iter()
                        .any(|n| n.unique && n.columns == i.columns)
            }) {
                if let Some((start, end)) = line_span(file, text, &index.site) {
                    edits.push((start, end, String::new()));
                    relaxed.insert(old.name.clone());
                    changes.push(format!("{}: current source permits multiple rows for {}; current authored endpoint supplies the old-client selection",old.name,index.columns.join(", ")));
                }
            }
            for column in &next.columns {
                if let Some(prior)=old
                    .columns
                    .iter()
                    .find(|c| c.name == column.name || column.renamed_from.as_ref() == Some(&c.name)||c.renamed_from.as_ref()==Some(&column.name))
                {
                    if let Some(edit)=current_default(file,text,prior,column){
                        edits.push(edit);
                        changes.push(format!("{}.{}: retained current authored default",old.name,prior.name));
                    }
                    continue;
                }
                let Some((_, current_text, _)) = docs
                    .iter()
                    .find(|(_, _, d)| d.tables.iter().any(|t| t.name == next.name))
                else {
                    continue;
                };
                if let Some((a, b)) = line_span(&column.site.file, current_text, &column.site) {
                    let at = declaration(text, old.site.line).1;
                    edits.push((at, at, format!("{}\n", &current_text[a..b])));
                    expanded.insert(old.name.clone());
                    changes.push(format!(
                        "{}.{}: retained current guard/input field",
                        old.name, column.name
                    ));
                }
            }
            if next.public.is_none(){if let Some((_,site))=&old.public {if let Some((a,b))=line_span(file,text,site){edits.push((a,b,String::new()));}}}
            if old.public.is_none(){if let Some((_,site))=&next.public {if let Some((a,b))=line_span(&site.file,current_text,site){let at=declaration(text,old.site.line).1;edits.push((at,at,format!("{}\n",&current_text[a..b])));}}}
            for current in &next.rules {
                if old.rules.iter().any(|r| r.effect == current.effect) {
                    continue;
                }
                let at = declaration(text, old.site.line).1;
                if let Some(raw)=authored_read(current){edits.push((at,at,format!("{raw}\n")));continue;}
                let bindings = if current.bindings.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", current.bindings.join(", "))
                };
                edits.push((
                    at,
                    at,
                    format!(
                        "  {}{bindings} <- {}\n",
                        current.effect.word(),
                        print::expression(&remap(&current.value))
                    ),
                ));
                changes.push(format!(
                    "{}: retained current {} authority",
                    old.name,
                    current.effect.word()
                ));
            }
            // Constraints are current authority too: carry authored quotas,
            // immutable fields and final-existence requirements verbatim.
            for (_,site) in &old.immutable {if let Some((a,b))=line_span(file,text,site){edits.push((a,b,String::new()));}}
            for cap in &old.caps {if let Some((a,b))=line_span(file,text,&cap.site){edits.push((a,b,String::new()));}}
            for (_,site) in &old.final_exists {if let Some((a,b))=line_span(file,text,site){edits.push((a,b,String::new()));}}
            let at=declaration(text,old.site.line).1;
            for(fields,_)in &next.immutable {edits.push((at,at,format!("  immutable {}\n",fields.join(", "))));}
            for cap in &next.caps {edits.push((at,at,format!("  cap {} by {}\n",cap.max,cap.by.join(", "))));}
            for(expr,_)in &next.final_exists {edits.push((at,at,format!("  after insert <- {}\n",print::expression(&remap(expr)))));}
            for prior in [&old.expire,&old.not_before].into_iter().flatten(){if let Some((a,b))=line_span(file,text,&prior.1){edits.push((a,b,String::new()));}}
            if let Some((field,_))=&next.expire {edits.push((at,at,format!("  expire at .{field}\n")));}
            if let Some((field,_))=&next.not_before {edits.push((at,at,format!("  not before .{field}\n")));}
            for index in next.indexes.iter().filter(|i|i.unique&&!old.indexes.iter().any(|o|o.unique&&o.columns==i.columns)) {
                if let Some((_,current_text,_))=docs.iter().find(|(_,_,d)|d.tables.iter().any(|t|t.name==next.name)) {
                    if let Some((a,b))=line_span(&index.site.file,current_text,&index.site){edits.push((at,at,format!("{}\n",&current_text[a..b])));}
                }
            }
            let mut replaced = BTreeSet::new();
            for rule in &old.rules {
                let Some((start, end)) = line_span(file, text, &rule.site) else {
                    continue;
                };
                if !replaced.insert((start, end)) {
                    continue;
                }
                let rules = old
                    .rules
                    .iter()
                    .filter(|r| r.site == rule.site)
                    .map(|old_rule| {
                        let effect = old_rule.effect.word();
                        match next.rules.iter().find(|r| r.effect == old_rule.effect) {
                            Some(current) => {
                                if let Some(raw)=authored_read(current){return raw}
                                let bindings = if current.bindings.is_empty() {
                                    String::new()
                                } else {
                                    format!(" ({})", current.bindings.join(", "))
                                };
                                format!(
                                    "  {effect}{bindings} <- {}",
                                    print::expression(&remap(&current.value))
                                )
                            }
                            None if old_rule.effect==ast::Effect::Read&&next.public.is_some()=>String::new(),
                            None => format!("  {effect} <- deny"),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if text[start..end] != rules {
                    edits.push((start, end, rules));
                    changes.push(format!(
                        "{}: current authored {} authority retained",
                        old.name,
                        rule.effect.word()
                    ));
                }
            }
            for col in &old.columns {
                let Some(next_col) = next
                    .columns
                    .iter()
                    .find(|c| c.name == col.name || c.renamed_from.as_ref() == Some(&col.name))
                else {
                    continue;
                };
                let grouped = next
                    .column_reads
                    .iter()
                    .find(|(fields, _)| fields.contains(&next_col.name))
                    .map(|(_, r)| &r.value);
                let Some(gate) = next_col.read.as_ref().or(grouped) else {
                    continue;
                };
                if col.read.is_none()
                    && !old
                        .column_reads
                        .iter()
                        .any(|(fields, _)| fields.contains(&col.name))
                {
                    let at = declaration(text, old.site.line).1;
                    edits.push((
                        at,
                        at,
                        format!(
                            "  read({}) <- {}\n",
                            col.name,
                            print::expression(&remap(gate))
                        ),
                    ));
                    changes.push(format!(
                        "{}.{}: retained current payload read guard",
                        old.name, col.name
                    ));
                }
            }
        }
        for old in &doc.programs {
            let mut reads = BTreeSet::new();
            let mut d = ast::Document::default();
            d.programs.push(old.clone());
            crate::bind::intent_walk::document(&mut d, &mut |e| match e {
                ast::Expr::Read(r)
                | ast::Expr::Exists { read: r, .. }
                | ast::Expr::Created { read: r, .. } => {
                    reads.insert(r.table.clone());
                }
                ast::Expr::Write { table, .. } => {
                    reads.insert(table.clone());
                }
                _ => (),
            });
            if reads.is_disjoint(&relaxed)
                && reads.is_disjoint(&expanded)
                && !forced_programs.contains(&super::release_bridge::operation_name(file,&old.name))
            {
                continue;
            }
            let Some((current_file, current_text, next)) = programs.get(&super::release_bridge::operation_name(file,&old.name)) else {
                continue;
            };
            if old.kind != next.kind
                || old.args.len() != next.args.len()
                || old
                    .args
                    .iter()
                    .zip(&next.args)
                    .any(|(a, b)| a.name != b.name || !input_accepts(&a.type_, &b.type_))
            {
                continue;
            }
            let (_, _, mut source) = declaration(current_text, next.site.line);
            let (tokens, _) = lexer::lex(current_file, &source);
            let mut replacements = Vec::new();
            if next.name!=old.name {if let Some(name)=tokens.iter().find(|t|t.value==next.name){let at=offset(&source,name.site.line,name.site.col);replacements.push((at,at+name.value.len(),old.name.clone()));}}
            let parsed = parser::parse_document(current_file, &source).0;
            let mut parsed = parsed;
            if let Some(endpoint)=parsed.programs.first() {
                for prior in &old.args {
                    let Some(alias)=&prior.alias else{continue};
                    let Some(arg)=endpoint.args.iter().find(|arg|arg.name==prior.name&&arg.alias.is_none())else{continue};
                    if let Ok((_,end))=super::release_bridge_current::arg_type(&source,&tokens,arg){replacements.push((end,end,format!(" alias {alias}")));}
                }
            }
            crate::bind::intent_walk::document(&mut parsed, &mut |e| {
                let (table, site) = match e {
                    ast::Expr::Read(r)
                    | ast::Expr::Exists { read: r, .. }
                    | ast::Expr::Created { read: r, .. } => (&r.table, &r.site),
                    ast::Expr::Write { table, site, .. } => (&*table, &*site),
                    _ => return,
                };
                if let Some(old) = aliases.get(table) {
                    if let Some(token) = tokens.iter().find(|t| {
                        t.site.line == site.line && t.site.col >= site.col && t.value == *table
                    }) {
                        let at = offset(&source, token.site.line, token.site.col);
                        replacements.push((at, at + table.len(), old.clone()));
                    }
                }
            });
            replacements.sort();
            replacements.dedup();
            replacements.sort_by_key(|r| std::cmp::Reverse(r.0));
            for (a, b, value) in replacements {
                source.replace_range(a..b, &value);
            }
            let (a, b, _) = declaration(text, old.site.line);
            edits.push((a, b, source));
            changes.push(format!("operation {}: current authored compatibility endpoint preserves its argument contract and guards",super::release_bridge::operation_name(file,&old.name)));
        }
        for fill in &doc.backfills {
            let Some(current) = tables.get(&fill.table) else {
                continue;
            };
            if let ast::Expr::Object { fields, .. } = &fill.value {
                if fields
                    .iter()
                    .all(|f| current.columns.iter().any(|c| c.name == f.name))
                {
                    let (a, b, _) = declaration(text, fill.site.line);
                    edits.push((a, b, String::new()));
                    changes.push(format!(
                        "{}: retained current forward migration custody instead of historical {}",
                        fill.table, fill.name
                    ));
                }
            }
        }
        for down in &doc.downfills {
            if docs.iter().any(|(_, _, d)| {
                d.downfills
                    .iter()
                    .any(|f| f.table == down.table && f.name == down.name)
            }) {
                continue;
            }
            let Some(current) = tables.get(&down.table) else {
                continue;
            };
            if let ast::Expr::Object { fields, .. } = &down.value {
                if fields
                    .iter()
                    .all(|f| current.columns.iter().any(|c| c.name == f.name))
                {
                    let (a, b, _) = declaration(text, down.site.line);
                    edits.push((a, b, String::new()));
                    changes.push(format!("{}: obsolete down {} stays historical; visible view keeps current native values",down.table,down.name));
                }
            }
        }
        for (current_file, current_text, current_doc) in &docs {
            for backfill in &current_doc.backfills {
                if !doc.tables.iter().any(|t| t.name == backfill.table) {
                    continue;
                }
                let (_, _, source) = declaration(current_text, backfill.site.line);
                edits.push((text.len(), text.len(), format!("\n{source}")));
                changes.push(format!(
                    "{}: retained current migration {}",
                    backfill.table, backfill.name
                ));
                let _ = current_file;
            }
        }
        edits.sort_by_key(|e| std::cmp::Reverse((e.0, e.1)));
        for (a, b, value) in edits {
            text.replace_range(a..b, &value);
        }
    }
    relaxed.extend(expanded);
    relaxed
}

fn current_default(file:&str,text:&str,old:&ast::ColumnDecl,new:&ast::ColumnDecl)->Option<(usize,usize,String)> {
    let authored=|column:&ast::ColumnDecl|column.default.as_ref().map(print::expression);
    if authored(old)==authored(new){return None;}
    let replacement=authored(new).map(|value|format!("default {value}")).unwrap_or_default();
    if let Some(value)=&old.default {
        let(tokens,_)=lexer::lex(file,text);
        let at=tokens.iter().position(|token|token.site==*value.site())?;
        let keyword=at.checked_sub(1).filter(|i|tokens[*i].value=="default")?;
        let end=at+if matches!(value,ast::Expr::Unary{..}){2}else{1};
        let end=offset(text,tokens.get(end)?.site.line,tokens.get(end)?.site.col).min(text.len());
        Some((offset(text,tokens[keyword].site.line,tokens[keyword].site.col),text[..end].trim_end().len(),replacement))
    }else{
        let(_,end)=super::release_bridge::type_span(file,text,old)?;
        Some((end,end,format!(" {replacement}")))
    }
}

pub(super) fn input_accepts(old: &ast::ScalarType, new: &ast::ScalarType) -> bool {
    if old == new {
        return true;
    }
    if old.optional && !new.optional {
        return false;
    }
    use ast::TypeKind::*;
    let bounds = |k: &ast::TypeKind| match k {
        Int => Some((i64::MIN, i64::MAX)),
        IntRange { min, max } => Some((min.unwrap_or(i64::MIN), max.unwrap_or(i64::MAX))),
        _ => None,
    };
    match (bounds(&old.kind), bounds(&new.kind)) {
        (Some((a, b)), Some((x, y))) => x <= a && y >= b,
        _ => match (&old.kind,&new.kind){(Enum{variants:a},Enum{variants:b})=>a.iter().all(|v|b.contains(v)),_=>old.kind==new.kind},
    }
}

#[cfg(test)]
mod tests {
    use crate::release_bridge::loosen;
    #[test]
    fn preserves_current_transition_guard_fields_and_authored_old_client_writes() {
        let old = "table items:\n  n: int 1..10\n  insert <- allow\n  update <- allow\n  online only\nmutation add(n: int 1..10):\n  return insert items {n}\n";
        let current = "table items:\n  n: int 0..10\n  category: enum('free','paid')\n  insert <- allow\n  update (old,next) <- old.category = next.category\n  online only\nmutation add(n: int 0..10):\n  return insert items {n,category:'free' if n = 0 else 'paid'}\nbackfill items classify(n: int 0..10): {category:'free' if n = 0 else 'paid'}\n";
        let bridge = loosen(
            &[("schema.q".into(), old.into())],
            &[("schema.q".into(), current.into())],
        );
        assert!(
            bridge.diagnostics.is_empty(),
            "{:?}\n{:?}",
            bridge.diagnostics,
            bridge.sources
        );
        let text = &bridge.sources[0].1;
        assert!(text.contains("old.category = next.category"));
        assert!(text.contains("category:'free' if n = 0 else 'paid'"));
        assert!(text.contains("backfill items classify"));
    }
    #[test]
    fn keeps_a_fitting_old_write_when_current_guards_transport_without_replacing_it(){
        let old="table items:\n  amount: int\n  insert <- allow\n  online only\nmutation add():\n  return insert items {amount:100}\n";
        let current=old.replace("amount: int", "amount: int ?").replace("amount:100", "amount:null");
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.sources[0].1.contains("amount:100"));
    }
    #[test]
    fn carries_current_guards_even_when_the_join_has_no_changed_columns(){
        let old="table items:\n  n: int\n  insert <- allow\n  online only\nmutation add(n: int):\n  return insert items {n}\n";
        let current=old.replace("  return insert items","  require n > 0 else TOO_EARLY\n  return insert items");
        let b=loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.sources[0].1.contains("TOO_EARLY"));
    }
    #[test]
    fn does_not_reuse_an_endpoint_that_requires_new_arguments() {
        let old = "table items:\n  n: int\n  insert <- allow\n  online only\nmutation add(n: int):\n  return insert items {n}\n";
        let current = "table items:\n  n: int\n  required: int\n  insert <- allow\n  online only\nmutation add(n: int, required: int):\n  return insert items {n,required}\n";
        let bridge = loosen(
            &[("schema.q".into(), old.into())],
            &[("schema.q".into(), current.into())],
        );
        assert!(!bridge.diagnostics.is_empty());
    }
}
