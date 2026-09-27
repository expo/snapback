//! Search completion classes, separate from numeric structural allowances.
use super::*;

#[derive(Debug, Serialize)]
pub(crate) struct Search {
    pub code: &'static str,
    pub site: String,
    pub class: &'static str,
    pub message: String,
    pub rewrite: String,
    pub guide: &'static str,
}

// @ref LLP 3000.024#6 — opening, inner expansion and returned decoration are
// independent cost axes. This certificate predicts no corpus-specific bytes.
pub(super) fn classify(schema: &Schema, program: &Program) -> Vec<Search> {
    use snapback4_core::search_plan;
    let mut out = Vec::new();
    let bindings = search_plan::bindings(schema, program);
    let merges = snapback4_lang::bind::merges(&program.body);
    let matching = |scan: &Scan| scan.prefix.iter().any(|key|matches!(key, IndexKeyExpr::WordPrefix(_)));
    for scan in snapback4_core::ir::scans(program).into_iter().filter(|scan|matching(scan)) {
        let uniform = snapback4_core::engine::rules::scan_visibility(schema, scan).uniform;
        let merge = merges.iter().find(|m|m.lanes.iter().any(|lane|std::ptr::eq(&lane.scan,scan)));
        if !uniform && !schema.operations.get(&program.name).is_some_and(|f|f.held)
            && let Some(rewrite) = search_plan::scoped(schema,scan,&bindings) {
            out.push(Search { code: "N_SEARCH_UNSCOPED", site: scan.site.clone(), class: "non-uniform",
                message: "unscoped search cannot establish server completeness or a safe continuation through hidden rows; retain the filters and add the membership predicate".into(),
                rewrite, guide: "search" });
        }
        // A bounded preview inside a pinned chat is already the recommended
        // repair. Do not diagnose it as a global opening or repeated roster.
        let global = scan.prefix.iter().all(|key|matches!(key,IndexKeyExpr::WordPrefix(_)));
        if (!uniform || global || merge.is_some()) && let Some(rewrite) = merge.and_then(|m|search_plan::grouped(schema,m,&bindings))
            .or_else(|| if merge.is_none() {search_plan::scoped(schema,scan,&bindings)} else {None}) {
            let legacy = merge.is_some_and(|m|!search_plan::eligible(schema,m));
            out.push(Search { code: "N_SEARCH_WORDS", site: scan.site.clone(), class: "inner-expansion",
                message: format!("first-term word expansion and further-term misses consume the meter; a longer first term reduces work; grouped reads bound each preview. {}",if legacy {
                    "This merge uses the existing evaluator: an opening cut can return an incomplete or heap-null page without next or E_SEARCH_OPEN."
                } else { "Compact server membership reads rescan words on refill and charge repeated work." }),
                rewrite, guide: "search" });
        }
    }
    for merge in &merges {
        if search_plan::eligible(schema,merge) && let Some(rewrite) = search_plan::grouped(schema,merge,&bindings) {
            out.push(Search { code: "N_SEARCH_OPEN", site: merge.site.clone(), class: "one-read-opening",
                message: "every authorized membership and head must be discovered in each server read before a globally ordered hit can be emitted; this compact plan refuses E_SEARCH_OPEN on an opening cut, without a continuation; reset the cursor when switching to grouped reads".into(),
                rewrite, guide: "search" });
        }
    }
    for (position, stmt) in program.body.iter().enumerate() {
        let Stmt::For { domain, body, .. } = stmt else { continue };
        let returned = matches!((body.last(), program.body.get(position + 1)),
            (Some(Stmt::Push { target, .. }), Some(Stmt::Return(Expr::Variable(name)))) if target == name);
        if !returned && !program.returned_shapes.contains_key(&format!("{}:{}", program.name, position + 1)) { continue; }
        let Some(message_table) = hit_domain(domain) else {continue};
        let mut rosters = BTreeSet::new();
        roster_tables(&schema.tables[message_table].rules.read, &mut rosters);
        let mut shape = program.clone();shape.body = body.clone();
        for scan in snapback4_core::ir::scans(&shape) {
            if scan.existence || scan.prefix.is_empty() || !rosters.contains(scan.table.as_str()) { continue; }
            let Some(index) = schema.tables.get(&scan.table).and_then(|table|table.index(&scan.index)) else { continue };
            if index.unique && scan.prefix.len() >= index.components.len() { continue; }
            let Some(rewrite) = merges.iter().find_map(|m|search_plan::bare(schema,m,&bindings)) else {continue};
            out.push(Search { code: "N_SEARCH_SHAPE", site: scan.site.clone(), class: "per-hit-group-decoration",
                message: format!("the returned message hit repeats the membership/roster subquery over {} per hit, including inside an inlined helper; read peer details separately once per distinct group", scan.table),
                rewrite, guide: "search" });
        }
    }
    out
}

fn roster_tables<'a>(rule: &'a snapback4_core::schema::RuleExpr, out: &mut BTreeSet<&'a str>) {
    use snapback4_core::schema::RuleExpr;
    match rule {
        RuleExpr::Exists {table,..}=>{out.insert(table);}
        RuleExpr::And(rs)|RuleExpr::Or(rs)=>for r in rs {roster_tables(r,out)},
        RuleExpr::Not(r)=>roster_tables(r,out),
        _=>{},
    }
}

fn hit_domain(domain: &LoopDomain) -> Option<&str> {
    fn hit(e: &Expr) -> Option<&str> {
        match e {
            Expr::Scan(s) if s.prefix.iter().any(|k|matches!(k,IndexKeyExpr::WordPrefix(_)))=>Some(&s.table),
            Expr::Merge(m) if m.lanes.iter().any(|l|l.scan.prefix.iter().any(|k|matches!(k,IndexKeyExpr::WordPrefix(_))))=>Some(m.table()),
            Expr::Block {body,value}=>hit(value).or_else(||statements(body)),
            _=>None,
        }
    }
    fn statements(body: &[Stmt]) -> Option<&str> {
        body.iter().find_map(|s|match s {
            Stmt::Let {value,..}|Stmt::Assign {value,..}|Stmt::Const {value,..}|Stmt::Return(value)=>hit(value),
            Stmt::If {then_body,else_body,..}=>statements(then_body).or_else(||statements(else_body)),
            _=>None,
        })
    }
    match domain {
        LoopDomain::Page(s) if s.prefix.iter().any(|k|matches!(k,IndexKeyExpr::WordPrefix(_)))=>Some(&s.table),
        LoopDomain::DerivedArray {value,..}=>hit(value),
        _=>None,
    }
}

#[cfg(test)]
#[path = "search_tests.rs"]
mod tests;
