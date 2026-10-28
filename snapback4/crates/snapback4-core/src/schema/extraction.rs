//! Typed one-child extraction; home transfer is an activation operation.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — an asset is moved with its one home.
use super::*;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Extraction {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub each: bool,
    pub child: String,
    pub parent: String,
    pub reference: String,
    pub fields: BTreeMap<String, String>,
}
impl Extraction {
    /// Compiler-generated guarded-view identity cell; no payload duplication.
    pub fn result_column(&self)->String{format!("rollbackParent_{}",self.child)}
    /// Exact protected metadata contract; business column gates never acquire this exemption.
    pub fn has_result_anchor(&self,child:&Table)->bool{
        let column=self.result_column();
        !self.each &&child.columns.get(&column)==Some(&ColumnType::Optional(Box::new(ColumnType::Ref{table:self.parent.clone()})))
            &&child.column_writes.get(&column)==Some(&RuleExpr::Deny)
            &&child.on_delete.get(&column).is_none_or(|action|*action==references::OnDelete::Keep)
            &&child.constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields}if fields.contains(&column)))
            &&child.indexes.values().any(|i|i.unique&&i.is_plain()&&i.columns()==vec![column.clone()])
    }
    /// Closed payload-domain inclusion, shared by forward admission and reverse-source proof.
    // @ref LLP 3000.000.000#22-wave-29-release-identity-rel2 — inclusion of collection bounds never invents or coerces a value.
    pub fn payload_accepts(source: &ColumnType, destination: &ColumnType) -> bool {
        if source == destination { return true; }
        if let ColumnType::Optional(inner) = destination {
            return Self::payload_accepts(match source { ColumnType::Optional(kind) => kind, kind => kind }, inner);
        }
        fn bounds(kind: &ColumnType) -> Option<(&ColumnType,u32,u32)> { match kind {
            ColumnType::List { of, max } => Some((of.as_ref(), 0, *max)),
            ColumnType::ListRange { of, min, max } => Some((of.as_ref(), *min, *max)),
            _ => None,
        }}
        match (bounds(source), bounds(destination)) {
            (Some((a, amin, amax)), Some((b, bmin, bmax))) => a == b && bmin <= amin && amax <= bmax,
            _ => false,
        }
    }

    pub fn admit(&self, schema: &Schema) -> Result<(), String> {
        if schema.extractions.iter().filter(|e|e.child==self.child).count()>1 {
            return Err("one extraction declaration owns each child table; native children cannot be assigned to competing sources".into());
        }
        let child = schema
            .table(&self.child)
            .ok_or("extraction child is not declared")?;
        if self.child == self.parent
            || schema.table(&self.parent).is_none()
            || child.ephemeral.is_some()
            || schema.maintain_for(&self.child).is_some()
        {
            return Err("extraction needs distinct authoritative durable parent and child tables without captured ownership".into());
        }
        if child.columns.get(&self.reference)
            != Some(&ColumnType::Ref {
                table: self.parent.clone(),
            })
        {
            return Err("extraction needs a required reference to its parent".into());
        }
        if !matches!(
            child.on_delete.get(&self.reference),
            Some(references::OnDelete::Cascade | references::OnDelete::Restrict)
        ) {
            return Err("reversible extraction requires on delete cascade or restrict; kept references cannot prove the parent lifetime".into());
        }
        if self.fields.is_empty()
            || self.fields.contains_key(&self.reference)
            || self.fields.keys().any(|c| {
                !child.columns.contains_key(c)
                    || c == "id"
                    || child.engine_field(c)
                    || child.maintained.contains_key(c)
                    || child.sequences.contains_key(c)
                    || child.written_by.contains_key(c)
            })
        {
            return Err("extraction fields must be distinct authoritative child columns".into());
        }
        if self.each {
            let assets:Vec<_>=self.fields.keys().filter(|c|asset(&child.columns[*c])).collect();
            if assets.len()!=1 || !matches!(child.columns[assets[0]],ColumnType::Image{..}|ColumnType::File{..}|ColumnType::Video{..}) {
                return Err("extract each requires exactly one required scalar image/file/video destination; map its historical bounded list".into());
            }
        }
        if !self.fields.keys().any(|c| asset(&child.columns[c])) {
            return Err("extract is asset-only: map at least one image/file/video column; for a scalar split use a named backfill/down and an authored child-writing mutation (guide evolution)".into());
        }
        if child.columns.iter().any(|(c, k)| {
            c != &self.reference
                && c != "id"
                && !self.fields.contains_key(c)
                && !k.is_optional()
                && !child.defaults.contains_key(c)
                && !child.engine_field(c)
        }) {
            return Err("map every required child column or give it an explicit default".into());
        }
        Ok(())
    }
}
pub(super) fn asset(k: &ColumnType) -> bool {
    match k {
        ColumnType::Optional(k)
        | ColumnType::List { of: k, .. }
        | ColumnType::ListRange { of: k, .. } => asset(k),
        ColumnType::Image { .. } | ColumnType::File { .. } | ColumnType::Video { .. } => true,
        _ => false,
    }
}
