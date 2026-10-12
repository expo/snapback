//! Staged upload custody, intent receipts and authorized asset delivery.
use super::*;
impl Engine {
    /// Record an upload under `owner`: sniffed, bounded by the largest
    /// column of its kind in this schema, written beside the store. The
    /// asset is nobody's to see until a row claims it (the owner may).
    pub fn store_asset(&mut self, owner: &str, bytes: &[u8], now: i64) -> Result<Asset, RuntimeError> {
        let sniffed = assets::sniff(bytes)?;
        let upload = self.prepare_asset(owner, sniffed, bytes.len() as u64, now)?;
        let upload = upload.write(bytes)?;
        self.finish_asset(upload)
    }

    /// Admit an upload and reserve its identity while the engine is held.
    /// The returned upload writes its bytes without borrowing this engine.
    pub fn prepare_asset(
        &mut self,
        owner: &str,
        sniffed: assets::Sniffed,
        byte_count: u64,
        now: i64,
    ) -> Result<assets::Upload, RuntimeError> {
        let ceiling = self
            .schema
            .tables
            .values()
            .flat_map(|table| table.columns.values())
            .filter_map(|kind| match (asset_columns::leaf(kind), sniffed.kind) {
                (ColumnType::Image { max, .. }, AssetKind::Image) | (ColumnType::Video { max }, AssetKind::Video) => Some(*max),
                _ => None,
            })
            .max();
        let Some(ceiling) = ceiling else {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("no column of this backend takes {} bytes; declare one (`photo: image <=10000000`)", sniffed.kind.word()) });
        };
        if byte_count > u64::from(ceiling) {
            return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("the {} is {} bytes; the largest {} column takes {ceiling}", sniffed.kind.word(),
                    byte_count, sniffed.kind.word()) });
        }
        self.stage_upload(Asset { id: String::new(), owner: owner.to_owned(), kind: sniffed.kind, content_type: sniffed.content_type.to_owned(), bytes: byte_count, width: sniffed.width, height: sniffed.height, duration: sniffed.duration, created_at: now, home: None, released_at: None, name: None })
    }

    /// Record a file upload under `owner`: `declared` checked against the
    /// bytes (LLP 3000.038 §2), the name sanitized, bounded by the largest
    /// file column that accepts the type.
    pub fn store_file(&mut self, owner: &str, bytes: &[u8], declared: Option<&str>, name: &str, now: i64) -> Result<Asset, RuntimeError> {
        let content_type = assets::verify_file(bytes, declared)?;
        let upload = self.prepare_file(owner, content_type, name, bytes.len() as u64, now)?;
        let upload = upload.write(bytes)?;
        self.finish_asset(upload)
    }

    /// The most bytes any `file` column of this schema takes: the host reads
    /// a file upload's body up to this bound (LLP 3000.038 §3). None when the
    /// schema has no file column.
    pub fn file_upload_ceiling(&self) -> Option<u32> {
        self.schema.tables.values().flat_map(|table| table.columns.values())
            .filter_map(|kind| match asset_columns::leaf(kind) { ColumnType::File { max, .. } => Some(*max), _ => None })
            .max()
    }

    /// Admit a verified file upload, as `prepare_asset` admits media.
    // @ref LLP 3000.038#3 — column-less admission: some file column must accept the type, and the largest such bound applies.
    pub fn prepare_file(&mut self, owner: &str, content_type: &str, name: &str, byte_count: u64, now: i64) -> Result<assets::Upload, RuntimeError> {
        let files: Vec<(u32, &[String])> = self.schema.tables.values().flat_map(|table| table.columns.values())
            .filter_map(|kind| match asset_columns::leaf(kind) { ColumnType::File { max, types } => Some((*max, &types[..])), _ => None })
            .collect();
        if files.is_empty() {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: "no column of this backend takes a file; declare one (`doc: file <=10000000`)".into() });
        }
        let Some(ceiling) = files.iter().filter(|(_, types)| assets::file_accepts(types, content_type)).map(|(max, _)| *max).max() else {
            let mut accepted: Vec<&str> = files.iter().flat_map(|(_, types)| if types.is_empty() { assets::FILE_TYPES.to_vec() } else { types.iter().map(String::as_str).collect() }).collect();
            accepted.sort_unstable();
            accepted.dedup();
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("no file column of this backend accepts {content_type}; they accept {}", accepted.join(", ")) });
        };
        if byte_count > u64::from(ceiling) {
            return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("the file is {byte_count} bytes; the largest file column accepting {content_type} takes {ceiling}") });
        }
        if byte_count == 0 {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: "the upload is empty: POST the file's bytes as the body".into() });
        }
        self.stage_upload(Asset { id: String::new(), owner: owner.to_owned(), kind: AssetKind::File, content_type: content_type.to_owned(), bytes: byte_count, width: None, height: None, duration: None, created_at: now, home: None, released_at: None, name: Some(assets::sanitize_name(name)) })
    }

    fn stage_upload(&mut self, mut asset: Asset) -> Result<assets::Upload, RuntimeError> {
        asset.id = crate::ids::mint(asset.created_at, &mut self.entropy)?;
        let path = self.store.asset_path(&asset.id);
        Ok(assets::Upload {
            asset,
            path,
            generation: self.generation,
            written: false,
            intent: None,
            placement: None,
            committed: false,
            ephemeral_directory: self.store.ephemeral_assets(),
        })
    }

    /// Commit a staged upload only if this engine still serves the schema
    /// generation under which it was admitted.
    pub fn finish_asset(&mut self, mut upload: assets::Upload) -> Result<Asset, RuntimeError> {
        if let Some(placement)=&upload.placement{bounded_placement(placement)?;}
        if upload.generation != self.generation {
            return Err(RuntimeError::Generation(
                "schema changed during upload; retry".into(),
            ));
        }
        if !upload.written {
            return Err(RuntimeError::Input(
                "upload bytes have not been written".into(),
            ));
        }
        // Check shared-store activation too, not just this engine's identity.
        let tx = self.store.transaction()?;
        // @ref LLP 3000.038.000#3 — compare and publish dedup inside the ledger transaction.
        if let Some((id, fingerprint)) = &upload.intent {
            if let Some(asset) = assets::replay_intent(&tx, &upload.asset.owner, id, fingerprint)? {
                tx.rollback()?;
                return Ok(asset);
            }
            let pinned: i64 = tx.conn().query_row("SELECT COALESCE(SUM(a.bytes),0) FROM _asset_intents u JOIN _assets a ON a.id=u.asset WHERE u.owner=?1 AND u.state='pending' AND a.home_table IS NULL AND NOT EXISTS(SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent)", [&upload.asset.owner], |r| r.get(0))?;
            if pinned as u64 + upload.asset.bytes > 128 << 20 {
                return Err(RuntimeError::Asset { code: "E_UPLOAD_QUOTA", message: "unplaced upload intents exceed this viewer's 128 MiB allowance; place or cancel earlier intents".into() });
            }
            // BEGIN IMMEDIATE excludes cancellation/other writers between this recheck and publication.
            tx.conn().execute("INSERT INTO _asset_intents(owner,intent,fingerprint,asset,facts,placement,state) VALUES(?1,?2,?3,?4,?5,?6,'pending') ON CONFLICT(owner,intent) DO UPDATE SET asset=excluded.asset,facts=excluded.facts,state='pending' WHERE _asset_intents.state='declared'", rusqlite::params![upload.asset.owner,id,fingerprint,upload.asset.id,crate::json_codec::to_text(&upload.asset).map_err(|e|RuntimeError::Store(e.to_string()))?,upload.placement.as_ref().map(crate::json_codec::to_text).transpose().map_err(|e|RuntimeError::Store(e.to_string()))?])?;
        }
        tx.record_asset(&upload.asset)?;
        tx.commit()?;
        upload.committed = true;
        Ok(upload.asset.clone())
    }

    /// Bind original placement and upload fingerprint before accepting byte transport.
    pub fn declare_asset_intent(&mut self, owner:&str,id:&str,fingerprint:&str,placement:&serde_json::Value)->Result<(),RuntimeError>{
        use rusqlite::OptionalExtension;
        let encoded=bounded_placement(placement)?;
        let tx=self.store.transaction()?;
        let old:Option<(Option<String>,Option<String>,String)>=tx.conn().query_row("SELECT fingerprint,placement,state FROM _asset_intents WHERE owner=?1 AND intent=?2",[owner,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        if let Some((previous,binding,state))=old {
            if state=="cancelled"{return Err(RuntimeError::Asset{code:"E_UPLOAD_CANCELLED",message:"this intent was cancelled".into()});}
            if previous.as_deref()!=Some(fingerprint)||binding.as_deref()!=Some(&encoded){return Err(RuntimeError::Asset{code:"E_ASSET_INTENT_REUSE",message:"intent declaration belongs to different bytes, metadata or placement".into()});}
            tx.rollback()?;return Ok(());
        }
        if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _ops WHERE principal=?1 AND id=?2)",[owner,id],|r|r.get::<_,bool>(0))?{return Err(RuntimeError::Asset{code:"E_WRITE_ID_REUSE",message:"this id already belongs to an executed mutation".into()});}
        tx.conn().execute("INSERT INTO _asset_intents(owner,intent,fingerprint,placement,state) VALUES(?1,?2,?3,?4,'declared')",rusqlite::params![owner,id,fingerprint,encoded])?;
        tx.commit()
    }
    pub fn asset_declaration(&mut self,owner:&str,id:&str)->Result<Option<serde_json::Value>,RuntimeError>{
        use rusqlite::OptionalExtension;
        let tx=self.store.transaction()?;
        let binding:Option<(Option<String>,String)>=tx.conn().query_row("SELECT placement,state FROM _asset_intents WHERE owner=?1 AND intent=?2",[owner,id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if binding.as_ref().is_some_and(|(_,s)|s=="cancelled"){return Err(RuntimeError::Asset{code:"E_UPLOAD_CANCELLED",message:"this intent was cancelled".into()});}
        let result=binding.and_then(|(p,_)|p).map(|p|crate::json_codec::from_text(&p).map_err(|e|RuntimeError::Store(e.to_string()))).transpose()?;
        tx.rollback()?;Ok(result)
    }

    /// A device-owned placing id cannot become an ephemeral execution after adoption.
    // @ref LLP 3000.038.000#3 — media placement always settles through a durable receipt.
    pub fn require_non_media_ephemeral(&self,owner:&str,id:Option<&str>)->Result<(),RuntimeError>{
        if let Some(id)=id
            && self.store.conn().query_row("SELECT EXISTS(SELECT 1 FROM _asset_intents WHERE owner=?1 AND intent=?2)",[owner,id],|r|r.get::<_,bool>(0))? {
            return Err(RuntimeError::Asset{code:"E_UPLOAD_INTENT",message:"upload-and-place requires a durable mutation; this operation became ephemeral".into()});
        }
        Ok(())
    }

    /// Replay before current-schema admission; dedup receipts outlive collection.
    pub fn asset_intent(&mut self, owner: &str, id: &str, fingerprint: &str) -> Result<Option<Asset>, RuntimeError> {
        let tx = self.store.transaction()?;
        let result = assets::replay_intent(&tx, owner, id, fingerprint)?;
        tx.rollback()?;
        Ok(result)
    }

    /// Bounded owner-only recovery of pinned uploads after device storage loss.
    pub fn pending_asset_intents(&mut self, owner: &str, after: &str) -> Result<serde_json::Value, RuntimeError> {
        let tx = self.store.transaction()?;
        let entries: Vec<(String,String)> = tx.conn().prepare("SELECT u.intent,u.facts FROM _asset_intents u JOIN _assets a ON a.id=u.asset WHERE u.owner=?1 AND u.intent>?2 AND u.state='pending' AND a.home_table IS NULL AND a.released_at IS NULL AND NOT EXISTS(SELECT 1 FROM _ops o WHERE o.principal=u.owner AND o.id=u.intent) ORDER BY u.intent LIMIT 51")?.query_map([owner,after], |r| Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
        let next = if entries.len()>50 { Some(entries[49].0.clone()) } else { None };
        let mut intents=Vec::new();
        for (id,facts) in entries.into_iter().take(50) {
            let asset: Asset = crate::json_codec::from_text(&facts).map_err(|e| RuntimeError::Store(e.to_string()))?;
            let mut facts=serde_json::json!({"id":asset.id,"type":asset.content_type,"bytes":asset.bytes,"width":asset.width,"height":asset.height,"duration":asset.duration});
            if let Some(name)=asset.name {facts["name"]=serde_json::json!(name);}
            intents.push(serde_json::json!({"id":id,"asset":facts,"createdAt":asset.created_at}));
        }
        let store = tx.meta("store_id")?;
        tx.rollback()?;
        Ok(serde_json::json!({"intents":intents,"next":next,"store_id":store}))
    }

    /// Persist early terminal input/operation refusals for an owned upload placement.
    /// This closes paths that return before ordinary mutation receipt creation.
    pub fn finish_asset_intent(&mut self, owner: &str, id: &str, name: &str, args: &serde_json::Value, why: &Refusal) -> Result<MutationOutcome, RuntimeError> {
        if why.retryable { return Err(RuntimeError::Input("retryable outcomes cannot finalize an upload intent".into())); }
        let tx = self.store.transaction()?;
        if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _asset_intents WHERE owner=?1 AND intent=?2)", [owner,id], |r| r.get::<_,bool>(0))? {
            return Err(RuntimeError::Asset {code:"E_UPLOAD_INTENT",message:"this viewer has no uploaded intent under that id".into()});
        }
        if let Some(receipt) = crate::store::replay_bound(tx.conn(), owner, id, name, args)? {
            let outcome = MutationOutcome::from_receipt(&receipt)?; tx.rollback()?; return Ok(outcome);
        }
        let cancelled=tx.conn().query_row("SELECT state='cancelled' FROM _asset_intents WHERE owner=?1 AND intent=?2",[owner,id],|r|r.get::<_,bool>(0))?;
        if cancelled {tx.rollback()?;return Ok(MutationOutcome{receipt_only:true,state:WriteState::Failed{why:Refusal::new("E_UPLOAD_CANCELLED","asset","this intent was durably cancelled"),current:None},metered:Metered::default(),tables:Vec::new(),events:0,replayed:true});}
        assets::require_placement(&tx,owner,id,name,args)?;
        if why.code.chars().count()>128 || why.family.chars().count()>128 || why.message.chars().count()>4096 || why.guide.as_ref().is_some_and(|g|g.chars().count()>128) {
            return Err(RuntimeError::Asset{code:"E_UPLOAD_ARGUMENT",message:"finalization refusal exceeds its 128-character fields or 4096-character message allowance".into()});
        }
        let outcome = MutationOutcome { receipt_only:false, state:WriteState::Failed {why:why.clone(),current:None}, metered:Metered::default(),tables:Vec::new(),events:0,replayed:false };
        let seq = tx.next_seq()? - 1;
        tx.record_applied(owner,id,seq,&crate::json_codec::to_text(&outcome.receipt(Some(id))).map_err(|e| RuntimeError::Store(e.to_string()))?)?;
        tx.bind_applied(owner,id,name,args,crate::now_ms())?;
        tx.conn().execute("UPDATE _asset_intents SET state='settled' WHERE owner=?1 AND intent=?2 AND state != 'cancelled'", [owner,id])?;
        tx.commit()?; Ok(outcome)
    }

    /// Cancellation fences a late staged upload too; executed placements cannot be cancelled.
    pub fn cancel_asset_intent(&mut self, owner: &str, id: &str) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _ops WHERE principal=?1 AND id=?2)", [owner,id], |r| r.get::<_,bool>(0))? {
            return Err(RuntimeError::Asset { code: "E_UPLOAD_DISPATCHED", message: "placement already has a server outcome; recover its receipt".into() });
        }
        tx.conn().execute("INSERT INTO _asset_intents(owner,intent,state) VALUES(?1,?2,'cancelled') ON CONFLICT(owner,intent) DO UPDATE SET state='cancelled'", [owner,id])?;
        tx.commit()
    }

    /// Whether `principal` may have the bytes of `id` now: the uploader
    /// before placement; after placement, the home must still name it and
    /// be unexpired. Every viewer follows its read rule. This grants a
    /// delivery without consuming a `once` view; the host records success.
    /// A previously completed view is refused. Hidden,
    /// released and absent are one word.
    pub fn asset_access(&mut self, principal: &str, id: &str, now: i64,
    ) -> Result<AssetGrant, RuntimeError> {
        self.asset_access_request(principal, id, now, false)
    }

    pub fn asset_access_request(
        &mut self,
        principal: &str,
        id: &str,
        now: i64,
        range: bool,
    ) -> Result<AssetGrant, RuntimeError> {
        let unknown = || RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: "no asset is served under that id to this viewer".into() };
        let path = self.store.asset_path(id);
        let tx = self.store.transaction()?;
        let Some(asset) = tx.asset(id)? else { return Err(unknown()) };
        if asset.released_at.is_some() {
            return Err(unknown());
        }
        // @ref LLP 3000.019#3.5 — a delayed download cannot confer custody in a replacement store.
        let store_id = tx.meta("store_id")?.ok_or_else(unknown)?;
        let grant = |once: bool| AssetGrant { store_id: store_id.clone(), home: asset.home.clone(), path: path.clone(), content_type: asset.content_type.clone(), bytes: asset.bytes, once, kind: asset.kind, name: asset.name.clone() };
        let Some((table_name, row_id, column)) = &asset.home else {
            if asset.owner == principal {
                tx.rollback()?;
                return Ok(grant(false));
            }
            return Err(unknown());
        };
        let table = self.schema.table(table_name).ok_or_else(unknown)?;
        let Some(row) = tx.get(table_name, row_id)? else { return Err(unknown()) };
        if !table.columns.get(column).is_some_and(|kind| asset_columns::contains(kind, row.field(column).ok(), id)) || table.expired(&row, now) {
            return Err(unknown());
        }
        let mut image = row.clone();
        materialize_optional_fields(&mut image, table);
        let mut runner = Runner::new(&tx, &self.schema, Context::new(principal, BTreeMap::new()).at(now), Meter::new(self.ceilings, Cut::Cap), 0);
        let allowed = runner.check_rule(table_name, Effect::Read, None, &image)?
            && (runner.context.is_system() || !table.written_by.get(column).is_some_and(|authority| !authority.audience
                && image.field(&authority.owner).ok() != Some(&Value::Id(principal.into()))));
        drop(runner);
        if !allowed {
            tx.rollback()?;
            return Err(unknown());
        }
        let once = matches!(table.columns.get(column).map(asset_columns::leaf), Some(ColumnType::Image { once: true, .. }));
        if once {
            if range {
                return Err(RuntimeError::Asset { code: "E_ASSET_RANGE", message: "one-view photos require a complete request without Range; the view was not consumed".into() });
            }
            if tx.asset_viewed(id, principal)? {
                tx.rollback()?;
                return Err(RuntimeError::Asset { code: "E_ASSET_VIEWED", message: "this photo was for one view, and it was viewed".into() });
            }
        }
        tx.rollback()?;
        Ok(grant(once))
    }

    /// Complete a view after the host has successfully sent the bytes.
    /// Hosts serialize deliveries for the same asset and principal.
    pub fn record_asset_view(&mut self, principal: &str, id: &str, now: i64) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        if tx.asset_viewed(id, principal)? {
            return Err(RuntimeError::Asset { code: "E_ASSET_VIEWED", message: "this photo was for one view, and it was viewed".into() });
        }
        tx.record_asset_view(id, principal, now)?;
        tx.commit()
    }

    /// Unlink and forget the assets nobody serves any more: released by
    /// their home, or never claimed within the grace period.
    pub fn sweep_assets(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let sweep = self.prepare_asset_sweep(now)?;
        sweep.remove_files()?;
        self.finish_asset_sweep(&sweep)
    }

    /// Make a bounded stale batch unclaimable. The returned file work owns
    /// no engine borrow and should run after releasing the host mutex.
    pub fn prepare_asset_sweep(&mut self, now: i64) -> Result<assets::AssetSweep, RuntimeError> {
        self.prepare_asset_sweep_for(now, std::time::Duration::MAX)
    }

    pub fn prepare_asset_sweep_for(&mut self, now: i64, budget: std::time::Duration) -> Result<assets::AssetSweep, RuntimeError> {
        let directory = self.store.assets_dir().to_path_buf();
        let tx = self.store.transaction()?;
        let stale = tx.stage_stale_assets_for(now, budget)?;
        let sweep = assets::AssetSweep::new(&stale, &directory);
        tx.commit()?;
        Ok(sweep)
    }

    /// Forget a prepared batch after its files have been removed.
    pub fn finish_asset_sweep(&mut self, sweep: &assets::AssetSweep) -> Result<u64, RuntimeError> {
        self.finish_asset_sweep_slice(sweep, std::time::Duration::MAX)
    }

    /// Advance the prepared batch only after the forget transaction commits.
    pub fn finish_asset_sweep_for(&mut self, sweep: &mut assets::AssetSweep, budget: std::time::Duration) -> Result<u64, RuntimeError> {
        let removed = self.finish_asset_sweep_slice(sweep, budget)?;
        sweep.forget_prefix(removed as usize);
        Ok(removed)
    }

    fn finish_asset_sweep_slice(&mut self, sweep: &assets::AssetSweep, budget: std::time::Duration) -> Result<u64, RuntimeError> {
        let started = std::time::Instant::now();
        let tx = self.store.transaction()?;
        let mut removed = 0;
        for id in sweep.ids() {
            if removed > 0 && started.elapsed() >= budget { break; }
            tx.forget_asset(id)?;
            removed += 1;
        }
        tx.commit()?;
        Ok(removed)
    }

}

// @ref LLP 3000.038.000#2 — the server bounds persisted declaration metadata too.
fn bounded_placement(placement:&serde_json::Value)->Result<String,RuntimeError>{
    let encoded=crate::json_codec::to_text(placement).map_err(|e|RuntimeError::Input(e.to_string()))?;
    let args=crate::json_codec::to_text(&placement["args"]).map_err(|e|RuntimeError::Input(e.to_string()))?;
    if args.len()>64<<10 || encoded.len()>96<<10 {
        return Err(RuntimeError::Asset{code:"E_UPLOAD_ARGUMENT",message:"placing args exceed 64 KiB or placement metadata exceeds 96 KiB".into()});
    }
    Ok(encoded)
}
