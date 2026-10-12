use super::*;
use snapback4_core::schema::{RuleHop, MAX_RULE_HOPS};
// @ref LLP 3000.007#5.4 — bounded live, authorized point reads are distinct
// from the immutable audience capture of read through.
pub(super) fn rule_reference(catalog: &Catalog, info: &TableInfo, base: &Expr, field: &str, bindings: &RuleBindings, site: &Site) -> Fallible<(RuleTerm, Ty)> {
    let refusal = |reason: &str| Diagnostic::new(site, "E_QUARRY_RULE_HOP", reason,
        reference_rewrite(catalog, info, &Expr::Member { base: Box::new(base.clone()), name: field.into(), site: site.clone() })).guide("rules");
    let (source, ty) = match base {
        Expr::Member { .. } => rule_term(catalog, info, base, bindings)?,
        _ => return Err(refusal("a rule hop needs a row-local reference or an id lookup through it")),
    };
    let (column, old, mut hops) = match source {
        RuleTerm::Field(c) | RuleTerm::NextField(c) => (c, false, vec![]),
        RuleTerm::OldField(c) => (c, true, vec![]),
        RuleTerm::Reference { table, column, field, old } => (column, old, vec![RuleHop { table, field }]),
        RuleTerm::ReferenceChain { column, hops, old } => (column, old, hops),
        _ => return Err(refusal("a rule hop needs a row-local reference")),
    };
    if hops.len() >= MAX_RULE_HOPS { return Err(refusal("a rule term follows at most three references")); }
    let Ty::Ref(table) = ty.required() else { return Err(type_error(site, "a rule hop needs a table reference", "declare the source column with its referenced table type")); };
    let target = catalog.tables.get(&table).ok_or_else(|| unknown(site, format!("unknown table {table}"), "declare the referenced table"))?;
    let (owner, source_field) = hops.last().map_or((info, column.as_str()), |hop| (&catalog.tables[&hop.table], hop.field.as_str()));
    let private = |info: &TableInfo, field: &str| info.decl.columns.iter().any(|c| c.name == field && c.written_by.is_some() && !c.readable_by_audience);
    if !bindings.hops { return Err(refusal("read rules inherit whole parent authority with read through; live hops belong to write rules")); }
    if target.maintained.is_some() || super::super::columns::fields(target).any(|c| c == field) {
        return Err(refusal("a rule hop cannot read maintained targets or fields at a fixed point-read cost; pass the view's group keys to the mutation"));
    }
    if target.decl.ephemeral.is_some() { return Err(refusal("ephemeral rows cannot decide durable write authority; store this authority in a durable table before using the mutation check")); }
    if private(owner, source_field) || private(target, field) { return Err(refusal("a rule hop cannot disclose a private field to the row audience")); }
    let field_ty = column_ty(target, field).ok_or_else(|| unknown(site, format!("{table} has no column {field}"), name_rewrite(field, target.columns.keys().map(String::as_str), None)))?;
    if hops.is_empty() { return Ok((RuleTerm::Reference { table, column, field: field.into(), old }, field_ty)); }
    hops.push(RuleHop { table, field: field.into() });
    Ok((RuleTerm::ReferenceChain { column, hops, old }, field_ty))
}

/// A concrete mutation check. Bind each row before testing the predicate so
/// neither null equality nor negation can turn an absent/hidden hop into a grant.
/// Row-local fields name mutation inputs; named images keep old_/next_ prefixes.
pub(super) fn reference_rewrite(catalog: &Catalog, info: &TableInfo, expr: &Expr) -> String {
    fn lookup(catalog: &Catalog, table: &str, key: &str) -> String {
        // Aggregate rows are addressed by their group, never by a row id.
        let group = catalog.tables.get(table).filter(|t| t.maintained.is_some())
            .and_then(|t| t.indexes.iter().find(|i| i.name == "byGroup"));
        let key = group.map_or_else(|| format!("id = {key}"), |index|
            index.columns.iter().map(|field| format!("{field} = {field}")).collect::<Vec<_>>().join(", "));
        format!("{table}[{key}]")
    }
    fn private_guard(info: &TableInfo, field: &str, row: &str, lines: &mut Vec<String>) {
        if let Some(owner) = info.decl.columns.iter().find(|c| c.name == field && !c.readable_by_audience).and_then(|c| c.written_by.as_ref()) {
            lines.push(format!("require {row}{owner} = viewer else FORBIDDEN"));
        }
    }
    fn selected(catalog: &Catalog, table: &str, field: &str, local: &str) -> (String, Option<Ty>) {
        let target = catalog.tables.get(table);
        // A maintained view lookup returns its scalar value directly.
        let value = if field == "value" && target.is_some_and(|t| t.maintained.is_some()) { local.into() }
            else { format!("{local}.{field}") };
        (value,target.and_then(|t| column_ty(t,field)))
    }
    fn render(catalog: &Catalog, info: &TableInfo, expr: &Expr, lines: &mut Vec<String>) -> (String, Option<Ty>) {
        match expr {
            Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => {
                private_guard(info, name, "", lines);
                (name.clone(), column_ty(info, name))
            },
            Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Name { .. }) => {
                let Expr::Name { name: image, .. } = base.as_ref() else { unreachable!() };
                if let Some(Ty::Ref(table)) = column_ty(info, image).map(|ty| ty.required()) {
                    let local = format!("rule_parent_{}", lines.len());
                    lines.push(format!("{local} = {} ! else FORBIDDEN", lookup(catalog, &table, image)));
                    if let Some(target) = catalog.tables.get(&table) { private_guard(target, name, &format!("{local}."), lines); }
                    selected(catalog,&table,name,&local)
                } else { (format!("{image}_{name}"), column_ty(info, name)) }
            }
            Expr::Member { base, name, .. } => {
                // @ref LLP 3000.036#14.3 — lane 092: a named unique key (`staff[principal = viewer]`) stays named.
                let mut named = None;
                let (key, ty) = if let Expr::Read(read) = base.as_ref() {
                    let key = read.keys.first().map(|key| render(catalog, info, &key.value, lines).0).unwrap_or_else(|| "id".into());
                    named = read.keys.first().and_then(|key| key.column.clone()).filter(|column| column != "id");
                    // @ref LLP 3000.036#18 — preserve the typed positional key; viewer is a principal, never an intrinsic row id.
                    if named.is_none() && key == "viewer" && read.keys.len() == 1 {
                        if let Some(target) = catalog.tables.get(&read.table) {
                            let candidates: Vec<_> = target.indexes.iter().filter(|index| target.total_unique(index) && index.columns.len() == 1
                                && target.columns.get(&index.columns[0]).is_some_and(|ty| ty.kind == TypeKind::Principal)
                                && read.index.as_ref().is_none_or(|name| *name == index.name)).collect();
                            if candidates.len() == 1 { named = Some(candidates[0].columns[0].clone()); }
                        }
                    }
                    (key, Some(Ty::Ref(read.table.clone())))
                } else { render(catalog, info, base, lines) };
                if let Some(Ty::Ref(table)) = ty.map(|ty| ty.required()) {
                    let local = format!("rule_parent_{}", lines.len());
                    let target = match &named { Some(column) => format!("{table}[{column} = {key}]"), None if matches!(base.as_ref(), Expr::Read(_)) => format!("{table}[{key}]"), None => lookup(catalog, &table, &key) };
                    lines.push(format!("{local} = {target} ! else FORBIDDEN"));
                    if let Some(target) = catalog.tables.get(&table) { private_guard(target, name, &format!("{local}."), lines); }
                    selected(catalog,&table,name,&local)
                } else { (crate::print::expression(expr), None) }
            }
            Expr::Binary { op, left, right, .. } => {
                let left = render(catalog, info, left, lines).0;
                let right = render(catalog, info, right, lines).0;
                (format!("({left} {op} {right})"), None)
            }
            Expr::Unary { op, value, .. } => (format!("{op} ({})", render(catalog, info, value, lines).0), None),
            Expr::Exists { read, .. } => {
                let keys = read.keys.iter().map(|key| {
                    let value = render(catalog, info, &key.value, lines).0;
                    key.column.as_ref().map_or(value.clone(), |col| format!("{col} = {value}"))
                }).collect::<Vec<_>>().join(", ");
                let index = read.index.as_ref().map_or(String::new(), |i| format!(" by {i}"));
                (format!("exists {}[{keys}]{index}", read.table), None)
            }
            _ => (crate::print::expression(expr), None),
        }
    }
    let mut lines = Vec::new();
    let (predicate, _) = render(catalog, info, expr, &mut lines);
    lines.push(format!("require {predicate} else FORBIDDEN"));
    lines.join("\n")
}

/// A read rule that hops (`.box.season`) cannot be a partition's audience.
/// The repair is always one that compiles as printed (round-tripped in
/// `tests/wave2_rule_language.rs` and `tests/wave3_rule_language.rs`): an
/// online-only table or a view probes the row that holds the deciding value
/// (`exists parent[.ref, field = viewer]`, copying the last reference when the
/// chain is longer than one hop); a synced table compared with `viewer`
/// copies the deciding principal, which sync can use as a column audience.
/// Every hop in the rule is repaired, not only the first (lane 033).
// @ref LLP 3000.036#11 — app-farm pattern 33: show a table-rule repair, not mutation syntax.
// @ref LLP 3000.036#12 — wave 2 R9: skip the intermediate one-hop form that is itself refused.
// @ref LLP 3000.036#13.5 — wave 3 #17: repair each hop, and say `read through` widens the audience.
pub(super) fn read_hop_rewrite(catalog: &Catalog, info: &TableInfo, rule: &Expr) -> Option<String> {
    let first = single_hop_rewrite(catalog, info, rule)?;
    let quoted = |text: &str| text.split('`').skip(1).step_by(2).map(str::to_owned).collect::<Vec<_>>();
    let rule_of = |text: &str| -> Option<Expr> {
        let read = quoted(text).into_iter().find_map(|piece| piece.strip_prefix("read <- ").map(str::to_owned))?;
        let (document, errors) = crate::parser::parse_document("rule.q", &format!("table {}:\n  read <- {read}\n", info.decl.name));
        if !errors.is_empty() { return None; }
        document.tables.first()?.rules.iter().find(|r| r.effect == Effect::Read).map(|r| r.value.clone())
    };
    let mut steps = vec![first.clone()];
    let mut current = rule_of(&first);
    while let Some(next) = current.as_ref().filter(|next| find(next).is_some()) {
        if steps.len() >= MAX_RULE_HOPS * 4 { return None; }
        let step = single_hop_rewrite(catalog, info, next)?;
        current = rule_of(&step);
        steps.push(step);
    }
    if steps.len() == 1 { return Some(first); }
    // Several hops name several audiences; sync delivers one (E_SYNC). The
    // online-only form keeps every reader with a probe per hop.
    if info.maintained.is_none() && info.decl.sync.is_some() && !info.decl.online_only {
        let mut online = info.clone();
        online.decl.sync = None;
        online.decl.online_only = true;
        let repair = read_hop_rewrite(catalog, &online, rule)?;
        return Some(format!("these hops name more than one audience, and a synced table has one (E_SYNC): replace its sync line with `online only`; then {repair}"));
    }
    // Merge the steps' declarations, insert checks and view groups into one repair.
    let (mut declare, mut immutable, mut checks, mut by, mut caveats) = (Vec::<String>::new(), Vec::<String>::new(), Vec::<String>::new(), Vec::<String>::new(), Vec::<String>::new());
    let mut through = None;
    for step in &steps {
        for piece in quoted(step) {
            if let Some(check) = piece.strip_prefix("insert <- … and ") { if !checks.contains(&check.to_owned()) { checks.push(check.into()); } }
            else if let Some(columns) = piece.strip_prefix("immutable ") { for column in columns.split(", ") { if !immutable.iter().any(|c| c == column) { immutable.push(column.into()); } } }
            else if let Some(columns) = piece.strip_prefix("by ") { for column in columns.split(", ") { if !by.iter().any(|c| c == column) { by.push(column.into()); } } }
            else if piece.starts_with("read through") { through.get_or_insert(piece); }
            else if piece.split_once(": ").is_some_and(|(name, ty)| name.chars().all(char::is_alphanumeric) && !ty.contains('[')) && !declare.contains(&piece) { declare.push(piece); }
        }
        if let Some((_, rest)) = step.split_once("so this holds while ") && let Some((columns, _)) = rest.split_once(" cannot change") {
            for column in columns.split(" and ") { if !caveats.iter().any(|c| c == column) { caveats.push(column.into()); } }
        }
    }
    let read = quoted(steps.last()?).into_iter().find(|piece| piece.starts_with("read <- "))?;
    let table = &info.decl.name;
    let through = through.map(|through| format!("; `{through}` instead gives {table} the parent's whole audience, which admits more readers than this rule: use it only when every reader of the parent may read these rows")).unwrap_or_default();
    if declare.is_empty() && checks.is_empty() && by.is_empty() {
        return Some(format!("a read rule reads no reference hop; probe the rows that decide instead: `{read}`{through}"));
    }
    let mut parts = Vec::new();
    if !by.is_empty() { parts.push(format!("group the view by the columns that name the deciding rows (`by {}`)", by.join(", "))); }
    if !declare.is_empty() {
        let names = declare.iter().map(|d| format!("`{d}`")).collect::<Vec<_>>().join(" and ");
        parts.push(if immutable.is_empty() { format!("declare {names}") } else { format!("declare {names} with `immutable {}`", immutable.join(", ")) });
    }
    if !checks.is_empty() { parts.push(format!("check them in the insert rule (`insert <- … and {}`)", checks.join(" and "))); }
    let caveat = if caveats.is_empty() { String::new() } else { format!(" (the copies are checked at insert, so this holds while {} cannot change)", caveats.join(" and ")) };
    Some(format!("a read rule reads no reference hop, so repair each hop: {}, then `{read}`{caveat}{through}", parts.join(", ")))
}

/// `.a.b … .f` rooted at the row, outermost first: `[a, b, …, f]`.
fn chain(expr: &Expr) -> Option<Vec<String>> {
    let mut names = Vec::new();
    let mut at = expr;
    loop {
        match at {
            Expr::Member { base, name, .. } => { names.push(name.clone()); at = base; }
            Expr::Focal { .. } => break,
            _ => return None,
        }
    }
    names.reverse();
    (names.len() >= 2).then_some(names)
}

/// The first hop chain, with the equality it sits in (`= X`), if any.
fn find(expr: &Expr) -> Option<(Vec<String>, Option<(&Expr, String)>)> {
    if let Some(names) = chain(expr) { return Some((names, Some((expr, "true".into())))); }
    match expr {
        Expr::Binary { op, left, right, .. } if op == "=" => match (chain(left), chain(right)) {
            (Some(names), None) => Some((names, Some((expr, crate::print::expression(right))))),
            (None, Some(names)) => Some((names, Some((expr, crate::print::expression(left))))),
            _ => find(left).or_else(|| find(right)),
        },
        Expr::Member { base, .. } => find(base).map(|(names, _)| (names, None)),
        Expr::Binary { left, right, .. } => match (chain(left), chain(right)) {
            (Some(names), _) | (None, Some(names)) => Some((names, None)),
            _ => find(left).or_else(|| find(right)),
        },
        Expr::Unary { value, .. } => find(value),
        Expr::Exists { read, .. } | Expr::Created { read, .. } => read.keys.iter().find_map(|key| find(&key.value)).map(|(names, _)| (names, None)),
        _ => None,
    }
}

/// The repair for the rule's first hop chain.
fn single_hop_rewrite(catalog: &Catalog, info: &TableInfo, rule: &Expr) -> Option<String> {
    let (names, equality) = find(rule)?;
    let (refs, field) = names.split_at(names.len() - 1);
    let field = &field[0];
    // Resolve each hop: (reference column, the table holding it, the table it names).
    let mut hops: Vec<(&str, &TableInfo, String)> = Vec::new();
    let mut owner = info;
    for reference in refs {
        let Ty::Ref(target) = column_ty(owner, reference)?.required() else { return None };
        let next = catalog.tables.get(&target)?;
        hops.push((reference, owner, target));
        owner = next;
    }
    let holder = owner;
    let field_ty = column_ty(holder, field)?;
    let declared = |ty: &Ty| match ty.required() { Ty::Ref(table) => table, Ty::Principal => "principal".into(), other => other.name() };
    let table = &info.decl.name;
    let first = hops[0].0;
    let parent = &hops[0].2;
    let immutable = |owner: &TableInfo, column: &str| owner.decl.immutable.iter().any(|(columns, _)| columns.iter().any(|c| c == column));
    // The copy below is checked once, at insert; it stays true while every
    // later hop (and, for a copied value, the value itself) cannot change.
    let mutable: Vec<String> = hops.iter().skip(1).filter(|(column, owner, _)| !immutable(owner, column)).map(|(column, owner, _)| format!("{}.{column}", owner.decl.name)).collect();
    let caveat = |extra: &[String]| {
        let all: Vec<&String> = mutable.iter().chain(extra).collect();
        if all.is_empty() { String::new() } else { format!(" (the copy is checked at insert, so this holds while {} cannot change)", all.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(" and ")) }
    };
    let through = format!("; `read through .{first}` would instead give {table} the whole {parent} audience, which admits more readers than this rule: use it only when every reader of {parent} may read these rows");
    let replace = |replacement: &str| {
        let (node, _) = equality.as_ref().expect("an equality to replace");
        crate::print::with_source(rule, &|e| std::ptr::eq(e, *node).then(|| (replacement.to_owned(), true)))
    };
    let synced = info.maintained.is_none() && info.decl.sync.is_some() && !info.decl.online_only;
    let viewer = equality.as_ref().is_some_and(|(_, other)| other == "viewer") && matches!(field_ty.required(), Ty::Principal);
    if let Some(view) = &info.maintained {
        // A view's rows are its groups: group by the reference the probe needs.
        let (_, _, holder_table) = hops.last()?;
        let (_, other) = equality.as_ref()?;
        if hops.len() == 1 {
            let probe = format!("exists {holder_table}[.{first}, {field} = {other}]");
            return Some(format!("a read rule reads no reference hop; probe the row that decides instead: `read <- {}`", replace(&probe)));
        }
        let source = catalog.tables.get(&view.source)?;
        let carried = source.columns.iter().find(|(_, ty)| matches!(Ty::from_scalar(ty).required(), Ty::Ref(t) if &t == holder_table)).map(|(name, _)| name.clone())?;
        let probe = format!("exists {holder_table}[.{carried}, {field} = {other}]");
        let mut by: Vec<String> = view.by.clone();
        if !by.contains(&carried) { by.push(carried.clone()); }
        return Some(format!("a read rule reads no reference hop: group the view by the {source_name} column that names the deciding row (`by {}`), then probe it: `read <- {}`", by.iter().map(|b| format!(".{b}")).collect::<Vec<_>>().join(", "), replace(&probe), source_name = view.source));
    }
    if synced && viewer {
        // Sync needs a column audience: copy the deciding principal itself.
        let check = if hops.len() == 1 { format!("exists {parent}[.{first}, {field} = .{field}]") } else { format!(".{field} = .{}", names.join(".")) };
        let declare = if info.columns.contains_key(field) { String::new() } else { format!("declare `{field}: principal` with `immutable {first}, {field}`, ") };
        let holder_column = format!("{}.{field}", holder.decl.name);
        let extra = if immutable(holder, field) { vec![] } else { vec![holder_column] };
        return Some(format!("a read rule reads no reference hop, and a synced row needs its reader on the row: {declare}check it in the insert rule (`insert <- … and {check}`), then `read <- {}`{}{through}", replace(&format!(".{field} = viewer")), caveat(&extra)));
    }
    let Some((_, other)) = &equality else {
        // Not an equality (for example `!=`): copy the value and compare it on the row.
        let check = if hops.len() == 1 { format!("exists {parent}[.{first}, {field} = .{field}]") } else { format!(".{field} = .{}", names.join(".")) };
        let printed = crate::print::expression(rule);
        let one = printed.replace(&format!(".{}", names.join(".")), &format!(".{field}"));
        let one = one.strip_prefix('(').and_then(|t| t.strip_suffix(')')).unwrap_or(&one).to_owned();
        let holder_column = format!("{}.{field}", holder.decl.name);
        let extra = if immutable(holder, field) { vec![] } else { vec![holder_column] };
        return Some(format!("a read rule reads no reference hop, so copy the deciding value onto {table}: declare `{field}: {}` with `immutable {first}, {field}`, check it in the insert rule (`insert <- … and {check}`), then `read <- {one}`{}{through}", declared(&field_ty), caveat(&extra)));
    };
    if hops.len() == 1 {
        let probe = format!("exists {parent}[.{first}, {field} = {other}]");
        return Some(format!("a read rule reads no reference hop; probe the row that decides instead: `read <- {}`{through}", replace(&probe)));
    }
    // Two or more hops: copy the last reference, check it at insert, probe one hop.
    let (last, _, holder_table) = hops.last()?;
    let check = if hops.len() == 2 { format!("exists {parent}[.{first}, {last} = .{last}]") } else { format!(".{last} = .{}", refs.join(".")) };
    let declare = if info.columns.contains_key(*last) { String::new() } else { format!("declare `{last}: {holder_table}` with `immutable {first}, {last}`, ") };
    let probe = format!("exists {holder_table}[.{last}, {field} = {other}]");
    Some(format!("a read rule reads no reference hop, so copy the reference that names the deciding row onto {table}: {declare}check it in the insert rule (`insert <- … and {check}`), then probe it: `read <- {}`{}{through}", replace(&probe), caveat(&[])))
}
