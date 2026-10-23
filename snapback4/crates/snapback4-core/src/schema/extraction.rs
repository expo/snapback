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
            return Err("extraction needs at least one mapped image/file column".into());
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
