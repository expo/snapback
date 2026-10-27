//! New production incarnation of a private, stopped staging snapshot.
// @ref LLP 3000.000.000.003#6-staging-snapshot-promotion-rel4-stretch-proposal — preserve account/data/release identity while separating all session authority and replica history.
use super::*;
fn refused(message:impl Into<String>)->RuntimeError{RuntimeError::Structural{code:"E_PROMOTE",message:message.into()}}
impl Store {
    /// Call only on an unpublished private snapshot, then reopen before serving.
    pub fn promote_snapshot(&mut self, mut provenance:serde_json::Value)->Result<serde_json::Value,RuntimeError>{
        self.check_ownership()?;
        let assets_dir=self.assets_dir.clone();
        let tx=self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let purpose:Option<String>=tx.query_row("SELECT value FROM _meta WHERE key='deployment_environment'",[],|r|r.get(0)).optional()?;
        if purpose.as_deref()!=Some("staging"){return Err(refused("promote requires a staging snapshot; production/legacy stores cannot be relabelled"));}
        let at=provenance["at"].as_i64().unwrap_or_else(crate::now_ms);
        let reads:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_read_sessions')",[],|r|r.get(0))?;
        let guests:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM _sessions WHERE kind='guest' AND expires_at>?1)",[at],|r|r.get(0))?;
        let guest_reads=reads&&tx.query_row("SELECT EXISTS(SELECT 1 FROM _read_sessions WHERE kind='guest' AND expires_at>?1 AND cap_expires_at>?1)",[at],|r|r.get::<_,bool>(0))?;
        if guests||guest_reads{return Err(refused("live guest identities cannot sign in again after credential separation; transfer their data through authorized staging mutations to password accounts and sign out every live guest session before promotion"));}
        if !provenance.is_object(){return Err(refused("promotion provenance must be an object"));}
        for (table,predicate) in [("_jobs","state IN ('queued','running')"),("_requests","state IN ('queued','running')"),("_outbox","state IN ('queued','running')"),("_action_steps","state='started'"),("_effect_steps","state='started'")] {
            let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",[table],|r|r.get(0))?;
            if exists&&tx.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {predicate})"),[],|r|r.get::<_,bool>(0))? {
                return Err(refused(format!("{table} has unfinished work; resume staging until queued/running work and started external steps are settled, stop staging, then retry promotion")));
            }
        }
        {
            let mut query=tx.prepare("SELECT id,bytes FROM _assets WHERE released_at IS NULL")?;
            let mut rows=query.query([])?;
            while let Some(row)=rows.next()? {
                let id:String=row.get(0)?;let bytes:i64=row.get(1)?;
                let mut parts=std::path::Path::new(&id).components();
                if !matches!(parts.next(),Some(std::path::Component::Normal(_)))||parts.next().is_some(){return Err(refused("asset ledger contains an unsafe file identity"));}
                let file=std::fs::symlink_metadata(assets_dir.join(&id)).map_err(|_|refused(format!("retained asset {id} is missing; restore its original bytes before promotion")))?;
                if !file.is_file()||bytes<0||file.len()!=bytes as u64{return Err(refused(format!("retained asset {id} does not match its stored byte length; restore its original bytes before promotion")));}
            }
        }
        let source:String=tx.query_row("SELECT value FROM _meta WHERE key='store_id'",[],|r|r.get(0))?;
        let destination:String=tx.query_row("SELECT lower(hex(randomblob(16)))",[],|r|r.get(0))?;
        if source==destination{return Err(refused("new store incarnation collided; retry promotion"));}
        // Increment every principal fence as well as removing full/read tokens:
        // a retained idempotent mint binding must not recreate an old family.
        tx.execute_batch("INSERT INTO _principal_generations(principal,generation) SELECT id,1 FROM _principals WHERE true ON CONFLICT(principal) DO UPDATE SET generation=generation+1;")?;
        let mut revoked=tx.execute("DELETE FROM _sessions",[])? as u64;
        if reads{revoked+=tx.execute("DELETE FROM _read_sessions",[])? as u64;}
        provenance["sourceStore"]=serde_json::json!(source);provenance["destinationStore"]=serde_json::json!(destination);provenance["revokedSessions"]=serde_json::json!(revoked);
        tx.execute("UPDATE _meta SET value=?1 WHERE key='store_id'",[&destination])?;
        tx.execute("UPDATE _meta SET value='production' WHERE key='deployment_environment'",[])?;
        tx.execute("INSERT INTO _meta(key,value) VALUES('promotion_origin',?1)",[provenance.to_string()])?;
        tx.commit()?;
        Ok(provenance)
    }
}

#[cfg(test)]mod tests {
    use super::*;
    use crate::{identity,store_port::AnyStore};
    #[test]
    fn credential_separation_preserves_accounts_but_fences_every_old_token(){
        let mut source=AnyStore::memory().unwrap();source.set_deployment_environment("staging").unwrap();
        let account=identity::signup(&source,"rel4@example.test","correct-password-123",1000,&mut crate::ids::Mint::default()).unwrap();
        let read=identity::narrow_session(&mut source,&account.token,||crate::identity::ServiceSample{now:1001,supervisor_revision:0}).unwrap();
        let service=identity::service_session(&source,"operator",1000,1).unwrap();
        let old_id=source.store_id().unwrap();
        let dir=std::env::temp_dir().join(format!("rel4-promote-{}-{}",std::process::id(),crate::ids::seed()));crate::private_fs::directory(&dir).unwrap();
        source.snapshot_to(&dir.join("store.sqlite")).unwrap();
        let mut copy=AnyStore::open(&dir.join("store.sqlite")).unwrap();let receipt=copy.promote_snapshot(serde_json::json!({"release":1})).unwrap();drop(copy);
        let copy=AnyStore::open(&dir.join("store.sqlite")).unwrap();assert_ne!(copy.store_id().unwrap(),old_id);assert_eq!(copy.deployment_environment().unwrap().as_deref(),Some("production"));
        assert_eq!(receipt["sourceStore"],old_id);assert_eq!(receipt["destinationStore"],copy.store_id().unwrap());
        for token in [&account.token,&read.token,&service.token]{assert!(identity::resolve(&copy,token,1100).unwrap().is_none());assert!(identity::rotate_session(&copy,token,1100).unwrap().is_none());assert!(identity::resolve(&source,token,1100).unwrap().is_some());}
        let login=identity::login(&copy,"rel4@example.test","correct-password-123",1100).unwrap();assert_eq!(login.principal,account.principal);assert!(identity::resolve(&copy,&login.token,1200).unwrap().is_some());assert!(identity::resolve_read_only(&copy,&login.token,1200,Some(&old_id)).unwrap().is_none());
        assert_eq!(source.store_id().unwrap(),old_id);assert_eq!(source.deployment_environment().unwrap().as_deref(),Some("staging"));drop(copy);std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn production_guest_pending_work_and_missing_assets_refuse_without_metadata_changes(){
        for case in ["production","guest","work","asset"] {
            let mut store=Store::memory().unwrap();store.set_deployment_environment(if case=="production"{"production"}else{"staging"}).unwrap();
            match case {
                "guest"=>{store.conn.execute("INSERT INTO _principals VALUES('guest:one','guest',NULL,1)",[]).unwrap();store.conn.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at) VALUES('guest-token','guest:one','guest',1,9223372036854775807)",[]).unwrap();},
                "work"=>{store.conn.execute("INSERT INTO _jobs(id,name,args,program_hash,state,sweep,chunks,rows_written,created_at,updated_at) VALUES('pending','test','{}','hash','queued',0,0,0,1,1)",[]).unwrap();},
                "asset"=>{store.conn.execute("INSERT INTO _assets(id,owner,kind,content_type,bytes,created_at) VALUES('missing','user:one','file','text/plain',4,1)",[]).unwrap();},_=>(),
            }
            let id=store.store_id().unwrap();let purpose=store.deployment_environment().unwrap();assert!(store.promote_snapshot(serde_json::json!({})).is_err(),"{case}");assert_eq!(store.store_id().unwrap(),id);assert_eq!(store.deployment_environment().unwrap(),purpose);
        }
    }
}
