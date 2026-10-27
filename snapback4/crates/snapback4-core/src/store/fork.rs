//! Isolated complete fixtures, including captured authority and asset ownership.
use super::*;
impl Store {
    fn copy_campaign_image(&self, target: &mut Connection) -> bool {
        if !self.campaign_assets_enabled() || !self.ephemeral_assets || !self.conn.is_autocommit()
            || self.conn.path().is_some_and(|path| !path.is_empty()) { return false; }
        let mut copy = || -> Result<bool, RuntimeError> {
            let pages = self.conn.query_row("PRAGMA page_count", [], |row| row.get::<_, i64>(0))?;
            let size = self.conn.query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))?;
            if pages < 0 || size < 0 || pages.saturating_mul(size) > 32 * 1024 * 1024 { return Ok(false); }
            let image = self.conn.serialize(rusqlite::MAIN_DB)?;
            // A WAL image needs its original VFS; retain ordinary backup there.
            if image.get(18) != Some(&1) || image.get(19) != Some(&1) { return Ok(false); }
            match image {
                rusqlite::serialize::Data::Owned(image) => target.deserialize(rusqlite::MAIN_DB, image, false)?,
                image => target.deserialize_read_exact(rusqlite::MAIN_DB, &*image, image.len(), false)?,
            }
            Ok(true)
        };
        copy().unwrap_or(false)
    }
    // @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — fork committed state, never reinterpret stored rows as new seed input.
    pub fn fork_memory(&self) -> Result<Self, RuntimeError> {
        let started = crate::replay_profile::start();
        let mut conn = Connection::open_in_memory()?;
        let page_size=conn.query_row("PRAGMA page_size",[],|row|row.get::<_,i64>(0))? as u64;
        // @ref LLP 3000.036.004.000.000#private-sqlite-image-forks — a fresh actual image, never a saved result or mutable shared database.
        if !self.copy_campaign_image(&mut conn) {
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

#[cfg(test)]
mod image_tests {
    use super::*;
    fn dump(conn: &Connection) -> BTreeMap<String, Vec<Vec<rusqlite::types::Value>>> {
        let names = conn.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").unwrap()
            .query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        names.into_iter().map(|name| {
            let mut statement = conn.prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\""))).unwrap();
            let columns = statement.column_count();
            let mut rows = statement.query_map([], |r| (0..columns).map(|i|r.get::<_,rusqlite::types::Value>(i)).collect::<Result<Vec<_>,_>>()).unwrap()
                .collect::<Result<Vec<_>,_>>().unwrap();
            rows.sort_by_cached_key(|row|format!("{row:?}"));(name, rows)
        }).collect()
    }
    #[test]
    fn private_image_matches_backup_and_retains_fresh_independent_state() {
        let source = Store::memory_for_campaign().unwrap();
        source.set_meta("lat1", "initial").unwrap();
        source.conn.execute("INSERT INTO _principals VALUES ('alice','user','Alice',1800000000000)", []).unwrap();
        source.conn.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at) VALUES ('digest','alice','user',1800000000000,1800000001000)", []).unwrap();
        let original = dump(&source.conn);
        let mut direct = Connection::open_in_memory().unwrap();assert!(source.copy_campaign_image(&mut direct));assert_eq!(dump(&direct), original);
        let image = source.fork_memory().unwrap();
        let bytes = source.campaign_assets.replace(None);let backup = source.fork_memory().unwrap();source.campaign_assets.replace(bytes);
        assert_eq!(dump(&image.conn), dump(&backup.conn));assert_eq!(image.page_size, backup.page_size);
        image.set_meta("lat1", "child").unwrap();assert_eq!(dump(&source.conn), original);
        source.set_meta("lat1", "parent-v2").unwrap();let next=source.fork_memory().unwrap();assert_eq!(next.meta("lat1").unwrap().as_deref(),Some("parent-v2"));
        assert_eq!(image.meta("lat1").unwrap().as_deref(),Some("child"));
        let transaction=source.conn.unchecked_transaction().unwrap();assert!(!source.copy_campaign_image(&mut direct));transaction.rollback().unwrap();
    }
    #[test]
    fn ordinary_and_oversized_sources_keep_backup_fallback() {
        let ordinary=Store::memory().unwrap();let mut destination=Connection::open_in_memory().unwrap();assert!(!ordinary.copy_campaign_image(&mut destination));
        let large=Store::memory_for_campaign().unwrap();let value="x".repeat(33*1024*1024);large.set_meta("lat1-large", &value).unwrap();
        assert!(!large.copy_campaign_image(&mut destination));let fork=large.fork_memory().unwrap();assert_eq!(fork.meta("lat1-large").unwrap().as_deref(),Some(value.as_str()));
    }
}
