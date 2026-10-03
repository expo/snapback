//! A deliberately small proof: a bare point/page cannot derive membership,
//! ordering, cursors or other fields from a masked once cell.
// @ref LLP 3000.023#12 — conditional preservation masks whole declared cells.
use crate::{ir::{Expr, Input, Program, Stmt}, schema::Schema, value::Value};

#[derive(Clone, serde::Serialize)]
pub struct OnceRead { pub table: String, pub columns: Vec<String>, pub many: bool }

pub fn plan(schema: &Schema, program: &Program) -> Option<OnceRead> {
    if program.native { return None; }
    fn input(e: &Expr) -> bool { matches!(e, Expr::Literal(_) | Expr::Variable(_) | Expr::Input(Input::Viewer)) }
    let (name, index, many) = match program.body.as_slice() {
        [Stmt::Return(Expr::Get(r))] if r.key.iter().all(input) => (&r.table, &r.index, false),
        [Stmt::Return(Expr::Scan(s))] if s.filter.is_none() && s.range.is_none() && !s.existence
            && s.prefix.iter().all(|p| p.scalar().is_some_and(input))
            && s.after.iter().chain(s.before.iter()).all(|e| input(e)) => (&s.table, &s.index, true),
        _ => return None,
    };
    let table = schema.table(name)?;
    let columns: Vec<_> = table.columns.iter().filter(|(_, ty)| crate::revocation::once(ty)).map(|(c, _)| c.clone()).collect();
    if columns.is_empty() || columns.len() > 256 || name.len() > 120 || columns.iter().any(|c| c.len() > 128)
        || table.index(index)?.columns().iter().any(|c| columns.contains(c)) { return None; }
    Some(OnceRead { table: name.clone(), columns, many })
}

impl OnceRead {
    /// Whole-cell null makes null, scalar and nested-list shapes indistinguishable.
    /// Missing (privately undisclosed) columns remain missing.
    pub fn mask(&self, data: &mut Value, mut proven: impl FnMut(Option<&Value>, &str, &Value) -> bool) {
        fn row(plan: &OnceRead, row: &mut Value, proven: &mut impl FnMut(Option<&Value>, &str, &Value) -> bool) {
            if let Value::Row(fields) | Value::Map(fields) = row {
                for column in &plan.columns {
                    if fields.get(column).is_some_and(|cell| *cell != Value::Null && !proven(fields.get("id"), column, cell)) {
                        fields.insert(column.clone(), Value::Null);
                    }
                }
            }
        }
        if self.many { if let Value::Array(rows) = data { for value in rows { row(self, value, &mut proven); } } }
        else { row(self, data, &mut proven); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Schema, Vec<Program>) {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table docs:\n  photo: image <=10000 once ?\n  photos: [[image <=10000 once] <=2] <=2\n  body: text\n  public\n  sync public\nquery page(c: cursor?):\n  return docs[] first 10 by byId after c\nquery point(id: docs):\n  return docs[id]\nquery derived():\n  row = docs['a']\n  return row.body if row.photo != null else null\nquery filtered():\n  return docs[] where .photo != null first 10 by byId\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let types = snapback4_lang::emit::typescript(&bound);
        let fields: Vec<_> = types.lines().filter(|line| line.trim_start().starts_with("photos:")).collect();
        assert!(!fields.is_empty() && fields.iter().all(|line| line.ends_with(" | null;")), "required list cells have a typed null placeholder");
        (crate::json_codec::from_text(&serde_json::to_string(&bound.schema).unwrap()).unwrap(),
         bound.programs.iter().map(|p| crate::json_codec::from_text(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect())
    }
    #[test]
    fn only_bare_rows_have_a_mask_proof() {
        let (schema, programs) = fixture();
        for program in programs {
            assert_eq!(plan(&schema, &program).is_some(), ["page", "point"].contains(&program.name.as_str()), "{}", program.name);
        }
        let preserved = crate::revocation::Footprint::default().preserved(&schema);
        assert!(preserved.contains(&"~once:docs".into()));
        assert!(!preserved.contains(&"docs".into()), "old clients must never accept conditional authority");
        let mut collision = schema;
        let mut plain = collision.tables["docs"].clone();
        plain.columns.retain(|_, kind| !crate::revocation::once(kind));
        collision.tables.insert("~once:docs".into(), plain);
        let mut footprint = crate::revocation::Footprint::default();
        footprint.tables.insert("docs".into(), crate::revocation::Change { deleted: true, ..Default::default() });
        assert!(!footprint.preserved(&collision).contains(&"~once:docs".into()));
    }
    #[test]
    fn whole_cell_mask_erases_nested_length_and_handles_without_touching_rows() {
        let (schema, programs) = fixture();
        let plan = plan(&schema, &programs.into_iter().find(|p| p.name == "point").unwrap()).unwrap();
        let mut results = vec![];
        for value in [Value::Null, Value::Array(vec![]), Value::Array(vec![Value::Array(vec![crate::value::object([("id", Value::Id("secret".into()))])])])] {
            let mut data = crate::value::object([("id", Value::Id("a".into())), ("body", Value::String("public".into())), ("photo", value.clone()), ("photos", value)]);
            plan.mask(&mut data, |_, _, _| false);
            results.push(data);
        }
        assert!(results.windows(2).all(|pair| pair[0] == pair[1]));
    }
}

/// Bound private proof work by declarations, independently of the caller's
/// already-used heap. Each row pays every slot, including null/absent cells.
pub const PROOF_SLOTS: u64 = 65_536;
pub fn slots(kind: &crate::schema::ColumnType) -> u64 { use crate::schema::ColumnType::*; match kind {
    Optional(t) => slots(t), List { of, max } => slots(of).saturating_mul(u64::from(*max)), _ => 1,
} }
pub fn cell(value: &Value, mut leaf: impl FnMut(&str) -> bool) -> bool {
    fn walk(value: &Value, leaf: &mut impl FnMut(&str) -> bool) -> bool {
        match value {
            Value::Null => true,
            Value::Array(values) => values.iter().all(|v| walk(v, leaf)),
            _ => crate::assets::asset_id(Some(value)).is_some_and(leaf),
        }
    }
    walk(value, &mut leaf)
}

/// Whether a query's evaluated dependencies include once cells. This is a
/// disclosure fence, never permission to retain a computed answer.
pub fn sensitive(schema: &Schema, tables: &[String]) -> bool {
    tables.iter().any(|name| schema.table(name).is_some_and(|table| table.columns.values().any(crate::revocation::once)))
}
