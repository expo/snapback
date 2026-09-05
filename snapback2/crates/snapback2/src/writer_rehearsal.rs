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
            target,
            args,
            identity,
            reply: tx,
        })?;
        let snapshot = rx.recv().map_err(|_| owner_gone())??;
        snapshot.run()
    }
}

impl State {
    /// Identity, then the program's admission, then the copy: nothing pauses the
    /// writer for a backup unless the program would actually run.
    pub(super) fn rehearsal_snapshot(
        &self,
        target: Target,
        args: Json,
        identity: Identity,
    ) -> Result<Snapshot, Refusal> {
        let Identity::Operator { by } = identity else {
            return Err(Refusal::operator_required());
        };
        self.require_operator(&by)?;
        Snapshot::capture(
            self.runtime(),
            &self.root.join(".snapback/rehearsals"),
            self.now(),
            target,
            &args,
            by,
        )
    }
}

/// The same argument admission and `E_JOB_ARGS` spelling as an enqueue.
pub(crate) fn rehearsal_args(
    program: &Program,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    writer_jobs::job_args(program, args)
}
