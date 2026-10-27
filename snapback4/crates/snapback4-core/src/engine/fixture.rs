//! A campaign fork retains activated semantics without running adoption again.
use super::*;
impl Engine {
    /// Private replay snapshot; failure falls back to ordinary fixture copies.
    #[doc(hidden)]
    pub fn campaign_snapshot(&self)->Result<Option<Self>,RuntimeError>{
        if self.store.campaign_assets_enabled(){return Ok(None);}
        let snapshot=self.fork_fixture()?;snapshot.store.capture_campaign_assets()?;Ok(Some(snapshot))
    }

    // @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — isolation includes entropy, assets and ephemeral ownership.
    pub fn fork_fixture(&self) -> Result<Self, RuntimeError> {
        if self.presence.is_some(){return Err(RuntimeError::Schema("fixture fork needs an isolated external presence snapshot".into()));}
        let store=self.store.fork_memory()?;
        let identity=store.store_identity()?.ok_or_else(||RuntimeError::Store("fixture store has no identity".into()))?;
        Ok(Self {
            #[cfg(feature="postgres")]
            revision_cache: Default::default(),
            #[cfg(feature="postgres")]
            code_native_digest: self.code_native_digest.clone(),
            #[cfg(feature = "evaluation-support")]
            evaluation_precharge: crate::meter::Metered::default(),
            timeline_schedule:timeline::Schedule::default(),
            ephemeral:std::sync::Arc::new(if self.schema.tables.values().any(|t|t.ephemeral.is_some()){self.ephemeral.fork_fixture(&identity,self.generation)?}else{ephemeral::Hub::new(identity.clone(),self.generation,&self.schema)}),
            store_id:identity,store,schema:self.schema.clone(),programs:self.programs.clone(),ceilings:self.ceilings,
            entropy:crate::ids::seed(),minter:crate::ids::Mint::default(),generation:self.generation,
            expiry_after:self.expiry_after.clone(),dev_effects:self.dev_effects,
            #[cfg(feature="native")] native:self.native.clone(),
            #[cfg(feature="native")] native_logs:native::Logs::default(),presence:None,
        })
    }
}

impl Engine {
    /// Judge independent fixture intent with the engine's authorized rule hops.
    pub fn fixture_policy(&mut self,rule:&crate::schema::RuleExpr,viewer:&str,old:Option<&Value>,next:&Value,now:i64)->Result<rules::Verdict,RuntimeError>{
        let tx=self.store.read_transaction()?;
        let context=if viewer==crate::SYSTEM_PRINCIPAL{Context::system()}else{Context::new(viewer,BTreeMap::new())};
        let mut runner=Runner::new(&tx,&self.schema,context.at(now),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
        let bytes=runner.rule_scratch(rule);
        runner.authorized_scratch(bytes,&[],|runner,allowance|{
            let mut probe=read::RuleProbe{runner,allowance};
            rules::evaluate_verdict(rule,viewer,old,next,false,&mut probe)
        })
    }
}

impl Engine {
    /// Test-only population through ordinary insertion, including field authority.
    /// The temporary program is private to this fixture engine and never adopted.
    // @ref LLP 3000.036.004#137-wave-19-correction-admissible-starts-and-persistent-refutations — a row gate alone is not complete insertion authority.
    pub fn insert_fixture(&mut self,table:&str,row:Value,viewer:&str,now:i64)->Result<MutationOutcome,RuntimeError>{
        let name="$security.generated-insert";
        if viewer==crate::SYSTEM_PRINCIPAL||self.programs.contains_key(name){return Err(RuntimeError::Schema("fixture insertion requires an ordinary actor and a private probe name".into()));}
        self.programs.insert(name.into(),Program{name:name.into(),kind:crate::ir::ProgramKind::Mutation,args:BTreeMap::new(),arg_aliases:BTreeMap::new(),body:vec![crate::ir::Stmt::Insert{table:table.into(),row:crate::ir::Expr::Literal(row)}],read_time_granularity_ms:None,returned_shapes:BTreeMap::new(),native:false});
        let result=self.mutate(name,None,Context::new(viewer,BTreeMap::new()).at(now));
        self.programs.remove(name);
        result
    }
}

#[cfg(test)]
mod replay_id_tests {
    use super::*;
    #[test]
    fn lazy_replay_ids_match_eager_supply_and_clone_independently() {
        for first in [0, (1_800_000_000_000u128 << 80) + 1, u128::MAX - 1024] {
            let range = first..first + 1024;
            let mut eager = Context::new("viewer", BTreeMap::new()).with_ids(range.clone().map(crate::ids::encode));
            let mut lazy = Context::new("viewer", BTreeMap::new()).with_replay_id_range(range);
            assert!(lazy.new_ids.is_empty(), "unused supply allocates no strings");
            let mut cloned = lazy.clone();
            for _ in 0..1024 {
                let expected = eager.mint().unwrap();
                assert_eq!(lazy.mint().unwrap(), expected);
                assert_eq!(cloned.mint().unwrap(), expected);
            }
            assert_eq!(lazy.minted_ids, eager.minted_ids);
            assert_eq!(cloned.minted_ids, eager.minted_ids);
            assert!(lazy.replay_id_range.as_ref().unwrap().is_empty());
        }
    }
    #[test]
    fn explicit_supply_replaces_range_and_empty_ranges_use_the_host_minter() {
        let mut context = Context::new("viewer", BTreeMap::new()).with_replay_id_range(0..1024).with_ids(["explicit".into()]);
        assert_eq!(context.mint().unwrap(), "explicit");
        assert!(context.replay_id_range.is_none());
        let minter = crate::ids::Mint::default();
        let mut eager = Context::new("viewer", BTreeMap::new()).at(1000).with_minter(minter.clone()).with_ids([]);
        let mut lazy = Context::new("viewer", BTreeMap::new()).at(1000).with_minter(minter).with_replay_id_range(0..0);
        let first = eager.mint().unwrap();
        let second = lazy.mint().unwrap();
        assert_eq!(crate::ids::minted_at(&second), Some(1000));
        assert!(second > first);
    }
}
