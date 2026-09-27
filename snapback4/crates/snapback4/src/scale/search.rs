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
    let mut out = Vec::new();
    let matching = |scan: &Scan| scan.prefix.iter().any(|key|matches!(key, IndexKeyExpr::WordPrefix(_)));
    for scan in snapback4_core::ir::scans(program).into_iter().filter(|scan|matching(scan)) {
        let uniform = snapback4_core::engine::rules::scan_visibility(schema, scan).uniform;
        if !uniform && !schema.operations.get(&program.name).is_some_and(|f|f.held) {
            let rule = schema.tables[&scan.table].rules.read.quarry();
            out.push(Search { code: "N_SEARCH_UNSCOPED", site: scan.site.clone(), class: "non-uniform",
                message: "unscoped search cannot establish server completeness or a safe continuation through hidden rows".into(),
                rewrite: format!("{} matching q where {rule} last {} by .at after c; preserve the original filters (for example `not .tombstone`)", scan.table, scan.take.maximum()), guide: "search" });
        }
        out.push(Search { code: "N_SEARCH_WORDS", site: scan.site.clone(), class: "inner-expansion",
            message: "first-term word expansion and further-term misses consume the meter; compact membership search rescans words on each refill and charges repeated work".into(),
            rewrite: "use a longer first term (`matching 'coffee'` instead of `matching 'co'`); for membership search, pin one authorized chat before `matching q`; neither proves arbitrary expansion fits".into(), guide: "search" });
    }
    for merge in snapback4_lang::bind::merges(&program.body) {
        if merge.lanes.iter().any(|lane|lane.source.as_ref().and_then(LaneSource::scan).is_some() && matching(&lane.scan)) {
            out.push(Search { code: "N_SEARCH_OPEN", site: merge.site.clone(), class: "one-read-opening",
                message: "every authorized membership and head must be discovered in each read before a globally newest hit can be emitted; the compact membership form refuses E_SEARCH_OPEN on an opening cut, without a continuation".into(),
                rewrite: "use the grouped form in `snapback4 guide search`: page members[principal = viewer] after c with an exists(messages[conversation = .conversation] matching q) filter and a bounded hits preview".into(), guide: "search" });
        }
    }
    if !out.is_empty() {
        for (position, stmt) in program.body.iter().enumerate() {
            let Stmt::For { body, .. } = stmt else { continue };
            let returned = matches!((body.last(), program.body.get(position + 1)),
                (Some(Stmt::Push { target, .. }), Some(Stmt::Return(Expr::Variable(name)))) if target == name);
            if !returned && !program.returned_shapes.contains_key(&format!("{}:{}", program.name, position + 1)) { continue; }
            let mut shape = program.clone();
            shape.body = body.clone();
            for scan in snapback4_core::ir::scans(&shape) {
                if scan.existence || scan.prefix.is_empty() { continue; }
                let Some(index) = schema.tables.get(&scan.table).and_then(|table|table.index(&scan.index)) else { continue };
                if index.unique && scan.prefix.len() >= index.components.len() { continue; }
                out.push(Search { code: "N_SEARCH_SHAPE", site: scan.site.clone(), class: "per-hit-group-decoration",
                    message: format!("the returned hit shape repeats the group subquery over {} per hit, including when an inlined helper performs it; a group roster can dominate heap and output", scan.table),
                    rewrite: "return a bare hit page, then read chat/peer details separately once per distinct conversation; remove `peers: searchPeers(.conversation)` from the hit shape".into(), guide: "search" });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_search_cost_axes_include_inlined_peer_helpers() {
        let source = r#"
table members:
  conversation: id
  principal: principal
  unique conversation, principal
  read <- exists members[.conversation, viewer]
table messages:
  conversation: id
  text: text <=4000
  tombstone: bool
  at: time
  search text
  read <- exists members[.conversation, viewer]
fn searchPeers(chat: id):
  return members[conversation = chat] first 50 by .id
query original(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c
query bare(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.conversation, viewer] last 20 by .at after c
query decorated(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.conversation, viewer] last 20 by .at after c { *, peers: searchPeers(.conversation) }
"#;
        let b = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        for p in &b.programs {
            let c = classify(&b.schema,&p.program);
            let codes: BTreeSet<_> = c.iter().map(|s|s.code).collect();
            assert!(codes.contains("N_SEARCH_WORDS"));
            assert_eq!(codes.contains("N_SEARCH_UNSCOPED"),p.program.name == "original");
            assert_eq!(codes.contains("N_SEARCH_OPEN"),p.program.name != "original");
            assert_eq!(codes.contains("N_SEARCH_SHAPE"),p.program.name == "decorated", "{}", serde_json::to_string_pretty(&p.program).unwrap());
            assert!(c.iter().all(|s|!s.site.is_empty() && !s.rewrite.is_empty()));
        }
    }
}
