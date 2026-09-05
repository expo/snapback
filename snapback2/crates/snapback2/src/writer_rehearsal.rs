use super::*;
use crate::rehearsal::{Snapshot, Target};

impl OwnerHandle {
    pub fn rehearse(
        &self,
        target: Target,
        args: Json,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        let (tx, rx) = mpsc::channel();
        self.call(Action::RehearsalSnapshot {
            identity,
            reply: tx,
        })?;
        let (snapshot, by) = rx.recv().map_err(|_| owner_gone())??;
        snapshot.run(target, args, by)
    }
}

impl State {
    pub(super) fn rehearsal_snapshot(
        &self,
        identity: Identity,
    ) -> Result<(Snapshot, String), Refusal> {
        let Identity::Operator { by } = identity else {
            return Err(Refusal::operator_required());
        };
        self.require_operator(&by)?;
        let snapshot = Snapshot::capture(
            self.runtime(),
            &self.root.join(".snapback/rehearsals"),
            self.now(),
        )?;
        Ok((snapshot, by))
    }
}

/// The same argument admission and `E_JOB_ARGS` spelling as an enqueue.
pub(crate) fn rehearsal_args(
    program: &Program,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    writer_jobs::job_args(program, args)
}
