//! Bounded batch facts and prepared images. SQL remains inside each adapter.
use super::handles::SqliteTx;
#[cfg(feature="postgres")]
use super::handles::PostgresTx;
use crate::{RuntimeError, store_port::AnyTx, rows::Rows, engine::committer::overlay::{Access, Image, Base}};

#[derive(serde::Serialize)]
pub(crate) struct Request {
    pub digest: Option<String>,
    pub principal: String,
    pub id: Option<String>,
}
#[derive(Default)]
pub(crate) struct Facts {
    pub authority: Option<(String, crate::identity::facts::SessionFacts)>,
    pub receipt: Option<((String,String), Option<crate::receipts::ReceiptRecord>)>,
    pub placement: Option<((String,String), Option<crate::assets::IntentRecord>)>,
}
impl AnyTx<'_> {
    pub(crate) fn batch_level(&self, accesses: &[Access], schema: &crate::Schema, base: &mut Base) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(_) => for access in accesses {
                let row = if access.index == "byId" { self.get(&access.table,access.key[0].as_str()?)? }
                    else { self.lookup(&access.table,&access.index,&schema.tables[&access.table].indexes[&access.index],&access.key)? };
                base.insert(access,row);
            },
            #[cfg(feature="postgres")]
            Self::Postgres(PostgresTx(tx)) => tx.batch_level(accesses,base)?,
        }
        Ok(())
    }
    pub(crate) fn batch_facts(&self, requests: &[Request]) -> Result<Vec<Facts>, RuntimeError> {
        match self {
            Self::Sqlite(_) => Ok(requests.iter().map(|_|Facts::default()).collect()),
            #[cfg(feature="postgres")]
            Self::Postgres(PostgresTx(tx)) => tx.batch_facts(requests),
        }
    }
    pub(crate) fn install_batch_facts(&self, facts: &Facts) {
        #[cfg(feature="postgres")]
        if let Self::Postgres(PostgresTx(tx)) = self {
            tx.install_batch_facts(facts);
        }
        let _=facts;
    }
    pub(crate) fn overlay_evidence(&self, changes: &crate::revocation::Recorder) {
        match self {
            Self::Sqlite(SqliteTx(tx))=>*tx.changes.borrow_mut()=changes.clone(),
            #[cfg(feature="postgres")]
            Self::Postgres(PostgresTx(tx))=>tx.overlay_evidence(changes),
        }
    }
    pub(crate) fn complete_overlay_member(&self) {
        #[cfg(feature="postgres")]
        if let Self::Postgres(PostgresTx(tx))=self {tx.group_member_complete();}
    }
    pub(crate) fn apply_overlay(&self, schema: &crate::Schema, images: Vec<Image>) -> Result<(),RuntimeError> {
        match self {
            Self::Sqlite(_) => for image in images {
                if self.put(&image.table,&schema.tables[&image.table],&image.new,Some(&image.old))? != 0 {
                    return Err(RuntimeError::Store("qualified overlay changed an index".into()));
                }
            },
            #[cfg(feature="postgres")]
            Self::Postgres(PostgresTx(tx))=>*tx.group_images.borrow_mut()=images,
        }
        Ok(())
    }
}
