//! Complete bounded fact collection followed by Rust execution in member order.
use super::{closure::Closure, overlay::{Access, Base, Image, Overlay, RowKey}, reads::ReadSet};
use crate::{RuntimeError, Value, engine::{program::Invocation, mutation::{ProgramHost,Execution,execute_body}}, store_port::{AnyTx,batch::{Facts,Request}}};
use std::collections::BTreeMap;

pub(in crate::engine) struct Prepared {
    pub execution: Execution,
    pub writes: BTreeMap<RowKey,Image>,
    pub reads: ReadSet,
    pub changes: crate::revocation::Recorder,
}
pub(in crate::engine) struct Wave {
    pub base: Base,
    pub accepted: BTreeMap<RowKey,Value>,
    pub images: BTreeMap<RowKey,Image>,
    pub facts: Vec<Facts>,
    prepared: Vec<Option<Prepared>>,
}
impl Wave {
    pub fn prepare(tx:&AnyTx<'_>, host:&ProgramHost<'_>, batch:&[Invocation], indices:&[usize])->Result<Option<Self>,RuntimeError>{
        let Some(plans)=indices.iter().map(|&i|Closure::new(host.schema,host.programs.get(&batch[i].name)?,&batch[i].context,host.generation)).collect::<Option<Vec<_>>>() else {return Ok(None);};
        let requests=indices.iter().map(|&i|Request {digest:batch[i].authority.as_ref().map(|a|a.digest.clone()),principal:batch[i].context.viewer.clone(),id:batch[i].id.clone()}).collect::<Vec<_>>();
        if requests.iter().any(|r|r.digest.as_deref().is_some_and(|v|v.contains('\0'))||r.principal.contains('\0')||r.id.as_deref().is_some_and(|v|v.contains('\0'))) {return Ok(None);}
        let mut roots=Vec::new();
        for plan in &plans {for root in &plan.roots {if root.key.iter().any(|k|k.as_str().is_ok_and(|s|s.contains('\0'))) {return Ok(None);} if !roots.contains(root){roots.push(root.clone());}}}
        #[cfg(test)]
        crate::engine::program_batch::fault::check(crate::engine::program_batch::fault::Point::BeforeFacts,usize::MAX)?;
        let facts=tx.batch_facts(&requests)?;
        #[cfg(test)]
        crate::engine::program_batch::fault::check(crate::engine::program_batch::fault::Point::AfterFacts,usize::MAX)?;
        if facts.iter().any(|f|f.authority.as_ref().is_some_and(|(_,a)|!crate::identity::facts::ordinary(a))) {return Ok(None);}
        let mut base=Base::default();
        #[cfg(test)]
        crate::engine::program_batch::fault::check(crate::engine::program_batch::fault::Point::BeforeLevel,0)?;
        tx.batch_level(&roots,host.schema,&mut base)?;
        #[cfg(test)]
        crate::engine::program_batch::fault::check(crate::engine::program_batch::fault::Point::AfterLevel,0)?;
        let mut probes:Vec<Access>=Vec::new();
        for plan in &plans {
            let Some(accesses)=plan.probes(host.schema,&base) else {return Ok(None);};
            for access in accesses {if !base.contains(&access)&&!probes.contains(&access){probes.push(access);}}
        }
        #[cfg(test)]
        crate::engine::program_batch::fault::check(crate::engine::program_batch::fault::Point::BeforeLevel,1)?;
        tx.batch_level(&probes,host.schema,&mut base)?;
        #[cfg(test)]
        crate::engine::program_batch::fault::check(crate::engine::program_batch::fault::Point::AfterLevel,1)?;
        let mut counts=BTreeMap::new();
        for plan in &plans {for key in &plan.writes {*counts.entry(key).or_insert(0)+=1;}}
        let empty=BTreeMap::new();
        let mut prepared=Vec::new();
        for (n,&i) in indices.iter().enumerate(){
            // Known hot colliders run once, serially in memory. Other members
            // may read predecessors' targets and require recorded validation.
            if plans[n].writes.iter().any(|k|counts[k]>1){prepared.push(None);continue;}
            let invocation=&batch[i];
            let mut context=invocation.context.clone();
            crate::engine::validate::validate_inputs(host.schema,&host.programs[&invocation.name],&mut context.args)?;
            context.now=Some(context.now.unwrap_or_else(crate::now_ms));context.generation=host.generation;
            context.entropy=host.entropy;context.minter=host.minter.clone();
            let overlay=Overlay::new(&base,&empty);
            let execution=execute_body(host,&overlay,context,&host.programs[&invocation.name],tx.next_seq()?+n as u64);
            if overlay.reads.borrow().unsupported {return Ok(None);}
            prepared.push(Some(Prepared{execution,writes:overlay.writes.into_inner(),reads:overlay.reads.into_inner(),changes:overlay.changes.into_inner()}));
        }
        Ok(Some(Self{base,accepted:Default::default(),images:Default::default(),facts,prepared}))
    }
    pub fn take(&mut self,n:usize)->(Option<Prepared>,bool){
        let prepared=self.prepared[n].take();
        // Index keys and populations are fixed by the selector. Every probe's
        // returned image, even a hidden one, therefore conflicts by row identity.
        let conflict=prepared.as_ref().is_some_and(|p|p.reads.rows.iter().any(|key|self.accepted.contains_key(key)));
        if conflict {(None,true)} else {(prepared,false)}
    }
    pub fn accept(&mut self,images:Vec<Image>){
        for image in images {
            let key=image.key();self.accepted.insert(key.clone(),image.new.clone());
            self.images.entry(key).and_modify(|old|old.new=image.new.clone()).or_insert(image);
        }
    }
}
