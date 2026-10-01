//! Receipt-template hygiene and author-site custody, before ordinary planning.
// @ref LLP 3000.022#14.1 — generated calls cannot capture application declarations.
use crate::{ast::*, diag::Site};

pub(super) fn expression_keyword(name: &str) -> bool {
    matches!(
        name,
        "viewer"
            | "now"
            | "commit"
            | "new"
            | "null"
            | "true"
            | "false"
            | "not"
            | "exists"
            | "created"
            | "walk"
            | "insert"
            | "update"
            | "upsert"
            | "delete"
            | "merge"
            | "device"
            | "oblivious"
            | "where"
            | "after"
            | "if"
            | "else"
            | "and"
            | "or"
    ) || name.contains('-')
}

pub(super) fn receipts(doc: &mut Document, clause: &ReceiptsDecl) {
    let fold = format!("$receipt:{}:fold", clause.name);
    doc.functions.last_mut().expect("receipt fold").name = fold.clone();
    let mut visit = |value: &mut Expr| {
        if let Expr::Call { name, .. } = value {
            *name = match name.as_str() {
                "receiptBuiltinSettled" => "$builtin:receiptSettled".into(),
                "receiptBuiltinFirst" => "$builtin:first".into(),
                "receiptBuiltinMax" => "$builtin:max".into(),
                "receiptBuiltinCount" => "$builtin:count".into(),
                "receiptBuiltinRange" => "$builtin:range".into(),
                "receiptPrivateFold" => fold.clone(),
                _ => panic!("unclassified receipt-template call: {name}"),
            };
        }
        if let Expr::Name { name, .. } = value {
            if name == "viewer" {
                *name = "$input:viewer".into();
            }
        }
        expression_site(value, &clause.site);
    };
    super::intent_walk::document(doc, &mut visit);
    for function in &mut doc.functions {
        function.site = clause.site.clone();
        for arg in &mut function.args {
            arg.site = clause.site.clone();
        }
        if let FunctionBody::Block(body) = &mut function.body {
            statement_sites(body, &clause.site);
        }
    }
    for program in &mut doc.programs {
        program.site = clause.site.clone();
        for arg in &mut program.args {
            arg.site = clause.site.clone();
        }
        if let Some(delivery) = &mut program.delivery {
            delivery.site = clause.site.clone();
        }
        statement_sites(&mut program.prelude, &clause.site);
        statement_sites(&mut program.body, &clause.site);
    }
    for table in &mut doc.tables {
        table.site = clause.site.clone();
        for column in &mut table.columns {
            column.site = clause.site.clone();
        }
        for index in &mut table.indexes {
            index.site = clause.site.clone();
        }
        for cap in &mut table.caps {
            cap.site = clause.site.clone();
        }
        if let Some(sync) = &mut table.sync {
            sync.site = clause.site.clone();
        }
        for rule in &mut table.rules {
            rule.site = clause.site.clone();
            super::intent_walk::expression(&mut rule.value, &mut |e| {
                expression_site(e, &clause.site)
            });
        }
    }
    doc.source = Default::default();
}

fn statement_sites(body: &mut [Stmt], target: &Site) {
    for statement in body {
        let site = match statement {
            Stmt::If {
                then_body,
                else_body,
                site,
                ..
            } => {
                statement_sites(then_body, target);
                statement_sites(else_body, target);
                site
            }
            Stmt::For { body, site, .. } => {
                statement_sites(body, target);
                site
            }
            Stmt::Bind { site, .. }
            | Stmt::Expr { site, .. }
            | Stmt::Require { site, .. }
            | Stmt::Return { site, .. }
            | Stmt::Emit { site, .. }
            | Stmt::Break { site }
            | Stmt::Continue { site } => site,
        };
        *site = target.clone();
    }
}

fn expression_site(value: &mut Expr, target: &Site) {
    let site = match value {
        Expr::Read(read) => {
            read_site(read, target);
            &mut read.site
        }
        Expr::Exists { read, site } | Expr::Created { read, site } => {
            read_site(read, target);
            site
        }
        Expr::Write {
            keys, fields, site, ..
        } => {
            for key in keys {
                key.site = target.clone();
            }
            for field in fields {
                field.site = target.clone();
            }
            site
        }
        Expr::Object { fields, site } => {
            for field in fields {
                field.site = target.clone();
            }
            site
        }
        Expr::Shape { fields, site, .. } => {
            for field in fields {
                let (ShapeField::Bare { site, .. }
                | ShapeField::Field { site, .. }
                | ShapeField::Spread { site }
                | ShapeField::NamedSpread { site, .. }) = field;
                *site = target.clone();
            }
            site
        }
        Expr::Merge(_) => unreachable!("receipt template has no merge"),
        Expr::Name { site, .. }
        | Expr::Focal { site }
        | Expr::Literal { site, .. }
        | Expr::Array { site, .. }
        | Expr::Unary { site, .. }
        | Expr::Binary { site, .. }
        | Expr::Member { site, .. }
        | Expr::Call { site, .. }
        | Expr::Assert { site, .. }
        | Expr::ShapeUse { site, .. }
        | Expr::Walk { site, .. }
        | Expr::If { site, .. } => site,
    };
    *site = target.clone();
}
fn read_site(read: &mut ReadExpr, target: &Site) {
    read.site = target.clone();
    for key in &mut read.keys {
        key.site = target.clone();
    }
    for seek in &mut read.seeks {
        seek.site = target.clone();
    }
    if let Some(range) = &mut read.range {
        range.site = target.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_receipt_expression_sites_belong_to_the_author_clause() {
        let source = include_str!("../../../snapback4/src/verbs/init/social/schema.q");
        let (doc, errors) = crate::parse_document("schema.q", source);
        assert!(errors.is_empty());
        let clause = doc.tables.iter().find_map(|t| t.receipts.clone()).unwrap();
        let mut docs = vec![doc];
        let mut errors = Vec::new();
        super::super::receipts::expand(&mut docs, &mut errors);
        assert!(errors.is_empty(), "{errors:?}");
        let doc = &mut docs[0];
        doc.programs.retain(|p| clause.operations.contains(&p.name));
        doc.functions
            .retain(|f| f.name == clause.operations[0] || f.name.starts_with("$receipt:"));
        let mut count = 0;
        super::super::intent_walk::document(doc, &mut |e| {
            assert_eq!(e.site(), &clause.site, "{e:?}");
            if let Expr::Read(read) | Expr::Exists { read, .. } = e {
                assert_eq!(read.site, clause.site);
                for key in &read.keys {
                    assert_eq!(key.site, clause.site);
                }
                for seek in &read.seeks {
                    assert_eq!(seek.site, clause.site);
                }
            }
            count += 1;
        });
        assert!(count > 300, "visited {count} expressions");
    }
}
