//! Bounded batch facts and prepared images. SQL remains inside each adapter.
#[cfg(feature = "postgres")]
use super::handles::PostgresTx;
use super::handles::SqliteTx;
use crate::{
    RuntimeError,
    engine::committer::overlay::{Access, Base, Image},
    rows::Rows,
    store_port::AnyTx,
};

#[derive(serde::Serialize)]
pub(crate) struct Request {
    pub digest: Option<String>,
    pub principal: String,
    pub id: Option<String>,
}
#[derive(Default)]
pub(crate) struct Facts {
    pub authority: Option<(String, crate::identity::facts::SessionFacts)>,
    pub receipt: Option<((String, String), Option<crate::receipts::ReceiptRecord>)>,
    pub placement: Option<((String, String), Option<crate::assets::IntentRecord>)>,
}
impl AnyTx<'_> {
    pub(crate) fn chain_head(&self, chain: &crate::engine::program_pipeline::Chain) -> Result<(), RuntimeError> {
        #[cfg(feature="postgres")]
        if let Self::Postgres(PostgresTx(tx)) = self { tx.chain_head(chain)?; }
        let _ = chain;
        Ok(())
    }

    pub(crate) fn batch_level(
        &self,
        accesses: &[Access],
        schema: &crate::Schema,
        base: &mut Base,
    ) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(_) => {
                for access in accesses {
                    let row = if access.index == "byId" {
                        self.get(&access.table, access.key[0].as_str()?)?
                    } else {
                        self.lookup(
                            &access.table,
                            &access.index,
                            &schema.tables[&access.table].indexes[&access.index],
                            &access.key,
                        )?
                    };
                    base.insert(access, row);
                }
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => tx.batch_level(accesses, base)?,
        }
        Ok(())
    }
    pub(crate) fn batch_facts(
        &self,
        requests: &[Request],
        accesses: &[Access],
        schema: &crate::Schema,
        base: &mut Base,
    ) -> Result<Vec<Facts>, RuntimeError> {
        match self {
            Self::Sqlite(_) => {
                self.batch_level(accesses, schema, base)?;
                Ok(requests.iter().map(|_| Facts::default()).collect())
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => tx.batch_facts(requests, accesses, base),
        }
    }
    pub(crate) fn install_batch_facts(&self, facts: &Facts) {
        #[cfg(feature = "postgres")]
        if let Self::Postgres(PostgresTx(tx)) = self {
            tx.install_batch_facts(facts);
        }
        let _ = facts;
    }
    pub(crate) fn overlay_evidence(&self, changes: &crate::revocation::Recorder) {
        match self {
            Self::Sqlite(SqliteTx(tx)) => *tx.changes.borrow_mut() = changes.clone(),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => tx.overlay_evidence(changes),
        }
    }
    pub(crate) fn complete_overlay_member(&self) {
        #[cfg(feature = "postgres")]
        if let Self::Postgres(PostgresTx(tx)) = self {
            tx.group_member_complete();
        }
    }
    pub(crate) fn apply_overlay(
        &self,
        schema: &crate::Schema,
        images: Vec<Image>,
    ) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(_) => {
                for image in images {
                    if self.put(
                        &image.table,
                        &schema.tables[&image.table],
                        &image.new,
                        Some(&image.old),
                    )? != 0
                    {
                        return Err(RuntimeError::Store(
                            "qualified overlay changed an index".into(),
                        ));
                    }
                }
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => *tx.group_images.borrow_mut() = images,
        }
        Ok(())
    }
}

#[cfg(feature="postgres")]
impl AnyTx<'_> {
    pub(crate) fn suspend_program(self, predecessor: Option<i64>, deadline: std::time::Instant) -> Result<crate::engine::postgres::writer_slot::Suspended, RuntimeError> {
        match self { Self::Postgres(PostgresTx(tx)) => tx.suspend_program(predecessor, deadline), _ => unreachable!("pipeline is Postgres only") }
    }
}
#[cfg(feature="postgres")]
impl crate::store_port::AnyStore {
    pub(crate) fn refresh_pipeline_writer(&mut self) -> Result<(), RuntimeError> {
        match self {
            Self::Postgres(super::handles::PostgresStore(handle)) => handle.reconnect_pipeline_writer(),
            _ => unreachable!("pipeline is Postgres only"),
        }
    }
    pub(crate) fn finish_suspended(&mut self, frozen: crate::engine::postgres::writer_slot::Suspended) -> Result<Option<crate::engine::postgres::read_grant::Published>, crate::engine::committer::outcome::Failure> {
        match self { Self::Postgres(super::handles::PostgresStore(h)) => h.store.get_mut().finish_suspended(frozen), _ => unreachable!("pipeline is Postgres only") }
    }
    pub(crate) fn pipeline_slot(&self) -> Result<Self, RuntimeError> {
        match self { Self::Postgres(super::handles::PostgresStore(h)) => h.writer_slot().map(Self::from_postgres), _ => Err(RuntimeError::StoreUnsupported {family:"pipeline"}) }
    }
}

#[cfg(feature="postgres")]
impl crate::store_port::AnyStore {
    pub(crate) fn abort_suspended(&mut self, frozen: crate::engine::postgres::writer_slot::Suspended) -> Result<(),RuntimeError> {
        if let Self::Postgres(super::handles::PostgresStore(h)) = self {
            return h.store.get_mut().resume_program(frozen)?.rollback();
        }
        unreachable!("Postgres pipeline only")
    }
    pub(crate) fn drain_program_tickets(&mut self, tickets: &[i64]) -> Result<(), RuntimeError> {
        if let Self::Postgres(super::handles::PostgresStore(h)) = self {
            h.reconnect_pipeline_writer()?;
            let result=h.store.get_mut().drain_program_tickets(tickets);
            // An idle synchronous socket can discover its loss only on this
            // first probe. Repeat fenced control locks once on a fresh socket,
            // before any head reseed or data recovery.
            if result.is_err() && h.early_pipeline_disconnected() {
                h.reconnect_pipeline_writer()?;
                h.store.get_mut().drain_program_tickets(tickets)
            } else {result}
        } else { unreachable!() }
    }
}

#[cfg(feature="postgres")]
impl crate::store_port::AnyStore {
    pub(crate) fn fence_pipeline_terminal(&mut self)->Result<Vec<i32>,RuntimeError> {
        if let Self::Postgres(super::handles::PostgresStore(h))=self {h.reconnect_pipeline_writer()?;h.store.get_mut().fence_pipeline_terminal()} else {unreachable!()}
    }
    pub(crate) fn sync_pipeline_slot(&mut self,other:&Self) {
        if let (Self::Postgres(super::handles::PostgresStore(dst)),Self::Postgres(super::handles::PostgresStore(src)))=(self,other) {
            dst.sync_pipeline_slot(src);
        }
    }
}
