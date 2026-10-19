//! A campaign fork retains activated semantics without running adoption again.
use super::*;
impl Engine {
    // @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — isolation includes entropy, assets and ephemeral ownership.
    pub fn fork_fixture(&self) -> Result<Self, RuntimeError> {
        if self.presence.is_some(){return Err(RuntimeError::Schema("fixture fork needs an isolated external presence snapshot".into()));}
        let store=self.store.fork_memory()?;
        let identity=store.meta("store_id")?.ok_or_else(||RuntimeError::Store("fixture store has no identity".into()))?;
        Ok(Self {
            timeline_schedule:timeline::Schedule::default(),
            ephemeral:std::sync::Arc::new(if self.schema.tables.values().any(|t|t.ephemeral.is_some()){self.ephemeral.fork_fixture(&identity,self.generation)?}else{ephemeral::Hub::new(identity,self.generation,&self.schema)}),
            store,schema:self.schema.clone(),programs:self.programs.clone(),ceilings:self.ceilings,
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
