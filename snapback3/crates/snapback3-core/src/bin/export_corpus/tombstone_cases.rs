//! A log table carrying `tombstones messages[.messageId] if .kind = 'removed'
//! or .kind = 'expired'`: the corpus golden that binds the evaluator's
//! canonical schema form to Rust's `Schema::hash()` once the word is present
//! (LLP 1012 §5 rule 3).
use super::*;

pub(super) fn add_tombstone_case(cases: &mut Vec<CorpusCase>) {
    let mut schema = Schema::default();
    schema.tables.insert(
        "messages".to_owned(),
        public_table(
            columns([
                ("id", ColumnType::Id),
                ("body", ColumnType::Text { max: 256 }),
            ]),
            indexes([("byId", &["id"], true)]),
        ),
    );
    let mut deliveries = public_table(
        columns([
            ("id", ColumnType::Id),
            (
                "messageId",
                ColumnType::Ref {
                    table: "messages".to_owned(),
                },
            ),
            (
                "kind",
                ColumnType::Enum {
                    variants: ["message", "edit", "removed", "expired"]
                        .map(str::to_owned)
                        .to_vec(),
                },
            ),
            ("at", ColumnType::Time),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byMessageAt", &["messageId", "at", "id"], false),
        ]),
    );
    let kind_is = |value: &str| {
        RuleExpr::Eq(
            RuleTerm::Field("kind".to_owned()),
            RuleTerm::Literal(Value::String(value.to_owned())),
        )
    };
    deliveries.tombstones = vec![Tombstone {
        table: "messages".to_owned(),
        column: "messageId".to_owned(),
        when: RuleExpr::Or(vec![kind_is("removed"), kind_is("expired")]),
    }];
    schema.tables.insert("deliveries".to_owned(), deliveries);
    let name = "tombstones-log-schema-identity";
    let program = pure_program(
        name,
        Expr::Scan(Scan {
            site: "deliveries.forMessage".to_owned(),
            table: "deliveries".to_owned(),
            index: "byMessageAt".to_owned(),
            prefix: vec![IndexKeyExpr::Scalar(Expr::Literal(id("m1")))],
            order: Order::Asc,
            take: Bound::Literal(10),
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
    let certificate = case.certificate.as_ref().expect("tombstone certificate");
    assert_eq!(certificate.schema_hash, case.schema.hash(), "{name}");
    cases.push(case);
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
                    components: columns
                        .iter()
                        .map(|column| IndexComponent::Column((*column).to_owned()))
                        .collect(),
                    unique,
                },
            )
        })
        .collect()
}
