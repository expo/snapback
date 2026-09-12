//! Native exact trie and ordered postings, private to the source transaction.
// @ref LLP 1001#unicode-search-foundation — handles never enter logical keys or receipts.
use super::{
    RuntimeError,
    index::{encode_index_value, index_values},
};
use crate::unicode::{self, SearchNormalizer};
use crate::{
    Value,
    schema::{ColumnType, Index, IndexComponent, Schema, Table},
};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Derivation {
    pub steps: u64,
    pub scratch: u64,
}
impl Derivation {
    pub fn add(&mut self, other: Self) {
        self.steps = self.steps.saturating_add(other.steps);
        self.scratch = self.scratch.max(other.scratch);
    }
}
fn input(e: unicode::SearchInputError) -> RuntimeError {
    RuntimeError::Input(e.to_string())
}

pub(crate) fn create(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS _search_nodes (
        node INTEGER PRIMARY KEY, table_name TEXT NOT NULL, index_name TEXT NOT NULL,
        parent INTEGER NOT NULL, scalar INTEGER NOT NULL, refs INTEGER NOT NULL, depth INTEGER NOT NULL,
        UNIQUE(table_name,index_name,parent,scalar));
        CREATE TABLE IF NOT EXISTS _search_postings (
        table_name TEXT NOT NULL, index_name TEXT NOT NULL, row_id TEXT NOT NULL, node INTEGER NOT NULL,
        c0 TEXT,c1 TEXT,c2 TEXT,c3 TEXT,c4 TEXT,c5 TEXT,c6 TEXT,c7 TEXT,
        PRIMARY KEY(table_name,index_name,row_id,node)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS _search_postings_lookup ON _search_postings(
        table_name,index_name,c0,c1,c2,c3,c4,c5,c6,c7,row_id,node);
        CREATE INDEX IF NOT EXISTS _search_postings_by_row ON _search_postings(table_name,row_id,index_name,node);")?;
    Ok(())
}

pub(crate) fn resolve(
    c: &Connection,
    table: &str,
    index: &str,
    token: Option<&str>,
) -> Result<Option<i64>, RuntimeError> {
    let Some(token) = token.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let mut node = 0;
    let mut stmt = c.prepare_cached("SELECT node FROM _search_nodes WHERE table_name=?1 AND index_name=?2 AND parent=?3 AND scalar=?4")?;
    for scalar in token.chars() {
        let next = stmt
            .query_row(params![table, index, node, scalar as u32], |r| r.get(0))
            .optional()?;
        let Some(next) = next else {
            return Ok(None);
        };
        node = next;
    }
    Ok(Some(node))
}

/// Enumerate reverse membership, without re-tokenizing any old text image.
pub(crate) fn remove(c: &Connection, table: &str, id: &str) -> Result<Derivation, RuntimeError> {
    let mut stmt = c.prepare_cached("SELECT p.node,n.depth,p.index_name FROM _search_postings p INDEXED BY _search_postings_by_row JOIN _search_nodes n ON n.node=p.node WHERE p.table_name=?1 AND p.row_id=?2 ORDER BY n.depth DESC")?;
    let nodes = stmt
        .query_map(params![table, id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut meter = Derivation {
        steps: nodes.len() as u64,
        scratch: nodes.capacity() as u64 * 40
            + nodes
                .iter()
                .map(|(_, _, name)| name.capacity() as u64)
                .sum::<u64>(),
    };
    for (node, _, index) in nodes {
        // posting primary + two secondary changes; one reference change.
        c.prepare_cached("DELETE FROM _search_postings WHERE table_name=?1 AND index_name=?2 AND row_id=?3 AND node=?4")?.execute(params![table,index,id,node])?;
        c.prepare_cached("UPDATE _search_nodes SET refs=refs-1 WHERE node=?1")?
            .execute([node])?;
        meter.steps += 4;
        let deleted = c
            .prepare_cached("DELETE FROM _search_nodes WHERE node=?1 AND refs=0")?
            .execute([node])?;
        meter.steps += 1 + 2 * deleted as u64; // zero-ref probe and both node indexes
    }
    Ok(meter)
}

pub(crate) fn insert(
    c: &Connection,
    schema: &Schema,
    table_name: &str,
    row: &Value,
) -> Result<Derivation, RuntimeError> {
    let table = &schema.tables[table_name];
    let id = row.field("id")?.as_str()?;
    let mut meter = Derivation::default();
    let mut normalizer = SearchNormalizer::default();
    for (index_name, index) in &table.indexes {
        let Some(offset) = index.derived_offset() else {
            continue;
        };
        let IndexComponent::WordPrefixes { fields, .. } = &index.components[offset] else {
            unreachable!()
        };
        let mut seen = BTreeSet::<i64>::new();
        let mut encoded: Vec<Option<String>> = index_values(row, index)
            .iter()
            .map(|v| encode_index_value(v).map(Some))
            .collect::<Result<_, _>>()?;
        encoded.resize(8, None);
        for field in fields {
            let value = row.field(field).unwrap_or(&Value::Null);
            if value == &Value::Null {
                continue;
            }
            let source = value.as_str()?;
            let n =
                unicode::validate_search_source(source, field_max(table, field)).map_err(input)?;
            let (text, stats) = normalizer.normalize(source, n).map_err(input)?;
            meter.steps +=
                (unicode::normalization_steps(&stats) + 2 * n + stats.output_scalars) as u64;
            for word in text
                .split(unicode::is_search_boundary)
                .filter(|s| !s.is_empty())
            {
                let mut parent = 0i64;
                for (depth, scalar) in word.chars().enumerate() {
                    let node = c.prepare_cached("SELECT node FROM _search_nodes WHERE table_name=?1 AND index_name=?2 AND parent=?3 AND scalar=?4")?
                        .query_row(params![table_name,index_name,parent,scalar as u32], |r| r.get::<_,i64>(0)).optional()?;
                    meter.steps += 2; // dictionary probe + distinct-membership set probe
                    let node = match node {
                        Some(node) => node,
                        None => {
                            c.prepare_cached("INSERT INTO _search_nodes(table_name,index_name,parent,scalar,refs,depth) VALUES (?1,?2,?3,?4,0,?5)")?
                                .execute(params![table_name,index_name,parent,scalar as u32,depth+1])?;
                            meter.steps += 2;
                            c.last_insert_rowid()
                        }
                    };
                    parent = node;
                    if !seen.insert(node) {
                        continue;
                    }
                    encoded[offset] = Some(encode_index_value(&Value::Int(node))?);
                    c.prepare_cached("INSERT INTO _search_postings(table_name,index_name,row_id,node,c0,c1,c2,c3,c4,c5,c6,c7) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")?
                        .execute(params![table_name,index_name,id,node,encoded[0],encoded[1],encoded[2],encoded[3],encoded[4],encoded[5],encoded[6],encoded[7]])?;
                    c.prepare_cached("UPDATE _search_nodes SET refs=refs+1 WHERE node=?1")?
                        .execute([node])?;
                    meter.steps += 4;
                }
            }
            // Normalizer capacity, source + normalized text, tree membership cells,
            // encoded scope/suffix buffers and one statement/journal row. Sequential fields reuse scratch.
            let live = stats.scratch_bytes
                + source.len()
                + text.capacity()
                + seen.len() * 40
                + encoded
                    .iter()
                    .flatten()
                    .map(|s| s.capacity() + 24)
                    .sum::<usize>()
                + 1024;
            meter.scratch = meter.scratch.max(live as u64);
        }
    }
    Ok(meter)
}

pub(crate) fn field_max(table: &Table, name: &str) -> usize {
    match &table.columns[name] {
        ColumnType::Text { max } => *max as usize,
        ColumnType::Optional(inner) => match inner.as_ref() {
            ColumnType::Text { max } => *max as usize,
            _ => unreachable!("certified text"),
        },
        _ => unreachable!("certified text"),
    }
}

/// Same pass and physical-mutation ledger as insert/remove. Does not count application writes.
pub(crate) fn write_bound(
    schema: &Schema,
    table_name: &str,
    table: &Table,
    index: &Index,
    insert: bool,
    remove: bool,
) -> Derivation {
    let Some(offset) = index.derived_offset() else {
        return Derivation::default();
    };
    let IndexComponent::WordPrefixes { fields, .. } = &index.components[offset] else {
        unreachable!()
    };
    let total: usize = fields.iter().map(|f| field_max(table, f)).sum();
    let u = (total as u64).saturating_mul(4);
    let mut steps = if remove { u.saturating_mul(8) } else { 0 };
    if insert {
        for f in fields {
            let n = field_max(table, f);
            steps = steps
                .saturating_add(unicode::normalization_step_bound(n).unwrap_or(usize::MAX) as u64)
                .saturating_add(6 * n as u64);
        }
        steps = steps.saturating_add(u.saturating_mul(8));
    }
    let max_n = fields
        .iter()
        .map(|f| field_max(table, f))
        .max()
        .unwrap_or(0);
    let scalar_buffers = index
        .components
        .iter()
        .filter_map(IndexComponent::column)
        .map(|name| {
            crate::bounds::declared_column_value_max(schema, table_name, name)
                .unwrap_or(0)
                .saturating_mul(2)
                .saturating_add(24)
        })
        .fold(0u64, u64::saturating_add);
    Derivation {
        steps,
        scratch: (unicode::normalization_scratch_bytes(max_n).unwrap_or(usize::MAX) as u64)
            .saturating_add(20 * max_n as u64)
            .saturating_add(
                u.saturating_mul(
                    40 + table
                        .indexes
                        .keys()
                        .map(|n| n.len() as u64)
                        .max()
                        .unwrap_or(0),
                ),
            )
            .saturating_add(scalar_buffers)
            .saturating_add(1024),
    }
}

pub(crate) fn table_write_bound(
    schema: &Schema,
    table_name: &str,
    table: &Table,
    insert: bool,
    remove: bool,
) -> Derivation {
    let mut out = Derivation::default();
    let mut reverse = 0u64;
    for (name, index) in &table.indexes {
        out.add(write_bound(
            schema, table_name, table, index, insert, remove,
        ));
        if let Some(offset) = index.derived_offset() {
            if let IndexComponent::WordPrefixes { fields, .. } = &index.components[offset] {
                reverse = reverse.saturating_add(
                    fields
                        .iter()
                        .map(|f| field_max(table, f) as u64)
                        .sum::<u64>()
                        .saturating_mul(4)
                        .saturating_mul(80 + name.len() as u64),
                );
            }
        }
    }
    if remove {
        out.scratch = out.scratch.max(reverse);
    }
    out
}
