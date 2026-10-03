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
    #[cfg(feature = "sqlite")]
    #[test]
    fn proof_allowance_cannot_reveal_a_masked_cells_presence() {
        let (schema, programs) = fixture();
        let program = programs.iter().find(|p| p.name == "point").unwrap();
        let mut store = crate::store::Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        let mut observations = vec![];
        for photo in [Value::Null, crate::value::object([("id", Value::Id("unavailable".into()))])] {
            let mut data = crate::value::object([("id", Value::Id("a".into())), ("photo", photo), ("photos", Value::Null)]);
            let mut meter = crate::meter::Meter::new(Default::default(), crate::meter::Cut::Cap);
            authorize(&tx, &schema, program, "alice", &mut data, &mut meter);
            observations.push((data, meter.used, meter.heap_peak));
        }
        assert_eq!(observations[0], observations[1], "null and an unavailable handle must leave the same allowance for later cells");
        assert_eq!(observations[0].1.examined, 10, "prepay all five declared slots, including null cells");
    }
}

#[cfg(feature = "sqlite")]
pub fn authorize(tx: &crate::store::Tx<'_>, schema: &Schema, program: &Program,
    viewer: &str, data: &mut Value, meter: &mut crate::meter::Meter) {
    let Some(plan) = plan(schema, program) else { return };
    // The ordinary query already proved the row and its lifetime in THIS
    // transaction. Only the private home/view ledger remains to be checked.
    fn cell(tx: &crate::store::Tx<'_>, value: &Value, viewer: &str, table: &str, row: &str, column: &str) -> bool {
        match value {
            Value::Null => true,
            Value::Array(values) => values.iter().all(|v| cell(tx, v, viewer, table, row, column)),
            _ => crate::assets::asset_id(Some(value)).is_some_and(|id| {
                tx.asset(id).ok().flatten().is_some_and(|asset| asset.released_at.is_none()
                    && asset.home.as_ref().is_some_and(|(t, r, c)| t == table && r == row && c == column))
                    && tx.asset_viewed(id, viewer).is_ok_and(|viewed| !viewed)
            }),
        }
    }
    fn slots(kind: &crate::schema::ColumnType) -> u64 { use crate::schema::ColumnType::*; match kind {
        Optional(t) => slots(t), List { of, max } => slots(of).saturating_mul(u64::from(*max)), _ => 1,
    } }
    // Prepay all declared cells before inspecting any value, including null or
    // absent cells. Otherwise a masked earlier value could change whether a
    // later cell fits and thereby disclose its presence through restoration.
    let rows = match data { Value::Array(rows) if plan.many => rows.len() as u64,
        Value::Row(_) | Value::Map(_) if !plan.many => 1, _ => 0 };
    let n = plan.columns.iter().fold(0u64, |n, c| n.saturating_add(slots(&schema.tables[&plan.table].columns[c]))).saturating_mul(rows);
    use crate::error::MeterKind;
    let charges = [(MeterKind::Examined, n.saturating_mul(2)), (MeterKind::Steps, n.saturating_mul(4)), (MeterKind::HeapBytes, n.saturating_mul(16_384))];
    if !charges.iter().all(|(kind, amount)| meter.room(*kind, *amount)) { plan.mask(data, |_, _, _| false); return; }
    for (kind, amount) in charges { if meter.charge(kind, amount).is_err() { plan.mask(data, |_, _, _| false); return; } }
    plan.mask(data, |row, column, value| row.and_then(|r| r.as_str().ok())
        .is_some_and(|row| cell(tx, value, viewer, &plan.table, row, column)));
    meter.used.heap_bytes = meter.used.heap_bytes.saturating_sub(n.saturating_mul(16_384));
}
