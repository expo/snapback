//! Membership-gated range certificate bounds, shared with the evaluator twin.
use super::*;

pub(super) fn add_visibility_cases(cases: &mut Vec<CorpusCase>) {
    for (name, field, hoist, examined) in [
        ("hoisted-list-certifies-reserve", "conversationId", true, 52),
        (
            "nonuniform-list-certifies-ceiling",
            "authorId",
            false,
            10_240,
        ),
    ] {
        let mut schema = Schema::default();
        schema.tables.insert(
            "memberships".to_owned(),
            public_table(
                columns([
                    ("id", ColumnType::Id),
                    ("conversationId", ColumnType::Id),
                    ("viewer", ColumnType::Principal),
                ]),
                indexes([
                    ("byId", &["id"], true),
                    ("byConvViewer", &["conversationId", "viewer"], true),
                ]),
            ),
        );
        let mut messages = public_table(
            columns([
                ("id", ColumnType::Id),
                ("conversationId", ColumnType::Id),
                ("authorId", ColumnType::Id),
                ("at", ColumnType::Time),
            ]),
            indexes([
                ("byId", &["id"], true),
                ("byConvTime", &["conversationId", "at", "id"], false),
            ]),
        );
        messages.rules.read = RuleExpr::Exists {
            table: "memberships".to_owned(),
            index: "byConvViewer".to_owned(),
            key: vec![RuleTerm::Field(field.to_owned()), RuleTerm::Viewer],
            provenance: KeyProvenance::Shape,
        };
        schema.tables.insert("messages".to_owned(), messages);
        let program = pure_program(
            name,
            Expr::Scan(Scan {
                site: "messages.list".to_owned(),
                table: "messages".to_owned(),
                index: "byConvTime".to_owned(),
                prefix: vec![Expr::Literal(id("c1"))],
                order: Order::Desc,
                take: Bound::Literal(50),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }),
            &BTreeMap::new(),
        );
        let case = case_from_parts(
            name,
            "scenario",
            schema,
            program,
            query_context([]),
            ClosureReceipt::default(),
            Vec::new(),
            None,
            None,
        );
        let certificate = case.certificate.as_ref().expect("visibility certificate");
        assert_eq!(certificate.max_examined, examined, "{name}");
        assert_eq!(certificate.max_index_entries, examined, "{name}");
        assert_eq!(certificate.read_sites[0].hoist, hoist, "{name}");
        assert_eq!(certificate.max_rule_probes, if hoist { 1 } else { 10_240 });
        assert_eq!(certificate.max_steps, if hoist { 263 } else { 51_203 });
        cases.push(case);
    }
}

fn columns<const N: usize>(columns: [(&str, ColumnType); N]) -> BTreeMap<String, ColumnType> {
    columns
        .into_iter()
        .map(|(name, kind)| (name.to_owned(), kind))
        .collect()
}

fn indexes<const N: usize>(indexes: [(&str, &[&str], bool); N]) -> BTreeMap<String, Index> {
    indexes
        .into_iter()
        .map(|(name, columns, unique)| {
            (
                name.to_owned(),
                Index {
                    columns: columns.iter().map(|name| (*name).to_owned()).collect(),
                    unique,
                },
            )
        })
        .collect()
}
