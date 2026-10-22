//! Independent policy follows the complete authored current execution closure.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — no restored workflow may bypass current independent intent.
use crate::{
    ast::{self, TypeKind},
    lexer::{self, Kind},
    parser, print,
    release_bridge::Bridge,
};
use snapback4_core::ir::ArgType;
use std::collections::{BTreeMap, BTreeSet};

type Source = (String, String);

pub(super) fn prepare(target: &[Source], current: &[Source]) -> Bridge {
    let old = crate::compile(target);
    let next = crate::compile(current);
    if !old.diagnostics.is_empty() {
        return Bridge {
            sources: target.to_vec(),
            changes: vec![],
            diagnostics: old.diagnostics,
        };
    }
    if !next.diagnostics.is_empty() {
        return Bridge {
            sources: current.to_vec(),
            changes: vec![],
            diagnostics: next.diagnostics,
        };
    }
    if contracts(&old, &next) {
        return retained(current.to_vec(), false);
    }
    match alpha(target, current) {
        Ok(Some(sources)) => {
            let bound = crate::compile(&sources);
            if !bound.diagnostics.is_empty() {
                return Bridge {
                    sources,
                    changes: vec![],
                    diagnostics: bound.diagnostics,
                };
            }
            if contracts(&old, &bound) {
                return retained(sources, true);
            }
        }
        Err(reason) => return refused(current, &reason),
        Ok(None) => {}
    }
    refused(current,"the complete current workflow does not retain every predecessor table, field, operation and accepted input")
}
fn retained(sources: Vec<Source>, alpha: bool) -> Bridge {
    Bridge {sources,diagnostics:vec![],changes:vec![format!("current independent intent: retained the complete current authored schema, defaults, programs, helpers, jobs and policy declarations{}; predecessor names and accepted inputs remain available; review current results in the old UI",if alpha {" under declared table identity renames"}else{""})]}
}
fn refused(current: &[Source], reason: &str) -> Bridge {
    Bridge {sources:current.to_vec(),changes:vec![],diagnostics:vec![crate::diag::type_error(&crate::Site::default(),format!("rollback view cannot preserve current independent intent: {reason}"),"author a compatible guarded source retaining the predecessor fields and inputs, truthful migrations and the current policy; an acknowledgment does not authorize restoring an unsafe workflow").guide("deploy")]}
}
fn contracts(old: &crate::Bound, new: &crate::Bound) -> bool {
    if !old.schema.tables.iter().all(|(name, table)| {
        new.schema.tables.get(name).is_some_and(|next| {
            table
                .columns
                .keys()
                .all(|column| next.columns.contains_key(column))
        })
    }) {
        return false;
    }
    old.programs.iter().all(|p| {
        new.programs
            .iter()
            .find(|n| n.program.name == p.program.name)
            .is_some_and(|n| {
                let (old, new) = (&p.program, &n.program);
                old.kind == new.kind
                    && new.args.iter().all(|(name, kind)| {
                        old.args.contains_key(name) || matches!(kind, ArgType::Optional(_))
                    })
                    && old.args.iter().all(|(name, kind)| {
                        new.args.get(name).is_some_and(|next| accepts(kind, next))
                    })
                    && old.arg_aliases.iter().all(|(alias, name)| {
                        new.argument(alias)
                            .is_some_and(|(canonical, _)| canonical == name)
                    })
            })
    })
}
// This is inclusion of wire domains for an unchanged authored current body,
// not synthesis of a conversion or permission to reinterpret old arguments.
fn accepts(old: &ArgType, new: &ArgType) -> bool {
    if old == new {
        return true;
    }
    match (old, new) {
        (ArgType::Optional(a), ArgType::Optional(b)) => accepts(a, b),
        (_, ArgType::Optional(b)) => accepts(old, b),
        (ArgType::Optional(_), _) => false,
        (
            ArgType::Text {
                min: a,
                max: b,
                format: f,
            },
            ArgType::Text {
                min: x,
                max: y,
                format: g,
            },
        ) => f == g && x <= a && b <= y,
        (ArgType::Enum { variants: a }, ArgType::Enum { variants: b }) => {
            a.iter().all(|v| b.contains(v))
        }
        (
            ArgType::List { .. } | ArgType::ListRange { .. },
            ArgType::List { .. } | ArgType::ListRange { .. },
        ) => {
            let parts = |kind: &ArgType| match kind {
                ArgType::List { of, max } => (0, *max, of.clone()),
                ArgType::ListRange { of, min, max } => (*min, *max, of.clone()),
                _ => unreachable!(),
            };
            let (a, b, element) = parts(old);
            let (x, y, next) = parts(new);
            x <= a
                && b <= y
                && match (element, next) {
                    (None, None) => true,
                    (Some(a), Some(b)) => accepts(&a, &b),
                    _ => false,
                }
        }
        (ArgType::IntRange { .. }, ArgType::Int) => true,
        (ArgType::IntRange { min: a, max: b }, ArgType::IntRange { min: x, max: y }) => {
            x <= a && b <= y
        }
        _ => false,
    }
}
fn word(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}
fn offset(text: &str, line: u32, col: u32) -> usize {
    let start = text
        .split_inclusive('\n')
        .take(line.saturating_sub(1) as usize)
        .map(str::len)
        .sum::<usize>();
    start
        + text[start..]
            .chars()
            .take(col.saturating_sub(1) as usize)
            .map(char::len_utf8)
            .sum::<usize>()
}
fn declaration(text: &str, line: u32) -> (usize, usize) {
    let start = offset(text, line, 1);
    let end = text
        .split_inclusive('\n')
        .enumerate()
        .skip(line as usize)
        .find(|(_, s)| {
            !s.trim().is_empty() && !s.starts_with(char::is_whitespace) && !s.starts_with("--")
        })
        .map(|(i, _)| offset(text, i as u32 + 1, 1))
        .unwrap_or(text.len());
    (start, end)
}
fn remap_type(kind: &mut ast::ScalarType, names: &BTreeMap<String, String>) {
    match &mut kind.kind {
        TypeKind::Ref { table } => {
            if let Some(name) = names.get(table) {
                *table = name.clone()
            }
        }
        TypeKind::List { item, .. } => remap_type(item, names),
        _ => (),
    }
}
// Closed, capture-avoiding alpha conversion of a single source module. Complex
// declaration families require an explicitly authored compatible source.
fn alpha(target: &[Source], current: &[Source]) -> Result<Option<Vec<Source>>, String> {
    if target.len() != 1 || current.len() != 1 {
        return Ok(None);
    }
    let old = parser::parse_document(&target[0].0, &target[0].1).0;
    let (file, text) = &current[0];
    let doc = parser::parse_document(file, text).0;
    if old.tables.iter().chain(&doc.tables).any(|t| !word(&t.name)) {
        return Ok(None);
    }
    let mut names = BTreeMap::new();
    for next in &doc.tables {
        if old.tables.iter().any(|t| t.name == next.name) {
            continue;
        }
        if let Some(prior) = old.tables.iter().find(|t| {
            next.renamed_from.as_ref() == Some(&t.name)
                || t.renamed_from.as_ref() == Some(&next.name)
        }) {
            names.insert(next.name.clone(), prior.name.clone());
        }
    }
    if names.is_empty() {
        return Ok(None);
    }
    // A legal table name may also spell a primitive type. Reprinting that
    // identity in an argument/column must never turn a nominal Ref into Int,
    // Principal, etc. Validate the parser's actual type interpretation.
    for name in names.values() {
        let probe = format!("table __rollback_type_probe:\n  value: {name}\n");
        let (parsed, diagnostics) = parser::parse_document("rollback-type-probe.q", &probe);
        if !diagnostics.is_empty()
            || !matches!(parsed.tables.first().and_then(|t|t.columns.first()).map(|c|&c.type_.kind),Some(TypeKind::Ref{table}) if table==name)
        {
            return Err(
                "a table identity spelling reparses as a scalar or unsupported reference type"
                    .into(),
            );
        }
    }
    let outputs = doc
        .tables
        .iter()
        .map(|t| names.get(&t.name).unwrap_or(&t.name))
        .collect::<BTreeSet<_>>();
    if outputs.len() != doc.tables.len() || names.keys().any(|name| outputs.contains(name)) {
        return Err(
            "the declared table mapping is ambiguous or captures a current table name".into(),
        );
    }
    if !doc.actions.is_empty()
        || !doc.effects.is_empty()
        || !doc.maintains.is_empty()
        || !doc.timelines.is_empty()
        || !doc.views.is_empty()
        || !doc.feed_views.is_empty()
        || !doc.backfills.is_empty()
        || !doc.downfills.is_empty()
        || !doc.extractions.is_empty()
        || doc.programs.iter().any(|p| p.delivery.is_some())
        || doc
            .tables
            .iter()
            .any(|t| t.receipts.is_some() || t.columns.iter().any(|c| c.maintained.is_some()))
    {
        return Err("this table identity mapping includes a derived, receipt or migration declaration outside the closed current-source adapter".into());
    }
    let reserved = names
        .keys()
        .chain(names.values())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut capture = doc.shapes.iter().any(|s| reserved.contains(&s.name));
    capture |= doc.tables.iter().any(|t| {
        t.rules
            .iter()
            .chain(t.column_reads.iter().map(|(_, r)| r))
            .any(|r| r.bindings.iter().any(|n| reserved.contains(n)))
    });
    fn bindings(body: &[ast::Stmt], reserved: &BTreeSet<String>) -> bool {
        body.iter().any(|s| match s {
            ast::Stmt::Bind { names, .. } => names.iter().any(|n| reserved.contains(n)),
            ast::Stmt::For { name, body, .. } => {
                reserved.contains(name) || bindings(body, reserved)
            }
            ast::Stmt::If {
                then_body,
                else_body,
                ..
            } => bindings(then_body, reserved) || bindings(else_body, reserved),
            ast::Stmt::As { body, .. } => bindings(body, reserved),
            _ => false,
        })
    }
    capture |= doc
        .programs
        .iter()
        .any(|p| bindings(&p.prelude, &reserved) || bindings(&p.body, &reserved));
    capture |= doc
        .functions
        .iter()
        .any(|f| matches!(&f.body,ast::FunctionBody::Block(body) if bindings(body,&reserved)));
    for args in doc
        .programs
        .iter()
        .map(|p| &p.args)
        .chain(doc.functions.iter().map(|p| &p.args))
        .chain(doc.actions.iter().map(|p| &p.args))
    {
        capture |= args.iter().any(|a| reserved.contains(&a.name));
    }
    let mut inspect = doc.clone();
    let mut unsupported = false;
    let mut check = |e: &mut ast::Expr| match e {
        ast::Expr::Name { name, .. } => capture |= reserved.contains(name),
        ast::Expr::Walk { .. } | ast::Expr::Merge(_) => unsupported = true,
        _ => (),
    };
    crate::bind::intent_walk::document(&mut inspect, &mut check);
    for inv in &mut inspect.invariants {
        crate::bind::intent_walk::expression(&mut inv.value, &mut check);
    }
    for table in &mut inspect.tables {
        for rule in table
            .rules
            .iter_mut()
            .chain(table.column_reads.iter_mut().map(|(_, r)| r))
        {
            crate::bind::intent_walk::expression(&mut rule.value, &mut check);
        }
        for column in &mut table.columns {
            for value in [&mut column.read, &mut column.default]
                .into_iter()
                .flatten()
            {
                crate::bind::intent_walk::expression(value, &mut check);
            }
        }
        for (value, _) in &mut table.final_exists {
            crate::bind::intent_walk::expression(value, &mut check);
        }
    }
    if unsupported {
        return Err(
            "a recursive or merge expression needs an authored compatible table mapping".into(),
        );
    }
    if capture {
        return Err("a table identity mapping captures a local, argument or shape name".into());
    }
    let (tokens, _) = lexer::lex(file, text);
    let mut edits = Vec::<(usize, usize, String)>::new();
    for table in &doc.tables {
        let mut source = super::release_bridge::retained_declaration(file, text, table, &names)?;
        if let Some(name) = names.get(&table.name) {
            let prior = old
                .tables
                .iter()
                .find(|t| &t.name == name)
                .ok_or("missing predecessor identity")?;
            source = header(
                file,
                &source,
                &table.name,
                name,
                prior.renamed_from.as_deref(),
            )?;
        }
        let (a, b) = declaration(text, table.site.line);
        edits.push((a, b, source));
    }
    for inv in &doc.invariants {
        let table = names.get(&inv.table).unwrap_or(&inv.table);
        let mut value = inv.value.clone();
        crate::bind::intent_walk::expression(&mut value, &mut |e| match e {
            ast::Expr::Read(r)
            | ast::Expr::Exists { read: r, .. }
            | ast::Expr::Created { read: r, .. } => {
                if let Some(name) = names.get(&r.table) {
                    r.table = name.clone()
                }
            }
            ast::Expr::Write { table, .. } => {
                if let Some(name) = names.get(table) {
                    *table = name.clone()
                }
            }
            _ => (),
        });
        let target = if let Some(column) = &inv.column {
            format!("{table}.{column} {} only", inv.target)
        } else if inv.target == "always" {
            format!("{table} always")
        } else {
            format!("{table}.{} only", inv.target)
        };
        let (a, b) = declaration(text, inv.site.line);
        edits.push((
            a,
            b,
            format!("invariant {target} {}\n", print::expression(&value)),
        ));
    }
    let mut other = doc.clone();
    other.tables.clear();
    other.invariants.clear();
    let mut reference_error = None;
    crate::bind::intent_walk::document(&mut other, &mut |e| {
        let (table, site) = match e {
            ast::Expr::Read(r)
            | ast::Expr::Exists { read: r, .. }
            | ast::Expr::Created { read: r, .. } => (&r.table, &r.site),
            ast::Expr::Write { table, site, .. } => (&*table, &*site),
            _ => return,
        };
        let Some(name) = names.get(table) else { return };
        if let Some(token) = tokens.iter().find(|t| {
            t.site.line == site.line
                && t.site.col >= site.col
                && t.kind == Kind::Word
                && t.value == *table
        }) {
            let a = offset(text, token.site.line, token.site.col);
            edits.push((a, a + token.value.len(), name.clone()));
        } else {
            reference_error = Some("a table reference has no unambiguous source span".to_owned());
        }
    });
    if let Some(error) = reference_error {
        return Err(error);
    }
    for arg in doc
        .programs
        .iter()
        .flat_map(|p| &p.args)
        .chain(doc.functions.iter().flat_map(|p| &p.args))
        .chain(doc.actions.iter().flat_map(|p| &p.args))
        .chain(doc.actions.iter().flat_map(|p| p.returns.iter().flatten()))
    {
        let mut kind = arg.type_.clone();
        remap_type(&mut kind, &names);
        if kind != arg.type_ {
            let (a, b) = arg_type(text, &tokens, arg)?;
            edits.push((a, b, print::scalar_type(&kind)));
        }
    }
    edits.sort_by_key(|(a, b, _)| (*a, *b));
    edits.dedup();
    if edits.iter().any(|(a, b, _)| {
        a > b || *b > text.len() || !text.is_char_boundary(*a) || !text.is_char_boundary(*b)
    }) {
        return Err("an unsupported source span needs an authored compatible mapping".into());
    }
    if edits.windows(2).any(|p| p[0].1 > p[1].0) {
        return Err("overlapping source spans in table identity mapping".into());
    }
    let mut result = text.clone();
    for (a, b, value) in edits.into_iter().rev() {
        result.replace_range(a..b, &value);
    }
    Ok(Some(vec![(file.clone(), result)]))
}
fn header(
    file: &str,
    source: &str,
    from: &str,
    to: &str,
    prior: Option<&str>,
) -> Result<String, String> {
    if prior.is_some_and(|p| !word(p)) {
        return Err("qualified predecessor table origin needs an authored source".into());
    }
    let line = source.lines().next().ok_or("missing table header")?;
    let (tokens, _) = lexer::lex(file, line);
    let name = tokens
        .get(1)
        .filter(|t| t.kind == Kind::Word && t.value == from)
        .ok_or("missing table name span")?;
    let mut edits = vec![(
        offset(line, name.site.line, name.site.col),
        offset(line, name.site.line, name.site.col) + from.len(),
        to.to_owned(),
    )];
    if let Some(at) = tokens.iter().enumerate().skip(2).find_map(|(i,t)| (t.value=="renamed").then_some(i)) {
        let last = tokens
            .get(at + 2)
            .filter(|_| tokens.get(at + 1).is_some_and(|t| t.value == "from"))
            .ok_or("invalid table origin span")?;
        edits.push((
            offset(line, tokens[at].site.line, tokens[at].site.col),
            offset(line, last.site.line, last.site.col) + last.value.len(),
            prior
                .map(|p| format!("renamed from {p}"))
                .unwrap_or_default(),
        ));
    } else if let Some(prior) = prior {
        let colon = tokens
            .iter()
            .find(|t| t.value == ":")
            .ok_or("missing table header colon")?;
        let a = offset(line, colon.site.line, colon.site.col);
        edits.push((a, a, format!(" renamed from {prior}")));
    }
    let mut out = source.to_owned();
    edits.sort_by_key(|(a, _, _)| std::cmp::Reverse(*a));
    for (a, b, value) in edits {
        out.replace_range(a..b, &value);
    }
    Ok(out)
}
fn arg_type(
    text: &str,
    tokens: &[lexer::Token],
    arg: &ast::ArgDecl,
) -> Result<(usize, usize), String> {
    let at = tokens
        .iter()
        .position(|t| t.site == arg.site)
        .ok_or("missing argument source span")?;
    let colon = (at..tokens.len())
        .find(|i| tokens[*i].value == ":")
        .ok_or("missing argument type colon")?;
    let start = tokens.get(colon + 1).ok_or("missing argument type")?;
    let mut depth = 0_i32;
    for (ordinal, t) in tokens.iter().skip(colon + 1).enumerate() {
        // `alias` and `default` are legal first nominal type tokens too.
        if ordinal > 0
            && depth == 0
            && (matches!(
                t.value.as_str(),
                "," | ")" | "=" | "default" | "alias" | "renamed" | "deprecated"
            ) || t.kind == Kind::Newline)
        {
            return Ok((
                offset(text, start.site.line, start.site.col),
                text[..offset(text, t.site.line, t.site.col)]
                    .trim_end()
                    .len(),
            ));
        }
        match t.value.as_str() {
            "(" | "[" | "<" => depth += 1,
            ")" | "]" | ">" => depth -= 1,
            _ => (),
        }
    }
    Err("unterminated argument type source span".into())
}
