//! Maintained rows obey the restricted member facade's abort boundary.
// @ref LLP 3000.009.001.000#3.4 — member abort cannot retain a speculative mirror.
use crate::{Engine, Value, Ceilings, store_port::AnyStore,
    engine::{runner::Runner, committer::{Committer,Member,Kind}}, meter::{Meter,Cut}};
use crate::engine::postgres::tests::maintained_columns::{SOURCE,bound,pg,ctx,id,like,equal_rows};
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn maintained_columns_rollback_and_member_abort() {
    let (schema,programs)=bound(SOURCE);
    let mut sqlite=Engine::new_at(AnyStore::memory().unwrap(),schema.clone(),programs.clone(),1000).unwrap();
    let mut postgres=pg(schema.clone(),programs);
    for engine in [&mut sqlite,&mut postgres] {
        engine.mutate("post",None,ctx(&[("id",id("a")),("at",Value::Int(1))])).unwrap();
        let before=engine.store().rows("posts").unwrap();
        let program=engine.programs["like"].clone();
        // Whole physical rollback, nested program abort, then a later successful member.
        for rollback_physical in [true,false] {
            let tx=engine.store_mut().transaction().unwrap();
            Committer::execute(&tx,Member::new(Kind::Program,|member| {
                let mut runner=Runner::new(member.tx,&schema,like("discard",id("a"),12,true),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
                runner.run(&program)?; drop(runner);
                if rollback_physical {member.complete(())} else {member.abort(())}
            })).unwrap();
            if rollback_physical {tx.rollback().unwrap();} else {tx.commit().unwrap();}
            assert_eq!(engine.store().rows("posts").unwrap(),before);
            assert!(engine.store().rows("likes").unwrap().is_empty());
            let tx=engine.store_mut().transaction().unwrap();
            tx.savepoint("program").unwrap();
            let mut runner=Runner::new(&tx,&schema,like("nested",id("a"),3,true),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
            runner.run(&program).unwrap(); drop(runner);
            tx.rollback_to("program").unwrap(); tx.commit().unwrap();
            assert_eq!(engine.store().rows("posts").unwrap(),before);
        }
        engine.mutate("like",None,like("kept",id("a"),2,true)).unwrap();
    }
    equal_rows(&sqlite,&postgres);
}
