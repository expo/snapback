//! Isolated complete fixtures, including captured authority and asset ownership.
use super::*;
impl Store {
    // @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — fork committed state, never reinterpret stored rows as new seed input.
    pub fn fork_memory(&self) -> Result<Self, RuntimeError> {
        let mut fork = Self::memory()?;
        {
            let backup = rusqlite::backup::Backup::new(&self.conn, &mut fork.conn)?;
            backup.run_to_completion(256, std::time::Duration::ZERO, None)?;
        }
        fork.read_sessions = std::sync::Arc::new(super::ReadSessionStorage::new(super::identity::present(&fork.conn)?));
        fork.catalog = self.catalog.clone();
        fork.identity = self.identity.clone();
        fork.server = self.server;
        if self.assets_dir.exists() {
            std::fs::create_dir_all(&fork.assets_dir).map_err(io)?;
            for entry in std::fs::read_dir(&self.assets_dir).map_err(io)? {
                let entry = entry.map_err(io)?;
                if !entry.file_type().map_err(io)?.is_file() {
                    return Err(RuntimeError::Store("fixture asset ledger contains a non-file".into()));
                }
                std::fs::copy(entry.path(), fork.assets_dir.join(entry.file_name())).map_err(io)?;
            }
        }
        Ok(fork)
    }
}

fn io(e:std::io::Error)->RuntimeError {RuntimeError::Store(e.to_string())}

impl Store {
    /// Independent valid worlds share verified bytes, never source row state.
    pub fn empty_with_asset_ledger(&self)->Result<Self,RuntimeError>{
        let fresh=Self::memory()?;
        let ids=self.conn.prepare("SELECT id FROM _assets")?.query_map([],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
        for id in ids{
            let mut asset=self.asset(&id)?.ok_or_else(||RuntimeError::Store("fixture asset disappeared".into()))?;
            asset.home=None;asset.released_at=None;
            fresh.record_asset(&asset)?;
        }
        if self.assets_dir.exists(){
            std::fs::create_dir_all(&fresh.assets_dir).map_err(io)?;
            for entry in std::fs::read_dir(&self.assets_dir).map_err(io)?{
                let entry=entry.map_err(io)?;
                if !entry.file_type().map_err(io)?.is_file(){return Err(RuntimeError::Store("fixture asset is not a regular file".into()));}
                std::fs::copy(entry.path(),fresh.assets_dir.join(entry.file_name())).map_err(io)?;
            }
        }
        Ok(fresh)
    }
}
