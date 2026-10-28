//! Isolated complete fixtures, including captured authority and asset ownership.
use super::*;
impl Store {
    // @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — fork committed state, never reinterpret stored rows as new seed input.
    pub fn fork_memory(&self) -> Result<Self, RuntimeError> {
        let started = crate::replay_profile::start();
        let mut conn = Connection::open_in_memory()?;
        let page_size=conn.query_row("PRAGMA page_size",[],|row|row.get::<_,i64>(0))? as u64;
        {
            let backup = rusqlite::backup::Backup::new(&self.conn, &mut conn)?;
            backup.run_to_completion(256, std::time::Duration::ZERO, None)?;
        }
        let copied = started.map(|t|t.elapsed().as_secs_f64());
        // @ref LLP 3000.036.004.000.000#fixture-construction — copy already-captured metadata without repeated discovery.
        #[cfg(any(test,feature="test-support"))]
        trace_round_trips(&conn);
        conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_QPSG,true)?;
        let read_sessions=std::sync::Arc::new(super::ReadSessionStorage::new(super::identity::present(&conn)?));
        let fork=Self {
            cache_revision:cache_revision::Revision::new(&conn)?,cache_owned:false,
            read_sessions,conn,server:self.server,ownership:None,
            #[cfg(unix)] file_identity:None,
            page_size,catalog:self.catalog.clone(),identity:self.identity.clone(),
            assets_dir:Self::memory_assets_dir()?,campaign_assets:self.campaign_assets.clone(),ephemeral_assets:true,
            #[cfg(test)] full_adoption:false,
            adoption_report:Default::default(),
        };
        let prepared = started.map(|t|t.elapsed().as_secs_f64());
        // @ref LLP 3000.036.004.000.000#lazy-private-asset-directories — snapshots may leave an empty source directory; keep private children lazy.
        if self.assets_dir.exists() {
            let mut created = false;
            for entry in std::fs::read_dir(&self.assets_dir).map_err(io)? {
                let entry = entry.map_err(io)?;
                if !entry.file_type().map_err(io)?.is_file() {
                    return Err(RuntimeError::Store("fixture asset ledger contains a non-file".into()));
                }
                if !created { std::fs::create_dir_all(&fork.assets_dir).map_err(io)?; created = true; }
                std::fs::copy(entry.path(), fork.assets_dir.join(entry.file_name())).map_err(io)?;
            }
        }
        if let (Some(started),Some(copied),Some(prepared))=(started,copied,prepared) {
            let elapsed=started.elapsed().as_secs_f64();
            crate::replay_profile::record(serde_json::json!({"phase":"replay.fork","seconds":elapsed,"copy":copied,"prepare":prepared-copied,"assets":elapsed-prepared}));
        }
        Ok(fork)
    }
}

fn io(e:std::io::Error)->RuntimeError {RuntimeError::Store(e.to_string())}

impl Store {
    /// Independent valid worlds share verified bytes, never source row state.
    pub fn empty_with_asset_ledger(&self)->Result<Self,RuntimeError>{
        let fresh=Self::memory()?;
        fresh.campaign_assets.replace(self.campaign_assets.borrow().clone());
        let ids=self.conn.prepare("SELECT id FROM _assets")?.query_map([],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
        for id in ids{
            let mut asset=self.asset(&id)?.ok_or_else(||RuntimeError::Store("fixture asset disappeared".into()))?;
            asset.home=None;asset.released_at=None;
            fresh.record_asset(&asset)?;
        }
        if self.assets_dir.exists(){
            let mut created = false;
            for entry in std::fs::read_dir(&self.assets_dir).map_err(io)?{
                let entry=entry.map_err(io)?;
                if !entry.file_type().map_err(io)?.is_file(){return Err(RuntimeError::Store("fixture asset is not a regular file".into()));}
                if !created { std::fs::create_dir_all(&fresh.assets_dir).map_err(io)?; created = true; }
                std::fs::copy(entry.path(),fresh.assets_dir.join(entry.file_name())).map_err(io)?;
            }
        }
        Ok(fresh)
    }
}

#[cfg(test)]
mod lazy_asset_directory_tests {
    use super::*;
    #[test]
    fn empty_worlds_stay_lazy_and_physical_copies_stay_independent() {
        let source = Store::memory_for_campaign().unwrap();
        source.set_meta("lat1", "current").unwrap();
        std::fs::create_dir_all(&source.assets_dir).unwrap();
        for world in [source.fork_memory().unwrap(), source.empty_with_asset_ledger().unwrap()] {
            assert!(!world.assets_dir.exists());
        }
        let fork = source.fork_memory().unwrap();
        assert_eq!(fork.meta("lat1").unwrap().as_deref(), Some("current"));
        fork.set_meta("lat1", "child").unwrap();
        assert_eq!(source.meta("lat1").unwrap().as_deref(), Some("current"));
        std::fs::write(source.assets_dir.join("actual"), b"parent bytes").unwrap();
        for world in [source.fork_memory().unwrap(), source.empty_with_asset_ledger().unwrap()] {
            assert_ne!(world.assets_dir, source.assets_dir);
            assert_eq!(std::fs::read(world.assets_dir.join("actual")).unwrap(), b"parent bytes");
            std::fs::write(world.assets_dir.join("actual"), b"child bytes").unwrap();
            assert_eq!(std::fs::read(source.assets_dir.join("actual")).unwrap(), b"parent bytes");
        }
        std::fs::create_dir(source.assets_dir.join("not-a-file")).unwrap();
        assert!(source.fork_memory().is_err());
        assert!(source.empty_with_asset_ledger().is_err());
    }
}
